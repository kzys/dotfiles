import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Readable } from "node:stream";
import { lastReport, onReport, readReports, startPoller } from "./poller.ts";

const here = import.meta.dirname;

test("runs the poller only when asked, writing to the terminal it names", async () => {
  assert.equal(startPoller({}), null);
  const tty = join(mkdtempSync(join(tmpdir(), "poller-")), "tty");
  writeFileSync(tty, "");
  const poller = startPoller({
    HERDR_PROJECT_POLLER: JSON.stringify([process.execPath, "-e", "console.log(process.argv[1], !!process.env.HERDR_PROJECT_TTY)", "an org"]),
    HERDR_PROJECT_TTY: tty,
  })!;
  await once(poller, "exit");
  assert.equal(readFileSync(tty, "utf8"), "an org false\n");
});

test("keeps what the poller last reported", async () => {
  // It reports on the fd it is told, skipping lines that aren't reports.
  const script = `const fd = Number(process.env.HERDR_PROJECT_REPORT_FD);
const fs = require("fs");
fs.writeSync(fd, '{"sections": [1], "inbox": {"a": []}}\\nnot json\\n[2]\\n');
fs.writeSync(fd, '{"sections": [3], "inbox": {}}\\n');`;
  const poller = startPoller({ HERDR_PROJECT_POLLER: JSON.stringify([process.execPath, "-e", script]) })!;
  let heard = 0;
  onReport(() => heard++);
  assert.equal(lastReport(), null);
  readReports(poller.stdio[3] as Readable);
  await once(poller.stdio[3]!, "close");
  assert.equal(heard, 2);
  assert.deepEqual({ ...lastReport(), at: undefined }, { sections: [3], inbox: {}, at: undefined });
});

/** Starts a server that runs a poller, which records its pid and runs
 * script, and then runs then. Returns the server, the promise of its
 * exit and the poller's pid once both are up. */
async function serve(script: string, then = "") {
  const dir = mkdtempSync(join(tmpdir(), "poller-"));
  const pidFile = join(dir, "pid");
  const server = join(dir, "server.ts");
  writeFileSync(
    server,
    `import { startPoller, stayWithPoller } from ${JSON.stringify(join(here, "poller.ts"))};
stayWithPoller(startPoller(process.env)!, 500);
console.log("ready");
${then}`,
  );
  const child = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", server], {
    env: {
      ...process.env,
      HERDR_PROJECT_POLLER: JSON.stringify([
        process.execPath,
        "-e",
        `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); ${script}`,
      ]),
    },
    stdio: ["ignore", "pipe", "ignore"],
  });
  const exited = once(child, "exit");
  await once(child.stdout!, "data");
  for (;;) {
    try {
      const pid = Number(readFileSync(pidFile, "utf8"));
      if (pid) return { child, exited, pid };
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
}

const forever = "setInterval(() => {}, 1000);";

/** Waits until process pid is gone, failing after a few seconds. */
async function gone(pid: number) {
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") return;
      throw e;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`process ${pid} is still running`);
}

test("ends the poller with the server", async () => {
  const { child, exited, pid } = await serve(forever);
  child.kill("SIGTERM");
  assert.deepEqual(await exited, [0, null]);
  await gone(pid);
});

test("kills a poller that doesn't end on its own", async () => {
  // Ctrl-C reaches only the server here, and the poller ignores SIGTERM.
  const { child, exited, pid } = await serve(`process.on("SIGTERM", () => {}); ${forever}`);
  child.kill("SIGINT");
  assert.deepEqual(await exited, [0, null]);
  await gone(pid);
});

test("ends the poller when the server fails", async () => {
  const { child, exited, pid } = await serve(forever, `process.on("SIGUSR2", () => { throw new Error("broken"); });`);
  child.kill("SIGUSR2");
  assert.deepEqual(await exited, [1, null]);
  await gone(pid);
});

test("ends the server when the poller ends", async () => {
  const { exited } = await serve("setTimeout(() => process.exit(3), 200);", forever);
  assert.deepEqual(await exited, [3, null]);
});

test("keeps polling when the page fails", async () => {
  // main.ts beside a page that fails to load, and one that fails later.
  for (const page of [`throw new Error("broken");`, `setTimeout(() => { throw new Error("broken"); }, 0);`]) {
    const dir = mkdtempSync(join(tmpdir(), "poller-"));
    copyFileSync(join(here, "main.ts"), join(dir, "main.ts"));
    copyFileSync(join(here, "poller.ts"), join(dir, "poller.ts"));
    writeFileSync(join(dir, "server.ts"), page);
    const flag = join(dir, "polled");
    const child = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(dir, "main.ts")], {
      env: {
        ...process.env,
        HERDR_PROJECT_POLLER: JSON.stringify([
          process.execPath,
          "-e",
          `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(flag)}, ""), 1000); ${forever}`,
        ]),
      },
      stdio: "ignore",
    });
    const exited = once(child, "exit");
    for (let i = 0; i < 100 && !existsSync(flag); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(existsSync(flag), "the poller ran on");
    child.kill("SIGTERM");
    assert.deepEqual(await exited, [0, null]);
  }
});
