import { createContext, render } from "preact";
import { useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { type Item, linkParts } from "./inbox.ts";
import type { Project, PullRequest, Section, State } from "./state.ts";

// The watcher writes at least every five minutes while it runs.
const STALE_MS = 11 * 60 * 1000;

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

function ItemRow({ item }: { item: Item }) {
  return (
    <li class="item">
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
        {project.items.map((item, i) => (
          <ItemRow key={i} item={item} />
        ))}
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

function PullRequestRow({ pr }: { pr: PullRequest }) {
  const [state, label] = checksState(pr.checks);
  return (
    <li class="pr">
      <span class={`checks checks-${state}`} title={label} aria-label={label} />
      <div class="pr-main">
        <a class="pr-title" href={pr.url} target="_blank" rel="noreferrer">
          {pr.title}
        </a>
        {pr.draft && <span class="badge">draft</span>}
        {pr.review === "APPROVED" && <span class="badge badge-ok">approved</span>}
        {pr.review === "CHANGES_REQUESTED" && (
          <span class="badge badge-bad">changes requested</span>
        )}
        <div class="pr-meta">
          <span class="pr-label">{pr.repo}#{pr.number}</span>
          {pr.project && <span class="workspace">{pr.project}</span>}
          {pr.agent && <span class="pr-agent">agent on it</span>}
          {pr.failed.length > 0 && <span class="pr-failed">failed: {pr.failed.join(", ")}</span>}
        </div>
      </div>
    </li>
  );
}

function WatchSection({ section, query }: { section: Section; query: string }) {
  const at = section.at ? new Date(section.at) : null;
  const prs = section.pullRequests?.filter((pr) =>
    matches(query, pr.title, pr.repo, pr.label, pr.project));
  return (
    <section class="watch">
      <h3>
        {section.title}
        {at && <time>{at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>}
      </h3>
      {prs ? (
        prs.length ? (
          <ul class="prs">
            {prs.map((pr) => (
              <PullRequestRow key={pr.url} pr={pr} />
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

/** Reports whether item surely waits on the user: tagged [you] or
 * found by the watcher, not guessed or suggested. */
const pressing = (item: Item) => !["?", "maybe", "close"].includes(item.mark);

/** Reports whether any of texts contains query, ignoring case. */
const matches = (query: string, ...texts: (string | null)[]) =>
  !query || texts.some((t) => t?.toLowerCase().includes(query));

function App() {
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

  useEffect(() => {
    document.title = waiting ? `(${waiting}) watch` : "watch";
  }, [waiting]);

  const stale = state?.watchedAt ? now - Date.parse(state.watchedAt) > STALE_MS : true;

  return (
    <Links.Provider value={state?.links ?? {}}>
      <div class="page">
        <header class="top">
          <h1>watch</h1>
          <span class={`status ${connected ? "on" : "off"}`}>{connected ? "live" : "reconnecting"}</span>
          <span class={`watcher ${stale ? "stale" : ""}`}>
            watcher {state?.sections ? ago(state.watchedAt, now) : "not running"}
          </span>
          <input
            ref={filter}
            type="search"
            placeholder="Filter  /"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </header>
        {!state ? (
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
                    {unowned.map((item, i) => (
                      <ItemRow key={i} item={item} />
                    ))}
                  </ul>
                </section>
              )}
              {projects.map((p) => (
                <ProjectCard key={p.dir} project={p} />
              ))}
              {!projects.length && !unowned.length && <p class="empty">Nothing waiting.</p>}
            </div>
            <div class="column">
              <h2>Watcher</h2>
              {state.sections ? (
                state.sections.map((s) => <WatchSection key={s.title} section={s} query={q} />)
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
