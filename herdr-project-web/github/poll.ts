// Checking the user's pull requests: telling the user, and the Herdr agent
// working on each, when their checks, review or state change, and what
// the page and the watcher's pane show of them.

import { basename } from "node:path";
import type { Item } from "../inbox.ts";
import { type Owner, notesTexts, ownedItem, pad, projectName } from "../owners.ts";
import type { HerdrPane } from "../panes.ts";
import type { PullRequest } from "../state.ts";
import { loadState, saveState } from "../statefile.ts";
import { fetch } from "./api.ts";
import { type Seen, events, remember, wakeMessage } from "./changes.ts";
import { agentPane, checkoutPanes, owner, worktrees } from "./match.ts";
import { FAILED, type PullRequest as Pull, failure, label, pullBases, pullRequests } from "./pullrequest.ts";

const MARKS: Record<string, string> = { SUCCESS: "✓", FAILURE: "✗", ERROR: "✗", PENDING: "…", EXPECTED: "…" };

// An open pull request as the page lists it.
export type Row = Pull & PullRequest;

/** Returns the open pull requests in prs, those with projects first, with
 * their label, the name of their project from owners (by url) or null,
 * whether an agent pane works on them, from panes (by url), and the id
 * of the pane in their checkout, from checkouts (by url), or null. Only
 * that pane surely works on them; others may be any agent in their
 * project. */
export function listed(
  prs: Pull[],
  owners: Record<string, Owner | null>,
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
        project: found ? projectName(found.project) : null,
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

// What poll needs of Herdr.
export type PollHerdr = {
  panes: () => Promise<HerdrPane[]>;
  notify: (title: string, body: string, sound: "request" | "done") => Promise<unknown>;
  // Types text into the pane with id and presses Enter.
  run: (id: string, text: string) => Promise<unknown>;
};

/** Checks the pull requests once, those in orgs or all without orgs, as
 * fetchPrs finds them: tells the user and their agents through herdr
 * about changes since the state in path, saves the new state there, and
 * returns the lines of table, the projects of the pull requests by url,
 * the inbox items of waitingItems, the rows of listed, the URLs of
 * the pull requests the state keeps as open, including those the search
 * no longer finds, and every pull request found. The projects are under
 * root. While Herdr can't list its panes, it tells nothing and keeps the
 * state as it was, to tell the changes once Herdr is back. */
export async function poll(
  herdr: PollHerdr,
  root: string,
  path: string,
  orgs: string[] = [],
  fetchPrs: (orgs: string[]) => Promise<any> = (o) => fetch("gh", o),
): Promise<{
  lines: string[]; owners: Record<string, Owner | null>; items: Item[]; rows: Row[]; urls: string[]; bases: Record<string, string>;
  pulls: Pull[];
}> {
  const loaded = loadState(path);
  const old = loaded && typeof loaded === "object" ? (loaded as Seen) : null;
  const prs = pullRequests(await fetchPrs(orgs));
  const [trees, texts] = [await worktrees(root), notesTexts(root)];
  // Without Herdr, changes can't be told, so they are kept for later.
  const herdrPanes = await herdr.panes().catch(() => null);
  const panes = herdrPanes ?? [];
  const owners = Object.fromEntries(prs.map((pr) => [pr.url, owner(pr, trees, texts)]));
  // An agent in a checkout on the branch, wherever it is, surely works on
  // the pull request; one in its project only may.
  const checkouts = await checkoutPanes(panes, prs.filter((pr) => pr.state === "OPEN"));
  const byUrl: Record<string, HerdrPane | null> = {
    ...Object.fromEntries(Object.entries(owners).map(([url, f]) => [url, f && agentPane(panes, f)])),
    ...checkouts,
  };
  for (const [pr, message, wake] of herdrPanes ? events(old, prs) : []) {
    const found = owners[pr.url];
    const where = found ? ` (${basename(found.project)})` : "";
    await herdr.notify(`${label(pr)} ${message}`, `${pr.title}${where}`, wake ? "request" : "done").catch(() => {});
    const pane = byUrl[pr.url];
    if (wake && pane && (pane.agent_status === "idle" || pane.agent_status === "done"))
      await herdr.run(pane.pane_id, wakeMessage(pr, message)).catch(() => {});
  }
  const seen = remember(old, prs);
  if (herdrPanes) saveState(path, seen);
  const rows = listed(prs, owners, byUrl, checkouts);
  return { lines: table(rows), owners, items: waitingItems(prs, owners), rows, urls: Object.keys(seen), bases: pullBases(prs), pulls: prs };
}

/** Returns the text of the watcher's pane for the section titled title,
 * checked at at, with lines: a line naming it and when, in local time,
 * then lines. */
export function screen(title: string, at: Date, lines: string[]): string {
  return [`${title} at ${at.toTimeString().slice(0, 5)}`, ...lines].join("\n");
}
