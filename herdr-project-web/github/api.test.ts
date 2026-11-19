import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pullRequests } from "./pullrequest.ts";
import { fetch, requestCopilot, searchQuery } from "./api.ts";
import { prNode, tmp } from "./fixtures.ts";

test("searches pull requests in orgs", () => {
  const since = new Date(2026, 9, 2, 12);
  assert.equal(searchQuery(since), "is:pr author:@me archived:false updated:>=2026-10-02 sort:updated-desc");
  assert.equal(searchQuery(since, ["a", "b"]),
               "is:pr author:@me archived:false org:a org:b updated:>=2026-10-02 sort:updated-desc");
  assert.equal(searchQuery(since, ["a"], true),
               "is:pr author:@me archived:false is:open org:a updated:>=2026-10-02 sort:updated-desc");
});

test("shows why gh failed", async () => {
  const gh = join(tmp(), "gh");
  writeFileSync(gh, '#!/bin/sh\necho "HTTP 502: Bad Gateway" >&2\nexit 1\n');
  chmodSync(gh, 0o755);
  await assert.rejects(fetch(gh), { message: "HTTP 502: Bad Gateway" });
});

test("asks Copilot to review with gh", async () => {
  const dir = tmp();
  const gh = join(dir, "gh");
  writeFileSync(gh, `#!/bin/sh\necho "$@" > ${join(dir, "args")}\n`);
  chmodSync(gh, 0o755);
  await requestCopilot("https://github.com/org/app/pull/1", gh);
  assert.equal(readFileSync(join(dir, "args"), "utf8"), "pr edit https://github.com/org/app/pull/1 --add-reviewer @copilot\n");
  writeFileSync(gh, '#!/bin/sh\necho "no Copilot here" >&2\nexit 1\n');
  await assert.rejects(requestCopilot("https://github.com/org/app/pull/1", gh), { message: "no Copilot here" });
});

test("keeps what gh could read when the rest is forbidden", async () => {
  const dir = tmp();
  const write = (name: string, errors: object[]) => {
    const out = JSON.stringify({ data: { open: { nodes: [null] }, search: { nodes: [null, prNode(1, "a")] } }, errors });
    writeFileSync(join(dir, `${name}.json`), out);
    writeFileSync(join(dir, name), `#!/bin/sh\ncat ${join(dir, `${name}.json`)}\necho "gh: SAML enforcement" >&2\nexit 1\n`);
    chmodSync(join(dir, name), 0o755);
    return join(dir, name);
  };
  const prs = pullRequests(await fetch(write("forbidden", [{ type: "FORBIDDEN" }, { type: "FORBIDDEN" }])));
  assert.deepEqual(prs.map((p) => p.number), [1]);
  await assert.rejects(fetch(write("other", [{ type: "FORBIDDEN" }, { type: "INTERNAL" }])), { message: "gh: SAML enforcement" });
});
