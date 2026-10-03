"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  CheckSquare2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileAudio2,
  FileText,
  FolderClosed,
  Headphones,
  LayoutDashboard,
  ListFilter,
  Link2,
  LoaderCircle,
  LogOut,
  Menu,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  Video,
  X,
} from "lucide-react";
import { initials, type Meeting } from "@/lib/domain";
import { browserDatabase } from "@/lib/supabase";
import { useWorkspace } from "./workspace-provider";
import { AuthDialog, GuideDialog, Modal, UploadDialog } from "./dialogs";
import { MeetingDetail } from "./meeting-detail";

const nav = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "meetings", label: "Video library", icon: Video },
  { id: "actions", label: "Action items", icon: CheckSquare2 },
  { id: "projects", label: "Projects", icon: FolderClosed },
];
const projectTones = ["sage", "peach", "blue", "rose"];
export function projectTone(project: string) {
  const known = ["Website redesign", "Product strategy", "Client work"].indexOf(
    project,
  );
  return projectTones[
    known >= 0
      ? known
      : [...project].reduce((a, c) => a + c.charCodeAt(0), 0) % 4
  ];
}
export function Avatars({
  people,
  limit = 3,
}: {
  people: string[];
  limit?: number;
}) {
  return (
    <div className="avatars" aria-label={people.join(", ")}>
      {people.slice(0, limit).map((p, i) => (
        <span className={`avatar avatar-${i % 4}`} title={p} key={p}>
          {initials(p)}
        </span>
      ))}
      {people.length > limit && (
        <span className="avatar avatar-extra">+{people.length - limit}</span>
      )}
    </div>
  );
}
export function MeetingBadge({ meeting }: { meeting: Meeting }) {
  const review = meeting.items.some((i) => i.review === "needs-review");
  const label =
    meeting.status === "ready"
      ? review
        ? "Needs review"
        : "Ready"
      : meeting.status === "failed"
        ? "Failed"
        : "Processing";
  return (
    <span
      className={`status-badge ${meeting.status === "failed" ? "failed" : meeting.status !== "ready" ? "processing" : review ? "review" : "ready"}`}
    >
      <span />
      {label}
    </span>
  );
}

