import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HerdrEvents, subscriptions } from "./events.ts";

test("subscribes to each agent pane's state and to lifecycle events", () => {
  const subs = subscriptions({
    workspaces: [],
    panes: [
      { pane_id: "w2:p1", workspace_id: "w2", agent: "claude" },
      { pane_id: "w1:p1", workspace_id: "w1", agent: null },
      { pane_id: "w1:p2", workspace_id: "w1", agent: "codex" },
    ],
  }) as { type: string; pane_id?: string }[];
  assert.deepEqual(subs.filter((s) => s.pane_id), [
    { type: "pane.agent_status_changed", pane_id: "w1:p2" },
    { type: "pane.agent_status_changed", pane_id: "w2:p1" },
  ]);
  assert.ok(subs.some((s) => s.type === "pane.closed"));
  // Without Herdr, there are only the lifecycle events.
  assert.ok(subscriptions(null).every((s) => !("pane_id" in s)));
});

test("reads Herdr again on its events, and subscribes again when they fail", async () => {
  // A stand-in for Herdr's socket that answers each subscription as told.
  const path = join(mkdtempSync(join(tmpdir(), "herdr-events-")), "herdr.sock");
  const requests: string[] = [];
  const replies = ['{"id":"watch","result":{"type":"subscription_started"}}\n{"data":{"pane_id":"w1:p1"}}\n'];
  const server = createServer((socket) => {
    socket.on("data", (d) => {
      requests.push(d.toString());
      socket.write(replies.shift() ?? '{"id":"watch","error":{"code":"pane_not_found"}}\n');
    });
  });
  await new Promise<void>((done) => server.listen(path, done));
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  };

  let changes = 0;
  const herdr = { workspaces: [], panes: [{ pane_id: "w1:p1", workspace_id: "w1", agent: "claude" }] };
  const events = new HerdrEvents(async () => path, () => changes++, 20);
  try {
    events.update(herdr);
    // Once on subscribing, and once on the event.
    await until(() => changes === 2);
    assert.equal(changes, 2);
    assert.match(requests[0], /"pane_id":"w1:p1"/);

    // The same panes need no new subscription.
    events.update(herdr);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(requests.length, 1);

    // New agent panes do; refused, it asks for a read after retryMs.
    events.update({ ...herdr, panes: [...herdr.panes, { pane_id: "w2:p1", workspace_id: "w2", agent: "codex" }] });
    await until(() => changes === 3);
    assert.equal(changes, 3);
    assert.equal(requests.length, 2);
  } finally {
    events.close();
    server.close();
  }
});
