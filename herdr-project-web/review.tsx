// The page's review of a diff or a file: comments kept in this browser
// until they are sent, and what sends them to an agent.

import { useEffect, useRef, useState } from "preact/hooks";
import {
  type Comment, type Reviewer, clearReviewer, commentKey, receiverStarted, receiverStatus, reviewMessage, reviewers, withComment,
} from "./review.ts";
import type { State } from "./state.ts";
import { send as post } from "./ui.tsx";

/** The comments on a diff or a file, kept in this browser until they are sent, even
 * as they are written, and the one being written. */
export type Review = {
  comments: Comment[];
  editing: Comment | null;
  edit: (at: Comment) => void;
  write: (body: string) => void;
  save: () => void;
  // Stops writing, putting back what the comment said before.
  cancel: () => void;
  remove: (gone: Comment[]) => void;
};

/** Returns the review of what is at place, a worktree or a file. */
export function useReview(place: string): Review {
  const key = `review:${place}`;
  const [comments, setComments] = useState<Comment[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "[]");
    } catch {
      return [];
    }
  });
  const [editing, setEditing] = useState<Comment | null>(null);
  const before = useRef("");
  const update = (change: (all: Comment[]) => Comment[]) => {
    setComments((all) => {
      const next = change(all);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  return {
    comments,
    editing,
    edit: (at) => {
      const body = comments.find((c) => commentKey(c) === commentKey(at))?.body ?? "";
      before.current = body;
      setEditing({ ...at, body });
    },
    write: (body) => {
      if (!editing) return;
      setEditing({ ...editing, body });
      update((all) => withComment(all, { ...editing, body }));
    },
    save: () => setEditing(null),
    cancel: () => {
      if (editing) update((all) => withComment(all, { ...editing, body: before.current }));
      setEditing(null);
    },
    // Not one written further since, as while it was being sent.
    remove: (gone) => update((all) => all.filter((c) => !gone.some((g) => commentKey(g) === commentKey(c) && g.body === c.body))),
  };
}

/** Returns the box that writes the comment being edited, which can go to
 * the agent straight away, without the others. */
function CommentBox({ review, sender }: { review: Review; sender: Sender }) {
  const { path, line, body } = review.editing!;
  const [error, setError] = useState<string | null>(null);
  const sendNow = async () => {
    const failed = await sender.send([review.editing!]);
    setError(failed);
    if (!failed) review.save();
  };
  const box = useRef<HTMLTextAreaElement>(null);
  // Not autofocus, which browsers honour once per page.
  useEffect(() => box.current?.focus(), [path, line]);
  return (
    <div class="comment">
      <textarea
        ref={box}
        rows={3}
        value={body}
        readOnly={sender.sending}
        aria-label={`Comment on ${path} line ${line}`}
        onInput={(e) => review.write(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) review.save();
          if (e.key === "Escape") review.cancel();
        }}
      />
      <div class="comment-actions">
        <button class="copy" onClick={review.save}>
          save
        </button>
        <button class="copy" onClick={review.cancel}>
          cancel
        </button>
        <AgentPicker sender={sender} />
        <button
          class="copy"
          disabled={!sender.target || sender.sending || !body.trim()}
          title="Send only this comment"
          onClick={sendNow}
        >
          {sender.target ? `send to ${sender.target.label}` : "choose an agent to send to"}
        </button>
        {error && <span class="agent-error">Couldn't send it: {error}</span>}
      </div>
    </div>
  );
}

/** Returns the comment on at, or the box writing it, if there is either. */
export function CommentAt({ at, review, sender }: { at: Comment; review: Review; sender: Sender }) {
  const key = commentKey(at);
  if (review.editing && commentKey(review.editing) === key) return <CommentBox review={review} sender={sender} />;
  const saved = review.comments.find((c) => commentKey(c) === key);
  if (!saved) return null;
  return (
    <div class="comment">
      <p class="comment-body">{saved.body}</p>
      <div class="comment-actions">
        <button class="copy" onClick={() => review.edit(at)}>
          edit
        </button>
        <button class="copy" onClick={() => review.remove([saved])}>
          delete
        </button>
      </div>
    </div>
  );
}

/** Sends comments to the agent chosen, where they wait until it is free. */
export type Sender = {
  agents: Reviewer[];
  target: Reviewer | null;
  pick: (id: string) => void;
  sending: boolean;
  // The agent last sent to and when, until dismissed.
  sent: (Reviewer & { at: number }) | null;
  dismiss: () => void;
  // Returns why it couldn't send them, or null once it has.
  send: (comments: Comment[]) => Promise<string | null>;
};

/** Returns what sends comments on wt, a worktree once it is read or a
 * project, to the agents working in it, removing them from review once
 * sent. */
export function useSender(review: Review, wt: { dir: string; branch: string | null } | null, state: State | null): Sender {
  const agents = state?.controls && wt ? reviewers(state.projects, wt.dir) : [];
  const [picked, pick] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Sender["sent"]>(null);
  // One picked that has gone stays gone, rather than becoming another.
  const target = picked ? (agents.find((a) => a.id === picked) ?? null) : clearReviewer(agents);
  const send = async (comments: Comment[]) => {
    if (!target || !wt) return "no agent chosen";
    setSending(true);
    try {
      await post("POST", `/api/agents/${encodeURIComponent(target.id)}/messages`, { text: reviewMessage(wt.dir, wt.branch, comments) });
      review.remove(comments);
      setSent({ ...target, at: Date.now() });
      return null;
    } catch (e) {
      return (e as Error).message;
    } finally {
      setSending(false);
    }
  };
  return { agents, target, pick, sending, sent, dismiss: () => setSent(null), send };
}

/** Returns what the agent sent to is doing, kept current by state, from
 * the time it was sent to. */
export function SentNote({ sent, dismiss, state }: { sent: Reviewer; dismiss: () => void; state: State | null }) {
  const started = useRef(false);
  started.current ||= receiverStarted(state, sent.id);
  const [agent, text] = receiverStatus(state, sent.id, started.current);
  return (
    <p class="sent-note">
      Sent to {sent.label}: <span class={`pr-agent agent-${agent}`}>{text}</span>
      <button class="copy" onClick={dismiss}>
        dismiss
      </button>
    </p>
  );
}

/** Returns the choice of agent, where there is one to make. */
function AgentPicker({ sender }: { sender: Sender }) {
  // One agent needs no choice, unless the one chosen left, with this one.
  if (!sender.agents.length || (sender.agents.length === 1 && sender.target)) return null;
  return (
    <select value={sender.target?.id ?? ""} aria-label="Agent" onChange={(e) => sender.pick(e.currentTarget.value)}>
      {!sender.target && <option value="">choose an agent</option>}
      {sender.agents.map((a) => (
        <option key={a.id} value={a.id}>
          {a.label}
        </option>
      ))}
    </select>
  );
}

/** Returns what sends every comment, and lists those whose lines changed,
 * moved, to send as they are or drop. */
export function SendReview({ review, sender, moved }: { review: Review; sender: Sender; moved: Comment[] }) {
  const [error, setError] = useState<string | null>(null);
  const { target, agents } = sender;
  const count = review.comments.length;
  if (!count) return null;
  return (
    <div class="review-bar">
      <span>
        {count} comment{count === 1 ? "" : "s"}
      </span>
      <AgentPicker sender={sender} />
      <button class="copy" disabled={!target || sender.sending} onClick={async () => setError(await sender.send(review.comments))}>
        {target ? `send to ${target.label}` : agents.length ? "choose an agent to send to" : "no agent to send to"}
      </button>
      {error && <span class="agent-error">Couldn't send them: {error}</span>}
      {moved.map((c) => (
        <div key={commentKey(c)} class="comment-moved">
          <span>
            {c.path}:{c.line} isn't shown as it was: {c.body}
          </span>
          <button class="copy" onClick={() => review.remove([c])}>
            delete
          </button>
        </div>
      ))}
    </div>
  );
}
