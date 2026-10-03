import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  chunkTranscript,
  createMeetingSchema,
  MAX_UPLOAD_BYTES,
  parseTranscript,
  verifyItems,
  type Meeting,
  type Segment,
} from "@/lib/domain";
import {
  composeSummary,
  extractChunk,
  transcribeAudioFile,
  transcribeMediaUrl,
  verifyMeaning,
} from "@/lib/ai";
import { detectVideoProvider, fetchVideoSource } from "@/lib/video-source";

export const maxDuration = 300;

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "The local video test failed.";
  return NextResponse.json({ error: message }, { status: 400 });
}

async function transcribeUploadedFile(file: File) {
  if (file.size > MAX_UPLOAD_BYTES)
    throw new Error("OpenAI transcription supports video files up to 25 MB.");
  return transcribeAudioFile(file, file.name);
}

export async function POST(request: Request) {
  try {
    if (process.env.NODE_ENV === "production" || process.env.FOLIO_LOCAL_TEST_MODE !== "1")
      return NextResponse.json(
        { error: "Local testing is disabled. Enable FOLIO_LOCAL_TEST_MODE=1 for development." },
        { status: 403 },
      );
    if (!process.env.GROQ_API_KEY)
      throw new Error("Add GROQ_API_KEY to use local video testing.");

    let title = "";
    let project = "General";
    let participants: string[] = [];
    let context = "";
    let length: "brief" | "standard" | "detailed" = "standard";
    let consent = false;
    let videoUrl = "";
    let rawTranscript = "";
    let file: File | null = null;
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData();
      title = String(form.get("title") || "");
      project = String(form.get("project") || "General");
      participants = String(form.get("participants") || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      context = String(form.get("context") || "");
      length = String(form.get("length") || "standard") as typeof length;
      consent = form.get("consent") === "true";
      videoUrl = String(form.get("videoUrl") || "");
      rawTranscript = String(form.get("transcript") || "");
      const candidate = form.get("file");
      file = candidate instanceof File && candidate.size ? candidate : null;
    } else {
      const body = (await request.json()) as Record<string, unknown>;
      title = String(body.title || "");
      project = String(body.project || "General");
      participants = Array.isArray(body.participants)
        ? body.participants.map(String)
        : [];
      context = String(body.context || "");
      length = String(body.length || "standard") as typeof length;
      consent = body.consent === true;
      videoUrl = String(body.videoUrl || "");
      rawTranscript = String(body.transcript || "");
    }
    const input = createMeetingSchema.parse({
      title,
      project,
      participants,
      context,
      length,
      consent,
      ...(file
        ? { sourcePath: "local-upload", sourceName: file.name }
        : videoUrl
          ? { videoUrl }
          : { transcript: rawTranscript }),
    });
    let transcript: Segment[] = input.transcript ? parseTranscript(input.transcript) : [];
    let sourceName = input.sourceName || null;
    const sourceProvider = input.videoUrl ? detectVideoProvider(input.videoUrl) : null;
    let duration = 0;
    if (file) {
      const result = await transcribeUploadedFile(file);
      transcript = result.segments;
      duration = result.duration;
      sourceName = file.name;
    } else if (input.videoUrl) {
      const source = await fetchVideoSource(input.videoUrl);
      sourceName = sourceName || source.title || "Video link";
      duration = source.duration;
      if (source.segments?.length) transcript = source.segments;
      else if (source.mediaUrl) {
        const result = await transcribeMediaUrl(source.mediaUrl);
        transcript = result.segments;
        duration = Math.max(duration, result.duration);
      }
    }
    if (!transcript.length) throw new Error("No transcript could be created for this video.");
    if (transcript.reduce((total, segment) => total + segment.text.length, 0) > 180000)
      throw new Error("This transcript exceeds the current processing limit.");
    duration = Math.max(duration, ...transcript.map((segment) => segment.end || 0));
    const meeting: Meeting = {
      id: randomUUID(),
      title: input.title,
      project: input.project || "General",
      participants: input.participants,
      context: input.context,
      createdAt: new Date().toISOString(),
      duration,
      sourceName,
      sourcePath: null,
      sourceUrl: input.videoUrl || null,
      sourceProvider,
      length: input.length,
      status: "ready",
      stage: "Ready to review",
      error: null,
      transcript,
      summary: "",
      topics: [],
      items: [],
    };
    const verified = [];
    if (!input.transcript) {
      const chunks = chunkTranscript(transcript);
      const collected = [];
      for (const chunk of chunks)
        collected.push(
          ...(await extractChunk(chunk, {
            title: meeting.title,
            project: meeting.project,
            participants: meeting.participants,
            context: meeting.context,
          })),
        );
      const evidenceChecked = verifyItems(collected, transcript);
      for (let index = 0; index < evidenceChecked.length; index += 20)
        verified.push(
          ...(await verifyMeaning(evidenceChecked.slice(index, index + 20), transcript)),
        );
    }
    const composed = await composeSummary({ ...meeting, items: verified });
    return NextResponse.json({ meeting: { ...meeting, items: verified, ...composed } });
  } catch (error) {
    return errorResponse(error);
  }
}
