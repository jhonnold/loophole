import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
import type { Problem } from "./problem.ts";

const SOLUTION = "112211121121";

function setup(options: { webDir?: string; maxQueued?: number } = {}) {
  const db = openDatabase(":memory:");
  const clock = new FakeClock(Date.UTC(2026, 9, 25, 12));
  const repo = new SqlitePuzzleRepository(db);
  const queue = new SqliteJobQueue(db);
  const puzzles = new PuzzleManager({
    puzzles: repo,
    blobs: new MemoryBlobStore(),
    clock,
  });
  const jobs = new JobManager({
    jobs: queue,
    clock,
    newId: sequentialIds("j"),
    maxQueued: options.maxQueued ?? 10,
  });
  const app = createApp({
    puzzles,
    jobs,
    ...accountDeps(db, clock),
    hints: new HintManager({ puzzles }),
    progress: sqliteProgress(db, puzzles, clock),
    ...submissionDeps(db, clock, puzzles, jobs),
    webDir: options.webDir,
  });
  const puzzleIds = sequentialIds("p");
  const savePuzzle = () =>
    puzzles.saveGenerated(puzzleIds(), {
      puzzle: serializePuzzle(
        createPuzzle(2, 2, [2, 2, 2, 2], { seed: "s", meta: { generator: "1" } }),
      ),
      solution: SOLUTION,
      steps: [],
    });
  return { app, repo, queue, clock, savePuzzle };
}

const postJson = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

async function expectProblem(res: Response, status: number): Promise<Problem> {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toStartWith("application/problem+json");
  const body = (await res.json()) as Problem;
  expect(body).toMatchObject({ type: "about:blank", status });
  return body;
}

