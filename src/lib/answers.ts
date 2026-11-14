/**
 * Answers to questions asked during a call, from sources only.
 *
 * The overlay watches the live transcript for questions. For each one it
 * searches the user's past notes on the Mac (`searchNotes`), then asks
 * Captain's backend to answer from those passages and the transcript so far.
 * The backend answers only when the sources clearly do, citing them as [1],
 * [2]; otherwise the overlay says "Nothing certain found".
 */

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";
import type { Note, SearchHit } from "./native";

/** Short asides that end in "?" but aren't asking anything. */
const ASIDES = /^(right|okay|ok|yeah|yes|no|really|you know|know what i mean|does that make sense|make sense|sorry|huh|what|hello|can you hear me|are you there)\??$/i;

/** Only the recent past of this meeting goes along with the question. */
const RECENT_LINES = 60;

/**
 * Whether a finished transcript line is a question worth looking up: it ends
 * in a question mark and has a few words to it, so "Right?" and "Sorry?" don't
 * set anything off.
 */
export function isQuestion(text: string): boolean {
  const line = text.trim();
  if (!line.endsWith("?")) return false;
  if (ASIDES.test(line.replace(/[.,!]/g, "").trim())) return false;
  // The question is the last sentence of the line.
  const sentence = line.split(/(?<=[.!?])\s+/).pop() ?? line;
  return sentence.split(/\s+/).filter(Boolean).length >= 4;
}

/** The question sentence out of a longer line ("Fair. But why 14 days?" → "But why 14 days?"). */
export function questionOf(text: string): string {
  const line = text.trim();
  return line.split(/(?<=[.!?])\s+/).pop() ?? line;
}

export interface Answer {
  found: boolean;
  /** The answer with [n] markers; empty when nothing was found. */
  answer: string;
  /** The past-note passages the answer cites, numbered as in the text. */
  sources: { n: number; hit: SearchHit }[];
  fromThisMeeting: boolean;
}

/** A piece of answer text and the source numbers that follow it. */
export interface AnswerPart {
  text: string;
  refs: number[];
}

/** Split "Decided in March.[1] Fewer paid.[2]" into text runs with their source numbers. */
export function citationParts(answer: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  for (const piece of answer.split(/((?:\s*\[\d+\])+)/)) {
    if (!piece) continue;
    const refs = [...piece.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
    if (refs.length && piece.replace(/[\s[\]\d]/g, "") === "") {
      const last = parts[parts.length - 1];
      if (last) last.refs.push(...refs);
      continue;
    }
    parts.push({ text: piece, refs: [] });
  }
  return parts;
}

/** "Sep 12", or "Sep 12, 2025" when it isn't this year. */
export function sourceDate(ms: number, now = new Date()): string {
  const date = new Date(ms);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

export async function answerQuestion(
  question: string,
  note: Note,
  hits: SearchHit[],
  signal?: AbortSignal,
): Promise<Answer> {
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/memo-answer`, {
      method: "POST",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        transcript: note.transcript.slice(-RECENT_LINES),
        sources: hits.map((hit) => ({ title: hit.noteTitle, date: sourceDate(hit.createdAtMs), text: hit.text })),
      }),
      signal,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error("Can't reach Captain's server.");
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    found?: boolean;
    answer?: string;
    cited?: number[];
    fromThisMeeting?: boolean;
  };
  if (!response.ok) throw new Error(body.error ?? `Answers failed (${response.status}).`);
  const cited = (body.cited ?? []).filter((n) => n >= 1 && n <= hits.length);
  return {
    found: Boolean(body.found),
    answer: body.answer ?? "",
    sources: [...new Set(cited)]
      .sort((a, b) => a - b)
      .flatMap((n) => {
        const hit = hits[n - 1];
        return hit ? [{ n, hit }] : [];
      }),
    fromThisMeeting: Boolean(body.fromThisMeeting),
  };
}
