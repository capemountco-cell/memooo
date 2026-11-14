import { useCallback, useEffect, useState } from "react";

import { HomeIcon } from "./components/Icons";
import { useRecording } from "./hooks/useRecording";
import { listNotes, onOpenNote, startNote, type NoteSummary } from "./lib/native";
import { Home } from "./views/Home";
import { NoteView } from "./views/NoteView";
import { CaptainWordmark } from "./components/CaptainWordmark";

type Route = { name: "home" } | { name: "note"; id: string };

/** The main window: a sidebar of recent notes, and home or one note. */
export function App() {
  const recording = useRecording();
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listNotes()
      .then(setNotes)
      .catch((cause: unknown) => setError(String(cause)));
  }, []);

  useEffect(refresh, [refresh, recording.noteId]);

  useEffect(() => {
    const unlisten = onOpenNote((id) => {
      refresh();
      setRoute({ name: "note", id });
    });
    return () => void unlisten.then((stop) => stop());
  }, [refresh]);

  const start = async () => {
    setError(null);
    try {
      const note = await startNote();
      refresh();
      setRoute({ name: "note", id: note.id });
    } catch (cause) {
      setError(String(cause));
    }
  };

  const open = (id: string) => setRoute({ name: "note", id });
  const home = () => {
    refresh();
    setRoute({ name: "home" });
  };

  return (
    <div className="app">
      <aside className="sidebar drag" data-tauri-drag-region>
        <div className="wordmark">
          <CaptainWordmark height={34} />
        </div>
        <nav className="nav" aria-label="Main">
          <button
            type="button"
            className="nav-item"
            aria-current={route.name === "home" ? "page" : undefined}
            onClick={home}
          >
            <HomeIcon />
            Home
          </button>
        </nav>
        {notes.length > 0 && (
          <div className="nav-recent">
            <div className="label">Recent</div>
            {notes.slice(0, 12).map((note) => (
              <button
                key={note.id}
                type="button"
                className="nav-item"
                aria-current={route.name === "note" && route.id === note.id ? "page" : undefined}
                onClick={() => open(note.id)}
              >
                {note.id === recording.noteId && <span className="rec-dot" />}
                <span className="nav-title">{note.title}</span>
              </button>
            ))}
          </div>
        )}
      </aside>

      {route.name === "home" ? (
        <Home notes={notes} recording={recording} onStart={start} onOpen={open} />
      ) : (
        <NoteView
          key={route.id}
          id={route.id}
          recording={recording}
          onBack={home}
          onChanged={refresh}
          onDeleted={home}
        />
      )}

      {error && (
        <p className="error-banner" role="alert" style={{ position: "fixed", right: 24, bottom: 24, margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
