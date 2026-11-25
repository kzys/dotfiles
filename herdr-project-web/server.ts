// A localhost-only page showing what the watcher's checks and the agents'
// notes say waits on the user, updated as they check and their files
// change.

import { execFile } from "node:child_process";
import { type FSWatcher, openSync, readFileSync, watch, writeFileSync, writeSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, relative } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import {
  type AgentActions, type AgentView, Outbox, forgetAnswered, fromPage, permission, routeAgents, undelivered,
} from "./agents.ts";
import * as board from "./board.ts";
import { requestCopilot } from "./github/api.ts";
import * as github from "./github/poll.ts";
import * as pullSection from "./github-section.ts";
import { type PullChecked, PullRequests } from "./github/watch.ts";
import { BoardStore } from "./board-store.ts";
import type { Herdr } from "./herdr/backend.ts";
import { HerdrEvents } from "./herdr/events.ts";
import { herdrClient, herdrSocket, readHerdr, tuiBackend } from "./herdr/tui.ts";
import { type HookEvent, type HookHandler, hookServer, limit, listenOn, speaker } from "./hooks.ts";
import { highlightDiff, highlightLines } from "./highlight.ts";
import { frontMatter } from "./frontmatter.ts";
import { agentCommand, instructions, launchDirectory, launchScript, parseAgent, projectDir } from "./launch.ts";
import { readLearnings } from "./learnings.ts";
import { connectors } from "./headless.ts";
import * as linear from "./linear.ts";
import { notesTexts } from "./owners.ts";
import { NESTED_PATHS, PAGE_PATHS } from "./pages.ts";
import { type PaneHerdr, checkPanes } from "./panes.ts";
import { type Checked, checkQueue } from "./queues.ts";
import { Schedule } from "./schedule.ts";
import {
  codexTokens, lastPrompt, percent, resumedText, roleToReport, sessionCwd, sessionReport, statusLine, statusTokens, usageFile,
} from "./report.ts";
import { appBackend, appHerdrPanes, appTerminals, claudeSessions } from "./herdr/app.ts";
import { background, choices, inboxChoices, open, paneRecords, plan, rowNotes, workspacesToName } from "./rows.ts";
import { claudeSessionDirs, codexContext, codexSessionDirs, codexSessions, reportedRole } from "./sessions.ts";
import * as slack from "./slack.ts";
import { loadState, saveState } from "./statefile.ts";
import {
  type Watched, agentStates, checkoutOf, linkCheckout, openProjects, projectDirs, projectLabels, readProjectFile, readState,
} from "./state.ts";
import { type Found, title, watchWorkspace, watchedFrom } from "./watched.ts";
import { type Wait, readProcesses, runningSubagents, sessionFolder, waitsByPid } from "./waits.ts";
import { changedSince, checkoutDirs, fileLines, setBase, worktreeDiff, worktreeDirs } from "./worktrees.ts";

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
// The page shows the view at each of its other paths.
for (const path of PAGE_PATHS) assets[path] = assets["/"];
for (const f of bundle.outputFiles)
  assets[`/${relative(outdir, f.path)}`] = [types[extname(f.path)] ?? "application/octet-stream", f.contents];

const clients = new Set<SSEStreamingApi>();
const logError = (e: unknown) => console.error("herdr-project-web:", e);
const { ask, tryAsk } = herdrClient();
// Herdr's panes and workspaces, null while it can't be asked, read when
// its events say something changed, and every minute, since panes'
// directories change without events.
let herdr: Herdr | null = null;
const herdrReads = new Schedule(async () => {
  const before = herdr;
  const next = (herdr = await readHerdr(tryAsk));
  // Each agent's state is its own subscription, and a failed one
  // subscribes again.
  herdrEvents.update(next);
  const states = agentStates(before) ?? {};
  forgetAnswered(hookEvents, states, agentStates(next) ?? states);
  if (next) for (const pane of hookEvents.keys()) if (!next.panes.some((q) => q.pane_id === pane)) hookEvents.delete(pane);
  deliver();
  refresh();
}, { every: 60_000, onError: logError });
const herdrEvents = new HerdrEvents(herdrSocket, () => herdrReads.refresh());
// What the checks found, by title, once they have checked, shown in this
// order.
const ORDER = ["Pull requests", "Panes", "Slack", "Linear"];
const found = new Map<string, Found>();

