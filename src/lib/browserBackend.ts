/**
 * The stand-in for Rust when the UI runs in a browser tab (`npm run dev:web`)
 * or under test. It keeps notes in memory and mirrors the native commands'
 * shapes closely enough to design and click through every screen.
 */

import type { Note, NoteSummary, RecordingStatus } from "./native";

const notes = new Map<string, Note>();
let recording: { noteId: string; startedAt: number; pausedTotal: number; pausedSince: number | null } | null =
  null;
let seq = 0;

function emit(name: string, detail: unknown) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(`memo:${name}`, { detail }));
}

function status(): RecordingStatus {
  if (!recording) return { noteId: null, paused: false, elapsedSecs: 0 };
  const end = recording.pausedSince ?? Date.now();
  return {
    noteId: recording.noteId,
    paused: recording.pausedSince !== null,
    elapsedSecs: Math.max(0, Math.floor((end - recording.startedAt - recording.pausedTotal) / 1000)),
  };
}

function summary(note: Note): NoteSummary {
  const firstLine = note.myNotes.split("\n").find((line) => line.trim())?.trim();
  return {
    id: note.id,
    title: note.title !== "Untitled meeting" ? note.title : (firstLine ?? note.title),
    createdAtMs: note.createdAtMs,
    durationSecs: note.durationSecs,
    snippet: (note.enhanced ?? note.myNotes).split("\n").filter(Boolean).join(" · ").slice(0, 120),
    speakers: new Set(note.transcript.map((segment) => segment.speaker)).size,
  };
}

function get(id: string): Note {
  const note = notes.get(id);
  if (!note) throw new Error(`No note with id ${id}.`);
  return note;
}

function create(): Note {
  const now = Date.now();
  const note: Note = {
    id: `n${now.toString(16)}${(++seq).toString(16).padStart(4, "0")}`,
    title: "Untitled meeting",
    createdAtMs: now,
    updatedAtMs: now,
    durationSecs: 0,
    myNotes: "",
    transcript: [],
    enhanced: null,
    writeup: null,
  };
  notes.set(note.id, note);
  return note;
}

export async function browserBackend<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const id = args.id as string;
  const result = ((): unknown => {
    switch (command) {
      case "list_notes":
        return [...notes.values()]
          .sort((a, b) => b.createdAtMs - a.createdAtMs || b.id.localeCompare(a.id))
          .map(summary);
      case "get_note":
        return get(id);
      case "save_note": {
        const incoming = args.note as Note;
        const saved = { ...incoming, createdAtMs: get(incoming.id).createdAtMs, updatedAtMs: Date.now() };
        notes.set(saved.id, saved);
        return saved;
      }
      case "delete_note":
        get(id);
        notes.delete(id);
        return undefined;
      case "append_line": {
        const note = get(id);
        const line = String(args.line ?? "").trim();
        if (line) note.myNotes = note.myNotes ? `${note.myNotes.replace(/\n$/, "")}\n${line}` : line;
        return note;
      }
      case "append_segments": {
        const note = get(id);
        for (const segment of args.segments as Note["transcript"]) {
          if (segment.text.trim()) note.transcript.push({ ...segment, text: segment.text.trim() });
        }
        return note;
      }
      case "save_writeup": {
        const note = get(id);
        const writeup = args.writeup as NonNullable<Note["writeup"]>;
        note.writeup = writeup;
        note.enhanced = writeup.sections
          .map((section) => `### ${section.heading}\n${section.points.map((p) => `- ${p.text}`).join("\n")}`)
          .join("\n\n");
        if (note.title === "Untitled meeting" && writeup.title) note.title = writeup.title;
        return note;
      }
      case "note_markdown": {
        const note = get(id);
        return `# ${summary(note).title}\n\n## Notes\n\n${note.enhanced ?? note.myNotes}\n`;
      }
      case "recording_status":
        return status();
      case "start_note": {
        if (recording) throw new Error("A recording is already running.");
        const note = create();
        recording = { noteId: note.id, startedAt: Date.now(), pausedTotal: 0, pausedSince: null };
        emit("recording-changed", status());
        return note;
      }
      case "toggle_pause": {
        if (!recording) throw new Error("Nothing is being recorded.");
        if (recording.pausedSince === null) recording.pausedSince = Date.now();
        else {
          recording.pausedTotal += Date.now() - recording.pausedSince;
          recording.pausedSince = null;
        }
        emit("recording-changed", status());
        return status();
      }
      case "stop_note": {
        if (!recording) throw new Error("Nothing is being recorded.");
        const note = get(recording.noteId);
        note.durationSecs += status().elapsedSecs;
        recording = null;
        emit("recording-changed", status());
        return note;
      }
      case "show_main":
        if (args.noteId) emit("open-note", args.noteId);
        return undefined;
      case "show_mini":
      case "hide_mini":
      case "set_mini_collapsed":
        return undefined;
      default:
        throw new Error(`Unknown command ${command}.`);
    }
  })();
  return structuredClone(result) as T;
}

/** For tests: forget everything. */
export function resetBrowserBackend() {
  notes.clear();
  recording = null;
}
