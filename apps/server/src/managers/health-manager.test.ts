import { describe, expect, test } from "bun:test";
import { GENERATOR_VERSION } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import type { BlobStore } from "../ports.ts";
import { FakeClock, FakeDailyRepository, FakeJobQueue } from "../test-support/fakes.ts";
import { HealthManager } from "./health-manager.ts";

const NOW = Date.UTC(2026, 9, 25, 12);

function setup(blobs: BlobStore = new MemoryBlobStore()) {
  const jobs = new FakeJobQueue();
  const dailies = new FakeDailyRepository();
  const health = new HealthManager({
    jobs,
    dailies,
    blobs,
    clock: new FakeClock(NOW),
    daysAhead: 3,
    versions: { app: "abc123", runtime: "bun 1.3.13" },
    checkTimeoutMs: 20,
  });
  return { health, jobs, dailies };
}

function stock(dailies: FakeDailyRepository, day: string, size: number) {
  dailies.insert({
    day,
    size,
    attempt: 0,
    jobId: `${day}-${size}`,
    puzzleId: `${day}-${size}`,
    generatorVersion: "1",
    createdAt: 0,
  });
}

describe("HealthManager", () => {
  test("is ready when the database and the blob store answer", async () => {
    const r = await setup().health.readiness();
    expect(r.ok).toBe(true);
    expect(r.database).toMatchObject({ ok: true, error: null });
    expect(r.blobs).toMatchObject({ ok: true, error: null });
  });

  test("is not ready when the blob store fails or doesn't answer in time", async () => {
    const failing: BlobStore = {
      put: async () => {},
      get: async () => {
        throw new Error("connection refused");
      },
      delete: async () => {},
    };
    let r = await setup(failing).health.readiness();
    expect(r.ok).toBe(false);
    expect(r.blobs).toMatchObject({ ok: false, error: "connection refused" });
    const silent: BlobStore = { ...failing, get: () => new Promise(() => {}) };
    r = await setup(silent).health.readiness();
    expect(r.ok).toBe(false);
    expect(r.blobs.error).toBe("No answer within 20 ms");
    expect(r.database.ok).toBe(true);
  });

  test("is not ready when the database throws", async () => {
    const { health, jobs } = setup();
    jobs.countActive = () => {
      throw new Error("database is locked");
    };
    const r = await health.readiness();
    expect(r.ok).toBe(false);
    expect(r.database).toMatchObject({ ok: false, error: "database is locked" });
  });

  test("reports the queue, the daily stock, recent failures and versions", async () => {
    const { health, jobs, dailies } = setup();
    jobs.enqueue({
      id: "f",
      job: { kind: "verify", input: { puzzle: { v: 1, width: 1, height: 1, clues: "." } } },
      createdAt: 1,
    });
    jobs.enqueue({
      id: "q",
      job: { kind: "generate", input: { width: 5, height: 5, seed: "s" } },
      createdAt: 7,
    });
    jobs.claimNext("w", 2);
    jobs.finish("f", "w", { status: "timeout", error: "Stopped after the 45 s time limit." }, 3);
    stock(dailies, "2026-10-25", 7);
    stock(dailies, "2026-10-26", 7);
    stock(dailies, "2026-10-26", 10);
    const report = await health.report();
    expect(report.readiness.ok).toBe(true);
    expect(report.jobs).toEqual({ queued: 1, running: 0, oldestQueuedAt: 7 });
    expect(report.dailies).toEqual([
      { size: 7, days: 2 },
      { size: 10, days: 0 },
      { size: 20, days: 0 },
      { size: 40, days: 0 },
    ]);
    expect(report.failures.map((j) => [j.id, j.status, j.error])).toEqual([
      ["f", "timeout", "Stopped after the 45 s time limit."],
    ]);
    expect(report.versions).toEqual({
      app: "abc123",
      generator: GENERATOR_VERSION,
      runtime: "bun 1.3.13",
    });
    expect(report.startedAt).toBe(NOW);
  });
});
