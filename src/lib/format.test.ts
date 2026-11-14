import { describe, expect, it } from "vitest";

import { clock, dayLabel, length } from "./format";

describe("format", () => {
  it("prints the recording clock like the core crate", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(768)).toBe("12:48");
    expect(clock(3723)).toBe("1:02:03");
  });

  it("prints lengths in minutes", () => {
    expect(length(0)).toBe("");
    expect(length(20)).toBe("<1 min");
    expect(length(1680)).toBe("28 min");
    expect(length(3900)).toBe("1 h 5 min");
  });

  it("labels recent days in words", () => {
    const now = new Date(2026, 10, 14, 10);
    expect(dayLabel(new Date(2026, 10, 14, 8).getTime(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 13, 20).getTime(), now)).toBe("Yesterday");
  });
});
