/**
 * The call's audio on its way to Deepgram. It arrives from macOS in bursts
 * that don't line up with the microphone's steady 85 ms chunks, so it waits in
 * a small buffer and is handed out in step with the microphone.
 *
 * The buffer first fills to a short cushion before anything is taken. Taking
 * from an empty or nearly empty buffer would pad every gap between bursts
 * with silence and cut holes into words, which is what made the transcript
 * mishear the other side of a call. After running dry it fills the cushion
 * again, and it drops the oldest audio when it falls too far behind.
 */
export class SampleQueue {
  private chunks: Float32Array[] = [];
  private queued = 0;
  private primed = false;

  /**
   * @param cushion samples to collect before handing any out
   * @param max samples to hold at most before dropping the oldest
   */
  constructor(
    private readonly cushion: number,
    private readonly max: number,
  ) {}

  get length(): number {
    return this.queued;
  }

  push(chunk: Float32Array) {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.queued += chunk.length;
    // Drop the oldest audio rather than fall further and further behind.
    while (this.queued > this.max && this.chunks.length > 1) this.queued -= this.chunks.shift()!.length;
  }

  /** Exactly `count` samples: the call's audio once the cushion is full, silence before then. */
  take(count: number): Float32Array {
    const out = new Float32Array(count);
    if (!this.primed) {
      if (this.queued < this.cushion) return out;
      this.primed = true;
    }
    let filled = 0;
    while (filled < count && this.chunks.length > 0) {
      const head = this.chunks[0]!;
      const used = Math.min(head.length, count - filled);
      out.set(head.subarray(0, used), filled);
      filled += used;
      if (used === head.length) this.chunks.shift();
      else this.chunks[0] = head.subarray(used);
      this.queued -= used;
    }
    // Ran dry: build the cushion up again before handing out more.
    if (filled < count) this.primed = false;
    return out;
  }
}
