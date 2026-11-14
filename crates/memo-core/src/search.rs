//! Finding what past meetings said about a question.
//!
//! When someone asks a question in a call, the overlay looks for an answer in
//! the user's own past notes before anything goes to the AI. This is a plain
//! keyword search, run on the Mac over the note store: each note is cut into
//! short passages (a write-up point, an action item, a typed line, a few turns
//! of transcript), passages are scored by how many of the question's words
//! they contain, and the best few come back with the note they belong to, so
//! the answer can cite them and the user can open the meeting.

use serde::Serialize;

use crate::note::Note;

/// One passage from a past note that matches the question.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub note_id: String,
    pub note_title: String,
    pub created_at_ms: u64,
    /// The matching passage, trimmed to [`PASSAGE_CHARS`].
    pub text: String,
    /// How many distinct question words the passage contains.
    pub score: usize,
}

/// Longest passage handed to the AI.
pub const PASSAGE_CHARS: usize = 420;
/// Turns of transcript per passage.
const TURNS_PER_PASSAGE: usize = 3;
/// At most this many passages from any one note.
const PER_NOTE: usize = 2;

/// Words that carry no meaning for matching.
const STOPWORDS: &[&str] = &[
    "a", "about", "after", "again", "all", "also", "am", "an", "and", "any", "are", "as", "at",
    "back", "be", "because", "been", "before", "being", "but", "by", "can", "could", "did", "do",
    "does", "doing", "done", "for", "from", "get", "got", "had", "has", "have", "having", "he",
    "her", "here", "him", "his", "how", "i", "if", "in", "into", "is", "it", "its", "just", "know",
    "last", "let", "like", "me", "more", "my", "need", "no", "not", "now", "of", "on", "once",
    "one", "or", "our", "out", "over", "really", "remember", "said", "say", "she", "should", "so",
    "some", "than", "that", "the", "their", "them", "then", "there", "these", "they", "think",
    "this", "those", "time", "to", "too", "up", "us", "very", "want", "was", "we", "were", "what",
    "when", "where", "which", "while", "who", "whom", "why", "will", "with", "would", "yeah",
    "yes", "you", "your",
];

/// The question's meaningful words, lower case, without repeats.
pub fn keywords(question: &str) -> Vec<String> {
    let mut words: Vec<String> = Vec::new();
    for word in tokens(question) {
        if word.chars().count() < 2 || STOPWORDS.contains(&word.as_str()) {
            continue;
        }
        let word = stem(&word);
        if !words.contains(&word) {
            words.push(word);
        }
    }
    words
}

/// Search `notes` for passages about `question`, best first. The note being
/// recorded (`exclude_id`) is left out: its transcript is sent separately.
pub fn search_notes(
    notes: &[Note],
    question: &str,
    exclude_id: Option<&str>,
    limit: usize,
) -> Vec<SearchHit> {
    let terms = keywords(question);
    if terms.is_empty() || limit == 0 {
        return Vec::new();
    }
    // A passage must share at least a third of the question's words (and at
    // least one), so a single common word does not count as an answer.
    let needed = terms.len().div_ceil(3).max(1);

    let mut hits: Vec<SearchHit> = Vec::new();
    for note in notes {
        if Some(note.id.as_str()) == exclude_id {
            continue;
        }
        let mut found: Vec<SearchHit> = passages(note)
            .into_iter()
            .filter_map(|text| {
                let score = score(&text, &terms);
                (score >= needed).then(|| SearchHit {
                    note_id: note.id.clone(),
                    note_title: note.display_title(),
                    created_at_ms: note.created_at_ms,
                    text: trim(&text),
                    score,
                })
            })
            .collect();
        found.sort_by_key(|hit| std::cmp::Reverse(hit.score));
        found.dedup_by(|a, b| a.text == b.text);
        hits.extend(found.into_iter().take(PER_NOTE));
    }
    // Best match first; among equals, the more recent meeting.
    hits.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then(b.created_at_ms.cmp(&a.created_at_ms))
    });
    hits.truncate(limit);
    hits
}

/// A note cut into the pieces a question could be answered from.
fn passages(note: &Note) -> Vec<String> {
    let mut out = Vec::new();
    let title = note.display_title();
    if let Some(writeup) = &note.writeup {
        for section in &writeup.sections {
            for point in &section.points {
                out.push(format!("{}: {}", section.heading, point.text));
            }
        }
        for item in &writeup.action_items {
            let owner = if item.owner.is_empty() {
                String::new()
            } else {
                format!(" ({})", item.owner)
            };
            let due = if item.due.is_empty() {
                String::new()
            } else {
                format!(", due {}", item.due)
            };
            out.push(format!("Action item: {}{owner}{due}", item.task));
        }
    }
    for line in note
        .my_notes
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        out.push(format!("{title} notes: {line}"));
    }
    for window in note.transcript.chunks(TURNS_PER_PASSAGE) {
        let text = window
            .iter()
            .map(|segment| format!("{}: {}", segment.speaker, segment.text))
            .collect::<Vec<_>>()
            .join(" ");
        out.push(text);
    }
    out
}

