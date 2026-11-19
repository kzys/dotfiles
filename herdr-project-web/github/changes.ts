// What changed about the user's pull requests since the last check, to
// tell the user and the agent working on each.

import { FAILED, type PullRequest as Pull, failure } from "./pullrequest.ts";

// What changed about a pull request: the message, and whether the agent
// working on it should act on it.
export type Change = [pr: Pull, message: string, wake: boolean];

// What the state file keeps of each open pull request, by url.
export type Seen = Record<string, { state: string; checks: string | null; review: string | null }>;

/** Returns what changed in prs since old, the state that remember
 * returned last time. With no old state nothing has changed. A pull
 * request seen for the first time counts as changed if its checks
 * failed. */
export function events(old: Seen | null, prs: Pull[]): Change[] {
  if (!old) return [];
  const out: Change[] = [];
  for (const pr of prs) {
    const before = old[pr.url];
    if (!before) {
      if (pr.state === "OPEN" && FAILED.has(pr.checks ?? "")) out.push([pr, failure(pr), true]);
      continue;
    }
    if (pr.state !== before.state) {
      out.push([pr, pr.state.toLowerCase(), false]);
      continue;
    }
    if (pr.state !== "OPEN") continue;
    if (pr.checks !== before.checks) {
      if (FAILED.has(pr.checks ?? "")) out.push([pr, failure(pr), true]);
      else if (pr.checks === "SUCCESS") out.push([pr, "checks passed", false]);
    }
    if (pr.review !== before.review && (pr.review === "APPROVED" || pr.review === "CHANGES_REQUESTED"))
      out.push([pr, pr.review.toLowerCase().replace("_", " "), false]);
  }
  return out;
}

/** Returns the state to compare the next prs with: old updated with prs,
 * without pull requests that are no longer open. */
export function remember(old: Seen | null, prs: Pull[]): Seen {
  const state: Seen = { ...old };
  for (const pr of prs) state[pr.url] = { state: pr.state, checks: pr.checks, review: pr.review };
  return Object.fromEntries(Object.entries(state).filter(([, s]) => s.state === "OPEN"));
}

/** Returns what to tell the agent working on pr about message. */
export function wakeMessage(pr: Pull, message: string): string {
  return `${pr.url} ${message}. Look into it, fix it if it is caused by the change, and update your notes.`;
}

