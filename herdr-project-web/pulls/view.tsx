// The page's board of the user's pull requests.

import { useState } from "preact/hooks";
import { type Card, MINE, MINE_MAX, STAGES, type Stage, canAskCopilot, moveTo, recent } from "./board.ts";
import { projectHref } from "../pages.ts";
import type { State } from "../state.ts";
import { matches } from "../ui.tsx";

const COPILOT: Record<Card["copilot"], string> = {
  none: "Copilot not reviewed",
  unresolved: "Copilot threads open",
  passed: "Copilot passed",
};

/** Returns what a card before Copilot's column says of its review. */
function copilotNote(card: Card): string {
  if (card.copilot !== "none" || !card.copilotAsk) return COPILOT[card.copilot];
  return card.copilotAsk === "requested" ? "Copilot review requested" : `Copilot request failed: ${card.copilotAsk}`;
}

/** Returns the buttons that move card to the next column and, if the
 * user moved it there, back, as far as moveTo lets the user. */
function MoveButtons({ card }: { card: Card }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const next = moveTo(card.stage, 1);
  // Only a move of the user's can be undone, and only while GitHub alone
  // would put the card behind it.
  const back = card.moved === card.stage && card.found !== card.stage ? moveTo(card.stage, -1) : undefined;
  const move = async (stage: Stage | null) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/pulls/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: card.url, stage }),
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
      {back !== undefined && (
        <button type="button" class="board-review" disabled={busy} onClick={() => move(back)}>
          Move back
        </button>
      )}
      {next !== undefined && (
        <button type="button" class="board-review" disabled={busy} onClick={() => move(next)}>
          Move to next
        </button>
      )}
      {error && <span class="pr-failed">{error}</span>}
    </>
  );
}

/** Returns the button that asks Copilot to review card, if the user can. */
function CopilotButton({ card }: { card: Card }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!canAskCopilot(card)) return null;
  const ask = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/pulls/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: card.url }),
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
      <button type="button" class="board-review" disabled={busy} onClick={ask}>
        {busy ? "Asking Copilot…" : "Ask Copilot"}
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
          {(card.stage === "ci" || card.stage === "draft") && <span>{copilotNote(card)}</span>}
          <CopilotButton card={card} />
          <MoveButtons card={card} />
        </div>
      )}
    </li>
  );
}

/** Returns the board of the user's pull requests in state matching
 * query, as of now, a column for each stage. */
export function BoardView({ state, query, now }: { state: State; query: string; now: number }) {
  if (!state.board) {
    return <p class="empty">The board needs the watcher. Run <code>herdr-project --watch</code>.</p>;
  }
  const cards = state.board.filter((c) => recent(c, now) && matches(query, c.title, c.label, c.project));
  return (
    <main class="board">
      {STAGES.map(([stage, title]) => {
        const here = cards.filter((c) => c.stage === stage);
        const mine = MINE.includes(stage);
        return (
          <section key={stage} class="column board-column">
            <h2 class={mine ? (here.length > MINE_MAX ? "board-mine board-many" : "board-mine") : undefined}>
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
