import type { Segment } from "./domain";

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

export class YouTubeTranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YouTubeTranscriptError";
  }
}

export function parseYouTubeVideoId(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    if (!YOUTUBE_HOSTS.has(hostname)) return null;

    let id = "";
    if (hostname === "youtu.be" || hostname === "www.youtu.be") {
      id = url.pathname.split("/").filter(Boolean)[0] || "";
    } else if (url.pathname === "/watch") {
      id = url.searchParams.get("v") || "";
    } else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0] || "")) id = parts[1] || "";
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function jsonObjectAfter(source: string, marker: string): Record<string, unknown> | null {
  const markerStart = source.indexOf(marker);
  if (markerStart < 0) return null;
  const start = source.indexOf("{", markerStart + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, index + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function stringAfter(source: string, marker: string): string | null {
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const valueStart = start + marker.length;
  const valueEnd = source.indexOf('"', valueStart);
  return valueEnd > valueStart ? source.slice(valueStart, valueEnd) : null;
}

function transcriptParams(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const result = transcriptParams(entry);
      if (result) return result;
    }
    return null;
  }
  const object = value as Record<string, unknown>;
  for (const key of ["transcriptEndpoint", "getTranscriptEndpoint"]) {
    const endpoint = object[key];
    if (endpoint && typeof endpoint === "object") {
      const params = (endpoint as Record<string, unknown>).params;
      if (typeof params === "string") return params;
    }
  }
  for (const child of Object.values(object)) {
    const result = transcriptParams(child);
    if (result) return result;
  }
  return null;
}

function textFromRenderer(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const object = value as Record<string, unknown>;
  if (typeof object.simpleText === "string") return object.simpleText;
  if (Array.isArray(object.runs))
    return object.runs
      .map((run) =>
        run && typeof run === "object" && typeof (run as Record<string, unknown>).text === "string"
          ? (run as Record<string, unknown>).text
          : "",
      )
      .join("");
  return "";
}

function parseYouTubeTranscriptResponse(value: unknown): Segment[] {
  const segments: Segment[] = [];
  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const object = node as Record<string, unknown>;
    const cue = object.transcriptCueRenderer;
    if (cue && typeof cue === "object") {
      const data = cue as Record<string, unknown>;
      const start = Number(data.startOffsetMs) / 1000;
      const duration = Number(data.durationMs) / 1000;
      const text = textFromRenderer(data.cue).trim();
      if (text)
        segments.push({
          id: `yt-${segments.length + 1}`,
          start: Number.isFinite(start) ? start : null,
          end:
            Number.isFinite(start) && Number.isFinite(duration)
              ? start + duration
              : null,
          speaker: "Speaker",
          text,
        });
    }
    Object.values(object).forEach(visit);
  }
  visit(value);
  return segments;
}

