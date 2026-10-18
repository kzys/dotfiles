// A localhost-only page showing what herdr-project --watch and the
// agents' notes say waits on the user, updated as their files change.

import { execFile } from "node:child_process";
import { type FSWatcher, readFileSync, watch } from "node:fs";
import { type ServerResponse, createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join, relative } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { type Herdr, projectDirs, readState } from "./state.ts";

const here = import.meta.dirname;
const home = homedir();
const stateDir = join(process.env.XDG_STATE_HOME || join(home, ".local/state"), "herdr-project");
const projectRoot = join(home, "project");
const port = Number(process.env.PORT || 9000);

// Bundle the page, its styles and fonts once at start; they are small
// enough to keep in memory.
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
  loader: { ".woff2": "file", ".woff": "file" },
  assetNames: "fonts/[name]",
  publicPath: "/",
});
const types: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};
const assets: Record<string, [string, string | Uint8Array]> = {
  "/": ["text/html; charset=utf-8", readFileSync(join(here, "index.html"))],
};
for (const f of bundle.outputFiles)
  assets[`/${relative(outdir, f.path)}`] = [types[extname(f.path)] ?? "application/octet-stream", f.contents];

const clients = new Set<ServerResponse>();
let herdr: Herdr | null = null;
let last = JSON.stringify(readState(stateDir, projectRoot));

/** Returns the parsed output of herdr with args, or null if it fails. */
async function runHerdr(...args: string[]): Promise<any> {
  try {
    const { stdout } = await promisify(execFile)("herdr", args, { timeout: 5000 });
    return JSON.parse(stdout).result;
  } catch {
    return null;
  }
}

// Herdr doesn't say when panes move, so ask it now and then.
let polling = false;
async function pollHerdr() {
  if (polling) return;
  polling = true;
  try {
    const [w, p] = await Promise.all([runHerdr("workspace", "list"), runHerdr("pane", "list")]);
    herdr = w && p ? { workspaces: w.workspaces, panes: p.panes } : null;
    refresh();
  } finally {
    polling = false;
  }
}
pollHerdr();
setInterval(pollHerdr, 10_000);

function refresh() {
  const next = JSON.stringify(readState(stateDir, projectRoot, herdr));
  if (next === last) return;
  last = next;
  for (const res of clients) res.write(`data: ${next}\n\n`);
}

let timer: ReturnType<typeof setTimeout> | undefined;
function changed() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    rewatch();
    refresh();
  }, 100);
}

// Watch the state directory, ~/project, and each project in it, but not
// their worktrees, which can hold many files.
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

// Other names for this address come from DNS rebinding, which would let
// any site read the page.
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (!hosts.has(req.headers.host ?? "")) {
    res.writeHead(403).end();
  } else if (path === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(last);
  } else if (path === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write(`data: ${last}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
  } else if (assets[path]) {
    const [type, body] = assets[path];
    res.writeHead(200, { "Content-Type": type }).end(body);
  } else {
    res.writeHead(404).end();
  }
});

// Only this machine: the page shows private work.
server.listen(port, "127.0.0.1", () => console.log(`herdr-project-web on http://127.0.0.1:${port}/`));
