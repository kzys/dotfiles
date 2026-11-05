// What agents report as they run: the status line, and what Herdr's
// sidebar and session tracking are told.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { projectDir } from "./launch.ts";
import { tailOf } from "./sessions.ts";

type Data = Record<string, any>;

const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const string = (value: unknown) => (typeof value === "string" ? value : null);

/** Returns the used percentage of the context window, floored, or null if
 * data doesn't say. */
export function percent(data: Data): number | null {
  const window = data?.context_window;
  const used = window?.used_percentage;
  if (used !== undefined && used !== null) return number(used) === null ? null : Math.floor(used);
  const usage = window?.current_usage;
  const size = number(window?.context_window_size) ?? 0;
  if (typeof usage !== "object" || usage === null || size <= 0) return null;
  const tokens = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]
    .reduce((sum, key) => sum + (number(usage[key]) ?? 0), 0);
  return Math.floor((tokens * 100) / size);
}

/** Returns tokens abbreviated, like 200k or 1M. */
const size = (tokens: number) => (tokens >= 1_000_000 ? `${tokens / 1_000_000}M` : `${Math.floor(tokens / 1000)}k`);

/** Returns the status line for data. A part whose fields are missing or
 * malformed is left out. now is the time in seconds, and clock formats a
 * time as HH:MM. */
export function statusLine(data: Data, pct: number, now: number, clock: (t: number) => string): string {
  const window = number(data?.context_window?.context_window_size);
  const parts = [window !== null ? `${pct}% of ${size(window)} ctx` : `${pct}% ctx`];
  const model = string(data?.model?.display_name);
  if (model !== null) {
    const effort = string(data?.effort?.level);
    parts.push(model + (effort !== null ? ` (${effort})` : ""));
  }
  const cache = data?.prompt_cache;
  if (typeof cache === "object" && cache !== null) {
    const expires = number(cache.expires_at);
    if (cache.warm !== true) parts.push("cache cold");
    else if (expires !== null) parts.push(`cache ${Math.floor((expires - now) / 60)}m`);
  }
  const five = data?.rate_limits?.five_hour;
  const used = number(five?.used_percentage);
  const resets = number(five?.resets_at);
  if (used !== null && resets !== null) parts.push(`5h ${Math.floor(used)}% (${clock(resets)})`);
  const seven = number(data?.rate_limits?.seven_day?.used_percentage);
  if (seven !== null) parts.push(`7d ${Math.floor(seven)}%`);
  return parts.join(" · ");
}

/** Returns the file that leaves the context window usage in the project
 * for the picker, and its contents, or null if the session isn't in a
 * project directory under projects. */
export function usageFile(data: Data, projects: string): [string, string] | null {
  const session = data?.session_id;
  const project = string(data?.workspace?.project_dir || null) ?? string(data?.cwd);
  if (!session || !project || !existsSync(project) || !statSync(project).isDirectory()) return null;
  if (projectDir(project, projects) === null) return null;
  const window = data?.context_window;
  return [join(project, `claude-${session}.json`), JSON.stringify({
    used_percentage: window?.used_percentage ?? null, context_window_size: window?.context_window_size ?? null,
  })];
}

/** Returns the last prompt in the transcript at path with its whitespace
 * collapsed, or "". The transcript records each as a "last-prompt" line;
 * the newest is near the end. */
export function lastPrompt(path: unknown): string {
  if (typeof path !== "string") return "";
  let lines: string[];
  try {
    lines = tailOf(path, 262144).split("\n");
  } catch {
    return "";
  }
  for (const line of lines.reverse()) {
    if (!line.includes('"lastPrompt"')) continue;
    try {
      const prompt = string(JSON.parse(line).lastPrompt);
      return prompt ? prompt.split(/\s+/).filter(Boolean).join(" ") : "";
    } catch {
      return "";
    }
  }
  return "";
}

/** Returns the working directory of the session in data. */
export const sessionCwd = (data: Data) => string(data?.workspace?.current_dir || null) ?? string(data?.cwd) ?? "";

/** Returns the tokens to report for the status line in data, a null one
 * clearing it. A background session reports to the pane that started the
 * daemon, which may be showing a different session; $bg flags that, and it
 * leaves $cwd, where new tabs open, to the pane's own session. */
export function statusTokens(
  data: Data, pct: number, prompt: string, branch: string, home: string, ownPane: boolean,
): Record<string, string | null> {
  const cwd = sessionCwd(data);
  return {
    ...(ownPane ? { bg: null, cwd } : { bg: "bg" }),
    ctx: `${pct}%`,
    prompt,
    model: string(data?.model?.display_name) ?? "",
    dir: cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd,
    branch,
  };
}

/** Returns the parameters that report the Claude session starting in data
 * to pane, or null if it has no session. seq orders the reports. */
export function sessionReport(data: Data, pane: string, seq: number): object | null {
  const id = data?.session_id;
  if (!id || typeof id !== "string") return null;
  return {
    pane_id: pane, source: "herdr:claude", agent: "claude", seq, agent_session_id: id,
    ...(typeof data.transcript_path === "string" && data.transcript_path ? { agent_session_path: data.transcript_path } : {}),
    ...(typeof data.source === "string" && data.source ? { session_start_source: data.source } : {}),
  };
}

/** Returns the role to report to a pane with role current, or null to
 * leave it: the one a resuming session last reported, or else main for a
 * pane that has none. */
export function roleToReport(current: string | null, resuming: boolean, reported: string | null): string | null {
  if (resuming && reported && reported !== current) return reported;
  return current ? null : "main";
}

/** Returns the tokens to report for the Codex hook event in data, with its
 * session if known, the context usage in pct, or null, and branch. */
export function codexTokens(
  event: string, data: Data, session: { title?: string; model?: string } | undefined, pct: number | null, branch: string,
): Record<string, string | null> {
  const directory = data.cwd;
  const prompt: string = data.prompt || (event === "SessionStart" ? (session?.title ?? "") : "");
  const tokens: Record<string, string | null> = { bg: null, cwd: directory, dir: directory, branch };
  if (prompt) tokens.prompt = prompt.split(/\s+/).filter(Boolean).join(" ").slice(0, 200);
  if (session?.model) tokens.model = session.model;
  if (pct !== null) tokens.ctx = `${pct}%`;
  else if (event === "SessionStart") tokens.ctx = null;
  return tokens;
}

/** Returns the instructions to add to the context of a session resuming,
 * with text being the instructions themselves. */
export const resumedText = (text: string) => "This session resumed. These instructions replace any earlier copy of them, "
  + `and give the time it resumed as its start; skip the steps you already did.\n\n${text}`;
