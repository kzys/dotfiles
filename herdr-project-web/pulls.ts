// What the page says about an open pull request.

import type { PullRequest, Run } from "./state.ts";

// What the agent working on a pull request is doing.
export type AgentState = "working" | "blocked" | "idle" | "unknown";

/** Returns what the agent working on pr is doing, from agents, Herdr's
 * agent states by pane or null if not known, or null if no agent works
 * on it, as when its pane has closed. "unknown" is for an agent whose
 * state isn't known: Herdr's isn't, the watcher only guessed its pane,
 * or Herdr reports a state the page doesn't know. */
export function agentState(pr: PullRequest, agents: Record<string, string> | null): AgentState | null {
  if (!pr.agent) return null;
  if (!pr.pane || !agents) return "unknown";
  if (!(pr.pane in agents)) return null;
  return statusState(agents[pr.pane]);
}

/** Returns what an agent is doing from status, what Herdr says, or
 * "unknown" for a state the page doesn't know. */
export function statusState(status: string | null | undefined): AgentState {
  if (status === "working" || status === "blocked") return status;
  if (status === "idle" || status === "done") return "idle";
  return "unknown";
}

/** Returns where pr stands, most pressing first, as a label and its
 * kind: "bad" when it needs fixing or the user, "wait" while checks
 * run, its agent works or it is a draft, "ok" when it is ready for
 * review, or "done" ready to merge. agent is what its agent is doing,
 * as agentState returns it.
 * It goes by each check, as the page shows them, or by the rollup from
 * watchers that don't keep them; GitHub's rollup fails on cancelled
 * checks, which the page doesn't count as failing. */
export function readiness(pr: PullRequest, agent: AgentState | null = null): [string, string] {
  const has = (state: Run["state"], ...rollup: string[]) =>
    pr.runs ? pr.runs.some((r) => r.state === state) : rollup.includes(pr.checks ?? "");
  if (agent === "blocked") return ["agent needs you", "bad"];
  if (pr.draft) return ["draft", "wait"];
  if (pr.review === "CHANGES_REQUESTED") return ["changes requested", "bad"];
  if (has("failed", "FAILURE", "ERROR")) return ["checks failing", "bad"];
  if (has("running", "PENDING", "EXPECTED")) return ["checks running", "wait"];
  if (agent === "working") return ["agent working", "wait"];
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
