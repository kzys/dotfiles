// The page's state, as a function of what the server knows, reading
// nothing itself.

import { type AgentView, type Queued, permission, undelivered } from "./agents.ts";
import { type Ask, askViews } from "./ask/ask.ts";
import type { Card } from "./pulls/board.ts";
import type { Herdr } from "./herdr/backend.ts";
import type { HookEvent } from "./hooks.ts";
import { type ProjectRead } from "./project/project.ts";
import { type Watched, agentStates, stateOf } from "./state.ts";

/** What the page's state comes from. */
export type PageFacts = {
  // Herdr's panes and workspaces, null while it can't be asked.
  herdr: Herdr | null;
  // The Herdr app's terminals, as Herdr's panes, and whether they have
  // been read yet.
  appPanes: Herdr["panes"];
  appRead: boolean;
  // What the checks found, or null before any has.
  watched: Watched | null;
  // The projects shown, as readProject reads them.
  projects: ProjectRead[];
  // What only the watcher's server, which acts on agents, shows: the
  // messages queued for each agent, each pane's last hook event, the pull
  // requests' board and the questions asked of every agent; null for
  // another server.
  acting: { queued: Record<string, Queued[]>; hooks: ReadonlyMap<string, HookEvent>; board: Card[]; asks: Ask[] } | null;
};

/** Returns Herdr's panes with the Herdr app's agents among them, or those
 * alone while Herdr can't be asked, or null if neither is known. */
export function everyPane({ herdr, appPanes }: Pick<PageFacts, "herdr" | "appPanes">): Herdr | null {
  if (!herdr && !appPanes.length) return null;
  return { workspaces: herdr?.workspaces ?? [], panes: [...(herdr?.panes ?? []), ...appPanes] };
}

/** Returns the state for the page from facts. */
export function pageState(facts: PageFacts) {
  const all = everyPane(facts);
  const state = stateOf(facts.watched, facts.projects, all);
  const sessions = Object.fromEntries((all?.panes ?? []).filter((p) => p.agent).map((p) => [p.pane_id, p.agent_session?.value ?? ""]));
  const { acting } = facts;
  if (!acting) return state;
  const controls: Record<string, AgentView> = {};
  for (const [pane, status] of Object.entries(agentStates(all) ?? {}))
    controls[pane] = { queued: acting.queued[pane] ?? [], permission: permission(acting.hooks.get(pane), status) };
  // Only panes of what has been read can be told gone: Herdr's panes are
  // named like w1:p2, the app's terminals like t3.
  const read = (pane: string) => (pane.includes(":") ? facts.herdr !== null : facts.appRead);
  const readable = Object.fromEntries(Object.entries(acting.queued).filter(([pane]) => read(pane)));
  const present = (pane: string) => Object.hasOwn(sessions, pane) || !read(pane);
  const lost = undelivered(readable, sessions);
  return {
    ...state, controls, undelivered: lost, board: acting.board,
    asks: askViews(acting.asks, acting.queued, new Set(lost.flatMap((u) => u.messages.map((m) => m.id))), present),
  };
}
