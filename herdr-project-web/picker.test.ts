import assert from "node:assert/strict";
import { test } from "node:test";
import { clip, columns, draw, found, hint, listLines, parseKeys, press, printable, spans, start, visible } from "./picker.ts";
import type { Row } from "./rows.ts";

const agents = ["claude", "codex"];
const rows: Row[] = [
  ["new", "", "", "+ new project"],
  ["project", "/a", "", "alpha  First"],
  ["session", "/a", "claude:1", "  ● claude one"],
  ["session", "/a", "codex:2", "    codex two"],
  ["project", "/b", "", "beta  日本語"],
];

test("measures and clips wide characters", () => {
  assert.equal(columns("a日本"), 5);
  assert.equal(clip("a日本", 4), "a日");
  assert.equal(clip("ab", 5), "ab");
  assert.equal(columns("🚀✅"), 4);
});

test("matches case only for words with capitals", () => {
  assert.equal(found("first", "alpha First"), 6);
  assert.equal(found("First", "alpha first"), -1);
  assert.deepEqual(spans(["al", "zz"], "alpha"), [[0, 2]]);
});

test("a session matches through its project, and shows it", () => {
  assert.deepEqual(visible(rows, ""), [0, 1, 2, 3, 4]);
  assert.deepEqual(visible(rows, "two"), [1, 3]);
  assert.deepEqual(visible(rows, "alpha two"), [1, 3]);
  assert.deepEqual(visible(rows, "alpha"), [1, 2, 3]);
  assert.deepEqual(visible(rows, "日本"), [4]);
  assert.deepEqual(visible(rows, "nothing"), []);
});

test("says what Enter does", () => {
  assert.match(hint(rows[0], "codex"), /new codex session in a new project/);
  assert.match(hint(rows[2], "codex"), /switch/);
  assert.match(hint(rows[3], "codex"), /resume/);
  assert.match(hint(["session", "/a", "", "x"], "codex"), /new codex session for this/);
});

test("reads keys from what the terminal sends", () => {
  assert.deepEqual(parseKeys("a\x1b[A\x1bOB\x0e\r\x7f"), ["a", "up", "down", "ctrl-n", "enter", "backspace"]);
  assert.deepEqual(parseKeys("\x1b"), ["esc"]);
  assert.deepEqual(parseKeys("\x1b[1;2B\x1b[6~"), ["shift-down", "pagedown"]);
  assert.deepEqual(parseKeys("\x1b[99~日"), ["日"]);
  assert.deepEqual(parseKeys("\x1bb"), []);
});

const after = (...keys: string[]) => keys.reduce((s, k) => press(s, k, rows, agents, 3), start(rows, agents));

test("moves within the list", () => {
  assert.equal(after("down", "ctrl-n").cursor, 2);
  assert.equal(after("up").cursor, 0);
  assert.equal(after("pagedown", "pagedown").cursor, 4);
  assert.equal(after("pagedown", "ctrl-p").cursor, 2);
});

test("filters as the user types, and edits the query", () => {
  const typed = after("t", "w", "o");
  assert.deepEqual(typed.shown, [1, 3]);
  assert.equal(after("t", "w", "backspace").query, "t");
  assert.equal(after("a", " ", "b", "ctrl-w").query, "a ");
  assert.equal(after("a", "ctrl-u").query, "");
  assert.equal(after("down", "a").cursor, 0);
});

test("switches the agent, wrapping around", () => {
  assert.equal(after("right").agent, "codex");
  assert.equal(after("left").agent, "codex");
  assert.equal(after("ctrl-f", "ctrl-f").agent, "claude");
});

test("picks or quits", () => {
  assert.equal(after("enter").done, "picked");
  assert.equal(after("z", "z", "enter").done, "quit");
  for (const key of ["esc", "ctrl-g", "ctrl-c"]) assert.equal(after(key).done, "quit");
});

test("scrolls the preview", () => {
  assert.equal(after("shift-down", "shift-down", "shift-up").scroll, 1);
  assert.equal(after("shift-up").scroll, 0);
  assert.equal(after("shift-down", "down").scroll, 0);
});

const plain = (lines: string[]) => lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));

test("draws the list, its hint and the preview within the screen", () => {
  const screen = plain(draw(after("down"), rows, agents, "notes\nmore", 12, 60));
  assert.equal(screen[0], "project> ");
  assert.equal(screen[1], "  + new project with  claude  codex ");
  assert.equal(screen[2], "> alpha  First");
  assert.match(screen[listLines(12) + 1], /5\/5 {2}enter: start a new claude session in this project/);
  assert.equal(screen[listLines(12) + 2], "─".repeat(60));
  assert.deepEqual(screen.slice(listLines(12) + 3, listLines(12) + 5), ["notes", "more"]);
  assert.ok(screen.length <= 12);
});

test("keeps every line within the screen, and escapes out of it", () => {
  const long: Row[] = [["new", "", "", `+ ${"x".repeat(200)}`], ["project", "/a", "", "evil\x1b[2J title"]];
  const state = start(long, agents);
  const screen = draw(state, long, agents, "note\x1b]0;x\x07", 12, 30);
  for (const line of plain(screen)) assert.ok(columns(line) <= 30, line);
  assert.ok(!screen.join("").includes("\x1b[2J"));
  assert.ok(!screen.join("").includes("\x1b]"));
  assert.equal(printable("a\tb"), "a    b");
});

test("doesn't scroll the preview past its end", () => {
  const state = after("shift-down", "shift-down", "shift-down");
  draw(state, rows, agents, "one\ntwo", 12, 40);
  assert.equal(state.scroll, 1);
});

test("keeps the cursor in view", () => {
  const state = after("pagedown", "pagedown");
  const screen = plain(draw(state, rows, agents, "", 9, 40));
  assert.equal(state.top, 2);
  assert.match(screen[3], /^> beta/);
});
