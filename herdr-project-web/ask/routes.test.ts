import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { Asks } from "./ask.ts";
import { routeAsks, routeReplies } from "./routes.ts";

const path = () => join(mkdtempSync(join(tmpdir(), "asks-")), "asks.json");

test("asks from the page and takes replies on the socket", async () => {
  const page = new Hono();
  const socket = new Hono();
  const asks = new Asks(path(), () => "tok");
  let changes = 0;
  let agents = [{ pane: "w1:p1", label: "a" }];
  const server = { asks, askees: () => agents, queue: () => "m1", changed: () => changes++ };
  routeAsks(page, server, (h) => h.get("x-ok") === "1");
  routeReplies(socket, server);
  const ask = (body: string, ok = "1") => page.request("/api/asks", { method: "POST", body, headers: { "x-ok": ok } });
  assert.equal((await ask('{"text":"hi"}', "0")).status, 403);
  assert.equal((await ask('{"text":"  "}')).status, 400);
  assert.equal((await ask('{"text":" hi "}')).status, 204);
  assert.equal(asks.all()[0].text, "hi");
  agents = [];
  assert.equal((await ask('{"text":"hi"}')).status, 409);
  const reply = (body: string) => socket.request("/reply", { method: "POST", body });
  assert.equal((await reply("token=tok&text=")).status, 400);
  assert.equal((await reply("token=nope&text=x")).status, 404);
  const res = await reply(`token=tok&text=${encodeURIComponent("waiting on CI")}`);
  assert.equal(res.status, 200);
  assert.equal(asks.all()[0].agents[0].reply?.text, "waiting on CI");
  assert.equal(changes, 2);
});
