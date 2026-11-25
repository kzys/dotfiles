import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lastSubject } from "./worktrees.ts";

test("names a worktree's last commit again once it changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "herdr-project-web-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "pipe" });
  git("init", "-q");
  git("commit", "-q", "--allow-empty", "-m", "First");
  assert.equal(lastSubject(dir), "First");
  git("commit", "-q", "--allow-empty", "-m", "Second");
  assert.equal(lastSubject(dir), "Second");
});
