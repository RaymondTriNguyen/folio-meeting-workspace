# Folio

A full-stack meeting intelligence workspace built with Next.js, React, and TypeScript. Designed for Vercel, with private storage and durable background processing.

## Run locally

Requires Node.js 22 or newer.

```powershell
npm ci
npm run dev
```

Open http://localhost:3000. Without credentials, Folio opens a labeled sample workspace. Explore summaries, evidence, transcript search, edits, speaker correction, project collections, task completion, and Markdown/Word/PDF exports. Demo edits stay in this browser; no paid AI calls occur.

### Test your own videos locally

To test a real video without creating a Supabase account, copy `.env.example` to `.env.local`, set `FOLIO_LOCAL_TEST_MODE=1`, `GROQ_API_KEY`, and `OPENAI_API_KEY`, then restart the dev server. The **New video analysis** dialog will allow local uploads, pasted transcripts, and supported public links. YouTube links with captions can run without OpenAI transcription; uploaded files, direct media links, and resolver-backed social links use OpenAI. Results are saved in this browser and are not added to a shared database.

Keep `FOLIO_LOCAL_TEST_MODE=0` for any hosted or production deployment. This development route intentionally has no account boundary.

In a connected workspace, signed-in users can add Groq and OpenAI keys from **Settings**. Run both Supabase migrations and set a stable `FOLIO_CREDENTIALS_ENCRYPTION_KEY`; Folio encrypts each user key before storage and never returns the plaintext value to the browser.

## Connect the full stack

Follow [the deployment guide](docs/DEPLOYMENT.md). Copy `.env.example` to `.env.local`, configure Supabase Auth/PostgreSQL/Storage, Groq, OpenAI, and Inngest, and apply the SQL migration.

Uploaded videos go directly to private storage. Inngest resolves video links, runs transcription, chunked extraction, evidence verification, and summary composition in durable steps. Private APIs validate sessions and ownership on the server. Provider credentials never reach the browser.

## Included

- Responsive dashboard, meeting library, project collections, search, review inbox, and action tracking.
- Editable summaries and findings, speaker correction, timestamp citations, and source-link playback.
- Email/password authentication, persistent per-user video analyses, and source deletion.
- Transcript ingestion, video-page links, direct media URLs, or audio/video upload, consent gate, processing stages, failures, and retries.
- Structured Groq extraction, verbatim source verification, and cited Q&A.
- Markdown, DOCX, and paginated PDF exports.
- Vercel-ready routes, environment template, SQL migration, and deployment instructions.

## Launch limits

Live processing requires service accounts and API credentials. Uploaded videos are capped at 25 MB and two hours because of the OpenAI transcription file limit; transcripts are capped at 180,000 characters. YouTube captions work without a resolver; TikTok, Instagram, Vimeo, X, and other page links need a configured video-link resolver. Resumable larger uploads are future work. Storage limits must also match your Supabase plan.

Q&A uses keyword retrieval, not a vector index. Summaries still need human review. The launch language is English; PDF uses standard Latin fonts, while DOCX and Markdown preserve Unicode text.

This is a personal workspace. Calendar integrations, shared workspaces, public links, billing, OCR, and live bots are not included. See the [migration PRD](docs/PRD_Full_Stack_Migration.md) for scope and acceptance criteria.

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

## Python prototype

The original app remains in `app.py` and `requirements.txt`. It runs independently with `streamlit run app.py` and is not part of the Vercel runtime.
