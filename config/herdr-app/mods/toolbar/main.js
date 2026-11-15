// Buttons for what's also behind a shortcut, Ctrl+Shift and the letter
// each underlines: start something, pick a project, and what waits on the
// user, which keys reach as toolbar.inbox. Narrower than 160px, as in a
// folded sidebar, it shows only the first one, as an icon.
//
// Hovered, unless folded, it grows its layout block, props().block, to EXPANDED px to
// show more below the buttons, and shrinks it back to COLLAPSED after.
// Something drawn over it, such as a dialog it opens, keeps it from
// hearing that the pointer left, so while expanded it also checks every
// CHECK_MS whether the pointer is still on it.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, theme, props, openOverlay, nextCommand } from "herdr";

const COLLAPSED = 44;
const EXPANDED = 140;
const CHECK_MS = 500;

/** Reports whether point lies within bounds, both in window coordinates. */
export function inside(point, bounds) {
  return point.x >= bounds.x && point.x < bounds.x + bounds.width &&
    point.y >= bounds.y && point.y < bounds.y + bounds.height;
}

/** Opens what waits on the user in the project picker. */
function inbox() {
  openOverlay({ mod: "project-picker", props: { inbox: true }, kind: "dialog", width: 0.8, height: 0.6 });
}

export default class Toolbar extends View {
  init(_props, cx) {
    this.width = 268;
    this.hovered = false;
    this.bounds = null;
    this.check = null;
    cx.spawn(async () => {
      for (;;) if ((await nextCommand()) === "inbox") inbox();
    });
  }

  hover(hovered, cx) {
    // Folded, it has nothing more to show.
    if (hovered && this.width < 160) return;
    if (hovered === this.hovered) return;
    this.hovered = hovered;
    const block = props()?.block;
    if (block) run("layout.resize", { id: block, px: hovered ? EXPANDED : COLLAPSED });
    this.check?.cancel();
    this.check = hovered ? cx.timer.every(CHECK_MS, (cx) => {
      if (this.bounds && !inside(window.mouse_position(), this.bounds)) this.hover(false, cx);
    }) : null;
    cx.notify();
  }

  // What shows below the buttons while hovered.
  more(t) {
    return div().text_size(11.5).text_color(t.dim).child("Ctrl+Shift and a button's underlined letter does the same.");
  }

  render() {
    const t = theme();
    const compact = this.width < 160;
    // label is [before, the shortcut's letter, after].
    const button = (id, [before, letter, after], tooltip, action) => h_flex().id(id).h(32).flex_1().min_w(0).px(10)
      .items_center().justify_center().rounded(8).border_1().border_color(t.input).bg(t.raised)
      .text_color(t.foreground).text_size(12.5).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(tooltip).on_click(action)
      .child(div().child(before)).child(div().underline().child(letter)).child(div().child(after));
    const start = () => run("mod.open", { name: "incoming" });
    return v_flex().id("root").on_size_change((size, cx) => { this.width = size.width; cx.notify(); })
      .on_hover((hovered, cx) => this.hover(hovered, cx))
      // As tall as expanded: the first move comes before the block has grown.
      .on_mouse_move((e) => { this.bounds = { ...e.bounds, height: EXPANDED }; })
      .size_full().px(compact ? 6 : 12).py(6).gap(8)
      .child(h_flex().w_full().flex_none().gap(6)
        .child(button("start", compact ? ["+", "", ""] : ["", "S", "tart"], "Start something (Ctrl+Shift+S)", start))
        .when(!compact, (el) => el
          .child(button("projects", ["P", "r", "ojects"], "Pick a project or session (Ctrl+Shift+R)",
            () => run("mod.open", { name: "project-picker" })))
          .child(button("inbox", ["", "I", "nbox"], "What waits on you (Ctrl+Shift+I)", inbox))))
      .when(this.hovered && !compact, (el) => el.child(div().px(4).overflow_hidden().child(this.more(t))));
  }
}
