// The page's view for asking every agent a question, and their replies.

import { useState } from "preact/hooks";
import type { State } from "../state.ts";
import { renderMarkdown } from "../markdown.ts";
import { Linked, matches, send } from "../ui.tsx";
import type { AskStatus, AskView } from "./ask.ts";

// How each status shows: its badge's text and kind.
const STATUS: Record<AskStatus, [string, string]> = {
  queued: ["waiting to ask", "wait"],
  asked: ["asked", "wait"],
  replied: ["replied", "ok"],
  gone: ["gone", "bad"],
};

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Returns one answer from ask's replies, rendered from Markdown, or that
 * one is being made. */
function Summary({ ask, replied }: { ask: AskView; replied: number }) {
  const { summary } = ask;
  if (!replied) return null;
  if (!summary) return <p class="ask-summary empty">Putting the replies together…</p>;
  return (
    <div class="ask-summary">
      {/* Claude writes it in Markdown; markdown-it leaves out raw HTML. */}
      <div class="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(summary.text) }} />
      <span class="empty">
        From {summary.replies} {summary.replies === 1 ? "reply" : "replies"} · {clock(summary.at)}
        {ask.stale && " · adding the newer ones…"}
      </span>
    </div>
  );
}

/** Returns a question, one answer from the replies, and each agent's
 * reply, or where its question stands. */
function AskCard({ ask }: { ask: AskView }) {
  const replied = ask.agents.filter((a) => a.reply).length;
  return (
    <section class="card">
      <header>
        <span class="name ask-text">{ask.text}</span>
        <span class="title">
          {replied}/{ask.agents.length} replied · <time dateTime={new Date(ask.at).toISOString()}>{clock(ask.at)}</time>
        </span>
      </header>
      <Summary ask={ask} replied={replied} />
      <ul class="wts">
        {ask.agents.map((a, i) => (
          <li key={i} class="wt">
            <span class="wt-name">{a.label}</span>
            <span class={`badge badge-${STATUS[a.status][1]}`}>
              {a.reply ? `${STATUS[a.status][0]} ${clock(a.reply.at)}` : STATUS[a.status][0]}
            </span>
            {a.reply && (
              <p class="ask-reply">
                <Linked text={a.reply.text} />
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Returns the box that asks every agent a question, and the questions
 * asked, newest first, matching query. Busy agents get it once idle;
 * Claude Code agents, while they work too, but not on a prompt. */
export function AskAgents({ state, query }: { state: State; query: string }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state.asks) return <p class="empty">Only the watcher's server asks agents. Run <code>herdr-project --watch</code>.</p>;
  const ask = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await send("POST", "/api/asks", { text });
      setText("");
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  const asks = state.asks.filter((a) => matches(query, a.text, ...a.agents.flatMap((g) => [g.label, g.reply?.text ?? null])));
  return (
    <div class="diffs">
      <h2>Ask every agent</h2>
      <div class="ask-box">
        <textarea
          rows={3}
          value={text}
          placeholder="What are you waiting on?"
          aria-label="Question for every agent"
          readOnly={sending}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) ask();
          }}
        />
        <div class="comment-actions">
          <button class="copy" disabled={!text.trim() || sending} onClick={ask}>
            ask every agent
          </button>
          <span class="empty">Busy agents get it once idle; Claude Code agents, while they work too.</span>
          {error && <span class="agent-error">{error}</span>}
        </div>
      </div>
      {asks.length ? asks.map((a) => <AskCard key={a.id} ask={a} />) : <p class="empty">{query ? "No match." : "Nothing asked yet."}</p>}
    </div>
  );
}
