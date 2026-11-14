//! The Tauri shell.
//!
//! No logic lives here. A command deserialises its arguments, calls one
//! function in the core crate, and returns the result. A decision made in a
//! command handler is a decision that cannot be tested on Linux.
//!
//! Besides the commands, this file owns what only a native shell can do: the
//! menu bar icon and its menu, and the floating mini widget window.

mod system_audio;

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use memo_core::{Note, NoteStore, NoteSummary, Recorder, RecordingStatus, Segment};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

const TRAY_ID: &str = "memo";
const MINI_LABEL: &str = "mini";
/// Sent to every window whenever recording starts, pauses or stops.
const RECORDING_EVENT: &str = "recording-changed";
/// Sent to the main window to open a note.
const OPEN_NOTE_EVENT: &str = "open-note";

struct AppState {
    store: Mutex<NoteStore>,
    recorder: Mutex<Recorder>,
}

type CommandResult<T> = Result<T, String>;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn text<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    // A panic while holding the lock leaves valid data behind; keep going.
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn status(state: &AppState) -> RecordingStatus {
    lock(&state.recorder).status(now_ms())
}

/// Tell every window, and the menu bar, that recording changed.
fn broadcast(app: &AppHandle) {
    let state = app.state::<AppState>();
    let current = status(&state);
    refresh_tray(app, &current);
    let _ = app.emit(RECORDING_EVENT, current);
}

fn refresh_tray(app: &AppHandle, current: &RecordingStatus) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let title = current.note_id.as_ref().map(|_| {
            let clock = memo_core::clock(current.elapsed_secs);
            if current.paused {
                format!("{clock} paused")
            } else {
                clock
            }
        });
        let _ = tray.set_title(title);
        let tooltip = if current.note_id.is_some() {
            "Memo: recording"
        } else {
            "Memo"
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

// ---- Notes -------------------------------------------------------------

#[tauri::command]
fn list_notes(state: State<AppState>) -> Vec<NoteSummary> {
    lock(&state.store).list()
}

#[tauri::command]
fn get_note(state: State<AppState>, id: String) -> CommandResult<Note> {
    lock(&state.store).get(&id).map_err(text)
}

#[tauri::command]
fn save_note(state: State<AppState>, note: Note) -> CommandResult<Note> {
    lock(&state.store).save(note, now_ms()).map_err(text)
}

#[tauri::command]
fn delete_note(state: State<AppState>, id: String) -> CommandResult<()> {
    lock(&state.store).delete(&id).map_err(text)
}

#[tauri::command]
fn append_line(state: State<AppState>, id: String, line: String) -> CommandResult<Note> {
    memo_core::append_line(&mut lock(&state.store), &id, &line, now_ms()).map_err(text)
}

#[tauri::command]
fn append_segments(
    state: State<AppState>,
    id: String,
    segments: Vec<Segment>,
) -> CommandResult<Note> {
    memo_core::append_segments(&mut lock(&state.store), &id, segments, now_ms()).map_err(text)
}

#[tauri::command]
fn save_writeup(
    state: State<AppState>,
    id: String,
    writeup: memo_core::writeup::Writeup,
) -> CommandResult<Note> {
    memo_core::writeup::save_writeup(&mut lock(&state.store), &id, writeup, now_ms()).map_err(text)
}

#[tauri::command]
fn note_markdown(state: State<AppState>, id: String) -> CommandResult<String> {
    let note = lock(&state.store).get(&id).map_err(text)?;
    Ok(memo_core::export::to_markdown(&note))
}

// ---- Recording ---------------------------------------------------------

#[tauri::command]
fn recording_status(state: State<AppState>) -> RecordingStatus {
    status(&state)
}

#[tauri::command]
fn start_note(app: AppHandle, state: State<AppState>) -> CommandResult<Note> {
    let note = memo_core::start_new_note(
        &mut lock(&state.store),
        &mut lock(&state.recorder),
        now_ms(),
    )
    .map_err(text)?;
    broadcast(&app);
    Ok(note)
}

#[tauri::command]
fn toggle_pause(app: AppHandle, state: State<AppState>) -> CommandResult<RecordingStatus> {
    lock(&state.recorder).toggle_pause(now_ms()).map_err(text)?;
    broadcast(&app);
    Ok(status(&state))
}

#[tauri::command]
fn stop_note(app: AppHandle, state: State<AppState>) -> CommandResult<Note> {
    let note = memo_core::stop_recording(
        &mut lock(&state.store),
        &mut lock(&state.recorder),
        now_ms(),
    )
    .map_err(text)?;
    broadcast(&app);
    Ok(note)
}

// ---- Windows -----------------------------------------------------------

/// Bring the main window forward, optionally opening a note in it.
#[tauri::command]
fn show_main(app: AppHandle, note_id: Option<String>) {
    open_main(&app, note_id);
}

fn open_main(app: &AppHandle, note_id: Option<String>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        if let Some(id) = note_id {
            let _ = window.emit(OPEN_NOTE_EVENT, id);
        }
    }
}

