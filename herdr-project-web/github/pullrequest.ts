// The user's pull requests as GitHub reports them, read from its search,
// and the names it gives them and their repositories.

// A check of a pull request's latest commit.
export type Run = {
  name: string;
  state: "passed" | "failed" | "running" | "skipped" | "cancelled";
  url: string | null;
};

// Check run conclusions and status states that count as failures.
export const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"]);

// How each check run conclusion or status state counts; anything else,
// such as a check run without a conclusion yet, is still running.
const RUN_STATES: Record<string, Run["state"]> = {
  ...Object.fromEntries([...FAILED].map((s) => [s, "failed" as const])),
  SUCCESS: "passed", NEUTRAL: "skipped", SKIPPED: "skipped", CANCELLED: "cancelled", STALE: "cancelled",
};

// A pull request as GitHub's search finds it: its url, repo
// ("owner/name"), the repo its branch is in (head, the same unless from
// a fork), state (OPEN, MERGED or CLOSED), the rollup state of its checks,
// or null without checks, the names of failed checks, each check and
// its review decision.
export type PullRequest = {
  url: string;
  repo: string;
  head: string;
  number: number;
  title: string;
  branch: string;
  // The branch it would merge into.
  base?: string;
  state: string;
  draft: boolean;
  checks: string | null;
  failed: string[];
  runs: Run[];
  review: string | null;
  // When it was merged, in ISO 8601, or null.
  mergedAt: string | null;
  copilot: CopilotReview;
  // How many reviews Copilot has left on it.
  copilotReviews: number;
};

// How far Copilot's review of a pull request has come: not reviewed,
// reviewed with threads of its still unresolved, or reviewed with all
// of them resolved.
export type CopilotReview = "none" | "unresolved" | "passed";

/** Orders strings by code unit, the same everywhere, unlike localeCompare. */
export const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Returns the checks in contexts, from a commit's status check rollup,
 * with their name, state and url, or null, sorted by name. */
export function runs(contexts: any[]): Run[] {
  return contexts
    .map((c) => ({
      name: c.name || c.context || "?",
      state: RUN_STATES[c.conclusion || c.state] ?? "running",
      url: c.detailsUrl || c.targetUrl || null,
    }))
    .sort((a, b) => byString(a.name, b.name));
}

/** Returns how far Copilot's review of node, a pull request as the
 * search returns it, has come. A review on an older commit counts:
 * addressing Copilot's comments usually means pushing another. Threads
 * it can't read all of count as unresolved. */
export function copilotReview(node: any): CopilotReview {
  if (!node?.copilotReviews?.totalCount) return "none";
  const threads = node.reviewThreads;
  if (!Array.isArray(threads?.nodes) || threads.pageInfo?.hasNextPage !== false) return "unresolved";
  const open = threads.nodes.some(
    (t: any) => !t?.isResolved && t?.comments?.nodes?.[0]?.author?.login === "copilot-pull-request-reviewer");
  return open ? "unresolved" : "passed";
}

/** Returns the pull requests in data, a response from fetch, the open ones
 * first, each pull request once. */
export function pullRequests(data: any): PullRequest[] {
  const prs: PullRequest[] = [];
  const seen = new Set<string>();
  const nodes = ["open", "search"].flatMap((part) => data?.data?.[part]?.nodes ?? []);
  for (const node of nodes) {
    if (!node?.url || seen.has(node.url)) continue;
    seen.add(node.url);
    const commits = node.commits?.nodes?.length ? node.commits.nodes : [{}];
    const rollup = commits[0]?.commit?.statusCheckRollup ?? {};
    const contexts: any[] = rollup.contexts?.nodes ?? [];
    const failed = [
      ...new Set(contexts.filter((c) => FAILED.has(c.conclusion || c.state)).map((c) => c.name || c.context || "?")),
    ].sort(byString);
    prs.push({
      url: node.url,
      repo: node.repository.nameWithOwner,
      head: (node.headRepository ?? node.repository).nameWithOwner,
      number: node.number,
      title: node.title,
      branch: node.headRefName,
      base: node.baseRefName,
      state: node.state,
      draft: node.isDraft,
      checks: rollup.state ?? null,
      failed,
      runs: runs(contexts),
      review: node.reviewDecision ?? null,
      mergedAt: node.mergedAt ?? null,
      copilot: copilotReview(node),
      copilotReviews: node.copilotReviews?.totalCount ?? 0,
    });
  }
  return prs;
}

/** Returns what the open pull requests of prs merge into, by "owner/name:
 * branch". One from a fork says nothing of a branch of that name here. */
export function pullBases(prs: PullRequest[]): Record<string, string> {
  const open = prs.filter((p) => p.state === "OPEN" && p.base && p.repo === p.head);
  return Object.fromEntries(open.map((p) => [`${p.repo}:${p.branch}`, p.base!]));
}

/** Returns the "owner/name" of the GitHub repository at remote url, or
 * null if it isn't on GitHub. */
export function repoName(url: string): string | null {
  return url.trim().match(/^(?:https:\/\/|ssh:\/\/git@|git@)github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1] ?? null;
}

/** Returns pr's short name, like name#N. */
export function label(pr: PullRequest): string {
  return `${pr.repo.split("/")[1]}#${pr.number}`;
}

/** Returns the message saying pr's checks failed. */
export function failure(pr: PullRequest): string {
  return "checks failed" + (pr.failed.length ? `: ${pr.failed.join(", ")}` : "");
}

