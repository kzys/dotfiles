import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AgentReports } from "./agent-reports.ts";

test("gives a resumed session in a project its instructions again", async () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-project-reports-"));
  const projectRoot = join(root, "project");
  const project = join(projectRoot, "20261001-a");
  mkdirSync(join(project, "wt"), { recursive: true });
  let changes = 0;
  const reports = new AgentReports({
    home: root, projectRoot, dotfiles: dirname(import.meta.dirname), stateDir: join(root, "state"),
    tryAsk: async () => null, noteCheckout: () => {}, projectsChanged: () => changes++, onError: () => {},
  });
  const resumed = await reports.onHook(null, { agent: "claude", event: "SessionStart" }, { source: "resume", cwd: join(project, "wt") });
  assert.match(resumed, new RegExp(`its task's directory is \`${project}\``));
  // Only resumed Claude sessions in a project, but every event may have changed the projects.
  assert.equal(await reports.onHook(null, { agent: "claude", event: "SessionStart" }, { source: "startup", cwd: project }), "");
  assert.equal(await reports.onHook(null, { agent: "claude", event: "SessionStart" }, { source: "resume", cwd: root }), "");
  assert.equal(await reports.onHook(null, { agent: "codex", event: "Stop" }, { cwd: project }), "");
  assert.equal(changes, 4);
});
