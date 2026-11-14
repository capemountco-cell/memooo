import { describe, expect, it } from "vitest";

import { speakersOf, speakerTone } from "./speakers";

describe("speaker colours", () => {
  it("keeps You neutral and walks the palette for numbered voices", () => {
    expect(speakerTone("You")).toBe(0);
    expect(speakerTone("Speaker 2")).toBe(1);
    expect(speakerTone("Speaker 3")).toBe(2);
    expect(speakerTone("Speaker 6")).toBe(5);
    expect(speakerTone("Speaker 7")).toBe(1);
    expect(speakerTone("Speaker 1")).toBe(1);
  });

  it("gives a named person the same tone every time", () => {
    expect(speakerTone("Priya")).toBe(speakerTone(" priya "));
    expect(speakerTone("Priya")).toBeGreaterThan(0);
  });

  it("lists speakers in order of first appearance", () => {
    expect(speakersOf([{ speaker: "You" }, { speaker: "Speaker 2" }, { speaker: "You" }])).toEqual([
      "You",
      "Speaker 2",
    ]);
  });
});
