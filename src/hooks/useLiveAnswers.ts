import { useCallback, useEffect, useRef, useState } from "react";

import { answerQuestion, isQuestion, questionOf, type Answer } from "../lib/answers";
import { getNote, searchNotes, type Segment } from "../lib/native";

export type LiveAnswer =
  | { state: "looking"; question: string }
  | { state: "done"; question: string; answer: Answer }
  | { state: "failed"; question: string; error: string };

/** The key a transcript line's answer is filed under. */
export const lineKey = (line: Segment) => `${line.startSecs}|${line.speaker}|${line.text}`;

/** Questions waiting longer than this are skipped: the moment has passed. */
const STALE_SECS = 90;

/**
 * Watches the live transcript for questions and looks each one up: first in
 * the user's past notes, then with Captain's backend, which answers only from
 * those passages and the meeting so far. One lookup runs at a time; when
 * questions pile up, the newest go first and old ones are dropped.
 */
export function useLiveAnswers(noteId: string | null, lines: Segment[], elapsedSecs: number) {
  const [answers, setAnswers] = useState<Record<string, LiveAnswer>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string>>(new Set());
  const queue = useRef<Segment[]>([]);
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const clock = useRef(elapsedSecs);
  clock.current = elapsedSecs;

  // A new recording starts clean.
  useEffect(() => {
    abort.current?.abort();
    seen.current = new Set();
    queue.current = [];
    busy.current = false;
    setAnswers({});
    setDismissed(new Set());
  }, [noteId]);

  const pump = useCallback(async () => {
    if (busy.current || !noteId) return;
    // Newest question first.
    const line = queue.current.pop();
    if (!line) return;
    if (clock.current - line.startSecs > STALE_SECS) {
      queue.current = [];
      return;
    }
    busy.current = true;
    const key = lineKey(line);
    const question = questionOf(line.text);
    const controller = new AbortController();
    abort.current = controller;
    setAnswers((all) => ({ ...all, [key]: { state: "looking", question } }));
    try {
      const [hits, note] = await Promise.all([searchNotes(question, noteId), getNote(noteId)]);
      const answer = await answerQuestion(question, note, hits, controller.signal);
      if (!controller.signal.aborted) {
        setAnswers((all) => ({ ...all, [key]: { state: "done", question, answer } }));
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        const error = cause instanceof Error ? cause.message : String(cause);
        setAnswers((all) => ({ ...all, [key]: { state: "failed", question, error } }));
      }
    } finally {
      busy.current = false;
      // Anything that arrived meanwhile.
      void pump();
    }
  }, [noteId]);

  useEffect(() => {
    let added = false;
    for (const line of lines) {
      const key = lineKey(line);
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      if (isQuestion(line.text)) {
        queue.current.push(line);
        added = true;
      }
    }
    if (added) void pump();
  }, [lines, pump]);

  useEffect(() => () => abort.current?.abort(), []);

  const dismiss = useCallback((key: string) => setDismissed((all) => new Set(all).add(key)), []);
  const found = Object.values(answers).filter((a) => a.state === "done" && a.answer.found).length;

  return { answers, dismissed, dismiss, found };
}
