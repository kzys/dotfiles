// Picks a project, a session or, with props().inbox, what waits on the
// user, from herdr-project-web on 127.0.0.1, and opens it in the Herdr
// app, as herdr-project-picker does in a terminal. Type to filter; ↑/↓,
// Page Up/Down, ctrl+p/n move; Tab, shift+Tab, ctrl+f/b switch the agent
// a new session starts; Enter opens; Esc closes. The selected row's notes
// show on the right.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle, Table, TableRow, TableCell } from "gpui-base";
import { exec, theme, settings, props, closeOverlay, notify } from "herdr";
import { hint, spans, visible, words } from "./rows.js";

// herdr-project-web's page, which listens only on this machine.
const SERVER = "http://127.0.0.1:9000";
// As AGENTS in herdr-project-web's launch.ts.
const AGENTS = ["claude", "codex", "opencode"];
// Tab and shift+Tab, as actions: as plain keys, a binding for moving focus
// takes them before on_key_down sees them.
const BINDINGS = [
  { keystroke: "tab", action: "project_picker::NextAgent", context: "ProjectPicker" },
  { keystroke: "shift-tab", action: "project_picker::PrevAgent", context: "ProjectPicker" },
];
// The keymap is the app's, so the bindings go in once.
let bound = false;
// The widths of a row's columns but the last, which takes the rest, by how
// many it has: a session's mark, agent, time and context used, or an inbox
// item's mark, agent and source.
const WIDTHS = { 5: [16, 72, 96, 44], 4: [16, 72, 60], 3: [16, 60] };

/** Sends a request to the server, returning its body, or raising unless
 * it succeeds. */
async function ask(method, path, body) {
  const options = body === undefined ? { method } : {
    method, body: JSON.stringify(body),
    // The page's own, which opening a row needs.
    headers: { "Content-Type": "application/json", Origin: SERVER },
  };
  const r = await fetch(`${SERVER}${path}`, options);
  const text = await r.text();
  if (r.status >= 300) throw new Error(text || `status ${r.status}`);
  return text;
}

/** Returns the rows, starting the server through herdr-project, as for
 * agents, if it doesn't answer, and waiting up to 30 seconds for it. */
async function load(inbox, cx) {
  const path = `/picker?app=1${inbox ? "&inbox=1" : ""}`;
  try {
    return JSON.parse(await ask("GET", path));
  } catch {}
  await exec("herdr-project", ["--background"], { timeout: 10_000 }).catch(() => {});
  for (let tries = 0; ; tries++) {
    try {
      return JSON.parse(await ask("GET", path));
    } catch (e) {
      if (tries >= 60) throw e;
    }
    await cx.sleep(500);
  }
}