/// Mini widget sizes: expanded card and collapsed pill, in points.
const MINI_EXPANDED: (f64, f64) = (360.0, 300.0);
const MINI_COLLAPSED: (f64, f64) = (196.0, 56.0);

#[tauri::command]
fn show_mini(app: AppHandle) -> CommandResult<()> {
    open_mini(&app).map_err(text)
}

#[tauri::command]
fn hide_mini(app: AppHandle) {
    if let Some(window) = app.get_webview_window(MINI_LABEL) {
        let _ = window.hide();
    }
}

#[tauri::command]
fn set_mini_collapsed(app: AppHandle, collapsed: bool) -> CommandResult<()> {
    let window = app
        .get_webview_window(MINI_LABEL)
        .ok_or("The mini widget is not open.")?;
    let (width, height) = if collapsed {
        MINI_COLLAPSED
    } else {
        MINI_EXPANDED
    };
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(text)
}

fn open_mini(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MINI_LABEL) {
        window.show()?;
        return window.set_focus();
    }
    // The same frontend, told to draw the mini widget instead of the app.
    WebviewWindowBuilder::new(app, MINI_LABEL, WebviewUrl::App("index.html".into()))
        .title("Memo")
        .initialization_script("window.__MEMO_VIEW__ = 'mini';")
        .inner_size(MINI_EXPANDED.0, MINI_EXPANDED.1)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .build()?;
    Ok(())
}

// ---- Menu bar ----------------------------------------------------------

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let start = MenuItem::with_id(app, "start", "Start a Note", true, Some("Alt+Cmd+M"))?;
    let stop = MenuItem::with_id(app, "stop", "Stop Recording", true, None::<&str>)?;
    let mini = MenuItem::with_id(app, "mini", "Show Mini Widget", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Memo", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Memo", true, Some("Cmd+Q"))?;
    let separator = PredefinedMenuItem::separator(app)?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[&start, &stop, &separator, &mini, &open, &separator2, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Memo")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "start" => {
                let state = app.state::<AppState>();
                let started = memo_core::start_new_note(
                    &mut lock(&state.store),
                    &mut lock(&state.recorder),
                    now_ms(),
                );
                match started {
                    Ok(note) => {
                        broadcast(app);
                        open_main(app, Some(note.id));
                    }
                    // Already recording: show the note being recorded.
                    Err(_) => open_main(app, status(&state).note_id),
                }
            }
            "stop" => {
                let state = app.state::<AppState>();
                let stopped = memo_core::stop_recording(
                    &mut lock(&state.store),
                    &mut lock(&state.recorder),
                    now_ms(),
                );
                if let Ok(note) = stopped {
                    broadcast(app);
                    open_main(app, Some(note.id));
                }
            }
            "mini" => {
                let _ = open_mini(app);
            }
            "open" => open_main(app, None),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Keep the menu bar timer ticking while recording.
fn tick_tray(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let state = app.state::<AppState>();
        let current = status(&state);
        if current.note_id.is_some() {
            refresh_tray(&app, &current);
        }
    });
}

/// Build and run the application.
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("notes.json");
            let store = NoteStore::open(path)?;
            app.manage(system_audio::SystemAudio::default());
            app.manage(AppState {
                store: Mutex::new(store),
                recorder: Mutex::new(Recorder::default()),
            });
            build_tray(app.handle())?;
            tick_tray(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_notes,
            get_note,
            save_note,
            delete_note,
            append_line,
            append_segments,
            save_writeup,
            note_markdown,
            recording_status,
            start_note,
            toggle_pause,
            stop_note,
            show_main,
            show_mini,
            hide_mini,
            set_mini_collapsed,
            system_audio::start_system_audio,
            system_audio::stop_system_audio,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start the application");
}
