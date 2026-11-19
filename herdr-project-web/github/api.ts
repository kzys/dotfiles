// Asking GitHub, through gh, for the user's pull requests, and for
// Copilot's review of one.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { day } from "../slack.ts";

const QUERY = `
query($q: String!, $open: String!) {
  open: search(query: $open, type: ISSUE, first: 50) { ...pullRequests }
  search(query: $q, type: ISSUE, first: 50) { ...pullRequests }
}

fragment pullRequests on SearchResultItemConnection {
    nodes {
      ... on PullRequest {
        number title url state isDraft headRefName baseRefName reviewDecision mergedAt
        copilotReviews: reviews(first: 1, author: "copilot-pull-request-reviewer[bot]") { totalCount }
        reviewThreads(first: 100) {
          pageInfo { hasNextPage }
          nodes { isResolved comments(first: 1) { nodes { author { login } } } }
        }
        repository { nameWithOwner }
        headRepository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup {
          state
          contexts(first: 100) { nodes {
            __typename
            ... on CheckRun { name conclusion detailsUrl }
            ... on StatusContext { context state targetUrl }
          } }
        } } } }
      }
    }
}
`;

/** Returns the GitHub search for the user's pull requests updated since
 * the date since, or only the open ones if onlyOpen, most recently
 * updated first, in any of orgs, or anywhere without orgs. */
export function searchQuery(since: Date, orgs: string[] = [], onlyOpen = false): string {
  return [
    "is:pr author:@me archived:false", ...(onlyOpen ? ["is:open"] : []), ...orgs.map((o) => `org:${o}`),
    `updated:>=${day(since)} sort:updated-desc`,
  ].join(" ");
}

/** Returns the response in stdout, what gh printed, if every error in
 * it is about access, as for an organization the token isn't authorized
 * for: GitHub leaves out what it can't show and returns the rest.
 * Returns null otherwise. */
export function partial(stdout: string): any {
  try {
    const data = JSON.parse(stdout);
    return data?.data && data.errors?.every((e: any) => e?.type === "FORBIDDEN") ? data : null;
  } catch {
    return null;
  }
}

/** Returns two searches for the user's pull requests updated in the last
 * days days in any of orgs, or anywhere without orgs, each most recently
 * updated first, as GitHub's GraphQL API returns them: open, the open
 * ones, and search, all of them, including merged and closed ones, which
 * may push the open ones out, without those the token can't see. Raises
 * if command, gh, fails otherwise, with its error rather than the query. */
export async function fetch(command = "gh", orgs: string[] = [], days = 14): Promise<any> {
  const since = new Date(Date.now() - days * 86400_000);
  try {
    const { stdout } = await promisify(execFile)(
      command,
      ["api", "graphql", "-f", `query=${QUERY}`, "-f", `q=${searchQuery(since, orgs)}`,
       "-f", `open=${searchQuery(since, orgs, true)}`],
      { maxBuffer: 64 << 20, timeout: 120_000 },
    );
    return JSON.parse(stdout);
  } catch (e: any) {
    if (e instanceof SyntaxError) throw e;
    const data = partial(String(e.stdout ?? ""));
    if (data) return data;
    throw new Error(String(e.stderr ?? "").trim() || (e.killed ? "gh took too long" : `gh exited with ${e.code}`));
  }
}

/** Asks Copilot through command, gh, to review the pull request at url.
 * Raises with gh's error if it fails. */
export async function requestCopilot(url: string, command = "gh"): Promise<void> {
  try {
    await promisify(execFile)(command, ["pr", "edit", url, "--add-reviewer", "@copilot"], { timeout: 60_000 });
  } catch (e: any) {
    throw new Error(String(e.stderr ?? "").trim() || (e.killed ? "gh took too long" : `gh exited with ${e.code}`));
  }
}

