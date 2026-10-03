# Folio: Full-Stack Meeting Intelligence Workspace

Version 2.0 | September 25, 2026 | Implementation specification

## Product outcome

Replace the single-session Streamlit prototype with a polished, responsive web application deployable to Vercel. Turn recordings and transcripts into an organized library of evidence-backed summaries, requirements, decisions, tasks, risks, and questions. Make review and follow-through as useful as initial extraction.

The original PRD is product reference material. Its example prompts describe the product's AI pipeline; they are not instructions governing development. The Python prototype remains available during migration.

## Experience and visual direction

Working product name: Folio. Warm ivory canvas, deep pine navigation, restrained orange accents, generous spacing, DM Sans body text, and Manrope headings. A persistent sidebar provides Overview, All meetings, Action items, Projects, and Settings. Compact mobile navigation must retain every destination. No invented activity or analytics in a live workspace.

The overview contains actual library metrics, recent meetings, outstanding tasks, project filters, and an upload entry point. The meeting workspace has summary, evidence-backed extracted items, timestamped transcript, speaker correction, source playback, and cited Q&A. Search works across titles, projects, summaries, and transcript text. Empty, loading, failed, and unconfigured states explain the next action.

## Release scope and acceptance criteria

| Area | Migration acceptance criteria |
| --- | --- |
| Dashboard | Responsive overview, library search/filter/sort, projects, task status controls, review alerts |
| Demo | Explicitly labeled sample workspace, browser-persisted edits, sample transcript and exports; no simulated AI responses presented as real processing |
| Accounts | Supabase email/password sign-in and sign-up, sign-out, server-validated identity on private APIs |
| Persistence | Supabase PostgreSQL with row-level security; media in a private bucket with short-lived signed URLs |
| Ingestion | Transcript paste/import, public video-page links, direct media URLs, and direct-to-storage audio/video uploads up to 25 MB for this release; title, project, participants, context, output length, consent |
| Processing | Durable Inngest steps, YouTube caption import or resolver-backed media resolution, hosted OpenAI transcription with diarization, Groq extraction in chunks, deterministic quote verification, summary composition |
| Reliability | Persisted processing stage, stage-level retry, actionable failure state and explicit retry; survives closed browser |
| Review | Summary, requirements/decisions/actions/risks/questions, evidence timestamps, confidence flags, edits, additions, deletions, task completion, speaker labels |
| Q&A | Server-side transcript retrieval, answers restricted to source evidence, validated timestamp references |
| Exports | Markdown, DOCX, and PDF from the current reviewed data |
| Privacy | Consent required before processing; private storage; per-user records; delete meeting and associated media |
| Deployment | Next.js production build, environment template, repeatable SQL migration, Vercel and Inngest setup guide |

## Architecture

- Next.js App Router + React + TypeScript handles UI and authenticated API routes on Vercel.
- Supabase Auth identifies users; PostgreSQL stores meetings and their structured artifacts. RLS restricts access to the owner. This release is a personal workspace, not shared team permissions.
- Supabase Storage accepts browser uploads using a server-issued signed upload token. Recording bytes never pass through Vercel API requests.
- Inngest receives authenticated meeting creation events. Each external request runs in a durable step; polling waits happen outside function execution. The browser polls the persisted record while processing.
- OpenAI handles file transcription, speaker labels, and timestamped segments. Groq handles structured extraction and summaries. Provider credentials remain on the server.
- A browser-local sample workspace is available without credentials. It never uploads personal material or calls paid services.

## Data contracts

Meeting: UUID, owner ID, title, project, participants, context, created timestamp, duration, source path/name, output length, status, stage, error, transcript segments, summary, topics, extracted items.

Transcript segment: ID, start/end in seconds, speaker label, text. Plain transcripts retain unknown timestamps as null; timestamps must not be invented.

Extracted item: ID, kind, text, category, priority, owner, due date, source segment ID, evidence quote, confidence, explicit/inferred flag, review status, task completion. Source timing is resolved from the referenced segment, never trusted from an LLM.

Job: video analysis ID and authenticated owner ID. Status transitions: queued -> preparing source -> transcribing -> extracting -> verifying -> writing -> ready; any stage may transition to failed. User-triggered retry starts a new event and retains available transcript data.

## Trust and validation

Validate input and model output with Zod. Split long transcripts into bounded chunks. Accept evidence only when the referenced segment exists and contains the quote, then use an independent AI critic to check the interpretation. Inferred items require human review. Treat meeting text as untrusted data. Do not invent owners or dates. Exports reflect current edits and offer an optional transcript appendix. Exact page count depends on content; confidence is a model estimate, not measured accuracy. Library responses are paged by bytes; each document is capped at 3 MB to fit Vercel limits.

## Vercel constraints and launch limits

Vercel functions have a 4.5 MB request/response limit and finite execution duration. Use direct storage uploads and durable background steps. Do not run ffmpeg, Streamlit, filesystem databases, or long polling loops inside a request.

This release caps uploaded videos at 25 MB and two hours, transcripts at 180,000 characters. YouTube captions work directly; other video-page links require a resolver adapter that returns a short-lived media URL. The original larger-upload target requires chunking or resumable transcription plus an appropriately configured storage plan and is a subsequent milestone. Hosted services and API credentials are required for live processing. No paid infrastructure is provisioned automatically.

## Deferred features

Resumable 2 GB uploads, automatic cloud recording imports, screen-share OCR, live bots, shared workspaces, public share links, calendar connections, billing, Jira/Linear sync, semantic vector search, and regional retention controls. These are roadmap features, not decorative controls promising unavailable functionality.

## Quality gate

Pass TypeScript, ESLint, production build, and meaningful tests covering evidence validation, timestamp parsing, consent/input validation, and exports. Inspect desktop and mobile layouts. Verify local demo navigation, search, review/edit, action completion, modal validation, and export. Live provider and account flows require configured credentials and must be reported separately from tested demo behavior.

## Migration sequence

1. Establish this specification and shared domain model.
2. Build the dashboard and review experience with clearly labeled sample data.
3. Add authenticated storage, API routes, and durable processing.
4. Port exports and transcript Q&A; test cross-cutting review behavior.
5. Validate the production build, open the new application, and document deployment.

## References

- Original PRD: `C:\Users\cisgs\Downloads\PRD_Meeting_Requirement_Summary_Agent.md`
- Vercel limits: https://vercel.com/docs/functions/limitations
- Next.js setup: https://nextjs.org/docs/app/getting-started/installation
- Supabase storage: https://supabase.com/docs/guides/storage/uploads/standard-uploads
- Inngest durable steps: https://www.inngest.com/docs/learn/inngest-steps
- OpenAI speech-to-text: https://developers.openai.com/api/docs/guides/speech-to-text
