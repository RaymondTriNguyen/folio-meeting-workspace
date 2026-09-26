# Deploy Folio to Vercel

The application works in sample mode without external services. Live processing requires your own service accounts and credentials. No accounts or public deployments are created automatically.

## Supabase

1. Create a project and run `supabase/migrations/001_workspace.sql` in its SQL editor. This creates meetings, owner-only read policies, private recording storage, and server-only request throttling.
2. Enable Email/Password authentication. Keep email confirmation enabled for public deployments. Set the production Site URL and permitted local/preview redirect URLs.
3. Retrieve the project URL, public anon key, and secret service-role key. Never expose the service-role key with a `NEXT_PUBLIC_` prefix.
4. Configure the project storage limit to support 100 MB uploads. If your plan permits less, lower `MAX_UPLOAD_BYTES`, the SQL bucket limit, and the UI wording together.

This release provides personal workspaces. Browser reads are restricted by row-level security. Validated server routes check ownership before any mutation or provider operation.

## AI providers

- Set a Groq key and verify access to the configured model. The default `GROQ_MODEL` is `llama-3.3-70b-versatile`; JSON mode is required.
- Set an AssemblyAI key for recordings. The pipeline uses asynchronous transcription, speaker labels, and the `universal-3-pro` / `universal-2` model fallback.

Recordings are shared with AssemblyAI through expiring signed URLs. Transcript excerpts and context are sent to Groq. Review provider retention settings for your requirements. App deletion removes the meeting and recording from Supabase, but does not delete provider logs or Inngest run history.

## Inngest

1. Create an app/environment and retrieve its event and signing keys.
2. Add both keys to Vercel.
3. After deployment, sync `https://YOUR_DOMAIN/api/inngest`, or use the official Vercel integration.
4. Ensure Vercel deployment protection permits Inngest requests, especially for preview deployments.

Polling waits use durable `step.sleep` calls and do not hold open a Vercel request. Each external request runs in a durable step with two retries. Stages are persisted to PostgreSQL. Inspect failures in the Inngest dashboard. A user-triggered retry reuses an available transcript but may repeat extraction calls.

For local live processing, set `INNGEST_DEV=1` only in `.env.local`, run `npm run dev`, and run `npx inngest-cli@latest dev` in another terminal. The local Inngest server should discover `http://localhost:3000/api/inngest`.

## Vercel

Import the repository, choose **Next.js**, set the root directory to this project, and use Node.js **22.x**, install command `npm ci`, and build command `npm run build`. Do not use static export; API routes require server functions. Python is not part of the deployment runtime.

| Environment variable | Purpose | Public |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public auth client key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Owner-checked server data access | No |
| `GROQ_API_KEY` | Extraction, summaries, Q&A | No |
| `GROQ_MODEL` | Optional text model override | No |
| `ASSEMBLYAI_API_KEY` | Recording transcription | No |
| `INNGEST_EVENT_KEY` | Dispatch background events | No |
| `INNGEST_SIGNING_KEY` | Verify job requests | No |

Copy `.env.example` to `.env.local` for local development. Redeploy after changing public variables because Next.js embeds them at build time. Never commit real credentials.

## Connected smoke test

1. Register, confirm your email, and sign in. A live workspace begins empty.
2. Paste a consented transcript with one decision and one action. Check queued-to-ready progression and the Inngest run.
3. Edit a finding, sign out/in, and confirm persistence. Verify a second account cannot access that meeting.
4. Upload a small consented recording, check private storage, and seek playback using citations.
5. Ask a question and inspect the source citation. Export the reviewed notes.
6. Delete the meeting and verify removal of the row and recording object.

## Launch limits

- Recordings: 100 MB, two hours. Resumable 2 GB uploads are future work. Browser uploads go directly to private storage, bypassing Vercel's 4.5 MB payload limit.
- Transcripts: 180,000 characters. The launch language is English. PDF uses standard Latin fonts; DOCX and Markdown preserve Unicode source text.
- Q&A uses keyword retrieval, not vector search. Narrative summaries still need human review. No accuracy benchmark has been established.
- API limits per user/hour: 15 processing starts, 20 upload authorizations, 60 chat requests. Counters persist across server instances.
- A completed upload followed by failed meeting creation can leave an orphan storage object. Periodically remove objects without corresponding meeting rows after a grace period.
- The library currently loads the latest 200 meetings. Pagination and larger-scale transcript search are subsequent work.
- Playback links last one hour; reopen a meeting to refresh its link.
- Settings displays whether configuration exists, not whether provider credentials or billing are valid.
- Shared workspaces, billing, calendar integrations, OCR, public sharing, and live bots are not implemented.

## Official references

- Vercel limits: https://vercel.com/docs/functions/limitations
- Next.js: https://nextjs.org/docs/app/getting-started/deploying
- Supabase signed uploads: https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Inngest: https://www.inngest.com/docs/getting-started/nextjs-quick-start
- AssemblyAI: https://www.assemblyai.com/docs/api-reference/transcripts/submit
