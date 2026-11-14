import { describe, expect, it } from "vitest";

import { SampleQueue } from "./audioQueue";

const ramp = (from: number, n: number) => Float32Array.from({ length: n }, (_, i) => from + i);

describe("SampleQueue", () => {
  it("waits for the cushion before handing out audio", () => {
    const queue = new SampleQueue(6, 100);
    queue.push(ramp(1, 4));
    expect([...queue.take(2)]).toEqual([0, 0]);
    expect(queue.length).toBe(4);
    queue.push(ramp(5, 4));
    expect([...queue.take(3)]).toEqual([1, 2, 3]);
  });

  it("keeps audio continuous across bursts once primed", () => {
    const queue = new SampleQueue(4, 100);
    queue.push(ramp(1, 5));
    expect([...queue.take(3)]).toEqual([1, 2, 3]);
    queue.push(ramp(6, 3));
    expect([...queue.take(4)]).toEqual([4, 5, 6, 7]);
  });

  it("refills the cushion after running dry instead of chopping words", () => {
    const queue = new SampleQueue(4, 100);
    queue.push(ramp(1, 4));
    expect([...queue.take(6)]).toEqual([1, 2, 3, 4, 0, 0]);
    queue.push(ramp(5, 2));
    // Only 2 queued, cushion is 4: silence, nothing consumed.
    expect([...queue.take(2)]).toEqual([0, 0]);
    queue.push(ramp(7, 2));
    expect([...queue.take(4)]).toEqual([5, 6, 7, 8]);
  });

  it("drops the oldest audio when too far behind", () => {
    const queue = new SampleQueue(1, 6);
    queue.push(ramp(1, 4));
    queue.push(ramp(5, 4));
    expect(queue.length).toBe(4);
    expect([...queue.take(4)]).toEqual([5, 6, 7, 8]);
  });
});
