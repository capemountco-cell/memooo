import { useEffect, useState } from "react";

import { CloseIcon, CollapseIcon, ExpandIcon, PauseIcon, PlayIcon } from "../components/Icons";
import { Waveform } from "../components/Waveform";
import { useMicLevels } from "../hooks/useMicLevels";
import { useRecording } from "../hooks/useRecording";
import { clock } from "../lib/format";
import {
  appendLine,
  getNote,
  hideMini,
  setMiniCollapsed,
  showMain,
  startNote,
  stopNote,
  togglePause,
} from "../lib/native";

/**
 * The floating mini widget: its own small, always-on-top window. It shows the
 * live recording and takes quick notes, and shrinks to a pill when it would
 * cover the call.
 */
export function Mini() {
  const recording = useRecording();
  const [collapsed, setCollapsed] = useState(false);
  const [title, setTitle] = useState("");
  const [line, setLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const live = recording.noteId !== null;
  const { levels } = useMicLevels(live && !recording.paused, collapsed ? 10 : 36);

  useEffect(() => {
    // The window is opaque, so paint it charcoal edge to edge.
    document.body.style.background = "#2e332b";
  }, []);

  useEffect(() => {
    if (!recording.noteId) return setTitle("");
    getNote(recording.noteId)
      .then((note) => setTitle(note.title))
      .catch(() => setTitle(""));
  }, [recording.noteId]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(String(cause));
    }
  };

  const collapse = (next: boolean) =>
    run(async () => {
      await setMiniCollapsed(next);
      setCollapsed(next);
    });

  const addLine = () =>
    run(async () => {
      if (!recording.noteId || !line.trim()) return;
      await appendLine(recording.noteId, line);
      setLine("");
    });

  if (collapsed) {
    return (
      <button type="button" className="mini-pill drag" data-tauri-drag-region onClick={() => collapse(false)}>
        {live && <span className="rec-dot" />}
        <span>{live ? clock(recording.elapsedSecs) : "memo"}</span>
        <Waveform levels={levels} height={18} />
        <span
          className="icon-btn"
          style={{ width: 32, height: 32, borderRadius: "50%", background: "#3b4137", color: "#f4efe9", marginLeft: "auto" }}
          aria-label="Expand"
        >
          <ExpandIcon />
        </span>
      </button>
    );
  }

  return (
    <div className="mini">
      <div className="mini-head drag" data-tauri-drag-region>
        {live && <span className="rec-dot" style={recording.paused ? { background: "#b8bdaf" } : undefined} />}
        <span className="time">{live ? clock(recording.elapsedSecs) : "memo"}</span>
        <span className="name">
          {live ? (recording.paused ? "Paused" : title === "Untitled meeting" ? "Recording" : title) : "Not recording"}
        </span>
        <button type="button" className="icon-btn" aria-label="Collapse to pill" onClick={() => collapse(true)}>
          <CollapseIcon />
        </button>
        <button type="button" className="icon-btn" aria-label="Close mini widget" onClick={() => run(hideMini)}>
          <CloseIcon />
        </button>
      </div>

      {live ? (
        <>
          <Waveform levels={levels} height={34} />
          <form
            className="mini-input"
            onSubmit={(event) => {
              event.preventDefault();
              void addLine();
            }}
          >
            <label className="visually-hidden" htmlFor="quick">
              Quick note
            </label>
            <input id="quick" placeholder="Quick note…" value={line} onChange={(event) => setLine(event.target.value)} />
            <button type="submit" className="btn btn-sm mini btn-light" style={{ height: 30, padding: "0 10px" }}>
              Add
            </button>
          </form>
          {error && <p style={{ margin: 0, fontSize: 12, color: "#f0a898" }}>{error}</p>}
          <div className="mini-actions">
            <button type="button" className="btn btn-dark" onClick={() => run(togglePause)}>
              {recording.paused ? <PlayIcon /> : <PauseIcon />}
              {recording.paused ? "Resume" : "Pause"}
            </button>
            <button type="button" className="btn btn-dark" onClick={() => run(() => showMain(recording.noteId!))}>
              Open
            </button>
            <button type="button" className="btn btn-light" onClick={() => run(stopNote)}>
              Stop
            </button>
          </div>
        </>
      ) : (
        <div className="mini-idle">
          <strong>Nothing recording</strong>
          <span>Start a note and the timer, waveform and quick notes appear here.</span>
          <div className="mini-actions">
            <button
              type="button"
              className="btn btn-light"
              onClick={() =>
                run(async () => {
                  const note = await startNote();
                  await showMain(note.id);
                })
              }
            >
              <span className="rec-dot" />
              Start a note
            </button>
          </div>
          {error && <p style={{ margin: 0, fontSize: 12, color: "#f0a898" }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
