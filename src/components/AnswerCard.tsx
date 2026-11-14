import { citationParts, sourceDate } from "../lib/answers";
import type { LiveAnswer } from "../hooks/useLiveAnswers";

interface Props {
  answer: LiveAnswer;
  onOpenNote: (id: string) => void;
  onAskAnyway: (question: string) => void;
  onDismiss: () => void;
}

/**
 * The answer under a question in the overlay: the answer with numbered
 * sources the user can open, or a plain "Nothing certain found" when the
 * sources don't say. It never shows a guess.
 */
export function AnswerCard({ answer, onOpenNote, onAskAnyway, onDismiss }: Props) {
  if (answer.state === "looking") {
    return (
      <section className="ov-card ov-card-quiet" aria-live="polite" aria-label="Looking for an answer">
        <p className="ov-card-label">Looking in this meeting and your notes…</p>
      </section>
    );
  }

  if (answer.state === "failed") {
    return (
      <section className="ov-card ov-card-quiet" aria-label="Answer unavailable">
        <p className="ov-error">{answer.error}</p>
        <div className="ov-card-actions">
          <button type="button" className="ov-chip" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </section>
    );
  }

  const { found, answer: text, sources, fromThisMeeting } = answer.answer;
  if (!found) {
    return (
      <section className="ov-card ov-card-quiet" aria-label="Nothing certain found">
        <p className="ov-card-title">Nothing certain found</p>
        <p className="ov-card-body">This meeting and your past notes don’t say, so Captain won’t guess.</p>
        <div className="ov-card-actions">
          <button type="button" className="ov-chip" onClick={() => onAskAnyway(answer.question)}>
            Ask anyway
          </button>
          <button type="button" className="ov-chip ov-chip-plain" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="ov-card" aria-label="Answer">
      <p className="ov-card-label">
        {sources.length ? "Answer from your meetings" : "Answer from this meeting"}
      </p>
      <p className="ov-card-answer">
        {citationParts(text).map((part, i) => (
          <span key={i}>
            {part.text}
            {part.refs.map((n) => (
              <sup key={n} className="ov-cite">
                {n}
              </sup>
            ))}
          </span>
        ))}
      </p>
      {(sources.length > 0 || fromThisMeeting) && (
        <div className="ov-sources">
          {sources.map(({ n, hit }) => (
            <button
              key={n}
              type="button"
              className="ov-source"
              title={hit.text}
              onClick={() => onOpenNote(hit.noteId)}
            >
              <span className="ov-source-n">{n}</span>
              {sourceDate(hit.createdAtMs)} · {hit.noteTitle}
            </button>
          ))}
          {fromThisMeeting && <span className="ov-source ov-source-here">Earlier in this meeting</span>}
        </div>
      )}
    </section>
  );
}
