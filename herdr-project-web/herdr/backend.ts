// What the server does with the panes of the Herdr TUI and of the Herdr
// app alike, so that it needn't tell which one a pane is in.

/** Reports whether an agent with status, as Herdr reports it, waits for
 * its next message. */
export const isFree = (status: string | null | undefined) => status === "idle" || status === "done";

/** One of the places agents run in: the Herdr TUI or the Herdr app. */
export interface Backend {
  /** Returns the session in pane, "" if unknown, if it runs an idle agent
   * right now with no permission request open, or else null. Text sent to
   * anything else could answer a prompt, or run in a shell. */
  ready(pane: string): Promise<string | null>;
  /** Types text into pane and presses Enter. */
  send(pane: string, text: string): Promise<void>;
  /** Brings pane to the front. */
  focus(pane: string): Promise<unknown>;
  /** Returns its panes as they are now, not as last read. */
  panes(): Promise<Herdr["panes"]>;
  /** Returns how open opens the picker's rows in it. */
  opener(): OpenHerdr;
}

/** How open carries out a picker row's plan in a Backend: focusing the
 * pane it runs in, or making a tab or workspace for it, titling that, and
 * running its command there. */
export type OpenHerdr = {
  focus: (pane: string) => Promise<unknown>;
  // Each returns the pane created.
  tab: (workspace: string, directory: string) => Promise<string>;
  workspace: (directory: string, label: string | null) => Promise<{ workspace: string; pane: string }>;
  title: (workspace: string, directory: string) => Promise<unknown>;
  run: (pane: string, command: string) => Promise<unknown>;
};

// What herdr workspace list and herdr pane list say, in part.
export type Herdr = {
  workspaces: { workspace_id: string; label?: string }[];
  panes: {
    pane_id: string;
    workspace_id: string;
    tab_id?: string;
    cwd?: string;
    foreground_cwd?: string;
    agent?: string | null;
    agent_session?: { value?: string } | null;
    agent_status?: string;
    // The title its terminal shows, like what the agent is working on.
    terminal_title?: string;
    // What the agent's status line reports, like its role and ctx.
    tokens?: Record<string, string>;
  }[];
};
