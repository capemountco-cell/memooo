/** Bars drawn from microphone levels (0–1). Flat when there is no sound. */
export function Waveform({ levels, height = 20 }: { levels: number[]; height?: number }) {
  return (
    <span className="waveform" aria-hidden style={{ height }}>
      {levels.map((level, index) => (
        <span key={index} style={{ height: Math.max(2, Math.round(level * height)) }} />
      ))}
    </span>
  );
}
