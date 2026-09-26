import { Inngest, NonRetriableError } from "inngest";
import { adminDatabase } from "./server";
import {
  chunkTranscript,
  MAX_MEETING_BYTES,
  serializedBytes,
  verifyItems,
  type Meeting,
  type Segment,
  type Item,
} from "./domain";
import {
  composeSummary,
  extractChunk,
  transcriptionRequest,
  verifyMeaning,
} from "./ai";

export const inngest = new Inngest({ id: "folio-meetings" });

async function readMeeting(id: string, ownerId: string): Promise<Meeting> {
  const { data, error } = await adminDatabase()
    .from("meetings")
    .select("data")
    .eq("id", id)
    .eq("user_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NonRetriableError("Meeting no longer exists.");
  return data.data as Meeting;
}
async function saveMeeting(meeting: Meeting, ownerId: string) {
  if (
    meeting.items.length > 1000 ||
    serializedBytes(meeting) > MAX_MEETING_BYTES
  )
    throw new NonRetriableError(
      "This meeting exceeds the supported document size. Use a shorter transcript.",
    );
  const { data, error } = await adminDatabase()
    .from("meetings")
    .update({ data: meeting, status: meeting.status })
    .eq("id", meeting.id)
    .eq("user_id", ownerId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NonRetriableError("Meeting was deleted.");
  return meeting;
}
export const processMeeting = inngest.createFunction(
  {
    id: "process-meeting",
    triggers: { event: "folio/meeting.created" },
    retries: 2,
    concurrency: { limit: 1, key: "event.data.meetingId" },
    idempotency: "event.data.runId",
    onFailure: async ({ event }) => {
      const { meetingId, ownerId } = event.data.event.data;
      const meeting = await readMeeting(meetingId, ownerId).catch(() => null);
      if (meeting && meeting.status !== "ready")
        await saveMeeting(
          {
            ...meeting,
            status: "failed",
            stage: "Processing interrupted",
            error:
              "Processing could not finish. Check your provider credentials, quota, and job logs, then retry.",
          },
          ownerId,
        );
    },
  },
  async ({ event, step }) => {
    const { meetingId, ownerId } = event.data as {
      meetingId: string;
      ownerId: string;
    };
    let meeting = await step.run("load-meeting", () =>
      readMeeting(meetingId, ownerId),
    );
    if (!meeting.transcript.length && meeting.sourcePath) {
      await step.run("mark-transcribing", () =>
        saveMeeting(
          {
            ...meeting,
            status: "transcribing",
            stage: "Transcribing & identifying speakers",
          },
          ownerId,
        ),
      );
      const transcriptionId = await step.run(
        "submit-transcription",
        async () => {
          const { data, error } = await adminDatabase()
            .storage.from("recordings")
            .createSignedUrl(meeting.sourcePath!, 14400);
          if (error || !data)
            throw new Error("Unable to access the recording.");
          const result = await transcriptionRequest("", {
            method: "POST",
            body: JSON.stringify({
              audio_url: data.signedUrl,
              speaker_labels: true,
              speech_models: ["universal-3-pro", "universal-2"],
            }),
          });
          return result.id as string;
        },
      );
      let transcript: Segment[] = [];
      let duration = 0;
      for (let i = 0; i < 120; i++) {
        await step.sleep(`transcription-wait-${i}`, "15s");
        const result = await step.run(`transcription-poll-${i}`, async () => {
          await readMeeting(meetingId, ownerId);
          const data = await transcriptionRequest(`/${transcriptionId}`);
          if (data.status === "error")
            throw new NonRetriableError(
              "The transcription provider could not process this recording.",
            );
          if (data.status !== "completed") return null;
          if (data.audio_duration > 7200)
            throw new NonRetriableError(
              "Recordings must be no longer than two hours.",
            );
          const turns = (data.utterances || []) as {
            start: number;
            end: number;
            text: string;
            speaker: string;
          }[];
          const segments: Segment[] = turns.map((s, j) => ({
            id: `seg-${j + 1}`,
            start: s.start / 1000,
            end: s.end / 1000,
            text: s.text,
            speaker: `Speaker ${s.speaker}`,
          }));
          if (!segments.length && data.text)
            segments.push({
              id: "seg-1",
              start: null,
              end: null,
              speaker: "Speaker",
              text: data.text,
            });
          if (segments.reduce((n, s) => n + s.text.length, 0) > 180000)
            throw new NonRetriableError(
              "This transcript exceeds the current processing limit.",
            );
          return { segments, duration: Number(data.audio_duration) || 0 };
        });
        if (result) {
          transcript = result.segments;
          duration = result.duration;
          break;
        }
      }
      if (!transcript.length)
        throw new NonRetriableError(
          "No speech was found, or transcription timed out.",
        );
      meeting = await step.run("save-transcript", () =>
        saveMeeting(
          {
            ...meeting,
            transcript,
            duration,
            participants: [...new Set(transcript.map((s) => s.speaker))],
          },
          ownerId,
        ),
      );
    }
    meeting = await step.run("mark-extracting", () =>
      saveMeeting(
        {
          ...meeting,
          status: "extracting",
          stage: "Finding requirements, decisions & actions",
          error: null,
        },
        ownerId,
      ),
    );
    const chunks = chunkTranscript(meeting.transcript);
    const collected: Item[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const items = await step.run(`extract-chunk-${i}`, async () => {
        await readMeeting(meetingId, ownerId);
        return extractChunk(chunks[i], {
          title: meeting.title,
          project: meeting.project,
          participants: meeting.participants,
          context: meeting.context,
        });
      });
      collected.push(...items);
    }
    meeting = await step.run("verify-evidence", () =>
      saveMeeting(
        {
          ...meeting,
          items: verifyItems(collected, meeting.transcript),
          status: "verifying",
          stage: "Checking every point against the transcript",
        },
        ownerId,
      ),
    );
    const supported: Item[] = [];
    for (let i = 0; i < meeting.items.length; i += 40) {
      const verified = await step.run(`verify-meaning-${i}`, async () => {
        await readMeeting(meetingId, ownerId);
        return verifyMeaning(meeting.items.slice(i, i + 40), meeting.transcript);
      });
      supported.push(...verified);
    }
    meeting = await step.run("save-verified-findings", () =>
      saveMeeting({ ...meeting, items: supported }, ownerId),
    );
    meeting = await step.run("mark-writing", () =>
      saveMeeting(
        {
          ...meeting,
          status: "writing",
          stage: "Putting your meeting into perspective",
        },
        ownerId,
      ),
    );
    const summary = await step.run("compose-summary", async () => {
      await readMeeting(meetingId, ownerId);
      return composeSummary(meeting);
    });
    await step.run("complete", () =>
      saveMeeting(
        {
          ...meeting,
          ...summary,
          status: "ready",
          stage: "Ready to review",
          error: null,
        },
        ownerId,
      ),
    );
    return { meetingId, items: meeting.items.length };
  },
);
