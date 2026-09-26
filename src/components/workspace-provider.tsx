"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { browserDatabase } from "@/lib/supabase";
import { demoMeetings } from "@/lib/demo";
import type { Meeting, Item } from "@/lib/domain";

type Patch = {
  items?: Item[];
  summary?: string;
  title?: string;
  speaker?: { from: string; to: string };
};
type Config = {
  database: boolean;
  ai: boolean;
  transcription: boolean;
  jobs: boolean;
};
type Workspace = {
  meetings: Meeting[];
  loading: boolean;
  session: Session | null;
  demo: boolean;
  config: Config;
  toast: (text: string) => void;
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
  refresh: () => Promise<void>;
  update: (id: string, patch: Patch) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reset: () => void;
};
const Context = createContext<Workspace | null>(null);
const STORAGE_KEY = "folio-demo-workspace-v1";

async function fetchLibrary(token: string): Promise<Meeting[]> {
  const meetings: Meeting[] = [];
  let offset: number | null = 0;
  while (offset !== null && offset < 200) {
    const response: Response = await fetch(`/api/meetings?offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result: { meetings: Meeting[]; nextOffset: number | null; error?: string } = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Could not load your meetings.");
    meetings.push(...result.meetings);
    offset = result.nextOffset;
  }
  return meetings;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [meetings, setMeetings] = useState<Meeting[]>(demoMeetings);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [config, setConfig] = useState<Config>({
    database: false,
    ai: false,
    transcription: false,
    jobs: false,
  });
  const demo = !session;

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const db = browserDatabase();
    const { data } = db
      ? await db.auth.getSession()
      : { data: { session: null } };
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(data.session
          ? { Authorization: `Bearer ${data.session.access_token}` }
          : {}),
        ...init?.headers,
      },
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "The request could not be completed.");
    return result as T;
  }
  async function refresh() {
    if (!session) return;
    const current = (await browserDatabase()!.auth.getSession()).data.session;
    if (current) setMeetings(await fetchLibrary(current.access_token));
  }
  useEffect(() => {
    let mounted = true;
    let revision = 0;
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        if (mounted) setConfig(data);
      })
      .catch(() => {});
    const db = browserDatabase();
    function loadDemo() {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        const parsed = stored ? JSON.parse(stored) : null;
        setMeetings(
          Array.isArray(parsed) &&
            parsed.every(
              (m) =>
                m.id && Array.isArray(m.items) && Array.isArray(m.transcript),
            )
            ? parsed
            : demoMeetings(),
        );
      } catch {
        setMeetings(demoMeetings());
      }
      setLoading(false);
    }
    async function loadSession(current: Session | null) {
      if (!mounted) return;
      const requestRevision = ++revision;
      setSession(current);
      if (!current) {
        loadDemo();
        return;
      }
      setLoading(true);
      setMeetings([]);
      try {
        const result = await fetchLibrary(current.access_token);
        if (mounted && revision === requestRevision) setMeetings(result);
      } catch (error) {
        if (mounted && revision === requestRevision)
          setNotice(
            error instanceof Error
              ? error.message
              : "Could not load your meetings.",
          );
      } finally {
        if (mounted && revision === requestRevision) setLoading(false);
      }
    }
    if (!db) {
      queueMicrotask(() => {
        if (mounted) loadDemo();
      });
      return () => {
        mounted = false;
      };
    }
    db.auth.getSession().then(({ data }) => loadSession(data.session));
    const { data: listener } = db.auth.onAuthStateChange((event, current) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT")
        void loadSession(current);
      else if (event === "TOKEN_REFRESHED") setSession(current);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!loading && !session) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(meetings));
      } catch {
        /* The sample workspace can still be explored when browser storage is unavailable. */
      }
    }
  }, [meetings, loading, session]);
  const processing = meetings.some(
    (m) => !["ready", "failed"].includes(m.status),
  );
  useEffect(() => {
    if (!session || !processing) return;
    let cancelled = false;
    let fetching = false;
    const timer = setInterval(async () => {
      if (fetching) return;
      const db = browserDatabase();
      const token = (await db?.auth.getSession())?.data.session?.access_token;
      if (!token) return;
      fetching = true;
      try {
        const meetings = await fetchLibrary(token);
        if (!cancelled) setMeetings(meetings);
      } catch {
        /* Leave the persisted stage visible until the next poll succeeds. */
      } finally {
        fetching = false;
      }
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session, processing]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function update(id: string, patch: Patch) {
    let result: Meeting;
    if (!demo)
      result = (
        await api<{ meeting: Meeting }>(`/api/meetings/${id}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        })
      ).meeting;
    else {
      const current = meetings.find((m) => m.id === id);
      if (!current) return;
      const { speaker, ...fields } = patch;
      result = { ...current, ...fields };
      if (speaker) {
        result.transcript = current.transcript.map((s) =>
          s.speaker === speaker.from ? { ...s, speaker: speaker.to } : s,
        );
        result.participants = [
          ...new Set(
            current.participants.map((p) =>
              p === speaker.from ? speaker.to : p,
            ),
          ),
        ];
        result.items = result.items.map((i) =>
          i.owner === speaker.from ? { ...i, owner: speaker.to } : i,
        );
      }
    }
    setMeetings((previous) => previous.map((m) => (m.id === id ? result : m)));
  }
  async function remove(id: string) {
    if (!demo) await api(`/api/meetings/${id}`, { method: "DELETE" });
    setMeetings((previous) => previous.filter((m) => m.id !== id));
    setNotice("Meeting deleted.");
  }
  return (
    <Context.Provider
      value={{
        meetings,
        loading,
        session,
        demo,
        config,
        api,
        refresh,
        update,
        remove,
        reset: () => {
          setMeetings(demoMeetings());
          setNotice("Sample workspace restored.");
        },
        toast: setNotice,
      }}
    >
      {loading ? (
        <div className="app-loading">
          <h1>
            folio<span className="orange-period">.</span>
          </h1>
          <p>Opening your workspace...</p>
        </div>
      ) : (
        children
      )}
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            x
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
export function useWorkspace() {
  const context = useContext(Context);
  if (!context) throw new Error("Workspace provider is missing.");
  return context;
}
