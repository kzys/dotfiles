// What / and the watcher's pane show of the user's pull requests: a
// section listing the open ones, and inbox items for those that wait on
// the user.

import type { Item } from "./project/inbox.ts";
import { type Owner, ownedItem, pad } from "./owners.ts";
import type { HerdrPane } from "./panes.ts";
import type { PullRequest } from "./state.ts";
import type { Found } from "./watched.ts";
import type { PullCheck } from "./github/poll.ts";
import { FAILED, type PullRequest as Pull, failure, label } from "./github/pullrequest.ts";

const MARKS: Record<string, string> = { SUCCESS: "✓", FAILURE: "✗", ERROR: "✗", PENDING: "…", EXPECTED: "…" };

// An open pull request as the page lists it.
export type Row = Pull & PullRequest;

/** Returns the open pull requests in prs, those with projects first, with
 * their label, the name of their project from owners (by url), as names
 * has it, or null,
 * whether an agent pane works on them, from panes (by url), and the id
 * of the pane in their checkout, from checkouts (by url), or null. Only
 * that pane surely works on them; others may be any agent in their
 * project. */
export function listed(
  prs: Pull[],
  owners: Record<string, Owner | null>,
  names: Record<string, string>,
  panes: Record<string, HerdrPane | null>,
  checkouts: Record<string, HerdrPane> = {},
): Row[] {
  const rows = prs
    .filter((pr) => pr.state === "OPEN")
    .map((pr) => {
      const found = owners[pr.url];
      return {
        ...pr,
        label: label(pr),
        project: found ? (names[found.project] ?? null) : null,
        projectDir: found?.project ?? null,
        agent: !!panes[pr.url],
        pane: checkouts[pr.url]?.pane_id ?? null,
      };
    });
  return rows.sort((a, b) => Number(a.project === null) - Number(b.project === null));
}

/** Returns lines listing rows, as listed returns them, with their checks,
 * project and whether an agent pane works on them. */
export function table(rows: Row[]): string[] {
  return rows.map(
    (r) =>
      `${MARKS[r.checks ?? ""] ?? " "} ${r.agent ? "●" : " "} ${pad(r.label, 24)} ${pad(r.project ?? "", 20)} ` +
      `${r.title}${r.draft ? " (draft)" : ""}`,
  );
}

/** Returns inbox items for the open pull requests in prs that wait on the
 * user: those whose checks failed, that have changes requested, or that
 * are approved with passing checks, with projects from owners. */
export function waitingItems(prs: Pull[], owners: Record<string, Owner | null>): Item[] {
  return prs.flatMap((pr) => {
    if (pr.state !== "OPEN") return [];
    let message: string;
    if (FAILED.has(pr.checks ?? "")) message = failure(pr);
    else if (pr.review === "CHANGES_REQUESTED") message = "changes requested";
    else if (pr.review === "APPROVED" && (pr.checks === "SUCCESS" || pr.checks === null) && !pr.draft)
      message = "approved, ready to merge";
    else return [];
    return [ownedItem(owners[pr.url], "pr", `${label(pr)} ${message}: ${pr.title}`)];
  });
}

/** Returns the rows of listed for what check found, the lines of table
 * for them and the inbox items of waitingItems. */
export function view(check: PullCheck): { rows: Row[]; lines: string[]; items: Item[] } {
  const rows = listed(check.pulls, check.owners, check.names, check.agents, check.checkouts);
  return { rows, lines: table(rows), items: waitingItems(check.pulls, check.owners) };
}

/** Returns what the page shows of the pull requests from a check that
 * ran at at, next due at next, and found check, or failed with error. A
 * failed check keeps before, the items the one before found, and lists
 * no pull requests. */
export function shown(at: Date, next: Date, check: PullCheck | null, error: string | null, before: Item[]): Found {
  const title = "Pull requests";
  const found = check && view(check);
  const lines = found ? found.lines : [`Cannot check pull requests: ${error}`];
  return {
    title,
    section: { title, at: at.toISOString(), next: next.toISOString(), lines, ...(found ? { pullRequests: found.rows } : {}) },
    items: found ? found.items : before,
  };
}

/** Returns the text of the watcher's pane for the section titled title,
 * checked at at, with lines: a line naming it and when, in local time,
 * then lines. */
export function screen(title: string, at: Date, lines: string[]): string {
  return [`${title} at ${at.toTimeString().slice(0, 5)}`, ...lines].join("\n");
}
