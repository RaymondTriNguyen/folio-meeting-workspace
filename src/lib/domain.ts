import { z } from "zod";

export const itemKinds = [
  "requirement",
  "decision",
  "action",
  "risk",
  "question",
] as const;
export const itemSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(itemKinds),
  text: z.string().min(1).max(3000),
  category: z.string().max(100).default("Functional"),
  priority: z.enum(["must", "should", "could"]).default("should"),
  owner: z.string().max(100).nullable().default(null),
  dueDate: z.string().max(100).nullable().default(null),
  segmentId: z.string().max(100).nullable().default(null),
  evidence: z.string().max(4000).default(""),
  confidence: z.number().min(0).max(1).default(0.7),
  inferred: z.boolean().default(false),
  review: z
    .enum(["verified", "needs-review", "edited"])
    .default("needs-review"),
  completed: z.boolean().default(false),
});
export const segmentSchema = z.object({
  id: z.string(),
  start: z.number().nonnegative().nullable(),
  end: z.number().nonnegative().nullable(),
  speaker: z.string(),
  text: z.string(),
});
export const topicSchema = z.object({
  title: z.string(),
  summary: z.string(),
  segmentId: z.string().nullable(),
});
export type Item = z.infer<typeof itemSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type Topic = z.infer<typeof topicSchema>;
export type VideoProvider =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "vimeo"
  | "x"
  | "direct"
  | "other";
export type MeetingStatus =
  | "queued"
  | "transcribing"
  | "extracting"
  | "verifying"
  | "writing"
  | "ready"
  | "failed";
export interface Meeting {
  id: string;
  title: string;
  project: string;
  participants: string[];
  context: string;
  createdAt: string;
  duration: number;
  sourceName: string | null;
  sourcePath: string | null;
  sourceUrl: string | null;
  sourceProvider: VideoProvider | null;
  length: "brief" | "standard" | "detailed";
  status: MeetingStatus;
  stage: string;
  error: string | null;
  transcript: Segment[];
  summary: string;
  topics: Topic[];
  items: Item[];
}
export const createMeetingSchema = z
  .object({
    title: z.string().trim().min(2, "Give your meeting a title.").max(180),
    project: z.string().trim().max(100).default("General"),
    participants: z
      .array(z.string().trim().min(1).max(100))
      .max(30)
      .default([]),
    context: z.string().max(5000).default(""),
    length: z.enum(["brief", "standard", "detailed"]).default("standard"),
    consent: z.literal(true, {
      error: "Confirm recording consent before continuing.",
    }),
    transcript: z.string().max(180000).optional(),
    sourcePath: z.string().max(500).optional(),
    sourceName: z.string().max(250).optional(),
    videoUrl: z
      .string()
      .trim()
      .url("Paste a valid video link.")
      .max(500)
      .optional(),
  })
  .refine(
    (v) => {
      const transcript = Boolean(
        v.transcript?.trim().length && v.transcript.trim().length >= 40,
      );
      return [transcript, Boolean(v.sourcePath), Boolean(v.videoUrl)].filter(
        Boolean,
      ).length === 1;
    },
    {
      message:
        "Provide either a recording, a video link, or a transcript of at least 40 characters.",
    },
  );
export type MeetingInput = z.infer<typeof createMeetingSchema>;
// OpenAI's file transcription endpoint accepts media files up to 25 MB.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_MEETING_BYTES = 3 * 1024 * 1024;
export function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
export function boundedPage<T>(rows: T[], maxBytes = MAX_MEETING_BYTES): T[] {
  const page: T[] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = serializedBytes(row);
    if (size > maxBytes)
      throw new Error("A meeting exceeds the supported document size.");
    if (bytes + size > maxBytes && page.length) break;
    page.push(row);
    bytes += size;
  }
  return page;
}
export const mediaExtensions = [
  "mp4",
  "mov",
  "mkv",
  "webm",
  "mp3",
  "m4a",
  "wav",
  "ogg",
  "flac",
];