describe("GET /api/health", () => {
  test("answers ok", async () => {
    const res = await setup().app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("puzzles", () => {
  test("GET /api/puzzles/{id} returns the clues and never the solution", async () => {
    const { app, savePuzzle } = setup();
    const id = await savePuzzle();
    const res = await app.request(`/api/puzzles/${id}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      id,
      puzzle: { v: 1, width: 2, height: 2, clues: "2222", seed: "s", meta: { generator: "1" } },
      origin: "generated",
      createdAt: "2026-10-25T12:00:00.000Z",
    });
    expect(text).not.toContain(SOLUTION);
    expect(text).not.toContain("solution");
  });

  test("GET /api/puzzles/{id} is 404 for unknown and unpublished puzzles", async () => {
    const { app, repo, savePuzzle } = setup();
    const id = await savePuzzle();
    const record = repo.get(id);
    if (record === null) throw new Error("missing");
    repo.insert({ ...record, id: "hidden", status: "unpublished" });
    await expectProblem(await app.request("/api/puzzles/nope"), 404);
    await expectProblem(await app.request("/api/puzzles/hidden"), 404);
  });

  test("GET /api/puzzles lists recent published puzzles, newest first", async () => {
    const { app, clock, savePuzzle } = setup();
    const a = await savePuzzle();
    clock.advance(1000);
    const b = await savePuzzle();
    const res = await app.request("/api/puzzles?limit=1");
    expect(await res.json()).toEqual({
      items: [
        { id: b, width: 2, height: 2, origin: "generated", createdAt: "2026-10-25T12:00:01.000Z" },
      ],
    });
    const all = (await (await app.request("/api/puzzles")).json()) as { items: { id: string }[] };
    expect(all.items.map((p) => p.id)).toEqual([b, a]);
  });

  test("GET /api/puzzles rejects a bad limit", async () => {
    const body = await expectProblem(await setup().app.request("/api/puzzles?limit=0"), 400);
    expect(body.errors?.[0].path).toBe("limit");
  });
});

describe("POST /api/puzzles/{id}/hint", () => {
  test("answers with the next step, in wire shape", async () => {
    const { app, savePuzzle } = setup();
    const id = await savePuzzle();
    const res = await app.request(`/api/puzzles/${id}/hint`, postJson({ edges: "000000000000" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; changes: { edge: number; state: string }[] };
    expect(body.kind).toBe("step");
    for (const { edge, state } of body.changes) {
      expect(state).toBe(SOLUTION[edge] === "1" ? "line" : "cross");
    }
  });

  test("points out a wrong mark and never sends the solution", async () => {
    const { app, savePuzzle } = setup();
    const id = await savePuzzle();
    const res = await app.request(`/api/puzzles/${id}/hint`, postJson({ edges: "200000000000" }));
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ kind: "mistake", edge: 0, count: 1 });
    expect(text).not.toContain(SOLUTION);
  });

  test("rejects a board of the wrong size, bad characters and unknown fields", async () => {
    const { app, savePuzzle } = setup();
    const id = await savePuzzle();
    const url = `/api/puzzles/${id}/hint`;
    const short = await expectProblem(await app.request(url, postJson({ edges: "000" })), 400);
    expect(short.detail).toContain("expected 12 characters");
    await expectProblem(await app.request(url, postJson({ edges: "00000000000x" })), 400);
    await expectProblem(await app.request(url, postJson({ edges: "0", extra: 1 })), 400);
  });

  test("is 404 for an unknown puzzle", async () => {
    const { app } = setup();
    await expectProblem(await app.request("/api/puzzles/nope/hint", postJson({ edges: "" })), 404);
  });

  test("refuses a POST from another site (CSRF protection)", async () => {
    const { app, savePuzzle } = setup();
    const id = await savePuzzle();
    const res = await app.request(`/api/puzzles/${id}/hint`, {
      ...postJson({ edges: "000000000000" }),
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
    });
    await expectProblem(res, 403);
  });
});

describe("jobs", () => {
  test("POST /api/jobs/generate queues a job and points at it", async () => {
    const { app, queue } = setup();
    const res = await app.request(
      "/api/jobs/generate",
      postJson({ width: 10, height: 7, seed: "x" }),
    );
    expect(res.status).toBe(202);
    expect(res.headers.get("Location")).toBe("/api/jobs/j-1");
    expect(await res.json()).toEqual({
      id: "j-1",
      kind: "generate",
      status: "queued",
      progress: 0,
      result: null,
      error: null,
      createdAt: "2026-10-25T12:00:00.000Z",
      startedAt: null,
      finishedAt: null,
    });
    expect(queue.get("j-1")?.input).toEqual({ width: 10, height: 7, seed: "x" });
  });

  test("POST /api/jobs/generate validates the body", async () => {
    const { app } = setup();
    for (const body of [
      { width: 0, height: 5 },
      { width: 101, height: 5 },
      { width: 5.5, height: 5 },
      { width: 5 },
      { width: 5, height: 5, seed: "" },
      { width: 5, height: 5, seed: "x".repeat(129) },
      { width: 5, height: 5, extra: true },
    ]) {
      const problem = await expectProblem(
        await app.request("/api/jobs/generate", postJson(body)),
        400,
      );
      expect(problem.errors?.length).toBeGreaterThan(0);
    }
    await expectProblem(await app.request("/api/jobs/generate", postJson("{not json")), 400);
  });

  test("POST /api/jobs/generate refuses bodies over 64 KiB and non-JSON bodies", async () => {
    const { app, queue } = setup();
    const big = JSON.stringify({ width: 5, height: 5, seed: "s", pad: "x".repeat(100 * 1024) });
    await expectProblem(await app.request("/api/jobs/generate", postJson(big)), 413);
    const text = { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" };
    await expectProblem(await app.request("/api/jobs/generate", text), 415);
    expect(queue.countQueued()).toBe(0);
  });

  test("ids longer than 64 characters are 400 problems", async () => {
    const { app } = setup();
    const long = "x".repeat(65);
    await expectProblem(await app.request(`/api/puzzles/${long}`), 400);
    await expectProblem(await app.request(`/api/jobs/${long}`), 400);
  });

  test("POST /api/jobs/generate is 503 when the queue is full", async () => {
    const { app } = setup({ maxQueued: 1 });
    await app.request("/api/jobs/generate", postJson({ width: 5, height: 5 }));
    await expectProblem(
      await app.request("/api/jobs/generate", postJson({ width: 5, height: 5 })),
      503,
    );
  });

  test("GET /api/jobs/{id} reports progress and the puzzle id when done", async () => {
    const { app, queue, clock } = setup();
    await app.request("/api/jobs/generate", postJson({ width: 5, height: 5, seed: "x" }));
    queue.claimNext("w", clock.now());
    queue.setProgress("j-1", "w", 0.5, clock.now());
    expect(await (await app.request("/api/jobs/j-1")).json()).toMatchObject({
      status: "running",
      progress: 0.5,
      startedAt: "2026-10-25T12:00:00.000Z",
    });
    queue.finish(
      "j-1",
      "w",
      { status: "done", result: { kind: "generate", puzzleId: "p-9" } },
      clock.now(),
    );
    expect(await (await app.request("/api/jobs/j-1")).json()).toMatchObject({
      status: "done",
      progress: 1,
      result: { puzzleId: "p-9" },
    });
    await expectProblem(await app.request("/api/jobs/nope"), 404);
  });
});

describe("other paths", () => {
  test("unknown API paths are 404 problems", async () => {
    await expectProblem(await setup().app.request("/api/nothing"), 404);
    await expectProblem(await setup().app.request("/elsewhere"), 404);
  });

  test("serves the web app with index.html for client-side routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loophole-web-"));
    try {
      writeFileSync(join(dir, "index.html"), "<html>app</html>");
      writeFileSync(join(dir, "robots.txt"), "User-agent: *");
      const { app } = setup({ webDir: dir });
      expect(await (await app.request("/robots.txt")).text()).toBe("User-agent: *");
      expect(await (await app.request("/")).text()).toBe("<html>app</html>");
      expect(await (await app.request("/play/abc")).text()).toBe("<html>app</html>");
      await expectProblem(await app.request("/api/nothing"), 404);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
