// Running the server as the watcher, in a Herdr pane of its own or in the
// background. This runs before there is a server to ask.

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { type Server, connect, createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Returns the directory that keeps what the watcher saw last, under
 * $XDG_STATE_HOME from env, by default ~/.local/state. */
export const stateDirOf = (env: NodeJS.ProcessEnv) => join(env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local/state"), "herdr-project");

/** Returns the server's socket under the state directory from env. */
export const socketOf = (env: NodeJS.ProcessEnv) => join(stateDirOf(env), "run/server.sock");

/** Resolves to whether a server answers on the Unix socket at path. One
 * whose queue of connections is full, as while it restarts, counts:
 * Linux refuses those with EAGAIN. */
export function answers(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path);
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", (e: NodeJS.ErrnoException) => resolve(e.code === "EAGAIN"));
  });
}

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

/** Returns env for the watcher in the background: without what tells it
 * of the pane and workspace that started it, which it doesn't run in. */
export function backgroundEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { HERDR_ENV: _, HERDR_PANE_ID: __, HERDR_WORKSPACE_ID: ___, WATCH_TTY: ____, ...rest } = env;
  return rest;
}

/** Starts the watcher in the background, in a session of its own so that
 * the terminal that started it can close, writing its output to
 * watch.log, and returns at once. It leaves a server already running be. */
function startBackground(env: NodeJS.ProcessEnv) {
  const state = stateDirOf(env);
  mkdirSync(state, { recursive: true });
  const log = openSync(join(state, "watch.log"), "a");
  const args = [...NODE_FLAGS, join(import.meta.dirname, "watch-main.ts"), "--watch"];
  spawn(process.execPath, args, {
    cwd: env.HOME, detached: true, stdio: ["ignore", log, log], env: { ...backgroundEnv(env), HERDR_PROJECT_BACKGROUND: "1" },
  }).unref();
  closeSync(log);
}

/** Returns env for the server as the watcher of the pull requests in orgs,
 * or all without orgs, showing them on the terminal tty if not null. */
export function serverEnv(env: NodeJS.ProcessEnv, orgs: string[], tty: string | null): NodeJS.ProcessEnv {
  return { ...env, HERDR_PROJECT_ORGS: JSON.stringify(orgs), ...(tty ? { HERDR_PROJECT_TTY: tty } : {}) };
}

const NODE_FLAGS = ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"];

/** Returns the arguments that run the server from directory web. */
export const serverArgs = (web: string): string[] => [...NODE_FLAGS, join(web, "main.ts")];

// A lock older than this was left by a process that died holding it.
const LOCK_STALE_MS = 10_000;

/** Runs f holding the lock file at path, waiting while another process
 * holds it, or taking it over once stale. */
async function holding<T>(path: string, f: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      closeSync(openSync(path, "wx"));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) rmSync(path, { force: true });
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await f();
  } finally {
    rmSync(path, { force: true });
  }
}

/** Resolves to server once it listens on where, as server.listen takes it. */
const listening = (server: Server, where: string | { port: number; host: string }) =>
  new Promise<Server>((resolve, reject) => {
    server.once("error", reject);
    server.listen(where, () => resolve(server));
  });

/** Listens on a new Unix socket at path, in a directory only this user
 * can enter, and on port, if given, for a server to take over, and
 * resolves to them, the page's null if the port is taken, or to null if a
 * server already answers at path. It listens at another name first and
 * renames the socket into place, so that closing it here, once handed
 * on, doesn't remove the file. Those starting together take turns, or one
 * could replace the socket another just made, or take the port from it. */
export async function bindSockets(path: string, port?: number): Promise<{ socket: Server; page: Server | null } | null> {
  mkdirSync(dirname(path), { recursive: true });
  chmodSync(dirname(path), 0o700);
  return holding(`${path}.lock`, async () => {
    if (await answers(path)) return null;
    // The page's port may be taken; the checks run without it.
    const page = port === undefined ? null : await listening(handOff(), { port, host: "127.0.0.1" }).catch((e) => {
      console.log(`herdr-project --watch can't listen on port ${port}: ${e.message}`);
      return null;
    });
    const temporary = `${path}.${process.pid}`;
    rmSync(temporary, { force: true });
    const socket = await listening(handOff(), temporary);
    renameSync(temporary, path);
    return { socket, page };
  });
}

/** Returns a server for a socket to hand on, which drops what connects
 * before it does, rather than leave it hanging. */
const handOff = () => createServer((connection) => connection.destroy());

/** Returns the file descriptor of server, a listening socket. Node has no
 * public way to read it. */
const fdOf = (server: Server): number => (server as unknown as { _handle: { fd: number } })._handle.fd;

/** Returns how long to wait before starting again a server that failed
 * quickly failures times in a row, 1 or more: longer each time, but short
 * enough that the hooks, which wait on the socket meanwhile, don't wait
 * long. */
export const retryDelay = (failures: number): number => Math.min(1000 * 2 ** Math.max(failures - 1, 0), 10_000);

// How long a server has to stop when asked before it is killed.
const STOP_MS = 5_000;

// A server that exits sooner than this after starting failed to start.
const QUICK_MS = 10_000;

/** Runs the server on the sockets this process was given, the hooks' as
 * fd 3 and the page's as fd 4, writing its output to web.log, until
 * SIGTERM, SIGHUP or SIGINT. It runs it again when restart.stamp is
 * touched, and when it exits, after retryDelay. The sockets stay open
 * meanwhile, so what connects waits for the next server rather than
 * finding none. */
