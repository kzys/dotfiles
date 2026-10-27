// A localhost-only page showing what the watcher's checks and the agents'
// notes say waits on the user, updated as they check and their files
// change.

import { execFile } from "node:child_process";
import { type FSWatcher, openSync, readFileSync, watch, writeSync } from "node:fs";
import { type ServerResponse, createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join, relative } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { HerdrEvents } from "./events.ts";
import * as github from "./github.ts";
import { HerdrError, request } from "./herdr.ts";
import { highlightDiff } from "./highlight.ts";
import { readLearnings } from "./learnings.ts";
import { connectors } from "./headless.ts";
import * as linear from "./linear.ts";
import { type Owner, notesTexts } from "./owners.ts";
import { type PaneHerdr, checkPanes } from "./panes.ts";
import { type Checked, checkQueue } from "./queues.ts";
import * as slack from "./slack.ts";
import {
  type Herdr, type Watched, openProjects, projectDirs, projectLabels, readProjectFile, readState,
} from "./state.ts";
import { type Found, title, watchWorkspace, watchedFrom } from "./watched.ts";
import { checkoutDirs, summarize, worktreeDiff, worktreeDirs } from "./worktrees.ts";

const here = import.meta.dirname;
const home = homedir();
const stateDir = join(process.env.XDG_STATE_HOME || join(home, ".local/state"), "herdr-project");
const projectRoot = join(home, "project");
const reposRoot = join(home, "repos");
const port = Number(process.env.PORT || 9000);
// The GitHub organizations whose pull requests to watch, or all if none,
// when this is the watcher's server. Only that one checks, so that
// another doesn't tell the user and agents twice.
const orgs: string[] | null = process.env.HERDR_PROJECT_ORGS ? JSON.parse(process.env.HERDR_PROJECT_ORGS) : null;

// The commit the server runs.
let version = "unknown";
try {
  const { stdout } = await promisify(execFile)("git", ["rev-parse", "--short", "HEAD"], { cwd: here, timeout: 5000 });
  version = stdout.trim();
} catch {}

// Bundle the page and its styles once at start; they are small enough to
// keep in memory.
const outdir = join(here, "out");
const bundle = await build({
  entryPoints: [join(here, "app.tsx")],
  outdir,
  bundle: true,
  format: "esm",
  minify: true,
  write: false,
  jsx: "automatic",
  jsxImportSource: "preact",
  define: { VERSION: JSON.stringify(version) },
});
const types: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
};
const assets: Record<string, [string, string | Uint8Array]> = {
  "/": ["text/html; charset=utf-8", readFileSync(join(here, "index.html"))],
};
for (const f of bundle.outputFiles)
  assets[`/${relative(outdir, f.path)}`] = [types[extname(f.path)] ?? "application/octet-stream", f.contents];

const clients = new Set<ServerResponse>();
let herdr: Herdr | null = null;
// What the checks found, by title, once they have checked, shown in this
// order.
const ORDER = ["Pull requests", "Panes", "Slack", "Linear"];
const found = new Map<string, Found>();
// The URLs of the open pull requests, and the projects of the pull
// requests by url, as last found.
let prUrls: string[] = [];
const prOwners: Record<string, Owner | null> = {};
let last = JSON.stringify(readState(watched(), projectRoot));

/** Returns what the checks found, or null before any has. */
function watched(): Watched | null {
  const ours = ORDER.flatMap((t) => found.get(t) ?? []);
  return ours.length ? watchedFrom(ours, prUrls) : null;
}

// Herdr's socket, found again after a request can't reach it.
let socketPath: Promise<string> | null = null;

/** Returns the result of method with params from Herdr, raising if it
 * fails. Where the socket is gone, as when Herdr came back elsewhere, it
 * finds it again and tries once more; the request never reached Herdr,
 * so it isn't sent twice. */
async function ask(method: string, params: object = {}, again = true): Promise<any> {
  const path = (socketPath ??= herdrSocket());
  try {
    return await request(await path, method, params);
  } catch (e) {
    if (e instanceof HerdrError) throw e;
    // Unless another request found it again already.
    if (socketPath === path) socketPath = null;
    const code = (e as NodeJS.ErrnoException).code;
    if (again && (code === "ENOENT" || code === "ECONNREFUSED")) return ask(method, params, false);
    throw e;
  }
}

/** Returns the result of method with params from Herdr, or null if it
 * fails. */
function tryAsk(method: string, params: object = {}): Promise<any> {
  return ask(method, params).catch(() => null);
}

