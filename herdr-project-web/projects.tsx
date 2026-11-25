// The page's view of the open projects and what waits on the user in
// them.

import { useState } from "preact/hooks";
import { FileSection } from "./files.tsx";
import { FULL_AT, type Item, uniqueKeys } from "./inbox.ts";
import { diffHref, fileHref, projectHref } from "./pages.ts";
import { baseName } from "./paths.ts";
import { agentCounts, projectSections, statusState } from "./pulls.ts";
import type { AgentView } from "./agents.ts";
import type { Pane, ProjectView } from "./project/project.ts";
import type { State } from "./state.ts";
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
            {p.title && <span class="pane-title">{p.title}</span>}
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
function FileLinks({ project }: { project: ProjectView }) {
  if (!project.worktrees.length && !project.files.length) return null;
  return (
    <nav class="wt-links" aria-label="Files">
      {project.worktrees.map((w) => (
        <a key={w.dir} href={diffHref(project.dir, w.dir)}>
          <span class="wt-link-name">{baseName(w.dir)}/</span>
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

function ProjectCard({ project, agents }: { project: ProjectView; agents: Record<string, AgentView> }) {
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

/** Returns the name of dir, the project's directory, where it isn't name,
 * the project's own name. */
function DirName({ dir, name }: { dir: string; name: string }) {
  const base = baseName(dir);
  return base === name ? null : <span class="dir-name">{base}</span>;
}

/** Returns what the filter looks for in project p itself. */
function projectTexts(p: ProjectView): (string | null)[] {
  const wts = p.worktrees.flatMap((w) => [baseName(w.dir), w.subject]);
  return [p.name, baseName(p.dir), p.title, ...p.workspaces, ...wts, ...p.files.map((f) => f.name), ...p.panes.map((a) => a.title ?? null)];
}

/** Returns how many agents panes has, and how many are in each state. */
function AgentCounts({ panes }: { panes: Pane[] }) {
  if (!panes.length) return null;
  return (
    <span class="agent-counts">
      {panes.length === 1 ? "1 agent" : `${panes.length} agents`}
      {agentCounts(panes).map(([state, n]) => (
        <span key={state} class={`pr-agent agent-${state}`}>
          {n} {state}
        </span>
      ))}
    </span>
  );
}

/** Returns a line for each agent among panes that has a title: its role,
 * or its pane, and what its terminal's title says it works on. */
function AgentTitles({ panes }: { panes: Pane[] }) {
  const titled = panes.filter((p) => p.title);
  if (!titled.length) return null;
  return (
    <ul class="agent-titles">
      {titled.map((p) => (
        <li key={p.id}>
          <span class={`pr-agent agent-${statusState(p.status)}`}>{p.role ?? p.id}</span>
          <span class="pane-title">{p.title}</span>
        </li>
      ))}
    </ul>
  );
}

/** Returns when any file directly in project p last changed, as its
 * agents' notes do while they work, in milliseconds since the epoch, or
 * 0 without files. */
const lastActive = (p: ProjectView) => Math.max(0, ...p.files.map((f) => f.at));

/** Returns the page listing the projects in state matching query, most
 * recently active first, each with its agents, what each works on, and
 * how many Herdr tabs it has. */
export function ProjectList({ state, query }: { state: State; query: string }) {
  const projects = state.projects
    .filter((p) => matches(query, ...projectTexts(p)))
    .sort((a, b) => lastActive(b) - lastActive(a));
  return (
    <div class="diffs">
      <h2>
        Projects <span class="count">{projects.length}</span>
      </h2>
      {projects.length ? (
        <section class="card">
          <ul class="wts">
            {projects.map((p) => (
              <li key={p.dir} class="wt">
                <a class="wt-name" href={projectHref(p.dir)}>
                  {p.name}
                </a>
                <DirName dir={p.dir} name={p.name} />
                <span class="title">{p.title}</span>
                <AgentCounts panes={p.panes} />
                {p.tabs > 0 && <span class="agent-counts">{p.tabs === 1 ? "1 tab" : `${p.tabs} tabs`}</span>}
                <AgentTitles panes={p.panes} />
              </li>
            ))}
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
        <a href="/projects">Projects</a> / {project?.name ?? baseName(dir)}
        {project && <DirName dir={dir} name={project.name} />}
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
          {readme && <FileSection dir={dir} name={readme.name} at={readme.at} state={state} />}
        </>
      )}
    </div>
  );
}

/** Reports whether item surely waits on the user: tagged [you] or
 * found by the watcher, not guessed or suggested. */
export const pressing = (item: Item) => !["?", "maybe", "close"].includes(item.mark);
