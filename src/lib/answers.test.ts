import { describe, expect, it } from "vitest";

import { citationParts, isQuestion, questionOf } from "./answers";

describe("isQuestion", () => {
  it("takes real questions", () => {
    expect(isQuestion("Why did we pick 14 days back then?")).toBe(true);
    expect(isQuestion("Fair enough. But when does their contract end?")).toBe(true);
  });

  it("ignores statements, asides and very short questions", () => {
    expect(isQuestion("We picked 14 days.")).toBe(false);
    expect(isQuestion("Right?")).toBe(false);
    expect(isQuestion("Does that make sense?")).toBe(false);
    expect(isQuestion("Can you hear me?")).toBe(false);
    expect(isQuestion("Why not?")).toBe(false);
    expect(isQuestion("I agree. Sure?")).toBe(false);
  });
});

describe("questionOf", () => {
  it("keeps the last sentence", () => {
    expect(questionOf("Fair enough. But when does it end?")).toBe("But when does it end?");
    expect(questionOf("When does it end?")).toBe("When does it end?");
  });
});

describe("citationParts", () => {
  it("attaches source numbers to the text before them", () => {
    expect(citationParts("Decided in March.[1] Fewer paid.[2][3]")).toEqual([
      { text: "Decided in March.", refs: [1] },
      { text: " Fewer paid.", refs: [2, 3] },
    ]);
  });

  it("leaves uncited text alone", () => {
    expect(citationParts("It was 14 days.")).toEqual([{ text: "It was 14 days.", refs: [] }]);
  });
});
