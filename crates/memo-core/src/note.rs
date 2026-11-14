//! A meeting note: what you typed, what was said, and when.

use serde::{Deserialize, Serialize};

/// Title used until the user (or the calendar) names the note.
pub const UNTITLED: &str = "Untitled meeting";

/// One line of transcript.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    /// Who spoke: "You", a participant's name, or "Speaker 2".
    pub speaker: String,
    /// Seconds from the start of the recording.
    pub start_secs: u64,
    pub text: String,
}

/// A complete note, as stored on disk and sent to the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    /// Unix time, milliseconds.
    pub created_at_ms: u64,
    /// Unix time, milliseconds. Bumped on every save.
    pub updated_at_ms: u64,
    pub duration_secs: u64,
    /// What the user typed during the meeting, as plain text, one line per thought.
    #[serde(default)]
    pub my_notes: String,
    #[serde(default)]
    pub transcript: Vec<Segment>,
    /// The written-up version as Markdown, once Memo has merged notes and transcript.
    #[serde(default)]
    pub enhanced: Option<String>,
    /// The same write-up with its structure: which points are the user's.
    #[serde(default)]
    pub writeup: Option<crate::writeup::Writeup>,
}

/// The light version of a note for lists: no transcript, no full text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    pub created_at_ms: u64,
    pub duration_secs: u64,
    pub snippet: String,
    pub speakers: usize,
}

/// Longest snippet shown in a list row.
const SNIPPET_CHARS: usize = 120;

impl Note {
    /// A fresh, empty note.
    pub fn new(id: impl Into<String>, now_ms: u64) -> Self {
        Self {
            id: id.into(),
            title: UNTITLED.to_string(),
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
            duration_secs: 0,
            my_notes: String::new(),
            transcript: Vec::new(),
            enhanced: None,
            writeup: None,
        }
    }

    /// The title to show: the user's, else the first line they typed, else
    /// "Untitled meeting".
    pub fn display_title(&self) -> String {
        let own = self.title.trim();
        if !own.is_empty() && own != UNTITLED {
            return own.to_string();
        }
        first_line(&self.my_notes).unwrap_or_else(|| UNTITLED.to_string())
    }

    /// A one-line preview: the written-up text, else the user's notes, else
    /// the transcript.
    pub fn snippet(&self) -> String {
        let source = self
            .enhanced
            .as_deref()
            .filter(|text| !text.trim().is_empty())
            .map(str::to_string)
            .or_else(|| Some(self.my_notes.clone()).filter(|text| !text.trim().is_empty()))
            .unwrap_or_else(|| {
                self.transcript
                    .iter()
                    .map(|segment| segment.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            });
        let flat = source
            .lines()
            .map(|line| line.trim().trim_start_matches(['-', '*', '•', '#']).trim())
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join(" · ");
        truncate(&flat, SNIPPET_CHARS)
    }

    /// Number of distinct people heard in the transcript.
    pub fn speaker_count(&self) -> usize {
        let mut names: Vec<&str> = self
            .transcript
            .iter()
            .map(|segment| segment.speaker.as_str())
            .collect();
        names.sort_unstable();
        names.dedup();
        names.len()
    }

    pub fn summary(&self) -> NoteSummary {
        NoteSummary {
            id: self.id.clone(),
            title: self.display_title(),
            created_at_ms: self.created_at_ms,
            duration_secs: self.duration_secs,
            snippet: self.snippet(),
            speakers: self.speaker_count(),
        }
    }
}

fn first_line(text: &str) -> Option<String> {
    text.lines()
        .map(|line| line.trim().trim_start_matches(['-', '*', '•', '#']).trim())
        .find(|line| !line.is_empty())
        .map(|line| truncate(line, 60))
}

/// Cut at a character boundary and add an ellipsis when anything was cut.
fn truncate(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let cut: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{}…", cut.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(speaker: &str, text: &str) -> Segment {
        Segment {
            speaker: speaker.into(),
            start_secs: 0,
            text: text.into(),
        }
    }

    #[test]
    fn new_note_is_untitled_and_empty() {
        let note = Note::new("a", 1_000);
        assert_eq!(note.display_title(), UNTITLED);
        assert_eq!(note.snippet(), "");
        assert_eq!(note.speaker_count(), 0);
    }

    #[test]
    fn title_falls_back_to_first_typed_line() {
        let mut note = Note::new("a", 0);
        note.my_notes = "\n  - ship date for calendar sync?\nsam — prototype".into();
        assert_eq!(note.display_title(), "ship date for calendar sync?");
        note.title = "Team stand-up".into();
        assert_eq!(note.display_title(), "Team stand-up");
    }

    #[test]
    fn snippet_prefers_enhanced_then_notes_then_transcript() {
        let mut note = Note::new("a", 0);
        note.transcript = vec![segment("Sam", "Prototype by Wednesday.")];
        assert_eq!(note.snippet(), "Prototype by Wednesday.");
        note.my_notes = "- first\n- second".into();
        assert_eq!(note.snippet(), "first · second");
        note.enhanced = Some("# Design\n• Sam owns it".into());
        assert_eq!(note.snippet(), "Design · Sam owns it");
    }

    #[test]
    fn snippet_is_truncated_on_a_char_boundary() {
        let mut note = Note::new("a", 0);
        note.my_notes = "é".repeat(500);
        let snippet = note.snippet();
        assert_eq!(snippet.chars().count(), SNIPPET_CHARS);
        assert!(snippet.ends_with('…'));
    }

    #[test]
    fn counts_distinct_speakers() {
        let mut note = Note::new("a", 0);
        note.transcript = vec![
            segment("Sam", "a"),
            segment("You", "b"),
            segment("Sam", "c"),
        ];
        assert_eq!(note.speaker_count(), 2);
        assert_eq!(note.summary().speakers, 2);
    }

    #[test]
    fn serialises_in_camel_case_and_tolerates_missing_fields() {
        let json = r#"{"id":"a","title":"T","createdAtMs":1,"updatedAtMs":2,"durationSecs":3}"#;
        let note: Note = serde_json::from_str(json).expect("old notes still load");
        assert_eq!(note.my_notes, "");
        assert!(note.transcript.is_empty());
        let back = serde_json::to_string(&note).unwrap();
        assert!(back.contains("\"myNotes\""));
    }
}