// The columns the user moved pull requests to, and what came of asking
// Copilot to review each.
const boardStore = new BoardStore(stateDir, logError);
// Each pane's last hook event.
const hookEvents = new Map<string, HookEvent>();
// The terminals of the Herdr app's spaces, which herdr-core runs, as
// Herdr's panes.
let appTerminalPanes: Herdr["panes"] = [];
// Whether the Herdr app's terminals have been read yet.
let appRead = false;
const herdrTui = tuiBackend(ask, {
  asking: (pane) => hookEvents.get(pane)?.event === "PermissionRequest",
  title: async (workspace, directory) => reportTitle(workspace, directory),
});
const herdrApp = appBackend();
/** Returns the Backend that pane, as last read, is in. */
const backendOf = (pane: string) => appTerminalPanes.some((p) => p.pane_id === pane) ? herdrApp : herdrTui;
const outbox = new Outbox(
  join(stateDir, "outbox.json"), (pane, text) => backendOf(pane).send(pane, text), (pane) => backendOf(pane).ready(pane),
);
// The checkouts under ~/repos each project's agents went into, by project.
const linksPath = join(stateDir, "checkouts.json");
const links = (loadState(linksPath) as Record<string, string[]> | null) ?? {};
// Set before the server listens, once what it reads is defined.
let last = "";

/** Returns what the page shows of each agent besides what Herdr says. */
function agentViews(): Record<string, AgentView> {
  const views: Record<string, AgentView> = {};
  for (const [pane, status] of Object.entries(agentStates(everyPane()) ?? {}))
    views[pane] = { queued: outbox.queued(pane), permission: permission(hookEvents.get(pane), status) };
  return views;
}

/** Returns Herdr's panes with the Herdr app's agents among them, or those
 * alone while Herdr can't be asked, or null if neither is known. */
function everyPane(): Herdr | null {
  if (!herdr && !appTerminalPanes.length) return null;
  return { workspaces: herdr?.workspaces ?? [], panes: [...(herdr?.panes ?? []), ...appTerminalPanes] };
}

// What each Claude session's Bash tool still runs, by session ID.
let waits = new Map<string, Wait[]>();

/** Returns the state for the page. Only the watcher's server can act. */
function pageState() {
  const all = everyPane();
  const sessions = Object.fromEntries((all?.panes ?? []).filter((p) => p.agent).map((p) => [p.pane_id, p.agent_session?.value ?? ""]));
  // Only messages for panes of what has been read can be told undelivered:
  // Herdr's panes are named like w1:p2, the app's terminals like t3.
  const readable = Object.fromEntries(Object.entries(outbox.all()).filter(([pane]) => pane.includes(":") ? herdr !== null : appRead));
  const left = undelivered(readable, sessions);
  const state = readState(watched(), projectRoot, all, home, links);
  for (const project of state.projects)
    for (const pane of project.panes) pane.waits = (sessions[pane.id] && waits.get(sessions[pane.id])) || [];
  return { ...state, ...(orgs ? { controls: agentViews(), undelivered: left, board: boardStore.cards(pulls.latest(), new Date()) } : {}) };
}

/** Sends agents that are free what waits for them. */
function deliver() {
  if (orgs) outbox.deliver(agentStates(everyPane()) ?? {}).then((sent) => sent && refresh());
}

/** Returns what the checks found, or null before any has. */
function watched(): Watched | null {
  const ours = ORDER.flatMap((t) => found.get(t) ?? []);
  return ours.length ? watchedFrom(ours, pulls.latest()?.urls ?? []) : null;
}

// The Herdr app's agents, telling only of changes.
new Schedule(async () => {
  let next: Herdr["panes"];
  try {
    next = appHerdrPanes(await appTerminals(), claudeSessions());
  } catch {
    return; // Keeping the last ones while hc fails.
  }
  if (appRead && JSON.stringify(next) === JSON.stringify(appTerminalPanes)) return;
  appTerminalPanes = next;
  appRead = true;
  deliver();
  refresh();
}, { every: 5_000, onError: logError });

