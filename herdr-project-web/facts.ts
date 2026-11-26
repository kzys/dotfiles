// What the server knows, which its sources set and from which the page and
// what the server does derive: a signal for each fact, and the ways its
// sources change them.

import { type ReadonlySignal, type Signal, computed, createModel, signal } from "@preact/signals-core";
import { type Queued, forgetAnswered } from "./agents.ts";
import type { Ask } from "./ask/ask.ts";
import type { BoardState } from "./pulls/board-store.ts";
import type { PullCheck } from "./github/poll.ts";
import type { Herdr } from "./herdr/backend.ts";
import type { HookEvent } from "./hooks.ts";
import type { ProjectRead } from "./project/project.ts";
import { agentStates } from "./state.ts";
import type { Found } from "./checks/watched.ts";

export type FactValues = {
  // Herdr's panes and workspaces, null while it can't be asked.
  herdr: Herdr | null;
  // How many times Herdr has been read, so that what failed asking it
  // runs again on the next read, even one that read the same.
  herdrReads: number;
  // The terminals of the Herdr app's spaces, which herdr-core runs, as
  // Herdr's panes, and whether they have been read yet.
  appPanes: Herdr["panes"];
  appRead: boolean;
  // How many times the Herdr app's spaces have changed, which herdr-core
  // tells as changes to the app's document.
  appSpacesChanged: number;
  // What the checks found, by title, once they have checked.
  found: ReadonlyMap<string, Found>;
  // How many times ~/project, a project in it or what its projects work
  // in may have changed, and the projects shown, read since.
  projectsChanged: number;
  projects: ProjectRead[];
  // The projects in ~/project, each with the name its README.md gives it,
  // read with the projects shown.
  names: [string, string | null][];
  // What the last check of the pull requests that didn't fail found, or
  // null before one.
  pulls: PullCheck | null;
  // Each pane's last hook event.
  hooks: ReadonlyMap<string, HookEvent>;
  // What the outbox holds, the board's state and the questions asked, as
  // they keep them.
  queued: Record<string, Queued[]>;
  board: BoardState;
  asks: Ask[];
};

/** Returns value as JSON, with each Map as its entries. */
const json = (value: unknown) => JSON.stringify(value, (_k, v) => (v instanceof Map ? [...v] : v));

/** Sets s to value unless it holds the same already, compared as JSON, so
 * that only real changes reach what follows s. */
function put<T>(s: Signal<T>, value: T) {
  if (json(value) !== json(s.peek())) s.value = value;
}

/** The facts, each a signal, changed only through its methods, each of
 * which changes them together, with board, the board's state, which the
 * board changes. */
export const Facts = createModel((board: ReadonlySignal<BoardState>) => {
  const herdr = signal<Herdr | null>(null);
  const herdrReads = signal(0);
  const appPanes = signal<Herdr["panes"]>([]);
  const appRead = signal(false);
  const appSpacesChanged = signal(0);
  const found = signal<ReadonlyMap<string, Found>>(new Map());
  const projectsChanged = signal(0);
  const projects = signal<ProjectRead[]>([]);
  const names = signal<[string, string | null][]>([]);
  const pulls = signal<PullCheck | null>(null);
  const hooks = signal<ReadonlyMap<string, HookEvent>>(new Map());
  const queued = signal<Record<string, Queued[]>>({});
  const asks = signal<Ask[]>([]);
  return {
    herdr, herdrReads, appPanes, appRead, appSpacesChanged, found, projectsChanged, projects, names, pulls, hooks, queued, board, asks,
    /** All the facts' values, which change whenever any of them does. */
    all: computed((): FactValues => ({
      herdr: herdr.value, herdrReads: herdrReads.value, appPanes: appPanes.value, appRead: appRead.value, appSpacesChanged: appSpacesChanged.value,
      found: found.value, projectsChanged: projectsChanged.value, projects: projects.value, names: names.value,
      pulls: pulls.value, hooks: hooks.value, queued: queued.value, board: board.value, asks: asks.value,
    })),

    /** Sets Herdr's panes and workspaces as read, forgetting the hook
     * events of panes gone and permission requests answered since the
     * last read. */
    setHerdr(next: Herdr | null) {
      const states = agentStates(herdr.peek()) ?? {};
      let kept = forgetAnswered(hooks.peek(), states, agentStates(next) ?? states);
      if (next && [...kept.keys()].some((pane) => !next.panes.some((q) => q.pane_id === pane)))
        kept = new Map([...kept].filter(([pane]) => next.panes.some((q) => q.pane_id === pane)));
      put(herdr, next);
      herdrReads.value++;
      hooks.value = kept;
    },
    /** Sets the Herdr app's panes as read. */
    setAppPanes(next: Herdr["panes"]) {
      put(appPanes, next);
      appRead.value = true;
    },
    /** Tells that the Herdr app's spaces may have changed. */
    spacesChanged() {
      appSpacesChanged.value++;
    },
    /** Sets what the check titled title found. */
    setFound(title: string, next: Found) {
      if (json(next) !== json(found.peek().get(title))) found.value = new Map(found.peek()).set(title, next);
    },
    /** Tells that the projects shown may have changed. */
    touchProjects() {
      projectsChanged.value++;
    },
    /** Sets the projects shown and the projects' names, as read. */
    setProjects(nextProjects: ProjectRead[], nextNames: [string, string | null][]) {
      put(projects, nextProjects);
      put(names, nextNames);
    },
    /** Sets what the last check of the pull requests that didn't fail
     * found. */
    setPulls(next: PullCheck | null) {
      put(pulls, next);
    },
    /** Sets pane's last hook event. */
    setHook(pane: string, event: HookEvent) {
      hooks.value = new Map(hooks.peek()).set(pane, event);
    },
    /** Sets what the outbox holds. */
    setQueued(next: Record<string, Queued[]>) {
      queued.value = next;
    },
    /** Sets the questions asked. */
    setAsks(next: Ask[]) {
      asks.value = next;
    },
  };
});
