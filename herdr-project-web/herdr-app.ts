// The Herdr app, whose terminals herdr-core runs, beside Herdr: reading
// its panes and agents with hc, and opening the picker's rows with
// herdr-app commands.

import { execFile } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { OpenHerdr, PaneRecord } from "./rows.ts";
import type { Herdr } from "./state.ts";

// herdr-core names some agents by their app, not their command.
const AGENTS: Record<string, string> = { "claude-code": "claude" };

/** Runs a command and returns its parsed JSON output. Raises if it fails. */
export type Json = (command: string, args: string[]) => Promise<any>;

// A busy or closed app shouldn't hang the picker.
const json: Json = async (command, args) => JSON.parse((await promisify(execFile)(command, args, { timeout: 10_000 })).stdout);

/** Returns the IDs of running Claude Code sessions by process ID, from the
 * files Claude Code keeps for them in directory. */
export function claudeSessions(directory = join(homedir(), ".claude/sessions")): Map<number, string> {
  const found = new Map<number, string>();
  let names: string[] = [];
  try {
    names = readdirSync(directory).filter((n) => n.endsWith(".json"));
  } catch {}
  for (const name of names) {
    try {
      const { pid, sessionId } = JSON.parse(readFileSync(join(directory, name), "utf8"));
      if (typeof pid === "number" && typeof sessionId === "string") found.set(pid, sessionId);
    } catch {}
  }
  return found;
}

/** Returns the panes among terminals, each as hc get describes it with the
 * agent hc ls reports, that show in a space of the Herdr app. sessions maps
 * the process IDs of running Claude sessions to their IDs; herdr-core
 * doesn't know sessions, nor roles. */
export function appPaneRecords(terminals: any[], sessions: Map<number, string>): PaneRecord[] {
  return terminals.filter((t) => t.state === "live" && t.labels?.["herdr.space"]).map((t) => {
    const agent = AGENTS[t.agent] ?? t.agent ?? null;
    return {
      agent,
      workspace: t.labels["herdr.space"],
      cwd: t.foreground?.cwd || t.cwd || "",
      pane: t.address,
      session: agent === "claude" ? (sessions.get(t.foreground?.pid) ?? "") : "",
      role: "",
    };
  });
}

/** Returns herdr-core's live terminals on this machine, each as hc get
 * describes it with the agent hc ls reports. A terminal that ends while
 * this reads it is left out. */
export async function appTerminals(run: Json = json): Promise<any[]> {
  const listed: any[] = (await run("hc", ["ls", "--json"])).terminals;
  const terminals = await Promise.all(listed.map((t) =>
    run("hc", ["get", t.address, "--json"]).then((got) => ({ ...got, agent: t.agent }), () => null)));
  return terminals.filter((t) => t);
}

/** Returns the panes of the Herdr app's spaces on this machine, as
 * appPaneRecords does. */
export async function appPanes(run: Json = json, sessions = claudeSessions()): Promise<PaneRecord[]> {
  return appPaneRecords(await appTerminals(run), sessions);
}

/** Returns the terminals among terminals, as appTerminals reads them, that
 * show in a space of the Herdr app, as Herdr describes its panes, so that
 * their agents count as Herdr's do. A terminal is an agent only while its
 * program reports a status. sessions is as for appPaneRecords. */
export function appHerdrPanes(terminals: any[], sessions: Map<number, string>): Herdr["panes"] {
  return terminals.filter((t) => t.state === "live" && t.labels?.["herdr.space"]).map((t) => {
    const app = t.status?.app;
    const agent = app ? (AGENTS[app] ?? app) : null;
    return {
      pane_id: t.address,
      workspace_id: t.labels["herdr.space"],
      tab_id: t.labels["herdr.tab"],
      cwd: t.foreground?.cwd || t.cwd,
      agent,
      agent_status: t.status?.state,
      agent_session: agent === "claude" ? { value: sessions.get(t.foreground?.pid) ?? "" } : null,
    };
  });
}

/** Reports whether the agent in terminal, as hc get describes it, is
 * waiting for its next message. */
export function appAgentFree(terminal: any): boolean {
  return ["idle", "done"].includes(terminal?.status?.state);
}

/** Runs the Herdr app command name with args and returns what it made. */
export type AppCommand = (name: string, args: object) => Promise<any>;

const appCommand: AppCommand = (name, args) => json("herdr-app", ["do", name, JSON.stringify(args)]);

/** Returns how open opens rows in the Herdr app, with command running its
 * commands. The app starts a terminal with its program rather than typing
 * one into a shell, so a new tab or space is only made once run says what
 * runs in it. */
export function appOpener(command: AppCommand = appCommand): OpenHerdr {
  const pending = new Map<string, [string, object]>();
  const later = (name: string, args: object) => {
    const id = `pending-${pending.size + 1}`;
    pending.set(id, [name, args]);
    return id;
  };
  return {
    focus: (pane) => command("pane.focus", { terminal: pane }),
    tab: async (space, folder) => later("tab.new", { space, folder }),
    workspace: async (folder, name) => ({ workspace: "", pane: later("space.new", { folder, ...(name ? { name } : {}) }) }),
    // Spaces are named from README.md when made, and tabs need no title.
    title: async () => {},
    run: async (pane, line) => {
      const made = pending.get(pane);
      if (!made) throw new Error(`no tab or space to run in: ${pane}`);
      pending.delete(pane);
      return command(made[0], { ...made[1], argv: ["sh", "-c", line] });
    },
  };
}
