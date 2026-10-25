import { describe, expect, test } from "bun:test";
import { createStopwatch, elapsed, formatClock, isRunning, start, stop } from "./timer.ts";

describe("stopwatch", () => {
  test("counts only running spans", () => {
    let w = createStopwatch();
    expect(elapsed(w, 1000)).toBe(0);
    w = start(w, 1000);
    expect(isRunning(w)).toBe(true);
    expect(elapsed(w, 4000)).toBe(3000);
    w = stop(w, 4000);
    expect(elapsed(w, 99_000)).toBe(3000);
    w = start(w, 100_000);
    expect(elapsed(w, 100_500)).toBe(3500);
  });

  test("start and stop are idempotent", () => {
    const running = start(createStopwatch(), 10);
    expect(start(running, 50)).toBe(running);
    const stopped = createStopwatch(20);
    expect(stop(stopped, 50)).toBe(stopped);
  });

  test("resumes from banked time and never goes negative", () => {
    expect(elapsed(createStopwatch(5000), 0)).toBe(5000);
    expect(createStopwatch(-1).bankedMs).toBe(0);
    expect(elapsed(start(createStopwatch(), 100), 50)).toBe(0);
  });
});

describe("formatClock", () => {
  test("pads minutes and seconds", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(252_000)).toBe("04:12");
    expect(formatClock(59_999)).toBe("00:59");
    expect(formatClock(3_599_000)).toBe("59:59");
  });

  test("adds hours from one hour up", () => {
    expect(formatClock(3_600_000)).toBe("1:00:00");
    expect(formatClock(43_495_000)).toBe("12:04:55");
  });
});
