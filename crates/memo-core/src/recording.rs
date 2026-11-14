//! The recording clock: one recording at a time, which can be paused.
//!
//! Times are passed in rather than read from the system clock, so every rule
//! here is testable.

use serde::{Deserialize, Serialize};

/// What the menu bar, mini widget and main window all show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    /// The note being recorded into, if any.
    pub note_id: Option<String>,
    pub paused: bool,
    /// Recorded time so far, excluding pauses.
    pub elapsed_secs: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Active {
    note_id: String,
    started_at_ms: u64,
    paused_total_ms: u64,
    paused_since_ms: Option<u64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Recorder {
    active: Option<Active>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecordingError {
    AlreadyRecording,
    NotRecording,
}

impl std::fmt::Display for RecordingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlreadyRecording => write!(f, "A recording is already running."),
            Self::NotRecording => write!(f, "Nothing is being recorded."),
        }
    }
}

impl std::error::Error for RecordingError {}

impl Recorder {
    pub fn start(&mut self, note_id: impl Into<String>, now_ms: u64) -> Result<(), RecordingError> {
        if self.active.is_some() {
            return Err(RecordingError::AlreadyRecording);
        }
        self.active = Some(Active {
            note_id: note_id.into(),
            started_at_ms: now_ms,
            paused_total_ms: 0,
            paused_since_ms: None,
        });
        Ok(())
    }

    /// Pause if running, resume if paused.
    pub fn toggle_pause(&mut self, now_ms: u64) -> Result<(), RecordingError> {
        let active = self.active.as_mut().ok_or(RecordingError::NotRecording)?;
        match active.paused_since_ms.take() {
            Some(since) => active.paused_total_ms += now_ms.saturating_sub(since),
            None => active.paused_since_ms = Some(now_ms),
        }
        Ok(())
    }

    /// Stop and return the note id and the recorded length in seconds.
    pub fn stop(&mut self, now_ms: u64) -> Result<(String, u64), RecordingError> {
        let elapsed = self.elapsed_secs(now_ms);
        let active = self.active.take().ok_or(RecordingError::NotRecording)?;
        Ok((active.note_id, elapsed))
    }

    pub fn elapsed_secs(&self, now_ms: u64) -> u64 {
        let Some(active) = &self.active else { return 0 };
        let end = active.paused_since_ms.unwrap_or(now_ms);
        end.saturating_sub(active.started_at_ms)
            .saturating_sub(active.paused_total_ms)
            / 1000
    }

    pub fn status(&self, now_ms: u64) -> RecordingStatus {
        RecordingStatus {
            note_id: self.active.as_ref().map(|active| active.note_id.clone()),
            paused: self
                .active
                .as_ref()
                .is_some_and(|active| active.paused_since_ms.is_some()),
            elapsed_secs: self.elapsed_secs(now_ms),
        }
    }
}

/// "4:05", or "1:02:03" past an hour. Used for the menu bar title.
pub fn clock(total_secs: u64) -> String {
    let (hours, minutes, seconds) = (total_secs / 3600, (total_secs / 60) % 60, total_secs % 60);
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_time_while_running() {
        let mut recorder = Recorder::default();
        recorder.start("n1", 10_000).unwrap();
        assert_eq!(recorder.elapsed_secs(75_500), 65);
        let status = recorder.status(75_500);
        assert_eq!(status.note_id.as_deref(), Some("n1"));
        assert!(!status.paused);
    }

    #[test]
    fn pauses_do_not_count() {
        let mut recorder = Recorder::default();
        recorder.start("n1", 0).unwrap();
        recorder.toggle_pause(10_000).unwrap();
        assert!(recorder.status(50_000).paused);
        assert_eq!(recorder.elapsed_secs(50_000), 10);
        recorder.toggle_pause(60_000).unwrap();
        assert_eq!(recorder.elapsed_secs(65_000), 15);
    }

    #[test]
    fn stop_returns_note_and_length_and_clears() {
        let mut recorder = Recorder::default();
        recorder.start("n1", 0).unwrap();
        assert_eq!(recorder.stop(42_000).unwrap(), ("n1".to_string(), 42));
        assert_eq!(recorder.status(50_000).note_id, None);
        assert_eq!(recorder.stop(1), Err(RecordingError::NotRecording));
    }

    #[test]
    fn one_recording_at_a_time() {
        let mut recorder = Recorder::default();
        recorder.start("n1", 0).unwrap();
        assert_eq!(
            recorder.start("n2", 1),
            Err(RecordingError::AlreadyRecording)
        );
        assert_eq!(
            Recorder::default().toggle_pause(0),
            Err(RecordingError::NotRecording)
        );
    }

    #[test]
    fn a_clock_that_goes_backwards_does_not_underflow() {
        let mut recorder = Recorder::default();
        recorder.start("n1", 10_000).unwrap();
        assert_eq!(recorder.elapsed_secs(5_000), 0);
    }

    #[test]
    fn formats_the_clock() {
        assert_eq!(clock(0), "0:00");
        assert_eq!(clock(768), "12:48");
        assert_eq!(clock(3_723), "1:02:03");
    }
}
