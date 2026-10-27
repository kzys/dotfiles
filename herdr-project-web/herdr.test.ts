import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HerdrError, request } from "./herdr.ts";

test("asks Herdr one request per connection", async (t) => {
  // A stand-in for Herdr's socket that answers each request as told.
  const dir = mkdtempSync(join(tmpdir(), "herdr-"));
  const path = join(dir, "herdr.sock");
  let connections = 0;
  const requests: unknown[] = [];
  const server = createServer((socket) => {
    connections++;
    socket.once("data", (data) => {
      const req = JSON.parse(String(data));
      requests.push(req);
      if (req.method === "pane.read") {
        // In two writes, split inside a character.
        const reply = Buffer.from(`${JSON.stringify({ id: req.id, result: { read: { text: "─✓" } } })}\n`);
        const at = reply.indexOf(Buffer.from("─")) + 1;
        socket.write(reply.subarray(0, at));
        setTimeout(() => socket.end(reply.subarray(at)), 20);
      }
      else if (req.method === "pane.close")
        socket.end(`${JSON.stringify({ id: req.id, error: { code: "pane_not_found", message: "gone" } })}\n`);
      else if (req.method === "garbled") socket.end("not json\n");
      else if (req.method === "hang") return;
      else socket.end();
    });
  });
  await new Promise<void>((r) => server.listen(path, r));
  t.after(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  assert.deepEqual(await request(path, "pane.read", { pane_id: "w1:p1" }), { read: { text: "─✓" } });
  assert.deepEqual(requests, [{ id: "pane.read", method: "pane.read", params: { pane_id: "w1:p1" } }]);
  assert.equal(connections, 1);
  await assert.rejects(request(path, "pane.close"), (e) => e instanceof HerdrError && /pane_not_found: gone/.test(e.message));
  // Failing to get an answer isn't Herdr's error.
  for (const ask of [
    () => request(path, "garbled"),
    () => request(path, "quiet"),
    () => request(path, "hang", {}, 100),
    () => request(join(path, "none"), "x"),
  ])
    await assert.rejects(ask, (e) => e instanceof Error && !(e instanceof HerdrError));
});
