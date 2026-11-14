//! The app's logic.
//!
//! Everything that makes a decision lives here, not in the Tauri crate and not
//! in React. This crate does not depend on Tauri, so it builds and its tests
//! run on Linux in CI, without a window, a webview or a Mac.

pub mod audio;
pub mod export;
pub mod meeting;
pub mod note;
pub mod recording;
pub mod screen;
pub mod search;
pub mod store;
pub mod writeup;

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

/// Lines from the same speaker this close together (seconds) are one turn.
const SAME_TURN_GAP_SECS: u64 = 4;

/// Add finished transcript lines to a note. A line that continues the last
/// speaker's turn is joined onto it, so the transcript reads in turns rather
/// than in fragments. Blank lines are dropped.
pub fn append_segments(
    store: &mut NoteStore,
    id: &str,
    segments: Vec<Segment>,
    now_ms: u64,
) -> Result<Note, StoreError> {
    let mut note = store.get(id)?;
    let mut changed = false;
    for incoming in segments {
        let text = incoming.text.trim();
        if text.is_empty() {
            continue;
        }
        changed = true;
        match note.transcript.last_mut() {
            Some(last) if continues_turn(last, &incoming) => {
                last.text.push(' ');
                last.text.push_str(text);
            }
            _ => note.transcript.push(Segment {
                speaker: incoming.speaker,
                start_secs: incoming.start_secs,
                text: text.to_string(),
            }),
        }
    }
    if !changed {
        return Ok(note);
    }
    store.save(note, now_ms)
}

/// Same speaker, and either they barely paused or their last line did not
/// finish a sentence.
fn continues_turn(last: &Segment, incoming: &Segment) -> bool {
    last.speaker == incoming.speaker
        && (incoming.start_secs <= last.start_secs + SAME_TURN_GAP_SECS
            || !last.text.trim_end().ends_with(['.', '?', '!']))
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

    fn seg(speaker: &str, start_secs: u64, text: &str) -> Segment {
        Segment {
            speaker: speaker.into(),
            start_secs,
            text: text.into(),
        }
    }

    #[test]
    fn joins_a_speakers_turn_and_splits_on_a_new_speaker() {
        let mut store = store("segments");
        let note = store.create(1).unwrap();
        let note = append_segments(
            &mut store,
            &note.id,
            vec![
                seg("Speaker 1", 0, "The prototype should be"),
                seg("Speaker 1", 9, "ready by Wednesday."),
                seg("Speaker 2", 11, "Great."),
                seg("Speaker 2", 30, "Luke, anything blocking you?"),
                seg("Speaker 1", 33, "  "),
            ],
            2,
        )
        .unwrap();
        assert_eq!(
            note.transcript,
            vec![
                seg(
                    "Speaker 1",
                    0,
                    "The prototype should be ready by Wednesday."
                ),
                seg("Speaker 2", 11, "Great."),
                seg("Speaker 2", 30, "Luke, anything blocking you?"),
            ]
        );
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
