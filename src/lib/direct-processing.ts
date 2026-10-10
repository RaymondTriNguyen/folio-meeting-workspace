import {
  chunkTranscript,
  MAX_MEETING_BYTES,
  serializedBytes,
  verifyItems,
  type Item,
  type Meeting,
  type Segment,
} from "./domain";
import {
  composeSummary,
  extractChunk,
  transcribeMediaUrl,
  verifyMeaning,
} from "./ai";
import { fetchVideoSource, VideoSourceError } from "./video-source";
import { adminDatabase, getProviderKeys } from "./server";

function errorMessage(error: unknown) {
  return error instanceof VideoSourceError || error instanceof Error
    ? error.message
    : "Processing could not finish. Check your provider credentials and quota.";
}

/**
 * Prototype processing keeps the request self-contained. This can be swapped
 * for the durable Inngest function when long-running hosted jobs are needed.
 */
export async function processMeetingDirect(
  initial: Meeting,
  ownerId: string,
): Promise<Meeting> {
  const db = adminDatabase();
  let meeting = initial;
  const save = async (patch: Partial<Meeting>) => {
    const next = { ...meeting, ...patch };
    if (serializedBytes(next) > MAX_MEETING_BYTES)
      throw new Error(
        "This meeting exceeds the supported document size. Use a shorter transcript.",
      );
    const { error } = await db
      .from("meetings")
      .update({ data: next, status: next.status })
      .eq("id", next.id)
      .eq("user_id", ownerId);
    if (error) throw error;
    meeting = next;
    return meeting;
  };

  try {
    const keys = await getProviderKeys(ownerId);
    if (!keys.groqApiKey)
      throw new Error("Add a Groq API key in Settings before starting an analysis.");

    if (!meeting.transcript.length && (meeting.sourceUrl || meeting.sourcePath)) {
      await save({
        status: "transcribing",
        stage: meeting.sourceUrl
          ? "Preparing video link & identifying speakers"
          : "Transcribing & identifying speakers",
        error: null,
      });
      let transcript: Segment[] = [];
      let duration = meeting.duration;
      let importedTitle: string | null = null;
      if (meeting.sourceUrl) {
        const prepared = await fetchVideoSource(meeting.sourceUrl);
        importedTitle = prepared.title;
        if (prepared.segments?.length) {
          transcript = prepared.segments;
          duration = prepared.duration;
        } else if (prepared.mediaUrl) {
          const result = await transcribeMediaUrl(prepared.mediaUrl, keys);
          transcript = result.segments;
          duration = Math.max(duration, result.duration);
        }
      } else if (meeting.sourcePath) {
        const { data, error } = await db.storage
          .from("recordings")
          .createSignedUrl(meeting.sourcePath, 14400);
        if (error || !data) throw new Error("Unable to access the recording.");
        const result = await transcribeMediaUrl(data.signedUrl, keys);
        transcript = result.segments;
        duration = result.duration;
      }
      if (!transcript.length)
        throw new Error("No speech was found, or video transcription timed out.");
      if (
        transcript.reduce((total, segment) => total + segment.text.length, 0) >
        180000
      )
        throw new Error("This transcript exceeds the current processing limit.");
      meeting = await save({
        transcript,
        duration: Math.max(duration, ...transcript.map((s) => s.end || 0)),
        sourceName: meeting.sourceName || importedTitle,
        participants: [...new Set(transcript.map((s) => s.speaker))],
      });
    }

    await save({
      status: "extracting",
      stage: "Finding requirements, decisions & actions",
      error: null,
    });
    const chunks = chunkTranscript(meeting.transcript);
    const collected: Item[] = [];
    for (const chunk of chunks) {
      collected.push(
        ...(await extractChunk(
          chunk,
          {
            title: meeting.title,
            project: meeting.project,
            participants: meeting.participants,
            context: meeting.context,
          },
          keys,
        )),
      );
    }
    const checked = verifyItems(collected, meeting.transcript);
    await save({
      items: checked,
      status: "verifying",
      stage: "Checking every point against the transcript",
    });
    const supported: Item[] = [];
    for (let i = 0; i < checked.length; i += 20) {
      supported.push(
        ...(await verifyMeaning(checked.slice(i, i + 20), meeting.transcript, keys)),
      );
    }
    await save({ items: supported });
    await save({
      status: "writing",
      stage: "Putting your video into perspective",
    });
    const summary = await composeSummary(meeting, keys);
    return save({
      ...summary,
      status: "ready",
      stage: "Ready to review",
      error: null,
    });
  } catch (error) {
    const failed = {
      ...meeting,
      status: "failed" as const,
      stage: "Could not process",
      error: errorMessage(error),
    };
    try {
      await db
        .from("meetings")
        .update({ data: failed, status: failed.status })
        .eq("id", failed.id)
        .eq("user_id", ownerId);
    } catch {
      /* Preserve the original processing error for the API response. */
    }
    return failed;
  }
}