async function fetchYouTubeTranscriptEndpoint(
  html: string,
  player: Record<string, unknown>,
): Promise<Segment[]> {
  const initial =
    jsonObjectAfter(html, "ytInitialData =") ||
    jsonObjectAfter(html, "ytInitialData=");
  const params = transcriptParams(player) || transcriptParams(initial);
  const apiKey = stringAfter(html, 'INNERTUBE_API_KEY":"');
  const context =
    jsonObjectAfter(html, 'INNERTUBE_CONTEXT":') ||
    jsonObjectAfter(html, "INNERTUBE_CONTEXT =");
  if (!params || !apiKey || !context) return [];
  try {
    const response = await fetch(
      `https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (compatible; Folio/1.0)",
        },
        body: JSON.stringify({ context, params }),
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) return [];
    return parseYouTubeTranscriptResponse(await response.json());
  } catch {
    return [];
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

export function parseYouTubeCaptionXml(xml: string): Segment[] {
  const segments: Segment[] = [];
  const entries = xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi);
  for (const [, attributes, rawText] of entries) {
    const startMatch = attributes.match(/\bstart="([^"]+)"/i);
    const durationMatch = attributes.match(/\bdur="([^"]+)"/i);
    const text = decodeXml(rawText);
    if (!text) continue;
    const start = startMatch ? Number(startMatch[1]) : NaN;
    const duration = durationMatch ? Number(durationMatch[1]) : NaN;
    segments.push({
      id: `yt-${segments.length + 1}`,
      start: Number.isFinite(start) ? start : null,
      end: Number.isFinite(start) && Number.isFinite(duration) ? start + duration : null,
      speaker: "Speaker",
      text,
    });
  }
  return segments;
}

export function parseYouTubeCaptionJson(json: string): Segment[] {
  try {
    const data = JSON.parse(json) as {
      events?: {
        tStartMs?: number;
        dDurationMs?: number;
        segs?: { utf8?: string }[];
      }[];
    };
    const segments: Segment[] = [];
    for (const event of data.events || []) {
      const text = (event.segs || [])
        .map((segment) => segment.utf8 || "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;
      const start = Number(event.tStartMs) / 1000;
      const duration = Number(event.dDurationMs) / 1000;
      segments.push({
        id: `yt-${segments.length + 1}`,
        start: Number.isFinite(start) ? start : null,
        end:
          Number.isFinite(start) && Number.isFinite(duration)
            ? start + duration
            : null,
        speaker: "Speaker",
        text,
      });
    }
    return segments;
  } catch {
    return [];
  }
}

type CaptionTrack = {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
};

function chooseCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  return [...tracks]
    .filter((track) => track.baseUrl)
    .sort((a, b) => {
      const score = (track: CaptionTrack) => {
        const language = track.languageCode?.toLowerCase() || "";
        return (track.kind === "asr" ? 0 : 4) +
          (language === "en" ? 3 : language.startsWith("en-") ? 2 : 0);
      };
      return score(b) - score(a);
    })[0] || null;
}

export async function fetchYouTubeTranscript(value: string): Promise<{
  videoId: string;
  title: string | null;
  duration: number;
  segments: Segment[];
}> {
  const videoId = parseYouTubeVideoId(value);
  if (!videoId)
    throw new YouTubeTranscriptError(
      "Paste a valid YouTube watch, Shorts, live, embed, or youtu.be link.",
    );

  let response: Response;
  try {
    response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 (compatible; Folio/1.0)",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new YouTubeTranscriptError(
      "YouTube could not be reached right now. Check the link and try again.",
    );
  }
  if (!response.ok)
    throw new YouTubeTranscriptError(
      "YouTube could not provide this video. It may be private, age-restricted, or unavailable in this region.",
    );

  const html = await response.text();
  const player =
    jsonObjectAfter(html, "ytInitialPlayerResponse =") ||
    jsonObjectAfter(html, "ytInitialPlayerResponse=");
  const videoDetails = (player?.videoDetails || {}) as {
    title?: string;
    lengthSeconds?: string;
  };
  const transcriptSegments = await fetchYouTubeTranscriptEndpoint(html, player || {});
  if (transcriptSegments.length)
    return {
      videoId,
      title: videoDetails.title || null,
      duration: Math.max(
        Number(videoDetails.lengthSeconds) || 0,
        transcriptSegments.at(-1)?.end || 0,
      ),
      segments: transcriptSegments,
    };
  const renderer = (player?.captions as { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } } | undefined)
    ?.playerCaptionsTracklistRenderer;
  const tracks = renderer?.captionTracks || [];
  const track = chooseCaptionTrack(tracks);
  if (!track?.baseUrl)
    throw new YouTubeTranscriptError(
      "This YouTube video does not have captions available. Turn on captions for the video or paste a transcript instead.",
    );

  let captionResponse: Response;
  try {
    const captionUrl = new URL(track.baseUrl);
    captionUrl.searchParams.set("fmt", "json3");
    captionResponse = await fetch(captionUrl, {
      headers: { accept: "text/xml,application/xml" },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new YouTubeTranscriptError(
      "YouTube captions could not be downloaded. Please try again or paste a transcript.",
    );
  }
  if (!captionResponse.ok)
    throw new YouTubeTranscriptError(
      "YouTube captions could not be downloaded. Please try again or paste a transcript.",
    );

  const captionBody = await captionResponse.text();
  const segments =
    parseYouTubeCaptionJson(captionBody).length > 0
      ? parseYouTubeCaptionJson(captionBody)
      : parseYouTubeCaptionXml(captionBody);
  if (!segments.length)
    throw new YouTubeTranscriptError(
      "YouTube shows captions for this video in the browser, but is not returning the caption text to Folio's server. Paste the transcript or configure a YouTube-compatible resolver instead.",
    );
  const lastEnd = segments.at(-1)?.end || 0;
  return {
    videoId,
    title: videoDetails.title || null,
    duration: Math.max(Number(videoDetails.lengthSeconds) || 0, lastEnd),
    segments,
  };
}
