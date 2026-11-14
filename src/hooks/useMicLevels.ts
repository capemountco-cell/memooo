import { useEffect, useState } from "react";

export type MicState = "off" | "asking" | "live" | "denied" | "unavailable";

/**
 * Microphone loudness as `bars` values between 0 and 1, newest last, while
 * `active` is true. The stream is released as soon as `active` turns false.
 *
 * This is the first step of capture: it proves Captain can hear the room and
 * gives the waveform something real to draw.
 */
export function useMicLevels(active: boolean, bars: number): { levels: number[]; state: MicState } {
  const [levels, setLevels] = useState<number[]>(() => Array(bars).fill(0));
  const [state, setState] = useState<MicState>("off");

  useEffect(() => {
    if (!active) {
      setState("off");
      setLevels(Array(bars).fill(0));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unavailable");
      return;
    }

    let stopped = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let frame = 0;
    setState("asking");

    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((granted) => {
        if (stopped) {
          granted.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = granted;
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(granted).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        setState("live");

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
      .catch((error: unknown) => {
        if (stopped) return;
        const name = error instanceof DOMException ? error.name : "";
        setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
      });

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
    };
  }, [active, bars]);

  return { levels, state };
}
