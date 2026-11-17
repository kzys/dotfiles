// The page's board of the user's pull requests.

import { useState } from "preact/hooks";
import { type Card, STAGES } from "./board.ts";
import { projectHref } from "./pages.ts";
import type { State } from "./state.ts";
import { matches } from "./ui.tsx";

const COPILOT: Record<Card["copilot"], string> = {
  none: "Copilot not reviewed",
  unresolved: "Copilot threads open",
  passed: "Copilot passed",
};

/** Returns the button that marks card reviewed by the user, or unmarks
 * it. */
function ReviewButton({ card }: { card: Card }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/reviewed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: card.url, reviewed: !card.reviewed }),
      });
      if (!res.ok) setError(`failed (${res.status})`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" class="board-review" disabled={busy} onClick={toggle}>
        {card.reviewed ? "Unmark reviewed" : "Mark reviewed"}
      </button>
      {error && <span class="pr-failed">{error}</span>}
    </>
  );
}

function BoardCard({ card }: { card: Card }) {
  const failing = card.checks === "FAILURE" || card.checks === "ERROR";
  const open = card.stage !== "merged";
  return (
    <li class="board-card">
      <a class="pr-title" href={card.url} target="_blank" rel="noreferrer">
        {card.title}
      </a>
      <div class="pr-meta">
        <span class="pr-label">{card.label}</span>
        {card.project && card.projectDir && (
          <a class="workspace" href={projectHref(card.projectDir)}>
            {card.project}
          </a>
        )}
      </div>
      {open && (
        <div class="pr-meta">
          {card.draft && <span class="badge badge-wait">draft</span>}
          {failing && <span class="badge badge-bad">checks failing</span>}
          {card.stage === "draft" && <span>{COPILOT[card.copilot]}</span>}
          {card.stage !== "approved" && <ReviewButton card={card} />}
        </div>
      )}
    </li>
  );
}

/** Returns the board of the user's pull requests in state matching
 * query, a column for each stage. */
export function BoardView({ state, query }: { state: State; query: string }) {
  if (!state.board) {
    return <p class="empty">The board needs the watcher. Run <code>herdr-project --watch</code>.</p>;
  }
  const cards = state.board.filter((c) => matches(query, c.title, c.label, c.project));
  return (
    <main class="board">
      {STAGES.map(([stage, title]) => {
        const here = cards.filter((c) => c.stage === stage);
        return (
          <section key={stage} class="column board-column">
            <h2>
              {title} <span class="count">{here.length || ""}</span>
            </h2>
            {here.length ? (
              <ul>
                {here.map((c) => (
                  <BoardCard key={c.url} card={c} />
                ))}
              </ul>
            ) : (
              <p class="empty">None.</p>
            )}
          </section>
        );
      })}
    </main>
  );
}
