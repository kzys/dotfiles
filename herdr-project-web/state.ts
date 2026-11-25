// Reading what the watcher and the agents' notes say into one state
// for the page.

import type { Herdr } from "./herdr/backend.ts";
import { FULL_AT, type Item } from "./inbox.ts";
import type { Run } from "./github/pullrequest.ts";
import { Project, type ProjectRead, type ProjectView } from "./project/project.ts";

// An open pull request as the watcher lists it.
export type PullRequest = {
  url: string;
  repo: string;
  number: number;
  label: string;
  title: string;
  draft: boolean;
  // The rollup state of its checks, like SUCCESS, or null without any.
  checks: string | null;
  failed: string[];
  runs: Run[];
  review: string | null;
  project: string | null;
  // The directory of its project.
  projectDir: string | null;
  agent: boolean;
  // The agent's pane, if known.
  pane: string | null;
};

export type Section = {
  title: string;
  at: string | null;
  // When the watcher checks again.
  next?: string | null;
  lines: string[];
  // The pull requests the lines list, if the section is about them.
  pullRequests?: PullRequest[];
  // The conversations or issues, if the section is about Slack or Linear.
  entries?: Entry[];
};

// A Slack conversation or a Linear issue.
export type Entry = {
  // Its channel or identifier.
  label: string;
  title: string;
  // What is pending, if title doesn't say.
  note?: string;
  // Its state, like In Progress, if it has one.
  detail?: string;
  url: string | null;
  waiting: boolean;
  // Whether Claude finds nothing left for the user in it, for sources
  // that say.
  done?: boolean;
  project: string | null;
  // The directory of its project.
  projectDir: string | null;
};

// What the watcher found: its sections, its inbox items by source, the
// URLs of the open pull requests it last found, and when, in ISO 8601.
export type Watched = { sections: Section[]; inbox: Record<string, Item[]>; urls: string[]; at: string };

export type State = {
  // What the page shows of each agent besides what Herdr says, by pane.
  controls?: Record<string, import("./agents.ts").AgentView>;
  undelivered?: import("./agents.ts").Undelivered[];
  // The watcher's sections, or null if it hasn't reported any.
  sections: Section[] | null;
  // When the watcher last reported them, in ISO 8601.
  watchedAt: string | null;
  projects: ProjectView[];
  // What the watcher found that belongs to no project.
  unowned: Item[];
  // The URLs of the open pull requests by their labels, like name#N.
  links: Record<string, string>;
  // What each agent pane in Herdr is doing, like working or idle, by id,
  // or null if Herdr couldn't be asked.
  agents: Record<string, string> | null;
  // The board of the user's pull requests, from the watcher's server.
  board?: import("./board.ts").Card[];
};

/** Returns urls, those of pull requests, by their labels: owner/name#N,
 * and name#N as the watcher shows them, unless two share it. */
export function pullRequestLinks(urls: string[]): Record<string, string> {
  const links: Record<string, string> = {};
  const shared = new Set<string>();
  for (const url of urls) {
    const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
    if (!m) continue;
    links[`${m[1]}/${m[2]}#${m[3]}`] = url;
    const short = `${m[2]}#${m[3]}`;
    if (links[short] && links[short] !== url) shared.add(short);
    links[short] = url;
  }
  for (const label of shared) delete links[label];
  return links;
}

/** Returns lines, the watcher's lines about panes, without those about
 * the panes with ids, named after the first field, and without saying
 * there are none. */
export function panesElsewhere(lines: string[], ids: Set<string>): string[] {
  return lines.filter((l) => l !== "Nothing to clean up." && !ids.has(l.match(/^\s*\S+\s+(\S+)/)?.[1] ?? ""));
}

/** Returns what each agent pane in herdr is doing, by id, or null if
 * herdr is. Other panes have none. */
export function agentStates(herdr: Herdr | null): Record<string, string> | null {
  if (!herdr) return null;
  const agents: Record<string, string> = {};
  for (const p of herdr.panes) if (p.agent && p.agent_status) agents[p.pane_id] = p.agent_status;
  return agents;
}

/** Returns the state for the page from watched, what the watcher found,
 * projects, the projects that are open or still have a workspace in herdr
 * as readProject read them, and herdr, naming their workspaces, if known.
 * Projects with an agent whose context is at least FULL_AT percent full
 * come first, then those with a workspace or something waiting on the
 * user, in the order given within each group. The watcher's Panes section
 * keeps only panes outside the listed projects, and goes if none are
 * left. */
export function stateOf(watched: Watched | null, projects: ProjectRead[], herdr: Herdr | null): State {
  // Copies, since the Panes section is trimmed below.
  const sections = watched?.sections.map((s) => ({ ...s })) ?? null;
  const watchedAt = watched?.at ?? null;

  const all = projects.map((read) => new Project(read, herdr));
  const known = new Set(all.filter((p) => !p.closed()).map((p) => p.dir()));
  const byProject = new Map<string, Item[]>();
  const unowned: Item[] = [];
  for (const item of Object.values(watched?.inbox ?? {}).flat()) {
    // Items of projects since removed or closed belong to none.
    if (item.project === null || !known.has(item.project)) unowned.push(item);
    else byProject.set(item.project, [...(byProject.get(item.project) ?? []), item]);
  }

  const shownProjects = all.map((p) => p.view(byProject.get(p.dir()) ?? []));
  const rank = (p: ProjectView) =>
    p.panes.some((pane) => (pane.ctx ?? 0) >= FULL_AT) ? 0 : p.workspaces.length || p.items.length ? 1 : 2;
  shownProjects.sort((a, b) => rank(a) - rank(b));
  // The panes in projects show with them, and the section only when
  // others are left.
  const ids = new Set(all.flatMap((p) => p.herdrPanes().map((pane) => pane.pane_id)));
  for (const section of sections ?? [])
    if (section.title === "Panes") section.lines = panesElsewhere(section.lines, ids);
  const shown = sections?.filter((s) => s.title !== "Panes" || s.lines.length) ?? null;
  const links = pullRequestLinks(watched?.urls ?? []);
  return { sections: shown, watchedAt, projects: shownProjects, unowned, links, agents: agentStates(herdr) };
}
