import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { elapsed, parsePs, runningSubagents, sessionFolder, toolCommand, waitsByPid } from "./waits.ts";

const shell = (command: string) =>
  `/bin/bash -c source /Users/u/.claude/shell-snapshots/snapshot-bash-1.sh 2>/dev/null || true && eval '${command}' < /dev/null && pwd -P >| /tmp/claude-1-cwd`;

test("reads elapsed times", () => {
  assert.equal(elapsed("00:05"), 5);
  assert.equal(elapsed("13:39"), 13 * 60 + 39);
  assert.equal(elapsed("02:51:59"), 2 * 3600 + 51 * 60 + 59);
  assert.equal(elapsed("02-22:28:56"), 2 * 86_400 + 22 * 3600 + 28 * 60 + 56);
});

test("reads ps", () => {
  assert.deepEqual(parsePs("  10     1   01:02 claude --add-dir /d\n\n 11 10 00:03 sleep 60\n"), [
    { pid: 10, ppid: 1, seconds: 62, command: "claude --add-dir /d" },
    { pid: 11, ppid: 10, seconds: 3, command: "sleep 60" },
  ]);
});

test("reads the command of a Bash tool shell", () => {
  assert.equal(toolCommand(shell("cd ~/repos/x && gh pr checks 1 --watch")), "gh pr checks 1 --watch");
  assert.equal(toolCommand(shell(`gh pr checks 1 | grep -v '"'"'pass'"'"'`)), "gh pr checks 1 | grep -v 'pass'");
  assert.equal(toolCommand(shell("x").replace("'x'", "/p/watch.sh")), "/p/watch.sh");
  assert.equal(toolCommand("/bin/bash watch.sh"), null);
});

test("finds what each Claude runs in its shells", () => {
  const waits = waitsByPid([
    { pid: 10, ppid: 1, seconds: 900, command: "claude --resume s" },
    { pid: 11, ppid: 10, seconds: 60, command: shell("sleep 60") },
    { pid: 12, ppid: 10, seconds: 600, command: shell("gh pr checks 1 --watch") },
    { pid: 13, ppid: 12, seconds: 600, command: "gh pr checks 1 --watch" },
    { pid: 14, ppid: 10, seconds: 900, command: "/Applications/Whiteboard.app/Contents/MacOS/Whiteboard mcp" },
    { pid: 20, ppid: 1, seconds: 900, command: "zsh" },
    { pid: 21, ppid: 20, seconds: 60, command: shell("sleep 60") },
  ]);
  assert.deepEqual([...waits], [[10, [{ command: "gh pr checks 1 --watch", seconds: 600 }, { command: "sleep 60", seconds: 60 }]]]);
});

test("finds the subagents a session still runs", () => {
  const projects = mkdtempSync(join(tmpdir(), "waits-"));
  const folder = join(projects, "-p", "s1");
  mkdirSync(join(folder, "subagents"), { recursive: true });
  const meta = (name: string, m: object, at: number) => {
    const path = join(folder, "subagents", `${name}.meta.json`);
    writeFileSync(path, JSON.stringify(m));
    utimesSync(path, at / 1000, at / 1000);
  };
  const now = 1_000_000_000_000;
  meta("agent-a", { agentType: "reviewer", description: "Review the diff" }, now - 120_000);
  meta("agent-b", { agentType: "reviewer", description: "Done one", finished: true }, now - 60_000);
  meta("agent-d", { agentType: "reviewer", description: "Stopped", stoppedByUser: true }, now - 60_000);
  meta("agent-e", { agentType: "reviewer", description: "From before" }, now - 900_000);
  writeFileSync(join(folder, "subagents", "agent-c.meta.json"), "not json");
  assert.equal(sessionFolder(projects, "s1"), folder);
  assert.equal(sessionFolder(projects, "s2"), null);
  assert.deepEqual(runningSubagents(folder, now, now - 600_000), [{ command: "reviewer: Review the diff", seconds: 120 }]);
  assert.deepEqual(runningSubagents(join(projects, "missing"), now, 0), []);
});