// Read Herdr when its events say something changed. A read asked for
// while one runs runs again after it, so the last change isn't missed.
let polling = false;
let again = false;
async function pollHerdr() {
  if (polling) {
    again = true;
    return;
  }
  polling = true;
  try {
    do {
      again = false;
      const [w, p] = await Promise.all([tryAsk("workspace.list"), tryAsk("pane.list")]);
      herdr = w && p ? { workspaces: w.workspaces, panes: p.panes } : null;
      events.update(herdr);
      refresh();
    } while (again);
  } finally {
    polling = false;
  }
}
// Herdr's socket, as its CLI, $HERDR_BIN_PATH if set, finds it, for the
// session it reads.
async function herdrSocket(): Promise<string> {
  const { stdout } = await promisify(execFile)(process.env.HERDR_BIN_PATH || "herdr", ["status", "server"], {
    timeout: 5000,
  });
  const path = stdout.match(/^socket: (.+)$/m)?.[1];
  if (!path) throw new Error("herdr status server names no socket");
  return path;
}
const events = new HerdrEvents(herdrSocket, pollHerdr);
pollHerdr();
// Panes' directories change without events, and Herdr may be away.
setInterval(pollHerdr, 60_000);

// The title Herdr has, or is being told.
let titled = "";
function refresh() {
  const found = watched();
  const next = JSON.stringify(readState(found, projectRoot, herdr));
  // Tell Herdr how much waits on the user only as it changes.
  const workspace = watchWorkspace(process.env, herdr);
  const text = title(found?.inbox);
  if (workspace && found && text !== titled) {
    titled = text;
    tryAsk("workspace.report_metadata", { workspace_id: workspace, source: "watch", tokens: { title: text } }).then(
      (ok) => {
        // The next refresh tries again.
        if (!ok && titled === text) titled = "";
      },
    );
  }
  if (next === last) return;
  last = next;
  for (const res of clients) res.write(`data: ${next}\n\n`);
}
const paneHerdr: PaneHerdr = {
  list: async () => (await ask("pane.list")).panes,
  read: async (id) => (await ask("pane.read", { pane_id: id, source: "recent", lines: 50 })).read.text,
  // Typing the text and Enter, as herdr pane run does.
  run: async (id, text) => void (await ask("pane.send_input", { pane_id: id, text, keys: ["Enter"] })),
};

// Check the panes five minutes after each check ends, so that two never
// tell an agent at once, keeping the last items when one fails.
const PANE_INTERVAL = 300_000;
async function watchPanes() {
  const at = new Date();
  let lines: string[];
  let items = found.get("Panes")?.items ?? [];
  try {
    ({ lines, items } = await checkPanes(paneHerdr, projectRoot, join(stateDir, "panes.json"), at));
  } catch (e) {
    lines = [`Cannot check panes: ${String(e).split("\n")[0]}`];
  }
  const next = new Date(Date.now() + PANE_INTERVAL).toISOString();
  found.set("Panes", { title: "Panes", section: { title: "Panes", at: at.toISOString(), next, lines }, items });
  refresh();
  setTimeout(watchPanes, PANE_INTERVAL);
}
if (orgs) watchPanes();

// The connected claude.ai connectors; the queues start together, so one
// listing a minute serves both.
let listing: [number, Promise<Set<string> | null>] | null = null;
function connected(): Promise<Set<string> | null> {
  if (!listing || Date.now() - listing[0] > 60_000) listing = [Date.now(), connectors()];
  return listing[1];
}

/** Shows a Herdr notification asking for the user. */
const notify = (title: string, body: string) => ask("notification.show", { title, body, sound: "request" });

// Check Slack and Linear every half hour, in the background since Claude
// takes a while, starting once the pull requests have been checked, whose
// projects they use.
const QUEUE_INTERVAL = 1_800_000;
const queues: [string, string, (texts: ReturnType<typeof notesTexts>) => Promise<Checked>][] = [
  ["Slack", slack.CONNECTOR, (texts) => slack.poll(notify, texts, join(stateDir, "slack.json"), prOwners)],
  ["Linear", linear.CONNECTOR, (texts) => linear.poll(notify, texts, join(stateDir, "linear.json"), prOwners)],
];
async function watchQueue(title: string, connector: string, check: (texts: ReturnType<typeof notesTexts>) => Promise<Checked>) {
  const names = await connected();
  const result = await checkQueue(title, connector, names, () => check(notesTexts(projectRoot)), found.get(title) ?? null,
                                  () => new Date(), QUEUE_INTERVAL);
  found.set(title, result);
  refresh();
  setTimeout(() => watchQueue(title, connector, check), QUEUE_INTERVAL);
}

const prHerdr: github.PollHerdr = {
  panes: paneHerdr.list,
  notify: (title, body, sound) => ask("notification.show", { title, body, sound }),
  run: paneHerdr.run,
};
// The terminal of the watcher's pane, which shows the pull requests.
let tty: number | null = null;
try {
  if (orgs && process.env.HERDR_PROJECT_TTY) tty = openSync(process.env.HERDR_PROJECT_TTY, "w");
} catch (e) {
  console.error("herdr-project-web:", e);
}

