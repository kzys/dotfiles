// What the page says about an open pull request.

import type { PullRequest, Run } from "./state.ts";

/** Returns where pr stands, most pressing first, as a label and its
 * kind: "bad" when it needs fixing, "wait" while checks run or it is a
 * draft, "ok" when it is ready for review, or "done" ready to merge.
 * It goes by each check, as the page shows them, or by the rollup from
 * watchers that don't keep them; GitHub's rollup fails on cancelled
 * checks, which the page doesn't count as failing. */
export function readiness(pr: PullRequest): [string, string] {
  const has = (state: Run["state"], ...rollup: string[]) =>
    pr.runs ? pr.runs.some((r) => r.state === state) : rollup.includes(pr.checks ?? "");
  if (pr.draft) return ["draft", "wait"];
  if (pr.review === "CHANGES_REQUESTED") return ["changes requested", "bad"];
  if (has("failed", "FAILURE", "ERROR")) return ["checks failing", "bad"];
  if (has("running", "PENDING", "EXPECTED")) return ["checks running", "wait"];
  if (pr.review === "APPROVED") return ["ready to merge", "done"];
  return ["ready for review", "ok"];
}

/** Returns the runs of pr by state, in the order the page shows them. */
export function runsByState(pr: PullRequest): Record<Run["state"], Run[]> {
  const out: Record<Run["state"], Run[]> = {
    failed: [], running: [], passed: [], skipped: [], cancelled: [],
  };
  for (const r of pr.runs ?? []) out[r.state]?.push(r);
  return out;
}
