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
  transcribeMediaUrl,
  verifyMeaning,
} from "./ai";
import {
  fetchVideoSource,
  VideoSourceError,
} from "./video-source";

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
      if (meeting && meeting.status !== "ready" && !meeting.error)
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
    const transcribeMedia = (mediaUrl: string, prefix: string) =>
      step.run(`${prefix}-transcription`, async () => {
        await readMeeting(meetingId, ownerId);
        const result = await transcribeMediaUrl(mediaUrl);
        if (!result.segments.length)
          throw new NonRetriableError("No speech was found in this video.");
        if (
          result.segments.reduce((total, segment) => total + segment.text.length, 0) >
          180000
        )
          throw new NonRetriableError(
            "This transcript exceeds the current processing limit.",
          );
        return result;
      });
    if (!meeting.transcript.length && (meeting.sourceUrl || meeting.sourcePath)) {
      await step.run("mark-transcribing", () =>
        saveMeeting(
          {
            ...meeting,
            status: "transcribing",
            stage: meeting.sourceUrl
              ? "Preparing video link & identifying speakers"
              : "Transcribing & identifying speakers",
          },
          ownerId,
        ),
      );
      let transcript: Segment[] = [];
      let duration = meeting.duration;
      let importedTitle: string | null = null;
      if (meeting.sourceUrl) {
        const prepared = await step.run("resolve-video-source", async () => {
          try {
            return await fetchVideoSource(meeting.sourceUrl!);
          } catch (error) {
            const message =
              error instanceof VideoSourceError || error instanceof Error
                ? error.message
                : "This video link could not be imported. Upload the video file or paste a transcript instead.";
            await saveMeeting(
              {
                ...meeting,
                status: "failed",
                stage: "Could not import video link",
                error: message,
              },
              ownerId,
            );
            throw new NonRetriableError(message);
          }
        });
        importedTitle = prepared.title;
        if (prepared.segments?.length) {
          transcript = prepared.segments;
          duration = prepared.duration;
        } else if (prepared.mediaUrl) {
          const result = await transcribeMedia(prepared.mediaUrl, "video-link");
          transcript = result.segments;
          duration = Math.max(duration, result.duration);
        }
      } else if (meeting.sourcePath) {
        const { data, error } = await adminDatabase()
          .storage.from("recordings")
          .createSignedUrl(meeting.sourcePath, 14400);
        if (error || !data) throw new Error("Unable to access the recording.");
        const result = await transcribeMedia(data.signedUrl, "recording");
        transcript = result.segments;
        duration = result.duration;
      }
      if (!transcript.length)
        throw new NonRetriableError(
          "No speech was found, or video transcription timed out.",
        );
      meeting = await step.run("save-transcript", () =>
        saveMeeting(
          {
            ...meeting,
            transcript,
            duration,
            sourceName: meeting.sourceName || importedTitle,
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
    for (let i = 0; i < meeting.items.length; i += 20) {
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
