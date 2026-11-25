// A localhost-only page showing what the watcher's checks and the agents'
// notes say waits on the user, updated as they check and their files
// change.

import { execFile } from "node:child_process";
import { type FSWatcher, openSync, readFileSync, watch, writeSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, relative } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import {
  type AgentActions, type Queued, Outbox, forgetAnswered, fromPage, permission, routeAgents, undelivered,
} from "./agents.ts";
import * as github from "./github/poll.ts";
import * as pullSection from "./github-section.ts";
import { type PullChecked, PullRequests } from "./github/watch.ts";
import { BoardStore } from "./board-store.ts";
import { type Herdr, isFree } from "./herdr/backend.ts";
import { HerdrEvents } from "./herdr/events.ts";
import { herdrClient, herdrSocket, readHerdr, tuiBackend } from "./herdr/tui.ts";
import { type HookEvent, hookServer, listenOn, speaker } from "./hooks.ts";
import { jsonBody, limit } from "./http.ts";
import { connectors } from "./headless.ts";
import * as linear from "./linear.ts";
import { notesTexts } from "./owners.ts";
import { NESTED_PATHS, PAGE_PATHS } from "./pages.ts";
import { type PaneHerdr, checkPanes } from "./panes.ts";
import { type Checked, checkQueue } from "./queues.ts";
import { Schedule } from "./schedule.ts";
import { AGAIN, Store, effect } from "./store.ts";
import { AgentReports } from "./agent-reports.ts";
import { Asks, askees } from "./ask/ask.ts";
import { type AsksServer, routeAsks, routeReplies } from "./ask/routes.ts";
import { Namer, reportTitle } from "./naming.ts";
import { everyPane, pageState } from "./page-state.ts";
import { appBackend, appCommand, appHerdrPanes, appSpaces, claudeSessions } from "./herdr/app.ts";
import { CoreFeed } from "./herdr/core.ts";
import { background } from "./rows.ts";
import { routeDiff } from "./diff/routes.ts";
import { routeFiles } from "./project/routes.ts";
import { routeLearnings } from "./learnings/routes.ts";
import { routePulls } from "./pulls/routes.ts";
import { type PickerServer, routePicker } from "./picker/routes.ts";
import { claudeSessionDirs, codexSessionDirs, codexSessions } from "./sessions.ts";
import * as slack from "./slack.ts";
import { loadState, saveState } from "./statefile.ts";
import { type ProjectRead, checkoutOf, linkCheckout, projectDirs, readProjects } from "./project/project.ts";
import { type State, type Watched, agentStates } from "./state.ts";
import { type Found, title, watchWorkspace, watchedFrom } from "./watched.ts";

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

// What the server knows from outside, which its sources set and from which
// the page and what the server does derive. What other objects keep, such
// as the outbox and the board, are told of with store.tell().
type Facts = {
  // Herdr's panes and workspaces, null while it can't be asked.
  herdr: Herdr | null;
  // The terminals of the Herdr app's spaces, which herdr-core runs, as
  // Herdr's panes, and whether they have been read yet.
  appPanes: Herdr["panes"];
  appRead: boolean;
  // How many times the Herdr app's spaces have changed, which herdr-core
  // tells as changes to the app's document.
  appSpacesChanged: number;
  // What the checks found, by title, once they have checked.
  found: ReadonlyMap<string, Found>;
  // How many times ~/project, a project in it or what its projects work
  // in may have changed, and the projects shown, read since.
  projectsChanged: number;
  projects: ProjectRead[];
};
const store = new Store<Facts>({
  herdr: null, appPanes: [], appRead: false, appSpacesChanged: 0, found: new Map(), projectsChanged: 0, projects: [],
});

/** Sets what the check titled title found. */
const setFound = (title: string, found: Found) => store.set({ found: new Map(store.get().found).set(title, found) });

// Herdr's panes and workspaces, read when its events say something
// changed, and every minute, since panes' directories change without
// events.
const herdrReads = new Schedule(async () => {
  const before = store.get().herdr;
  const next = await readHerdr(tryAsk);
  // Each agent's state is its own subscription, and a failed one
  // subscribes again.
  herdrEvents.update(next);
  const states = agentStates(before) ?? {};
  forgetAnswered(hookEvents, states, agentStates(next) ?? states);
  if (next) for (const pane of hookEvents.keys()) if (!next.panes.some((q) => q.pane_id === pane)) hookEvents.delete(pane);
  store.set({ herdr: next });
}, { every: 60_000, onError: logError });
const herdrEvents = new HerdrEvents(herdrSocket, () => herdrReads.refresh());
// The checks, in the order the page shows what they found.
const ORDER = ["Pull requests", "Panes", "Slack", "Linear"];

