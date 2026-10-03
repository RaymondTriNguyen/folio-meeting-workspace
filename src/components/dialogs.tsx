"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  CircleHelp,
  CloudUpload,
  FileText,
  Headphones,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Play,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { browserDatabase } from "@/lib/supabase";
import {
  createMeetingSchema,
  MAX_UPLOAD_BYTES,
  mediaExtensions,
  type Meeting,
} from "@/lib/domain";
import { useWorkspace } from "./workspace-provider";

export function Modal({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-header">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function UploadDialog({
  onClose,
  onCreated,
  onSignIn,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  onSignIn: () => void;
}) {
  const { demo, config, api, add, refresh, toast } = useWorkspace();
  const [mode, setMode] = useState<
    "recording" | "transcript" | "video-link"
  >("recording");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [participants, setParticipants] = useState("");
  const [context, setContext] = useState("");
  const [transcript, setTranscript] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [length, setLength] = useState<"brief" | "standard" | "detailed">(
    "standard",
  );
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  function chooseFile(selected: File | undefined) {
    if (!selected) return;
    const ext = selected.name.split(".").pop()?.toLowerCase() || "";
    if (!mediaExtensions.includes(ext))
      return setError(
        "Choose an MP4, MOV, MKV, WebM, MP3, M4A, WAV, OGG, or FLAC recording.",
      );
    if (selected.size > MAX_UPLOAD_BYTES)
      return setError(
        "OpenAI transcription supports recordings up to 25 MB. You can also paste a transcript.",
      );
    setError("");
    setFile(selected);
    if (!title)
      setTitle(selected.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " "));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (demo && !config.localTest) {
      setError(
        "Sign in to a connected workspace to process your own videos. Sample videos are available to explore without an account.",
      );
      return;
    }
    if (!consent) {
      setError("Confirm participant consent before continuing.");
      return;
    }
    if (mode === "recording" && !file) {
      setError("Add a recording first.");
      return;
    }
    const fields = {
      title,
      project: project || "General",
      participants: participants
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      context,
      length,
      consent: true as const,
    };
    const validation = createMeetingSchema.safeParse({
      ...fields,
      ...(mode === "transcript"
        ? { transcript }
        : mode === "video-link"
          ? { videoUrl }
          : { sourcePath: "pending-upload" }),
    });
    if (!validation.success) {
      setError(validation.error.issues[0].message);
      return;
    }
    if (demo) {
      try {
        setBusy("Analyzing locally...");
        const body = new FormData();
        body.append("title", title);
        body.append("project", project || "General");
        body.append("participants", participants);
        body.append("context", context);
        body.append("length", length);
        body.append("consent", "true");
        if (mode === "recording" && file) body.append("file", file);
        if (mode === "transcript") body.append("transcript", transcript);
        if (mode === "video-link") body.append("videoUrl", videoUrl);
        const response = await fetch("/api/test-video", {
          method: "POST",
          body,
        });
        const result = (await response.json()) as {
          meeting?: Meeting;
          error?: string;
        };
        if (!response.ok || !result.meeting)
          throw new Error(result.error || "The local video test failed.");
        add(result.meeting);
        onCreated(result.meeting.id);
        toast("Video analyzed locally. It is saved in this browser.");
        return;
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "We couldn't analyze this video. Please try again.",
        );
      } finally {
        setBusy("");
      }
      return;
    }
    let sourcePath: string | undefined;
    try {
      if (mode === "recording" && file) {
        setBusy("Uploading your recording...");
        const upload = await api<{ path: string; token: string }>(
          "/api/uploads",
          {
            method: "POST",
            body: JSON.stringify({ name: file.name, size: file.size, consent }),
          },
        );
        const db = browserDatabase();
        if (!db) throw new Error("Storage is not connected.");
        const { error: uploadError } = await db.storage
          .from("recordings")
          .uploadToSignedUrl(upload.path, upload.token, file, {
            contentType: file.type || "application/octet-stream",
          });
        if (uploadError)
          throw new Error(
            "The recording could not be uploaded. Check your connection and storage configuration.",
          );
        sourcePath = upload.path;
      }
      setBusy("Starting your video analysis...");
      const result = await api<{ meeting: Meeting }>("/api/meetings", {
        method: "POST",
        body: JSON.stringify({
          ...fields,
          ...(mode === "transcript"
            ? { transcript }
            : mode === "video-link"
              ? { videoUrl }
              : { sourcePath, sourceName: file?.name }),
        }),
      });
      await refresh();
      onCreated(result.meeting.id);
      toast("Video added. You can leave this page while it processes.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn't start processing. Please try again.",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <Modal
      title="Make room for the important parts."
      eyebrow="NEW VIDEO ANALYSIS"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <p className="modal-intro">Bring a video. Leave with clarity.</p>
      <form onSubmit={submit}>
        <div className="segmented">
          <button
            type="button"
            className={mode === "recording" ? "selected" : ""}
            onClick={() => setMode("recording")}
          >
            <Headphones size={16} />
            Upload recording
          </button>
          <button
            type="button"
            className={mode === "transcript" ? "selected" : ""}
            onClick={() => setMode("transcript")}
          >
            <FileText size={16} />
            Paste transcript
          </button>
          <button
            type="button"
            className={mode === "video-link" ? "selected" : ""}
            onClick={() => setMode("video-link")}
          >
            <Link2 size={16} />
            Video link
          </button>
        </div>
        {mode === "recording" ? (
          <div
            className={`dropzone ${drag ? "dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              chooseFile(e.dataTransfer.files[0]);
            }}
          >
            <input
              ref={input}
              type="file"
              accept={mediaExtensions.map((e) => `.${e}`).join(",")}
              hidden
              onChange={(e) => chooseFile(e.target.files?.[0])}
            />
            <div className="upload-glyph">
              {file ? <Check size={26} /> : <CloudUpload size={27} />}
            </div>
            <strong>
              {file ? file.name : "Drop your recording right here"}
            </strong>
            <p>
              {file
                ? `${(file.size / 1024 / 1024).toFixed(1)} MB · Ready to upload`
                : "Audio or video, up to 25 MB and 2 hours"}
            </p>
            <button
              className="button small secondary"
              type="button"
              onClick={() => input.current?.click()}
            >
              {file ? "Choose a different file" : "Browse files"}
            </button>
          </div>
        ) : mode === "transcript" ? (
          <label className="field">
            Video transcript
            <textarea
              rows={7}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder={
                "[00:00] Olivia: Let's agree on the next steps.\n[02:15] Marcus: I will share the requirements by Friday."
              }
              required
              minLength={40}
              maxLength={180000}
            />
            <span className="field-note">
              Speaker labels and timestamps are optional. We preserve the timing
              you provide.
            </span>
          </label>
        ) : (
          <div className="youtube-source">
            <label className="field">
              Video page or direct video link
              <input
                type="url"
                inputMode="url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                required
              />
              <span className="field-note">
                Paste a YouTube, TikTok, Instagram, Vimeo, X, or direct video
                URL. Folio sends the resulting transcript through the same
                evidence-backed analyzer.
              </span>
            </label>
            <div className="inline-notice">
              <Link2 size={18} />
              <span>
                Public links work when captions or a configured video-link
                resolver are available. Private videos and blocked pages need a
                pasted transcript or uploaded file instead.
              </span>
            </div>
            <div className="inline-notice">
              <FileText size={18} />
              <span>
                Have the transcript open in YouTube? Paste it directly and Folio
                can summarize it without importing the video captions.
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setMode("transcript");
                  setError("");
                }}
              >
                Paste transcript instead
              </button>
            </div>
          </div>
        )}
        <div className="form-grid">
          <label className="field">
            Video title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Website redesign kickoff"
              required
              minLength={2}
              maxLength={180}
            />
          </label>
          <label className="field">
            Project <span className="optional">Optional</span>
            <input
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="e.g. Website redesign"
              maxLength={100}
            />
          </label>
        </div>
        <label className="field">
          Participants <span className="optional">Optional</span>
          <input
            value={participants}
            onChange={(e) => setParticipants(e.target.value)}
            placeholder="Olivia Chen, Marcus Reed, Sofia Patel"
            maxLength={3000}
          />
        </label>
        <details className="more-context">
          <summary>Add context & choose summary length</summary>
          <label className="field">
            Context or glossary
            <textarea
              rows={2}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="What should we know about this video?"
              maxLength={5000}
            />
          </label>
          <label className="field">
            Summary length
            <select
              value={length}
              onChange={(e) => setLength(e.target.value as typeof length)}
            >
              <option value="brief">Brief: the essentials</option>
              <option value="standard">Standard: the full picture</option>
              <option value="detailed">Detailed: a deeper look</option>
            </select>
          </label>
        </details>
        <label className="consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            I confirm that I have permission to process this video and its
            content.
          </span>
        </label>
        {demo && (
          <div className="inline-notice">
            <LockKeyhole size={18} />
            <span>
              {config.localTest
                ? "Local test mode is on. Your keys stay on this server and results are saved in this browser."
                : config.database
                  ? "Sign in to process your own videos."
                  : "For local testing, add your provider keys and set FOLIO_LOCAL_TEST_MODE=1 in .env.local."}
            </span>
            {!config.localTest && config.database && (
              <button type="button" className="text-button" onClick={onSignIn}>
                Sign in
              </button>
            )}
          </div>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-footer">
          <span>
            <ShieldCheck size={15} />
            Private to your workspace
          </span>
          <button
            disabled={Boolean(busy)}
            className="button primary"
            type="submit"
          >
            {busy ? (
              <>
                <LoaderCircle className="spin" size={17} />
                {busy}
              </>
            ) : (
              <>
                Create video summary
                <Sparkles size={16} />
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AuthDialog({ onClose }: { onClose: () => void }) {
  const { config, toast } = useWorkspace();
  const [signUp, setSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const db = browserDatabase();
      if (!db)
        throw new Error("Connect Supabase in your deployment settings first.");
      const result = signUp
        ? await db.auth.signUp({ email, password })
        : await db.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (signUp && !result.data.session)
        toast("Check your email to confirm your account, then sign in.");
      else toast("Welcome to your workspace.");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        signUp ? "A home for your conversations." : "Welcome back to Folio."
      }
      eyebrow="YOUR WORKSPACE"
      onClose={onClose}
    >
      <p className="modal-intro">
        Keep your meeting notes, decisions, and next steps together.
      </p>
      {!config.database ? (
        <div className="empty-state compact">
          <LockKeyhole />
          <h3>Your live workspace isn&apos;t connected yet.</h3>
          <p>
            Add the Supabase settings described in the deployment guide. You can
            explore every review tool in the sample workspace now.
          </p>
          <button className="button primary" onClick={onClose}>
            Keep exploring
            <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <label className="field">
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </label>
          <label className="field">
            Password
            <input
              type="password"
              autoComplete={signUp ? "new-password" : "current-password"}
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="button primary full-width" disabled={busy}>
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Mail size={17} />
            )}
            {signUp ? "Create your account" : "Sign in"}
          </button>
          <p className="auth-switch">
            {signUp ? "Already have an account?" : "New to Folio?"}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setSignUp(!signUp);
                setError("");
              }}
            >
              {signUp ? "Sign in" : "Create an account"}
            </button>
          </p>
        </form>
      )}
    </Modal>
  );
}

export function GuideDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Less replay. More progress."
      eyebrow="A QUICK TOUR"
      onClose={onClose}
    >
      <p className="modal-intro">Three small steps to a clearer workday.</p>
      <div className="guide-step">
        <span>
          <CloudUpload size={21} />
        </span>
        <div>
          <h3>1. Bring your conversation</h3>
          <p>
            Paste a video link, upload a file, or add a transcript. Add a
            project and the context that matters.
          </p>
        </div>
      </div>
      <div className="guide-step">
        <span>
          <Play size={21} />
        </span>
        <div>
          <h3>2. Go straight to the source</h3>
          <p>
            Review the summary, click timestamp citations, and check any flagged
            points against the transcript.
          </p>
        </div>
      </div>
      <div className="guide-step">
        <span>
          <CircleHelp size={21} />
        </span>
        <div>
          <h3>3. Turn clarity into action</h3>
          <p>
            Assign follow-ups, edit your notes, ask questions, and export a
            polished document.
          </p>
        </div>
      </div>
      <div className="inline-notice">
        <Sparkles size={18} />
        <span>
          Sample videos are fictional and clearly labeled. Your demo edits
          stay in this browser.
        </span>
      </div>
      <button className="button primary full-width" onClick={onClose}>
        Let&apos;s explore
        <ArrowRight size={16} />
      </button>
    </Modal>
  );
}
