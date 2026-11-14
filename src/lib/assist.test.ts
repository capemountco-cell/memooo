import { afterEach, describe, expect, it, vi } from "vitest";

import { streamAssist } from "./assist";
import type { Note } from "./native";

const note: Note = {
  id: "n1",
  title: "Stand-up",
  createdAtMs: 0,
  updatedAtMs: 0,
  durationSecs: 0,
  myNotes: "ship date?",
  transcript: Array.from({ length: 100 }, (_, i) => ({ speaker: "You", startSecs: i, text: `line ${i}` })),
  enhanced: null,
  writeup: null,
};

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("live help", () => {
  it("streams the answer as it arrives and sends only recent lines", async () => {
    const fetchMock = vi.fn(async () => new Response(streamOf(["The ship ", "date is ", "the 28th."])));
    vi.stubGlobal("fetch", fetchMock);
    const seen: string[] = [];
    const full = await streamAssist({ mode: "assist", note }, (text) => seen.push(text));
    expect(full).toBe("The ship date is the 28th.");
    expect(seen[0]).toBe("The ship ");
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.mode).toBe("assist");
    expect(body.transcript).toHaveLength(80);
    expect(body.transcript[0].text).toBe("line 20");
  });

  it("surfaces the server's reason when it refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Type a question first." }), { status: 400 })),
    );
    await expect(streamAssist({ mode: "ask", note }, () => undefined)).rejects.toThrow("Type a question first.");
  });
});