// The columns the user moved pull requests to, and what came of asking
// Copilot to review each.
const boardStore = new BoardStore(stateDir, logError);
// The questions asked of every agent from the page, and their replies.
const asks = new Asks(join(stateDir, "asks.json"));
// Each pane's last hook event.
const hookEvents = new Map<string, HookEvent>();
const herdrTui = tuiBackend(ask, {
  asking: (pane) => hookEvents.get(pane)?.event === "PermissionRequest",
  title: async (workspace, directory) => reportTitle(tryAsk, workspace, directory),
});
const herdrApp = appBackend();
/** Returns the Backend that pane, as last read, is in. */
const backendOf = (pane: string) => store.get().appPanes.some((p) => p.pane_id === pane) ? herdrApp : herdrTui;
const outbox = new Outbox(
  join(stateDir, "outbox.json"), (pane, text) => backendOf(pane).send(pane, text), (pane) => backendOf(pane).ready(pane),
);
// The checkouts under ~/repos each project's agents went into, by project.
const linksPath = join(stateDir, "checkouts.json");
const links = (loadState(linksPath) as Record<string, string[]> | null) ?? {};
// The page's state as last sent, set before the server listens.
let last = "";

/** Returns the page's state from facts. */
const pageOf = (facts: Facts) => pageState({
  ...facts,
  watched: watched(facts),
  acting: orgs
    ? { queued: outbox.all(), hooks: hookEvents, board: boardStore.cards(pulls.latest(), new Date()), asks: asks.all() }
    : null,
});

/** Returns what the checks found, or null before any has. */
function watched({ found }: Facts): Watched | null {
  const ours = ORDER.flatMap((t) => found.get(t) ?? []);
  return ours.length ? watchedFrom(ours, pulls.latest()?.urls ?? []) : null;
}

// The Herdr app's agents, from herdr-core as they change, keeping the last
// ones while hc fails.
new CoreFeed({
  terminals: (terminals) => {
    const next = appHerdrPanes(terminals, claudeSessions());
    const { appRead, appPanes } = store.get();
    if (!appRead || JSON.stringify(next) !== JSON.stringify(appPanes)) store.set({ appPanes: next, appRead: true });
  },
  doc: (name) => {
    if (name === "herdr-app") store.set({ appSpacesChanged: store.get().appSpacesChanged + 1 });
  },
  subscribed: () => store.set({ appSpacesChanged: store.get().appSpacesChanged + 1 }),
  onError: logError,
});

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
  let items = store.get().found.get("Panes")?.items ?? [];
  try {
    ({ lines, items } = await checkPanes(paneHerdr, projectRoot, join(stateDir, "panes.json"), at));
  } catch (e) {
    lines = [`Cannot check panes: ${String(e).split("\n")[0]}`];
  }
  const next = new Date(Date.now() + PANE_INTERVAL).toISOString();
  setFound("Panes", { title: "Panes", section: { title: "Panes", at: at.toISOString(), next, lines }, items });
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
  setFound(title, await checkQueue(title, connector, names, () => check(notesTexts(projectRoot)),
                                   store.get().found.get(title) ?? null, () => new Date(), QUEUE_INTERVAL));
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
  logError(e);
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
let queuing = false;

/** Shows a check of the pull requests: on the page, in the watcher's pane
 * and in what the user did with them. */
function showPullCheck({ at, error, last }: PullChecked) {
  const check = error ? null : last;
  const before = store.get().found.get("Pull requests")?.items ?? [];
  const shown = pullSection.shown(at, new Date(Date.now() + PR_INTERVAL), check, error, before);
  if (check) boardStore.forget(check);
  setFound(shown.title, shown);
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
  const shown = store.get().found.get("Pull requests");
  if (shown?.section && next) setFound(shown.title, { ...shown, section: { ...shown.section, next: next.toISOString() } });
}
/** Tells that the projects shown may have changed. */
const projectsChanged = () => store.set({ projectsChanged: store.get().projectsChanged + 1 });
let timer: ReturnType<typeof setTimeout> | undefined;
function changed() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    rewatch();
    projectsChanged();
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
// Catch what the watches miss, such as ~/project appearing, even while
// changes keep putting the debounced read off.
setInterval(() => {
  rewatch();
  projectsChanged();
}, 30_000);

