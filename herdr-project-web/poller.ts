// Running herdr-project --poll as the server's child, which polls the
// pull requests, panes, Slack and Linear until those move here.

import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";

/** Starts the command line in $HERDR_PROJECT_POLLER, a JSON array, from
 * env, writing to the terminal $HERDR_PROJECT_TTY if set, else to this
 * process's output. Returns its process, or null if env names none. */
export function startPoller(env: NodeJS.ProcessEnv): ChildProcess | null {
  if (!env.HERDR_PROJECT_POLLER) return null;
  const [command, ...args] = JSON.parse(env.HERDR_PROJECT_POLLER) as string[];
  const out = env.HERDR_PROJECT_TTY ? openSync(env.HERDR_PROJECT_TTY, "w") : "inherit";
  const { HERDR_PROJECT_POLLER, HERDR_PROJECT_TTY, ...rest } = env;
  try {
    return spawn(command, args, { env: rest, stdio: ["ignore", out, out] });
  } finally {
    if (typeof out === "number") closeSync(out);
  }
}

/** Ties this process to poller: it exits when poller does, and ends
 * poller when it exits itself, or gets a signal. A terminal's Ctrl-C
 * reaches poller too, which then forgets its pane, so poller has grace
 * milliseconds to end on its own before it is killed. */
export function stayWithPoller(poller: ChildProcess, grace = 5000) {
  let stopping = false;
  const ended = new Promise<void>((resolve) => {
    if (poller.exitCode !== null || poller.signalCode !== null) resolve();
    else poller.once("exit", () => resolve()).once("error", () => resolve());
  });
  ended.then(() => {
    if (!stopping) console.error(`herdr-project --poll ended: ${poller.signalCode ?? poller.exitCode}`);
    // Ctrl-C may end poller before this process sees it.
    process.exit(stopping ? 0 : (poller.exitCode ?? 1));
  });
  // Uncaught errors end this process too.
  process.on("exit", () => poller.kill("SIGTERM"));
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.on(signal, () => {
      stopping = true;
      if (signal !== "SIGINT") poller.kill(signal);
      setTimeout(() => poller.kill("SIGKILL"), grace).unref();
    });
}
