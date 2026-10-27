// The page's view of the open projects and what waits on the user in
// them.

import { useMemo, useState } from "preact/hooks";
import { diffHref } from "./diffs.tsx";
import { FULL_AT, type Item, uniqueKeys } from "./inbox.ts";
import { fileHref } from "./pages.ts";
import { statusState } from "./pulls.ts";
import type { Pane, Project, State } from "./state.ts";
import { Linked, matches } from "./ui.tsx";

// The items the page has shown, by key. Those that appear after the
// first state flash as they arrive; those that only reappear, as after
// filtering, don't.
const seen = new Set<string>();
let primed = false;

/** Marks the page as having shown its first state, so that items new
 * after it flash, and reports whether it already was. */
export function prime(): boolean {
  const was = primed;
  primed = true;
  return was;
}

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

/** Returns the agent panes of a project, each with its role, what it is
 * doing and how full its context is. */
function PaneRow({ panes }: { panes: Pane[] }) {
  if (!panes.length) return null;
  return (
    <div class="panes">
      {panes.map((p) => {
        const state = statusState(p.status);
        return (
          <span key={p.id} class="pane" title={`${p.id} · ${p.status ?? "unknown"}`}>
            <span class={`pr-agent agent-${state}`}>{p.role ?? p.id}</span>
            {p.ctx !== null && <span class={p.ctx >= FULL_AT ? "ctx ctx-full" : "ctx"}>{p.ctx}%</span>}
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
    <section class={project.workspaces.length || project.items.length ? "card" : "card quiet"}>
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
      <PaneRow panes={project.panes} />
      <FileLinks project={project} />
      {project.items.length > 0 && (
        <ul>
          {uniqueKeys(project.items.map((i) => `${project.dir}:${i.role}:${i.mark}:${i.text}`)).map(
            (id, n) => (
              <ItemRow key={id} id={id} item={project.items[n]} />
            ),
          )}
        </ul>
      )}
    </section>
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
export const pressing = (item: Item) => !["?", "maybe", "close"].includes(item.mark);

/** Returns the projects in state matching query, with what waits on
 * the user in them and elsewhere, waiting being how many items surely
 * do. */
export function ProjectsColumn({ state, query, waiting }: { state: State; query: string; waiting: number }) {
  const projects = useMemo(
    () =>
      state.projects.flatMap((p) => {
        const wts = p.worktrees.flatMap((w) => [w.dir.split("/").pop()!, w.subject]);
        const names = [p.name, p.title, ...p.workspaces, ...wts, ...p.files.map((f) => f.name)];
        if (matches(query, ...names)) return [p];
        const items = p.items.filter((i) => matches(query, i.text, i.role));
        return items.length ? [{ ...p, items }] : [];
      }),
    [state, query],
  );
  const unowned = state.unowned.filter((i) => matches(query, i.text));
  return (
    <div class="column">
      <h2>
        Projects <span class="count">{waiting}</span>
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
      {!query && !unowned.length && !projects.some((p) => p.items.length) && <Monolith />}
      {projects.map((p) => (
        <ProjectCard key={p.dir} project={p} />
      ))}
      {query && !projects.length && !unowned.length && <p class="empty">No match.</p>}
    </div>
  );
}
