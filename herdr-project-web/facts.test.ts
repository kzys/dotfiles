import assert from "node:assert/strict";
import { test } from "node:test";
import { effect, signal } from "@preact/signals-core";
import { Facts } from "./facts.ts";
import type { Herdr } from "./herdr/backend.ts";
import type { HookEvent } from "./agents/hooks.ts";
import type { Found } from "./checks/watched.ts";

const asked: HookEvent = { agent: "claude", event: "PermissionRequest", session: "s", detail: "Bash: ls", at: 5 };
const pane = (pane_id: string, agent_status: string): Herdr["panes"][number] =>
  ({ pane_id, workspace_id: "w1", agent: "claude", agent_status });

/** Returns how many times facts have changed so far, counting from now. */
function changes(facts: InstanceType<typeof Facts>) {
  let n = -1;
  effect(() => {
    facts.all.value;
    n++;
  });
  return () => n;
}

test("forgets the hook events of panes gone and of permission requests answered, in one change", () => {
  const facts = new Facts(signal({ moves: {}, asks: {} }));
  facts.setHerdr({ workspaces: [], panes: [pane("w1:p1", "blocked"), pane("w1:p2", "blocked"), pane("w1:p3", "blocked")] });
  for (const p of ["w1:p1", "w1:p2", "w1:p3"]) facts.setHook(p, asked);
  const changed = changes(facts);
  facts.setHerdr({ workspaces: [], panes: [pane("w1:p1", "working"), pane("w1:p2", "blocked")] });
  assert.deepEqual([...facts.hooks.value.keys()], ["w1:p2"]);
  assert.equal(changed(), 1);
});

test("changes nothing for what was read the same again", () => {
  const facts = new Facts(signal({ moves: {}, asks: {} }));
  const herdr = { workspaces: [], panes: [pane("w1:p1", "idle")] };
  const found: Found = { title: "Panes", section: null, items: [] };
  facts.setHerdr(herdr);
  facts.setFound("Panes", found);
  facts.setProjects([], [["/p/a", "a"]]);
  const before = facts.herdr.value;
  facts.setHerdr(structuredClone(herdr));
  assert.equal(facts.herdr.value, before);
  const changed = changes(facts);
  facts.setFound("Panes", { ...found });
  facts.setProjects([], [["/p/a", "a"]]);
  facts.setPulls(null);
  assert.equal(changed(), 0);
  facts.setFound("Panes", { ...found, title: "Panes!" });
  assert.equal(changed(), 1);
  assert.equal(facts.found.value.get("Panes")?.title, "Panes!");
});

test("reads the Herdr app's panes once, even if there are none", () => {
  const facts = new Facts(signal({ moves: {}, asks: {} }));
  facts.setAppPanes([]);
  assert.equal(facts.appRead.value, true);
  const changed = changes(facts);
  facts.setAppPanes([]);
  assert.equal(changed(), 0);
  facts.setAppPanes([pane("t1", "working")]);
  assert.equal(changed(), 1);
});

test("counts each read of Herdr, even one that read the same", () => {
  const facts = new Facts(signal({ moves: {}, asks: {} }));
  const herdr = { workspaces: [], panes: [pane("w1:p1", "idle")] };
  facts.setHerdr(herdr);
  const changed = changes(facts);
  facts.setHerdr(structuredClone(herdr));
  assert.equal(facts.herdrReads.value, 2);
  assert.equal(changed(), 1);
});