export function timestamp(seconds: number | null | undefined): string {
  if (seconds == null) return "No timestamp";
  const s = Math.max(0, Math.floor(seconds));
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
}
export function parseTranscript(raw: string): Segment[] {
  const lines = raw
    .trim()
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const entries: { start: number | null; text: string }[] = [];
  let current: { start: number | null; text: string; timestamped: boolean } | null = null;
  const flush = () => {
    if (current?.text.trim())
      entries.push({ start: current.start, text: current.text.trim() });
    current = null;
  };
  for (const line of lines) {
    const match = line.match(
      /^\[?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.\d+)?\]?\s*[-:]?\s*/,
    );
    if (match) {
      flush();
      current = {
        start:
          Number(match[1] || 0) * 3600 +
          Number(match[2]) * 60 +
          Number(match[3]),
        text: line.slice(match[0].length),
        timestamped: true,
      };
    } else if (current?.timestamped) {
      current.text = `${current.text} ${line}`.trim();
    } else {
      flush();
      current = { start: null, text: line, timestamped: false };
    }
  }
  flush();

  const segments = entries
    .flatMap(({ start, text }) => {
      const chunks: string[] = [];
      for (let pos = 0; pos < text.length; pos += 4000)
        chunks.push(text.slice(pos, pos + 4000));
      return chunks.map((chunk) => ({ start, text: chunk }));
    })
    .map(({ start, text }, i) => {
      const speaker = text.match(/^([\p{L}\p{N} ._-]{1,60}):\s+/u);
      return {
        id: `seg-${i + 1}`,
        start,
        end: null as number | null,
        speaker: speaker ? speaker[1].trim() : "Speaker",
        text: speaker ? text.slice(speaker[0].length) : text,
      };
    });
  return segments.map((s, i) => ({
    ...s,
    end:
      s.start != null && segments[i + 1]?.start != null
        ? Math.max(s.start, segments[i + 1].start!)
        : s.start,
  }));
}
export function chunkTranscript(
  segments: Segment[],
  limit = 16000,
): Segment[][] {
  const chunks: Segment[][] = [];
  let current: Segment[] = [];
  let size = 0;
  const boundedSegments = segments.flatMap((segment) => {
    if (segment.text.length <= limit) return [segment];
    const parts: Segment[] = [];
    for (let offset = 0; offset < segment.text.length; offset += limit) {
      parts.push({ ...segment, text: segment.text.slice(offset, offset + limit) });
    }
    return parts;
  });
  for (const segment of boundedSegments) {
    if (size + segment.text.length > limit && current.length) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(segment);
    size += segment.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
export function verifyItems(items: Item[], transcript: Segment[]): Item[] {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const seen = new Set<string>();
  return items
    .flatMap((item) => {
      const segment = transcript.find((s) => s.id === item.segmentId);
      const quote = normalize(item.evidence);
      if (
        !segment ||
        quote.length < 8 ||
        !normalize(segment.text).includes(quote)
      )
        return [];
      const key = `${item.kind}:${normalize(item.text)}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const confidence = item.inferred
        ? Math.min(item.confidence, 0.7)
        : item.confidence;
      return [
        {
          ...item,
          confidence,
          review: (confidence < 0.8 || item.inferred
            ? "needs-review"
            : "verified") as Item["review"],
        },
      ];
    })
    .map((item, i) => ({ ...item, id: `${item.kind}-${i + 1}` }));
}
export function retrieveSegments(
  question: string,
  segments: Segment[],
  max = 14,
): Segment[] {
  const terms = question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
  const stop = new Set([
    "the",
    "and",
    "was",
    "what",
    "that",
    "did",
    "who",
    "when",
    "about",
    "were",
    "with",
    "this",
    "for",
  ]);
  const scored = segments.map((segment, index) => ({
    segment,
    index,
    score: terms
      .filter((t) => !stop.has(t))
      .reduce(
        (score, t) => score + (segment.text.toLowerCase().includes(t) ? 1 : 0),
        0,
      ),
  }));
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, max)
    .sort((a, b) => a.index - b.index)
    .map((s) => s.segment);
}
