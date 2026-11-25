// The page's state, as a function of what the server knows, reading
// nothing itself.

import { type AgentView, type Queued, permission, undelivered } from "./agents.ts";
import type { Card } from "./board.ts";
import type { Herdr } from "./herdr/backend.ts";
import type { HookEvent } from "./hooks.ts";
import { type ProjectRead, type Watched, agentStates, stateOf } from "./state.ts";
import type { Wait } from "./waits.ts";

/** What the page's state comes from. */
export type PageFacts = {
  // Herdr's panes and workspaces, null while it can't be asked.
  herdr: Herdr | null;
  // The Herdr app's terminals, as Herdr's panes, and whether they have
  // been read yet.
  appPanes: Herdr["panes"];
  appRead: boolean;
  // What each Claude session's Bash tool still runs, by session ID.
  waits: ReadonlyMap<string, Wait[]>;
  // What the checks found, or null before any has.
  watched: Watched | null;
  // The projects shown, as readProject reads them.
  projects: ProjectRead[];
  // What only the watcher's server, which acts on agents, shows: the
  // messages queued for each agent, each pane's last hook event and the
  // pull requests' board; null for another server.
  acting: { queued: Record<string, Queued[]>; hooks: ReadonlyMap<string, HookEvent>; board: Card[] } | null;
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
  for (const project of state.projects)
    for (const pane of project.panes) pane.waits = (sessions[pane.id] && facts.waits.get(sessions[pane.id])) || [];
  const { acting } = facts;
  if (!acting) return state;
  const controls: Record<string, AgentView> = {};
  for (const [pane, status] of Object.entries(agentStates(all) ?? {}))
    controls[pane] = { queued: acting.queued[pane] ?? [], permission: permission(acting.hooks.get(pane), status) };
  // Only messages for panes of what has been read can be told undelivered:
  // Herdr's panes are named like w1:p2, the app's terminals like t3.
  const readable = Object.fromEntries(
    Object.entries(acting.queued).filter(([pane]) => pane.includes(":") ? facts.herdr !== null : facts.appRead),
  );
  return { ...state, controls, undelivered: undelivered(readable, sessions), board: acting.board };
}