// Where Claude Code keeps each session's files, once found.
const sessionFolders = new Map<string, string>();

// What agents wait on, keeping the last read when ps fails: their Bash
// tool's commands, then the subagents of the sessions still running.
new Schedule(async () => {
  const sessions = claudeSessions();
  let processes: Awaited<ReturnType<typeof readProcesses>>;
  try {
    processes = await readProcesses();
  } catch {
    return; // Keeping the last read while ps fails.
  }
  const shells = waitsByPid(processes);
  const started = new Map(processes.map((p) => [p.pid, p.started]));
  const next = new Map<string, Wait[]>();
  const projects = join(home, ".claude/projects");
  for (const [pid, session] of sessions) {
    let folder = sessionFolders.get(session) ?? null;
    if (!folder && (folder = sessionFolder(projects, session))) sessionFolders.set(session, folder);
    const since = started.get(pid);
    const w = [...(shells.get(pid) ?? []), ...(folder && since !== undefined ? runningSubagents(folder, since) : [])];
    if (w.length) next.set(session, w);
  }
  waits = next;
  refresh();
}, { every: 10_000, onError: logError });

// The title Herdr has, or is being told.
let titled = "";
function refresh() {
  if (orgs) nameWorkspaces().catch((e) => console.error("herdr-project-web:", e));
  const found = watched();
  const next = JSON.stringify(pageState());
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
  for (const stream of clients) stream.writeSSE({ data: next }).catch(() => {});
}
const paneHerdr: PaneHerdr = {
  list: async () => (await ask("pane.list")).panes,
  read: async (id) => (await ask("pane.read", { pane_id: id, source: "recent", lines: 50 })).read.text,
  run: herdrTui.send,
};

// Check the panes five minutes after each check ends, so that two never
// tell an agent at once, keeping the last items when one fails.
const PANE_INTERVAL = 300_000;
new Schedule(async () => {
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
}, { every: PANE_INTERVAL, start: !!orgs, onError: logError });

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
  ["Slack", slack.CONNECTOR, (texts) => slack.poll(notify, texts, join(stateDir, "slack.json"), pulls.latest()?.owners ?? {})],
  ["Linear", linear.CONNECTOR, (texts) => linear.poll(notify, texts, join(stateDir, "linear.json"), pulls.latest()?.owners ?? {})],
];
const queueChecks = queues.map(([title, connector, check]) => new Schedule(async () => {
  const names = await connected();
  found.set(title, await checkQueue(title, connector, names, () => check(notesTexts(projectRoot)), found.get(title) ?? null,
                                    () => new Date(), QUEUE_INTERVAL));
  refresh();
}, { every: QUEUE_INTERVAL, start: false, onError: logError }));

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

// Check the pull requests five minutes after each check ends, or 15s after
// asked, keeping the last items, and the URLs the page links, when one
// fails.
const PR_INTERVAL = 300_000;
const pulls = new PullRequests(
  () => github.poll(prHerdr, projectRoot, join(stateDir, "pull-requests.json"), orgs!),
  showPullCheck,
  { every: PR_INTERVAL, soon: 15_000, start: !!orgs, onError: logError },
);
/** Reports whether url is of an open pull request, as last found. */
const isOpen = (url: unknown) => board.isOpen(pulls.latest()?.pulls ?? [], url);
let queuing = false;

/** Shows a check of the pull requests: on the page, in the watcher's pane
 * and in what the user did with them. */
function showPullCheck({ at, error, last }: PullChecked) {
  const check = error ? null : last;
  const shown = pullSection.shown(at, new Date(Date.now() + PR_INTERVAL), check, error, found.get("Pull requests")?.items ?? []);
  found.set(shown.title, shown);
  if (check) boardStore.forget(check);
  refresh();
  if (tty !== null)
    try {
      writeSync(tty, `\x1b[H\x1b[2J${pullSection.screen(shown.title, at, shown.section!.lines)}`);
    } catch {} // The page still shows them.
  if (queuing) return;
  queuing = true;
  for (const q of queueChecks) q.refresh();
}

