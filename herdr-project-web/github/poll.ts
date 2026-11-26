// Checking the user's pull requests: finding who works on each, and
// telling the user, and the Herdr agent working on each, when their
// checks, review or state change.

import { basename } from "node:path";
import { type NotesText, type Owner, notesTexts, projectNameIn } from "../checks/owners.ts";
import { isFree } from "../herdr/backend.ts";
import type { HerdrPane } from "../checks/panes.ts";
import { loadState, saveState } from "../statefile.ts";
import { fetch } from "./api.ts";
import { type Seen, events, remember, wakeMessage } from "./changes.ts";
import { type Tree, agentPane, checkoutPanes, owner, worktrees } from "./match.ts";
import { type PullRequest as Pull, label, pullBases, pullRequests } from "./pullrequest.ts";

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

// What a check of the pull requests found: every pull request found, the
// projects of the pull requests by url, the names of those projects by
// directory, the agent pane working on each, by url, if any, the agent
// panes in their checkouts, which surely work on them, the URLs of the
// pull requests the state keeps as open, including those the search no
// longer finds, their bases, what to tell, and the state to save, or null
// to keep the one before.
export type PullCheck = {
  pulls: Pull[]; owners: Record<string, Owner | null>; names: Record<string, string>;
  agents: Record<string, HerdrPane | null>; checkouts: Record<string, HerdrPane>; urls: string[];
  bases: Record<string, string>; tells: Tell[]; seen: Seen | null;
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
    const idle = pane && isFree(pane.agent_status);
    return {
      title: `${label(pr)} ${message}`,
      body: `${pr.title}${found ? ` (${basename(found.project)})` : ""}`,
      sound: wake ? "request" : "done",
      wake: wake && idle ? { pane: pane.pane_id, text: wakeMessage(pr, message) } : null,
    };
  });
  const seen = remember(old, prs);
  return {
    pulls: prs, owners, names, agents: byUrl, checkouts, urls: Object.keys(seen), bases: pullBases(prs), tells,
    seen: panes ? seen : null,
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
