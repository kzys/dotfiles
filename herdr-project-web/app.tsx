import "./style.css";
import { AskAgents } from "./ask/view.tsx";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { WorktreeDiffView } from "./diff/view.tsx";
import { FileView } from "./files.tsx";
import { halMessage } from "./hal.ts";
import { LearningsView } from "./learnings.tsx";
import { isPagePath, locationKey, pageTitle, route, tab } from "./pages.ts";
import { BoardView } from "./board.tsx";
import { ProjectList, ProjectView, pressing } from "./projects.tsx";
import type { State } from "./state.ts";
import { Links } from "./ui.tsx";

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
  ["ask", "/", "Ask"],
  ["projects", "/projects", "Projects"],
  ["pulls", "/pulls", "Pulls"],
  ["learnings", "/#learnings", "Learnings"],
] as const;

/** Returns where a click on a link of the page's own goes, if the page
 * shows it without loading again, or null. A link to a # is to one at /,
 * wherever the page is. */
function ownLink(e: MouseEvent): URL | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as Element | null)?.closest?.("a");
  const href = a?.getAttribute("href");
  if (!a || !href || a.target || a.hasAttribute("download")) return null;
  const url = new URL(href.startsWith("#") ? `/${href}` : href, location.href);
  return url.origin === location.origin && isPagePath(url.pathname) ? url : null;
}

/** Returns the page's location as locationKey reads it, kept current,
 * following the page's own links without loading it again. */
function useLocation(): string {
  const read = () => locationKey(location.pathname, location.hash);
  const [key, setKey] = useState(read);
  useEffect(() => {
    const changed = () => setKey(read());
    const click = (e: MouseEvent) => {
      const url = ownLink(e);
      if (!url) return;
      e.preventDefault();
      if (url.href !== location.href) history.pushState(null, "", url);
      changed();
    };
    addEventListener("hashchange", changed);
    addEventListener("popstate", changed);
    addEventListener("click", click);
    return () => {
      removeEventListener("hashchange", changed);
      removeEventListener("popstate", changed);
      removeEventListener("click", click);
    };
  }, []);
  return key;
}

function App() {
  const at = route(useLocation());
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
      // What is typed in a comment is the comment's.
      if (e.target instanceof HTMLTextAreaElement) return;
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
  const waiting = (state?.projects ?? []).flatMap((p) => p.items).filter(pressing).length;

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
        {at.view === "learnings" ? (
          <LearningsView query={q} />
        ) : at.view === "diff" ? (
          <WorktreeDiffView key={at.dir} dir={at.dir} project={at.project} query={q} state={state} />
        ) : at.view === "project" ? (
          <ProjectView key={at.dir} dir={at.dir} state={state} query={q} now={now} />
        ) : at.view === "file" ? (
          <FileView
            dir={at.dir}
            name={at.name}
            state={state}
            at={state?.projects.find((p) => p.dir === at.dir)?.files.find((f) => f.name === at.name)?.at ?? null}
          />
        ) : !state ? (
          <p class="empty">Loading…</p>
        ) : at.view === "pulls" ? (
          <BoardView state={state} query={q} now={now} />
        ) : at.view === "projects" ? (
          <ProjectList state={state} query={q} />
        ) : (
          <AskAgents state={state} query={q} />
        )}
      </div>
    </Links.Provider>
  );
}

render(<App />, document.getElementById("app")!);