export function Dashboard() {
  const { meetings, loading, demo, session } = useWorkspace();
  const params = useSearchParams();
  const router = useRouter();
  const view = params.get("view") || "overview";
  const meetingId = params.get("meeting");
  const [dialog, setDialog] = useState<
    "upload" | "auth" | "help" | "search" | "notifications" | null
  >(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [globalQuery, setGlobalQuery] = useState("");
  const searchQuery = useDeferredValue(globalQuery);
  const projects = [...new Set(meetings.map((m) => m.project))];
  const openActions = meetings.flatMap((m) =>
    m.items.filter((i) => i.kind === "action" && !i.completed),
  );
  const reviewMeetings = meetings.filter(
    (m) =>
      m.status === "failed" || m.items.some((i) => i.review === "needs-review"),
  );
  const active = meetings.find((m) => m.id === meetingId);
  const current =
    nav.find((n) => n.id === view)?.label ||
    (view === "settings" ? "Settings" : "Overview");
  useEffect(() => {
    function keydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setDialog("search");
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  function openMeeting(id: string) {
    router.push(`/?view=meetings&meeting=${encodeURIComponent(id)}`);
    setDialog(null);
  }
  const matches = meetings.filter((m) =>
    `${m.title} ${m.project} ${m.summary} ${m.transcript.map((s) => s.text).join(" ")}`
      .toLowerCase()
      .includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        id="workspace-navigation"
        className={`sidebar ${mobileOpen ? "open" : ""}`}
      >
        <Link href="/" className="brand" onClick={() => setMobileOpen(false)}>
          <span className="brand-symbol">
            <span />
            <span />
            <span />
          </span>
          folio<span className="brand-period">.</span>
        </Link>
        <button
          className="workspace-switch"
          onClick={() => {
            router.push("/?view=settings");
            setMobileOpen(false);
          }}
        >
          <span className="workspace-icon">
            <AudioLines size={18} />
          </span>
          <span>
            <strong>{demo ? "The creative space" : "My workspace"}</strong>
            <small>{demo ? "Demo workspace" : "Personal workspace"}</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <Link
              key={item.id}
              href={`/?view=${item.id}`}
              onClick={() => setMobileOpen(false)}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              aria-current={view === item.id ? "page" : undefined}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.id === "actions" && openActions.length > 0 && (
                <span className="nav-count">{openActions.length}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="nav-label project-nav-label">
          YOUR PROJECTS
          <FolderClosed size={13} />
        </div>
        <div className="project-nav">
          {projects.slice(0, 4).map((p) => (
            <Link
              key={p}
              href={`/?view=meetings&project=${encodeURIComponent(p)}`}
              onClick={() => setMobileOpen(false)}
            >
              <span className={`project-dot ${projectTone(p)}`} />
              <span>{p}</span>
            </Link>
          ))}
          {!projects.length && (
            <span className="sidebar-muted">
              Projects appear with your video summaries.
            </span>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-card">
            <span className="tiny-stars">
              <Sparkles size={18} />
            </span>
            <strong>
              A little less replay.
              <br />A lot more meaning.
            </strong>
            <p>
              Make your next video
              <br />
              your next step forward.
            </p>
            <button onClick={() => setDialog("upload")}>
              Add a video
              <ArrowUpRight size={15} />
            </button>
          </div>
          <button className="nav-item" onClick={() => setDialog("help")}>
            <CircleHelp size={18} />
            <span>Help & getting started</span>
            <ArrowUpRight size={13} />
          </button>
          <Link
            className={`nav-item ${view === "settings" ? "active" : ""}`}
            href="/?view=settings"
            onClick={() => setMobileOpen(false)}
          >
            <Settings2 size={18} />
            <span>Settings</span>
          </Link>
          <button
            className="profile-button"
            onClick={() =>
              demo ? setDialog("auth") : router.push("/?view=settings")
            }
          >
            <span className="profile-avatar">
              {demo
                ? "DE"
                : initials(session?.user.email?.split("@")[0] || "Me")}
            </span>
            <span>
              <strong>
                {demo ? "Demo explorer" : session?.user.email?.split("@")[0]}
              </strong>
              <small>
                {demo ? "Make yourself at home" : "Your personal workspace"}
              </small>
            </span>
            <ChevronDown size={14} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              aria-controls="workspace-navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb-muted">Workspace</span>
            <ChevronRight size={13} />
            <span>{active ? "Video summary" : current}</span>
          </div>
          <div className="topbar-tools">
            <button
              className="global-search"
              aria-label="Search workspace"
              onClick={() => setDialog("search")}
            >
              <Search size={16} />
              <span>Search anything...</span>
              <kbd>Ctrl K</kbd>
            </button>
            {demo && <span className="demo-tag">DEMO</span>}
            <button
              className="icon-button notification-button"
              aria-label="Review notifications"
              onClick={() => setDialog("notifications")}
            >
              <Bell size={19} />
              {reviewMeetings.length > 0 && <i />}
            </button>
            <span className="topbar-divider" />
            <button
              className="profile-avatar small"
              aria-label={demo ? "Sign in" : "Account settings"}
              onClick={() =>
                demo ? setDialog("auth") : router.push("/?view=settings")
              }
            >
              {demo
                ? "DE"
                : initials(session?.user.email?.split("@")[0] || "Me")}
            </button>
          </div>
        </header>
        <main className="main-content" id="main-content">
          {meetingId ? (
            active ? (
              <MeetingDetail
                key={active.id}
                meeting={active}
                onBack={() => router.push("/?view=meetings")}
              />
            ) : (
              <div className="empty-state">
                <FileText size={32} />
                <h2>
                  {loading
                    ? "Opening your video summary..."
                    : "This video isn't here."}
                </h2>
                <Link className="button secondary" href="/?view=meetings">
                  Back to video library
                </Link>
              </div>
            )
          ) : view === "meetings" ? (
            <MeetingsPage
              onOpen={openMeeting}
              onUpload={() => setDialog("upload")}
              project={params.get("project") || "all"}
            />
          ) : view === "actions" ? (
            <ActionsPage onOpen={openMeeting} />
          ) : view === "projects" ? (
            <ProjectsPage onUpload={() => setDialog("upload")} />
          ) : view === "settings" ? (
            <SettingsPage onSignIn={() => setDialog("auth")} />
          ) : (
            <Overview
              onOpen={openMeeting}
              onUpload={() => setDialog("upload")}
              onGuide={() => setDialog("help")}
            />
          )}
        </main>
        <footer className="app-footer">
          <span>Less noise. More clarity.</span>
          <span>
            <span className="live-dot" />
            {demo
              ? "Sample workspace · Saved in this browser"
              : "Your private video workspace"}
          </span>
          <span>Made for the moments that matter.</span>
        </footer>
      </div>
      {dialog === "upload" && (
        <UploadDialog
          onClose={() => setDialog(null)}
          onCreated={openMeeting}
          onSignIn={() => setDialog("auth")}
        />
      )}
      {dialog === "auth" && <AuthDialog onClose={() => setDialog(null)} />}
      {dialog === "help" && <GuideDialog onClose={() => setDialog(null)} />}
      {dialog === "search" && (
        <Modal
          title="Find a little clarity."
          eyebrow="SEARCH YOUR WORKSPACE"
          onClose={() => setDialog(null)}
        >
          <label className="search-box large">
            <Search size={19} />
            <input
              autoFocus
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
              placeholder="A video, decision, project, or phrase..."
            />
          </label>
          <div className="search-results">
            {matches.map((m) => (
              <button key={m.id} onClick={() => openMeeting(m.id)}>
                <span className={`meeting-icon ${projectTone(m.project)}`}>
                  <FileText size={19} />
                </span>
                <span>
                  <strong>{m.title}</strong>
                  <small>
                    {m.project} ·{" "}
                    {new Date(m.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </small>
                </span>
                <ArrowUpRight size={17} />
              </button>
            ))}
            {!matches.length && (
              <div className="empty-state compact">
                <Search size={24} />
                <p>No matches yet. Try a different phrase.</p>
              </div>
            )}
          </div>
        </Modal>
      )}
      {dialog === "notifications" && (
        <Modal
          title="A few things to look at."
          eyebrow="YOUR REVIEW INBOX"
          onClose={() => setDialog(null)}
        >
          <p className="modal-intro">
            Uncertain points and interrupted videos, all in one place.
          </p>
          <div className="search-results">
            {reviewMeetings.map((m) => (
              <button key={m.id} onClick={() => openMeeting(m.id)}>
                <span className="meeting-icon peach">
                  <Bell size={18} />
                </span>
                <span>
                  <strong>{m.title}</strong>
                  <small>
                    {m.status === "failed"
                      ? "Processing needs your attention"
                      : `${m.items.filter((i) => i.review === "needs-review").length} point to verify against the source`}
                  </small>
                </span>
                <ArrowUpRight size={17} />
              </button>
            ))}
            {!reviewMeetings.length && (
              <div className="empty-state compact">
                <CheckCheck size={30} />
                <h3>You&apos;re all caught up.</h3>
                <p>We&apos;ll show items that need a second look here.</p>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function SignalArtwork() {
  const bars = [
    10, 18, 12, 27, 18, 37, 58, 34, 50, 28, 18, 45, 70, 44, 60, 32, 52, 79, 47,
    61, 29, 44, 23, 37, 18, 27, 12,
  ];
  return (
    <div className="signal-art" aria-hidden="true">
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      <div className="orbit orbit-three" />
      <div className="waveform">
        {bars.map((h, i) => (
          <i key={i} style={{ height: h, animationDelay: `${i * 40}ms` }} />
        ))}
      </div>
      <span className="art-spark one">+</span>
      <span className="art-spark two">+</span>
      <div className="insight-chip top">
        <span>
          <Check size={12} />
        </span>
        Decisions, captured.
      </div>
      <div className="insight-chip bottom">
        <span>
          <Sparkles size={13} />
        </span>
        Your next steps, clear.
        <span className="chip-dot" />
      </div>
      <div className="floating-note">
        <div className="note-fold" />
        <span className="note-icon">
          <AudioLines size={20} />
        </span>
        <span className="note-line long" />
        <span className="note-line" />
        <span className="note-line short" />
        <div className="note-check">
          <Check size={11} />
          <span />
        </div>
        <div className="note-check">
          <Check size={11} />
          <span />
        </div>
      </div>
    </div>
  );
}
function Overview({
  onOpen,
  onUpload,
  onGuide,
}: {
  onOpen: (id: string) => void;
  onUpload: () => void;
  onGuide: () => void;
}) {
  const { meetings, demo } = useWorkspace();
  const [range, setRange] = useState("all");
  const [now] = useState(() => Date.now());
  const filtered = meetings.filter(
    (m) =>
      range === "all" ||
      now - new Date(m.createdAt).getTime() <= Number(range) * 86400000,
  );
  const ready = filtered.filter((m) => m.status === "ready");
  const actions = filtered.flatMap((m) =>
    m.items
      .filter((i) => i.kind === "action")
      .map((item) => ({ item, meeting: m })),
  );
  const open = actions.filter((a) => !a.item.completed);
  const hours = (ready.reduce((s, m) => s + m.duration, 0) / 3600).toFixed(1);
  const decisions = ready.flatMap((m) =>
    m.items.filter((i) => i.kind === "decision"),
  ).length;
  const metrics = [
    {
      label: "Videos in focus",
      value: filtered.length,
      icon: Video,
      color: "sage",
      sub: `${ready.length} summaries ready to explore`,
      points: filtered.map((_, i) => i + 1),
    },
    {
      label: "Hours of video",
      value: hours,
      suffix: "hrs",
      icon: Clock3,
      color: "blue",
      sub: "The context, without the replay",
      points: ready.map((m) => m.duration),
    },
    {
      label: "Open action items",
      value: open.length,
      icon: CheckSquare2,
      color: "peach",
      sub: `${actions.length - open.length} already checked off`,
      points: filtered.map(
        (m) =>
          m.items.filter((i) => i.kind === "action" && !i.completed).length,
      ),
    },
    {
      label: "Decisions captured",
      value: decisions,
      icon: ShieldCheck,
      color: "rose",
      sub: "Every decision, linked to its source",
      points: ready.map(
        (m) => m.items.filter((i) => i.kind === "decision").length,
      ),
    },
  ];
  return (
    <div className="page-enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow greeting">
            <span className="mini-sun" />
            YOUR WORK, A LITTLE CLEARER
          </div>
          <h1>
            Clarity starts here<span className="orange-period">.</span>
          </h1>
          <p>
            A little perspective on your conversations. A clear path to
            what&apos;s next.
          </p>
        </div>
        <button className="button primary" onClick={onUpload}>
          <Plus size={18} />
          New video analysis
        </button>
      </div>
      <section className="welcome-banner">
        <div className="welcome-copy">
          <div className="banner-eyebrow">
            <span className="live-dot" />
            FROM CONVERSATION TO CLARITY
          </div>
          <h2>
            Great conversations.
            <br />
            Even better follow-through.
          </h2>
          <p>
            Videos hold good ideas. Give them somewhere to go.
            <br className="desktop-break" /> Capture the essentials and make
            your next move.
          </p>
          <div className="hero-buttons">
            <button className="button dark" onClick={onUpload}>
              <Upload size={16} />
              Upload a video
              <ArrowUpRight size={16} />
            </button>
            <button className="button ghost" onClick={onGuide}>
              <span className="play-circle">
                <Play size={10} fill="currentColor" />
              </span>
              See how it works
            </button>
          </div>
        </div>
        <SignalArtwork />
      </section>
      <div className="section-heading metrics-heading">
        <h2>Your workspace at a glance</h2>
        <label className="select-control">
          <CalendarDays size={14} />
          <select
            aria-label="Dashboard date range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="all">All time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
          <ChevronDown size={13} />
        </label>
      </div>
      <div className="metric-grid">
        {metrics.map((m, i) => (
          <div
            className="metric-card"
            key={m.label}
            style={{ animationDelay: `${i * 65}ms` }}
          >
            <div className="metric-top">
              <span>{m.label}</span>
              <span className={`metric-icon ${m.color}`}>
                <m.icon size={17} />
              </span>
            </div>
            <div className="metric-value">
              <strong>{m.value}</strong>
              {m.suffix && <span>{m.suffix}</span>}
              <Sparkline values={m.points} color={m.color} />
            </div>
            <div className="metric-sub">
              <span className={`mini-dot ${m.color}`} />
              {m.sub}
            </div>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel recent-panel">
          <div className="section-heading">
            <div className="heading-with-count">
              <h2>Recent videos</h2>
              <span className="count-pill">{filtered.length}</span>
            </div>
            <Link className="text-button" href="/?view=meetings">
              View all
              <ArrowRight size={14} />
            </Link>
          </div>
          <MeetingTable
            meetings={filtered.slice(0, 5)}
            onOpen={onOpen}
            compact
          />
          {!filtered.length && <EmptyMeetings onUpload={onUpload} />}
        </section>
        <section className="panel followup-panel">
          <div className="section-heading">
            <h2>Your next moves</h2>
            <span className="square-icon">
              <ArrowUpRight size={16} />
            </span>
          </div>
          <p className="section-description">Small steps. Real progress.</p>
          <div className="followup-list">
            {open.slice(0, 3).map(({ item, meeting }) => (
              <ActionPreview
                key={`${meeting.id}-${item.id}`}
                meeting={meeting}
                itemId={item.id}
                onOpen={onOpen}
              />
            ))}
            {!open.length && (
              <div className="empty-state compact">
                <CheckCheck size={26} />
                <p>Nothing left hanging. Nice work.</p>
              </div>
            )}
          </div>
          <Link href="/?view=actions" className="followup-footer">
            All action items
            <span>
              {open.length}
              <ArrowRight size={14} />
            </span>
          </Link>
        </section>
      </div>
      <div className="bottom-note">
        <span className="note-star">
          <Sparkles size={16} />
        </span>
        <p>
          {demo
            ? "A workspace with a little possibility. These sample videos are yours to explore."
            : "The best video summaries are the ones that move your work forward."}
        </p>
        {demo && (
          <span>
            Sample data
            <ArrowDownLeft size={13} />
          </span>
        )}
      </div>
    </div>
  );
}
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const data = values.length > 1 ? values : [0, values[0] || 0];
  const max = Math.max(1, ...data);
  const points = data
    .map((n, i) => `${(i * 80) / (data.length - 1)},${28 - (n / max) * 22}`)
    .join(" ");
  return (
    <svg
      className={`sparkline ${color}`}
      width="80"
      height="32"
      viewBox="0 0 80 32"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
function ActionPreview({
  meeting,
  itemId,
  onOpen,
}: {
  meeting: Meeting;
  itemId: string;
  onOpen: (id: string) => void;
}) {
  const { update, toast } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const item = meeting.items.find((i) => i.id === itemId)!;
  async function toggle() {
    setBusy(true);
    try {
      await update(meeting.id, {
        items: meeting.items.map((i) =>
          i.id === itemId ? { ...i, completed: !i.completed } : i,
        ),
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="action-preview">
      <button
        className={`task-checkbox ${item.completed ? "checked" : ""}`}
        aria-label={`Mark ${item.text} ${item.completed ? "incomplete" : "complete"}`}
        onClick={toggle}
        disabled={busy}
      >
        {busy ? (
          <LoaderCircle size={12} className="spin" />
        ) : item.completed ? (
          <Check size={12} />
        ) : null}
      </button>
      <div>
        <button className="action-title" onClick={() => onOpen(meeting.id)}>
          {item.text}
        </button>
        <div className="action-meta">
          <span className={`project-dot ${projectTone(meeting.project)}`} />
          {meeting.project}
          <span className="action-date">
            {item.dueDate ? formatDue(item.dueDate) : "No due date"}
          </span>
        </div>
      </div>
    </div>
  );
}
function formatDue(date: string) {
  const value = new Date(date.length === 10 ? `${date}T12:00:00` : date);
  return Number.isNaN(value.getTime())
    ? date
    : value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function MeetingTable({
  meetings,
  onOpen,
  compact = false,
}: {
  meetings: Meeting[];
  onOpen: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="table-scroll">
      <table className={`meeting-table ${compact ? "compact" : ""}`}>
        <thead>
          <tr>
            <th>VIDEO</th>
            <th>DATE & TIME</th>
            {!compact && <th>PARTICIPANTS</th>}
            <th>STATUS</th>
            <th aria-label="Open video" />
          </tr>
        </thead>
        <tbody>
          {meetings.map((m) => (
            <tr key={m.id} onClick={() => onOpen(m.id)}>
              <td>
                <div className="meeting-name-cell">
                  <span className={`meeting-icon ${projectTone(m.project)}`}>
                    {m.sourceUrl ? (
                      <Link2 size={18} />
                    ) : m.sourceName ? (
                      <FileAudio2 size={18} />
                    ) : (
                      <Video size={18} />
                    )}
                  </span>
                  <div>
                    <button
                      className="meeting-name"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(m.id);
                      }}
                    >
                      {m.title}
                    </button>
                    <span className="meeting-sub">
                      <span
                        className={`project-dot ${projectTone(m.project)}`}
                      />
                      {m.project}
                      <i />
                      {m.duration > 0
                        ? `${Math.round(m.duration / 60)} min`
                        : "Transcript"}
                    </span>
                  </div>
                </div>
              </td>
              <td>
                <span className="date-main">
                  {new Date(m.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <span className="date-sub">
                  {new Date(m.createdAt).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </td>
              {!compact && (
                <td>
                  <Avatars people={m.participants} />
                </td>
              )}
              <td>
                <MeetingBadge meeting={m} />
              </td>
              <td>
                <button className="row-arrow" aria-label={`Open ${m.title}`}>
                  <ArrowUpRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function EmptyMeetings({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="empty-state">
      <Headphones size={32} />
      <h3>Your next great idea starts here.</h3>
      <p>
        Add your first video to bring its summary and next steps into focus.
      </p>
      <button className="button primary" onClick={onUpload}>
        <Plus size={16} />
        New video analysis
      </button>
    </div>
  );
}

function MeetingsPage({
  onOpen,
  onUpload,
  project,
}: {
  onOpen: (id: string) => void;
  onUpload: () => void;
  project: string;
}) {
  const { meetings } = useWorkspace();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("newest");
  const projects = [...new Set(meetings.map((m) => m.project))];
  const filtered = meetings
    .filter(
      (m) =>
        (project === "all" || m.project === project) &&
        `${m.title} ${m.project} ${m.summary}`
          .toLowerCase()
          .includes(deferred.toLowerCase()) &&
        (status === "all" ||
          (status === "review" &&
            m.items.some((i) => i.review === "needs-review")) ||
          m.status === status),
    )
    .sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : sort === "oldest"
          ? a.createdAt.localeCompare(b.createdAt)
          : b.createdAt.localeCompare(a.createdAt),
    );
  return (
    <div className="page-enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR VIDEO LIBRARY</div>
          <h1>
            Good ideas live here<span className="orange-period">.</span>
          </h1>
          <p>Every video, summary, and next step. All within reach.</p>
        </div>
        <button className="button primary" onClick={onUpload}>
          <Plus size={18} />
          New video analysis
        </button>
      </div>
      <div className="library-toolbar">
        <label className="search-box">
          <Search size={17} />
          <input
            aria-label="Search videos"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a video..."
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
        </label>
        <label className="select-control">
          <FolderClosed size={15} />
          <select
            aria-label="Filter by project"
            value={project}
            onChange={(e) =>
              router.push(
                `/?view=meetings${e.target.value === "all" ? "" : `&project=${encodeURIComponent(e.target.value)}`}`,
              )
            }
          >
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="select-control">
          <ListFilter size={15} />
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="ready">Ready</option>
            <option value="review">Needs review</option>
            <option value="failed">Failed</option>
            <option value="queued">Queued</option>
          </select>
        </label>
        <label className="select-control">
          <ArrowDown size={15} />
          <select
            aria-label="Sort videos"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="title">Title A-Z</option>
          </select>
        </label>
      </div>
      <section className="panel library-panel">
        <div className="section-heading">
          <div className="heading-with-count">
            <h2>{project === "all" ? "All videos" : project}</h2>
            <span className="count-pill">{filtered.length}</span>
          </div>
          <span className="muted small-text">
            A little more organized. A lot more useful.
          </span>
        </div>
        <MeetingTable meetings={filtered} onOpen={onOpen} />
        {!filtered.length &&
          (meetings.length ? (
            <div className="empty-state">
              <Search size={30} />
              <h3>No videos match just yet.</h3>
              <p>Try a different search or clear your filters.</p>
              <button
                className="button secondary"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                  router.push("/?view=meetings");
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <EmptyMeetings onUpload={onUpload} />
          ))}
      </section>
    </div>
  );
}

function ActionsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const { meetings } = useWorkspace();
  const [filter, setFilter] = useState("open");
  const [query, setQuery] = useState("");
  const all = meetings.flatMap((m) =>
    m.items
      .filter((i) => i.kind === "action")
      .map((item) => ({ meeting: m, item })),
  );
  const filtered = all.filter(
    ({ item, meeting }) =>
      (filter === "all" ||
        (filter === "done" ? item.completed : !item.completed)) &&
      `${item.text} ${item.owner} ${meeting.project}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="page-enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">FROM WORDS TO WORK</div>
          <h1>
            Make the next move<span className="orange-period">.</span>
          </h1>
          <p>
            The follow-through that turns a good conversation into real
            progress.
          </p>
        </div>
        <span className="completion-pill">
          <CheckCheck size={17} />
          {all.filter((a) => a.item.completed).length} of {all.length} completed
        </span>
      </div>
      <div className="actions-layout">
        <section className="panel">
          <div className="actions-toolbar">
            <div className="tabs inline-tabs">
              {[
                ["open", "To do"],
                ["done", "Completed"],
                ["all", "Everything"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={filter === id ? "active" : ""}
                  onClick={() => setFilter(id)}
                >
                  {label}
                  <span>
                    {
                      all.filter(
                        (a) =>
                          id === "all" ||
                          (id === "done"
                            ? a.item.completed
                            : !a.item.completed),
                      ).length
                    }
                  </span>
                </button>
              ))}
            </div>
            <label className="search-box">
              <Search size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tasks or owners"
                aria-label="Search action items"
              />
            </label>
          </div>
          <div className="task-list">
            {filtered.map(({ item, meeting }) => (
              <div
                key={`${meeting.id}-${item.id}`}
                className={`task-row ${item.completed ? "completed" : ""}`}
              >
                <ActionPreview
                  meeting={meeting}
                  itemId={item.id}
                  onOpen={onOpen}
                />
                <span className={`priority-tag ${item.priority}`}>
                  {item.priority === "must" ? "High priority" : "Normal"}
                </span>
                <span className="task-owner">
                  <span className="avatar avatar-0">
                    {initials(item.owner || "?")}
                  </span>
                  {item.owner || "Unassigned"}
                </span>
              </div>
            ))}
          </div>
          {!filtered.length && (
            <div className="empty-state">
              <CheckCheck size={30} />
              <h3>
                {filter === "open"
                  ? "A clear list. A clear head."
                  : "Nothing here yet."}
              </h3>
              <p>
                {filter === "open"
                  ? "You have no open tasks matching this view."
                  : "Try another view or search."}
              </p>
            </div>
          )}
        </section>
        <aside className="action-aside">
          <span className="aside-art">
            <CheckSquare2 size={36} strokeWidth={1.3} />
          </span>
          <h2>
            Big things start
            <br />
            with a small check.
          </h2>
          <p>
            Every task is connected to the conversation it came from. Open one
            to see the context, owner, and source.
          </p>
          <div className="progress-track">
            <span
              style={{
                width: `${all.length ? (all.filter((a) => a.item.completed).length / all.length) * 100 : 0}%`,
              }}
            />
          </div>
          <span className="small-text">
            {all.filter((a) => !a.item.completed).length} next steps waiting for
            you
          </span>
        </aside>
      </div>
    </div>
  );
}

function ProjectsPage({ onUpload }: { onUpload: () => void }) {
  const { meetings } = useWorkspace();
  const projects = [...new Set(meetings.map((m) => m.project))];
  return (
    <div className="page-enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">A PLACE FOR EVERY IDEA</div>
          <h1>
            Keep the bigger picture<span className="orange-period">.</span>
          </h1>
          <p>Your conversations, gathered around the work that matters.</p>
        </div>
        <button className="button primary" onClick={onUpload}>
          <Plus size={17} />
          Add meeting to a project
        </button>
      </div>
      <div className="projects-grid">
        {projects.map((p) => {
          const group = meetings.filter((m) => m.project === p);
          const tasks = group.flatMap((m) =>
            m.items.filter((i) => i.kind === "action"),
          );
          const done = tasks.filter((t) => t.completed).length;
          return (
            <Link
              className="project-card"
              key={p}
              href={`/?view=meetings&project=${encodeURIComponent(p)}`}
            >
              <div className={`project-card-art ${projectTone(p)}`}>
                <FolderClosed size={35} strokeWidth={1.3} />
                <span className="project-art-line" />
                <span className="project-art-dot" />
                <ArrowUpRight size={19} className="project-open-arrow" />
              </div>
              <div className="project-card-body">
                <div className="eyebrow">{group.length} CONVERSATIONS</div>
                <h2>{p}</h2>
                <p>
                  {tasks.length - done} open actions ·{" "}
                  {
                    group.flatMap((m) =>
                      m.items.filter((i) => i.kind === "decision"),
                    ).length
                  }{" "}
                  decisions captured
                </p>
                <div className="progress-track">
                  <span
                    style={{
                      width: `${tasks.length ? (done / tasks.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="project-card-footer">
                  <Avatars
                    people={[...new Set(group.flatMap((m) => m.participants))]}
                  />
                  <span>
                    {done}/{tasks.length} tasks complete
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      {!projects.length && <EmptyMeetings onUpload={onUpload} />}
    </div>
  );
}

function SettingsPage({ onSignIn }: { onSignIn: () => void }) {
  const { demo, session, config, reset, toast } = useWorkspace();
  const [confirmReset, setConfirmReset] = useState(false);
  const services = [
    {
      label: "Workspace & secure storage",
      connected: config.database,
      text: "Your account, video library, and private uploads.",
    },
    {
      label: "Meeting intelligence",
      connected: config.ai,
      text: "Evidence-backed extraction, summaries, and questions.",
    },
    {
      label: "Recording transcription",
      connected: config.transcription,
      text: "Speech-to-text with timing and speaker labels.",
    },
    {
      label: "Multi-platform video links",
      connected: config.videoLinks || config.transcription,
      text: "YouTube captions or resolver-backed TikTok, Instagram, Vimeo, and X links.",
    },
    {
      label: "Background processing",
      connected: config.jobs,
      text: "Reliable processing that continues after you leave.",
    },
  ];
  async function signOut() {
    const { error } = await browserDatabase()!.auth.signOut();
    if (error) toast(error.message);
    else toast("You have been signed out.");
  }
  return (
    <div className="page-enter settings-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE YOURSELF AT HOME</div>
          <h1>
            Your workspace, your way<span className="orange-period">.</span>
          </h1>
          <p>A few details that keep everything running smoothly.</p>
        </div>
      </div>
      <section className="panel settings-section">
        <div className="section-heading">
          <h2>Your account</h2>
          <span className="status-badge ready">
            <span />
            {demo ? "Demo workspace" : "Signed in"}
          </span>
        </div>
        <div className="account-settings">
          <span className="profile-avatar">
            {demo ? "DE" : initials(session?.user.email || "Me")}
          </span>
          <div>
            <strong>{demo ? "Demo explorer" : session?.user.email}</strong>
            <p>
              {demo
                ? "Sample data lives in this browser. Sign in to use a private, synced workspace."
                : "Your video analyses are private and connected to this account."}
            </p>
          </div>
          <button
            className="button secondary"
            onClick={demo ? onSignIn : signOut}
          >
            {demo ? (
              <>
                <ArrowRight size={16} />
                Sign in
              </>
            ) : (
              <>
                <LogOut size={16} />
                Sign out
              </>
            )}
          </button>
        </div>
      </section>
      <section className="panel settings-section">
        <div className="section-heading">
          <h2>Workspace connections</h2>
          <span className="small-text muted">Configuration status</span>
        </div>
        <div className="service-list">
          {services.map((s) => (
            <div key={s.label}>
              <span
                className={`service-icon ${s.connected ? "sage" : "neutral"}`}
              >
                {s.connected ? <Check size={19} /> : <Settings2 size={19} />}
              </span>
              <div>
                <strong>{s.label}</strong>
                <p>{s.text}</p>
              </div>
              <span
                className={`connection-badge ${s.connected ? "connected" : ""}`}
              >
                {s.connected ? "Configured" : "Not connected"}
              </span>
            </div>
          ))}
        </div>
        <details className="deployment-details">
          <summary>
            <BookOpen size={16} />
            Deployment setup
          </summary>
          <div>
            <p>
              The project includes a complete setup guide in{" "}
              <code>docs/DEPLOYMENT.md</code>. Connect Supabase, Groq, OpenAI,
              and Inngest through your Vercel environment settings, then
              redeploy.
            </p>
            <p>
              Provider keys stay on the server. The status above confirms
              configuration is present; it does not test provider access or
              billing.
            </p>
            <a
              href="https://vercel.com/new"
              target="_blank"
              rel="noreferrer"
              className="text-button"
            >
              Open Vercel
              <ArrowUpRight size={15} />
            </a>
          </div>
        </details>
      </section>
      <section className="panel settings-section">
        <div className="section-heading">
          <h2>{demo ? "Sample workspace" : "Your data"}</h2>
          <ShieldCheck size={19} />
        </div>
        <div className="data-settings">
          <div>
            <strong>
              {demo ? "Start fresh, anytime" : "You stay in control"}
            </strong>
            <p>
              {demo
                ? "Restore the original fictional videos and reset your demo edits."
                : "Export individual video summaries from their review page. Delete a video to remove its source metadata and notes from your workspace."}
            </p>
          </div>
          {demo && (
            <button
              className="button secondary"
              onClick={() => setConfirmReset(true)}
            >
              Reset sample data
            </button>
          )}
        </div>
      </section>
      {confirmReset && (
        <Modal title="Start fresh?" onClose={() => setConfirmReset(false)}>
          <p className="modal-intro">
            This restores the sample videos and removes your demo edits in
            this browser.
          </p>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setConfirmReset(false)}
            >
              Keep my edits
            </button>
            <button
              className="button primary"
              onClick={() => {
                reset();
                setConfirmReset(false);
              }}
            >
              Reset samples
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
