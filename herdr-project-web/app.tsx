import "./style.css";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { WorktreeDiffView, WorktreeList } from "./diffs.tsx";
import { FileView } from "./files.tsx";
import { halMessage } from "./hal.ts";
import { LearningsView } from "./learnings.tsx";
import { pageTitle, route, tab } from "./pages.ts";
import { ProjectsColumn, pressing } from "./projects.tsx";
import type { State } from "./state.ts";
import { Links } from "./ui.tsx";
import { WatcherColumn } from "./watcher.tsx";

// The commit the server runs, set when it bundles the page.
declare const VERSION: string;

// The watcher writes at least every five minutes while it runs.
const STALE_MS = 11 * 60 * 1000;

/** Returns text as HAL's readout. */
function Readout({ text }: { text: string }) {
  return (
    <p class="readout">
      <span class="readout-text" aria-live="polite">
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
    // A server restarted on other code serves another page.
    events.addEventListener("version", (e) => {
      if (JSON.parse(e.data) !== VERSION) location.reload();
    });
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

  useEffect(() => {
    document.title = title;
  }, [title]);

  const stale = state?.watchedAt ? now - Date.parse(state.watchedAt) > STALE_MS : true;
  const message = halMessage({
    connected,
    running: !!state?.sections,
    stale,
    waiting,
  });

  return (
    <Links.Provider value={state?.links ?? {}}>
      <div class="page">
        <header class="top">
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
          <span class="version" title="The commit the server runs">
            {VERSION}
          </span>
        </header>
        {at.view === "worktrees" ? (
          <WorktreeList query={q} />
        ) : at.view === "learnings" ? (
          <LearningsView query={q} />
        ) : at.view === "diff" ? (
          <WorktreeDiffView dir={at.dir} query={q} />
        ) : at.view === "file" ? (
          <FileView
            dir={at.dir}
            name={at.name}
            at={state?.projects.find((p) => p.dir === at.dir)?.files.find((f) => f.name === at.name)?.at ?? null}
          />
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
