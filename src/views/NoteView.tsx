import { useEffect, useRef, useState } from "react";

import { BackIcon, PauseIcon, PlayIcon, PopOutIcon } from "../components/Icons";
import { SpeakerChip } from "../components/SpeakerChip";
import { clock, dayLabel, length } from "../lib/format";
import {
  deleteNote,
  getNote,
  noteMarkdown,
  saveNote,
  saveWriteup,
  showMini,
  stopNote,
  togglePause,
  type Note,
  type RecordingStatus,
  type Writeup,
} from "../lib/native";
import { speakersOf } from "../lib/speakers";
import { hasMaterial, requestWriteup } from "../lib/writeup";

interface Props {
  id: string;
  recording: RecordingStatus;
  onBack: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}

/** Wait this long after the last keystroke before saving. */
const SAVE_DELAY_MS = 400;

export function NoteView({ id, recording, onBack, onChanged, onDeleted }: Props) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"mine" | "written">("mine");
  const [copied, setCopied] = useState(false);
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const wasLive = useRef(false);
  const pending = useRef<Note | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const live = recording.noteId === id;
  // Capture runs in the overlay during a call; here the transcript is read
  // back from the saved note as it grows.
  const [liveLines, setLiveLines] = useState<Note["transcript"]>([]);
  useEffect(() => {
    if (!live) return;
    let alive = true;
    const poll = () =>
      getNote(id)
        .then((fresh) => alive && setLiveLines(fresh.transcript.slice(-4)))
        .catch(() => undefined);
    poll();
    const timer = window.setInterval(poll, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [live, id]);

  useEffect(() => {
    setNote(null);
    setError(null);
    getNote(id)
      .then((loaded) => {
        setNote(loaded);
        setView(loaded.writeup || loaded.enhanced ? "written" : "mine");
      })
      .catch((cause: unknown) => setError(String(cause)));
  }, [id]);

  // When the recording stops: reload (for the saved length and transcript),
  // then write the meeting up straight away if there is anything to work with.
  useEffect(() => {
    const justStopped = wasLive.current && !live;
    wasLive.current = live;
    if (!justStopped || !note) return;
    void (async () => {
      await flush();
      const fresh = await getNote(id);
      setNote(fresh);
      if (hasMaterial(fresh) && !fresh.writeup) await writeUp();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const flush = async () => {
    window.clearTimeout(timer.current);
    const edits = pending.current;
    pending.current = null;
    if (!edits) return;
    try {
      await saveNote(edits);
      onChanged();
    } catch (cause) {
      setError(String(cause));
    }
  };

  // Save what's typed when leaving the note.
  useEffect(() => () => void flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (changes: Partial<Note>) => {
    setNote((current) => {
      if (!current) return current;
      const next = { ...current, ...changes };
      pending.current = next;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
      return next;
    });
  };

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await flush();
      await action();
    } catch (cause) {
      setError(String(cause));
    }
  };

  const writeUp = async () => {
    setWriteError(null);
    setWriting(true);
    try {
      await flush();
      const fresh = await getNote(id);
      if (!hasMaterial(fresh)) throw new Error("Write some notes or record the meeting first.");
      const writeup = await requestWriteup(fresh);
      const saved = await saveWriteup(id, writeup);
      setNote(saved);
      setView("written");
      onChanged();
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWriting(false);
    }
  };

  const copy = () =>
    run(async () => {
      await navigator.clipboard.writeText(await noteMarkdown(id));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });

  const remove = () =>
    run(async () => {
      if (!window.confirm("Delete this note? This can't be undone.")) return;
      await deleteNote(id);
      onDeleted();
    });

  if (!note) {
    return (
      <div className="main">
        <header className="topbar drag" data-tauri-drag-region>
          <button type="button" className="icon-btn" aria-label="Back to home" onClick={onBack}>
            <BackIcon />
          </button>
        </header>
        <div className="note">{error ? <p className="error-banner">{error}</p> : <p className="hint">Opening…</p>}</div>
      </div>
    );
  }

  return (
    <div className="main">
      <header className="topbar drag" data-tauri-drag-region>
        <button type="button" className="icon-btn" aria-label="Back to home" onClick={onBack}>
          <BackIcon />
        </button>
        <div className="topbar-actions">
          {live ? (
            <>
              <div className="rec-pill" data-paused={recording.paused}>
                <span className="rec-dot" />
                <span className="time">{clock(recording.elapsedSecs)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  style={{ width: 30, height: 30, background: "var(--stone)" }}
                  aria-label={recording.paused ? "Resume" : "Pause"}
                  onClick={() => run(togglePause)}
                >
                  {recording.paused ? <PlayIcon /> : <PauseIcon />}
                </button>
              </div>
              <button type="button" className="icon-btn" aria-label="Show the overlay" onClick={() => run(showMini)}>
                <PopOutIcon />
              </button>
              <button type="button" className="btn btn-primary" onClick={() => run(stopNote)}>
                Stop
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={remove}>
                Delete
              </button>
              <button type="button" className="btn btn-secondary" onClick={copy}>
                {copied ? "Copied" : "Copy as Markdown"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={writing || !hasMaterial(note)}
                onClick={() => void writeUp()}
              >
                {writing ? "Writing up…" : note.writeup ? "Write up again" : "Write up"}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="scroll">
        <article className="note">
          <label className="visually-hidden" htmlFor="title">
            Title
          </label>
          <input
            id="title"
            className="title-input"
            value={note.title === "Untitled meeting" ? "" : note.title}
            placeholder="Untitled meeting"
            onChange={(event) => edit({ title: event.target.value || "Untitled meeting" })}
          />

          <div className="chips">
            <span className="chip">{dayLabel(note.createdAtMs)}</span>
            {note.durationSecs > 0 && !live && <span className="chip">{length(note.durationSecs)}</span>}
            {(note.writeup || note.enhanced) && (
              <div className="segmented" role="group" aria-label="Which version">
                <button type="button" aria-pressed={view === "mine"} onClick={() => setView("mine")}>
                  My notes
                </button>
                <button type="button" aria-pressed={view === "written"} onClick={() => setView("written")}>
                  Written up
                </button>
              </div>
            )}
          </div>

          {note.transcript.length > 0 && (
            <div className="people" aria-label="People in this meeting">
              {speakersOf(note.transcript).map((name) => (
                <SpeakerChip key={name} name={name} />
              ))}
            </div>
          )}

          {error && <p className="error-banner">{error}</p>}
          {writeError && <p className="error-banner">{writeError}</p>}
          {writing && (
            <p className="hint writing" role="status">
              Writing up your notes and the transcript…
            </p>
          )}

          {view === "written" && note.writeup ? (
            <WriteupView writeup={note.writeup} />
          ) : view === "written" && note.enhanced ? (
            <div className="prose">{note.enhanced}</div>
          ) : (
            <>
              <label className="label" htmlFor="notes">
                Your notes
              </label>
              <textarea
                id="notes"
                className="notes-input"
                value={note.myNotes}
                placeholder={live ? "Jot down what matters to you…" : "Nothing written for this meeting."}
                autoFocus={live}
                onChange={(event) => edit({ myNotes: event.target.value })}
              />
            </>
          )}

          {!live && note.transcript.length > 0 && (
            <details className="transcript">
              <summary className="label">Transcript · {note.transcript.length} turns</summary>
              {note.transcript.map((line, index) => (
                <p key={`${line.startSecs}-${index}`} className="transcript-line">
                  <span className="who-col">
                    <SpeakerChip name={line.speaker} />
                  </span>
                  <span className="stamp">{clock(line.startSecs)}</span>
                  <span>{line.text}</span>
                </p>
              ))}
            </details>
          )}
        </article>
      </div>

      {live && (
        <section className="transcript-panel" aria-label="Live transcript" aria-live="polite">
          <div className="row">
            <span className="label">
              {recording.paused ? "Paused" : "Live transcript · in the overlay · hidden from screen sharing"}
            </span>
          </div>
          {liveLines.map((line, index) => (
            <p key={`${line.startSecs}-${index}`} className="transcript-line">
              <span className="who-col">
                <SpeakerChip name={line.speaker} />
              </span>
              <span>{line.text}</span>
            </p>
          ))}
          {liveLines.length === 0 && (
            <p className="hint" style={{ margin: 0 }}>
              Words appear here as people speak. Ask Memo for help from the overlay or with ⌘↵.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

/** The write-up: the user's points in ink, Memo's additions in grey. */
function WriteupView({ writeup }: { writeup: Writeup }) {
  const items = writeup.actionItems.filter((item) => item.task.trim());
  return (
    <div className="writeup">
      {writeup.sections
        .filter((section) => section.points.some((point) => point.text.trim()))
        .map((section, index) => (
          <section key={`${section.heading}-${index}`}>
            <h2>{section.heading}</h2>
            <ul>
              {section.points
                .filter((point) => point.text.trim())
                .map((point, pointIndex) => (
                  <li key={pointIndex} className={point.fromYou ? "yours" : "added"}>
                    {point.text}
                  </li>
                ))}
            </ul>
          </section>
        ))}
      {items.length > 0 && (
        <section>
          <h2>Action items</h2>
          <ul className="actions">
            {items.map((item, index) => (
              <li key={index}>
                <span className="box" aria-hidden />
                <span className="task">{item.task}</span>
                {item.owner && <SpeakerChip name={item.owner} />}
                {item.due && <span className="who">{item.due}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="legend">
        <span className="swatch yours" aria-hidden /> Your notes
        <span className="swatch added" aria-hidden /> Added by Memo from the transcript
      </p>
    </div>
  );
}
