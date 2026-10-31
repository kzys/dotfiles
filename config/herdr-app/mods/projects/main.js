// Picks a project under ~/project, one of its agent sessions, or a new
// project, as herdr-project-picker does in a terminal, but drawn here.
// herdr-project-picker lists the rows, reads their notes and opens the
// picked one. mod.open shows it.
//
// Type to filter: every word must appear in a row, or in a session row
// or its project's row. Up, down, ctrl-p and ctrl-n move; ctrl-b and
// ctrl-f switch the agent new sessions start with; Enter opens; Esc
// closes.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextView } from "gpui-base";
import { exec, theme, settings, props, closeOverlay, notify } from "herdr";

const PICKER = "herdr-project-picker";
const AGENTS = ["claude", "codex", "opencode"];
const ROW = 22;

// What the line below the list says Enter does, by kind of row.
const HINT = {
  new: (a) => `enter: start a new ${a} session in a new project`,
  project: (a) => `enter: start a new ${a} session in this project`,
  running: () => "enter: switch to this running session",
  session: () => "enter: resume this session",
  unsaved: (a) => `enter: start a new ${a} session for this`,
};

// Where word appears in text, or -1. A word with uppercase letters
// matches case, and one without ignores it.
function found(word, text) {
  return (word === word.toLowerCase() ? text.toLowerCase() : text).indexOf(word);
}

// The indices of rows, [kind, directory, session, text] each, that query
// matches. A project shows when any of its sessions does.
function visible(rows, query) {
  const words = query.split(/\s+/).filter(Boolean);
  const shown = [];
  let group = null;
  rows.forEach(([kind, , , text], i) => {
    if (kind === "session") {
      const both = (group === null ? "" : rows[group][3]) + "\n" + text;
      if (words.every((w) => found(w, both) >= 0)) {
        if (group !== null && !shown.includes(group)) shown.push(group);
        shown.push(i);
      }
      return;
    }
    group = i;
    if (words.every((w) => found(w, text) >= 0)) shown.push(i);
  });
  return shown;
}

function hint(row, agent) {
  const [kind, , sid, text] = row;
  if (kind === "session" && !sid) return HINT.unsaved(agent);
  if (kind === "session" && text.includes("●")) return HINT.running(agent);
  return HINT[kind]?.(agent) ?? "";
}

