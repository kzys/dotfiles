import assert from "node:assert/strict";
import { test } from "node:test";
import { connected, connectors, structured } from "./headless.ts";
import { checkQueue } from "./queues.ts";

test("reads structured output", () => {
  const found = [{ channel_id: "C1" }];
  assert.deepEqual(structured({ structured_output: { conversations: found } }, "conversations"), found);
  assert.throws(() => structured({ is_error: true, result: "denied" }, "conversations"), /denied/);
  assert.throws(() => structured({ result: "no schema" }, "conversations"));
});

test("checks only sources with connectors", async () => {
  const listing =
    "Checking MCP server health…\n\n" +
    "claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected\n" +
    "claude.ai Slack: https://mcp.slack.com/mcp - ! Needs authentication\n" +
    "claude.ai Linear: https://mcp.linear.app/mcp - ✔ Connected\n" +
    "local: npx server - ✔ Connected\n";
  const names = connected(listing);
  assert.deepEqual([...names].sort(), ["Gmail", "Linear"]);
  let checked = 0;
  const item = { project: null, role: null, mark: "linear", text: "an item" };
  const check = async () => {
    checked++;
    return { lines: ["a conversation"], rows: [{ label: "a" }], items: [item] };
  };
  const now = () => new Date("2026-10-16T09:00:00Z");
  const last = { title: "Slack", section: null, items: [item] };

  assert.deepEqual(await checkQueue("Linear", "Linear", names, check, null, now, 60_000), {
    title: "Linear",
    section: { title: "Linear", at: "2026-10-16T09:00:00.000Z", next: "2026-10-16T09:01:00.000Z",
               lines: ["a conversation"], entries: [{ label: "a" }] },
    items: [item],
  });
  // Without the connector, nothing runs, and its section and items go.
  assert.deepEqual(await checkQueue("Slack", "Slack", names, check, last, now, 60_000),
                   { title: "Slack", section: null, items: [] });
  // Listing failed, or the check did: say so and keep the last items.
  const failed = await checkQueue("Slack", "Slack", null, check, last, now, 60_000);
  assert.deepEqual([failed.section?.lines, failed.items], [["Cannot list the claude.ai connectors."], [item]]);
  const broken = await checkQueue("Slack", "Gmail", names, async () => { throw new Error("no\nmore"); }, last, now, 60_000);
  assert.deepEqual([broken.section?.lines, broken.items], [["Cannot check Slack: Error: no"], [item]]);
  assert.equal(checked, 1);
  assert.equal(await connectors("false"), null);
});
