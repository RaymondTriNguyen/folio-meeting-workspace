import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  authenticated,
  apiError,
  ApiError,
  jsonBody,
  rateLimit,
  requireProcessing,
} from "@/lib/server";
import {
  boundedPage,
  createMeetingSchema,
  parseTranscript,
  type Meeting,
} from "@/lib/domain";
import { inngest } from "@/lib/jobs";
import { detectVideoProvider } from "@/lib/video-source";

export async function GET(request: Request) {
  try {
    const { db, user } = await authenticated(request);
    const offset = Number(new URL(request.url).searchParams.get("offset") || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset >= 200)
      throw new ApiError(400, "Invalid library page.");
    const pageSize = Math.min(20, 200 - offset);
    const { data, error } = await db
      .from("meetings")
      .select("data")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const meetings = boundedPage(data.map((row) => row.data));
    const more = meetings.length < data.length || data.length === pageSize;
    const nextOffset =
      more && offset + meetings.length < 200 ? offset + meetings.length : null;
    return NextResponse.json(
      { meetings, nextOffset },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    const { db, user } = await authenticated(request);
    const input = createMeetingSchema.parse(await jsonBody(request));
    const videoProvider = input.videoUrl
      ? detectVideoProvider(input.videoUrl)
      : null;
    requireProcessing(
      Boolean(
        input.sourcePath ||
          (input.videoUrl && videoProvider !== "youtube"),
      ),
    );
    await rateLimit(user.id, "create", 15);
    if (input.sourcePath) {
      if (
        !input.sourcePath.startsWith(`${user.id}/`) ||
        input.sourcePath.includes("..")
      )
        throw new ApiError(
          403,
          "This recording does not belong to your workspace.",
        );
      const parts = input.sourcePath.split("/");
      const name = parts.pop()!;
      const { data, error } = await db.storage
        .from("recordings")
        .list(parts.join("/"), { search: name });
      if (error || !data?.some((file) => file.name === name))
        throw new ApiError(
          400,
          "Upload the recording before starting processing.",
        );
    }
    const transcript = input.transcript
      ? parseTranscript(input.transcript)
      : [];
    const meeting: Meeting = {
      id: randomUUID(),
      title: input.title,
      project: input.project || "General",
      participants: input.participants,
      context: input.context,
      createdAt: new Date().toISOString(),
      duration: Math.max(0, ...transcript.map((s) => s.end || 0)),
      sourceName: input.sourceName || (input.videoUrl ? "Video link" : null),
      sourcePath: input.sourcePath || null,
      sourceUrl: input.videoUrl || null,
      sourceProvider: videoProvider,
      length: input.length,
      status: "queued",
      stage: "Waiting to process",
      error: null,
      transcript,
      summary: "",
      topics: [],
      items: [],
    };
    const { error } = await db
      .from("meetings")
      .insert({
        id: meeting.id,
        user_id: user.id,
        status: meeting.status,
        data: meeting,
      });
    if (error) throw error;
    try {
      await inngest.send({
        name: "folio/meeting.created",
        data: { meetingId: meeting.id, ownerId: user.id, runId: randomUUID() },
      });
    } catch {
      meeting.status = "failed";
      meeting.error =
        "Unable to reach background processing. Check your Inngest connection and retry.";
      meeting.stage = "Could not start";
      await db
        .from("meetings")
        .update({ data: meeting, status: "failed" })
        .eq("id", meeting.id)
        .eq("user_id", user.id);
    }
    return NextResponse.json({ meeting }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
