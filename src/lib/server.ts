import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Meeting } from "./domain";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function adminDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new ApiError(
      503,
      "Connect Supabase in the deployment environment to use a live workspace.",
    );
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function authenticated(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!token) throw new ApiError(401, "Sign in to your workspace to continue.");
  const db = adminDatabase();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user)
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  return { db, user: data.user };
}
export function apiError(error: unknown) {
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: error.issues[0]?.message || "Invalid input." },
      { status: 400 },
    );
  if (error instanceof ApiError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof SyntaxError)
    return NextResponse.json(
      { error: "The request must contain valid JSON." },
      { status: 400 },
    );
  console.error(
    "Request failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  return NextResponse.json(
    { error: "We couldn't complete that request. Please try again." },
    { status: 500 },
  );
}
export async function jsonBody(request: Request, maxBytes = 1000000) {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes)
    throw new ApiError(413, "This request is too large.");
  return JSON.parse(text);
}
export async function ownedMeeting(request: Request, id: string) {
  const { db, user } = await authenticated(request);
  const { data, error } = await db
    .from("meetings")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "This meeting could not be found.");
  return { db, user, meeting: data.data as Meeting };
}
export function requireProcessing(recording = false) {
  if (
    !process.env.GROQ_API_KEY ||
    (!process.env.INNGEST_EVENT_KEY && process.env.INNGEST_DEV !== "1")
  )
    throw new ApiError(
      503,
      "AI processing isn't connected yet. Add Groq and Inngest credentials in your deployment settings.",
    );
  if (recording && !process.env.ASSEMBLYAI_API_KEY)
    throw new ApiError(
      503,
      "Recording transcription isn't connected yet. Add an AssemblyAI API key, or paste a transcript instead.",
    );
}
export async function rateLimit(userId: string, bucket: string, limit: number) {
  const { data, error } = await adminDatabase().rpc("consume_request", {
    p_user: userId,
    p_bucket: bucket,
    p_limit: limit,
  });
  if (error) throw error;
  if (!data)
    throw new ApiError(
      429,
      "You've reached the hourly limit for this action. Please try again later.",
    );
}