fn score(text: &str, terms: &[String]) -> usize {
    let words: Vec<String> = tokens(text).map(|word| stem(&word)).collect();
    terms
        .iter()
        .filter(|term| words.iter().any(|word| word == *term))
        .count()
}

fn tokens(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
}

/// Fold simple English plurals so "trials" finds "trial".
fn stem(word: &str) -> String {
    if word.chars().count() >= 4 {
        if let Some(base) = word.strip_suffix("ies") {
            return format!("{base}y");
        }
        if let Some(base) = word.strip_suffix('s') {
            if !base.ends_with('s') {
                return base.to_string();
            }
        }
    }
    word.to_string()
}

fn trim(text: &str) -> String {
    if text.chars().count() <= PASSAGE_CHARS {
        return text.to_string();
    }
    let cut: String = text.chars().take(PASSAGE_CHARS).collect();
    format!("{}…", cut.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::note::Segment;
    use crate::writeup::{ActionItem, Point, Section, Writeup};

    fn note(id: &str, at: u64, title: &str) -> Note {
        let mut note = Note::new(id, at);
        note.title = title.to_string();
        note
    }

    fn said(speaker: &str, text: &str) -> Segment {
        Segment {
            speaker: speaker.into(),
            start_secs: 0,
            text: text.into(),
        }
    }

    #[test]
    fn keywords_drop_filler_and_fold_plurals() {
        assert_eq!(
            keywords("Why did we pick 14 days back then?"),
            vec!["pick", "14", "day"]
        );
        assert_eq!(keywords("What are the free trials?"), vec!["free", "trial"]);
        assert!(keywords("what did you say?").is_empty());
    }

    #[test]
    fn finds_the_write_up_point_and_names_its_meeting() {
        let mut pricing = note("n1", 100, "Pricing");
        pricing.writeup = Some(Writeup {
            title: "Pricing".into(),
            sections: vec![Section {
                heading: "Free trial".into(),
                points: vec![Point {
                    text: "We cut the free trial to 14 days.".into(),
                    from_you: false,
                }],
            }],
            action_items: vec![],
        });
        let other = note("n2", 200, "Hiring");
        let hits = search_notes(
            &[pricing, other],
            "Why did we pick a 14 day free trial?",
            None,
            5,
        );
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].note_id, "n1");
        assert_eq!(hits[0].note_title, "Pricing");
        assert!(hits[0].text.contains("14 days"));
    }

    #[test]
    fn searches_typed_notes_transcript_and_action_items() {
        let mut a = note("a", 100, "Stand-up");
        a.my_notes = "staging keys blocked on infra".into();
        a.transcript = vec![said(
            "Speaker 2",
            "The retry limit is three because cards block the fourth.",
        )];
        a.writeup = Some(Writeup {
            title: String::new(),
            sections: vec![],
            action_items: vec![ActionItem {
                task: "Renew the Acme contract".into(),
                owner: "Sam".into(),
                due: "March".into(),
            }],
        });
        let notes = [a];
        assert_eq!(
            search_notes(&notes, "Who is blocked on staging keys?", None, 3)[0].text,
            "Stand-up notes: staging keys blocked on infra"
        );
        assert!(
            search_notes(&notes, "why is the retry limit three?", None, 3)[0]
                .text
                .contains("fourth")
        );
        assert!(search_notes(&notes, "when do we renew Acme?", None, 3)[0]
            .text
            .contains("Sam"));
    }

    #[test]
    fn leaves_out_the_meeting_being_recorded_and_weak_matches() {
        let mut live = note("live", 300, "Now");
        live.my_notes = "free trial length".into();
        let mut old = note("old", 100, "Old");
        old.my_notes = "lunch was free".into();
        // "free" alone is one word of three: not enough to count.
        let hits = search_notes(
            &[live, old],
            "how long is the free trial period?",
            Some("live"),
            5,
        );
        assert!(hits.is_empty(), "{hits:?}");
    }

    #[test]
    fn best_match_first_then_newest_and_at_most_two_per_note() {
        let mut older = note("older", 100, "Older");
        older.my_notes = "trial length 30 days\ntrial length 14 days\ntrial length again\ntrial length once more".into();
        let mut newer = note("newer", 200, "Newer");
        newer.my_notes = "trial length".into();
        let hits = search_notes(&[older, newer], "trial length?", None, 10);
        assert_eq!(hits.iter().filter(|hit| hit.note_id == "older").count(), 2);
        assert_eq!(hits[0].note_id, "newer");
    }

    #[test]
    fn long_passages_are_trimmed() {
        let mut long = note("l", 1, "Long");
        long.my_notes = format!("budget {}", "word ".repeat(200));
        let hit = &search_notes(&[long], "budget?", None, 1)[0];
        assert!(hit.text.chars().count() <= PASSAGE_CHARS + 1);
        assert!(hit.text.ends_with('…'));
    }
}
