import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppSpace } from "../herdr/app.ts";
import { Namer } from "./naming.ts";

/** Returns an empty project root and state directory, and named, which
 * writes a project whose README.md gives it a name. */
function setUp() {
  const root = mkdtempSync(join(tmpdir(), "herdr-project-naming-"));
  const projectRoot = join(root, "project");
  const stateDir = join(root, "state");
  mkdirSync(projectRoot);
  return { projectRoot, stateDir, named: (dir: string, name: string) => {
    mkdirSync(join(projectRoot, dir), { recursive: true });
    writeFileSync(join(projectRoot, dir, "README.md"), `---\nname: ${name}\n---\n`);
  } };
}

test("names a project's workspace once, keeping those open at first as they are", async () => {
  const { projectRoot, stateDir, named } = setUp();
  named("20261001-old", "old");
  const asked: [string, any][] = [];
  const tryAsk = async (method: string, params?: object) => (asked.push([method, params]), {});
  const deps = { stateDir, projectRoot, tryAsk, spaces: async () => [], command: async () => ({}), onError: () => {} };
  const namer = new Namer(deps);
  named("20261002-new", "new");
  const herdr = {
    workspaces: [],
    panes: [
      { pane_id: "w1:p1", workspace_id: "w1", cwd: join(projectRoot, "20261001-old"), agent: "claude" },
      { pane_id: "w2:p1", workspace_id: "w2", cwd: join(projectRoot, "20261002-new"), agent: "claude" },
    ],
  };
  assert.equal(await namer.workspaces(herdr), true);
  assert.deepEqual(asked.filter(([m]) => m === "workspace.rename").map(([, p]) => p), [{ workspace_id: "w2", label: "new" }]);
  // A name given once, and another server reading the same state, leave it.
  asked.length = 0;
  await namer.workspaces(herdr);
  await new Namer(deps).workspaces(herdr);
  assert.deepEqual(asked, []);
});

test("names app spaces after their projects, again only when the name changes", async () => {
  const { projectRoot, stateDir, named } = setUp();
  named("20261001-a", "a");
  const folder = join(projectRoot, "20261001-a");
  let spaces: AppSpace[] = [{ id: "s1", name: "old", folder, machine: null }];
  const renamed: object[] = [];
  const deps = {
    stateDir, projectRoot, tryAsk: async () => null, spaces: async () => spaces,
    command: async (_: string, args: object) => renamed.push(args), onError: () => {},
  };
  const namer = new Namer(deps);
  // The spaces open at first count as named.
  await namer.appSpaces();
  assert.deepEqual(renamed, []);
  named("20261001-a", "b");
  await namer.appSpaces();
  assert.deepEqual(renamed, [{ id: "s1", name: "b" }]);
  // The user's own name stays until the project's changes.
  spaces = [{ id: "s1", name: "mine", folder, machine: null }];
  await namer.appSpaces();
  assert.deepEqual(renamed, [{ id: "s1", name: "b" }]);
});
