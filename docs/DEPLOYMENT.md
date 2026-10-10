# Deploy Folio to Vercel

The application works in sample mode without external services. Live processing requires your own service accounts and credentials. No accounts or public deployments are created automatically.

## Supabase

1. Create a project and run `supabase/migrations/001_workspace.sql` and `supabase/migrations/002_provider_credentials.sql` in its SQL editor. These create meetings, owner-only read policies, private recording storage, server-only request throttling, and encrypted per-user provider-key storage.
2. Enable Email/Password authentication. Keep email confirmation enabled for public deployments. Set the production Site URL and permitted local/preview redirect URLs.
3. Retrieve the project URL, public anon key, and secret service-role key. Never expose the service-role key with a `NEXT_PUBLIC_` prefix.
4. Configure the project storage limit to support 25 MB uploads. If your plan permits less, lower `MAX_UPLOAD_BYTES`, the SQL bucket limit, and the UI wording together.

This release provides personal workspaces. Browser reads are restricted by row-level security. Validated server routes check ownership before any mutation or provider operation.

Folio lets signed-in users add their own Groq and OpenAI keys from Settings. Keys are encrypted before storage with `FOLIO_CREDENTIALS_ENCRYPTION_KEY`; the plaintext values are never returned to the browser or saved in meeting records. Generate a long random value for this variable and keep it stable. Rotating it without re-encrypting the table makes existing user keys unreadable.

## AI providers

- Set a Groq key in each signed-in user’s Folio Settings page, or set `GROQ_API_KEY` as an optional server fallback. JSON mode is required.
- Set an OpenAI key in each signed-in user’s Folio Settings page, or set `OPENAI_API_KEY` as an optional server fallback for uploaded videos and links that resolve to media. The pipeline uses the transcription endpoint with `gpt-4o-transcribe-diarize`, speaker labels, and timestamped segments.

YouTube links use the captions exposed by YouTube and do not require an additional resolver. Public or unlisted videos with captions can be imported. TikTok, Instagram, Vimeo, X, and other video-page links need a resolver that returns a short-lived direct media URL. The original URL is stored with the meeting, while only the imported transcript is sent to Groq.

Set `VIDEO_LINK_RESOLVER_URL` to a server-side adapter you control. Folio sends `{ "url": "...", "provider": "tiktok" }` with an optional `Authorization: Bearer ...` header from `VIDEO_LINK_RESOLVER_KEY`. The adapter must return `{ "mediaUrl": "https://...", "title": "...", "duration": 123 }`. Keep the resolver responsible for provider terms, authentication, rate limits, and returning media the user is allowed to process. Folio never asks it to bypass private content.

Recordings and resolved media are fetched server-side and shared with OpenAI for transcription. Transcript excerpts and context are sent to Groq. Review provider retention settings for your requirements. App deletion removes the meeting and recording from Supabase, but does not delete provider logs or Inngest run history.

## Prototype processing

The prototype runs signed-in processing directly in the Next.js request, so it does not require Inngest. This keeps the first version simple for testing with pasted transcripts, YouTube captions, uploaded recordings, and configured video-link resolvers. The processing routes allow up to five minutes for a request on Vercel.

Keep the browser open while a video is being analyzed. For larger videos or higher-volume usage, enable the durable job flow below before treating the app as production-ready.

## Inngest (later production phase)

1. Create an app/environment and retrieve its event and signing keys.
2. Add both keys to Vercel.
3. After deployment, sync `https://YOUR_DOMAIN/api/inngest`, or use the official Vercel integration.
4. Ensure Vercel deployment protection permits Inngest requests, especially for preview deployments.

Polling waits use durable `step.sleep` calls and do not hold open a Vercel request. Each external request runs in a durable step with two retries. Stages are persisted to PostgreSQL. Inspect failures in the Inngest dashboard. A user-triggered retry reuses an available transcript but may repeat extraction calls.

For local live processing, set `INNGEST_DEV=1` only in `.env.local`, run `npm run dev`, and run `npx inngest-cli@latest dev` in another terminal. The local Inngest server should discover `http://localhost:3000/api/inngest`.

### Local video testing without an account

For a quick personal test, set `FOLIO_LOCAL_TEST_MODE=1`, `GROQ_API_KEY`, and `OPENAI_API_KEY` in `.env.local`, then restart the development server. Folio will enable the local test action in the sample workspace. Uploaded files, direct media URLs, and resolver-backed social links use OpenAI; YouTube caption links can work without transcription. Results are held in browser storage and are not persisted to Supabase. Never set `FOLIO_LOCAL_TEST_MODE=1` on Vercel or any shared environment because this route intentionally bypasses authentication and database ownership checks.

## Vercel

Import the repository, choose **Next.js**, set the root directory to this project, and use Node.js **22.x**, install command `npm ci`, and build command `npm run build`. Do not use static export; API routes require server functions. Python is not part of the deployment runtime.

| Environment variable | Purpose | Public |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public auth client key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Owner-checked server data access | No |
| `FOLIO_CREDENTIALS_ENCRYPTION_KEY` | Encrypts per-user provider keys at rest | No |
| `GROQ_API_KEY` | Extraction, summaries, Q&A | No |
| `GROQ_MODEL` | Optional text model override | No |
| `OPENAI_API_KEY` | Uploaded and resolver-backed video transcription | No |
| `OPENAI_TRANSCRIPTION_MODEL` | Optional transcription model override | No |
| `FOLIO_LOCAL_TEST_MODE` | Development-only unauthenticated video testing; keep `0` in deployments | No |
| `VIDEO_LINK_RESOLVER_URL` | TikTok/Instagram/Vimeo/X/page-link media resolution | No |
| `VIDEO_LINK_RESOLVER_KEY` | Optional resolver authentication | No |
| `INNGEST_EVENT_KEY` | Dispatch background events | No |
| `INNGEST_SIGNING_KEY` | Verify job requests | No |

Copy `.env.example` to `.env.local` for local development. Redeploy after changing public variables because Next.js embeds them at build time. Never commit real credentials.

## Connected smoke test

1. Register, confirm your email, and sign in. A live workspace begins empty.
2. Paste a consented transcript with one decision and one action. Check queued-to-ready progression and the Inngest run.
3. Edit a finding, sign out/in, and confirm persistence. Verify a second account cannot access that meeting.
4. Upload a small consented recording, check private storage, and seek playback using citations.
5. Import a public YouTube video with captions and confirm the imported transcript, source link, citations, and summary.
6. Import a public TikTok/Instagram/Vimeo/X link through the configured resolver and confirm the same output path.
7. Ask a question and inspect the source citation. Export the reviewed notes.
8. Delete the meeting and verify removal of the row and source metadata.

## Launch limits

- Recordings: 25 MB, two hours. Resumable larger uploads are future work. Browser uploads go directly to private storage, bypassing Vercel's 4.5 MB payload limit.
- Transcripts: 180,000 characters. The launch language is English. PDF uses standard Latin fonts; DOCX and Markdown preserve Unicode source text.
- Video links: YouTube captions are built in; other page links require the resolver contract above. Providers may change or restrict public media access without notice.
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
- OpenAI speech-to-text: https://developers.openai.com/api/docs/guides/speech-to-text