export default class ProjectPicker extends View {
  init(_props, cx) {
    this.rows = null;
    this.error = null;
    this.shown = [];
    this.cursor = 0;
    this.agent = AGENTS[0];
    // Notes by row, read once: the picker is short-lived.
    this.notes = new Map();
    this.input = InputState.new({ placeholder: props()?.inbox ? "What waits on you…" : "Projects and sessions…" });
    this.input.on("change", (_e, cx) => {
      this.shown = visible(this.rows ?? [], this.input.value());
      this.moveTo(0, cx);
    });
    this.input.on("submit", (_e, cx) => this.pick(cx));
    this.input.focus();
    this.scroll = ScrollHandle.new();
    if (!bound) {
      cx.bind_keys(BINDINGS);
      bound = true;
    }
    cx.spawn(async (cx) => {
      try {
        this.rows = await load(props()?.inbox, cx);
        this.shown = visible(this.rows, this.input.value());
        this.moveTo(0, cx);
      } catch (e) {
        this.error = `Couldn't read the picker's rows: ${e.message ?? e}. herdr-project --watch runs the server; see ~/.local/state/herdr-project/web.log.`;
        cx.notify();
      }
    });
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  /** Selects the shown row at index, kept in range, and reads its notes
   * if they haven't been. */
  moveTo(index, cx) {
    this.cursor = Math.max(0, Math.min(index, this.shown.length - 1));
    this.scroll.scroll_to_item(this.cursor);
    const i = this.shown[this.cursor];
    if (i !== undefined && !this.notes.has(i)) {
      this.notes.set(i, "");
      const [kind, dir, session] = this.rows[i];
      const query = new URLSearchParams({ kind, dir, session });
      cx.spawn(async (cx) => {
        try {
          this.notes.set(i, await ask("GET", `/picker/notes?${query}`));
        } catch {
          // Read again when the row is selected next.
          this.notes.delete(i);
        }
        cx.notify();
      });
    }
    cx.notify();
  }

  /** Opens the selected row with the selected agent and closes. */
  pick(cx) {
    const i = this.shown[this.cursor];
    if (i === undefined || this.opening) return;
    this.opening = true;
    const row = this.rows[i];
    const agent = this.agent;
    // Closing the dialog cancels its tasks, so it closes once opening is done.
    cx.spawn(async () => {
      try {
        await ask("POST", "/picker/open", { row, agent, app: true });
      } catch (e) {
        notify({ title: "Couldn't open it", body: String(e.message ?? e), level: "error" });
      } finally {
        this.dismiss();
      }
    });
  }

  /** Switches the agent by steps along AGENTS, wrapping. */
  switchAgent(by, cx) {
    this.agent = AGENTS[(AGENTS.indexOf(this.agent) + by + AGENTS.length) % AGENTS.length];
    cx.notify();
  }

  /** Returns text as runs, with the parts matching ws and running marks
   * in color. */
  colored(text, ws, t) {
    const hits = spans(ws, text);
    const runs = [];
    let offset = 0;
    for (const c of text) {
      const style = hits.some(([a, b]) => a <= offset && offset < b) ? "hit" : c === "●" ? "run" : "";
      if (runs.length && runs.at(-1)[0] === style) runs.at(-1)[1] += c;
      else runs.push([style, c]);
      offset += c.length;
    }
    return runs.map(([style, s]) =>
      style === "hit" ? div().text_color(t.accent).font_bold().child(s)
        : style === "run" ? div().text_color(t.done).child(s)
        : div().child(s));
  }

  /** Returns the cells of row, in columns as WIDTHS lays them out, or a
   * project's name and title, with the parts matching ws in color. */
  cells(row, n, ws, t) {
    const [kind, , , text, cells = [text]] = row;
    const widths = WIDTHS[cells.length];
    const cell = (c, at) => TableCell.new(`cell-${n}-${at}`, at + 1).flex().overflow_hidden().whitespace_nowrap();
    if (!widths) {
      // A project's name and title, or a row the server didn't split.
      return cells.map((c, at) => cell(c, at).when(at > 0 || cells.length === 1, (el) => el.flex_1().min_w(0))
        .when(at > 0 && kind === "project", (el) => el.font_normal())
        .children(this.colored(c, ws, t)));
    }
    return cells.map((c, at) => cell(c, at)
      .when(at < widths.length, (el) => el.w(widths[at]).flex_none())
      .when(at === widths.length, (el) => el.flex_1().min_w(0))
      // Context used, as a number, lines up on the right.
      .when(cells.length === 5 && at === 3, (el) => el.justify_end().pr(12))
      .when(at > 0 && at < widths.length, (el) => el.text_color(t.dim))
      .children(this.colored(c, ws, t)));
  }

  row(i, n, ws, t) {
    const [kind] = this.rows[i];
    const on = n === this.cursor;
    return TableRow.new(`row-${i}`, n + 1)
      .flex()
      .h(28)
      .flex_none()
      .px(10)
      .when(kind === "session", (el) => el.pl(18))
      .rounded(6)
      .items_center()
      .gap(kind === "project" ? 12 : 4)
      .cursor_pointer()
      .text_color(kind === "session" ? t.muted : t.foreground)
      .when(kind !== "session", (el) => el.font_semibold())
      .when(on, (el) => el.bg(t.selected ?? t.hover).text_color(t.foreground))
      .hover((s) => s.bg(t.hover))
      .on_click((e, cx) => {
        this.moveTo(n, cx);
        if (e.click_count >= 2) this.pick(cx);
      })
      .children(this.cells(this.rows[i], n, ws, t))
      .when(kind === "new" && on, (el) => el.child(this.agents(t)));
  }

  /** Returns the agents a new session can start with, the selected one
   * marked; clicking one selects it. */
  agents(t) {
    return h_flex().flex_none().gap(4).text_size(11.5).font_normal().children(AGENTS.map((a) =>
      div().id(`agent-${a}`).px(6).py(1).rounded(4).cursor_pointer()
        .when(a === this.agent, (el) => el.bg(t.accent).text_color(t.background))
        .when(a !== this.agent, (el) => el.text_color(t.dim).hover((s) => s.text_color(t.foreground)))
        .on_click((_e, cx) => {
          this.agent = a;
          cx.notify();
        })
        .child(a)));
  }

  render() {
    const t = theme();
    const rows = this.rows ?? [];
    const ws = words(this.input.value());
    const i = this.shown[this.cursor];
    const selected = i === undefined ? null : rows[i];
    const page = Math.max(1, Math.floor((this.listHeight ?? 280) / 28) - 1);
    const status = this.error ?? (this.rows === null ? "Reading projects…"
      : `${this.shown.length}/${rows.length}${selected ? `  ·  ${hint(selected, this.agent)}` : ""}`);
    return v_flex()
      .id("project-picker")
      .key_context("ProjectPicker")
      .on_action("project_picker::NextAgent", (_e, cx) => this.switchAgent(1, cx))
      .on_action("project_picker::PrevAgent", (_e, cx) => this.switchAgent(-1, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.keystroke;
        if (k === "escape" || k === "ctrl-g") return this.dismiss();
        if (k === "down" || k === "ctrl-n") this.moveTo(this.cursor + 1, cx);
        else if (k === "up" || k === "ctrl-p") this.moveTo(this.cursor - 1, cx);
        else if (k === "pagedown") this.moveTo(this.cursor + page, cx);
        else if (k === "pageup") this.moveTo(this.cursor - page, cx);
        else if (k === "ctrl-f") this.switchAgent(1, cx);
        else if (k === "ctrl-b") this.switchAgent(-1, cx);
        else return;
        cx.stop_propagation();
      })
      .child(
        h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(8).border_1().border_color(t.accent).bg(t.background)
          .child(div().text_color(t.accent).font_semibold().child(props()?.inbox ? "inbox>" : "project>"))
          .child(Input.new(this.input).flex_1().h_full().text_size(13).text_color(t.foreground)),
      )
      .child(
        h_flex().flex_1().min_h(0).gap(12)
          .child(
            Table.new()
              .accessibility_label("Projects")
              .row_count(this.shown.length)
              .column_count(5)
              .flex()
              .flex_col()
              .flex_1()
              .min_w(0)
              .min_h(0)
              .h_full()
              .overflow_hidden()
              .child(
                // The rows, as its direct children, so that scroll_to_item
                // finds them, in a plain element: a TableBody doesn't scroll.
                v_flex()
                  .id("rows")
                  .size_full()
                  .min_h(0)
                  .overflow_y_scrollbar()
                  .track_scroll(this.scroll)
                  .on_size_change((size, cx) => {
                    this.listHeight = size.height / settings().zoom;
                    cx.notify();
                  })
                  .children(this.shown.map((row, n) => this.row(row, n, ws, t))),
              ),
          )
          .child(
            v_flex()
              .id("notes")
              .flex_1()
              .min_w(0)
              .h_full()
              .p(10)
              .rounded(8)
              .border_1()
              .border_color(t.border)
              .bg(t.background)
              .overflow_y_scrollbar()
              .text_size(12)
              .text_color(t.muted)
              .children((i === undefined ? "" : this.notes.get(i) ?? "").split("\n").map((line) => div().min_h(16).child(line))),
          ),
      )
      .child(div().flex_none().truncate().text_size(12).text_color(this.error ? t.blocked : t.dim).child(status));
  }
}
