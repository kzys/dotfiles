// A localhost-only page showing what herdr-project --watch and the
// agents' notes say waits on the user, updated as they report and their
// files change.

import { execFile } from "node:child_process";
import { type FSWatcher, readFileSync, readdirSync, watch } from "node:fs";
import { type ServerResponse, createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join, relative } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { HerdrEvents } from "./events.ts";
import { HerdrError, request } from "./herdr.ts";
import { highlightDiff } from "./highlight.ts";
import { frontMatter } from "./inbox.ts";
import { type Learnings, parseLearnings } from "./learnings.ts";
import { connectors } from "./headless.ts";
import * as linear from "./linear.ts";
import { type Owner, notesTexts } from "./owners.ts";
import { type PaneHerdr, checkPanes } from "./panes.ts";
import { lastReport, onReport } from "./poller.ts";
import { type Checked, checkQueue } from "./queues.ts";
import * as slack from "./slack.ts";
import { type Herdr, type Watched, openProjects, projectDirs, readProjectFile, readState } from "./state.ts";
import { type Found, title, watchWorkspace, withFound } from "./watched.ts";
import { checkoutDirs, summarize, worktreeDiff, worktreeDirs } from "./worktrees.ts";

const here = import.meta.dirname;
const home = homedir();
const stateDir = join(process.env.XDG_STATE_HOME || join(home, ".local/state"), "herdr-project");
const projectRoot = join(home, "project");
const reposRoot = join(home, "repos");
const port = Number(process.env.PORT || 9000);

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
// What the checks here found, by title, once they have checked, shown in
// this order.
const ORDER = ["Panes", "Slack", "Linear"];
const found = new Map<string, Found>();
let last = JSON.stringify(readState(watched(), stateDir, projectRoot));

/** Returns what the watcher found: the poller's last report with what
 * the checks here found. */
function watched(): Watched | null {
  const ours = ORDER.flatMap((t) => found.get(t) ?? []);
  return ours.length ? withFound(lastReport(), ours) : lastReport();
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
  const next = JSON.stringify(readState(found, stateDir, projectRoot, herdr));
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
onReport(refresh);

const paneHerdr: PaneHerdr = {
  list: async () => (await ask("pane.list")).panes,
  read: async (id) => (await ask("pane.read", { pane_id: id, source: "recent", lines: 50 })).read.text,
  // Typing the text and Enter, as herdr pane run does.
  run: async (id, text) => void (await ask("pane.send_input", { pane_id: id, text, keys: ["Enter"] })),
};

// Check the panes five minutes after each check ends, so that two never
// tell an agent at once, keeping the last items when one fails. Only the
// watcher's server checks, so that another one doesn't tell agents twice.
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
if (process.env.HERDR_PROJECT_POLLER) watchPanes();

// The connected claude.ai connectors; the queues start together, so one
// listing a minute serves both.
let listing: [number, Promise<Set<string> | null>] | null = null;
function connected(): Promise<Set<string> | null> {
  if (!listing || Date.now() - listing[0] > 60_000) listing = [Date.now(), connectors()];
  return listing[1];
}

/** Shows a Herdr notification asking for the user. */
const notify = (title: string, body: string) => ask("notification.show", { title, body, sound: "request" });

/** Returns the projects of the poller's pull requests by url. */
function prOwners(): Record<string, Owner | null> {
  const owners = lastReport()?.owners;
  return owners && typeof owners === "object" ? (owners as Record<string, Owner | null>) : {};
}

// Check Slack and Linear every half hour, in the background since Claude
// takes a while, starting once the poller has reported the projects of
// its pull requests, which they use.
const QUEUE_INTERVAL = 1_800_000;
const queues: [string, string, (texts: ReturnType<typeof notesTexts>) => Promise<Checked>][] = [
  ["Slack", slack.CONNECTOR, (texts) => slack.poll(notify, texts, join(stateDir, "slack.json"), prOwners())],
  ["Linear", linear.CONNECTOR, (texts) => linear.poll(notify, texts, join(stateDir, "linear.json"), prOwners())],
];
async function watchQueue(title: string, connector: string, check: (texts: ReturnType<typeof notesTexts>) => Promise<Checked>) {
  const names = await connected();
  const result = await checkQueue(title, connector, names, () => check(notesTexts(projectRoot)), found.get(title) ?? null,
                                  () => new Date(), QUEUE_INTERVAL);
  found.set(title, result);
  refresh();
  setTimeout(() => watchQueue(title, connector, check), QUEUE_INTERVAL);
}
let queuing = false;
onReport(() => {
  if (queuing || !process.env.HERDR_PROJECT_POLLER || !lastReport()?.owners) return;
  queuing = true;
  for (const q of queues) watchQueue(...q);
});

let timer: ReturnType<typeof setTimeout> | undefined;
function changed() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    rewatch();
    refresh();
  }, 100);
}

// Watch the state directory, for the pull requests the watcher keeps,
// ~/project, and each project in it, but not their worktrees, which can
// hold many files.
const watchers = new Map<string, FSWatcher>();
function rewatch() {
  const wanted = new Set([stateDir, projectRoot, ...projectDirs(projectRoot)]);
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
// Catch what the watches miss, such as the state directory appearing.
setInterval(changed, 30_000);

/** Returns the projects that are open or still have a workspace in
 * Herdr, with worktrees in them, each with their directories, followed
 * by the checkouts in ~/repos, where some tasks work on their branches. */
function projectWorktrees() {
  return [
    ...openProjects(projectRoot, herdr).map(([dir, readme]) => ({
      dir,
      name: (readme && frontMatter(readme, "name")) || dir.split("/").pop()!,
      title: (readme && frontMatter(readme, "title")) || "(no title)",
      worktrees: worktreeDirs(dir),
    })),
    { dir: reposRoot, name: "repos", title: "Checkouts in ~/repos", worktrees: checkoutDirs(reposRoot) },
  ].filter((p) => p.worktrees.length);
}

/** Returns the LEARNINGS.md of each organization in ~/repos, by
 * organization name. */
function readLearnings(): Learnings[] {
  let orgs: string[];
  try {
    orgs = readdirSync(reposRoot).sort();
  } catch {
    return [];
  }
  return orgs.flatMap((org) => {
    const path = join(reposRoot, org, "LEARNINGS.md");
    try {
      return [{ org, path, topics: parseLearnings(readFileSync(path, "utf8")) }];
    } catch {
      return [];
    }
  });
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
    json(res, 200, readLearnings());
  } else if (assets[path]) {
    const [type, body] = assets[path];
    res.writeHead(200, { "Content-Type": type }).end(body);
  } else {
    res.writeHead(404).end();
  }
});

// Only this machine: the page shows private work.
server.listen(port, "127.0.0.1", () => console.log(`herdr-project-web on http://127.0.0.1:${port}/`));
