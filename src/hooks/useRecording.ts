import { useEffect, useState } from "react";

import { onRecordingChanged, recordingStatus, type RecordingStatus } from "../lib/native";

const IDLE: RecordingStatus = { noteId: null, paused: false, elapsedSecs: 0 };

/**
 * The live recording status, shared by every window. Rust is asked once and
 * then pushes changes; between pushes the clock ticks locally so the timer
 * moves every second without a round trip.
 */
export function useRecording(): RecordingStatus {
  const [status, setStatus] = useState<RecordingStatus>(IDLE);
  const [anchor, setAnchor] = useState(() => Date.now());
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const apply = (next: RecordingStatus) => {
      if (!alive) return;
      setStatus(next);
      setAnchor(Date.now());
    };
    recordingStatus().then(apply).catch(() => apply(IDLE));
    const unlisten = onRecordingChanged(apply);
    return () => {
      alive = false;
      void unlisten.then((stop) => stop());
    };
  }, []);

  const running = status.noteId !== null && !status.paused;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  if (!running) return status;
  return { ...status, elapsedSecs: status.elapsedSecs + Math.floor((Date.now() - anchor) / 1000) };
}
