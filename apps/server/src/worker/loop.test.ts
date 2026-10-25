import { describe, expect, spyOn, test } from "bun:test";
import { runWorkerLoop } from "./loop.ts";

describe("runWorkerLoop", () => {
  test("sweeps abandoned jobs at start and on a timer, even while jobs keep coming", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    let time = 0;
    let queued = 12;
    const runs = {
      async runNext(workerId: string) {
        calls.push(`run:${workerId}`);
        time += 1_000;
        if (queued === 0) {
          controller.abort();
          return false;
        }
        queued--;
        return true;
      },
      recoverStale() {
        calls.push("recover");
        return 0;
      },
    };
    await runWorkerLoop({
      runs,
      workerId: "w",
      pollMs: 60_000,
      sweepMs: 5_000,
      now: () => time,
      signal: controller.signal,
    });
    const run = "run:w";
    expect(calls).toEqual([
      "recover",
      run,
      run,
      run,
      run,
      run,
      "recover",
      run,
      run,
      run,
      run,
      run,
      "recover",
      run,
      run,
      run,
    ]);
  });

  test("an idle loop sweeps, and an abort wakes it at once", async () => {
    const controller = new AbortController();
    let recovered = 0;
    const runs = {
      runNext: async () => false,
      recoverStale: () => {
        recovered++;
        return 0;
      },
    };
    const started = performance.now();
    setTimeout(() => controller.abort(), 20);
    await runWorkerLoop({
      runs,
      workerId: "w",
      pollMs: 60_000,
      sweepMs: 60_000,
      signal: controller.signal,
    });
    expect(recovered).toBe(1);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test("an error is logged and the loop carries on", async () => {
    const controller = new AbortController();
    const error = spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const runs = {
      async runNext() {
        calls++;
        if (calls === 1) throw new Error("database is locked");
        controller.abort();
        return false;
      },
      recoverStale: () => 0,
    };
    await runWorkerLoop({
      runs,
      workerId: "w",
      pollMs: 1,
      sweepMs: 60_000,
      signal: controller.signal,
    });
    expect(calls).toBe(2);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