/** Checks the pull requests soon, showing when on the page. */
function checkPullRequestsSoon() {
  const next = pulls.checkSoon();
  const section = found.get("Pull requests")?.section;
  if (section && next) {
    section.next = next.toISOString();
    refresh();
  }
}
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

// Other names for this address come from DNS rebinding, which would let
// any site read the page.
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

/** Sets the base that body, a request's, asks for, of a worktree the page
 * lists, and returns the status to answer with. */
async function setBaseFrom(body: string | null): Promise<number> {
  const { dir, branch, base } = JSON.parse(body ?? "{}");
  if (!projectWorktrees().some((p) => p.worktrees.includes(dir))) return 404;
  if (typeof branch !== "string" || !(base === null || typeof base === "string")) return 400;
  return (await setBase(dir, branch, base)) ? 204 : 409;
}

/** Asks Copilot to review the open pull request that body, a request's,
 * names, keeping what came of it, and returns the HTTP status. */
async function askCopilotFrom(body: string | null): Promise<number> {
  const { url } = JSON.parse(body ?? "{}");
  if (!isOpen(url)) return 404;
  const asked = await boardStore.askCopilot(url, (u) => requestCopilot(u));
  refresh();
  return asked ? 204 : 502;
}

/** Moves the open pull request that body, a request's, names to the
 * column it asks for, one of board.MOVABLE, or undoes its move for null,
 * returning the HTTP status. */
async function setStageFrom(body: string | null): Promise<number> {
  const { url, stage } = JSON.parse(body ?? "{}");
  if (!(stage === null || board.MOVABLE.includes(stage))) return 400;
  if (!isOpen(url)) return 404;
  if (boardStore.move(url, stage)) refresh();
  return 204;
}

const agentActions: AgentActions = {
  outbox,
  known: (pane) => Object.hasOwn(agentStates(everyPane()) ?? {}, pane),
  session: (pane) => everyPane()?.panes.find((p) => p.pane_id === pane)?.agent_session?.value,
  focus: (pane) => backendOf(pane).focus(pane),
  changed: () => {
    deliver();
    refresh();
  },
};

/** Returns the reply to a request that changed something, with status. */
const done = (status: number) => new Response(null, { status });

