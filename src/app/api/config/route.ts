import { NextResponse } from "next/server";
export function GET() {
  return NextResponse.json({
    database: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    ai: Boolean(process.env.GROQ_API_KEY),
    transcription: Boolean(process.env.OPENAI_API_KEY),
    jobs: Boolean(
      process.env.INNGEST_EVENT_KEY || process.env.INNGEST_DEV === "1",
    ),
    directProcessing: true,
    videoLinks: Boolean(process.env.VIDEO_LINK_RESOLVER_URL),
    localTest: process.env.NODE_ENV !== "production" &&
      process.env.FOLIO_LOCAL_TEST_MODE === "1" &&
      Boolean(process.env.GROQ_API_KEY),
  });
}