function supervise() {
  const env = process.env;
  const log = join(stateDirOf(env), "web.log");
  const out = openSync(log, "w");
  const web = import.meta.dirname;
  closeSync(openSync(join(web, "restart.stamp"), "a"));
  let child: ChildProcess | null = null;
  let stopping = false;
  let restarting = false;
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  /** Asks the server to stop, killing it if it doesn't in time. */
  const stop = (server: ChildProcess) => {
    server.kill("SIGTERM");
    setTimeout(() => server.kill("SIGKILL"), STOP_MS).unref();
  };
  const start = () => {
    retry = null;
    const started = Date.now();
    const page = env.HERDR_PROJECT_PAGE_FD ? 4 : "ignore";
    const server = spawn(process.execPath, serverArgs(web), { stdio: ["ignore", out, out, 3, page], env });
    child = server;
    let ended = false;
    // A server that can't start emits error without exit.
    const end = (why: string) => {
      if (ended) return;
      ended = true;
      child = null;
      if (stopping) process.exit(0);
      if (restarting) {
        restarting = false;
        start();
        return;
      }
      failures = Date.now() - started < QUICK_MS ? failures + 1 : 0;
      const ms = retryDelay(failures);
      console.log(`herdr-project-web ${why}; starting it again in ${ms / 1000}s, or when restart.stamp is touched. See ${log}.`);
      retry = setTimeout(start, ms);
    };
    server.on("error", (e) => end(`couldn't run: ${e.message}`));
    server.on("exit", (code, signal) => end(`exited with ${code ?? signal}`));
  };
  // The folder, not the stamp, which a git clean may replace.
  watch(web, (_event, name) => {
    if (name !== "restart.stamp" || stopping || restarting) return;
    failures = 0;
    if (child) {
      restarting = true;
      stop(child);
    } else {
      if (retry) clearTimeout(retry);
      start();
    }
  }).on("error", (e) => console.log(`herdr-project --watch stopped watching restart.stamp: ${e.message}`));
  for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"] as const) {
    process.on(signal, () => {
      stopping = true;
      if (child) stop(child);
      else process.exit(0);
    });
  }
  start();
}

/** Runs the watcher for the pull requests in orgs on the sockets this
 * binds, the hooks' and the page's, in Herdr pane pane if not null,
 * showing the pull requests on the terminal tty if not null, unless a
 * server already runs. It hands the sockets to a supervisor, which runs
 * the server on them, and waits for it, passing on SIGTERM and SIGHUP;
 * Ctrl-C reaches both from the terminal. It can't keep the sockets
 * itself: Node would accept connections on them here. */
async function runWatcher(orgs: string[], pane: string | null, tty: string | null) {
  const env = process.env;
  if (!existsSync(join(import.meta.dirname, "node_modules"))) {
    console.log(`herdr-project --watch needs its packages: run npm install in ${import.meta.dirname}.`);
    // In the background, nobody would see it wait.
    if (env.HERDR_PROJECT_BACKGROUND === "1") process.exit(1);
    process.on("SIGINT", () => process.exit(0));
    setInterval(() => {}, 1 << 30);
    return;
  }
  // A pane keeps its watcher file, and so its orgs, for when that server
  // goes.
  if (pane) rememberWatcher(pane, orgs, env);
  const bound = await bindSockets(socketOf(env), Number(env.PORT || 9000));
  if (!bound) {
    console.log(`herdr-project-web already runs, maybe in the background; see ${join(stateDirOf(env), "web.log")}.`);
    return;
  }
  const { socket, page } = bound;
  const fds = { HERDR_PROJECT_SOCKET_FD: "3", ...(page ? { HERDR_PROJECT_PAGE_FD: "4" } : {}) };
  const supervisor = spawn(process.execPath, [...NODE_FLAGS, join(import.meta.dirname, "watch-main.ts"), "--supervise"], {
    stdio: ["ignore", "inherit", "inherit", fdOf(socket), page ? fdOf(page) : "ignore"],
    env: { ...serverEnv(env, orgs, tty), ...fds },
  });
  // The supervisor has its own copies now.
  socket.close();
  page?.close();
  for (const signal of ["SIGTERM", "SIGHUP"] as const) process.on(signal, () => supervisor.kill("SIGTERM"));
  process.on("SIGINT", () => {
    if (pane) rmSync(watcherFile(pane, env), { force: true });
  });
  supervisor.on("exit", (code) => process.exit(code ?? 0));
}

/** Returns what herdr prints for args, parsed, or raises with it. */
function herdrCli(...args: string[]): any {
  const out = execFileSync(process.env.HERDR_BIN_PATH || "herdr", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 });
  return out.trim() ? JSON.parse(out) : {};
}

/** Runs herdr-project --watch [orgs...], --start-watch, --background or,
 * from the watcher, --supervise. */
export async function main(argv: string[]) {
  if (argv[0] === "--background") return startBackground(process.env);
  if (argv[0] === "--supervise") return supervise();
  if (argv[0] === "--start-watch") {
    // Another would take the socket from a server already running.
    if (await answers(socketOf(process.env))) return;
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
  const pane = process.env.HERDR_ENV === "1" ? process.env.HERDR_PANE_ID || null : null;
  // Node can't name its terminal, so it comes from the environment.
  await runWatcher(argv.slice(1), pane, process.env.WATCH_TTY || null);
}
