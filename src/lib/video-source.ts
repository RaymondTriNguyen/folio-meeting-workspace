import { z } from "zod";
import type { Segment, VideoProvider } from "./domain";
import {
  fetchYouTubeTranscript,
  YouTubeTranscriptError,
} from "./youtube";

export class VideoSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoSourceError";
  }
}

export function detectVideoProvider(value: string): VideoProvider {
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol)) return "other";
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
        "www.youtu.be",
      ].includes(host)
    )
      return "youtube";
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
    if (host === "instagram.com" || host.endsWith(".instagram.com"))
      return "instagram";
    if (host === "vimeo.com" || host.endsWith(".vimeo.com")) return "vimeo";
    if (
      host === "x.com" ||
      host.endsWith(".x.com") ||
      host === "twitter.com" ||
      host.endsWith(".twitter.com")
    )
      return "x";
    if (/\.(mp4|mov|mkv|webm|mp3|m4a|wav|ogg|flac)$/i.test(path))
      return "direct";
  } catch {
    return "other";
  }
  return "other";
}

export function videoProviderLabel(provider: VideoProvider): string {
  return {
    youtube: "YouTube",
    tiktok: "TikTok",
    instagram: "Instagram",
    vimeo: "Vimeo",
    x: "X",
    direct: "direct media",
    other: "this video site",
  }[provider];
}

const resolverResponseSchema = z.object({
  mediaUrl: z.string().url(),
  title: z.string().trim().max(250).nullable().optional(),
  duration: z.number().nonnegative().max(7200).optional(),
});

export type PreparedVideoSource = {
  provider: VideoProvider;
  title: string | null;
  duration: number;
  segments: Segment[] | null;
  mediaUrl: string | null;
};

async function resolveWithConfiguredAdapter(
  url: string,
  provider: VideoProvider,
): Promise<PreparedVideoSource> {
  const endpoint = process.env.VIDEO_LINK_RESOLVER_URL;
  if (!endpoint)
    throw new VideoSourceError(
      `${videoProviderLabel(provider)} links need a video-link resolver in the deployment settings. Upload the video file or paste a transcript instead.`,
    );
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(process.env.VIDEO_LINK_RESOLVER_KEY
          ? { authorization: `Bearer ${process.env.VIDEO_LINK_RESOLVER_KEY}` }
          : {}),
      },
      body: JSON.stringify({ url, provider }),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new VideoSourceError(
      "The video-link resolver could not be reached. Try again or upload the video file instead.",
    );
  }
  if (!response.ok)
    throw new VideoSourceError(
      "The video-link resolver could not access that video. Check that it is publicly available and try again.",
    );
  const parsed = resolverResponseSchema.safeParse(await response.json());
  if (!parsed.success)
    throw new VideoSourceError(
      "The video-link resolver returned an invalid media URL. Upload the video file instead.",
    );
  const mediaUrl = new URL(parsed.data.mediaUrl);
  if (!/^https?:$/.test(mediaUrl.protocol))
    throw new VideoSourceError("The resolved video URL must use HTTPS or HTTP.");
  return {
    provider,
    title: parsed.data.title || null,
    duration: parsed.data.duration || 0,
    segments: null,
    mediaUrl: mediaUrl.toString(),
  };
}

export async function fetchVideoSource(value: string): Promise<PreparedVideoSource> {
  const url = value.trim();
  const provider = detectVideoProvider(url);
  if (provider === "youtube") {
    try {
      const result = await fetchYouTubeTranscript(url);
      return {
        provider,
        title: result.title,
        duration: result.duration,
        segments: result.segments,
        mediaUrl: null,
      };
    } catch (error) {
      if (!process.env.VIDEO_LINK_RESOLVER_URL) throw error;
      if (!(error instanceof YouTubeTranscriptError)) throw error;
    }
  }
  if (provider === "direct")
    return {
      provider,
      title: null,
      duration: 0,
      segments: null,
      mediaUrl: url,
    };
  return resolveWithConfiguredAdapter(url, provider);
}
