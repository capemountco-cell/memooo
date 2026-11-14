import { describe, expect, it } from "vitest";

import { listenUrl, parseMessage, toPcm16 } from "./deepgram";

const results = (isFinal: boolean, words: object[], transcript = "x") =>
  JSON.stringify({ type: "Results", is_final: isFinal, channel: { alternatives: [{ transcript, words }] } });

describe("deepgram", () => {
  it("asks for raw PCM at the Mac's sample rate with speaker labels", () => {
    const url = new URL(listenUrl(48000));
    expect(url.host).toBe("api.deepgram.com");
    expect(url.searchParams.get("encoding")).toBe("linear16");
    expect(url.searchParams.get("sample_rate")).toBe("48000");
    expect(url.searchParams.get("diarize")).toBe("true");
  });

  it("splits a finished result where the speaker changes and offsets timestamps", () => {
    const parsed = parseMessage(
      results(true, [
        { word: "ready", punctuated_word: "Ready", start: 1.2, speaker: 0 },
        { word: "wednesday", punctuated_word: "Wednesday.", start: 1.6, speaker: 0 },
        { word: "great", punctuated_word: "Great.", start: 2.4, speaker: 1 },
      ]),
      60,
    );
    expect(parsed).toEqual({
      kind: "final",
      segments: [
        { speaker: "Speaker 1", startSecs: 61, text: "Ready Wednesday." },
        { speaker: "Speaker 2", startSecs: 62, text: "Great." },
      ],
    });
  });

  it("passes interim text through and ignores empty or other messages", () => {
    expect(parseMessage(results(false, [], "still talk"), 0)).toEqual({ kind: "interim", text: "still talk" });
    expect(parseMessage(results(true, [], "  "), 0)).toBeNull();
    expect(parseMessage(JSON.stringify({ type: "Metadata" }), 0)).toBeNull();
    expect(parseMessage("not json", 0)).toBeNull();
  });

  it("converts and clamps samples to 16-bit PCM", () => {
    const pcm = new DataView(toPcm16(new Float32Array([0, 1, -1, 2])));
    expect([pcm.getInt16(0, true), pcm.getInt16(2, true), pcm.getInt16(4, true), pcm.getInt16(6, true)]).toEqual([
      0, 32767, -32768, 32767,
    ]);
  });
});