// Other names for this address come from DNS rebinding, which would let
// any site read the page.
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

const agentActions: AgentActions = {
  outbox,
  known: (pane) => Object.hasOwn(agentStates(everyPane(store.get())) ?? {}, pane),
  session: (pane) => everyPane(store.get())?.panes.find((p) => p.pane_id === pane)?.agent_session?.value,
  focus: (pane) => backendOf(pane).focus(pane),
  changed: () => store.tell(),
};

const dotfiles = dirname(here);
const launcher = join(dotfiles, "bin/herdr-project");

// What the picker's routes need.
const picker: PickerServer = {
  backend: (app) => app ? herdrApp : herdrTui,
  page: () => JSON.parse(last),
  projectRoot,
  launcher,
  planDeps: {
    background,
    stop: (id: string) => promisify(execFile)("claude", ["stop", id]).then(() => true, () => false),
    now: () => new Date(),
  },
};

const page = new Hono();
page.use(async (c, next) => (hosts.has(c.req.header("host") ?? "") ? next() : c.body(null, 403)));
page.onError((e, c) => (e instanceof HTTPException ? e.getResponse() : c.json({ error: e.message }, 500)));
// The pull requests' board, which only the watcher's server keeps, and
// only the page may change.
routePulls(page, { latest: () => pulls.latest(), board: boardStore, changed: () => store.tell() },
  (headers) => !!orgs && fromPage(headers, hosts));
// Only the watcher's server, which delivers them, and only the page.
routeAgents(page, agentActions, (headers) => !!orgs && fromPage(headers, hosts));
// Asking every agent, which only the watcher's server, which delivers the
// questions, does, and only from the page.
const asksServer: AsksServer = {
  asks,
  askees: () => askees(everyPane(store.get()), (JSON.parse(last) as State).projects),
  queue: (pane, text, session) => outbox.add(pane, text, session),
  changed: () => store.tell(),
};
routeAsks(page, asksServer, (headers) => !!orgs && fromPage(headers, hosts));
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
// The files of the projects the page lists.
routeFiles(page, { projectRoot, herdr: () => store.get().herdr });
routeLearnings(page, reposRoot);
// The page's diffs. Only requests from the page's origin may set a base.
routeDiff(page, {
  projectRoot, reposRoot, herdr: () => store.get().herdr, bases: () => pulls.latest()?.bases ?? {},
}, (headers) => fromPage(headers, hosts));
// Also on the page's port, for the Herdr app's picker, which can't reach
// the socket. Only requests from the page's origin may open a row.
routePicker(page, picker, (headers) => fromPage(headers, hosts));
for (const [path, [type, body]] of Object.entries(assets)) page.get(path, (c) => c.body(body, 200, { "Content-Type": type }));
// The views under the paths that nest, as /projects/<dir>.
for (const path of NESTED_PATHS) page.get(`${path}/*`, (c) => c.body(assets["/"][1], 200, { "Content-Type": assets["/"][0] }));

const server = createServer(getRequestListener(page.fetch));

// The watcher's sockets, which it keeps across restarts, as file
// descriptors, if it passed them.
const pageFd = Number(process.env.HERDR_PROJECT_PAGE_FD) || null;
const socketFd = Number(process.env.HERDR_PROJECT_SOCKET_FD) || null;

// Only this machine: the page shows private work.
store.set({ projects: readProjects(projectRoot, null, home, links) });
last = JSON.stringify(pageOf(store.get()));
server.listen(pageFd ? { fd: pageFd } : { port, host: "127.0.0.1" }, () => console.log(`herdr-project-web on http://127.0.0.1:${port}/`));

/** Remembers that the project in dir, if any, works in the checkout holding
 * cwd, if any, so that the page links its diff. */
