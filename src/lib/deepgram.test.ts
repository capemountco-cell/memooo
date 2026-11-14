import { describe, expect, it } from "vitest";

import { listenUrl, parseMessage, speakerLabel, toPcm16, toPcm16Stereo } from "./deepgram";

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

  it("asks for two channels transcribed separately when call audio is on", () => {
    const url = new URL(listenUrl(48000, 2));
    expect(url.searchParams.get("channels")).toBe("2");
    expect(url.searchParams.get("multichannel")).toBe("true");
    expect(new URL(listenUrl(48000)).searchParams.has("multichannel")).toBe(false);
  });

  it("labels the microphone as You and numbers the call's voices", () => {
    expect(speakerLabel(0, 2, 0)).toBe("You");
    expect(speakerLabel(1, 2, 0)).toBe("Speaker 2");
    expect(speakerLabel(1, 2, 1)).toBe("Speaker 3");
    expect(speakerLabel(0, 1, 1)).toBe("Speaker 2");
    const parsed = JSON.stringify({
      type: "Results",
      is_final: true,
      channel_index: [1, 2],
      channel: { alternatives: [{ transcript: "hi", words: [{ word: "hi", punctuated_word: "Hi.", start: 0.5, speaker: 0 }] }] },
    });
    expect(parseMessage(parsed, 10)).toEqual({
      kind: "final",
      segments: [{ speaker: "Speaker 2", startSecs: 10, text: "Hi." }],
    });
  });

  it("interleaves microphone and call audio into stereo PCM", () => {
    const pcm = new DataView(toPcm16Stereo(new Float32Array([1, 0]), new Float32Array([-1, 0.5])));
    expect(pcm.byteLength).toBe(8);
    expect([pcm.getInt16(0, true), pcm.getInt16(2, true), pcm.getInt16(6, true)]).toEqual([32767, -32768, 16383]);
  });
});
