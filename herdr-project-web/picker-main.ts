// The project picker: lists projects and their agents' sessions, or with
// --inbox what waits on the user, from the server, and opens the row the
// user picks. Typing filters the list. See picker.ts for the keys.

import { request } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { AGENTS } from "./launch.ts";
import { columns, draw, listLines, parseKeys, press, start } from "./picker.ts";
import type { Row } from "./rows.ts";

const stateHome = process.env.XDG_STATE_HOME || join(homedir(), ".local/state");
const socketPath = join(stateHome, "herdr-project/run/server.sock");

/** Sends a request to the server, returning its body, or raising unless
 * it succeeds. */
function ask(method: string, path: string, body?: object): Promise<string> {
  return new Promise((resolve, reject) => {
    const headers = body ? { "Content-Type": "application/json" } : {};
    const req = request({ socketPath, method, path, headers, agent: false }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (text += d));
      res.on("end", () => ((res.statusCode ?? 500) < 300 ? resolve(text) : reject(new Error(text || `status ${res.statusCode}`))));
    });
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

/** Waits for a key, so that a popup stays until what it says is read. */
function waitForKey(): Promise<void> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
}

/** Lets the user pick one of rows, returning it and the agent selected,
 * or null if they quit. */
function pick(rows: Row[]): Promise<[Row, string] | null> {
  return new Promise((resolve) => {
    const out = process.stdout;
    let state = start(rows, AGENTS);
    // Notes by row, read once: the picker is short-lived.
    const previews = new Map<number, string>();
    let finished = false;
    const redraw = () => {
      if (finished) return;
      const row = state.shown[state.cursor];
      if (row !== undefined && !previews.has(row)) {
        previews.set(row, "");
        const [kind, dir, session] = rows[row];
        const query = new URLSearchParams({ kind, dir, session });
        ask("GET", `/picker/notes?${query}`).then((text) => {
          previews.set(row, text);
          redraw();
        }, () => {});
      }
      const lines = draw(state, rows, AGENTS, previews.get(row) ?? "", out.rows, out.columns);
      out.write(`\x1b[H\x1b[J${lines.join("\r\n")}\x1b[1;${Math.min(out.columns, 10 + columns(state.query))}H`);
    };
    const finish = (result: [Row, string] | null) => {
      finished = true;
      process.stdin.removeAllListeners("data");
      out.write("\x1b[?1049l");
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(result);
    };
    out.write("\x1b[?1049h");
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (data: string) => {
      for (const key of parseKeys(data)) {
        state = press(state, key, rows, AGENTS, listLines(out.rows));
        if (state.done === "quit") return finish(null);
        if (state.done === "picked") return finish([rows[state.shown[state.cursor]], state.agent]);
      }
      redraw();
    });
    out.on("resize", redraw);
    redraw();
  });
}

async function main() {
  try {
    const inbox = process.argv.includes("--inbox");
    const rows: Row[] = JSON.parse(await ask("GET", `/picker${inbox ? "?inbox=1" : ""}`));
    const picked = await pick(rows);
    if (picked) await ask("POST", "/picker/open", { row: picked[0], agent: picked[1] });
  } catch (e) {
    console.error(`herdr-project-picker: ${(e as Error).message}\nherdr-project --watch runs the server; see ~/.local/state/herdr-project/web.log.`);
    await waitForKey();
    process.exitCode = 1;
  }
  process.exit();
}

await main();
