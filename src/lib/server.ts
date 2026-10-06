import { createClient } from "@supabase/supabase-js";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Meeting } from "./domain";

export type ProviderKeys = {
  groqApiKey?: string;
  openaiApiKey?: string;
};

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

function credentialKey() {
  const secret = process.env.FOLIO_CREDENTIALS_ENCRYPTION_KEY;
  if (!secret)
    throw new ApiError(
      503,
      "Secure provider credentials are not connected yet. Add FOLIO_CREDENTIALS_ENCRYPTION_KEY in the deployment settings.",
    );
  return createHash("sha256").update(secret).digest();
}

function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

function decryptSecret(value: string) {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue)
    throw new ApiError(503, "A saved provider credential could not be read.");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      credentialKey(),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new ApiError(
      503,
      "A saved provider credential could not be decrypted. Check FOLIO_CREDENTIALS_ENCRYPTION_KEY.",
    );
  }
}

type CredentialRow = {
  groq_api_key: string | null;
  openai_api_key: string | null;
};

async function credentialRow(userId: string) {
  const { data, error } = await adminDatabase()
    .from("provider_credentials")
    .select("groq_api_key, openai_api_key")
    .eq("user_id", userId)
    .maybeSingle();
  if (error)
    throw new ApiError(
      503,
      "Secure provider credentials are not connected yet. Apply the latest Supabase migration first.",
    );
  return data as CredentialRow | null;
}

export async function providerCredentialStatus(userId: string) {
  const row = await credentialRow(userId);
  return {
    groq: Boolean(row?.groq_api_key),
    openai: Boolean(row?.openai_api_key),
    serverGroq: Boolean(process.env.GROQ_API_KEY),
    serverOpenAI: Boolean(process.env.OPENAI_API_KEY),
  };
}

export async function getProviderKeys(userId: string): Promise<ProviderKeys> {
  const row = await credentialRow(userId);
  return {
    groqApiKey: row?.groq_api_key
      ? decryptSecret(row.groq_api_key)
      : process.env.GROQ_API_KEY || undefined,
    openaiApiKey: row?.openai_api_key
      ? decryptSecret(row.openai_api_key)
      : process.env.OPENAI_API_KEY || undefined,
  };
}

export async function saveProviderKeys(
  userId: string,
  input: { groqApiKey?: string; openaiApiKey?: string },
) {
  const current = await credentialRow(userId);
  const row = {
    user_id: userId,
    groq_api_key:
      input.groqApiKey === undefined
        ? current?.groq_api_key || null
        : encryptSecret(input.groqApiKey),
    openai_api_key:
      input.openaiApiKey === undefined
        ? current?.openai_api_key || null
        : encryptSecret(input.openaiApiKey),
    updated_at: new Date().toISOString(),
  };
  const { error } = await adminDatabase()
    .from("provider_credentials")
    .upsert(row, { onConflict: "user_id" });
  if (error) throw error;
}

export async function deleteProviderKey(
  userId: string,
  provider: "groq" | "openai",
) {
  const column = provider === "groq" ? "groq_api_key" : "openai_api_key";
  const { error } = await adminDatabase()
    .from("provider_credentials")
    .update({ [column]: null, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw error;
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
export async function requireProcessing(userId: string, recording = false) {
  if (!process.env.INNGEST_EVENT_KEY && process.env.INNGEST_DEV !== "1")
    throw new ApiError(
      503,
      "Background processing isn't connected yet. Add your Inngest credentials in the deployment settings.",
    );
  const keys = await getProviderKeys(userId);
  if (!keys.groqApiKey)
    throw new ApiError(
      503,
      "Add a Groq API key in Settings before starting an analysis.",
    );
  if (recording && !keys.openaiApiKey)
    throw new ApiError(
      503,
      "Add an OpenAI API key in Settings for recordings and video links, or paste a transcript instead.",
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
