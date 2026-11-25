// What the user did with their pull requests on the board: the columns
// they moved them to, and what came of asking Copilot to review each,
// kept in JSON files across restarts.

import { join } from "node:path";
import { type Signal, computed, createModel, effect, signal } from "@preact/signals-core";
import * as board from "./board.ts";
import type { PullCheck } from "./github/poll.ts";
import { loadState, saveState } from "./statefile.ts";

/** Returns the JSON object kept at path, or {} if there is none. */
function loadRecord<T extends object>(path: string): T {
  const loaded = loadState(path);
  return (typeof loaded === "object" && loaded !== null && !Array.isArray(loaded) ? loaded : {}) as T;
}

/** What the user did with their pull requests on the board. */
export type BoardState = { moves: board.Moves; asks: board.CopilotAsks };

/** Returns the board's cards from what check found, if any, and state. */
export function boardCards(check: PullCheck | null, state: BoardState): board.Card[] {
  if (!check) return [];
  return board.cards(check.pulls, check.owners, (d) => check.names[d] ?? d, state.moves, state.asks);
}

/** The board's state, kept in stateDir, each part a signal, changed only
 * through its methods. A save that fails goes to onError, and the board
 * goes on with what it has. */
export const BoardStore = createModel((stateDir: string, onError: (error: unknown) => void = () => {}) => {
  const movesPath = join(stateDir, "moves.json");
  const asksPath = join(stateDir, "copilot.json");
  const moves = signal(loadRecord<board.Moves>(movesPath));
  const asks = signal(loadRecord<board.CopilotAsks>(asksPath));
  /** Saves what s holds at path whenever it changes from what is there. */
  const keep = (path: string, s: Signal<object>) => {
    let saved = JSON.stringify(s.peek());
    effect(() => {
      const json = JSON.stringify(s.value);
      if (json === saved) return;
      saved = json;
      try {
        saveState(path, s.value);
      } catch (e) {
        onError(e);
      }
    });
  };
  keep(movesPath, moves);
  keep(asksPath, asks);
  /** Sets s to value unless it holds the same already, compared as JSON,
   * and returns whether it changed. */
  const put = <T>(s: Signal<T>, value: T) => {
    if (JSON.stringify(value) === JSON.stringify(s.peek())) return false;
    s.value = value;
    return true;
  };
  return {
    moves, asks,
    /** The board's state, a new object after each change. */
    state: computed((): BoardState => ({ moves: moves.value, asks: asks.value })),

    /** Forgets what was done with the pull requests check found gone. */
    forget(check: PullCheck) {
      put(moves, board.stillMoved(moves.peek(), check.pulls));
      put(asks, board.stillAsked(asks.peek(), check.urls));
    },
    /** Moves the pull request at url to column stage, or back for null,
     * and returns whether that changed anything. */
    move(url: string, stage: board.Stage | null): boolean {
      return put(moves, board.withMove(moves.peek(), url, stage));
    },
    /** Asks Copilot through request to review the pull request at url,
     * keeping what came of it, and returns whether it was asked. */
    async askCopilot(url: string, request: (url: string) => Promise<unknown>): Promise<boolean> {
      const asked = await board.askCopilot(url, {}, request);
      // Merged after the request, which can take a while, so as not to
      // lose what came of another asked meanwhile.
      put(asks, { ...asks.peek(), ...asked });
      return asked[url] === "requested";
    },
  };
});
export type BoardStore = InstanceType<typeof BoardStore>;