// Check the pull requests five minutes after each check ends, keeping the
// last items, and the URLs the page links, when one fails.
const PR_INTERVAL = 300_000;
let queuing = false;
async function watchPullRequests() {
  try {
    await checkPullRequests();
  } catch (e) {
    console.error("herdr-project-web:", e);
  }
  if (!queuing) {
    queuing = true;
    for (const q of queues) watchQueue(...q);
  }
  setTimeout(watchPullRequests, PR_INTERVAL);
}
async function checkPullRequests() {
  const title = "Pull requests";
  const at = new Date();
  let lines: string[];
  let rows: github.Row[] | undefined;
  let items = found.get(title)?.items ?? [];
  try {
    let owners: Record<string, Owner | null>;
    ({ lines, rows, items, owners, urls: prUrls } = await github.poll(
      prHerdr, projectRoot, join(stateDir, "pull-requests.json"), orgs!));
    Object.assign(prOwners, owners);
  } catch (e) {
    lines = [`Cannot check pull requests: ${String(e).split("\n")[0]}`];
  }
  const next = new Date(Date.now() + PR_INTERVAL).toISOString();
  found.set(title, {
    title,
    section: { title, at: at.toISOString(), next, lines, ...(rows ? { pullRequests: rows } : {}) },
    items,
  });
  refresh();
  if (tty !== null)
    try {
      writeSync(tty, `\x1b[H\x1b[2J${github.screen(title, at, lines)}`);
    } catch {} // The page still shows them.
}
if (orgs) watchPullRequests();

let timer: ReturnType<typeof setTimeout> | undefined;
function changed() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    rewatch();
    refresh();
  }, 100);
}

// Watch ~/project and each project in it, but not their worktrees, which can
// hold many files.
const watchers = new Map<string, FSWatcher>();
function rewatch() {
  const wanted = new Set([projectRoot, ...projectDirs(projectRoot)]);
  for (const [dir, w] of watchers)
    if (!wanted.has(dir)) {
      w.close();
      watchers.delete(dir);
    }
  for (const dir of wanted) {
    if (watchers.has(dir)) continue;
    try {
      watchers.set(dir, watch(dir, changed));
    } catch {} // Not there yet; the next change looks again.
  }
}
rewatch();
// Catch what the watches miss, such as ~/project appearing.
setInterval(changed, 30_000);

/** Returns the projects that are open or still have a workspace in
 * Herdr, with worktrees in them, each with their directories, followed
 * by the checkouts in ~/repos, where some tasks work on their branches. */
function projectWorktrees() {
  return [
    ...openProjects(projectRoot, herdr).map(([dir, readme]) => ({
      dir,
      ...projectLabels(dir, readme),
      worktrees: worktreeDirs(dir),
    })),
    { dir: reposRoot, name: "repos", title: "Checkouts in ~/repos", worktrees: checkoutDirs(reposRoot) },
  ].filter((p) => p.worktrees.length);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

// Other names for this address come from DNS rebinding, which would let
// any site read the page.
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  if (!hosts.has(req.headers.host ?? "")) {
    res.writeHead(403).end();
  } else if (path === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(last);
  } else if (path === "/api/version") {
    json(res, 200, { version, pid: process.pid });
  } else if (path === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write(`event: version\ndata: ${JSON.stringify(version)}\n\n`);
    res.write(`data: ${last}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
  } else if (path === "/api/worktrees") {
    // Worktrees aren't watched, so git is asked each time.
    Promise.all(
      projectWorktrees().map(async (p) => ({ ...p, worktrees: await Promise.all(p.worktrees.map(summarize)) })),
    )
      .then((projects) => json(res, 200, projects))
      .catch((e) => json(res, 500, { error: e.message }));
  } else if (path === "/api/diff") {
    // Only the worktrees the page lists, not any directory asked for.
    const dir = url.searchParams.get("dir");
    if (!projectWorktrees().some((p) => p.worktrees.includes(dir ?? ""))) json(res, 404, { error: "no such worktree" });
    else
      worktreeDiff(dir!)
        .then(highlightDiff)
        .then((diff) => json(res, 200, diff))
        .catch((e) => json(res, 500, { error: e.message }));
  } else if (path === "/api/file") {
    // Only the files of the projects the page lists, not any file asked for.
    const dir = url.searchParams.get("dir");
    const file = openProjects(projectRoot, herdr).some(([d]) => d === dir)
      ? readProjectFile(dir!, url.searchParams.get("name") ?? "")
      : null;
    if (file === null) json(res, 404, { error: "no such file" });
    else json(res, 200, file);
  } else if (path === "/api/learnings") {
    // They are small and change rarely, so they are read each time.
    json(res, 200, readLearnings(reposRoot));
  } else if (assets[path]) {
    const [type, body] = assets[path];
    res.writeHead(200, { "Content-Type": type }).end(body);
  } else {
    res.writeHead(404).end();
  }
});

// Only this machine: the page shows private work.
server.listen(port, "127.0.0.1", () => console.log(`herdr-project-web on http://127.0.0.1:${port}/`));
