import { describe, expect, spyOn, test } from "bun:test";
import type { StockReport } from "../managers/daily-stock-manager.ts";
import { runWorkerLoop } from "./loop.ts";

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
});
