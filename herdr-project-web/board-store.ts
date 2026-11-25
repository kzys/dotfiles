// What the user did with their pull requests on the board: the columns
// they moved them to, and what came of asking Copilot to review each,
// kept in JSON files across restarts.

import { join } from "node:path";
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

/** Returns the board's cards at now from what check found, if any, and
 * state. */
export function boardCards(check: PullCheck | null, state: BoardState, now: Date): board.Card[] {
  if (!check) return [];
  return board.cards(check.pulls, check.owners, (d) => check.names[d] ?? d, state.moves, now, state.asks);
}

/** The board's state, kept in stateDir. A save that fails goes to
 * onError, and the board goes on with what it has. */
export class BoardStore {
  private movesPath: string;
  private asksPath: string;
  private moves: board.Moves;
  private asks: board.CopilotAsks;
  // What was last saved or loaded at each path, as JSON.
  private saved = new Map<string, string>();
  private onError: (error: unknown) => void;
  private listeners: (() => void)[] = [];

  constructor(stateDir: string, onError: (error: unknown) => void = () => {}) {
    this.movesPath = join(stateDir, "moves.json");
    this.asksPath = join(stateDir, "copilot.json");
    this.moves = loadRecord(this.movesPath);
    this.asks = loadRecord(this.asksPath);
    this.saved.set(this.movesPath, JSON.stringify(this.moves));
    this.saved.set(this.asksPath, JSON.stringify(this.asks));
    this.onError = onError;
  }

  /** Returns the board's state, as a new object after each change. */
  state(): BoardState {
    return { moves: this.moves, asks: this.asks };
  }

  /** Calls listener after each change to the board's state. */
  subscribe(listener: () => void) {
    this.listeners.push(listener);
  }

  /** Forgets what was done with the pull requests check found gone. */
  forget(check: PullCheck) {
    this.moves = board.stillMoved(this.moves, check.pulls);
    this.save(this.movesPath, this.moves);
    this.asks = board.stillAsked(this.asks, check.urls);
    this.save(this.asksPath, this.asks);
  }

  /** Moves the pull request at url to column stage, or back for null, and
   * returns whether that changed anything. */
  move(url: string, stage: board.Stage | null): boolean {
    this.moves = board.withMove(this.moves, url, stage);
    return this.save(this.movesPath, this.moves);
  }

  /** Asks Copilot through request to review the pull request at url,
   * keeping what came of it, and returns whether it was asked. */
  async askCopilot(url: string, request: (url: string) => Promise<unknown>): Promise<boolean> {
    const asked = await board.askCopilot(url, {}, request);
    // Merged after the request, which can take a while, so as not to lose
    // what came of another asked meanwhile.
    this.asks = { ...this.asks, ...asked };
    this.save(this.asksPath, this.asks);
    return asked[url] === "requested";
  }

  /** Saves value at path unless it is what is there, and returns whether
   * it changed. */
  private save(path: string, value: unknown): boolean {
    const json = JSON.stringify(value);
    if (this.saved.get(path) === json) return false;
    this.saved.set(path, json);
    try {
      saveState(path, value);
    } catch (e) {
      this.onError(e);
    }
    for (const listener of this.listeners) listener();
    return true;
  }
}
