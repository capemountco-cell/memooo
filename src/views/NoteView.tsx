import { useEffect, useRef, useState } from "react";

import { BackIcon, PauseIcon, PlayIcon, PopOutIcon } from "../components/Icons";
import { Waveform } from "../components/Waveform";
import { useCapture } from "../hooks/useCapture";
import { clock, dayLabel, length } from "../lib/format";
import {
  deleteNote,
  getNote,
  noteMarkdown,
  saveNote,
  showMini,
  stopNote,
  togglePause,
  type Note,
  type RecordingStatus,
} from "../lib/native";

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
  const pending = useRef<Note | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const live = recording.noteId === id;
  const capture = useCapture(live && !recording.paused, live ? id : null, recording.elapsedSecs, 28);
  const { levels, mic } = capture;

  useEffect(() => {
    setNote(null);
    setError(null);
    getNote(id)
      .then((loaded) => {
        setNote(loaded);
        setView(loaded.enhanced ? "written" : "mine");
      })
      .catch((cause: unknown) => setError(String(cause)));
  }, [id]);

  // Reload after the recording stops, so the saved length shows.
  useEffect(() => {
    if (!live && note) getNote(id).then((fresh) => setNote((current) => ({ ...fresh, ...pendingEdits(current) })));
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
                <Waveform levels={levels} height={18} />
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
              <button type="button" className="icon-btn" aria-label="Pop out mini widget" onClick={() => run(showMini)}>
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
            {note.enhanced && (
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

          {error && <p className="error-banner">{error}</p>}

          {view === "written" && note.enhanced ? (
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
                  <strong>{line.speaker}</strong>
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
            <span className="label">{micLabel(mic, recording.paused, capture.transcript)}</span>
          </div>
          {capture.error && <p className="hint" style={{ margin: 0, color: "var(--rec-ink)" }}>{capture.error}</p>}
          {capture.lines.map((line, index) => (
            <p key={`${line.startSecs}-${index}`} className="transcript-line">
              <strong>{line.speaker}</strong>
              <span>{line.text}</span>
            </p>
          ))}
          {capture.interim && (
            <p className="transcript-line interim">
              <strong>…</strong>
              <span>{capture.interim}</span>
            </p>
          )}
          {!capture.error && capture.lines.length === 0 && !capture.interim && (
            <p className="hint" style={{ margin: 0 }}>
              {capture.transcript === "live" ? "Listening. Words appear here as people speak." : "Connecting to transcription…"}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function pendingEdits(current: Note | null): Partial<Note> {
  if (!current) return {};
  return { title: current.title, myNotes: current.myNotes };
}

function micLabel(state: string, paused: boolean, transcript: string): string {
  if (paused) return "Paused";
  switch (state) {
    case "live":
      return transcript === "live" ? "Live transcript · your Mac’s microphone · no bot" : "Listening · your Mac’s microphone";
    case "asking":
      return "Asking for the microphone…";
    case "denied":
      return "Microphone blocked: allow Memo in System Settings › Privacy";
    case "unavailable":
      return "No microphone found";
    default:
      return "Recording";
  }
}
