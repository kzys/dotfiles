// The board of the user's pull requests, each in the column of how far
// it has come.

import type { CopilotReview, Pull } from "./github.ts";
import type { Owner } from "./owners.ts";

// The board's columns, in order, each titled by what its pull requests
// wait for.
export const STAGES = [
  ["ci", "Waiting for CI"],
  ["draft", "Waiting for Copilot"],
  ["copilot", "Waiting for review"],
  ["reviewed", "Waiting for approval"],
  ["approved", "Waiting for merge"],
  ["merged", "Merged"],
] as const;

export type Stage = (typeof STAGES)[number][0];

// The columns the user moves cards to: the others are GitHub's to say.
export const MOVABLE: readonly Stage[] = ["copilot", "reviewed"];

// The columns whose pull requests wait for the user.
export const MINE: readonly Stage[] = ["copilot", "approved"];

// More cards than this in a column of MINE are too many to leave waiting.
export const MINE_MAX = 5;

// The column the user moved each open pull request to, by url.
export type Moves = Record<string, Stage>;

const rank = (s: Stage) => STAGES.findIndex(([t]) => t === s);

// How long a merged pull request stays on the board.
export const MERGED_MS = 86400_000;

// A pull request as the board shows it.
export type Card = {
  url: string;
  label: string;
  title: string;
  stage: Stage;
  draft: boolean;
  checks: string | null;
  copilot: CopilotReview;
  // The column the user moved it to, or null, and the one GitHub alone
  // would put it in.
  moved: Stage | null;
  found: Stage;
  // What came of asking Copilot to review it, as askCopilot keeps it, or
  // null if it wasn't asked.
  copilotAsk: string | null;
  // The name and directory of its project, or null.
  project: string | null;
  projectDir: string | null;
};

/** Returns the column of pr: the furthest it has come, whether or not
 * it passed the stages before, or moved, the column the user moved it to,
 * if that is further. Without checks, it has none to wait for. */
export function stage(pr: Pull, moved: Stage | null = null): Stage {
  const found: Stage =
    pr.state === "MERGED" ? "merged" : pr.review === "APPROVED" ? "approved" : pr.copilot === "passed" ? "copilot"
    : pr.checks === "SUCCESS" || pr.checks === null ? "draft" : "ci";
  return moved && rank(moved) > rank(found) ? moved : found;
}

/** Returns the column to move a card in column from to by step, 1 for the
 * next or -1 for the one before, as the user can: a column of MOVABLE,
 * or null to undo the move. Returns undefined if the user can't move it
 * that way. */
export function moveTo(from: Stage, step: 1 | -1): Stage | null | undefined {
  const to = STAGES[rank(from) + step]?.[0];
  if (step === 1) return to && MOVABLE.includes(to) ? to : undefined;
  if (!MOVABLE.includes(from)) return undefined;
  return to && MOVABLE.includes(to) ? to : null;
}

/** Returns the cards of prs for the board at now: the open ones and those
 * merged within MERGED_MS, with their projects from owners (by url),
 * named by name, in the columns the user moved them to in moves, with
 * what came of asking Copilot from asks. */
export function cards(
  prs: Pull[], owners: Record<string, Owner | null>, name: (dir: string) => string, moves: Moves, now: Date,
  asks: CopilotAsks = {},
): Card[] {
  const shown = (pr: Pull) =>
    pr.state === "OPEN" || (pr.state === "MERGED" && !!pr.mergedAt && now.getTime() - Date.parse(pr.mergedAt) < MERGED_MS);
  return prs.filter(shown).map((pr) => {
    const dir = owners[pr.url]?.project ?? null;
    return {
      url: pr.url,
      label: `${pr.repo.split("/")[1]}#${pr.number}`,
      title: pr.title,
      stage: stage(pr, moves[pr.url] ?? null),
      draft: pr.draft,
      checks: pr.checks,
      copilot: pr.copilot,
      moved: moves[pr.url] ?? null,
      found: stage(pr),
      copilotAsk: asks[pr.url] ?? null,
      project: dir ? name(dir) : null,
      projectDir: dir,
    };
  });
}

/** Returns moves without those of pull requests prs has as closed or
 * merged. A pull request the search doesn't find may still be open, so
 * its move stays, even if it closed unseen. */
export function stillMoved(moves: Moves, prs: Pull[]): Moves {
  const done = new Set(prs.filter((p) => p.state !== "OPEN").map((p) => p.url));
  return Object.fromEntries(Object.entries(moves).filter(([u]) => !done.has(u)));
}

// What came of asking Copilot to review each pull request, by url:
// "requested", or why the request failed.
export type CopilotAsks = Record<string, string>;

/** Returns whether the user can ask Copilot to review card: once its
 * checks pass and until Copilot's review lets it on, so also while its
 * threads are open, to ask again once they are addressed. */
export function canAskCopilot(card: Card): boolean {
  return card.stage === "draft";
}

/** Asks Copilot through request to review the pull request at url, and
 * returns asks with what came of it: "requested", or why it failed. */
export async function askCopilot(
  url: string, asks: CopilotAsks, request: (url: string) => Promise<unknown>,
): Promise<CopilotAsks> {
  try {
    await request(url);
    return { ...asks, [url]: "requested" };
  } catch (e) {
    return { ...asks, [url]: String((e as Error)?.message ?? e).split("\n")[0] };
  }
}
