"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Headphones,
  ListChecks,
  LoaderCircle,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import {
  itemKinds,
  retrieveSegments,
  timestamp,
  type Item,
  type Meeting,
} from "@/lib/domain";
import { exportMeeting } from "@/lib/export";
import { useWorkspace } from "./workspace-provider";
import { Modal } from "./dialogs";

const kindNames = {
  requirement: "Requirements",
  decision: "Decisions",
  action: "Action items",
  risk: "Risks",
  question: "Open questions",
};
type Citation = { segmentId: string; quote: string };
type Message = {
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
};

export function MeetingDetail({
  meeting,
  onBack,
}: {
  meeting: Meeting;
  onBack: () => void;
}) {
  const { demo, api, update, remove, toast, refresh } = useWorkspace();
  const [tab, setTab] = useState("summary");
  const [kind, setKind] = useState("all");
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [activeSegment, setActiveSegment] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<Item | "new" | null>(null);
  const [editSummary, setEditSummary] = useState(false);
  const [summary, setSummary] = useState(meeting.summary);
  const [speakerEditor, setSpeakerEditor] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [includeTranscript, setIncludeTranscript] = useState(false);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  useEffect(() => {
    if (demo || !meeting.sourcePath) return;
    let mounted = true;
    apiRef
      .current<{ mediaUrl: string | null }>(`/api/meetings/${meeting.id}`)
      .then((data) => {
        if (mounted) setMediaUrl(data.mediaUrl);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [demo, meeting.id, meeting.sourcePath]);
  useEffect(() => {
    messageEnd.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [messages]);
  function seek(segmentId: string | null) {
    const segment = meeting.transcript.find((s) => s.id === segmentId);
    if (!segment) return;
    setActiveSegment(segment.id);
    if (mediaUrl && player.current && segment.start != null) {
      player.current.currentTime = segment.start;
      player.current.play().catch(() => {});
    }
    setTab("transcript");
    setTranscriptSearch("");
    setTimeout(
      () =>
        document
          .getElementById(`transcript-${segment.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      80,
    );
  }
  async function saveItem(item: Item) {
    const exists = meeting.items.some((i) => i.id === item.id);
    await update(meeting.id, {
      items: exists
        ? meeting.items.map((i) => (i.id === item.id ? item : i))
        : [...meeting.items, item],
    });
    setEditItem(null);
    toast("Your changes are saved.");
  }
  async function changeItem(id: string, values: Partial<Item>) {
    setBusy(true);
    try {
      await update(meeting.id, {
        items: meeting.items.map((i) =>
          i.id === id ? { ...i, ...values } : i,
        ),
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save changes.");
    } finally {
      setBusy(false);
    }
  }
  async function download(format: "md" | "pdf" | "docx") {
    setExporting(true);
    try {
      await exportMeeting(meeting, format, { includeTranscript });
      toast(`${format.toUpperCase()} export is ready.`);
    } catch {
      toast("Couldn't prepare the export. Please try again.");
    } finally {
      setExporting(false);
    }
  }
  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || asking) return;
    setQuestion("");
    setMessages((previous) => [...previous, { role: "user", text: trimmed }]);
    setAsking(true);
    try {
      if (demo) {
        const query = /decid|decision|agree/i.test(trimmed)
          ? "agreed"
          : /action|next|owner/i.test(trimmed)
            ? "will"
            : trimmed;
        const found = retrieveSegments(query, meeting.transcript, 2);
        setMessages((previous) => [
          ...previous,
          {
            role: "assistant",
            text: "Here are relevant passages from the sample transcript. This is a source search; generated AI answers are available in a connected workspace.",
            citations: found.map((s) => ({ segmentId: s.id, quote: s.text })),
          },
        ]);
      } else {
        const response = await api<{ answer: string; citations: Citation[] }>(
          `/api/meetings/${meeting.id}/chat`,
          { method: "POST", body: JSON.stringify({ question: trimmed }) },
        );
        setMessages((previous) => [
          ...previous,
          {
            role: "assistant",
            text: response.answer,
            citations: response.citations,
          },
        ]);
      }
    } catch (e) {
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text:
            e instanceof Error
              ? e.message
              : "Couldn't answer that just now. Please try again.",
        },
      ]);
    } finally {
      setAsking(false);
    }
  }
  const reviewCount = meeting.items.filter(
    (i) => i.review === "needs-review",
  ).length;
  const segments = meeting.transcript.filter((s) =>
    `${s.speaker} ${s.text}`
      .toLowerCase()
      .includes(transcriptSearch.toLowerCase()),
  );
  const items = meeting.items.filter(
    (i) =>
      kind === "all" ||
      (kind === "review" ? i.review === "needs-review" : i.kind === kind),
  );

  return (
    <div className="meeting-detail page-enter">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={15} />
        Back to video library
      </button>
      <div className="detail-heading">
        <div>
          <div className="eyebrow">
            <span className="mini-dot sage" />
            {meeting.project.toUpperCase()}
            {demo && <span className="sample-label">SAMPLE VIDEO</span>}
          </div>
          <h1>{meeting.title}</h1>
          <div className="meeting-metadata">
            <span>
              <CalendarDays size={14} />
              {new Date(meeting.createdAt).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <span>
              <Clock3 size={14} />
              {meeting.duration
                ? `${Math.round(meeting.duration / 60)} minutes`
                : "Transcript"}
            </span>
            <span>
              <Users size={14} />
              {meeting.participants.length} participants
            </span>
          </div>
        </div>
        <div className="detail-actions">
          <details className="export-dropdown">
            <summary
              className={`button primary ${meeting.status !== "ready" ? "disabled" : ""}`}
            >
              {exporting ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Download size={16} />
              )}
              Export notes
              <ChevronDown size={14} />
            </summary>
            <div className="dropdown-menu">
              <label className="export-option">
                <input
                  type="checkbox"
                  checked={includeTranscript}
                  onChange={(e) => setIncludeTranscript(e.target.checked)}
                />
                Include full transcript
              </label>
              {(["md", "docx", "pdf"] as const).map((format) => (
                <button
                  disabled={exporting || meeting.status !== "ready"}
                  key={format}
                  onClick={(e) => {
                    e.currentTarget.closest("details")?.removeAttribute("open");
                    void download(format);
                  }}
                >
                  <FileText size={15} />
                  {format === "md"
                    ? "Markdown"
                    : format === "docx"
                      ? "Word document"
                      : "PDF document"}
                  <span>.{format}</span>
                </button>
              ))}
            </div>
          </details>
          <button
            className="icon-button bordered danger-hover"
            aria-label="Delete video analysis"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={17} />
          </button>
        </div>
      </div>
      {meeting.status !== "ready" ? (
        <Processing
          meeting={meeting}
          onRetry={async () => {
            try {
              await api(`/api/meetings/${meeting.id}/retry`, {
                method: "POST",
              });
              await refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : "Retry failed.");
            }
          }}
        />
      ) : (
        <>
          {reviewCount > 0 && (
            <button
              className="review-banner"
              onClick={() => {
                setTab("items");
                setKind("review");
              }}
            >
              <span>
                <CircleAlert size={17} />
                <strong>A quick second look.</strong> {reviewCount}{" "}
                {reviewCount === 1 ? "point needs" : "points need"} your review.
              </span>
              <span>
                Review evidence
                <ArrowRight size={15} />
              </span>
            </button>
          )}
          <div className="detail-grid">
            <section className="panel notes-panel">
              <div className="tabs detail-tabs">
                {[
                  ["summary", "Overview", FileText],
                  ["items", "Key findings", ListChecks],
                  ["transcript", "Transcript", AudioLines],
                  ["chat", "Ask this video", MessageSquare],
                ].map(([id, label, Icon]) => {
                  const TabIcon = Icon as typeof FileText;
                  return (
                    <button
                      key={id as string}
                      className={tab === id ? "active" : ""}
                      onClick={() => setTab(id as string)}
                    >
                      <TabIcon size={16} />
                      {label as string}
                      {id === "items" && <span>{meeting.items.length}</span>}
                    </button>
                  );
                })}
              </div>
              {tab === "summary" && (
                <div className="summary-content">
                  <div className="summary-title">
                    <span className="summary-symbol">
                      <Sparkles size={20} />
                    </span>
                    <div>
                      <span className="eyebrow">THE BIG PICTURE</span>
                      <h2>Everyone on the same page.</h2>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Edit executive summary"
                      onClick={() => {
                        setSummary(meeting.summary);
                        setEditSummary(true);
                      }}
                    >
                      <Pencil size={16} />
                    </button>
                  </div>
                  {editSummary ? (
                    <div className="summary-edit">
                      <label className="field">
                        Executive summary
                        <textarea
                          rows={12}
                          value={summary}
                          onChange={(e) => setSummary(e.target.value)}
                          maxLength={30000}
                        />
                      </label>
                      <div className="button-row">
                        <button
                          className="button secondary small"
                          onClick={() => setEditSummary(false)}
                        >
                          Cancel
                        </button>
                        <button
                          className="button primary small"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await update(meeting.id, { summary });
                              setEditSummary(false);
                              toast("Summary updated.");
                            } catch (e) {
                              toast(
                                e instanceof Error
                                  ? e.message
                                  : "Could not save.",
                              );
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Save changes
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="summary-prose">
                      {meeting.summary.split(/\n\n+/).map((paragraph, i) => (
                        <p key={i}>{paragraph}</p>
                      ))}
                    </div>
                  )}
                  <div className="takeaway-stats">
                    {(["requirement", "decision", "action"] as const).map(
                      (k) => (
                        <button
                          key={k}
                          onClick={() => {
                            setKind(k);
                            setTab("items");
                          }}
                        >
                          <strong>
                            {meeting.items.filter((i) => i.kind === k).length}
                          </strong>
                          <span>
                            {kindNames[k]}
                            <ChevronRight size={13} />
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                  <div className="topic-heading">
                    <h3>What we talked about</h3>
                    <span className="small-text muted">
                      Linked to the conversation
                    </span>
                  </div>
                  <div className="topic-list">
                    {meeting.topics.map((topic, i) => (
                      <div className="topic" key={i}>
                        <span className="topic-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <h3>{topic.title}</h3>
                          <p>{topic.summary}</p>
                          {topic.segmentId && (
                            <button
                              className="citation"
                              onClick={() => seek(topic.segmentId)}
                            >
                              <Play size={10} />
                              {timestamp(
                                meeting.transcript.find(
                                  (s) => s.id === topic.segmentId,
                                )?.start,
                              )}
                              <ArrowUpRight size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="summary-bottom">
                    <ShieldCheck size={15} />
                    {demo
                      ? "Sample findings with transcript evidence. Explore, edit, and make them your own."
                      : "Extracted items are quote-checked. Review the narrative against the source before sharing."}
                  </div>
                </div>
              )}
              {tab === "items" && (
                <div className="items-content">
                  <div className="findings-toolbar">
                    <select
                      aria-label="Filter findings"
                      value={kind}
                      onChange={(e) => setKind(e.target.value)}
                    >
                      <option value="all">
                        All findings ({meeting.items.length})
                      </option>
                      <option value="review">
                        Needs review ({reviewCount})
                      </option>
                      {itemKinds.map((k) => (
                        <option value={k} key={k}>
                          {kindNames[k]} (
                          {meeting.items.filter((i) => i.kind === k).length})
                        </option>
                      ))}
                    </select>
                    <button
                      className="button secondary small"
                      onClick={() => setEditItem("new")}
                    >
                      <Plus size={15} />
                      Add a finding
                    </button>
                  </div>
                  {items.map((item) => (
                    <article
                      className={`finding ${item.review === "needs-review" ? "needs-review" : ""}`}
                      key={item.id}
                    >
                      <div className="finding-top">
                        <span className={`kind-label ${item.kind}`}>
                          {item.kind === "action"
                            ? "ACTION ITEM"
                            : item.kind.toUpperCase()}
                        </span>
                        <span className={`priority-tag ${item.priority}`}>
                          {item.priority}
                        </span>
                        <div className="finding-tools">
                          <button
                            className="icon-button"
                            aria-label={`Edit ${item.text}`}
                            onClick={() => setEditItem(item)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="icon-button danger-hover"
                            aria-label={`Delete ${item.text}`}
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await update(meeting.id, {
                                  items: meeting.items.filter(
                                    (i) => i.id !== item.id,
                                  ),
                                });
                                toast("Finding removed.");
                              } catch (e) {
                                toast(
                                  e instanceof Error
                                    ? e.message
                                    : "Could not remove finding.",
                                );
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="finding-text">
                        {item.kind === "action" && (
                          <button
                            disabled={busy}
                            className={`task-checkbox ${item.completed ? "checked" : ""}`}
                            aria-label={
                              item.completed
                                ? "Mark incomplete"
                                : "Mark complete"
                            }
                            onClick={() =>
                              changeItem(item.id, {
                                completed: !item.completed,
                              })
                            }
                          >
                            {item.completed && <Check size={12} />}
                          </button>
                        )}
                        <h3 className={item.completed ? "struck" : ""}>
                          {item.text}
                        </h3>
                      </div>
                      {(item.owner || item.dueDate) && (
                        <div className="finding-owner">
                          {item.owner && (
                            <span>
                              <Users size={13} />
                              {item.owner}
                            </span>
                          )}
                          {item.dueDate && (
                            <span>
                              <CalendarDays size={13} />
                              {item.dueDate}
                            </span>
                          )}
                        </div>
                      )}
                      {item.evidence && (
                        <blockquote>{item.evidence}</blockquote>
                      )}
                      <div className="finding-bottom">
                        {item.segmentId ? (
                          <button
                            className="citation"
                            onClick={() => seek(item.segmentId)}
                          >
                            <Play size={10} />
                            {timestamp(
                              meeting.transcript.find(
                                (s) => s.id === item.segmentId,
                              )?.start,
                            )}
                            <ArrowUpRight size={11} />
                          </button>
                        ) : (
                          <span className="small-text muted">
                            Manually added
                          </span>
                        )}
                        <span className={`evidence-status ${item.review}`}>
                          {item.review === "verified" ? (
                            <ShieldCheck size={12} />
                          ) : (
                            <CircleAlert size={12} />
                          )}
                          {item.review === "verified"
                            ? "Source checked"
                            : item.review === "edited"
                              ? "Edited by you"
                              : "Needs review"}
                          {item.inferred ? " · Inferred" : ""}
                        </span>
                        {item.review === "needs-review" && (
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() =>
                              changeItem(item.id, { review: "edited" })
                            }
                          >
                            Mark reviewed
                            <Check size={13} />
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                  {!items.length && (
                    <div className="empty-state compact">
                      <CheckCheck size={28} />
                      <h3>Nothing to review here.</h3>
                      <p>Choose another category or add a finding.</p>
                    </div>
                  )}
                </div>
              )}
              {tab === "transcript" && (
                <div className="transcript-content">
                  <div className="transcript-toolbar">
                    <label className="search-box">
                      <Search size={16} />
                      <input
                        value={transcriptSearch}
                        onChange={(e) => setTranscriptSearch(e.target.value)}
                        placeholder="Search the video transcript..."
                        aria-label="Search transcript"
                      />
                    </label>
                    <button
                      className="button secondary small"
                      onClick={() => setSpeakerEditor(true)}
                    >
                      <Users size={15} />
                      Edit speakers
                    </button>
                  </div>
                  <p className="transcript-note">
                    {demo
                      ? "Selected passages from a fictional video. No recording is attached."
                      : "Click a timestamp to play the source from that moment. Untimed transcripts remain untimed."}
                  </p>
                  {segments.map((segment, i) => (
                    <div
                      className={`transcript-segment ${activeSegment === segment.id ? "highlighted" : ""}`}
                      id={`transcript-${segment.id}`}
                      key={segment.id}
                    >
                      <button
                        className="segment-time"
                        onClick={() => seek(segment.id)}
                      >
                        {segment.start != null
                          ? timestamp(segment.start)
                          : `#${i + 1}`}
                      </button>
                      <div>
                        <strong>
                          <span className={`speaker-dot speaker-${i % 3}`} />
                          {segment.speaker}
                        </strong>
                        <p>{segment.text}</p>
                      </div>
                    </div>
                  ))}
                  {!segments.length && (
                    <div className="empty-state compact">
                      <Search size={24} />
                      <p>No transcript passages match that search.</p>
                    </div>
                  )}
                </div>
              )}
              {tab === "chat" && (
                <div className="chat-content">
                  <div className="chat-header">
                    <span className="summary-symbol">
                      <Sparkles size={23} />
                    </span>
                    <h2>Your video has the answers.</h2>
                    <p>
                      {demo
                        ? "Explore source passages in this sample video."
                        : "Ask a question. Get an answer with the evidence behind it."}
                    </p>
                  </div>
                  <div className="chat-messages">
                    {!messages.length && (
                      <div className="chat-suggestions">
                        {[
                          "What did we decide?",
                          "What are the next steps?",
                          "Which risks came up?",
                        ].map((q) => (
                          <button key={q} onClick={() => ask(q)}>
                            {q}
                            <ArrowUpRight size={14} />
                          </button>
                        ))}
                      </div>
                    )}
                    {messages.map((m, i) => (
                      <div className={`chat-message ${m.role}`} key={i}>
                        <span className="chat-role">
                          {m.role === "user"
                            ? "YOU"
                            : demo
                              ? "TRANSCRIPT SEARCH"
                              : "FOLIO"}
                        </span>
                        <p>{m.text}</p>
                        {m.citations?.map((citation, j) => (
                          <button
                            className="chat-citation"
                            key={j}
                            onClick={() => seek(citation.segmentId)}
                          >
                            <span>
                              <Play size={10} />
                              {timestamp(
                                meeting.transcript.find(
                                  (s) => s.id === citation.segmentId,
                                )?.start,
                              )}
                            </span>
                            <p>{citation.quote}</p>
                            <ArrowUpRight size={13} />
                          </button>
                        ))}
                      </div>
                    ))}
                    {asking && (
                      <div className="chat-thinking">
                        <LoaderCircle className="spin" size={16} />
                        Looking through the video transcript...
                      </div>
                    )}
                    <div ref={messageEnd} />
                  </div>
                  <form
                    className="chat-input"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void ask(question);
                    }}
                  >
                    <input
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="Ask about this video..."
                      aria-label="Question about this video"
                      maxLength={2000}
                      minLength={3}
                      required
                    />
                    <button
                      className="button primary"
                      disabled={asking || question.trim().length < 3}
                      aria-label="Send question"
                    >
                      <Send size={17} />
                    </button>
                  </form>
                  <p className="chat-footnote">
                    {demo
                      ? "Sample mode uses transcript search. Connect AI for generated answers."
                      : "Answers use relevant transcript excerpts. Always check important details against the source."}
                  </p>
                </div>
              )}
            </section>
            <aside className="source-sidebar">
              <section className="panel source-panel">
                <div className="section-heading">
                  <h3>The source of it all</h3>
                  <AudioLines size={17} />
                </div>
                {mediaUrl ? (
                  <video
                    ref={player}
                    controls
                    src={mediaUrl}
                    className="source-video"
                    preload="metadata"
                    onError={() =>
                      toast(
                        "The source link may have expired. Reopen this video to refresh it.",
                      )
                    }
                  />
                ) : (
                  <div className="source-placeholder">
                    <span className="source-orbit" />
                    <span className="source-headphones">
                      <Headphones size={32} strokeWidth={1.4} />
                    </span>
                    <div className="source-wave">
                      {[8, 15, 25, 37, 22, 13, 29, 41, 26, 17, 8].map(
                        (h, i) => (
                          <i style={{ height: h }} key={i} />
                        ),
                      )}
                    </div>
                    <span>
                      {meeting.sourcePath
                        ? "Loading recording..."
                        : meeting.sourceUrl
                          ? `Transcript imported from ${meeting.sourceProvider === "youtube" ? "YouTube" : "the video link"}.`
                        : "Every word, in perspective."}
                    </span>
                  </div>
                )}
                <div className="source-info">
                  <strong>{meeting.sourceName || "Transcript meeting"}</strong>
                  <p>
                    {meeting.sourcePath
                      ? "Private recording · Links expire after one hour"
                      : meeting.sourceUrl
                        ? `${meeting.sourceProvider === "youtube" ? "Captions" : "Transcript"} imported from the video link · Original video remains at its source`
                      : "No source file attached. Explore the transcript below."}
                  </p>
                  {meeting.sourceUrl && (
                    <a
                      className="text-button"
                      href={meeting.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open original video
                      <ExternalLink size={14} />
                    </a>
                  )}
                  <button
                    className="text-button"
                    onClick={() => {
                      setTab("transcript");
                      setTranscriptSearch("");
                    }}
                  >
                    Read the transcript
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              </section>
              <section className="panel people-panel">
                <div className="section-heading">
                  <h3>In the source video</h3>
                  <button
                    className="icon-button"
                    aria-label="Edit speaker names"
                    onClick={() => setSpeakerEditor(true)}
                  >
                    <Pencil size={14} />
                  </button>
                </div>
                {meeting.participants.map((p, i) => (
                  <div className="person-row" key={p}>
                    <span className={`avatar avatar-${i % 4}`}>
                      {p
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((w) => w[0])
                        .join("")}
                    </span>
                    <span>{p}</span>
                  </div>
                ))}
                {!meeting.participants.length && (
                  <p className="muted small-text">No participants specified.</p>
                )}
              </section>
              <div className="context-tip">
                <span>
                  <ShieldCheck size={20} />
                </span>
                <h3>Trust comes with context.</h3>
                <p>
                  Every timestamp takes you back to the conversation. Take a
                  moment to verify anything that matters.
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
      {editItem && (
        <ItemEditor
          item={editItem === "new" ? undefined : editItem}
          meeting={meeting}
          onClose={() => setEditItem(null)}
          onSave={saveItem}
        />
      )}
      {speakerEditor && (
        <SpeakerEditor
          meeting={meeting}
          onClose={() => setSpeakerEditor(false)}
          onSave={async (from, to) => {
            await update(meeting.id, { speaker: { from, to } });
            setSpeakerEditor(false);
            toast("Speaker name updated in the transcript and task owners.");
          }}
        />
      )}
      {confirmDelete && (
        <Modal
          title="Delete this video analysis?"
          onClose={() => setConfirmDelete(false)}
        >
          <p className="modal-intro">
            This removes &ldquo;{meeting.title}&rdquo;, its notes, and any
            attached source from your workspace.
          </p>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setConfirmDelete(false)}
            >
              Keep video
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await remove(meeting.id);
                  onBack();
                } catch (e) {
                  toast(e instanceof Error ? e.message : "Could not delete.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete video analysis
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Processing({
  meeting,
  onRetry,
}: {
  meeting: Meeting;
  onRetry: () => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);
  const stages = [
    "queued",
    ...(meeting.sourcePath || meeting.sourceUrl ? ["transcribing"] : []),
    "extracting",
    "verifying",
    "writing",
    "ready",
  ];
  const names: Record<string, string> = {
      queued: "Video received",
    transcribing: "Transcribe & identify speakers",
    extracting: "Find the important points",
    verifying: "Verify against the source",
      writing: "Write your video notes",
    ready: "Ready for your review",
  };
  const current = stages.indexOf(meeting.status);
  return (
    <section className="panel processing-panel">
      <span
        className={`processing-symbol ${meeting.status === "failed" ? "error" : ""}`}
      >
        {meeting.status === "failed" ? (
          <CircleAlert size={32} />
        ) : (
          <AudioLines size={32} />
        )}
      </span>
      <div className="eyebrow">A LITTLE LESS NOISE, A LOT MORE CLARITY</div>
      <h2>
        {meeting.status === "failed"
          ? "We hit a pause."
          : "Finding the moments that matter."}
      </h2>
      <p>
        {meeting.error ||
          "Your video is being processed in the background. Feel free to keep exploring."}
      </p>
      <div className="pipeline-stages">
        {stages.map((s, i) => (
          <div
            key={s}
            className={`${i < current ? "complete" : ""} ${i === current ? "current" : ""}`}
          >
            <span>
              {i < current ? (
                <Check size={15} />
              ) : i === current ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                i + 1
              )}
            </span>
            {names[s]}
          </div>
        ))}
      </div>
      {meeting.status === "failed" && (
        <button
          className="button primary"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            await onRetry();
            setRetrying(false);
          }}
        >
          <RotateCcw size={16} />
          {retrying ? "Starting..." : "Try processing again"}
        </button>
      )}
    </section>
  );
}

function ItemEditor({
  item,
  meeting,
  onClose,
  onSave,
}: {
  item?: Item;
  meeting: Meeting;
  onClose: () => void;
  onSave: (item: Item) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Item>(
    item || {
      id: `manual-${crypto.randomUUID()}`,
      kind: "requirement",
      text: "",
      category: "General",
      priority: "should",
      owner: null,
      dueDate: null,
      segmentId: null,
      evidence: "",
      confidence: 0,
      inferred: false,
      review: "edited",
      completed: false,
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title={
        item
          ? "Give this finding a little polish."
          : "Capture something important."
      }
      eyebrow={item ? "EDIT FINDING" : "NEW FINDING"}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave({ ...draft, review: "edited" });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label className="field">
            Kind
            <select
              value={draft.kind}
              onChange={(e) =>
                setDraft({ ...draft, kind: e.target.value as Item["kind"] })
              }
            >
              {itemKinds.map((k) => (
                <option key={k} value={k}>
                  {kindNames[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Priority
            <select
              value={draft.priority}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  priority: e.target.value as Item["priority"],
                })
              }
            >
              <option value="must">Must have</option>
              <option value="should">Should have</option>
              <option value="could">Could have</option>
            </select>
          </label>
        </div>
        <label className="field">
          Finding
          <textarea
            required
            maxLength={3000}
            value={draft.text}
            rows={4}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label className="field">
            Owner
            <input
              value={draft.owner || ""}
              maxLength={100}
              onChange={(e) =>
                setDraft({ ...draft, owner: e.target.value || null })
              }
              placeholder="Unassigned"
            />
          </label>
          <label className="field">
            Due date
            <input
              value={draft.dueDate || ""}
              maxLength={100}
              onChange={(e) =>
                setDraft({ ...draft, dueDate: e.target.value || null })
              }
              placeholder="YYYY-MM-DD or as discussed"
            />
          </label>
        </div>
        <label className="field">
          Source passage
          <select
            value={draft.segmentId || ""}
            onChange={(e) => {
              const segment = meeting.transcript.find(
                (s) => s.id === e.target.value,
              );
              setDraft({
                ...draft,
                segmentId: segment?.id || null,
                evidence: segment?.text || "",
              });
            }}
          >
            <option value="">No source (manual note)</option>
            {meeting.transcript.map((s) => (
              <option key={s.id} value={s.id}>
                {timestamp(s.start)} · {s.text.slice(0, 65)}
              </option>
            ))}
          </select>
        </label>
        {draft.evidence && (
          <blockquote className="editor-evidence">{draft.evidence}</blockquote>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Saving..." : "Save finding"}
            <Check size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function SpeakerEditor({
  meeting,
  onClose,
  onSave,
}: {
  meeting: Meeting;
  onClose: () => void;
  onSave: (from: string, to: string) => Promise<void>;
}) {
  const speakers = [
    ...new Set([
      ...meeting.participants,
      ...meeting.transcript.map((s) => s.speaker),
    ]),
  ];
  const [from, setFrom] = useState(speakers[0] || "");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Put a name to the conversation."
      eyebrow="EDIT SPEAKERS"
      onClose={onClose}
    >
      <p className="modal-intro">
        Update a speaker&apos;s name throughout the transcript and assigned
        actions. Existing summary prose stays editable separately.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(from, to.trim());
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Current speaker
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {speakers.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Display name
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="e.g. Olivia Chen"
            required
            maxLength={100}
          />
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !from || !to.trim()}
          >
            Update speaker
            <Check size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
