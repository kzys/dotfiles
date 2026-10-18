// The fonts come with the page, which may be used offline.
import "@fontsource/jost/latin-300.css";
import "@fontsource/jost/latin-400.css";
import "@fontsource/jost/latin-500.css";
import "@fontsource/jost/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./style.css";
import { createContext, render } from "preact";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { WorktreeDiffView, WorktreeList } from "./diffs.tsx";
import { QUOTES, halMessage } from "./hal.ts";
import { type Item, linkParts, uniqueKeys } from "./inbox.ts";
import { type AgentState, agentState, readiness, runsByState } from "./pulls.ts";
import type { Project, PullRequest, Run, Section, State } from "./state.ts";

// The watcher writes at least every five minutes while it runs.
const STALE_MS = 11 * 60 * 1000;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// The items the page has shown, by key. Those that appear after the
// first state flash as they arrive; those that only reappear, as after
// filtering, don't.
const seen = new Set<string>();
let primed = false;

const MARKS: Record<string, string> = {
  you: "you",
  "?": "likely",
  maybe: "maybe",
  close: "close",
  ctx: "context",
  idle: "idle",
};

/** Returns a short, relative form of the time iso, from now. */
function ago(iso: string | null, now: number): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// The URLs of the open pull requests by their labels, like name#N.
const Links = createContext<Record<string, string>>({});

/** Returns text with URLs, and the labels of pull requests in Links, as
 * links. */
