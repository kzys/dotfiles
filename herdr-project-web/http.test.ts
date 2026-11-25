import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { jsonBody } from "./http.ts";

test("reads a JSON object from a request's body, refusing anything else", async () => {
  const app = new Hono();
  app.post("/", async (c) => c.json(await jsonBody(c)));
  const send = async (body: string) => {
    const res = await app.request("/", { method: "POST", body });
    return [res.status, await res.json()];
  };
  assert.deepEqual(await send('{"a":1}'), [200, { a: 1 }]);
  assert.deepEqual(await send(""), [200, {}]);
  for (const body of ["not json", "null", "[1]", "3"]) assert.deepEqual(await send(body), [400, { error: "not JSON" }]);
});
