import assert from "node:assert/strict";
import { test } from "node:test";
import { projectItems, uniqueKeys, waiting, watchedItems } from "./inbox.ts";

test("guesses what waits on me", () => {
  assert.deepEqual(
    [
      "Apply the change to staging (user)", "Cleanup left (ask): branches",
      "Agree on the design with the user", "Rollout not decided yet", "Branch is local only",
      "Offer: file a ticket", "Post outcome in the thread if user wants",
      "Rerun 4 timed-out clusters", "Unverified: GPU containers work",
      "[ ] Decide on the rollout", "[x] Decide on the rollout", "Is the user okay to push?",
      "Offers to file a ticket", "Wrote notes for the user", "Shared summary with the user",
      "PR approved, waiting on CI", "Decision: went with B", "Needs approval from the owner",
      "Confirm the plan with the user", "[you] Push it",
    ].map(waiting), [
    "?", "?", "?", "?", "?", "maybe", "maybe", null, null,
    "?", null, "?", "maybe", null, null, null, null, "?", "?", "you",
  ]);
});

test("finds what waits on me in notes", () => {
  const main =
    "## Remaining\n" +
    "- [you] Decide on the rollout\n" +
    "  for the canary first.\n" +
    "- [wait] CI on #12\n" +
    "- Ask the user before pushing\n" +
    "- Write the tests\n" +
    "- Optional: post findings to the thread if the user asks\n" +
    "- Base image commit reviewed, not pushed\n" +
    "- Reported findings to the user\n" +
    "- Nothing; answered the user.\n" +
    "- None unless user wants a fix PR\n" +
    "- [cleanup] Remove the worktree\n" +
    "- None.\n" +
    "\n" +
    "## Log\n" +
    "- [you] old\n";
  const side = "## Remaining\n- [You] Approve the plan\n";
  assert.deepEqual(projectItems("/p", null, [["main", main], ["side", side]]), [
    { project: "/p", role: "main", mark: "you", text: "Decide on the rollout for the canary first." },
    { project: "/p", role: "side", mark: "you", text: "Approve the plan" },
    { project: "/p", role: "main", mark: "?", text: "Ask the user before pushing" },
    { project: "/p", role: "main", mark: "?", text: "Base image commit reviewed, not pushed" },
    { project: "/p", role: "main", mark: "maybe", text: "Optional: post findings to the thread if the user asks" },
  ]);
});

test("closes roles and then the project", () => {
  const a = "closed: https://x/pull/1\n\n## Remaining\n- [you] Stale\n\n## Findings\n- etcd needs 3\n";
  const b = "## Remaining\n- None.\n";
  const c = "## Remaining\n- [you] Decide X\n\n## Log\n- closed: no\n";
  const notes: [string, string][] = [["a", a], ["b", b], ["c", c]];
  assert.deepEqual(projectItems("/p", null, notes).map((i) => [i.role, i.mark, i.text]), [
    ["c", "you", "Decide X"],
    ["b", "close", "Nothing remaining for b; tell its agent its part is done to close it"],
  ]);
  // The watcher's items hold the suggestions back.
  const watched = [{ project: "/p", role: null, mark: "pr", text: "app#1 failed" }];
  assert.deepEqual(projectItems("/p", null, notes, watched).map((i) => i.mark), ["you", "pr"]);

  notes[2][1] = "closed: decided X\n\n## Remaining\n";
  assert.deepEqual(projectItems("/p", null, notes).map((i) => i.text), [
    "Nothing remaining; tell its agent the task is done to close it",
  ]);
  assert.deepEqual(projectItems("/p", "---\nclosed: done\n---\n", notes), []);
  // Notes with CRLF line ends read the same.
  const crlf: [string, string][] = notes.map(([r, t]) => [r, t.replaceAll("\n", "\r\n")]);
  assert.deepEqual(projectItems("/p", null, crlf), projectItems("/p", null, notes));
});

test("skips watched items not in the watcher's form", () => {
  assert.deepEqual(
    watchedItems({
      Panes: [{ project: null, role: null, mark: "idle", text: "idle" }, { mark: "x" }, 3],
      Slack: "junk",
    }), [{ project: null, role: null, mark: "idle", text: "idle" }]);
  assert.deepEqual(watchedItems([]), []);
});

test("numbers repeated keys", () => {
  assert.deepEqual(uniqueKeys(["a", "b", "a", "a"]), ["a", "b", "a#1", "a#2"]);
});