function Linked({ text }: { text: string }) {
  return (
    <>
      {linkParts(text, useContext(Links)).map(([p, href]) =>
        href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </>
  );
}

function Mark({ mark }: { mark: string }) {
  return <span class={`mark mark-${MARKS[mark] ?? "other"}`}>{MARKS[mark] ?? mark}</span>;
}

function ItemRow({ item, id }: { item: Item; id: string }) {
  const [fresh] = useState(() => {
    const isNew = primed && !seen.has(id);
    seen.add(id);
    return isNew;
  });
  return (
    <li class={fresh ? "item fresh" : "item"}>
      <Mark mark={item.mark} />
      {item.role && <span class="role">{item.role}</span>}
      <span class="text">
        <Linked text={item.text} />
      </span>
    </li>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(project.dir);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  return (
    <section class="card">
      <header>
        {project.workspaces
          .filter((w) => w !== project.name)
          .map((w) => (
            <span key={w} class="workspace" title="Herdr workspace">
              {w}
            </span>
          ))}
        <span class="name">{project.name}</span>
        <span class="title">{project.title}</span>
        <button class="copy" onClick={copy} title={`Copy ${project.dir}`}>
          {copied ? "copied" : "path"}
        </button>
      </header>
      <ul>
        {uniqueKeys(project.items.map((i) => `${project.dir}:${i.role}:${i.mark}:${i.text}`)).map(
          (id, n) => (
            <ItemRow key={id} id={id} item={project.items[n]} />
          ),
        )}
      </ul>
    </section>
  );
}

/** Returns how the checks of a pull request went, for its status dot,
 * from their rollup state. */
function checksState(checks: string | null): [string, string] {
  if (checks === "SUCCESS") return ["passed", "Checks passed"];
  if (checks === "FAILURE" || checks === "ERROR") return ["failed", "Checks failed"];
  if (checks === "PENDING" || checks === "EXPECTED") return ["pending", "Checks running"];
  return ["none", "No checks"];
}

/** Returns the names of runs, each linked to its details if known. */
function RunNames({ runs }: { runs: Run[] }) {
  return (
    <>
      {uniqueKeys(runs.map((r) => r.name)).map((key, i) => {
        const r = runs[i];
        return (
          <span key={key}>
            {i > 0 && ", "}
            {r.url ? (
              <a href={r.url} target="_blank" rel="noreferrer">
                {r.name}
              </a>
            ) : (
              r.name
            )}
          </span>
        );
      })}
    </>
  );
}

/** Returns a bar of pr's checks, a segment for each by state, and what
 * failed or still runs. */
function Checks({ pr }: { pr: PullRequest }) {
  const by = runsByState(pr);
  const total = pr.runs?.length ?? 0;
  if (!total) return null;
  return (
    <div class="runs">
      <div class="runs-bar" aria-hidden="true">
        {(["passed", "skipped", "cancelled", "failed", "running"] as const).map(
          (state) =>
            by[state].length > 0 && (
              <span key={state} class={`run-${state}`} style={{ flexGrow: by[state].length }} />
            ),
        )}
      </div>
      <span class="runs-count">
        {by.passed.length}/{total} passed
      </span>
      {by.failed.length > 0 && (
        <span class="runs-failed">
          failed: <RunNames runs={by.failed} />
        </span>
      )}
      {by.running.length > 0 && (
        <span class="runs-running">
          running: <RunNames runs={by.running} />
        </span>
      )}
      {!by.failed.length && !by.running.length && (
        <span class="runs-done">all done</span>
      )}
    </div>
  );
}

const AGENT_LABELS: Record<AgentState, string> = {
  working: "agent working",
  blocked: "agent needs you",
  idle: "agent idle",
  unknown: "agent on it",
};

function PullRequestRow({
  pr,
  agents,
}: {
  pr: PullRequest;
  agents: Record<string, string> | null;
}) {
  const [state, label] = checksState(pr.checks);
  const agent = agentState(pr, agents);
  const [ready, kind] = readiness(pr, agent);
  // When the agent decides the pill, the pill says what it does.
  const agentInPill = ready !== readiness(pr)[0];
  return (
    <li class="pr">
      <span class={`checks checks-${state}`} title={label} aria-label={label} />
      <div class="pr-main">
        <a class="pr-title" href={pr.url} target="_blank" rel="noreferrer">
          {pr.title}
        </a>
        <span class={`badge badge-${kind}`}>{ready}</span>
        <div class="pr-meta">
          <span class="pr-label">
            {pr.repo}#{pr.number}
          </span>
          {pr.project && <span class="workspace">{pr.project}</span>}
          {agent && !agentInPill && (
            <span class={`pr-agent agent-${agent}`}>{AGENT_LABELS[agent]}</span>
          )}
          {!pr.runs && pr.failed.length > 0 && (
            <span class="pr-failed">failed: {pr.failed.join(", ")}</span>
          )}
        </div>
        <Checks pr={pr} />
      </div>
    </li>
  );
}

function WatchSection({
  section,
  query,
  agents,
  now,
}: {
  section: Section;
  query: string;
  agents: Record<string, string> | null;
  now: number;
}) {
  const hhmm = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  const at = hhmm(section.at);
  // Past its next check, the section is being checked, which may take a
  // while, as for those that ask Claude.
  const due = section.next ? Date.parse(section.next) <= now : false;
  const next = hhmm(section.next);
  const prs = section.pullRequests?.filter((pr) =>
    matches(query, pr.title, pr.repo, pr.label, pr.project));
  return (
    <section class="watch">
      <h3>
        {section.title}
        {at && (
          <span class="checked">
            <time dateTime={section.at!}>{at}</time>
            {next &&
              (due ? (
                " · checking…"
              ) : (
                <>
                  {" · next "}
                  <time dateTime={section.next!}>{next}</time>
                </>
              ))}
          </span>
        )}
      </h3>
      {prs ? (
        prs.length ? (
          <ul class="prs">
            {prs.map((pr) => (
              <PullRequestRow key={pr.url} pr={pr} agents={agents} />
            ))}
          </ul>
        ) : (
          <p class="empty">{query ? "No match." : "None open."}</p>
        )
      ) : section.lines.length ? (
        <pre>
          {section.lines.map((l, i) => (
            <div key={i}>
              <Linked text={l} />
            </div>
          ))}
        </pre>
      ) : (
        <p class="empty">Nothing.</p>
      )}
    </section>
  );
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

/** Returns the monolith that stands where nothing waits. */
function Monolith() {
  return (
    <div class="monolith-scene">
      <div class="monolith" />
      <p>Nothing waiting.</p>
    </div>
  );
}

/** Reports whether item surely waits on the user: tagged [you] or
 * found by the watcher, not guessed or suggested. */
const pressing = (item: Item) => !["?", "maybe", "close"].includes(item.mark);

/** Reports whether any of texts contains query, ignoring case. */
const matches = (query: string, ...texts: (string | null)[]) =>
  !query || texts.some((t) => t?.toLowerCase().includes(query));

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

/** Returns s decoded from a URL, or as is if it isn't encoded right. */
function decodeHash(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function App() {
  const hash = useHash();
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
  const projects = useMemo(
    () =>
      (state?.projects ?? [])
        .map((p) => ({
          ...p,
          items: matches(q, p.name, p.title)
            ? p.items
            : p.items.filter((i) => matches(q, i.text, i.role)),
        }))
        .filter((p) => p.items.length),
    [state, q],
  );
  const unowned = (state?.unowned ?? []).filter((i) => matches(q, i.text));
  const waiting = [...(state?.projects ?? []).flatMap((p) => p.items), ...(state?.unowned ?? [])]
    .filter(pressing).length;

  const [booting, setBooting] = useState(true);
  useEffect(() => {
    if (!state || primed) return;
    primed = true;
    const timer = setTimeout(() => setBooting(false), 1500);
    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    document.title = waiting ? `(${waiting}) watch` : "watch";
  }, [waiting]);

  const stale = state?.watchedAt ? now - Date.parse(state.watchedAt) > STALE_MS : true;
  // HAL's eye says how things stand: lit while live, dimmed while the
  // watcher is quiet, dark without the server.
  const eyeTitle = [
    connected ? "Live" : "Reconnecting",
    state?.sections ? `watcher updated ${ago(state.watchedAt, now)}` : "watcher not running",
    "click to talk to HAL",
  ].join(" · ");
  const [quote, setQuote] = useState<string | null>(null);
  const message =
    quote ??
    halMessage({
      connected,
      running: !!state?.sections,
      stale,
      waiting,
      hour: new Date(now).getHours(),
    });
  // Asked directly, HAL quotes the film for a while.
  const askHal = () => {
    setQuote(QUOTES[(QUOTES.indexOf(quote ?? "") + 1) % QUOTES.length]);
  };
  useEffect(() => {
    if (!quote) return;
    const timer = setTimeout(() => setQuote(null), 8000);
    return () => clearTimeout(timer);
  }, [quote]);

  return (
    <Links.Provider value={state?.links ?? {}}>
      <div class={booting ? "page booting" : "page"}>
        <header class="top">
          <button
            class={`status ${!connected || !state ? "off" : stale ? "stale" : "on"}`}
            onClick={askHal}
            title={eyeTitle}
          />
          <Readout text={message} />
          <nav>
            <a href="#" class={hash.startsWith("diffs") ? "" : "here"}>
              Inbox
            </a>
            <a href="#diffs" class={hash.startsWith("diffs") ? "here" : ""}>
              Diffs
            </a>
          </nav>
          <input
            ref={filter}
            type="search"
            placeholder="Filter  /"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </header>
        {hash === "diffs" ? (
          <WorktreeList query={q} />
        ) : hash.startsWith("diffs/") ? (
          <WorktreeDiffView dir={decodeHash(hash.slice("diffs/".length))} query={q} />
        ) : !state ? (
          <p class="empty">Loading…</p>
        ) : (
          <main>
            <div class="column">
              <h2>
                Inbox <span class="count">{waiting}</span>
              </h2>
              {unowned.length > 0 && (
                <section class="card">
                  <header>
                    <span class="name">elsewhere</span>
                  </header>
                  <ul>
                    {uniqueKeys(unowned.map((i) => `:${i.mark}:${i.text}`)).map((id, n) => (
                      <ItemRow key={id} id={id} item={unowned[n]} />
                    ))}
                  </ul>
                </section>
              )}
              {projects.map((p) => (
                <ProjectCard key={p.dir} project={p} />
              ))}
              {!projects.length && !unowned.length && (q ? <p class="empty">No match.</p> : <Monolith />)}
            </div>
            <div class="column">
              <h2>Watcher</h2>
              {state.sections ? (
                state.sections.map((s) => (
                  <WatchSection
                    key={s.title}
                    section={s}
                    query={q}
                    agents={state.agents ?? null}
                    now={now}
                  />
                ))
              ) : (
                <p class="empty">
                  No screen.json yet. Run <code>herdr-project --watch</code>.
                </p>
              )}
            </div>
          </main>
        )}
      </div>
    </Links.Provider>
  );
}

render(<App />, document.getElementById("app")!);
