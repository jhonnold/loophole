import { describe, expect, spyOn, test } from "bun:test";
import { runWorkerLoop } from "./loop.ts";

describe("runWorkerLoop", () => {
  test("runs jobs back to back, recovers when idle, and stops on abort", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    let queued = 3;
    const runs = {
      async runNext(workerId: string) {
        calls.push(`run:${workerId}`);
        if (queued === 0) return false;
        queued--;
        return true;
      },
      recoverStale() {
        calls.push("recover");
        controller.abort();
        return 0;
      },
    };
    await runWorkerLoop({ runs, workerId: "w", pollMs: 60_000, signal: controller.signal });
    expect(calls).toEqual(["run:w", "run:w", "run:w", "run:w", "recover"]);
  });

  test("an abort wakes an idle loop at once", async () => {
    const controller = new AbortController();
    const runs = { runNext: async () => false, recoverStale: () => 0 };
    const started = performance.now();
    setTimeout(() => controller.abort(), 20);
    await runWorkerLoop({ runs, workerId: "w", pollMs: 60_000, signal: controller.signal });
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
    await runWorkerLoop({ runs, workerId: "w", pollMs: 1, signal: controller.signal });
    expect(calls).toBe(2);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