function noteCheckout(dir: string | null, cwd: string) {
  const checkout = checkoutOf(cwd, home);
  if (!dir || !checkout || !linkCheckout(links, dir, checkout)) return;
  try {
    saveState(linksPath, links);
  } catch (e) {
    logError(e);
  }
  projectsChanged();
}

const namer = new Namer({ stateDir, projectRoot, tryAsk, spaces: () => appSpaces(), command: appCommand, onError: logError });
const reports = new AgentReports({ home, projectRoot, dotfiles, stateDir, tryAsk, noteCheckout, projectsChanged, onError: logError });

// What follows from the facts, each when what it depends on changes.

// The projects shown, read again when they may have changed, and when the
// panes, whose workspaces keep closed ones shown, do.
effect(store, (facts) => [
  facts.projectsChanged, (everyPane(facts)?.panes ?? []).map((p) => [p.workspace_id, p.cwd, p.foreground_cwd]),
], (facts) => store.set({ projects: readProjects(projectRoot, everyPane(facts), home, links) }), { onError: logError });

// The page, sent to it as it changes.
effect(store, (facts) => JSON.stringify(pageOf(facts)), (_facts, next) => {
  last = next;
  for (const stream of clients) stream.writeSSE({ data: next }).catch(() => {});
}, { onError: logError });

// How much waits on the user, told to Herdr as it changes, and again on the
// next change of anything when telling fails.
effect(store, (facts) => {
  const workspace = watchWorkspace(process.env, facts.herdr);
  const found = watched(facts);
  return workspace && found ? { workspace, text: title(found.inbox) } : null;
}, async (_facts, told) => {
  if (!told) return;
  const tokens = { title: told.text };
  if (!(await tryAsk("workspace.report_metadata", { workspace_id: told.workspace, source: "watch", tokens }))) throw AGAIN;
}, { retry: true, onError: logError });

// Only the watcher's server acts on agents and names their places.
if (orgs) {
  // What waits for each agent, sent once it is free, and again on the next
  // change of anything while some a free one could take is left: not those
  // for another session, which wait for the user.
  effect(store, (facts) => {
    const all = everyPane(facts);
    const sessions = Object.fromEntries((all?.panes ?? []).map((p) => [p.pane_id, p.agent_session?.value ?? ""]));
    return { states: agentStates(all) ?? {}, sessions, queued: outbox.all() };
  }, async (_facts, { states, sessions }) => {
    if (await outbox.deliver(states)) store.tell();
    const takes = (pane: string) => (m: Queued) => !m.session || !sessions[pane] || m.session === sessions[pane];
    if (Object.entries(outbox.all()).some(([pane, queued]) => isFree(states[pane]) && queued.some(takes(pane)))) {
      throw AGAIN;
    }
  }, { retry: true, onError: logError });
  // Herdr's workspaces, after their projects' names, and again on the next
  // change of anything while one couldn't be renamed.
  effect(store, (facts) => [
    (facts.herdr?.panes ?? []).map((p) => [p.workspace_id, p.agent, p.tokens?.cwd || p.cwd]), namer.names(),
  ], async ({ herdr }) => {
    if (!(await namer.workspaces(herdr))) throw AGAIN;
  }, { retry: true, onError: logError });
  // The Herdr app's spaces, after their projects' names.
  effect(store, (facts) => [facts.appSpacesChanged, namer.names()], () => namer.appSpaces(), { onError: logError });
}

// What herdr-project and the picker ask for on the socket.
const socket = new Hono();
socket.onError((e, c) => (e instanceof HTTPException ? e.getResponse() : c.text(e.message, 500)));
socket.post("/launch", limit((c) => c.text("arguments too long", 413)), async (c) =>
  c.text(reports.launch(new URLSearchParams(await c.req.text())))
);
socket.post("/statusline", limit(), async (c) =>
  c.text(reports.statusReport(await jsonBody(c), await speaker(c.req.raw.headers)))
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

routePicker(socket, picker, () => true);
// Agents reply to what the page asked them on the socket.
routeReplies(socket, asksServer);

// Only the watcher's server: hooks reach one server, like the checks.
if (orgs) {
  const hookListener = hookServer(hookEvents, undefined, reports.onHook, socket);
  if (socketFd) hookListener.listen({ fd: socketFd });
  // Run alone, as with npm start.
  else await listenOn(hookListener, join(stateDir, "run/server.sock"));
}
