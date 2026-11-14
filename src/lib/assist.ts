/** Live help during a call, streamed from Memo's backend as it is written. */

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";
import type { Note } from "./native";

export type AssistMode = "assist" | "say" | "ask" | "screen";

export const MODE_LABEL: Record<AssistMode, string> = {
  assist: "Assist",
  say: "What should I say?",
  ask: "Answer",
  screen: "On your screen",
};

/** Only the recent past matters mid-call; this keeps requests small and quick. */
const RECENT_LINES = 80;

export interface AssistRequest {
  mode: AssistMode;
  note: Note;
  question?: string;
  screenshot?: string;
}

/**
 * Ask for help and receive the answer piece by piece. `onText` gets the
 * whole answer so far each time more arrives. Resolves with the full answer.
 */
export async function streamAssist(
  request: AssistRequest,
  onText: (soFar: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/memo-assist`, {
      method: "POST",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: request.mode,
        question: request.question ?? "",
        myNotes: request.note.myNotes,
        transcript: request.note.transcript.slice(-RECENT_LINES),
        screenshot: request.screenshot,
      }),
      signal,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error("Can't reach Memo's server. Check your internet connection.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Live help failed (${response.status}).`);
  }
  if (!response.body) {
    const whole = await response.text();
    onText(whole);
    return whole;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let soFar = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    soFar += decoder.decode(value, { stream: true });
    onText(soFar);
  }
  soFar += decoder.decode();
  onText(soFar);
  return soFar;
}
