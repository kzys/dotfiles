import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { codexTokens, lastPrompt, percent, resumedText, roleToReport, sessionReport, statusLine, statusTokens, usageFile } from "./report.ts";

const temp = () => mkdtempSync(join(tmpdir(), "report-"));

test("reads the context usage, or works it out", () => {
  assert.equal(percent({ context_window: { used_percentage: 12.7 } }), 12);
  assert.equal(percent({ context_window: {
    current_usage: { input_tokens: 1000, cache_read_input_tokens: 49000 }, context_window_size: 200000,
  } }), 25);
  assert.equal(percent({ context_window: { used_percentage: "x" } }), null);
  assert.equal(percent({ context_window: { current_usage: {} } }), null);
  assert.equal(percent({}), null);
});

test("shows every part of the status", () => {
  const data = {
    context_window: { context_window_size: 1000000 },
    model: { display_name: "Opus" },
    effort: { level: "high" },
    prompt_cache: { warm: true, expires_at: 1600 },
    rate_limits: { five_hour: { used_percentage: 33.3, resets_at: 5000 }, seven_day: { used_percentage: 5 } },
  };
  assert.equal(statusLine(data, 12, 1000, () => "04:00"), "12% of 1M ctx · Opus (high) · cache 10m · 5h 33% (04:00) · 7d 5%");
});

test("leaves out what the status doesn't say", () => {
  assert.equal(statusLine({}, 3, 0, () => ""), "3% ctx");
  assert.equal(statusLine({ context_window: { context_window_size: 200000 }, prompt_cache: { warm: false } }, 3, 0, () => ""),
               "3% of 200k ctx · cache cold");
});

test("leaves the usage in the session's project only", () => {
  const projects = temp();
  mkdirSync(join(projects, "p"));
  const data = { session_id: "s", cwd: join(projects, "p"), context_window: { used_percentage: 9, context_window_size: 100 } };
  assert.deepEqual(usageFile(data, projects), [
    join(projects, "p/claude-s.json"), '{"used_percentage":9,"context_window_size":100}',
  ]);
  assert.equal(usageFile({ ...data, cwd: temp() }, projects), null);
  assert.equal(usageFile({ ...data, session_id: "" }, projects), null);
  assert.equal(usageFile({ ...data, cwd: join(projects, "gone") }, projects), null);
});

test("finds the last prompt near the end of the transcript", () => {
  const path = join(temp(), "s.jsonl");
  writeFileSync(path, `${JSON.stringify({ lastPrompt: "old" })}\n${JSON.stringify({ lastPrompt: " new\n prompt " })}\n{}\n`);
  assert.equal(lastPrompt(path), "new prompt");
  assert.equal(lastPrompt(join(temp(), "none")), "");
  assert.equal(lastPrompt(undefined), "");
});

test("flags a background session instead of reporting its directory as the pane's", () => {
  const data = { cwd: "/home/me/x", model: { display_name: "Opus" } };
  assert.deepEqual(statusTokens(data, 5, "hi", "main", "/home/me", true), {
    bg: null, cwd: "/home/me/x", ctx: "5%", prompt: "hi", model: "Opus", dir: "~/x", branch: "main",
  });
  const bg = statusTokens(data, 5, "hi", "main", "/home/me", false);
  assert.equal(bg.bg, "bg");
  assert.ok(!("cwd" in bg));
});

test("reports a starting session, if it has one", () => {
  assert.deepEqual(sessionReport({ session_id: "s", transcript_path: "/t", source: "resume" }, "w1:p1", 7), {
    pane_id: "w1:p1", source: "herdr:claude", agent: "claude", seq: 7,
    agent_session_id: "s", agent_session_path: "/t", session_start_source: "resume",
  });
  assert.equal(sessionReport({}, "w1:p1", 7), null);
});

test("defaults the role, and a resumed session's own role wins", () => {
  assert.equal(roleToReport(null, false, null), "main");
  assert.equal(roleToReport("main", false, null), null);
  assert.equal(roleToReport("main", true, "search"), "search");
  assert.equal(roleToReport("search", true, "search"), null);
  assert.equal(roleToReport(null, true, null), "main");
});

test("reports what a Codex hook says", () => {
  const data = { cwd: "/p", prompt: " a\n prompt " };
  assert.deepEqual(codexTokens("UserPromptSubmit", data, { model: "m" }, 40, "main"), {
    bg: null, cwd: "/p", dir: "/p", branch: "main", prompt: "a prompt", model: "m", ctx: "40%",
  });
  const start = codexTokens("SessionStart", { cwd: "/p" }, { title: "Title" }, null, "");
  assert.equal(start.prompt, "Title");
  assert.ok("ctx" in start && start.ctx === null);
  assert.ok(!("ctx" in codexTokens("Stop", { cwd: "/p" }, undefined, null, "")));
});

test("tells a resumed session its instructions replace the old ones", () => {
  assert.match(resumedText("rules"), /^This session resumed[\s\S]*\n\nrules$/);
});
