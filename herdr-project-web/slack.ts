// Finding the user's active Slack conversations, by asking a headless
// Claude session that has the Slack connector, and telling the user when
// one starts waiting on them.

import { mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import * as headless from "./headless.ts";
import type { Item } from "./inbox.ts";
import {
  type NotesText, type Owner, cut, escapeRegExp, ownedItem, pad, projectName, projectOf,
} from "./owners.ts";
import { loadState, saveState } from "./statefile.ts";

// The claude.ai connector the headless session needs.
export const CONNECTOR = "Slack";

const SCHEMA = {
  type: "object",
  required: ["conversations"],
  properties: { conversations: { type: "array", items: {
    type: "object",
    required: ["channel_id", "thread_ts", "channel", "summary", "waiting_on_me", "done", "last_ts"],
    properties: {
      channel_id: { type: "string" },
      thread_ts: { type: "string" },
      channel: { type: "string" },
      permalink: { type: "string" },
      summary: { type: "string" },
      waiting_on_me: { type: "boolean" },
      done: { type: "boolean" },
      last_ts: { type: "string" },
      links: { type: "array", items: { type: "string" } },
    },
  } } },
};

const TOOLS = [
  "mcp__claude_ai_Slack__slack_search_public_and_private",
  "mcp__claude_ai_Slack__slack_search_public",
  "mcp__claude_ai_Slack__slack_read_thread",
  "mcp__claude_ai_Slack__slack_read_channel",
];

export type Conversation = {
  channel_id: string;
  thread_ts: string;
  channel: string;
  permalink?: string;
  summary: string;
  waiting_on_me: boolean;
  done?: boolean;
  last_ts: string;
  links?: string[];
};

/** Returns date as YYYY-MM-DD in local time. */
export function day(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** Returns what to ask Claude for the conversations since the date since. */
export function prompt(since: Date): string {
  return (
    "List my active Slack conversations. I am the logged-in user; the " +
    "search tool tells you my user ID. Search messages from me and " +
    `messages mentioning me since ${day(since)}, all channel types, ` +
    "sorted by timestamp, response_format detailed. Group the results by " +
    "conversation: a thread (channel_id and thread_ts) or, for DM " +
    'messages outside threads, the DM (thread_ts ""). Read each thread, ' +
    "at most 15, to see its latest message. last_ts is the ts of that " +
    "message. waiting_on_me is true when someone else wrote after my " +
    "last message and it asks or tells me something, or mentions me. " +
    "done is true when nothing is left for me in it: what I was asked " +
    "for has already happened, as when the pull requests it is about are " +
    "merged or closed, or the question was answered or dropped. " +
    "summary is one line saying what is pending. permalink is the " +
    "conversation's Slack permalink: the thread's, or for a DM, that of " +
    "its latest message. links are the GitHub pull request URLs in the " +
    "conversation. Do not send anything."
  );
}

/** Returns the user's Slack conversations of the last days days as the
 * headless Claude session in stateDir reports them. Raises if it fails. */
export function fetch(stateDir: string, days = 3): Promise<Conversation[]> {
  const since = new Date(Date.now() - days * 86400_000);
  return headless.ask(stateDir, prompt(since), SCHEMA, TOOLS, "conversations");
}

/** Returns what identifies conversation across runs. */
export function key(c: Conversation): string {
  return `${c.channel_id}/${c.thread_ts}`;
}

/** Returns the project working on conversation, as projectOf finds it
 * from texts and prOwners: the one whose notes mention the thread or, for
 * a DM, the channel, else that of a pull request it links to. */
export function owner(c: Conversation, texts: NotesText[], prOwners: Record<string, Owner | null>): Owner | null {
  const ts = escapeRegExp(c.thread_ts.replaceAll(".", ""));
  const pattern = ts ? new RegExp(`(?<!\\d)p?${ts}(?!\\d)`) : new RegExp(`\\b${escapeRegExp(c.channel_id)}\\b`);
  return projectOf(pattern, c.links, texts, prOwners);
}

/** Returns whether c waits on the user: Claude says so and doesn't find
 * it done. */
export function waiting(c: Conversation): boolean {
  return c.waiting_on_me && !c.done;
}

const NUMBER = /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;

/** Returns the ts of c's latest message, written the same way however
 * Claude wrote it, if it is a number. */
export function last(c: Conversation): string {
  return NUMBER.test(c.last_ts) ? Number(c.last_ts).toFixed(6) : c.last_ts;
}

/** Returns the conversations that started waiting on the user, or got a
 * new message while waiting, since old, the state remember returned last
 * time. With no old state there are none. */
export function events(old: Record<string, string> | null, conversations: Conversation[]): Conversation[] {
  if (!old) return [];
  return conversations.filter((c) => waiting(c) && old[key(c)] !== last(c));
}

/** Returns the state to compare the next conversations with: old updated
 * with conversations, without those that have been quiet for days days
 * before now, a Unix time in seconds. */
export function remember(
  old: Record<string, string> | null,
  conversations: Conversation[],
  now: number,
  days = 7,
): Record<string, string> {
  const state: Record<string, string> = { ...old };
  for (const c of conversations) state[key(c)] = last(c);
  // Keep what Claude wrote oddly, or it notifies every time.
  const recent = (ts: string) => !NUMBER.test(ts) || Number(ts) > now - days * 86400;
  return Object.fromEntries(Object.entries(state).filter(([, ts]) => recent(ts)));
}

const mark = (c: Conversation) => (waiting(c) ? "*" : c.done ? "✓" : " ");

/** Returns conversations, those waiting on the user first and those done
 * last. */
function ordered(conversations: Conversation[]): Conversation[] {
  const rank = (c: Conversation) => (waiting(c) ? 0 : 1) * 2 + (c.done ? 1 : 0);
  return [...conversations].sort((a, b) => rank(a) - rank(b));
}

/** Returns lines listing conversations, those waiting on the user first
 * and those done, marked with a check, last, within each group: those of
 * a project with its name, from owners (by key), then the others under a
 * line naming their channel, channels with a conversation waiting on the
 * user first. Columns are as wide as their longest entry, so empty ones
 * take no space. */
export function table(conversations: Conversation[], owners: Record<string, Owner | null>): string[] {
  const sorted = ordered(conversations);
  const ours = sorted.filter((c) => owners[key(c)]);
  const names = Object.fromEntries(ours.map((c) => [key(c), projectName(owners[key(c)]!.project)]));
  const width = (texts: string[]) => Math.max(0, ...texts.map((t) => Array.from(t).length));
  const channelWidth = width(ours.map((c) => cut(c.channel, 26)));
  const nameWidth = width(Object.values(names));
  const lines = ours.map(
    (c) => `${mark(c)} ${pad(cut(c.channel, 26), channelWidth)} ${pad(names[key(c)], nameWidth)} ${c.summary}`,
  );
  // Group by ID, which Claude can't spell two ways, under the first name.
  const channels = new Map<string, Conversation[]>();
  for (const c of sorted)
    if (!owners[key(c)]) channels.set(c.channel_id, [...(channels.get(c.channel_id) ?? []), c]);
  for (const found of channels.values()) {
    lines.push(found[0].channel || found[0].channel_id);
    lines.push(...found.map((c) => `  ${mark(c)} ${c.summary}`));
  }
  return lines;
}

/** Returns conversations as rows for other viewers, with the name of
 * their project from owners (by key): those waiting on the user first and
 * those done last, then those of a project. Unlike table, it doesn't
 * group them by project and channel. */
export function entries(conversations: Conversation[], owners: Record<string, Owner | null>) {
  const rows = conversations.map((c) => ({
    label: c.channel || c.channel_id,
    title: c.summary,
    url: c.permalink || null,
    waiting: waiting(c),
    done: !!c.done,
    project: owners[key(c)] ? projectName(owners[key(c)]!.project) : null,
  }));
  const rank = (r: (typeof rows)[number]) => (r.waiting ? 0 : 4) + (r.done ? 2 : 0) + (r.project === null ? 1 : 0);
  return rows.sort((a, b) => rank(a) - rank(b));
}

/** Checks the Slack conversations once with fetch: tells the user with
 * notify about those newly waiting on them since the state in path,
 * saves the new state there, and returns the lines of table, the rows of
 * entries and inbox items for the conversations waiting on the user.
 * texts are the projects' notes, and prOwners the projects of pull
 * requests by url. */
export async function poll(
  notify: (title: string, body: string) => Promise<unknown>,
  texts: NotesText[],
  path: string,
  prOwners: Record<string, Owner | null>,
  fetchConversations: (stateDir: string) => Promise<Conversation[]> = fetch,
): Promise<{ lines: string[]; rows: unknown[]; items: Item[] }> {
  const old = loadState(path) as Record<string, string> | null;
  mkdirSync(dirname(path), { recursive: true });
  const found = await fetchConversations(dirname(path));
  const owners = Object.fromEntries(found.map((c) => [key(c), owner(c, texts, prOwners)]));
  for (const c of events(old && typeof old === "object" ? old : null, found)) {
    const project = owners[key(c)];
    const where = project ? ` (${basename(project.project)})` : "";
    await notify(`Slack ${c.channel}`, `${c.summary}${where}`).catch(() => {});
  }
  saveState(path, remember(old && typeof old === "object" ? old : null, found, Date.now() / 1000));
  const items = found
    .filter(waiting)
    .map((c) => ownedItem(owners[key(c)], "slack", `Slack ${c.channel}: ${c.summary}`));
  return { lines: table(found, owners), rows: entries(found, owners), items };
}
