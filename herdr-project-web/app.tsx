// The monospace font comes with the page, which may be used offline.
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./style.css";
import { render } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { WorktreeDiffView, WorktreeList } from "./diffs.tsx";
import { halMessage } from "./hal.ts";
import { LearningsView } from "./learnings.tsx";
import { pageTitle, route, tab } from "./pages.ts";
import { ProjectsColumn, pressing, prime } from "./projects.tsx";
import type { State } from "./state.ts";
import { Links } from "./ui.tsx";
import { WatcherColumn } from "./watcher.tsx";

// The watcher writes at least every five minutes while it runs.
const STALE_MS = 11 * 60 * 1000;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Returns a short, relative form of the time iso, from now. */
function ago(iso: string | null, now: number): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Returns text typed out a character at a time, as HAL's readout. */
function Readout({ text }: { text: string }) {
  const [shown, setShown] = useState(text.length);
  useLayoutEffect(() => {
    if (reducedMotion()) return setShown(text.length);
    setShown(0);
    const timer = setInterval(
      () => setShown((n) => (n >= text.length ? (clearInterval(timer), n) : n + 1)),
      22,
    );
    return () => clearInterval(timer);
  }, [text]);
  return (
    <p class="readout">
      <span class="readout-text" aria-hidden="true">
        {text.slice(0, shown)}
      </span>
      <span class="caret" />
      <span class="sr-only" aria-live="polite">
        {text}
      </span>
    </p>
  );
}

// The tabs of the console strip, each with its link.
const TABS = [
  ["projects", "#", "Projects"],
  ["worktrees", "#diffs", "Worktrees"],
  ["learnings", "#learnings", "Learnings"],
] as const;

/** Returns the page's location after its #, kept current. */
function useHash(): string {
  const [hash, setHash] = useState(location.hash.slice(1));
  useEffect(() => {
    const changed = () => setHash(location.hash.slice(1));
    addEventListener("hashchange", changed);
    return () => removeEventListener("hashchange", changed);
  }, []);
  return hash;
}

function App() {
  const at = route(useHash());
  const title = pageTitle(at);
  const [state, setState] = useState<State | null>(null);
  const [connected, setConnected] = useState(false);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now());
  const filter = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const events = new EventSource("/api/events");
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.onmessage = (e) => setState(JSON.parse(e.data));
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      events.close();
      clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== filter.current) {
        e.preventDefault();
        filter.current?.focus();
      } else if (e.key === "Escape") {
        setQuery("");
        filter.current?.blur();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const waiting = [...(state?.projects ?? []).flatMap((p) => p.items), ...(state?.unowned ?? [])]
    .filter(pressing).length;

  const [booting, setBooting] = useState(true);
  useEffect(() => {
    if (!state || prime()) return;
    const timer = setTimeout(() => setBooting(false), 1500);
    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    document.title = title;
  }, [title]);

  const stale = state?.watchedAt ? now - Date.parse(state.watchedAt) > STALE_MS : true;
  // HAL's eye says how things stand: lit while live, dimmed while the
  // watcher is quiet, dark without the server.
  const eyeTitle = [
    connected ? "Live" : "Reconnecting",
    state?.sections ? `watcher updated ${ago(state.watchedAt, now)}` : "watcher not running",
  ].join(" · ");
  const message = halMessage({
    connected,
    running: !!state?.sections,
    stale,
    waiting,
    hour: new Date(now).getHours(),
  });

  return (
    <Links.Provider value={state?.links ?? {}}>
      <div class={booting ? "page booting" : "page"}>
        <header class="top">
          <a
            href="#"
            class={`status ${!connected || !state ? "off" : stale ? "stale" : "on"}`}
            title={eyeTitle}
            aria-label={`Projects · ${eyeTitle}`}
          />
          <Readout text={message} />
          <nav>
            {TABS.map(([t, href, label]) => (
              <a key={t} href={href} class={tab(at) === t ? "here" : ""}>
                {label}
              </a>
            ))}
          </nav>
          <input
            ref={filter}
            type="search"
            placeholder="Filter  /"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </header>
        {at.view === "worktrees" ? (
          <WorktreeList query={q} />
        ) : at.view === "learnings" ? (
          <LearningsView query={q} />
        ) : at.view === "diff" ? (
          <WorktreeDiffView dir={at.dir} query={q} />
        ) : !state ? (
          <p class="empty">Loading…</p>
        ) : (
          <main>
            <ProjectsColumn state={state} query={q} waiting={waiting} />
            <WatcherColumn state={state} query={q} now={now} />
          </main>
        )}
      </div>
    </Links.Provider>
  );
}

render(<App />, document.getElementById("app")!);
