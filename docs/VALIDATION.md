# Migration validation

Validated locally on September 25, 2026.

## Passed

- Next.js production build, including all authenticated API and background-job routes.
- TypeScript checks and ESLint.
- 18 automated tests covering consent, exclusive input sources, source timing, bounded transcript chunking, quote verification, duplicate findings, independent AI-verifier verdict handling with a stubbed provider, keyword retrieval, byte-bounded pagination, and document generation.
- PDF generation and pagination with long text and unbroken strings; DOCX generation as a real Word ZIP package; Unicode preservation in Markdown.
- Desktop and 390-pixel mobile visual inspection, mobile menu navigation, and no horizontal page overflow in the meeting view.
- Browser meeting search, transcript search, finding edit/save, task completion surviving reload, and sample transcript Q&A with source passages.
- The saved-demo hydration mismatch found during testing was corrected; a subsequent reload reported no browser errors.
- Demo transcript submission displays a clear sign-in/configuration message instead of pretending to process a personal meeting.
- Private library endpoint returns HTTP 401 without a session. Configuration endpoint reports disconnected services without revealing credentials.

## Not verified with live services

No Supabase, Groq, AssemblyAI, or Inngest credentials were present. Live registration, SQL migration execution, persistent multi-account isolation, recording upload/playback, transcription, and the complete hosted job pipeline still require the connected smoke test in `DEPLOYMENT.md`. The independent verifier test uses a stubbed response and is not an accuracy benchmark.

Export generators passed automated tests. The embedded browser did not report a download event, so delivery into a user's download folder was not confirmed there. Check native-browser downloads during the connected smoke test.

No public deployment was performed. The original Streamlit prototype remains available independently.
