// What the tests of this directory share: pull requests as GitHub's search
// returns them, checkouts, temporary directories and a stand-in Herdr.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HerdrPane } from "../checks/panes.ts";
import type { PollHerdr } from "./poll.ts";

export function prNode(number: number, branch: string, {
  state = "OPEN", checks = null as string | null, failed = [] as string[], review = null as string | null,
  repo = "org/app", head = null as string | null,
} = {}) {
  const contexts: object[] = failed.map((name) => ({ __typename: "CheckRun", name, conclusion: "FAILURE" }));
  contexts.push({ __typename: "StatusContext", context: "ok", state: "SUCCESS" });
  const rollup = checks ? { state: checks, contexts: { nodes: contexts } } : null;
  return {
    number, title: `PR ${number}`, url: `https://github.com/${repo}/pull/${number}`, state,
    isDraft: false, headRefName: branch, reviewDecision: review,
    repository: { nameWithOwner: repo }, headRepository: { nameWithOwner: head ?? repo },
    commits: { nodes: [{ commit: { statusCheckRollup: rollup } }] },
  };
}

export function search(...nodes: object[]): any {
  return { data: { search: { nodes } } };
}

export function gitCheckout(path: string, branch: string, remote = "git@github.com:org/app.git") {
  mkdirSync(path, { recursive: true });
  execFileSync("git", ["-C", path, "init", "-q", "-b", branch]);
  execFileSync("git", ["-C", path, "remote", "add", "origin", remote]);
}

export const tmp = () => mkdtempSync(join(tmpdir(), "herdr-project-web-"));

// Returns Herdr with panes, keeping what it is told to do in calls.
export function fakeHerdr(panes: () => HerdrPane[], calls: unknown[][]): PollHerdr {
  return {
    panes: async () => panes(),
    notify: async (...args) => void calls.push(["notify", ...args]),
    run: async (...args) => void calls.push(["run", ...args]),
  };
}
