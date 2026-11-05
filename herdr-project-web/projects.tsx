// The page's view of the open projects and what waits on the user in
// them.

import { useMemo, useState } from "preact/hooks";
import { diffHref } from "./diffs.tsx";
import { FileSection } from "./files.tsx";
import { FULL_AT, type Item, uniqueKeys } from "./inbox.ts";
import { fileHref, projectHref } from "./pages.ts";
import { projectSections, statusState } from "./pulls.ts";
import type { AgentView } from "./agents.ts";
import type { Pane, Project, State } from "./state.ts";
import { Linked, matches, send } from "./ui.tsx";
import { WatchSection } from "./watcher.tsx";

const MARKS: Record<string, string> = {
  you: "you",
  "?": "likely",
  maybe: "maybe",
  close: "close",
  ctx: "context",
  idle: "idle",
};

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

const agentUrl = (pane: string, action: string) => `/api/agents/${encodeURIComponent(pane)}/${action}`;

/** Returns what the agent in pane waits for, if anything, its waiting
 * messages, and a button that focuses its pane. */
function AgentControls({ pane, view }: { pane: Pane; view: AgentView }) {
  const [error, setError] = useState<string | null>(null);
  const act = async (f: () => Promise<void>) => {
    try {
      await f();
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const asked = view.permission;
  return (
    <div class="agent-controls">
      {asked && (
        <div class="agent-permission">
          <code>{asked.detail}</code>
        </div>
      )}
      {view.queued.map((m) => (
        <div key={m.id} class="agent-queued">
          <span class="text">{m.text}</span>
          <button class="copy" onClick={() => act(() => send("DELETE", agentUrl(pane.id, `messages/${m.id}`)))}>
            cancel
          </button>
        </div>
      ))}
      <div>
        <button class="copy" onClick={() => act(() => send("POST", agentUrl(pane.id, "focus")))}>
          focus
        </button>
      </div>
      {error && <p class="agent-error">{error}</p>}
    </div>
  );
}

/** Returns the agent panes of a project, each with its role, what it is
 * doing and how full its context is, and what acts on it. */
function PaneRow({ panes, agents }: { panes: Pane[]; agents: Record<string, AgentView> }) {
  if (!panes.length) return null;
  return (
    <div class="panes">
      {panes.map((p) => {
        const state = statusState(p.status);
        return (
          <span key={p.id} class="pane" title={`${p.id} · ${p.status ?? "unknown"}`}>
            <span class={`pr-agent agent-${state}`}>{p.role ?? p.id}</span>
            {p.ctx !== null && <span class={p.ctx >= FULL_AT ? "ctx ctx-full" : "ctx"}>{p.ctx}%</span>}
            {agents[p.id] && <AgentControls pane={p} view={agents[p.id]} />}
          </span>
        );
      })}
    </div>
  );
}

/** Returns links to a project's worktrees, each to its diff with the
 * subject of its last commit, and to its files. */
function FileLinks({ project }: { project: Project }) {
  if (!project.worktrees.length && !project.files.length) return null;
  return (
    <nav class="wt-links" aria-label="Files">
      {project.worktrees.map((w) => (
        <a key={w.dir} href={diffHref(w.dir)}>
          <span class="wt-link-name">{w.dir.split("/").pop()}/</span>
          <span class="wt-subject">{w.subject}</span>
        </a>
      ))}
      {project.files.map((f) => (
        <a key={f.name} href={fileHref(project.dir, f.name)}>
          <span class="wt-link-name">{f.name}</span>
          <span class="wt-subject" />
        </a>
      ))}
    </nav>
  );
}

function ProjectCard({ project, agents }: { project: Project; agents: Record<string, AgentView> }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(project.dir);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  return (
    <section class={project.workspaces.length || project.items.length ? "card" : "card quiet"}>
      <header>
        {project.workspaces
          .filter((w) => w !== project.name)
          .map((w) => (
            <span key={w} class="workspace" title="Herdr workspace">
              {w}
            </span>
          ))}
        <a class="name" href={projectHref(project.dir)}>
          {project.name}
        </a>
        <span class="title">{project.title}</span>
        <button class="copy" onClick={copy} title={`Copy ${project.dir}`}>
          {copied ? "copied" : "path"}
        </button>
      </header>
      <PaneRow panes={project.panes} agents={agents} />
      <FileLinks project={project} />
      {project.items.length > 0 && (
        <ul>
          {uniqueKeys(project.items.map((i) => `${project.dir}:${i.role}:${i.mark}:${i.text}`)).map(
            (id, n) => (
              <ItemRow key={id} item={project.items[n]} />
            ),
          )}
        </ul>
      )}
    </section>
  );
}

/** Returns what the filter looks for in project p itself. */
function projectTexts(p: Project): (string | null)[] {
  const wts = p.worktrees.flatMap((w) => [w.dir.split("/").pop()!, w.subject]);
  return [p.name, p.title, ...p.workspaces, ...wts, ...p.files.map((f) => f.name)];
}

/** Returns the page listing the projects in state matching query, each
 * with how many of its items surely wait on the user. */
export function ProjectList({ state, query }: { state: State; query: string }) {
  const projects = state.projects.filter((p) => matches(query, ...projectTexts(p)));
  return (
    <div class="diffs">
      <h2>
        Projects <span class="count">{projects.length}</span>
      </h2>
      {projects.length ? (
        <section class="card">
          <ul class="wts">
            {projects.map((p) => {
              const waiting = p.items.filter(pressing).length;
              return (
                <li key={p.dir} class="wt">
                  <a class="wt-name" href={projectHref(p.dir)}>
                    {p.name}
                  </a>
                  <span class="title">{p.title}</span>
                  {waiting > 0 && <span class="count">{waiting}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p class="empty">{query ? "No match." : "No open projects."}</p>
      )}
    </div>
  );
}

/** Returns the page of the project in dir: its card, what the watcher
 * found for it matching query, and its README.md. */
export function ProjectView({ dir, state, query, now }: { dir: string; state: State | null; query: string; now: number }) {
  const project = state?.projects.find((p) => p.dir === dir);
  const readme = project?.files.find((f) => f.name === "README.md");
  return (
    <div class="diffs">
      <h2>
        <a href="#projects">Projects</a> / {project?.name ?? dir.split("/").pop()}
      </h2>
      {!state ? (
        <p class="empty">Loading…</p>
      ) : !project ? (
        <p class="empty">No open project here.</p>
      ) : (
        <>
          <ProjectCard project={project} agents={state.controls ?? {}} />
          {projectSections(state.sections ?? [], project.dir).map((s) => (
            <WatchSection key={s.title} section={s} query={query} agents={state.agents ?? null} now={now} />
          ))}
          {readme && <FileSection dir={dir} name={readme.name} at={readme.at} />}
        </>
      )}
    </div>
  );
}

/** Returns messages left for agents that are gone, to copy elsewhere or
 * drop: nothing will deliver them. */
function Undelivered({ state }: { state: State }) {
  const left = (state.undelivered ?? []).flatMap((u) => u.messages.map((m) => ({ pane: u.pane, message: m })));
  if (!left.length) return null;
  return (
    <section class="card">
      <header>
        <span class="name">undelivered</span>
        <span class="title">the agents they were for are gone</span>
      </header>
      {left.map(({ pane, message }) => (
        <div key={message.id} class="agent-queued undelivered">
          <span class="text">{message.text.split("\n")[0]}</span>
          <button class="copy" onClick={() => navigator.clipboard.writeText(message.text).catch(() => {})}>
            copy
          </button>
          <button class="copy" onClick={() => send("DELETE", agentUrl(pane, `messages/${message.id}`)).catch(() => {})}>
            drop
          </button>
        </div>
      ))}
    </section>
  );
}

/** Reports whether item surely waits on the user: tagged [you] or
 * found by the watcher, not guessed or suggested. */
export const pressing = (item: Item) => !["?", "maybe", "close"].includes(item.mark);

/** Returns the projects in state matching query, with what waits on
 * the user in them and elsewhere, waiting being how many items surely
 * do. */
export function ProjectsColumn({ state, query, waiting }: { state: State; query: string; waiting: number }) {
  const projects = useMemo(
    () =>
      state.projects.flatMap((p) => {
        if (matches(query, ...projectTexts(p))) return [p];
        const items = p.items.filter((i) => matches(query, i.text, i.role));
        return items.length ? [{ ...p, items }] : [];
      }),
    [state, query],
  );
  const unowned = state.unowned.filter((i) => matches(query, i.text));
  return (
    <div class="column">
      <h2>
        Inbox <span class="count">{waiting}</span>
      </h2>
      <Undelivered state={state} />
      {unowned.length > 0 && (
        <section class="card">
          <header>
            <span class="name">elsewhere</span>
          </header>
          <ul>
            {uniqueKeys(unowned.map((i) => `:${i.mark}:${i.text}`)).map((id, n) => (
              <ItemRow key={id} item={unowned[n]} />
            ))}
          </ul>
        </section>
      )}
      {!query && !unowned.length && !projects.some((p) => p.items.length) && <p class="empty">Nothing waiting.</p>}
      {projects.map((p) => (
        <ProjectCard key={p.dir} project={p} agents={state.controls ?? {}} />
      ))}
      {query && !projects.length && !unowned.length && <p class="empty">No match.</p>}
    </div>
  );
}
