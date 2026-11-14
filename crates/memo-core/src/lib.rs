//! The app's logic.
//!
//! Everything that makes a decision lives here, not in the Tauri crate and not
//! in React. This crate does not depend on Tauri, so it builds and its tests
//! run on Linux in CI, without a window, a webview or a Mac.

pub mod export;
pub mod meeting;
pub mod note;
pub mod recording;
pub mod store;

pub use note::{Note, NoteSummary, Segment};
pub use recording::{clock, Recorder, RecordingError, RecordingStatus};
pub use store::{NoteStore, StoreError};

/// Anything that can go wrong starting or stopping a recorded note.
#[derive(Debug)]
pub enum SessionError {
    Store(StoreError),
    Recording(RecordingError),
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Store(error) => error.fmt(f),
            Self::Recording(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for SessionError {}

impl From<StoreError> for SessionError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

impl From<RecordingError> for SessionError {
    fn from(error: RecordingError) -> Self {
        Self::Recording(error)
    }
}

/// Create a note and start recording into it. Refuses, creating nothing, when
/// a recording is already running.
pub fn start_new_note(
    store: &mut NoteStore,
    recorder: &mut Recorder,
    now_ms: u64,
) -> Result<Note, SessionError> {
    if recorder.status(now_ms).note_id.is_some() {
        return Err(RecordingError::AlreadyRecording.into());
    }
    let note = store.create(now_ms)?;
    recorder.start(note.id.clone(), now_ms)?;
    Ok(note)
}

/// Stop the running recording and save its length on the note. A note
/// recorded in several sittings keeps the total.
pub fn stop_recording(
    store: &mut NoteStore,
    recorder: &mut Recorder,
    now_ms: u64,
) -> Result<Note, SessionError> {
    let (id, secs) = recorder.stop(now_ms)?;
    let previous = store.get(&id)?.duration_secs;
    Ok(store.set_duration(&id, previous + secs, now_ms)?)
}

/// Add one line, typed in the menu bar or mini widget, to the end of a note.
pub fn append_line(
    store: &mut NoteStore,
    id: &str,
    line: &str,
    now_ms: u64,
) -> Result<Note, StoreError> {
    let line = line.trim();
    let mut note = store.get(id)?;
    if line.is_empty() {
        return Ok(note);
    }
    if !note.my_notes.is_empty() && !note.my_notes.ends_with('\n') {
        note.my_notes.push('\n');
    }
    note.my_notes.push_str(line);
    store.save(note, now_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(name: &str) -> NoteStore {
        let path = std::env::temp_dir().join(format!(
            "memo-core-session-{name}-{}.json",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        NoteStore::open(path).unwrap()
    }

    #[test]
    fn start_then_stop_records_the_length() {
        let mut store = store("start-stop");
        let mut recorder = Recorder::default();
        let note = start_new_note(&mut store, &mut recorder, 1_000).unwrap();
        assert_eq!(recorder.status(2_000).note_id, Some(note.id.clone()));
        let stopped = stop_recording(&mut store, &mut recorder, 91_000).unwrap();
        assert_eq!(stopped.duration_secs, 90);
        assert_eq!(recorder.status(92_000).note_id, None);
        let _ = std::fs::remove_file(store.path());
    }

    #[test]
    fn a_second_start_creates_nothing() {
        let mut store = store("double-start");
        let mut recorder = Recorder::default();
        start_new_note(&mut store, &mut recorder, 1).unwrap();
        assert!(start_new_note(&mut store, &mut recorder, 2).is_err());
        assert_eq!(store.list().len(), 1);
        let _ = std::fs::remove_file(store.path());
    }

    #[test]
    fn appends_lines_without_blank_gaps() {
        let mut store = store("append");
        let note = store.create(1).unwrap();
        append_line(&mut store, &note.id, "  first ", 2).unwrap();
        append_line(&mut store, &note.id, "", 3).unwrap();
        let note = append_line(&mut store, &note.id, "second", 4).unwrap();
        assert_eq!(note.my_notes, "first\nsecond");
        let _ = std::fs::remove_file(store.path());
    }
}
