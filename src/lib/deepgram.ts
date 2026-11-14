/**
 * Talking to Deepgram's live transcription: the stream URL, a short-lived
 * token from Memo's backend, and turning Deepgram's messages into lines.
 */

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";
import type { Segment } from "./native";

/** Raw 16-bit PCM, one channel, at whatever rate the Mac's audio runs. */
export function listenUrl(sampleRate: number): string {
  const params = new URLSearchParams({
    model: "nova-3",
    language: "en",
    smart_format: "true",
    punctuate: "true",
    diarize: "true",
    interim_results: "true",
    endpointing: "300",
    encoding: "linear16",
    sample_rate: String(Math.round(sampleRate)),
    channels: "1",
  });
  return `wss://api.deepgram.com/v1/listen?${params}`;
}

/** Ask Memo's backend for a token that can open one stream. */
export async function fetchToken(): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/deepgram-token`, {
      method: "POST",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    throw new Error("Can't reach Memo's server. Check your internet connection.");
  }
  const body = (await response.json().catch(() => ({}))) as { accessToken?: string; error?: string };
  if (!response.ok || !body.accessToken) {
    throw new Error(body.error ?? `Transcription is unavailable (${response.status}).`);
  }
  return body.accessToken;
}

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start: number;
  speaker?: number;
}

interface DeepgramResults {
  type?: string;
  is_final?: boolean;
  channel?: { alternatives?: { transcript?: string; words?: DeepgramWord[] }[] };
}

export type Parsed =
  | { kind: "final"; segments: Segment[] }
  | { kind: "interim"; text: string };

/**
 * One Deepgram message, as finished lines (split wherever the speaker
 * changes) or as the in-progress text. `offsetSecs` is how far into the
 * recording this stream began, so timestamps count from the meeting start.
 * Returns null for messages that carry no words.
 */
export function parseMessage(raw: string, offsetSecs: number): Parsed | null {
  let message: DeepgramResults;
  try {
    message = JSON.parse(raw) as DeepgramResults;
  } catch {
    return null;
  }
  if (message.type !== "Results") return null;
  const alternative = message.channel?.alternatives?.[0];
  const transcript = alternative?.transcript?.trim() ?? "";
  if (!transcript) return null;
  if (!message.is_final) return { kind: "interim", text: transcript };

  const words = alternative?.words ?? [];
  if (words.length === 0) {
    return { kind: "final", segments: [{ speaker: "Speaker 1", startSecs: Math.floor(offsetSecs), text: transcript }] };
  }
  const segments: Segment[] = [];
  for (const word of words) {
    const speaker = `Speaker ${(word.speaker ?? 0) + 1}`;
    const text = word.punctuated_word ?? word.word;
    const last = segments[segments.length - 1];
    if (last && last.speaker === speaker) last.text += ` ${text}`;
    else segments.push({ speaker, startSecs: Math.floor(offsetSecs + word.start), text });
  }
  return { kind: "final", segments };
}

/** Float samples (-1..1) to little-endian 16-bit PCM. */
export function toPcm16(samples: Float32Array): ArrayBuffer {
  const out = new DataView(new ArrayBuffer(samples.length * 2));
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return out.buffer;
}
