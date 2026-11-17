// What agents wait on: the commands Claude Code's Bash tool still runs,
// as for CI to finish, read from the processes, and the subagents it still
// runs, read from its files. An idle agent with one is waiting for it
// rather than done.

import { execFile } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

export type Process = { pid: number; ppid: number; seconds: number; command: string };

// A command and how long it has run.
export type Wait = { command: string; seconds: number };

/** Returns the seconds in an elapsed time as ps prints it, like
 * 02-22:28:56 or 13:39. */
export function elapsed(text: string): number {
  const [days, rest] = text.includes("-") ? text.split("-") : ["0", text];
  return rest.split(":").map(Number).reduce((total, n) => total * 60 + n, 0) + Number(days) * 86_400;
}

/** Returns the processes in text, as ps -ww -axo pid=,ppid=,etime=,command=
 * prints them. */
export function parsePs(text: string): Process[] {
  return text.split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), seconds: elapsed(m[3]), command: m[4] }] : [];
  });
}

/** Returns the command Claude Code's Bash tool runs in the shell whose
 * command line is shell, without the cd it starts with, or null if shell
 * isn't one of its shells. */
export function toolCommand(shell: string): string | null {
  if (!shell.includes("/shell-snapshots/")) return null;
  // Quoted only if it needs to be.
  const m = /&& eval (?:'((?:[^']|'"'"')*)'|(\S+)) < \/dev\/null/.exec(shell);
  return m ? (m[1]?.replaceAll(`'"'"'`, "'") ?? m[2]).replace(/^cd \S+ && /, "") : null;
}

/** Returns what each Claude process among processes runs in its Bash
 * tool's shells, by its process ID, longest-running first. */
export function waitsByPid(processes: Process[]): Map<number, Wait[]> {
  const claude = new Set(processes.filter((p) => p.command.split(" ")[0].split("/").pop() === "claude").map((p) => p.pid));
  const found = new Map<number, Wait[]>();
  for (const p of processes) {
    const command = claude.has(p.ppid) ? toolCommand(p.command) : null;
    if (command) found.set(p.ppid, [...(found.get(p.ppid) ?? []), { command, seconds: p.seconds }]);
  }
  for (const waits of found.values()) waits.sort((a, b) => b.seconds - a.seconds);
  return found;
}

/** Returns the subagents still running in the Claude session whose files
 * are in folder, as Claude Code keeps them under ~/.claude/projects, each
 * with how long it has run at now, in milliseconds since the epoch,
 * longest-running first. Claude Code marks a subagent's metadata finished
 * when it ends, but not always when it is stopped or its session dies, so
 * only those started since, when the session's process started, count. */
export function runningSubagents(folder: string, now: number, since: number): Wait[] {
  const dir = join(folder, "subagents");
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".meta.json"));
  } catch {}
  return names.flatMap((name) => {
    try {
      const path = join(dir, name);
      const meta = JSON.parse(readFileSync(path, "utf8"));
      const at = statSync(path).mtimeMs;
      if (meta.finished || meta.stoppedByUser || at < since) return [];
      const seconds = Math.max(0, Math.floor((now - at) / 1000));
      return [{ command: `${meta.agentType ?? "subagent"}: ${meta.description ?? ""}`, seconds }];
    } catch {
      return [];
    }
  }).sort((a, b) => b.seconds - a.seconds);
}

/** Returns the folder under projects, ~/.claude/projects, where Claude
 * Code keeps the files of session, or null if it has none. */
export function sessionFolder(projects: string, session: string): string | null {
  let names: string[] = [];
  try {
    names = readdirSync(projects);
  } catch {}
  for (const name of names) {
    try {
      if (statSync(join(projects, name, session)).isDirectory()) return join(projects, name, session);
    } catch {}
  }
  return null;
}

/** Returns this machine's processes. */
export async function readProcesses(): Promise<Process[]> {
  const { stdout } = await promisify(execFile)("ps", ["-ww", "-axo", "pid=,ppid=,etime=,command="], { timeout: 10_000, maxBuffer: 16 << 20 });
  return parsePs(stdout);
}
