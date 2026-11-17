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

/** Returns the pull requests in prs to ask Copilot to review: those open
 * in the draft column, given moves, whose checks all passed or that have
 * none, that Copilot hasn't reviewed and that asks doesn't say were
 * requested. A failed request is tried again. */
export function toAskCopilot(prs: Pull[], moves: Moves, asks: CopilotAsks): Pull[] {
  return prs.filter((pr) =>
    pr.state === "OPEN" && stage(pr, moves[pr.url] ?? null) === "draft" && pr.copilot === "none" &&
    asks[pr.url] !== "requested");
}

/** Asks Copilot through request to review each pull request in prs that
 * toAskCopilot returns, and returns asks with what came of each. */
export async function askCopilot(
  prs: Pull[], moves: Moves, asks: CopilotAsks, request: (url: string) => Promise<unknown>,
): Promise<CopilotAsks> {
  const out = { ...asks };
  for (const pr of toAskCopilot(prs, moves, asks)) {
    try {
      await request(pr.url);
      out[pr.url] = "requested";
    } catch (e) {
      out[pr.url] = String((e as Error)?.message ?? e).split("\n")[0];
    }
  }
  return out;
}

// How many reviews Copilot had left on each open pull request, by url,
// as last given to the router.
export type CopilotSeen = Record<string, number>;

/** Returns the open pull requests in prs with Copilot's threads open and
 * a review of its since seen, even while threads of an older one are
 * still open. */
export function copilotComments(prs: Pull[], seen: CopilotSeen): Pull[] {
  return prs.filter((pr) => pr.state === "OPEN" && pr.copilot === "unresolved" && pr.copilotReviews > (seen[pr.url] ?? 0));
}

/** Returns seen updated with the open pull requests in prs, keeping only
 * those whose URLs are in open, those still known to be open. */
export function nextCopilotSeen(seen: CopilotSeen, prs: Pull[], open: string[]): CopilotSeen {
  const known = new Set(open);
  const next: CopilotSeen = Object.fromEntries(Object.entries(seen).filter(([url]) => known.has(url)));
  for (const pr of prs) if (pr.state === "OPEN") next[pr.url] = pr.copilotReviews;
  return next;
}

/** Returns what to ask the router about prs, whose Copilot threads are
 * open, on one line, naming the project of each from owners if known. */
export function routerMessage(prs: Pull[], owners: Record<string, Owner | null>): string {
  const named = prs.map((pr) => {
    const dir = owners[pr.url]?.project;
    return dir ? `${pr.url} (project ${dir})` : pr.url;
  });
  return `Copilot left review comments on ${named.join(", ")}. Give each to the agent working on it, ` +
    "to address the comments, push the fixes, and reply to each, leaving the threads unresolved.";
}
