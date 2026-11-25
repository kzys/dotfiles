// What the server does with what agents tell it: the scripts that start
// them, their status lines and their hook events, reported to Herdr.

import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Ask } from "./herdr/tui.ts";
import type { HookHandler } from "./hooks.ts";
import { agentCommand, instructions, launchDirectory, launchScript, parseAgent, projectDir } from "./launch.ts";
import { reportTitle } from "./naming.ts";
import {
  codexTokens, lastPrompt, percent, resumedText, roleToReport, sessionCwd, sessionReport, statusLine, statusTokens, usageFile,
} from "./report.ts";
import { codexContext, codexSessions, reportedRole } from "./sessions.ts";

export type AgentReportsDeps = {
  home: string;
  projectRoot: string;
  dotfiles: string;
  stateDir: string;
  // Asks Herdr, returning null if it fails.
  tryAsk: Ask;
  // Remembers that the project in dir, if any, works in the checkout
  // holding cwd, if any.
  noteCheckout: (dir: string | null, cwd: string) => void;
  // Tells that the projects shown may have changed.
  projectsChanged: () => void;
  onError: (error: unknown) => void;
};

/** Returns the current git branch of directory, or "". */
const gitBranch = (directory: string) => promisify(execFile)("git", ["-C", directory, "branch", "--show-current"], { timeout: 5000 })
  .then(({ stdout }) => stdout.trim(), () => "");

const clock = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Acts on what agents tell the server, with deps. */
export class AgentReports {
  private deps: AgentReportsDeps;

  constructor(deps: AgentReportsDeps) {
    this.deps = deps;
  }

  /** Returns the script that starts the agent herdr-project asks for, in
   * form, what it posted, creating its project if it needs one. */
  launch(form: URLSearchParams): string {
    const { home, projectRoot, dotfiles, stateDir, tryAsk } = this.deps;
    const { agent, argv } = parseAgent(form.getAll("arg"));
    const now = new Date();
    const [directory, origin] = launchDirectory(form.get("cwd") ?? home, projectRoot, home, argv, now);
    const pid = Number(form.get("pid"));
    const command = agentCommand(agent, argv, directory, origin, { dotfiles, stateDir, pid });
    // Herdr already tracks sessions, so keep them out of the background.
    if (form.get("herdr") === "1" && agent === "claude") command.env.CLAUDE_CODE_DISABLE_AGENT_VIEW = "1";
    if (origin) this.deps.noteCheckout(directory, origin);
    const workspace = form.get("workspace");
    if (workspace) reportTitle(tryAsk, workspace, directory);
    return launchScript(directory, command);
  }

  /** Returns the status line for data, the status Claude Code posted,
   * leaving its usage for the picker and reporting it to who's pane for
   * the sidebar afterwards: a slow Herdr mustn't blank the line. */
  statusReport(data: any, who: { pane: string; own: boolean } | null): string {
    const { home, projectRoot, tryAsk } = this.deps;
    const pct = percent(data);
    if (pct === null) return "";
    this.deps.noteCheckout(projectDir(data.workspace?.project_dir || data.cwd || "", projectRoot), sessionCwd(data));
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

  /** Acts on a hook event, returning what to add to the agent's context
   * first: the agent is waiting, and gives up on a slow reply. */
  onHook: HookHandler = async (pane, { agent, event }, data) => {
    if (pane) this.reportHook(pane, agent, event, data).catch(this.deps.onError);
    // An agent may have committed or gone into a checkout, which the
    // watches don't see.
    this.deps.projectsChanged();
    if (agent !== "claude" || event !== "SessionStart" || data.source !== "resume" || typeof data.cwd !== "string") return "";
    const dir = projectDir(data.cwd, this.deps.projectRoot);
    return dir ? resumedText(dir, instructions(this.deps.dotfiles)) : "";
  };

  /** Reports a hook event to Herdr. */
  private async reportHook(pane: string, agent: string, event: string, data: any) {
    if (event === "SessionStart") await this.reportRole(pane, data);
    if (agent === "claude" && event === "SessionStart") {
      const report = sessionReport(data, pane, Date.now() * 1_000_000);
      if (report) await this.deps.tryAsk("pane.report_agent_session", report);
    }
    if (agent === "codex") await this.codexReport(pane, event, data);
  }

  /** Reports a starting session's role to pane: see roleToReport. A
   * resumed session may run in a new pane, or in one that had another's
   * role. */
  private async reportRole(pane: string, data: any) {
    const { tryAsk } = this.deps;
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
  private async codexReport(pane: string, event: string, data: any) {
    if (!data.session_id || !data.cwd) return;
    const session = codexSessions().find((s) => s.id === data.session_id);
    const pct = codexContext(data.transcript_path || session?.rollout_path || "");
    if (pct !== null) {
      try {
        writeFileSync(join(session?.cwd ?? data.cwd, `codex-${data.session_id}.json`), JSON.stringify({ used_percentage: pct }));
      } catch {}
    }
    const tokens = codexTokens(event, data, session, pct, await gitBranch(data.cwd));
    await this.deps.tryAsk("pane.report_metadata", { pane_id: pane, source: "codex-hook", tokens });
  }
}
