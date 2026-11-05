// A localhost-only page showing what the watcher's checks and the agents'
// notes say waits on the user, updated as they check and their files
// change.

import { execFile } from "node:child_process";
import { type FSWatcher, openSync, readFileSync, watch, writeFileSync, writeSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, relative } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import {
  type AgentActions, type AgentView, Outbox, agentPath, forgetAnswered, fromPage, handleAgent, permission,
} from "./agents.ts";
import { HerdrEvents } from "./events.ts";
import * as github from "./github.ts";
import { HerdrError, request } from "./herdr.ts";
import { type HookEvent, type HookHandler, hookServer, listenOn, readBody, speaker } from "./hooks.ts";
import { highlightDiff } from "./highlight.ts";
import { frontMatter } from "./inbox.ts";
import { agentCommand, instructions, launchDirectory, launchScript, parseAgent, projectDir } from "./launch.ts";
import { readLearnings } from "./learnings.ts";
import { connectors } from "./headless.ts";
import * as linear from "./linear.ts";
import { type Owner, notesTexts } from "./owners.ts";
import { type PaneHerdr, checkPanes } from "./panes.ts";
import { type Checked, checkQueue } from "./queues.ts";
import {
  codexTokens, lastPrompt, percent, resumedText, roleToReport, sessionCwd, sessionReport, statusLine, statusTokens, usageFile,
} from "./report.ts";
import { type OpenHerdr, background, choices, inboxChoices, open, paneRecords, plan, rowNotes, workspacesToName } from "./rows.ts";
import { claudeSessionDirs, codexContext, codexSessionDirs, codexSessions, reportedRole } from "./sessions.ts";
import * as slack from "./slack.ts";
import { loadState, saveState } from "./statefile.ts";
import {
  type Herdr, type Watched, agentStates, openProjects, projectDirs, projectLabels, readProjectFile, readState,
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
// Each pane's last hook event.
const hookEvents = new Map<string, HookEvent>();
const outbox = new Outbox(join(stateDir, "outbox.json"), (pane, text) => paneHerdr.run(pane, text), readyForText);
let last = JSON.stringify(pageState());

/** Returns what the page shows of each agent besides what Herdr says. */
function agentViews(): Record<string, AgentView> {
  const views: Record<string, AgentView> = {};
  for (const [pane, status] of Object.entries(agentStates(herdr) ?? {}))
    views[pane] = { queued: outbox.queued(pane), permission: permission(hookEvents.get(pane), status) };
  return views;
}

/** Reports whether pane still runs an idle agent, as Herdr says right
 * now, with no permission request open. Text sent to anything else could
 * answer a prompt, or run in a shell. */
async function readyForText(pane: string): Promise<boolean> {
  const { pane: now } = await ask("pane.get", { pane_id: pane });
  return Boolean(now.agent) && ["idle", "done"].includes(now.agent_status) && hookEvents.get(pane)?.event !== "PermissionRequest";
}

/** Returns the state for the page. Only the watcher's server can act. */
function pageState() {
  return { ...readState(watched(), projectRoot, herdr), ...(orgs ? { controls: agentViews() } : {}) };
}

/** Sends agents that are free what waits for them. */
function deliver() {
  if (orgs) outbox.deliver(agentStates(herdr) ?? {}).then((sent) => sent && refresh());
}

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
      const before = agentStates(herdr) ?? {};
      herdr = w && p ? { workspaces: w.workspaces, panes: p.panes } : null;
      events.update(herdr);
      forgetAnswered(hookEvents, before, agentStates(herdr) ?? before);
      if (herdr) for (const pane of hookEvents.keys()) if (!herdr.panes.some((q) => q.pane_id === pane)) hookEvents.delete(pane);
      deliver();
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

const agentActions: AgentActions = {
  outbox,
  known: (pane) => Object.hasOwn(agentStates(herdr) ?? {}, pane),
  focus: (pane) => ask("pane.focus", { pane_id: pane }),
  changed: () => {
    deliver();
    refresh();
  },
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const agent = agentPath(path);
  if (!hosts.has(req.headers.host ?? "")) {
    res.writeHead(403).end();
  } else if (agent) {
    // Only the watcher's server, which delivers them, and only the page.
    if (!orgs || !fromPage(req.headers, hosts)) res.writeHead(403).end();
    else handleAgent(req, res, agent, agentActions).catch((e) => json(res, 500, { error: e.message }));
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
  const command = agentCommand(agent, argv, directory, origin, { dotfiles, stateDir, pid, now });
  // Herdr already tracks sessions, so keep them out of the background.
  if (form.get("herdr") === "1" && agent === "claude") command.env.CLAUDE_CODE_DISABLE_AGENT_VIEW = "1";
  const workspace = form.get("workspace");
  if (workspace) reportTitle(workspace, directory);
  return launchScript(directory, command);
}

const openHerdr: OpenHerdr = {
  focus: (pane) => ask("agent.focus", { target: pane }),
  tab: async (workspace, cwd) => (await ask("tab.create", { workspace_id: workspace, cwd, focus: true })).root_pane.pane_id,
  workspace: async (cwd, label) => {
    const { workspace, root_pane } = await ask("workspace.create", { cwd, focus: true, ...(label ? { label } : {}) });
    return { workspace: workspace.workspace_id, pane: root_pane.pane_id };
  },
  title: async (workspace, directory) => reportTitle(workspace, directory),
  run: (pane, command) => paneHerdr.run(pane, command),
};

const planDeps = {
  background,
  stop: (id: string) => promisify(execFile)("claude", ["stop", id]).then(() => true, () => false),
  now: () => new Date(),
};

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
  const resuming = data.source === "resume";
  const reported = resuming && typeof data.transcript_path === "string" ? reportedRole(data.transcript_path) : null;
  const role = roleToReport(got?.pane?.tokens?.role || null, resuming, reported);
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
  return dir ? resumedText(instructions(dir, dotfiles, new Date())) : "";
};

/** Serves what herdr-project and the picker ask for on the socket. */
async function socketRequest(req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname;
  // Now, not as last polled: going by old panes could resume a session
  // that already runs.
  const panes = async () => paneRecords({ workspaces: [], panes: (await ask("pane.list")).panes });
  if (req.method === "POST" && path === "/launch") {
    const body = await readBody(req);
    if (body === null) return void res.writeHead(413).end("arguments too long");
    const script = launch(new URLSearchParams(body));
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(script);
  } else if (req.method === "POST" && path === "/statusline") {
    const line = statusReport(JSON.parse((await readBody(req)) ?? "{}"), await speaker(req));
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(line);
  } else if (req.method === "GET" && path === "/sessions") {
    // Codex's, with what opening one needs, or the directories they ran in.
    if (url.searchParams.get("list") === "codex") json(res, 200, codexSessions());
    else json(res, 200, url.searchParams.get("agent") === "codex" ? codexSessionDirs(codexSessions()) : claudeSessionDirs());
  } else if (req.method === "GET" && path === "/picker") {
    const rows = url.searchParams.has("inbox")
      ? inboxChoices(await panes(), codexSessions(), JSON.parse(last))
      : choices(await panes(), projectRoot, codexSessions());
    json(res, 200, rows);
  } else if (req.method === "GET" && path === "/picker/notes") {
    const q = url.searchParams;
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
      .end(rowNotes(q.get("kind") ?? "", q.get("dir") ?? "", q.get("session") ?? ""));
  } else if (req.method === "POST" && path === "/picker/open") {
    const { row, agent } = JSON.parse((await readBody(req)) ?? "{}");
    await open(await plan(row, agent, await panes(), projectRoot, launcher, planDeps), openHerdr);
    res.writeHead(204).end();
  } else {
    res.writeHead(404).end();
  }
}

// Only the watcher's server: hooks reach one server, like the checks.
if (orgs) {
  const hookListener = hookServer(hookEvents, undefined, onHook, (req, res, url) => {
    socketRequest(req, res, url).catch((e) => res.writeHead(500).end(String(e.message)));
  });
  await listenOn(hookListener, join(stateDir, "run/server.sock"));
}
