/**
 * Every call from the UI to Rust goes through this file, so the command
 * surface is visible in one place and argument shapes cannot drift.
 *
 * Outside the Tauri window (a browser tab during `npm run dev:web`, and
 * tests), calls go to a small in-memory stand-in so screens can be designed
 * and checked without the native side. It is a preview aid, not a second
 * implementation: the rules live in the core crate.
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { browserBackend } from "./browserBackend";

export interface Segment {
  speaker: string;
  startSecs: number;
  text: string;
}

export interface WriteupPoint {
  text: string;
  /** The user's own note, as opposed to something Memo added. */
  fromYou: boolean;
}

export interface Writeup {
  title: string;
  sections: { heading: string; points: WriteupPoint[] }[];
  actionItems: { task: string; owner: string; due: string }[];
}

export interface Note {
  id: string;
  title: string;
  createdAtMs: number;
  updatedAtMs: number;
  durationSecs: number;
  myNotes: string;
  transcript: Segment[];
  enhanced: string | null;
  writeup: Writeup | null;
}

export interface NoteSummary {
  id: string;
  title: string;
  createdAtMs: number;
  durationSecs: number;
  snippet: string;
  speakers: number;
}

export interface RecordingStatus {
  noteId: string | null;
  paused: boolean;
  elapsedSecs: number;
}

/** True inside a Tauri window; false in a plain browser tab. */
export function nativeAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Which view this window draws: the app, or the floating mini widget. */
export function windowView(): "app" | "mini" {
  if (typeof window === "undefined") return "app";
  const flagged = (window as { __MEMO_VIEW__?: string }).__MEMO_VIEW__;
  if (flagged === "mini" || window.location.hash === "#mini") return "mini";
  return "app";
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!nativeAvailable()) return browserBackend<T>(command, args);
  return invoke<T>(command, args);
}

export const listNotes = () => call<NoteSummary[]>("list_notes");
export const getNote = (id: string) => call<Note>("get_note", { id });
export const saveNote = (note: Note) => call<Note>("save_note", { note });
export const deleteNote = (id: string) => call<void>("delete_note", { id });
export const appendLine = (id: string, line: string) => call<Note>("append_line", { id, line });
export const appendSegments = (id: string, segments: Segment[]) =>
  call<Note>("append_segments", { id, segments });
export const saveWriteup = (id: string, writeup: Writeup) => call<Note>("save_writeup", { id, writeup });
export const noteMarkdown = (id: string) => call<string>("note_markdown", { id });

export const recordingStatus = () => call<RecordingStatus>("recording_status");
export const startNote = () => call<Note>("start_note");
export const togglePause = () => call<RecordingStatus>("toggle_pause");
export const stopNote = () => call<Note>("stop_note");

export const showMain = (noteId?: string) => call<void>("show_main", { noteId: noteId ?? null });
export const showMini = () => call<void>("show_mini");
export const hideMini = () => call<void>("hide_mini");
export const setMiniCollapsed = (collapsed: boolean) =>
  call<void>("set_mini_collapsed", { collapsed });

/**
 * Start hearing the Mac's own audio output (the other side of a call).
 * `onSamples` gets mono 32-bit float chunks at the returned sample rate.
 * Rejects with a readable reason when macOS has not allowed it yet.
 */
export async function startSystemAudio(onSamples: (samples: Float32Array) => void): Promise<number> {
  if (!nativeAvailable()) throw new Error("Call audio is captured by the Mac app only.");
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = (buffer) => onSamples(new Float32Array(buffer));
  return invoke<number>("start_system_audio", { onAudio: channel });
}

export const stopSystemAudio = () => (nativeAvailable() ? invoke<void>("stop_system_audio") : Promise.resolve());

/** A snapshot of the screen (Memo's own windows left out) as Base64 PNG. */
export const captureScreen = () => call<string>("capture_screen");

/** ⌘↵ was pressed during a call. */
export function onAssistHotkey(handler: () => void): Promise<UnlistenFn> {
  if (!nativeAvailable()) return browserListen("assist-hotkey", handler);
  return listen("assist-hotkey", () => handler());
}

/** Recording started, paused or stopped, in any window or the menu bar. */
export function onRecordingChanged(handler: (status: RecordingStatus) => void): Promise<UnlistenFn> {
  if (!nativeAvailable()) return browserListen("recording-changed", handler);
  return listen<RecordingStatus>("recording-changed", (event) => handler(event.payload));
}

/** The menu bar asked the main window to open a note. */
export function onOpenNote(handler: (id: string) => void): Promise<UnlistenFn> {
  if (!nativeAvailable()) return browserListen("open-note", handler);
  return listen<string>("open-note", (event) => handler(event.payload));
}

function browserListen<T>(name: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  const wrapped = (event: Event) => handler((event as CustomEvent<T>).detail);
  window.addEventListener(`memo:${name}`, wrapped);
  return Promise.resolve(() => window.removeEventListener(`memo:${name}`, wrapped));
}
