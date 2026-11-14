import { beforeEach, describe, expect, it } from "vitest";

import { resetBrowserBackend } from "./browserBackend";
import {
  appendLine,
  getNote,
  listNotes,
  nativeAvailable,
  recordingStatus,
  saveNote,
  startNote,
  stopNote,
  togglePause,
} from "./native";

describe("native bridge outside the app window", () => {
  beforeEach(() => resetBrowserBackend());

  it("knows it is not inside Tauri under test", () => {
    expect(nativeAvailable()).toBe(false);
  });

  it("starts, notes, pauses and stops a recording", async () => {
    const note = await startNote();
    expect((await recordingStatus()).noteId).toBe(note.id);
    await expect(startNote()).rejects.toThrow(/already/);

    await appendLine(note.id, " first ");
    await appendLine(note.id, "second");
    expect((await getNote(note.id)).myNotes).toBe("first\nsecond");

    expect((await togglePause()).paused).toBe(true);
    await stopNote();
    expect((await recordingStatus()).noteId).toBeNull();
  });

  it("keeps creation time when saving and lists newest first", async () => {
    const first = await startNote();
    await stopNote();
    const saved = await saveNote({ ...first, title: "Stand-up", createdAtMs: 1 });
    expect(saved.createdAtMs).toBe(first.createdAtMs);
    const second = await startNote();
    const list = await listNotes();
    expect(list[0]?.id).toBe(second.id);
    expect(list.find((n) => n.id === first.id)?.title).toBe("Stand-up");
  });
});