const page = new Hono();
page.use(async (c, next) => (hosts.has(c.req.header("host") ?? "") ? next() : c.body(null, 403)));
page.onError((e, c) => c.json({ error: e.message }, 500));
page.post("/api/base", limit(), async (c) => done(fromPage(c.req.raw.headers, hosts) ? await setBaseFrom(await c.req.text()) : 403));
page.post("/api/stage", limit(), async (c) => done(orgs && fromPage(c.req.raw.headers, hosts) ? await setStageFrom(await c.req.text()) : 403));
page.post("/api/copilot", limit(), async (c) => done(orgs && fromPage(c.req.raw.headers, hosts) ? await askCopilotFrom(await c.req.text()) : 403));
// Only the watcher's server, which delivers them, and only the page.
routeAgents(page, agentActions, (headers) => !!orgs && fromPage(headers, hosts));
page.get("/api/state", (c) => c.body(last, 200, { "Content-Type": "application/json" }));
page.get("/api/version", (c) => c.json({ version, pid: process.pid }));
page.get("/api/events", (c) => streamSSE(c, async (stream) => {
  const closed = new Promise<void>((resolve) => (stream.aborted ? resolve() : stream.onAbort(resolve)));
  // Queued in order, and with the client added at once, so that no update
  // comes before them or is missed.
  for (const message of [{ event: "version", data: JSON.stringify(version) }, { data: last }]) {
    stream.writeSSE(message).catch(() => {});
  }
  clients.add(stream);
  await closed;
  clients.delete(stream);
}));
page.get("/api/diff", async (c) => {
  // Only the worktrees the page lists, not any directory asked for.
  const dir = c.req.query("dir") ?? "";
  if (!projectWorktrees().some((p) => p.worktrees.includes(dir))) return c.json({ error: "no such worktree" }, 404);
  return c.json(await highlightDiff(await worktreeDiff(dir, pulls.latest()?.bases ?? {})));
});
page.get("/api/lines", async (c) => {
  // More context for a diff: only the worktrees the page lists, like it.
  const dir = c.req.query("dir") ?? "";
  const path = c.req.query("path") ?? "";
  const listed = projectWorktrees().some((p) => p.worktrees.includes(dir));
  // Newer lines would pass for unchanged ones in the diff taken then.
  if (listed && changedSince(dir, path, Number(c.req.query("at")))) return c.json({ error: "the file changed" }, 409);
  const lines = listed ? fileLines(dir, path, Number(c.req.query("from")), Number(c.req.query("to"))) : null;
  return lines === null ? c.json({ error: "no such file" }, 404) : c.json(await highlightLines(path, lines));
});
page.get("/api/file", (c) => {
  // Only the files of the projects the page lists, not any file asked for.
  const dir = c.req.query("dir");
  const file = openProjects(projectRoot, herdr).some(([d]) => d === dir)
    ? readProjectFile(dir!, c.req.query("name") ?? "")
    : null;
  return file === null ? c.json({ error: "no such file" }, 404) : c.json(file);
});
// They are small and change rarely, so they are read each time.
page.get("/api/learnings", (c) => c.json(readLearnings(reposRoot)));
// Also on the page's port, for the Herdr app's picker, which can't reach
// the socket. Only requests from the page's origin may open a row.
routePicker(page, (headers) => fromPage(headers, hosts));
for (const [path, [type, body]] of Object.entries(assets)) page.get(path, (c) => c.body(body, 200, { "Content-Type": type }));
// The views under the paths that nest, as /projects/<dir>.
for (const path of NESTED_PATHS) page.get(`${path}/*`, (c) => c.body(assets["/"][1], 200, { "Content-Type": assets["/"][0] }));

const server = createServer(getRequestListener(page.fetch));

// The watcher's sockets, which it keeps across restarts, as file
// descriptors, if it passed them.
const pageFd = Number(process.env.HERDR_PROJECT_PAGE_FD) || null;
const socketFd = Number(process.env.HERDR_PROJECT_SOCKET_FD) || null;

// Only this machine: the page shows private work.
last = JSON.stringify(pageState());
server.listen(pageFd ? { fd: pageFd } : { port, host: "127.0.0.1" }, () => console.log(`herdr-project-web on http://127.0.0.1:${port}/`));

const dotfiles = dirname(here);
const launcher = join(dotfiles, "bin/herdr-project");

/** Returns the README.md of the project in directory, or null. */
function readProjectReadme(directory: string): string | null {
  try {
    return readFileSync(join(directory, "README.md"), "utf8");
  } catch {
    return null;
  }
}

/** Reports the title in the front matter of the project in directory to
 * Herdr workspace, for the Spaces panel, if it has one. */
function reportTitle(workspace: string, directory: string) {
  const title = projectLabels(directory, readProjectReadme(directory)).title;
  if (title !== "(no title)") return tryAsk("workspace.report_metadata", { workspace_id: workspace, source: "readme-title", tokens: { title } });
}

/** Returns the script that starts the agent herdr-project asks for, in
 * form, what it posted, creating its project if it needs one. */
function launch(form: URLSearchParams): string {
  const { agent, argv } = parseAgent(form.getAll("arg"));
  const now = new Date();
  const [directory, origin] = launchDirectory(form.get("cwd") ?? home, projectRoot, home, argv, now);
  const pid = Number(form.get("pid"));
  const command = agentCommand(agent, argv, directory, origin, { dotfiles, stateDir, pid });
  // Herdr already tracks sessions, so keep them out of the background.
  if (form.get("herdr") === "1" && agent === "claude") command.env.CLAUDE_CODE_DISABLE_AGENT_VIEW = "1";
  if (origin) noteCheckout(directory, origin);
  const workspace = form.get("workspace");
  if (workspace) reportTitle(workspace, directory);
  return launchScript(directory, command);
}

