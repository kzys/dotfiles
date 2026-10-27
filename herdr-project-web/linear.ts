// Finding the user's active Linear issues, by asking a headless Claude
// session that has the Linear connector, and telling the user when one
// starts waiting on them.

import { mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import * as headless from "./headless.ts";
import type { Item } from "./inbox.ts";
import { type NotesText, type Owner, cut, escapeRegExp, ownedItem, pad, projectName, projectOf } from "./owners.ts";
import { day } from "./slack.ts";
import { loadState, saveState } from "./statefile.ts";

// The claude.ai connector the headless session needs.
export const CONNECTOR = "Linear";

const SCHEMA = {
  type: "object",
  required: ["issues"],
  properties: { issues: { type: "array", items: {
    type: "object",
    required: ["identifier", "title", "state", "url", "updated_at", "summary", "waiting_on_me"],
    properties: {
      identifier: { type: "string" },
      title: { type: "string" },
      state: { type: "string" },
      url: { type: "string" },
      updated_at: { type: "string" },
      summary: { type: "string" },
      waiting_on_me: { type: "boolean" },
      links: { type: "array", items: { type: "string" } },
    },
  } } },
};

const TOOLS = [
  "mcp__claude_ai_Linear__list_issues",
  "mcp__claude_ai_Linear__get_issue",
  "mcp__claude_ai_Linear__list_comments",
  "mcp__claude_ai_Linear__get_user",
];

export type Issue = {
  identifier: string;
  title: string;
  state: string;
  url: string;
  updated_at: string;
  summary: string;
  waiting_on_me: boolean;
  links?: string[];
};

/** Returns what to ask Claude for the issues assigned to the user, and
 * those they created that changed since the date createdSince, reading
 * the comments of those that changed since recentSince. */
export function prompt(createdSince: Date, recentSince: Date): string {
  return (
    "List my active Linear issues: issues assigned to me that are not " +
    "completed or canceled, and issues I created that were updated since " +
    `${day(createdSince)} and are not completed or canceled. For each ` +
    `issue updated since ${day(recentSince)}, read its comments. ` +
    "waiting_on_me is true when someone else commented after my last " +
    "comment and asks or tells me something or mentions me, or the issue " +
    `was assigned to me since ${day(recentSince)}. summary is one ` +
    "line saying what is pending. updated_at is the ISO time of the last " +
    "update. links are the GitHub pull request URLs attached to or " +
    "mentioned in the issue. Do not change anything."
  );
}

/** Returns the user's active Linear issues as the headless Claude session
 * in stateDir reports them. Raises if it fails. */
export function fetch(stateDir: string): Promise<Issue[]> {
  const now = Date.now();
  return headless.ask(stateDir, prompt(new Date(now - 14 * 86400_000), new Date(now - 3 * 86400_000)),
                      SCHEMA, TOOLS, "issues");
}

/** Returns the project working on issue, as projectOf finds it from texts
 * and prOwners: the one whose notes mention its identifier, else that of
 * a pull request it links to. */
export function owner(issue: Issue, texts: NotesText[], prOwners: Record<string, Owner | null>): Owner | null {
  const pattern = new RegExp(`(?<![\\w-])${escapeRegExp(issue.identifier)}(?!\\d)`);
  return projectOf(pattern, issue.links, texts, prOwners);
}

// An ISO date, with a time and a zone if any.
const ISO = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/** Returns when issue was last updated, in UTC to the second, however
 * Claude wrote it, if it is an ISO time. */
export function updated(issue: Issue): string {
  const m = ISO.exec(issue.updated_at);
  if (!m) return issue.updated_at;
  const [, date, h = "00", min = "00", s = "00", zone] = m;
  const local = `${date}T${h}:${min}:${s}`;
  if (!zone) return local;
  // Date wants a zone like +05:00, not +05 or +0500.
  const offset = zone === "Z" ? zone : `${zone.slice(0, 3)}:${zone.length > 3 ? zone.slice(-2) : "00"}`;
  const at = new Date(`${local}${offset}`);
  return Number.isNaN(at.getTime()) ? issue.updated_at : at.toISOString().slice(0, 19);
}

/** Returns the issues that started waiting on the user, or changed while
 * waiting, since old, the state remember returned last time. With no old
 * state there are none. */
export function events(old: Record<string, string> | null, issues: Issue[]): Issue[] {
  if (!old) return [];
  return issues.filter((i) => i.waiting_on_me && old[i.identifier] !== updated(i));
}

/** Returns the state to compare the next issues with: old updated with
 * issues, so that one Claude leaves out once doesn't count as new when it
 * is back, without those last updated days days before now. */
export function remember(old: Record<string, string> | null, issues: Issue[], now: Date, days = 30) {
  const state: Record<string, string> = { ...old };
  for (const i of issues) state[i.identifier] = updated(i);
  const recent = (at: string) => {
    const t = ISO.test(at) ? Date.parse(`${updated({ updated_at: at } as Issue)}Z`) : NaN;
    // Keep what Claude wrote oddly, or it notifies every time.
    return Number.isNaN(t) || t > now.getTime() - days * 86400_000;
  };
  return Object.fromEntries(Object.entries(state).filter(([, at]) => recent(at)));
}

/** Returns issues, those waiting on the user first, then the latest
 * updated. */
function ordered(issues: Issue[]): Issue[] {
  const latest = [...issues].sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
  return latest.sort((a, b) => Number(!a.waiting_on_me) - Number(!b.waiting_on_me));
}

/** Returns lines listing issues, those waiting on the user first, then
 * the latest updated, with the project name from owners (by
 * identifier). */
export function table(issues: Issue[], owners: Record<string, Owner | null>): string[] {
  return ordered(issues).map((i) => {
    const found = owners[i.identifier];
    const name = found ? projectName(found.project) : "";
    return `${i.waiting_on_me ? "*" : " "} ${pad(i.identifier, 9)} ${pad(cut(i.state, 11), 11)} ${pad(name, 20)} ${i.summary}`;
  });
}

/** Returns issues as rows for other viewers, in the order of table, with
 * the name of their project from owners (by identifier). */
export function entries(issues: Issue[], owners: Record<string, Owner | null>) {
  return ordered(issues).map((i) => {
    const found = owners[i.identifier];
    return {
      label: i.identifier, title: i.title, note: i.summary, detail: i.state, url: i.url || null,
      waiting: i.waiting_on_me, project: found ? projectName(found.project) : null,
    };
  });
}

/** Checks the Linear issues once with fetch: tells the user with notify
 * about those newly waiting on them since the state in path, saves the
 * new state there, and returns the lines of table, the rows of entries
 * and inbox items for the issues waiting on the user. texts are the
 * projects' notes, and prOwners the projects of pull requests by url. */
export async function poll(
  notify: (title: string, body: string) => Promise<unknown>,
  texts: NotesText[],
  path: string,
  prOwners: Record<string, Owner | null>,
  fetchIssues: (stateDir: string) => Promise<Issue[]> = fetch,
  now = new Date(),
): Promise<{ lines: string[]; rows: unknown[]; items: Item[] }> {
  const kept = loadState(path);
  const old = kept && typeof kept === "object" ? (kept as Record<string, string>) : null;
  mkdirSync(dirname(path), { recursive: true });
  const found = await fetchIssues(dirname(path));
  const owners = Object.fromEntries(found.map((i) => [i.identifier, owner(i, texts, prOwners)]));
  for (const i of events(old, found)) {
    const project = owners[i.identifier];
    const where = project ? ` (${basename(project.project)})` : "";
    await notify(`Linear ${i.identifier}`, `${i.summary}${where}`).catch(() => {});
  }
  saveState(path, remember(old, found, now));
  const items = found
    .filter((i) => i.waiting_on_me)
    .map((i) => ownedItem(owners[i.identifier], "linear", `${i.identifier}: ${i.summary}`));
  return { lines: table(found, owners), rows: entries(found, owners), items };
}
