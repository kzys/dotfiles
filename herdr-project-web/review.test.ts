import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileDiff } from "./diff.ts";
import { type Comment, commentKey, displaced, reviewMessage, reviewers, withComment } from "./review.ts";

const comment = (path: string, line: number, body: string, side: "old" | "new" = "new"): Comment => ({ path, side, line, code: "x()", body });

test("keeps one comment per line, in the diff's order", () => {
  let comments = withComment([], comment("b.ts", 1, "second"));
  comments = withComment(comments, comment("a.ts", 9, "first"));
  comments = withComment(comments, comment("a.ts", 9, "edited"));
  assert.deepEqual(comments.map((c) => c.body), ["edited", "second"]);
  assert.equal(commentKey(comments[0]), "a.ts:new:9");
});

test("an old and a new line with one number are different lines", () => {
  const both = withComment([comment("a.ts", 3, "new")], comment("a.ts", 3, "old", "old"));
  assert.equal(both.length, 2);
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

test("offers the agents inside the diff first, in a stable order", () => {
  const projects = [
    { name: "a", worktrees: [{ dir: "/r" }], panes: [{ id: "w1:p1", role: "main", cwd: "/p" }, { id: "w1:p2", role: null, cwd: null }] },
    { name: "b", worktrees: [{ dir: "/other" }], panes: [{ id: "w2:p1", role: "main", cwd: "/r" }] },
    { name: "c", worktrees: [{ dir: "/r" }], panes: [{ id: "w0:p1", role: "main", cwd: "/r/sub" }] },
  ];
  assert.deepEqual(reviewers(projects, "/r"), [["w0:p1", "c · main (w0:p1)"], ["w1:p1", "a · main (w1:p1)"], ["w1:p2", "a · w1:p2"]]);
  assert.deepEqual(reviewers([...projects].reverse(), "/r"), reviewers(projects, "/r"));
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