const planDeps = {
  background,
  stop: (id: string) => promisify(execFile)("claude", ["stop", id]).then(() => true, () => false),
  now: () => new Date(),
};

/** Remembers that the project in dir, if any, works in the checkout holding
 * cwd, if any, so that the page links its diff. */
function noteCheckout(dir: string | null, cwd: string) {
  const checkout = checkoutOf(cwd, home);
  if (!dir || !checkout || !linkCheckout(links, dir, checkout)) return;
  try {
    saveState(linksPath, links);
  } catch (e) {
    console.error("herdr-project-web:", e);
  }
  refresh();
}

/** Returns the current git branch of directory, or "". */
const gitBranch = (directory: string) => promisify(execFile)("git", ["-C", directory, "branch", "--show-current"], { timeout: 5000 })
  .then(({ stdout }) => stdout.trim(), () => "");

const clock = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Returns the status line for data, the status Claude Code posted, leaving
 * its usage for the picker and reporting it to who's pane for the sidebar
 * afterwards: a slow Herdr mustn't blank the line. */
function statusReport(data: any, who: { pane: string; own: boolean } | null): string {
  const pct = percent(data);
  if (pct === null) return "";
  noteCheckout(projectDir(data.workspace?.project_dir || data.cwd || "", projectRoot), sessionCwd(data));
  const usage = usageFile(data, projectRoot);
  if (usage) {
    try {
      writeFileSync(usage[0], `${usage[1]}\n`);
    } catch {}
  }
  if (who) {
    gitBranch(sessionCwd(data)).then((branch) => {
      const tokens = statusTokens(data, pct, lastPrompt(data.transcript_path), branch, home, who.own);
      return tryAsk("pane.report_metadata", { pane_id: who.pane, source: "claude-statusline", tokens });
    });
  }
  return `${statusLine(data, pct, Date.now() / 1000, clock)}\n`;
}

// The projects whose workspace has been named, so that a name the user
// gives one afterwards stays. Those open when this first runs count: their
// workspaces have their names already.
const namedPath = join(stateDir, "named.json");
const named = new Set((loadState(namedPath) as string[] | null) ?? projectDirs(projectRoot));
saveState(namedPath, [...named]);

/** Names agents' workspaces after their projects, once, as soon as a
 * project has a name. */
async function nameWorkspaces() {
  const nameOf = (dir: string) => {
    const text = readProjectReadme(dir);
    return (text && frontMatter(text, "name")) || "";
  };
  for (const { dir, workspace, name } of workspacesToName(herdr, named, (cwd) => projectDir(cwd, projectRoot), nameOf)) {
    if (!(await tryAsk("workspace.rename", { workspace_id: workspace, label: name }))) continue;
    named.add(dir);
    saveState(namedPath, [...named]);
    await reportTitle(workspace, dir);
  }
}

/** Reports a starting session's role to pane: see roleToReport. A resumed
 * session may run in a new pane, or in one that had another's role. */
async function reportRole(pane: string, data: any) {
  const got = await tryAsk("pane.get", { pane_id: pane });
  // Herdr not answering says nothing about the role the pane has.
  if (!got) return;
  const resuming = data.source === "resume";
  const reported = resuming && typeof data.transcript_path === "string" ? reportedRole(data.transcript_path) : null;
  const role = roleToReport(got.pane?.tokens?.role || null, resuming, reported);
  if (role) await tryAsk("pane.report_metadata", { pane_id: pane, source: "agent-notes", tokens: { role } });
}

/** Reports what the Codex hook in data says to pane, leaving the context
 * usage in the project for the picker. */
async function codexReport(pane: string, event: string, data: any) {
  if (!data.session_id || !data.cwd) return;
  const session = codexSessions().find((s) => s.id === data.session_id);
  const pct = codexContext(data.transcript_path || session?.rollout_path || "");
  if (pct !== null) {
    try {
      writeFileSync(join(session?.cwd ?? data.cwd, `codex-${data.session_id}.json`), JSON.stringify({ used_percentage: pct }));
    } catch {}
  }
  const tokens = codexTokens(event, data, session, pct, await gitBranch(data.cwd));
  await tryAsk("pane.report_metadata", { pane_id: pane, source: "codex-hook", tokens });
}

