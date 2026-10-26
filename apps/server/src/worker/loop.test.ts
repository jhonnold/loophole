import { describe, expect, spyOn, test } from "bun:test";
import { JOB_PRIORITY } from "../domain.ts";
import type { StockReport } from "../managers/daily-stock-manager.ts";
import type { RunNextOptions } from "../managers/job-run-manager.ts";
import { runVerifyLane, runWorkerLoop } from "./loop.ts";

/** A scheduler that reports nothing to do. */
const stocked = { stock: (): StockReport => ({ queued: 0, missingToday: [] }) };

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
        return { requeued: 0, lost: 0 };
      },
    };
    await runWorkerLoop({
      runs,
      dailies: stocked,
      workerId: "w",
      pollMs: 60_000,
      sweepMs: 5_000,
      stockMs: 60_000,
      drainMs: 60_000,
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
        return { requeued: 0, lost: 0 };
      },
    };
    const started = performance.now();
    setTimeout(() => controller.abort(), 20);
    await runWorkerLoop({
      runs,
      dailies: stocked,
      workerId: "w",
      pollMs: 60_000,
      sweepMs: 60_000,
      stockMs: 60_000,
      drainMs: 60_000,
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
      recoverStale: () => ({ requeued: 0, lost: 0 }),
    };
    await runWorkerLoop({
      runs,
      dailies: stocked,
      workerId: "w",
      pollMs: 1,
      sweepMs: 60_000,
      stockMs: 60_000,
      drainMs: 60_000,
      signal: controller.signal,
    });
    expect(calls).toBe(2);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  test("stocks daily puzzles at start and on a timer, and logs today's that stay missing", async () => {
    const controller = new AbortController();
    const error = spyOn(console, "error").mockImplementation(() => {});
    const log = spyOn(console, "log").mockImplementation(() => {});
    let time = 0;
    const reports: StockReport[] = [
      { queued: 8, missingToday: [7, 10, 20, 40] },
      { queued: 0, missingToday: [40] },
      { queued: 0, missingToday: [] },
    ];
    let stocks = 0;
    const dailies = {
      stock() {
        const report = reports[stocks++];
        if (stocks === reports.length) controller.abort();
        return report;
      },
    };
    const runs = {
      async runNext() {
        time += 30_000;
        return false;
      },
      recoverStale: () => ({ requeued: 0, lost: 0 }),
    };
    await runWorkerLoop({
      runs,
      dailies,
      workerId: "w",
      pollMs: 1,
      sweepMs: 60_000,
      stockMs: 60_000,
      drainMs: 60_000,
      now: () => time,
      signal: controller.signal,
    });
    expect(stocks).toBe(3);
    expect(log).toHaveBeenCalledWith("Queued 8 daily puzzle generation(s)");
    // Only the 40×40, missing at two checks in a row, is late.
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("Today's daily puzzles are late: 40×40 not generated yet");
    error.mockRestore();
    log.mockRestore();
  });

  test("on stop it claims nothing more, and stops a job still running after drainMs", async () => {
    const controller = new AbortController();
    const seen: RunNextOptions[] = [];
    let cancelledAfter = -1;
    const runs = {
      async runNext(_workerId: string, options: RunNextOptions = {}) {
        seen.push(options);
        // A long job: it ends only when the loop cancels it.
        const started = performance.now();
        await new Promise<void>((resolve) =>
          options.cancel?.addEventListener("abort", () => resolve()),
        );
        cancelledAfter = performance.now() - started;
        return true;
      },
      recoverStale: () => ({ requeued: 0, lost: 0 }),
    };
    setTimeout(() => controller.abort(), 20);
    await runWorkerLoop({
      runs,
      dailies: stocked,
      workerId: "w",
      pollMs: 1,
      sweepMs: 60_000,
      stockMs: 60_000,
      drainMs: 50,
      signal: controller.signal,
    });
    // One claim only: after the stop, the loop ended instead of claiming again.
    expect(seen).toHaveLength(1);
    expect(seen[0].cancel?.aborted).toBe(true);
    expect(cancelledAfter).toBeGreaterThanOrEqual(60);
  });

  test("a job that ends within drainMs of the stop is not cancelled", async () => {
    const controller = new AbortController();
    let cancel: AbortSignal | undefined;
    const runs = {
      async runNext(_workerId: string, options: RunNextOptions = {}) {
        cancel = options.cancel;
        controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 10));
        return true;
      },
      recoverStale: () => ({ requeued: 0, lost: 0 }),
    };
    await runWorkerLoop({
      runs,
      dailies: stocked,
      workerId: "w",
      pollMs: 1,
      sweepMs: 60_000,
      stockMs: 60_000,
      drainMs: 1_000,
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cancel?.aborted).toBe(false);
  });
});

describe("runVerifyLane", () => {
  test("claims only verifications, polls while there are none, and stops like the main loop", async () => {
    const controller = new AbortController();
    const calls: { workerId: string; options: RunNextOptions }[] = [];
    const runs = {
      async runNext(workerId: string, options: RunNextOptions = {}) {
        calls.push({ workerId, options });
        if (calls.length === 3) controller.abort();
        return calls.length === 1;
      },
    };
    await runVerifyLane({
      runs,
      workerId: "w/verify",
      pollMs: 1,
      drainMs: 60_000,
      signal: controller.signal,
    });
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.workerId).toBe("w/verify");
      expect(call.options.maxPriority).toBe(JOB_PRIORITY.verify);
    }
  });
});
