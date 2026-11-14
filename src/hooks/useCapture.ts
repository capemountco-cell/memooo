import { useEffect, useRef, useState } from "react";

import { SampleQueue } from "../lib/audioQueue";
import { fetchToken, listenUrl, parseMessage, toPcm16, toPcm16Stereo } from "../lib/deepgram";
import { appendSegments, nativeAvailable, startSystemAudio, stopSystemAudio, type Segment } from "../lib/native";
import type { MicState } from "./useMicLevels";

export type TranscriptState = "off" | "connecting" | "live" | "error";

/** Whether Captain hears the call itself, or only the microphone. */
export type CallAudio = "off" | "on" | "unavailable";

interface Capture {
  levels: number[];
  mic: MicState;
  transcript: TranscriptState;
  error: string | null;
  /** The newest finished lines, as saved on the note. */
  lines: Segment[];
  /** What is being said right now, not yet final. */
  interim: string;
  callAudio: CallAudio;
  /** Why call audio is unavailable, when it is. */
  callAudioNote: string | null;
}

/** Both sides are captured at this rate so they line up sample for sample. */
const CAPTURE_RATE = 48_000;
/** Keep at most this much call audio waiting for the microphone (1 s). */
const MAX_QUEUED = CAPTURE_RATE;
/** Collect this much call audio before sending it, so gaps between bursts don't chop words (150 ms). */
const CALL_CUSHION = Math.round(CAPTURE_RATE * 0.15);

const MAX_RECONNECTS = 3;
/** Lines kept for the overlay's conversation view. */
const RECENT_LINES = 12;

const DEMO_LINES: Segment[] = [
  { speaker: "Speaker 2", startSecs: 2, text: "What if we made the free trial 30 days?" },
  { speaker: "You", startSecs: 6, text: "I think that came up once before." },
  { speaker: "Speaker 3", startSecs: 9, text: "Why did we pick 14 days back then?" },
];

/**
 * While `active`, listen to the microphone, draw its level, and stream it to
 * Deepgram. Finished lines are saved onto the note as they arrive.
 * `elapsedSecs` is read when a stream opens, so timestamps count from the
 * start of the meeting even after a pause or a reconnect.
 */
