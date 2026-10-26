import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { REPORTS_PER_ACCOUNT } from "../managers/report-manager.ts";
import { SUBMISSIONS_PER_ACCOUNT } from "../managers/submission-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { healthManager } from "../test-support/health.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
import type { Problem } from "./problem.ts";
import { SESSION_COOKIE } from "./session-cookie.ts";

const UNIQUE = { width: 2, height: 2, clues: "2222" };

function setup() {
  const db = openDatabase(":memory:");
  const clock = new FakeClock(Date.UTC(2026, 9, 25, 12));
  const deps = accountDeps(db, clock);
  const puzzles = new PuzzleManager({
    puzzles: new SqlitePuzzleRepository(db),
    blobs: new MemoryBlobStore(),
    clock,
  });
  const queue = new SqliteJobQueue(db);
  const jobs = new JobManager({
    jobs: queue,
    clock,
    newId: sequentialIds("j"),
    maxQueued: 100,
    maxPendingPerRequester: 10,
  });
  const app = createApp({
    puzzles,
    jobs,
    ...dailyDeps(db, clock, puzzles),
    progress: sqliteProgress(db, puzzles, clock),
    health: healthManager(db, clock),
    ...submissionDeps(db, clock, puzzles, jobs),
    ...deps,
  });

  /** A request as the web app sends it: JSON, same origin, with an optional session cookie. */
  const send = (
    method: string,
    path: string,
    body?: unknown,
    options: { cookie?: string; headers?: Record<string, string> } = {},
  ) => {
    const headers: Record<string, string> = { "Sec-Fetch-Site": "same-origin", ...options.headers };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (options.cookie !== undefined) headers.Cookie = `${SESSION_COOKIE}=${options.cookie}`;
    return app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  /** Signs up and logs in; confirms the email unless told not to. Returns the session cookie. */
  const player = async (
    email: string,
    options: { confirmed?: boolean; admin?: boolean } = {},
  ): Promise<string> => {
    await send("POST", "/api/auth/signup", { email, password: "hunter22", captchaToken: "c" });
    if (options.confirmed ?? true) {
      const token = deps.mailer.sent.at(-1)?.text.match(/#token=(\S+)/)?.[1];
      await send("POST", "/api/auth/verify-email", { token });
    }
    if (options.admin) deps.users.setAdmin(email, true);
    const res = await send("POST", "/api/auth/login", { email, password: "hunter22" });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    if (cookie === undefined) throw new Error("not logged in");
    return cookie.split(";")[0].slice(SESSION_COOKIE.length + 1);
  };

  const savePuzzle = (id: string, clues = [2, 2, 2, 2]) =>
    puzzles.saveGenerated(id, {
      puzzle: serializePuzzle(createPuzzle(2, 2, clues)),
      solution: "112211121121",
      steps: [],
    });

  return { app, clock, queue, send, player, savePuzzle };
}

async function expectProblem(res: Response, status: number, title?: string): Promise<Problem> {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toStartWith("application/problem+json");
  const body = (await res.json()) as Problem;
  if (title !== undefined) expect(body.title).toBe(title);
  return body;
}

describe("POST /api/submissions", () => {
  test("queues the puzzle's verification and answers 202 with the pending submission", async () => {
    const { send, player, queue } = setup();
    const cookie = await player("ann@example.com");
    const res = await send("POST", "/api/submissions", UNIQUE, { cookie });
    expect(res.status).toBe(202);
    expect(res.headers.get("Location")).toBe("/api/submissions/s-1");
    expect(await res.json()).toEqual({
      id: "s-1",
      width: 2,
      height: 2,
      status: "pending",
      verdict: null,
      puzzleId: null,
      createdAt: "2026-10-25T12:00:00.000Z",
      decidedAt: null,
    });
    expect(queue.get("j-1")).toMatchObject({ kind: "verify", input: { submissionId: "s-1" } });
  });

  test("needs a login (401) and a confirmed email (403)", async () => {
    const { send, player } = setup();
    await expectProblem(await send("POST", "/api/submissions", UNIQUE), 401);
    const cookie = await player("bob@example.com", { confirmed: false });
    await expectProblem(
      await send("POST", "/api/submissions", UNIQUE, { cookie }),
      403,
      "Email not confirmed",
    );
  });

  test("is refused from another site (CSRF)", async () => {
    const { send, player } = setup();
    const cookie = await player("ann@example.com");
    const res = await send("POST", "/api/submissions", UNIQUE, {
      cookie,
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    await expectProblem(res, 403, "Cross-site request refused");
  });

  test("validates the size and clues", async () => {
    const { send, player } = setup();
    const cookie = await player("ann@example.com");
    for (const body of [
      { width: 2, height: 2, clues: "222" },
      { width: 2, height: 2, clues: "22x2" },
      { width: 101, height: 1, clues: "." },
      { width: 0, height: 1, clues: "" },
      { ...UNIQUE, seed: "s" },
    ]) {
      await expectProblem(await send("POST", "/api/submissions", body, { cookie }), 400);
    }
  });

  test("answers 429 with Retry-After past the account's limit", async () => {
    const { send, player } = setup();
    const cookie = await player("ann@example.com");
    for (let i = 0; i < SUBMISSIONS_PER_ACCOUNT.limit; i++) {
      // Distinct clues each time, so none is a duplicate decided without a job.
      const clues = i.toString(4).padStart(4, ".").slice(-4);
      const res = await send("POST", "/api/submissions", { ...UNIQUE, clues }, { cookie });
      expect(res.status).toBe(202);
    }
    const res = await send("POST", "/api/submissions", UNIQUE, { cookie });
    await expectProblem(res, 429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  test("clues that are already published come back published as a duplicate", async () => {
    const { send, player, savePuzzle } = setup();
    await savePuzzle("p1");
    const cookie = await player("ann@example.com");
    const res = await send("POST", "/api/submissions", UNIQUE, { cookie });
    expect(await res.json()).toMatchObject({
      status: "published",
      verdict: "duplicate",
      puzzleId: "p1",
    });
  });
});

describe("GET /api/submissions", () => {
  test("lists and reads only the player's own submissions", async () => {
    const { send, player } = setup();
    const ann = await player("ann@example.com");
    const bob = await player("bob@example.com");
    await send("POST", "/api/submissions", UNIQUE, { cookie: ann });
    const list = (await (
      await send("GET", "/api/submissions", undefined, { cookie: ann })
    ).json()) as {
      items: { id: string }[];
    };
    expect(list.items.map((s) => s.id)).toEqual(["s-1"]);
    expect((await send("GET", "/api/submissions/s-1", undefined, { cookie: ann })).status).toBe(
      200,
    );
    await expectProblem(await send("GET", "/api/submissions/s-1", undefined, { cookie: bob }), 404);
    await expectProblem(await send("GET", "/api/submissions"), 401);
    await expectProblem(await send("GET", "/api/submissions/s-1"), 401);
  });
});

describe("reports and unpublishing", () => {
  test("a logged-in player reports a published puzzle; admins list, dismiss and unpublish", async () => {
    const { send, player, savePuzzle } = setup();
    await savePuzzle("p1");
    const ann = await player("ann@example.com", { confirmed: false });
    const admin = await player("root@example.com", { admin: true });

    const report = await send(
      "POST",
      "/api/puzzles/p1/report",
      { reason: " rude " },
      { cookie: ann },
    );
    expect(report.status).toBe(204);
    const list = await send("GET", "/api/admin/reports", undefined, { cookie: admin });
    expect(await list.json()).toEqual({
      items: [
        {
          puzzleId: "p1",
          width: 2,
          height: 2,
          origin: "generated",
          createdAt: "2026-10-25T12:00:00.000Z",
          count: 1,
          reports: [{ reason: "rude", createdAt: "2026-10-25T12:00:00.000Z" }],
        },
      ],
    });

    expect(
      (await send("DELETE", "/api/admin/puzzles/p1/reports", undefined, { cookie: admin })).status,
    ).toBe(204);
    expect(
      await (await send("GET", "/api/admin/reports", undefined, { cookie: admin })).json(),
    ).toEqual({ items: [] });

    const res = await send("POST", "/api/admin/puzzles/p1/unpublish", undefined, { cookie: admin });
    expect(res.status).toBe(204);
    // Gone for players and from the list; admins can still open it.
    await expectProblem(await send("GET", "/api/puzzles/p1"), 404);
    await expectProblem(await send("GET", "/api/puzzles/p1", undefined, { cookie: ann }), 404);
    await expectProblem(await send("POST", "/api/puzzles/p1/hint", { edges: "000000000000" }), 404);
    expect((await send("GET", "/api/puzzles/p1", undefined, { cookie: admin })).status).toBe(200);
    expect(await (await send("GET", "/api/puzzles")).json()).toEqual({ items: [] });
    await expectProblem(
      await send("POST", "/api/puzzles/p1/report", { reason: "x" }, { cookie: ann }),
      404,
    );
  });

  test("a submission whose puzzle is unpublished reads as removed, with no link, to its creator", async () => {
    const { send, player, savePuzzle } = setup();
    await savePuzzle("p1");
    const ann = await player("ann@example.com");
    const admin = await player("root@example.com", { admin: true });
    const duplicate = await send("POST", "/api/submissions", UNIQUE, { cookie: ann });
    expect(await duplicate.json()).toMatchObject({
      id: "s-1",
      verdict: "duplicate",
      puzzleId: "p1",
    });
    expect(
      (await send("POST", "/api/admin/puzzles/p1/unpublish", undefined, { cookie: admin })).status,
    ).toBe(204);
    const removed = { status: "rejected", verdict: "removed", puzzleId: null };
    expect(
      await (await send("GET", "/api/submissions/s-1", undefined, { cookie: ann })).json(),
    ).toMatchObject(removed);
    expect(
      await (await send("GET", "/api/submissions", undefined, { cookie: ann })).json(),
    ).toMatchObject({ items: [removed] });
  });

  test("reporting needs a login, a reason and an existing puzzle, and is rate-limited", async () => {
    const { send, player, savePuzzle } = setup();
    await savePuzzle("p1");
    await expectProblem(await send("POST", "/api/puzzles/p1/report", { reason: "x" }), 401);
    const ann = await player("ann@example.com");
    for (const body of [{ reason: "   " }, { reason: "x".repeat(501) }, {}]) {
      await expectProblem(await send("POST", "/api/puzzles/p1/report", body, { cookie: ann }), 400);
    }
    await expectProblem(
      await send("POST", "/api/puzzles/nope/report", { reason: "x" }, { cookie: ann }),
      404,
    );
    for (let i = 1; i < REPORTS_PER_ACCOUNT.limit; i++) {
      await send("POST", "/api/puzzles/p1/report", { reason: `r${i}` }, { cookie: ann });
    }
    await expectProblem(
      await send("POST", "/api/puzzles/p1/report", { reason: "x" }, { cookie: ann }),
      429,
    );
  });

  test("admin routes refuse guests (401), players (403) and other sites (403)", async () => {
    const { send, player, savePuzzle } = setup();
    await savePuzzle("p1");
    const ann = await player("ann@example.com");
    const admin = await player("root@example.com", { admin: true });
    const routes = [
      ["GET", "/api/admin/reports"],
      ["POST", "/api/admin/puzzles/p1/unpublish"],
      ["DELETE", "/api/admin/puzzles/p1/reports"],
    ] as const;
    for (const [method, path] of routes) {
      await expectProblem(await send(method, path), 401);
      await expectProblem(await send(method, path, undefined, { cookie: ann }), 403, "Admins only");
    }
    const crossSite = { cookie: admin, headers: { "Sec-Fetch-Site": "cross-site" } };
    await expectProblem(
      await send("POST", "/api/admin/puzzles/p1/unpublish", undefined, crossSite),
      403,
    );
    await expectProblem(
      await send("POST", "/api/admin/puzzles/nope/unpublish", undefined, { cookie: admin }),
      404,
    );
    expect((await send("GET", "/api/puzzles/p1")).status).toBe(200);
  });
});
