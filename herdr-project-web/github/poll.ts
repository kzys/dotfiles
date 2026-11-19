// Checking the user's pull requests: telling the user, and the Herdr agent
// working on each, when their checks, review or state change, and what
// the page and the watcher's pane show of them.

import { basename } from "node:path";
import type { Item } from "../inbox.ts";
import { type NotesText, type Owner, notesTexts, ownedItem, pad, projectNameIn } from "../owners.ts";
import type { HerdrPane } from "../panes.ts";
import type { PullRequest } from "../state.ts";
import type { Found } from "../watched.ts";
import { loadState, saveState } from "../statefile.ts";
import { fetch } from "./api.ts";
import { type Seen, events, remember, wakeMessage } from "./changes.ts";
import { type Tree, agentPane, checkoutPanes, owner, worktrees } from "./match.ts";
import { FAILED, type PullRequest as Pull, failure, label, pullBases, pullRequests } from "./pullrequest.ts";

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

// What poll needs of Herdr.
export type PollHerdr = {
  panes: () => Promise<HerdrPane[]>;
  notify: (title: string, body: string, sound: "request" | "done") => Promise<unknown>;
  // Types text into the pane with id and presses Enter.
  run: (id: string, text: string) => Promise<unknown>;
};

// What a check of the pull requests reads: what GitHub returned, the
// projects' checkouts and notes, Herdr's panes, or null if it can't list
// them, the agent panes in checkouts of open pull requests, by url, and
// the state the last check saved, if any.
export type Snapshot = {
  prs: Pull[];
  trees: Tree[];
  texts: NotesText[];
  panes: HerdrPane[] | null;
  checkouts: Record<string, HerdrPane>;
  seen: Seen | null;
};

// Something to tell the user through a Herdr notification, and the text
// to send the idle agent pane working on its pull request, if any.
export type Tell = { title: string; body: string; sound: "request" | "done"; wake: { pane: string; text: string } | null };

// What a check of the pull requests found: the lines of table, the
// projects of the pull requests by url, the names of those projects by
// directory, the inbox items of waitingItems, the rows of listed, the URLs
// of the pull requests the state keeps as open, including those the
// search no longer finds, their bases, every pull request found, what to
// tell, and the state to save, or null to keep the one before.
export type PullCheck = {
  lines: string[]; owners: Record<string, Owner | null>; names: Record<string, string>; items: Item[]; rows: Row[]; urls: string[];
  bases: Record<string, string>; pulls: Pull[]; tells: Tell[]; seen: Seen | null;
};

/** Reads what a check of the pull requests in orgs, or all without orgs,
 * needs: what fetchPrs finds, the projects under root, Herdr's panes and
 * the state in path. */
export async function gather(
  herdr: PollHerdr, root: string, path: string, orgs: string[] = [],
  fetchPrs: (orgs: string[]) => Promise<any> = (o) => fetch("gh", o),
): Promise<Snapshot> {
  const loaded = loadState(path);
  const seen = loaded && typeof loaded === "object" ? (loaded as Seen) : null;
  const prs = pullRequests(await fetchPrs(orgs));
  const [trees, texts] = [await worktrees(root), notesTexts(root)];
  const panes = await herdr.panes().catch(() => null);
  // An agent in a checkout on the branch, wherever it is, surely works on
  // the pull request; one in its project only may.
  const checkouts = await checkoutPanes(panes ?? [], prs.filter((pr) => pr.state === "OPEN"));
  return { prs, trees, texts, panes, checkouts, seen };
}

/** Returns what a check that read snapshot found. While Herdr can't list
 * its panes, it tells nothing and keeps the state as it was, to tell the
 * changes once Herdr is back. */
export function look({ prs, trees, texts, panes, checkouts, seen: old }: Snapshot): PullCheck {
  const owners = Object.fromEntries(prs.map((pr) => [pr.url, owner(pr, trees, texts)]));
  const names = Object.fromEntries(Object.values(owners).flatMap((o) => (o ? [[o.project, projectNameIn(o.project, texts)]] : [])));
  const byUrl: Record<string, HerdrPane | null> = {
    ...Object.fromEntries(Object.entries(owners).map(([url, f]) => [url, f && agentPane(panes ?? [], f)])),
    ...checkouts,
  };
  const tells = (panes ? events(old, prs) : []).map(([pr, message, wake]): Tell => {
    const found = owners[pr.url];
    const pane = byUrl[pr.url];
    const idle = pane && (pane.agent_status === "idle" || pane.agent_status === "done");
    return {
      title: `${label(pr)} ${message}`,
      body: `${pr.title}${found ? ` (${basename(found.project)})` : ""}`,
      sound: wake ? "request" : "done",
      wake: wake && idle ? { pane: pane.pane_id, text: wakeMessage(pr, message) } : null,
    };
  });
  const seen = remember(old, prs);
  const rows = listed(prs, owners, names, byUrl, checkouts);
  return {
    lines: table(rows), owners, names, items: waitingItems(prs, owners), rows, urls: Object.keys(seen), bases: pullBases(prs),
    pulls: prs, tells, seen: panes ? seen : null,
  };
}

/** Tells through herdr what found says to, and saves its state in path. */
export async function act(herdr: PollHerdr, path: string, found: PullCheck) {
  for (const { title, body, sound, wake } of found.tells) {
    await herdr.notify(title, body, sound).catch(() => {});
    if (wake) await herdr.run(wake.pane, wake.text).catch(() => {});
  }
  if (found.seen) saveState(path, found.seen);
}

/** Checks the pull requests once, as gather reads them, look finds and
 * act tells, returning what look found. */
export async function poll(
  herdr: PollHerdr, root: string, path: string, orgs: string[] = [],
  fetchPrs: (orgs: string[]) => Promise<any> = (o) => fetch("gh", o),
): Promise<PullCheck> {
  const found = look(await gather(herdr, root, path, orgs, fetchPrs));
  await act(herdr, path, found);
  return found;
}

/** Returns what the page shows of the pull requests from a check that
 * ran at at, next due at next, and found check, or failed with error. A
 * failed check keeps before, the items the one before found, and lists
 * no pull requests. */
export function shown(at: Date, next: Date, check: PullCheck | null, error: string | null, before: Item[]): Found {
  const title = "Pull requests";
  const lines = check ? check.lines : [`Cannot check pull requests: ${error}`];
  return {
    title,
    section: { title, at: at.toISOString(), next: next.toISOString(), lines, ...(check ? { pullRequests: check.rows } : {}) },
    items: check ? check.items : before,
  };
}

/** Returns the text of the watcher's pane for the section titled title,
 * checked at at, with lines: a line naming it and when, in local time,
 * then lines. */
export function screen(title: string, at: Date, lines: string[]): string {
  return [`${title} at ${at.toTimeString().slice(0, 5)}`, ...lines].join("\n");
}
