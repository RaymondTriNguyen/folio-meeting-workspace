import { NextResponse } from "next/server";
export function GET() {
  return NextResponse.json({
    database: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    ai: Boolean(process.env.GROQ_API_KEY),
    transcription: Boolean(process.env.ASSEMBLYAI_API_KEY),
    jobs: Boolean(
      process.env.INNGEST_EVENT_KEY || process.env.INNGEST_DEV === "1",
    ),
  });
}
