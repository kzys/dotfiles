// What the server does with the panes of the Herdr TUI and of the Herdr
// app alike, so that it needn't tell which one a pane is in.

import type { OpenHerdr, PaneRecord } from "../rows.ts";

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
  panes(): Promise<PaneRecord[]>;
  /** Returns how open opens the picker's rows in it. */
  opener(): OpenHerdr;
}
