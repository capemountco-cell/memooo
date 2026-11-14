//! Notes on disk: one JSON file, written atomically.
//!
//! A meeting's worth of notes is small, and one file keeps backup, sync and
//! debugging simple. Writes go to a temporary file first and are renamed into
//! place, so a crash mid-write never leaves a half-written store.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::note::{Note, NoteSummary};

const FORMAT_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
struct FileFormat {
    version: u32,
    notes: Vec<Note>,
}

#[derive(Debug)]
pub enum StoreError {
    Io(io::Error),
    Corrupt(serde_json::Error),
    NotFound(String),
    NewerVersion(u32),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(f, "Could not read or write your notes: {error}"),
            Self::Corrupt(error) => write!(f, "Your notes file could not be read: {error}"),
            Self::NotFound(id) => write!(f, "No note with id {id}."),
            Self::NewerVersion(version) => write!(
                f,
                "Your notes were saved by a newer version of Memo (format {version}). Update Memo to open them."
            ),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<io::Error> for StoreError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

#[derive(Debug)]
pub struct NoteStore {
    path: PathBuf,
    notes: Vec<Note>,
    next_seq: u64,
}

impl NoteStore {
    /// Open the store at `path`, starting empty when the file does not exist.
    pub fn open(path: impl Into<PathBuf>) -> Result<Self, StoreError> {
        let path = path.into();
        let notes = match fs::read(&path) {
            Ok(bytes) => {
                let file: FileFormat =
                    serde_json::from_slice(&bytes).map_err(StoreError::Corrupt)?;
                if file.version > FORMAT_VERSION {
                    return Err(StoreError::NewerVersion(file.version));
                }
                file.notes
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error.into()),
        };
        Ok(Self {
            path,
            notes,
            next_seq: 0,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Newest first.
    pub fn list(&self) -> Vec<NoteSummary> {
        let mut notes: Vec<&Note> = self.notes.iter().collect();
        notes.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms).then(b.id.cmp(&a.id)));
        notes.into_iter().map(Note::summary).collect()
    }

    /// Every note, in storage order, for searching.
    pub fn notes(&self) -> &[Note] {
        &self.notes
    }

    pub fn get(&self, id: &str) -> Result<Note, StoreError> {
        self.notes
            .iter()
            .find(|note| note.id == id)
            .cloned()
            .ok_or_else(|| StoreError::NotFound(id.to_string()))
    }

    /// Create an empty note, save it, and return it.
    pub fn create(&mut self, now_ms: u64) -> Result<Note, StoreError> {
        let note = Note::new(self.new_id(now_ms), now_ms);
        self.notes.push(note.clone());
        self.flush()?;
        Ok(note)
    }

    /// Replace a note (matched by id), stamping `updated_at_ms`. Creation time
    /// is kept from the stored copy, so the UI cannot reorder history.
    pub fn save(&mut self, mut note: Note, now_ms: u64) -> Result<Note, StoreError> {
        let existing = self
            .notes
            .iter_mut()
            .find(|stored| stored.id == note.id)
            .ok_or_else(|| StoreError::NotFound(note.id.clone()))?;
        note.created_at_ms = existing.created_at_ms;
        note.updated_at_ms = now_ms;
        *existing = note.clone();
        self.flush()?;
        Ok(note)
    }

    /// Set how long a note's recording ran.
    pub fn set_duration(&mut self, id: &str, secs: u64, now_ms: u64) -> Result<Note, StoreError> {
        let mut note = self.get(id)?;
        note.duration_secs = secs;
        self.save(note, now_ms)
    }

    pub fn delete(&mut self, id: &str) -> Result<(), StoreError> {
        let before = self.notes.len();
        self.notes.retain(|note| note.id != id);
        if self.notes.len() == before {
            return Err(StoreError::NotFound(id.to_string()));
        }
        self.flush()
    }

    /// Ids sort by creation time and stay unique within a millisecond.
    fn new_id(&mut self, now_ms: u64) -> String {
        loop {
            self.next_seq += 1;
            let id = format!("n{now_ms:013x}{:04x}", self.next_seq & 0xffff);
            if !self.notes.iter().any(|note| note.id == id) {
                return id;
            }
        }
    }

    fn flush(&self) -> Result<(), StoreError> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let file = FileFormat {
            version: FORMAT_VERSION,
            notes: self.notes.clone(),
        };
        let bytes = serde_json::to_vec_pretty(&file).map_err(StoreError::Corrupt)?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, bytes)?;
        fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh directory per test, removed when dropped.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("memo-core-test-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            Self(dir)
        }
        fn file(&self) -> PathBuf {
            self.0.join("nested").join("notes.json")
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn missing_file_opens_empty() {
        let dir = TempDir::new("missing");
        let store = NoteStore::open(dir.file()).unwrap();
        assert!(store.list().is_empty());
    }

    #[test]
    fn create_save_reopen_round_trips() {
        let dir = TempDir::new("roundtrip");
        let mut store = NoteStore::open(dir.file()).unwrap();
        let mut note = store.create(1_000).unwrap();
        note.title = "Team stand-up".into();
        note.my_notes = "sam — prototype by weds".into();
        note.created_at_ms = 999_999; // The UI cannot rewrite history.
        store.save(note.clone(), 2_000).unwrap();

        let reopened = NoteStore::open(dir.file()).unwrap();
        let loaded = reopened.get(&note.id).unwrap();
        assert_eq!(loaded.title, "Team stand-up");
        assert_eq!(loaded.created_at_ms, 1_000);
        assert_eq!(loaded.updated_at_ms, 2_000);
        assert!(!dir.file().with_extension("json.tmp").exists());
    }

    #[test]
    fn lists_newest_first_with_unique_ids() {
        let dir = TempDir::new("order");
        let mut store = NoteStore::open(dir.file()).unwrap();
        let a = store.create(1_000).unwrap();
        let b = store.create(1_000).unwrap();
        let c = store.create(5_000).unwrap();
        assert_ne!(a.id, b.id);
        let ids: Vec<String> = store.list().into_iter().map(|n| n.id).collect();
        assert_eq!(ids[0], c.id);
        assert_eq!(ids.len(), 3);
    }

    #[test]
    fn delete_and_missing_ids_are_reported() {
        let dir = TempDir::new("delete");
        let mut store = NoteStore::open(dir.file()).unwrap();
        let note = store.create(1).unwrap();
        store.set_duration(&note.id, 90, 2).unwrap();
        assert_eq!(store.get(&note.id).unwrap().duration_secs, 90);
        store.delete(&note.id).unwrap();
        assert!(matches!(
            store.delete(&note.id),
            Err(StoreError::NotFound(_))
        ));
        assert!(matches!(store.get("nope"), Err(StoreError::NotFound(_))));
    }

    #[test]
    fn refuses_corrupt_and_newer_files_without_overwriting_them() {
        let dir = TempDir::new("corrupt");
        fs::create_dir_all(dir.file().parent().unwrap()).unwrap();
        fs::write(dir.file(), b"{not json").unwrap();
        assert!(matches!(
            NoteStore::open(dir.file()),
            Err(StoreError::Corrupt(_))
        ));
        fs::write(dir.file(), br#"{"version":99,"notes":[]}"#).unwrap();
        assert!(matches!(
            NoteStore::open(dir.file()),
            Err(StoreError::NewerVersion(99))
        ));
        assert_eq!(
            fs::read(dir.file()).unwrap(),
            br#"{"version":99,"notes":[]}"#
        );
    }
}
