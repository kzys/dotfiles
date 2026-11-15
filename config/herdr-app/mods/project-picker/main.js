// Runs herdr-project-picker --app in a terminal over the window, as
// Herdr's prefix+w popup does, with --inbox if props().inbox. mod.open
// shows this mod, which replaces itself with the terminal once it starts.
// The dialog closes when the picker exits.
//
// With props().guard, it is instead an empty block in that dialog that
// ends the picker, the terminal props().guard, when the dialog goes, so
// that closing it, as with Esc, can't leave the picker running unseen.

import { View, div } from "gpui-kit";
import { hc, theme, props, openOverlay, closeOverlay } from "herdr";

export default class ProjectPicker extends View {
  init(_props, cx) {
    this.error = null;
    // The picker's terminal, until the dialog showing it takes it over.
    this.address = null;
    if (props()?.guard) return;
    cx.spawn(async (cx) => {
      const r = await hc(["run", "--bg", "--json", "--no-parent", "--rm", "--",
                          "herdr-project-picker", "--app", ...(props()?.inbox ? ["--inbox"] : [])]).catch((e) => ({ code: -1, stderr: String(e) }));
      try {
        this.address = r.code === 0 ? JSON.parse(r.stdout).address : null;
      } catch {}
      if (!this.address) {
        this.error = `Couldn't start herdr-project-picker: ${(r.stderr || r.stdout || "").trim()}`;
        cx.notify();
        return;
      }
      const address = this.address;
      this.address = null;
      // Close first, or closing hands the keyboard back to the pane
      // behind instead of the terminal. Modal, so a click beside it can't
      // close it.
      closeOverlay(props().overlay);
      openOverlay({ kind: "dialog", modal: true, width: 0.8, height: 0.6, layout: { type: "column", children: [
        { type: "block", content: { terminal: address } },
        { type: "block", size: { px: 0 }, content: { mod: "project-picker", props: { guard: address } } },
      ] } });
    });
  }

  async close() {
    const address = props()?.guard ?? this.address;
    if (address) await hc(["kill", address]).catch(() => {});
  }

  render() {
    if (props()?.guard) return div();
    const t = theme();
    return div().size_full().p(16).text_size(13).text_color(this.error ? t.blocked : t.dim)
      .child(this.error ?? "Starting the picker…");
  }
}
