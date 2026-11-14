import { useMemo, useState } from "react";

import { SearchIcon } from "../components/Icons";
import { dayLabel, greeting, length } from "../lib/format";
import type { NoteSummary, RecordingStatus } from "../lib/native";

interface Props {
  notes: NoteSummary[];
  recording: RecordingStatus;
  onStart: () => void;
  onOpen: (id: string) => void;
}

export function Home({ notes, recording, onStart, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const now = new Date();

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return notes;
    return notes.filter((note) => {
      const haystack = `${note.title} ${note.snippet}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [notes, query]);

  const busy = recording.noteId !== null;

  return (
    <div className="main">
      <header className="topbar drag" data-tauri-drag-region>
        <label className="search">
          <SearchIcon />
          <span className="visually-hidden">Search notes</span>
          <input
            type="search"
            placeholder="Search every meeting"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="topbar-actions">
          {busy ? (
            <button type="button" className="btn btn-primary" onClick={() => onOpen(recording.noteId!)}>
              <span className="rec-dot" />
              Back to recording
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={onStart}>
              <span className="rec-dot" />
              Start a note
            </button>
          )}
        </div>
      </header>

      <div className="scroll">
        <div className="home">
          <div>
            <div className="date">
              {now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            </div>
            <h1 className="page-title">{greeting(now)}</h1>
          </div>

          {!busy && (
            <section className="start-card" aria-label="Start a note">
              <div style={{ flex: 1 }}>
                <h2>Ready when your meeting is</h2>
                <p>
                  Start a note, type what matters to you, and Memo keeps time. Or use the Memo icon in the
                  menu bar.
                </p>
              </div>
              <button type="button" className="btn btn-primary" onClick={onStart}>
                Start
              </button>
            </section>
          )}

          <section aria-labelledby="recent">
            <h2 id="recent" className="label" style={{ margin: "0 0 10px" }}>
              {query ? `Matching “${query}”` : "Recent notes"}
            </h2>
            {shown.length === 0 ? (
              <p className="empty">
                {query ? "Nothing matches that yet." : "Your notes will appear here after your first meeting."}
              </p>
            ) : (
              <div className="note-list">
                {shown.map((note) => (
                  <button key={note.id} type="button" className="note-row" onClick={() => onOpen(note.id)}>
                    <span className="when">{dayLabel(note.createdAtMs, now).toUpperCase()}</span>
                    <span className="body">
                      <span className="title">{note.title}</span>
                      <span className="snippet">{note.snippet || "No notes yet"}</span>
                    </span>
                    <span className="meta">
                      {note.id === recording.noteId ? "Recording" : length(note.durationSecs)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
