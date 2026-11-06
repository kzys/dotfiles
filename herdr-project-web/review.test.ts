import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileDiff } from "./diff.ts";
import { type Comment, clearReviewer, commentKey, displaced, displacedFromBlocks, receiverStarted, receiverStatus, reviewMessage, reviewers, withComment } from "./review.ts";

const comment = (path: string, line: number, body: string, side: "old" | "new" = "new"): Comment => ({ path, side, line, code: "x()", body });

test("says what the agent sent to is doing", () => {
  const message = { id: "1", text: "t", at: 0 };
  const state = {
    agents: { a: "working", b: "done", c: "blocked" },
    controls: { a: { queued: [message], permission: null }, b: { queued: [], permission: null } },
  };
  assert.deepEqual(receiverStatus(state, "a", false), ["working", "working, 1 waiting to reach it"]);
  assert.deepEqual(receiverStatus(state, "b", true), ["idle", "idle"]);
  assert.deepEqual(receiverStatus(state, "b", false), ["idle", "idle, not seen working yet"]);
  assert.deepEqual(receiverStatus(state, "c", false), ["blocked", "blocked"]);
  assert.deepEqual(receiverStatus(state, "gone", false), ["unknown", "gone"]);
  assert.deepEqual(receiverStatus({ agents: null, controls: {} }, "a", false), ["unknown", "unknown"]);
  assert.deepEqual(receiverStatus(null, "a", false), ["unknown", "unknown"]);
  const lost = { ...state, undelivered: [{ pane: "a", messages: [message] }] };
  assert.deepEqual(receiverStatus(lost, "a", false), ["working", "working, 1 undelivered"]);
});

test("tells an agent working on what it was sent from one busy before it", () => {
  const message = { id: "1", text: "t", at: 0 };
  const state = (status: string, queued: typeof message[]) =>
    ({ agents: { a: status }, controls: { a: { queued, permission: null } } });
  assert.equal(receiverStarted(state("working", [message]), "a"), false);
  assert.equal(receiverStarted(state("idle", []), "a"), false);
  assert.equal(receiverStarted(state("working", []), "a"), true);
  assert.equal(receiverStarted(state("blocked", []), "a"), true);
  assert.equal(receiverStarted(null, "a"), false);
});

test("keeps one comment per line, in the diff's order", () => {
  let comments = withComment([], comment("b.ts", 1, "second"));
  comments = withComment(comments, comment("a.ts", 9, "first"));
  comments = withComment(comments, comment("a.ts", 9, "edited"));
  assert.deepEqual(comments.map((c) => c.body), ["edited", "second"]);
  assert.equal(commentKey(comments[0]), "a.ts:new:9:x()");
});

test("an old and a new line with one number are different lines", () => {
  const both = withComment([comment("a.ts", 3, "new")], comment("a.ts", 3, "old", "old"));
  assert.equal(both.length, 2);
});

test("a line with other code under the same number is another line", () => {
  const moved = withComment([comment("a.ts", 3, "on x()")], { ...comment("a.ts", 3, "on y()"), code: "y()" });
  assert.deepEqual(moved.map((c) => c.body).sort(), ["on x()", "on y()"]);
});

test("emptying a comment removes it", () => {
  assert.deepEqual(withComment([comment("a.ts", 1, "hi")], comment("a.ts", 1, "  ")), []);
});

test("gives the agent each comment with its place and code", () => {
  const text = reviewMessage("/repo", "topic", [comment("a.ts", 3, " why? "), comment("b.ts", 7, "drop this", "old")]);
  assert.equal(text, [
    "Review comments on /repo (topic). Address each, then say what you did.", "",
    "a.ts:3", "> x()", "why?", "",
    "b.ts:7 (removed line)", "> x()", "drop this",
  ].join("\n"));
  assert.match(reviewMessage("/repo", null, []), /^Review comments on \/repo\./);
});

test("gives a comment on a block all its lines", () => {
  const text = reviewMessage("/p", null, [{ ...comment("README.md", 3, "why?"), code: "- one\n  two" }]);
  assert.equal(text.split("\n\n")[1], "README.md:3-4\n> - one\n>   two\nwhy?");
});

test("offers the agents inside the diff first, in a stable order", () => {
  const projects = [
    { name: "a", dir: "/p/a", worktrees: [{ dir: "/r" }], panes: [{ id: "w1:p1", role: "main", cwd: "/p" }, { id: "w1:p2", role: null, cwd: null }] },
    { name: "b", dir: "/p/b", worktrees: [{ dir: "/other" }], panes: [{ id: "w2:p1", role: "main", cwd: "/r" }] },
    { name: "c", dir: "/p/c", worktrees: [{ dir: "/r" }], panes: [{ id: "w0:p1", role: "main", cwd: "/r/sub" }] },
  ];
  assert.deepEqual(reviewers(projects, "/r"), [
    { id: "w0:p1", label: "c · main (w0:p1)", inside: true },
    { id: "w1:p1", label: "a · main (w1:p1)", inside: false },
    { id: "w1:p2", label: "a · w1:p2", inside: false },
  ]);
  assert.deepEqual(reviewers([...projects].reverse(), "/r"), reviewers(projects, "/r"));
  assert.deepEqual(reviewers(projects, "/p/b"), [{ id: "w2:p1", label: "b · main (w2:p1)", inside: false }]);
});

test("doesn't guess which agent the comments are for", () => {
  const agent = (id: string, inside: boolean) => ({ id, label: id, inside });
  assert.equal(clearReviewer([agent("a", false)])?.id, "a");
  assert.equal(clearReviewer([agent("a", true), agent("b", false)])?.id, "a");
  assert.equal(clearReviewer([agent("a", false), agent("b", false)]), null);
  assert.equal(clearReviewer([agent("a", true), agent("b", true)]), null);
  assert.equal(clearReviewer([]), null);
});

test("finds comments whose line moved or left the diff", () => {
  const files: FileDiff[] = [{
    from: "a.ts", to: "a.ts", status: "modified", binary: false, added: 1, removed: 1,
    hunks: [{ header: "", lines: [
      { kind: "del", text: "old()", old: 3, new: null },
      { kind: "add", text: "x()", old: null, new: 3 },
      { kind: "ctx", text: "kept()", old: 4, new: 4 },
    ] }],
  }];
  const placed = comment("a.ts", 3, "fine");
  const removed = { ...comment("a.ts", 3, "fine", "old"), code: "old()" };
  const moved = comment("a.ts", 4, "was x()");
  const gone = comment("b.ts", 1, "left the diff");
  assert.deepEqual(displaced([placed, removed, moved, gone], files), [moved, gone]);
});

test("finds comments whose Markdown block changed or left", () => {
  const blocks = [{ line: 3, code: "x()" }];
  const placed = comment("a.md", 3, "fine");
  const moved = comment("a.md", 5, "was on line 5");
  assert.deepEqual(displacedFromBlocks([placed, moved], "a.md", blocks), [moved]);
});
