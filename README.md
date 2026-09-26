# Folio

A full-stack meeting intelligence workspace built with Next.js, React, and TypeScript. Designed for Vercel, with private storage and durable background processing.

## Run locally

Requires Node.js 22 or newer.

```powershell
npm ci
npm run dev
```

Open http://localhost:3000. Without credentials, Folio opens a labeled sample workspace. Explore summaries, evidence, transcript search, edits, speaker correction, project collections, task completion, and Markdown/Word/PDF exports. Demo edits stay in this browser; no paid AI calls occur.

## Connect the full stack

Follow [the deployment guide](docs/DEPLOYMENT.md). Copy `.env.example` to `.env.local`, configure Supabase Auth/PostgreSQL/Storage, Groq, AssemblyAI, and Inngest, and apply the SQL migration.

Recordings upload directly to private storage. Inngest runs transcription, chunked extraction, evidence verification, and summary composition in durable steps. Private APIs validate sessions and meeting ownership on the server. Provider credentials never reach the browser.

## Included

- Responsive dashboard, meeting library, project collections, search, review inbox, and action tracking.
- Editable summaries and findings, speaker correction, timestamp citations, and private recording playback.
- Email/password authentication, persistent per-user meetings, and meeting/recording deletion.
- Transcript ingestion or audio/video upload, consent gate, processing stages, failures, and retries.
- Structured Groq extraction, verbatim source verification, and cited Q&A.
- Markdown, DOCX, and paginated PDF exports.
- Vercel-ready routes, environment template, SQL migration, and deployment instructions.

## Launch limits

Live processing requires service accounts and API credentials. Recordings are capped at 100 MB and two hours; transcripts at 180,000 characters. Resumable 2 GB uploads are future work. Storage limits must also match your Supabase plan.

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
