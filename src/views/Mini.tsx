import { useCallback, useEffect, useRef, useState } from "react";

import { CollapseIcon, ExpandIcon, PauseIcon, PlayIcon } from "../components/Icons";
import { SpeakerChip } from "../components/SpeakerChip";
import { Waveform } from "../components/Waveform";
import { useCapture } from "../hooks/useCapture";
import { useRecording } from "../hooks/useRecording";
import { MODE_LABEL, streamAssist, type AssistMode } from "../lib/assist";
import { clock } from "../lib/format";
import {
  appendLine,
  captureScreen,
  getNote,
  hideMini,
  nativeAvailable,
  onAssistHotkey,
  setMiniCollapsed,
  showMain,
  startNote,
  stopNote,
  togglePause,
} from "../lib/native";

interface Answer {
  mode: AssistMode;
  question: string;
  text: string;
  done: boolean;
  error: string | null;
}

/**
 * The in-call overlay: a translucent panel above every app, left out of
 * screen shares. It runs the meeting's capture (mic, call audio, live
 * transcript), takes quick notes, and answers questions as they come up.
 * It shrinks to a pill when it would cover the call.
 */
export function Mini() {
  const recording = useRecording();
  const live = recording.noteId !== null;
  const [collapsed, setCollapsed] = useState(false);
  const [title, setTitle] = useState("");
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const capture = useCapture(live && !recording.paused, recording.noteId, recording.elapsedSecs, collapsed ? 12 : 40);

  useEffect(() => {
    // Natively the window is see-through with the desktop blurred behind it.
    // In a browser preview, paint a stand-in desktop so the glass shows.
    document.body.style.background = nativeAvailable() ? "transparent" : "#8e9886";
  }, []);

  useEffect(() => {
    if (!recording.noteId) return setTitle("");
    getNote(recording.noteId)
      .then((note) => setTitle(note.title === "Untitled meeting" ? "" : note.title))
      .catch(() => setTitle(""));
  }, [recording.noteId]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const collapse = (next: boolean) =>
    run(async () => {
      await setMiniCollapsed(next);
      setCollapsed(next);
    });

  const ask = useCallback(
    async (mode: AssistMode, question = "") => {
      if (!recording.noteId) return;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setAnswer({ mode, question, text: "", done: false, error: null });
      if (collapsed) {
        await setMiniCollapsed(false).catch(() => undefined);
        setCollapsed(false);
      }
      try {
        const note = await getNote(recording.noteId);
        const screenshot = mode === "screen" ? await captureScreen() : undefined;
        await streamAssist(
          { mode, note, question, screenshot },
          (text) => setAnswer((current) => (current && !controller.signal.aborted ? { ...current, text } : current)),
          controller.signal,
        );
        if (!controller.signal.aborted) setAnswer((current) => (current ? { ...current, done: true } : current));
      } catch (cause) {
        if (controller.signal.aborted) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        setAnswer((current) => (current ? { ...current, done: true, error: message } : current));
      }
    },
    [recording.noteId, collapsed],
  );

  // ⌘↵ anywhere on the Mac, while a call is on.
  useEffect(() => {
    const unlisten = onAssistHotkey(() => void ask("assist"));
    return () => void unlisten.then((stop) => stop());
  }, [ask]);

  const submit = (asNote: boolean) =>
    run(async () => {
      const text = input.trim();
      if (!text || !recording.noteId) return;
      setInput("");
      if (asNote) await appendLine(recording.noteId, text);
      else await ask("ask", text);
    });

  const latest = capture.lines[capture.lines.length - 1];

  if (collapsed) {
    return (
      <button type="button" className="ov-pill drag" data-tauri-drag-region onClick={() => collapse(false)}>
        {live && <span className="rec-dot" />}
        <span>{live ? clock(recording.elapsedSecs) : "memo"}</span>
        <Waveform levels={capture.levels} height={18} />
        <span className="ov-pill-expand" aria-label="Expand">
          <ExpandIcon />
        </span>
      </button>
    );
  }

  if (!live) {
    return (
      <div className="ov">
        <div className="ov-head drag" data-tauri-drag-region>
          <span className="ov-time">memo</span>
          <span className="ov-title">Not recording</span>
          <button type="button" className="ov-icon" aria-label="Close" onClick={() => run(hideMini)}>
            ✕
          </button>
        </div>
        <div className="ov-empty">
          <strong>Ready when your call is</strong>
          <span>Start a note and Memo listens to both sides, hidden from screen sharing.</span>
          <button
            type="button"
            className="ov-btn ov-btn-primary"
            onClick={() => run(async () => void (await startNote()))}
          >
            <span className="rec-dot" />
            Start a note
          </button>
          {error && <p className="ov-error">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="ov">
      <div className="ov-head drag" data-tauri-drag-region>
        <span className="rec-dot" style={recording.paused ? { background: "#b8bdaf" } : undefined} />
        <span className="ov-time">{clock(recording.elapsedSecs)}</span>
        <span className="ov-title">{recording.paused ? "Paused" : title || "Listening"}</span>
        <button
          type="button"
          className="ov-icon"
          aria-label={recording.paused ? "Resume" : "Pause"}
          onClick={() => run(togglePause)}
        >
          {recording.paused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <button type="button" className="ov-icon" aria-label="Shrink to a pill" onClick={() => collapse(true)}>
          <CollapseIcon />
        </button>
        <button type="button" className="ov-stop" onClick={() => run(stopNote)}>
          <span className="ov-stop-square" aria-hidden />
          Stop
        </button>
      </div>

      <div className="ov-live" aria-live="polite">
        <Waveform levels={capture.levels} height={22} />
        {capture.interim ? (
          <p className="ov-line ov-interim">{capture.interim}</p>
        ) : latest ? (
          <p className="ov-line">
            <SpeakerChip name={latest.speaker} />
            <span>{latest.text}</span>
          </p>
        ) : (
          <p className="ov-line ov-muted">
            {capture.transcript === "live" ? "Listening to your mic and the call…" : "Connecting…"}
          </p>
        )}
        {capture.callAudio === "unavailable" && capture.callAudioNote && (
          <p className="ov-note">{capture.callAudioNote}</p>
        )}
        {capture.error && <p className="ov-error">{capture.error}</p>}
      </div>

      <div className="ov-answer">
        {answer ? (
          <>
            <div className="ov-answer-label">
              {MODE_LABEL[answer.mode]}
              {answer.question && <span>: {answer.question}</span>}
              {answer.mode === "screen" && !answer.text && !answer.error && <span> · looking…</span>}
            </div>
            {answer.error ? (
              <p className="ov-error">{answer.error}</p>
            ) : (
              <p className="ov-answer-text">{answer.text || (answer.done ? "" : "Thinking…")}</p>
            )}
          </>
        ) : (
          <p className="ov-hint">
            Press <kbd>⌘</kbd>
            <kbd>↵</kbd> any time for help with what’s being said. Nobody else on the call can see this window.
          </p>
        )}
      </div>

      <div className="ov-actions">
        <button type="button" className="ov-chip" onClick={() => void ask("assist")}>
          ✦ Assist
        </button>
        <button type="button" className="ov-chip" onClick={() => void ask("say")}>
          What should I say?
        </button>
        <button type="button" className="ov-chip" onClick={() => void ask("screen")}>
          Look at my screen
        </button>
      </div>

      <form
        className="ov-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(false);
        }}
      >
        <label className="visually-hidden" htmlFor="ov-input">
          Ask Memo, or add a note
        </label>
        <input
          id="ov-input"
          value={input}
          placeholder="Ask a question, or ⌘↵ for help"
          autoComplete="off"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.metaKey) {
              event.preventDefault();
              void ask("assist");
            }
          }}
        />
        <div className="ov-composer-row">
          <button type="button" className="ov-btn" disabled={!input.trim()} onClick={() => void submit(true)}>
            + Note
          </button>
          <button type="button" className="ov-btn" onClick={() => run(() => showMain(recording.noteId!))}>
            Open note
          </button>
          <button type="submit" className="ov-send" aria-label="Ask" disabled={!input.trim()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M7 5v14l12-7z" />
            </svg>
          </button>
        </div>
      </form>
      {error && <p className="ov-error">{error}</p>}
    </div>
  );
}
