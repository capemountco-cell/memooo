//! Turning a note into Markdown for copying, emailing or saving.

use crate::note::Note;
use crate::recording::clock;

/// The note as Markdown: title, the written-up notes (or the user's own), and
/// the transcript with timestamps.
pub fn to_markdown(note: &Note) -> String {
    let mut out = format!("# {}\n", note.display_title());
    if note.duration_secs > 0 {
        out.push_str(&format!("\n_Length: {}_\n", clock(note.duration_secs)));
    }

    let body = note
        .enhanced
        .as_deref()
        .filter(|text| !text.trim().is_empty())
        .unwrap_or(&note.my_notes)
        .trim();
    if !body.is_empty() {
        out.push_str("\n## Notes\n\n");
        out.push_str(body);
        out.push('\n');
    }

    if !note.transcript.is_empty() {
        out.push_str("\n## Transcript\n\n");
        for segment in &note.transcript {
            out.push_str(&format!(
                "**{}** [{}] {}\n\n",
                segment.speaker.trim(),
                clock(segment.start_secs),
                segment.text.trim()
            ));
        }
    }
    out.trim_end().to_string() + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::note::Segment;

    #[test]
    fn exports_title_notes_and_transcript() {
        let mut note = Note::new("a", 0);
        note.title = "Team stand-up".into();
        note.duration_secs = 1_680;
        note.my_notes = "- sam — prototype by weds\n".into();
        note.transcript = vec![Segment {
            speaker: "Sam".into(),
            start_secs: 65,
            text: " Ready by Wednesday. ".into(),
        }];
        assert_eq!(
            to_markdown(&note),
            "# Team stand-up\n\n_Length: 28:00_\n\n## Notes\n\n- sam — prototype by weds\n\n## Transcript\n\n**Sam** [1:05] Ready by Wednesday.\n"
        );
    }

    #[test]
    fn prefers_the_written_up_version_and_skips_empty_sections() {
        let mut note = Note::new("a", 0);
        note.title = "Design weekly".into();
        note.my_notes = "rough".into();
        note.enhanced = Some("## Design\n- polished".into());
        let markdown = to_markdown(&note);
        assert!(markdown.contains("polished"));
        assert!(!markdown.contains("rough"));
        assert!(!markdown.contains("Transcript"));
        assert!(!markdown.contains("Length"));
    }
}
