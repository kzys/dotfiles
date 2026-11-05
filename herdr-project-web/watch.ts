// Running the server as the watcher, in a Herdr pane of its own. This runs
// before there is a server to ask.

import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Returns the directory that keeps what the watcher saw last, under
 * $XDG_STATE_HOME from env, by default ~/.local/state. */
export const stateDirOf = (env: NodeJS.ProcessEnv) => join(env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local/state"), "herdr-project");

/** Returns the file that keeps the arguments of the watcher in Herdr pane
 * pane, one per line. Herdr restores the pane as a shell, and zshrc resumes
 * the watcher from it. */
export const watcherFile = (pane: string, env: NodeJS.ProcessEnv) => join(stateDirOf(env), "watcher", pane);

/** Records that the watcher runs in Herdr pane pane with args. */
export function rememberWatcher(pane: string, args: string[], env: NodeJS.ProcessEnv) {
  const path = watcherFile(pane, env);
  mkdirSync(join(stateDirOf(env), "watcher"), { recursive: true });
  writeFileSync(path, args.map((a) => `${a}\n`).join(""));
}

// A lock older than this was left by a process that died.
const STALE_MS = 30_000;

/** Calls f holding a lock on path, or does nothing if another process
 * holds it: shells starting together must not open a workspace each. */
function locked<T>(path: string, f: () => T): T | false {
  try {
    if (Date.now() - statSync(path).mtimeMs > STALE_MS) rmSync(path, { force: true });
  } catch {}
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch {
    return false;
  }
  try {
    return f();
  } finally {
    closeSync(fd);
    rmSync(path, { force: true });
  }
}

type Run = (...args: string[]) => any;

/** Starts the watcher in a new workspace named watch unless one exists or a
 * Herdr pane already has it, forgetting watcher panes that are gone, and
 * returns whether it did. herdr runs a herdr command, returning its parsed
 * output or raising with what it printed if it fails. The new workspace's
 * shell sees HERDR_PROJECT_WATCH and runs the watcher. */
export function startWatcher(herdr: Run, env: NodeJS.ProcessEnv): boolean {
  const state = stateDirOf(env);
  const folder = join(state, "watcher");
  mkdirSync(folder, { recursive: true });
  return locked(join(state, "watcher.lock"), () => {
    // A restore may bring back the workspace before its pane.
    const { workspaces } = herdr("workspace", "list").result;
    if (workspaces.some((w: { label?: string }) => w.label === "watch")) return false;
    for (const pane of readdirSync(folder)) {
      try {
        herdr("pane", "get", pane);
        return false;
      } catch (e) {
        // Other failures can't tell whether the pane is gone.
        if (!String((e as Error).message).includes("pane_not_found")) throw e;
        rmSync(join(folder, pane), { force: true });
      }
    }
    const created = herdr("workspace", "create", "--label", "watch", "--cwd", env.HOME!, "--env", "HERDR_PROJECT_WATCH=1", "--no-focus");
    rememberWatcher(created.result.root_pane.pane_id, [], env);
    return true;
  }) === true;
}

/** Returns env for the server as the watcher of the pull requests in orgs,
 * or all without orgs, showing them on the terminal tty if not null. */
export function serverEnv(env: NodeJS.ProcessEnv, orgs: string[], tty: string | null): NodeJS.ProcessEnv {
  return { ...env, HERDR_PROJECT_ORGS: JSON.stringify(orgs), ...(tty ? { HERDR_PROJECT_TTY: tty } : {}) };
}

/** Returns the arguments that run the server from directory web. Node
 * restarts it whenever restart.stamp there is touched, created if missing. */
export function serverArgs(web: string): string[] {
  const stamp = join(web, "restart.stamp");
  closeSync(openSync(stamp, "a"));
  return [`--watch-path=${stamp}`, "--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(web, "main.ts")];
}

/** Runs the server until it exits, writing its output to its log, and
 * leaving the terminal to the pull requests. SIGTERM or SIGHUP end it with
 * SIGTERM, which node's watch mode passes on, unlike SIGHUP. Ctrl-C reaches
 * it from the terminal. Watch mode outlives a server that fails, waiting for
 * the next restart, so the log is where that shows. If watch mode itself
 * ends, this says so until interrupted, so that its pane stays rather than
 * another opening. */
function runServer(orgs: string[], pane: string | null, tty: string | null) {
  const env = process.env;
  const log = join(stateDirOf(env), "web.log");
  if (!existsSync(join(import.meta.dirname, "node_modules"))) {
    console.log(`herdr-project --watch needs its packages: run npm install in ${import.meta.dirname}.`);
    process.on("SIGINT", () => {
      if (pane) rmSync(watcherFile(pane, env), { force: true });
      process.exit(0);
    });
    setInterval(() => {}, 1 << 30);
    return;
  }
  mkdirSync(stateDirOf(env), { recursive: true });
  const out = openSync(log, "w");
  const child = spawn(process.execPath, serverArgs(import.meta.dirname), { stdio: ["ignore", out, out], env: serverEnv(env, orgs, tty) });
  let stopped = false;
  let interrupted = false;
  let closed = false;
  for (const signal of ["SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      if (stopped || closed) process.exit(0);
      stopped = true;
      child.kill("SIGTERM");
    });
  }
  process.on("SIGINT", () => {
    interrupted = true;
    if (pane) rmSync(watcherFile(pane, env), { force: true });
    if (closed) process.exit(0);
  });
  child.on("error", (e) => console.log(`herdr-project --watch can't run the server: ${e.message}`));
  child.on("close", (code) => {
    closed = true;
    if (stopped || interrupted) process.exit(0);
    console.log(`herdr-project-web exited with ${code}; see ${log}.`);
    setInterval(() => {}, 1 << 30);
  });
}

/** Returns what herdr prints for args, parsed, or raises with it. */
function herdrCli(...args: string[]): any {
  const out = execFileSync(process.env.HERDR_BIN_PATH || "herdr", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 });
  return out.trim() ? JSON.parse(out) : {};
}

/** Runs herdr-project --watch [orgs...] or --start-watch. */
export function main(argv: string[]) {
  if (argv[0] === "--start-watch") {
    try {
      startWatcher((...args) => {
        try {
          return herdrCli(...args);
        } catch (e) {
          const { stdout, stderr } = e as { stdout?: string; stderr?: string };
          throw new Error(`${stdout ?? ""}${stderr ?? ""}`);
        }
      }, process.env);
    } catch {
      process.exitCode = 1;
    }
    return;
  }
  const orgs = argv.slice(1);
  const pane = process.env.HERDR_ENV === "1" ? process.env.HERDR_PANE_ID || null : null;
  if (pane) rememberWatcher(pane, orgs, process.env);
  // Node can't name its terminal, so it comes from the environment.
  runServer(orgs, pane, process.env.WATCH_TTY || null);
}
