//! Memo's write-up of a meeting: the user's points and Memo's additions,
//! grouped by topic, plus action items.

use serde::{Deserialize, Serialize};

use crate::note::{Note, UNTITLED};
use crate::store::{NoteStore, StoreError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub text: String,
    /// True for the user's own note; false for what Memo added from the transcript.
    pub from_you: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub heading: String,
    pub points: Vec<Point>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionItem {
    pub task: String,
    /// A name, "You", or empty when nobody was named.
    #[serde(default)]
    pub owner: String,
    /// As said in the meeting ("Wednesday"), or empty.
    #[serde(default)]
    pub due: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Writeup {
    #[serde(default)]
    pub title: String,
    pub sections: Vec<Section>,
    #[serde(default)]
    pub action_items: Vec<ActionItem>,
}

/// The write-up as Markdown: sections as headed lists, then action items as
/// a checklist. Used for export, search snippets and copying.
pub fn to_markdown(writeup: &Writeup) -> String {
    let mut out = String::new();
    for section in &writeup.sections {
        let points: Vec<&Point> = section
            .points
            .iter()
            .filter(|point| !point.text.trim().is_empty())
            .collect();
        if points.is_empty() {
            continue;
        }
        out.push_str(&format!("### {}\n", section.heading.trim()));
        for point in points {
            out.push_str(&format!("- {}\n", point.text.trim()));
        }
        out.push('\n');
    }
    let items: Vec<&ActionItem> = writeup
        .action_items
        .iter()
        .filter(|item| !item.task.trim().is_empty())
        .collect();
    if !items.is_empty() {
        out.push_str("### Action items\n");
        for item in items {
            let mut line = format!("- [ ] {}", item.task.trim());
            let who_when: Vec<&str> = [item.owner.trim(), item.due.trim()]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect();
            if !who_when.is_empty() {
                line.push_str(&format!(" ({})", who_when.join(", ")));
            }
            out.push_str(&line);
            out.push('\n');
        }
    }
    out.trim_end().to_string()
}

/// Store a write-up on a note. The Markdown version becomes the note's
/// `enhanced` text, and an untitled note takes the write-up's title.
pub fn save_writeup(
    store: &mut NoteStore,
    id: &str,
    writeup: Writeup,
    now_ms: u64,
) -> Result<Note, StoreError> {
    let mut note = store.get(id)?;
    let suggested = writeup.title.trim();
    if (note.title.trim().is_empty() || note.title == UNTITLED) && !suggested.is_empty() {
        note.title = suggested.to_string();
    }
    note.enhanced = Some(to_markdown(&writeup));
    note.writeup = Some(writeup);
    store.save(note, now_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Writeup {
        Writeup {
            title: "Team stand-up".into(),
            sections: vec![
                Section {
                    heading: "Design".into(),
                    points: vec![
                        Point {
                            text: "Sam has the prototype by Wednesday.".into(),
                            from_you: true,
                        },
                        Point {
                            text: " Only empty states are left. ".into(),
                            from_you: false,
                        },
                    ],
                },
                Section {
                    heading: "Empty".into(),
                    points: vec![Point {
                        text: " ".into(),
                        from_you: false,
                    }],
                },
            ],
            action_items: vec![
                ActionItem {
                    task: "Share the prototype".into(),
                    owner: "Sam".into(),
                    due: "Wednesday".into(),
                },
                ActionItem {
                    task: "Ask infra for keys".into(),
                    owner: String::new(),
                    due: String::new(),
                },
            ],
        }
    }

    #[test]
    fn renders_sections_and_a_checklist_skipping_empty_parts() {
        assert_eq!(
            to_markdown(&sample()),
            "### Design\n- Sam has the prototype by Wednesday.\n- Only empty states are left.\n\n### Action items\n- [ ] Share the prototype (Sam, Wednesday)\n- [ ] Ask infra for keys"
        );
    }

    #[test]
    fn saving_titles_an_untitled_note_but_keeps_a_chosen_title() {
        let path =
            std::env::temp_dir().join(format!("memo-core-writeup-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut store = NoteStore::open(&path).unwrap();
        let note = store.create(1).unwrap();
        let saved = save_writeup(&mut store, &note.id, sample(), 2).unwrap();
        assert_eq!(saved.title, "Team stand-up");
        assert!(saved.enhanced.as_deref().unwrap().contains("Action items"));
        assert_eq!(saved.writeup.as_ref().unwrap().sections.len(), 2);

        let mut renamed = saved.clone();
        renamed.title = "Weekly sync".into();
        store.save(renamed, 3).unwrap();
        let again = save_writeup(&mut store, &note.id, sample(), 4).unwrap();
        assert_eq!(again.title, "Weekly sync");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn reads_the_write_up_service_json() {
        let json = r#"{"title":"T","sections":[{"heading":"H","points":[{"text":"x","fromYou":true}]}],"actionItems":[{"task":"Do it","owner":"","due":""}]}"#;
        let writeup: Writeup = serde_json::from_str(json).unwrap();
        assert!(writeup.sections[0].points[0].from_you);
        assert_eq!(writeup.action_items[0].task, "Do it");
    }
}
