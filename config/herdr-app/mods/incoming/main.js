// A dialog to start something: what's typed goes to the router
// (bin/herdr-router in the dotfiles), which gives it to an existing
// project or starts a new one. Enter sends, Shift+Enter starts a new line,
// Esc cancels.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { run, props, closeOverlay, theme, terminals, hc, home, notify } from "herdr";

/** Returns the address of the router among terms, the live terminal
 * labeled role=router that Claude still runs in, or null. */
export function router(terms) {
  const t = terms.find((t) => t.state === "live" && t.labels?.role === "router" && t.foreground?.argv?.[0] === "claude");
  return t ? t.address : null;
}

export default class Incoming extends View {
  init(_props, cx) {
    this.text = "";
    this.sending = false;
    this.input = TextareaState.new({ placeholder: "A request, a Slack link, or both", rows: 6 });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    this.input.on("submit", (e, cx) => { if (!e.shift) this.submit(cx); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  submit(cx) {
    const text = this.text.trim();
    // Sent twice before the first router comes up, it would start two.
    if (!text || this.sending) return;
    this.sending = true;
    const overlay = props().overlay;
    const address = router(terminals());
    // Closing the dialog cancels its tasks, so it closes once they're done.
    cx.spawn(async () => {
      try {
        if (!address) {
          // herdr-router moves to its own folder.
          run("space.new", { name: "ROUTER", folder: home(), argv: ["herdr-router"], task: text, machine: "" });
          return;
        }
        const r = await hc(["send", address, text]);
        if (r.code !== 0) notify({ title: "Couldn't reach the router", body: (r.stderr || r.stdout).trim(), level: "error" });
      } catch (e) {
        notify({ title: "Couldn't reach the router", body: String(e), level: "error" });
      } finally {
        closeOverlay(overlay);
      }
    });
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const running = router(terminals());
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("incoming").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w_full().min_h(0).p(18).gap(12).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Start something"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(Textarea.new(this.input).px(10).py(8).rounded(9).border_1().border_color(t.input)
        .bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(h_flex().items_center().gap(8)
        .child(div().flex_1().text_size(11.5).text_color(t.dim)
          .child(running ? `To the router (${running})` : "Starts the router"))
        .child(button("in-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("in-send", "Send", true, (_e, cx) => this.submit(cx))));
  }
}