/** Reports a hook event to Herdr. */
async function reportHook(pane: string, agent: string, event: string, data: any) {
  if (event === "SessionStart") await reportRole(pane, data);
  if (agent === "claude" && event === "SessionStart") {
    const report = sessionReport(data, pane, Date.now() * 1_000_000);
    if (report) await tryAsk("pane.report_agent_session", report);
  }
  if (agent === "codex") await codexReport(pane, event, data);
}

/** Acts on a hook event, returning what to add to the agent's context
 * first: the agent is waiting, and gives up on a slow reply. */
const onHook: HookHandler = async (pane, { agent, event }, data) => {
  if (pane) reportHook(pane, agent, event, data).catch((e) => console.error("herdr-project-web:", e));
  refresh();
  if (agent !== "claude" || event !== "SessionStart" || data.source !== "resume" || typeof data.cwd !== "string") return "";
  const dir = projectDir(data.cwd, projectRoot);
  return dir ? resumedText(dir, instructions(dotfiles)) : "";
};

// The Herdr app, for a picker that opens rows there, else the TUI.
const pickerBackend = (app: unknown) => app ? herdrApp : herdrTui;
/** Returns the panes of the picker's Backend as the picker uses them. */
const pickerPanes = async (app: unknown) => paneRecords({ workspaces: [], panes: await pickerBackend(app).panes() });

// What herdr-project and the picker ask for on the socket.
const socket = new Hono();
socket.onError((e, c) => c.text(e.message, 500));
socket.post("/launch", limit((c) => c.text("arguments too long", 413)), async (c) =>
  c.text(launch(new URLSearchParams(await c.req.text())))
);
socket.post("/statusline", limit(), async (c) =>
  c.text(statusReport(JSON.parse((await c.req.text()) || "{}"), await speaker(c.req.raw.headers)))
);
socket.get("/sessions", (c) =>
  // Codex's, with what opening one needs, or the directories they ran in.
  c.req.query("list") === "codex"
    ? c.json(codexSessions())
    : c.json(c.req.query("agent") === "codex" ? codexSessionDirs(codexSessions()) : claudeSessionDirs())
);
// From an agent that opened or changed a pull request, for the board.
socket.post("/pulls/check", (c) => {
  checkPullRequestsSoon();
  return c.body(null, 202);
});

/** Adds the picker's routes to routes: its rows, a row's notes and opening
 * a row, which only requests that allowed lets through may do. */
function routePicker(routes: Hono, allowed: (headers: Headers) => boolean) {
  routes.get("/picker", async (c) => {
    const app = c.req.query("app") !== undefined;
    return c.json(c.req.query("inbox") !== undefined
      ? inboxChoices(await pickerPanes(app), codexSessions(), JSON.parse(last))
      : choices(await pickerPanes(app), projectRoot, codexSessions()));
  });
  routes.get("/picker/notes", (c) => c.text(rowNotes(c.req.query("kind") ?? "", c.req.query("dir") ?? "", c.req.query("session") ?? "")));
  routes.post("/picker/open", limit(), async (c) => {
    if (!allowed(c.req.raw.headers)) return c.body(null, 403);
    const { row, agent, app } = JSON.parse((await c.req.text()) || "{}");
    // Panes as they are now, not as last read: going by old ones could
    // resume a session that already runs.
    await open(await plan(row, agent, await pickerPanes(app), projectRoot, launcher, planDeps), pickerBackend(app).opener());
    return c.body(null, 204);
  });
}
routePicker(socket, () => true);

// Only the watcher's server: hooks reach one server, like the checks.
if (orgs) {
  const hookListener = hookServer(hookEvents, undefined, onHook, socket);
  if (socketFd) hookListener.listen({ fd: socketFd });
  // Run alone, as with npm start.
  else await listenOn(hookListener, join(stateDir, "run/server.sock"));
}