export function useCapture(active: boolean, noteId: string | null, elapsedSecs: number, bars: number): Capture {
  const [levels, setLevels] = useState<number[]>(() => Array(bars).fill(0));
  const [mic, setMic] = useState<MicState>("off");
  const [transcript, setTranscript] = useState<TranscriptState>("off");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Segment[]>([]);
  const [interim, setInterim] = useState("");
  const [callAudio, setCallAudio] = useState<CallAudio>("off");
  const [callAudioNote, setCallAudioNote] = useState<string | null>(null);
  const elapsed = useRef(elapsedSecs);
  elapsed.current = elapsedSecs;

  // `npm run dev:web` with `?demo`: a few lines of a call, so the overlay's
  // conversation and answers can be designed without a real meeting.
  useEffect(() => {
    if (!active || !noteId || nativeAvailable()) return;
    if (!new URLSearchParams(window.location.search).has("demo")) return;
    setLines(DEMO_LINES);
  }, [active, noteId]);

  useEffect(() => {
    if (!active || !noteId) {
      setMic("off");
      setTranscript("off");
      setCallAudio("off");
      setInterim("");
      setLevels(Array(bars).fill(0));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMic("unavailable");
      return;
    }

    let stopped = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let socket: WebSocket | null = null;
    let frame = 0;
    let reconnects = 0;
    let retryTimer = 0;
    let callAudioOn = false;
    const callQueue = new SampleQueue(CALL_CUSHION, MAX_QUEUED);
    setMic("asking");
    setError(null);

    const save = (segments: Segment[]) => {
      appendSegments(noteId, segments)
        .then((note) => setLines(note.transcript.slice(-RECENT_LINES)))
        .catch((cause: unknown) => setError(String(cause)));
    };

    const connect = async (sampleRate: number, channels: 1 | 2) => {
      setTranscript("connecting");
      try {
        const token = await fetchToken();
        if (stopped) return;
        const offset = elapsed.current;
        const ws = new WebSocket(listenUrl(sampleRate, channels), ["bearer", token]);
        socket = ws;
        ws.onopen = () => {
          reconnects = 0;
          setTranscript("live");
          setError(null);
        };
        ws.onmessage = (event) => {
          if (typeof event.data !== "string") return;
          const parsed = parseMessage(event.data, offset);
          if (!parsed) return;
          if (parsed.kind === "interim") setInterim(parsed.text);
          else {
            setInterim("");
            save(parsed.segments);
          }
        };
        ws.onclose = () => {
          if (stopped || socket !== ws) return;
          socket = null;
          if (reconnects >= MAX_RECONNECTS) {
            setTranscript("error");
            setError("Lost the connection to transcription. Your notes are still being saved.");
            return;
          }
          reconnects += 1;
          setTranscript("connecting");
          retryTimer = window.setTimeout(() => void connect(sampleRate, channels), 1000 * reconnects);
        };
      } catch (cause) {
        if (stopped) return;
        setTranscript("error");
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    };

    navigator.mediaDevices
      // Echo cancellation keeps the call's sound out of the microphone channel.
      // Noise suppression and automatic gain are off: they smear consonants
      // ("mom" heard as "mop"), and Deepgram copes with room noise better
      // than with processed speech.
      .getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      })
      .then((granted) => {
        if (stopped) {
          granted.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = granted;
        try {
          context = new AudioContext({ sampleRate: CAPTURE_RATE });
        } catch {
          context = new AudioContext();
        }
        const source = context.createMediaStreamSource(granted);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        // Audio is sent in ~85 ms chunks. ScriptProcessor is old but works in
        // every WebKit, needs no extra files, and is plenty for one voice
        // channel. It only runs when connected to the output, so it goes
        // through a silent gain node.
        const processor = context.createScriptProcessor(4096, 1, 1);
        const mute = context.createGain();
        mute.gain.value = 0;
        source.connect(processor);
        processor.connect(mute);
        mute.connect(context.destination);
        processor.onaudioprocess = (event) => {
          if (socket?.readyState !== WebSocket.OPEN) return;
          const mic = event.inputBuffer.getChannelData(0);
          socket.send(callAudioOn ? toPcm16Stereo(mic, callQueue.take(mic.length)) : toPcm16(mic));
        };

        setMic("live");
        const sampleRate = context.sampleRate;
        void (async () => {
          // Hear the call too, when macOS allows it and the rates line up.
          if (nativeAvailable() && sampleRate === CAPTURE_RATE) {
            try {
              await startSystemAudio((chunk) => callQueue.push(chunk));
              if (stopped) return;
              callAudioOn = true;
              setCallAudio("on");
              setCallAudioNote(null);
            } catch (cause) {
              setCallAudio("unavailable");
              setCallAudioNote(cause instanceof Error ? cause.message : String(cause));
            }
          } else if (nativeAvailable()) {
            setCallAudio("unavailable");
            setCallAudioNote("Your Mac's audio runs at an unusual rate, so only the microphone is used.");
          }
          if (!stopped) void connect(sampleRate, callAudioOn ? 2 : 1);
        })();

        const samples = new Uint8Array(analyser.fftSize);
        let last = 0;
        const sample = (time: number) => {
          frame = requestAnimationFrame(sample);
          if (time - last < 90) return;
          last = time;
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const value of samples) sum += ((value - 128) / 128) ** 2;
          const level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
          setLevels((previous) => [...previous.slice(1), level]);
        };
        frame = requestAnimationFrame(sample);
      })
      .catch((cause: unknown) => {
        if (stopped) return;
        const name = cause instanceof DOMException ? cause.name : "";
        setMic(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
      });

    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
      cancelAnimationFrame(frame);
      if (socket?.readyState === WebSocket.OPEN) {
        // Ask Deepgram to finish the last words before closing.
        socket.send(JSON.stringify({ type: "CloseStream" }));
      }
      const closing = socket;
      window.setTimeout(() => closing?.close(), 1500);
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
      if (callAudioOn) void stopSystemAudio();
    };
    // elapsedSecs is read through a ref on purpose: a ticking clock must not restart capture.
  }, [active, noteId, bars]);

  return { levels, mic, transcript, error, lines, interim, callAudio, callAudioNote };
}