export default class Projects extends View {
  init(_props, cx) {
    this.rows = null;
    this.error = null;
    this.query = "";
    this.cursor = 0;
    this.top = 0;
    this.agent = AGENTS[0];
    this.notes = {};
    this.height = 600;
    this.input = InputState.new({ placeholder: "Filter projects and sessions…" });
    this.input.on("change", (_e, cx) => {
      this.query = this.input.value();
      this.cursor = this.top = 0;
      cx.notify();
    });
    this.input.on("submit", () => this.open());
    this.input.focus();
    cx.spawn(async (cx) => {
      try {
        const r = await exec(PICKER, ["--app", "--json"]);
        if (r.code !== 0) throw new Error(r.stderr.trim() || `exit ${r.code}`);
        this.rows = JSON.parse(r.stdout);
      } catch (e) {
        this.error = `Couldn't list projects: ${e.message ?? e}`;
      }
      cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  shown() {
    return this.rows ? visible(this.rows, this.query) : [];
  }

  open() {
    const shown = this.shown();
    if (!shown.length) return;
    const [kind, dir, sid] = this.rows[shown[this.cursor]];
    // Started before closing, so it outlives this dialog, and closing
    // first lets the pane it opens keep the keyboard.
    exec(PICKER, ["--open", kind, dir, sid, "--agent", this.agent])
      .then((r) => r.code === 0 || notify({ title: "Couldn't open", body: r.stderr.trim(), level: "error" }))
      .catch(() => {});
    this.close();
  }

  // The notes of row i, read once and kept: the dialog is short-lived.
  preview(i, cx) {
    if (!(i in this.notes)) {
      this.notes[i] = null;
      cx.spawn(async (cx) => {
        const [kind, dir, sid] = this.rows[i];
        const r = await exec(PICKER, ["--notes", kind, dir, sid]).catch(() => null);
        this.notes[i] = r?.code === 0 ? r.stdout : "";
        cx.notify();
      });
    }
    return this.notes[i];
  }

  key(e, cx) {
    const shown = this.shown();
    const lines = this.lines();
    const ctrl = e.modifiers.control;
    const moves = { up: -1, down: 1, pageup: -lines, pagedown: lines };
    let move = moves[e.key];
    if (ctrl && e.key === "p") move = -1;
    if (ctrl && e.key === "n") move = 1;
    if (e.key === "escape") {
      this.close();
    } else if (move !== undefined) {
      this.cursor = Math.max(0, Math.min(this.cursor + move, shown.length - 1));
    } else if (ctrl && (e.key === "b" || e.key === "f")) {
      const i = AGENTS.indexOf(this.agent) + (e.key === "f" ? 1 : -1);
      this.agent = AGENTS[(i + AGENTS.length) % AGENTS.length];
    } else {
      return;
    }
    cx.stop_propagation();
    cx.notify();
  }

  // How many rows fit in the list, about half of the dialog after the
  // filter box, the status line, the rule and the padding, 90 px in all.
  lines() {
    return Math.max(1, Math.floor((this.height - 90) / 2 / ROW));
  }

  row(i, selected, t) {
    const [kind, , , text] = this.rows[i];
    const words = this.query.split(/\s+/).filter(Boolean);
    const el = h_flex().id(`row-${i}`).h(ROW).px(8).gap(6).items_center().rounded(5).cursor_pointer()
      .when(selected, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        const at = this.shown().indexOf(i);
        if (at === this.cursor) return this.open();
        this.cursor = at;
        cx.notify();
      })
      .child(div().flex_1().truncate().whitespace_nowrap()
        .text_color(kind === "session" ? t.muted : t.foreground)
        .when(kind !== "session", (d) => d.font_semibold())
        .when(words.some((w) => found(w, text) >= 0), (d) => d.text_color(t.foreground))
        .child(text.replace("●", "").trimEnd()))
      .when(text.includes("●"), (el) => el.child(div().text_color(t.working).child("● running")));
    if (kind !== "new") return el;
    return el.children(AGENTS.map((a) => div().id(`agent-${a}`).px(6).rounded(4)
      .when(a === this.agent, (d) => d.bg(t.accent).text_color(t.accent_foreground))
      .when(a !== this.agent, (d) => d.text_color(t.dim))
      .on_click((_e, cx) => { this.agent = a; cx.stop_propagation(); cx.notify(); })
      .child(a)));
  }

  render(cx) {
    const t = theme();
    const shown = this.shown();
    const lines = this.lines();
    this.cursor = Math.max(0, Math.min(this.cursor, shown.length - 1));
    this.top = Math.min(Math.max(this.top, this.cursor - lines + 1), this.cursor);
    const current = shown[this.cursor];
    const notes = current === undefined ? "" : this.preview(current, cx);
    const status = this.error ? this.error
      : this.rows === null ? "Loading…"
      : `${shown.length}/${this.rows.length}  ${current === undefined ? "" : hint(this.rows[current], this.agent)}`;

    return v_flex().id("projects").size_full().p(14).gap(8).bg(t.popover).text_size(13)
      .on_size_change((size, cx) => { this.height = size.height; cx.notify(); })
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().h(34).flex_none().px(10).items_center().rounded(8).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(13).text_color(t.foreground)))
      .child(v_flex().flex_none().h(lines * ROW).font_family(settings().font_family ?? "JetBrains Mono").text_size(12)
        .children(this.rows ? shown.slice(this.top, this.top + lines).map((i, j) => this.row(i, this.top + j === this.cursor, t)) : []))
      .child(div().flex_none().text_size(11.5).text_color(this.error ? t.blocked : t.dim).child(status))
      .child(div().flex_none().h(1).bg(t.border))
      .child(v_flex().id("notes").flex_1().min_h(0).overflow_y_scrollbar().text_color(t.foreground)
        .child(notes === null ? div().text_color(t.dim).child("Reading notes…")
          : notes ? TextView.markdown(`notes-${current}`, notes)
          : div().text_color(t.dim).child(current === undefined ? "" : "No notes")));
  }
}
