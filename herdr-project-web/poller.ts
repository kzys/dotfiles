// Running herdr-project --poll as the server's child, which polls the
// pull requests, Slack and Linear until those move here.

import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { Watched } from "./state.ts";

// What the poller last reported, if anything, and who wants to know when
// it reports again.
let watched: Watched | null = null;
const listeners = new Set<() => void>();

/** Returns what the poller last reported, or null if it hasn't. */
export function lastReport(): Watched | null {
  return watched;
}

/** Calls listener whenever the poller reports. */
export function onReport(listener: () => void) {
  listeners.add(listener);
}

/** Keeps each line of reports, the poller's pipe, as what it last
 * reported, as long as it is a JSON object, and tells the listeners. */
export function readReports(reports: Readable) {
  createInterface({ input: reports }).on("line", (line) => {
    let report: unknown;
    try {
      report = JSON.parse(line);
    } catch {
      return;
    }
    if (!report || typeof report !== "object" || Array.isArray(report)) return;
    const { sections, inbox, owners } = report as Record<string, unknown>;
    watched = { sections, inbox, owners, at: new Date().toISOString() };
    for (const listener of listeners)
      try {
        listener();
      } catch (e) {
        console.error("herdr-project-web:", e);
      }
  });
}

/** Starts the command line in $HERDR_PROJECT_POLLER, a JSON array, from
 * env, writing to the terminal $HERDR_PROJECT_TTY if set, else to this
 * process's output, and reporting what it finds on a pipe, its fd 3,
 * which it learns from $HERDR_PROJECT_REPORT_FD. Returns its process,
 * whose stdio[3] is that pipe, or null if env names none. */
export function startPoller(env: NodeJS.ProcessEnv): ChildProcess | null {
  if (!env.HERDR_PROJECT_POLLER) return null;
  const [command, ...args] = JSON.parse(env.HERDR_PROJECT_POLLER) as string[];
  const out = env.HERDR_PROJECT_TTY ? openSync(env.HERDR_PROJECT_TTY, "w") : "inherit";
  const { HERDR_PROJECT_POLLER, HERDR_PROJECT_TTY, ...rest } = env;
  try {
    return spawn(command, args, {
      env: { ...rest, HERDR_PROJECT_REPORT_FD: "3" },
      stdio: ["ignore", out, out, "pipe"],
    });
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
