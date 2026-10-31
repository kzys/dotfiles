// Runs herdr-project-picker --app in a terminal over the window, as
// Herdr's prefix+w popup did. mod.open shows this mod, which replaces
// itself with the terminal once it starts. The terminal closes when the
// picker exits.

import { View, div } from "gpui-kit";
import { hc, theme, props, openOverlay, closeOverlay } from "herdr";

export default class ProjectPicker extends View {
  init(_props, cx) {
    this.error = null;
    cx.spawn(async (cx) => {
      const r = await hc(["run", "--bg", "--json", "--no-parent", "--rm", "--",
                          "herdr-project-picker", "--app"]).catch((e) => ({ code: -1, stderr: String(e) }));
      let address = null;
      try {
        address = r.code === 0 ? JSON.parse(r.stdout).address : null;
      } catch {}
      if (!address) {
        this.error = `Couldn't start herdr-project-picker: ${(r.stderr || r.stdout || "").trim()}`;
        cx.notify();
        return;
      }
      // Close first, or closing hands the keyboard back to the pane
      // behind instead of the terminal. Modal, so a click beside it can't
      // leave the picker running unseen.
      closeOverlay(props().overlay);
      openOverlay({ kind: "dialog", modal: true, width: 0.8, height: 0.6,
                    layout: { type: "block", content: { terminal: address } } });
    });
  }

  render() {
    const t = theme();
    return div().size_full().p(16).text_size(13).text_color(this.error ? t.blocked : t.dim)
      .child(this.error ?? "Starting the picker…");
  }
}
