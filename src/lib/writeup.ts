/** Asking Captain's backend to write up a meeting from the notes and transcript. */

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";
import type { Note, Writeup } from "./native";

export async function requestWriteup(note: Note): Promise<Writeup> {
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/memo-writeup`, {
      method: "POST",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ title: note.title, myNotes: note.myNotes, transcript: note.transcript }),
    });
  } catch {
    throw new Error("Can't reach Captain's server. Check your internet connection.");
  }
  const body = (await response.json().catch(() => ({}))) as { writeup?: Writeup; error?: string };
  if (!response.ok || !body.writeup) {
    throw new Error(body.error ?? `The write-up failed (${response.status}).`);
  }
  return body.writeup;
}

/** Worth writing up: something was typed or said. */
export function hasMaterial(note: Note): boolean {
  return note.myNotes.trim().length > 0 || note.transcript.length > 0;
}
