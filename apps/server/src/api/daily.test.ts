import { describe, expect, test } from "bun:test";
import type { z } from "@hono/zod-openapi";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps, SMALL_DAILY, storeDaily } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { healthManager } from "../test-support/health.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
import type { DailySetSchema, DailySummarySchema, LeaderboardSchema } from "./daily-schemas.ts";
import type { Problem } from "./problem.ts";
import type { PuzzleSchema } from "./schemas.ts";
import { SESSION_COOKIE } from "./session-cookie.ts";

type DailySet = z.infer<typeof DailySetSchema>;
type DailySummary = z.infer<typeof DailySummarySchema>;
type Leaderboard = z.infer<typeof LeaderboardSchema>;
type Puzzle = z.infer<typeof PuzzleSchema>;

// The test dailies are 2×2 all 2s; the only loop runs around the outside.
const SOLVED = SMALL_DAILY.solution;
const EMPTY = "000000000000";
const MIDNIGHT = Date.UTC(2026, 9, 26);
const T0 = MIDNIGHT - 2 * 60 * 60 * 1000;

async function setup() {
  const db = openDatabase(":memory:");
  const clock = new FakeClock(T0);
  const deps = accountDeps(db, clock);
  const puzzles = new PuzzleManager({
    puzzles: new SqlitePuzzleRepository(db),
    blobs: new MemoryBlobStore(),
    clock,
  });
  const jobs = new JobManager({
    jobs: new SqliteJobQueue(db),
    clock,
    newId: sequentialIds("j"),
    maxQueued: 10,
    maxPendingPerRequester: 10,
  });
  const daily = dailyDeps(db, clock, puzzles);
  await storeDaily(daily.dailyRepo, puzzles, "2026-10-24", "d24");
  await storeDaily(daily.dailyRepo, puzzles, "2026-10-25", "d25");
  await storeDaily(daily.dailyRepo, puzzles, "2026-10-26", "d26");
  const app = createApp({
    puzzles,
    jobs,
    progress: sqliteProgress(db, puzzles, clock),
    health: healthManager(db, clock),
    ...submissionDeps(db, clock, puzzles, jobs),
    ...daily,
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
    const env = { requestIP: () => ({ address: "198.51.100.7" }) };
    return app.request(
      path,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      env,
    );
  };

  /** Signs up and logs in `email`, confirming it unless told not to. */
  const player = async (email: string, confirm = true) => {
    await send("POST", "/api/auth/signup", { email, password: "hunter22", captchaToken: "cap" });
    const user = deps.users.getByEmail(email);
    if (user === null) throw new Error("no user");
    if (confirm) deps.users.markEmailVerified(user.id, 1);
    const res = await send("POST", "/api/auth/login", { email, password: "hunter22" });
    const cookie = res.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
      ?.split(";")[0]
      .slice(SESSION_COOKIE.length + 1);
    if (cookie === undefined) throw new Error("no session cookie");
    return { id: user.id, cookie };
  };

  /** Starts and finishes a ranked attempt at d25 after `ms`. */
  const solve = async (who: { id: string; cookie: string }, ms: number) => {
    const path = `/api/users/${who.id}/attempts/d25`;
    await send("POST", path, undefined, { cookie: who.cookie });
    clock.advance(ms);
    return send("POST", `${path}/finish`, { edges: SOLVED, elapsedMs: ms }, { cookie: who.cookie });
  };

  return { db, clock, deps, send, player, solve };
}

async function expectProblem(res: Response, status: number, title?: string): Promise<Problem> {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toStartWith("application/problem+json");
  const body = (await res.json()) as Problem;
  if (title !== undefined) expect(body.title).toBe(title);
  return body;
}

describe("GET /api/daily (FR-22)", () => {
  test("lists today's puzzles by size, and switches at 00:00 UTC", async () => {
    const { clock, send } = await setup();
    expect(await (await send("GET", "/api/daily")).json()).toEqual({
      day: "2026-10-25",
      live: true,
      nextAt: "2026-10-26T00:00:00.000Z",
      puzzles: [
        { size: 7, level: "hard", puzzleId: "d25" },
        { size: 10, level: "hard", puzzleId: null },
        { size: 20, level: "hard", puzzleId: null },
        { size: 40, level: "hard", puzzleId: null },
      ],
    });
    const past = (await (await send("GET", "/api/daily?day=2026-10-24")).json()) as DailySet;
    expect(past).toMatchObject({ day: "2026-10-24", live: false });
    expect(past.puzzles[0]).toEqual({ size: 7, level: "hard", puzzleId: "d24" });
    await expectProblem(await send("GET", "/api/daily?day=2026-10-26"), 404);
    await expectProblem(await send("GET", "/api/daily?day=2026-02-30"), 400);
    clock.time = MIDNIGHT;
    const next = (await (await send("GET", "/api/daily")).json()) as DailySet;
    expect(next).toMatchObject({ day: "2026-10-26", live: true });
    expect(next.puzzles[0]).toEqual({ size: 7, level: "hard", puzzleId: "d26" });
  });

  test("a daily is served with clues only, no seed or generator version, and only from its day (FR-25)", async () => {
    const { clock, send, player } = await setup();
    const res = await send("GET", "/api/puzzles/d25");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Puzzle;
    expect(body.puzzle).toEqual({ v: 1, width: 2, height: 2, clues: "2222" });
    const text = JSON.stringify(body);
    expect(text).not.toContain("secret-seed");
    expect(text).not.toContain(SOLVED);
    // Tomorrow's is hidden from the puzzle, hint and progress routes until midnight.
    await expectProblem(await send("GET", "/api/puzzles/d26"), 404);
    await expectProblem(await send("POST", "/api/puzzles/d26/hint", { edges: EMPTY }), 404);
    const ann = await player("ann@example.com");
    const progress = {
      edges: EMPTY,
      elapsedMs: 1,
      assisted: false,
      baseVersion: null,
      device: "b",
    };
    await expectProblem(
      await send("PUT", `/api/users/${ann.id}/progress/d26`, progress, { cookie: ann.cookie }),
      404,
      "Puzzle not found",
    );
    // Dailies aren't in the practice list.
    expect(await (await send("GET", "/api/puzzles")).json()).toEqual({ items: [] });
    clock.time = MIDNIGHT;
    expect((await send("GET", "/api/puzzles/d26")).status).toBe(200);
  });
});

describe("ranked attempts (FR-17, FR-25)", () => {
  test("start, finish with the solution, and read back with a rank", async () => {
    const { clock, send, player } = await setup();
    const ann = await player("ann@example.com");
    const path = `/api/users/${ann.id}/attempts/d25`;
    expect(await (await send("GET", path, undefined, { cookie: ann.cookie })).json()).toEqual({
      attempt: null,
    });
    const started = await send("POST", path, undefined, { cookie: ann.cookie });
    expect(started.status).toBe(200);
    expect(await started.json()).toEqual({
      attempt: {
        puzzleId: "d25",
        day: "2026-10-25",
        area: 4,
        level: "hard",
        status: "playing",
        startedAt: new Date(T0).toISOString(),
        finishedAt: null,
        elapsedMs: 0,
        assisted: false,
        ranked: false,
        rank: null,
      },
    });
    clock.advance(65_000);
    const finished = await send(
      "POST",
      `${path}/finish`,
      { edges: SOLVED, elapsedMs: 64_000 },
      { cookie: ann.cookie },
    );
    expect(finished.status).toBe(200);
    expect(await finished.json()).toMatchObject({
      attempt: { status: "finished", elapsedMs: 64_000, ranked: true, rank: 1 },
    });
    const summary = (await (
      await send("GET", `/api/users/${ann.id}/daily`, undefined, { cookie: ann.cookie })
    ).json()) as DailySummary;
    expect(summary).toMatchObject({
      day: "2026-10-25",
      streak: 1,
      attempts: [{ puzzleId: "d25", rank: 1 }],
      bests: [{ area: 4, level: "hard", timeMs: 64_000 }],
    });
    expect(summary.week).toHaveLength(7);
  });

  test("a wrong board is refused, and the attempt can still be finished", async () => {
    const { clock, send, player } = await setup();
    const ann = await player("ann@example.com");
    const path = `/api/users/${ann.id}/attempts/d25`;
    await send("POST", path, undefined, { cookie: ann.cookie });
    clock.advance(60_000);
    const wrong = { edges: EMPTY, elapsedMs: 60_000 };
    await expectProblem(
      await send("POST", `${path}/finish`, wrong, { cookie: ann.cookie }),
      400,
      "Not the solution",
    );
    await expectProblem(
      await send("POST", `${path}/finish`, { edges: "12", elapsedMs: 1 }, { cookie: ann.cookie }),
      400,
      "Invalid board",
    );
    await expectProblem(
      await send("POST", `${path}/finish`, { edges: SOLVED }, { cookie: ann.cookie }),
      400,
      "Invalid request",
    );
    const ok = await send(
      "POST",
      `${path}/finish`,
      { edges: SOLVED, elapsedMs: 60_000 },
      { cookie: ann.cookie },
    );
    expect(ok.status).toBe(200);
  });

  test("needs a login, the player's own id, a confirmed email and a same-site request", async () => {
    const { send, player } = await setup();
    const ann = await player("ann@example.com");
    const ben = await player("ben@example.com", false);
    const path = `/api/users/${ann.id}/attempts/d25`;
    await expectProblem(await send("POST", path), 401);
    await expectProblem(await send("GET", `/api/users/${ann.id}/daily`), 401);
    await expectProblem(
      await send("POST", path, undefined, { cookie: ben.cookie }),
      403,
      "Logged in as someone else",
    );
    await expectProblem(
      await send("POST", `/api/users/${ben.id}/attempts/d25`, undefined, { cookie: ben.cookie }),
      403,
      "Email not confirmed",
    );
    // Unconfirmed players can still read their own (empty) summary.
    expect(
      (await send("GET", `/api/users/${ben.id}/daily`, undefined, { cookie: ben.cookie })).status,
    ).toBe(200);
    await expectProblem(
      await send("POST", path, undefined, {
        cookie: ann.cookie,
        headers: { "Sec-Fetch-Site": "cross-site" },
      }),
      403,
      "Cross-site request refused",
    );
  });

  test("limits each player to 120 daily requests a minute, shared by the summary and attempt routes", async () => {
    const { send, player } = await setup();
    const ann = await player("ann@example.com");
    for (let i = 0; i < 120; i++) {
      const res = await send("GET", `/api/users/${ann.id}/daily`, undefined, {
        cookie: ann.cookie,
      });
      expect(res.status).toBe(200);
    }
    const limited = await send("POST", `/api/users/${ann.id}/attempts/d25`, undefined, {
      cookie: ann.cookie,
    });
    await expectProblem(limited, 429);
    expect(limited.headers.get("Retry-After")).toBe("60");
  });

  test("only today's daily can be started", async () => {
    const { send, player } = await setup();
    const ann = await player("ann@example.com");
    const start = (id: string) =>
      send("POST", `/api/users/${ann.id}/attempts/${id}`, undefined, { cookie: ann.cookie });
    await expectProblem(await start("d24"), 409, "Daily is over");
    await expectProblem(await start("d26"), 404, "Daily puzzle not found");
    await expectProblem(await start("nope"), 404, "Daily puzzle not found");
    await expectProblem(
      await send(
        "POST",
        `/api/users/${ann.id}/attempts/d25/finish`,
        { edges: SOLVED, elapsedMs: 1 },
        { cookie: ann.cookie },
      ),
      404,
      "Attempt not found",
    );
  });

  test("a hint during the attempt marks it assisted, and it isn't ranked (FR-12)", async () => {
    const { clock, send, player } = await setup();
    const ann = await player("ann@example.com");
    const path = `/api/users/${ann.id}/attempts/d25`;
    await send("POST", path, undefined, { cookie: ann.cookie });
    const hint = await send(
      "POST",
      "/api/puzzles/d25/hint",
      { edges: "220000000000" },
      { cookie: ann.cookie },
    );
    // On today's daily the mistake count is capped, so it can't check a whole board.
    expect(await hint.json()).toEqual({ kind: "mistake", edge: 0, count: 1 });
    clock.advance(60_000);
    const done = await send(
      "POST",
      `${path}/finish`,
      { edges: SOLVED, elapsedMs: 60_000 },
      { cookie: ann.cookie },
    );
    expect(await done.json()).toMatchObject({
      attempt: { assisted: true, ranked: false, rank: null },
    });
    // A guest's hint changes nobody's attempt; yesterday's daily counts every wrong mark.
    expect(
      await (await send("POST", "/api/puzzles/d24/hint", { edges: "220000000000" })).json(),
    ).toEqual({ kind: "mistake", edge: 0, count: 2 });
  });
});

describe("leaderboards (FR-23)", () => {
  test("rank ranked solves by time, name players, mark the viewer and never show ids", async () => {
    const { send, player, solve } = await setup();
    const ann = await player("ann@example.com");
    const ben = await player("ben@example.com");
    await solve(ben, 50_000);
    await solve(ann, 70_000);
    const named = await send(
      "PUT",
      `/api/users/${ben.id}/display-name`,
      { displayName: "  tsuru " },
      { cookie: ben.cookie },
    );
    expect(await named.json()).toEqual({ displayName: "tsuru" });

    const res = await send("GET", "/api/leaderboards/daily/d25", undefined, { cookie: ann.cookie });
    const board = await res.json();
    expect(board).toEqual({
      area: 4,
      level: "hard",
      total: 2,
      entries: [
        { rank: 1, name: "tsuru", timeMs: 50_000, me: false },
        { rank: 2, name: null, timeMs: 70_000, me: true },
      ],
      me: { rank: 2, name: null, timeMs: 70_000, me: true },
    });
    const text = JSON.stringify(board);
    expect(text).not.toContain(ann.id);
    expect(text).not.toContain("example.com");

    const guest = (await (
      await send("GET", "/api/leaderboards/areas/4?limit=1")
    ).json()) as Leaderboard;
    expect(guest).toMatchObject({ area: 4, level: "hard", total: 2, me: null });
    expect(guest.entries).toEqual([{ rank: 1, name: "tsuru", timeMs: 50_000, me: false }]);
    // Each level has its own board; levels are named, so the old `?level=1` is refused.
    const easy = await send("GET", "/api/leaderboards/areas/4?level=easy");
    expect(await easy.json()).toMatchObject({ area: 4, level: "easy", total: 0, entries: [] });
    await expectProblem(await send("GET", "/api/leaderboards/areas/4?level=1"), 400);
    await expectProblem(await send("GET", "/api/leaderboards/daily/d26"), 404);
    await expectProblem(await send("GET", "/api/leaderboards/areas/0"), 400);
  });

  test("deleting the account takes its entries off the boards and frees its name (NFR-6)", async () => {
    const { send, player, solve } = await setup();
    const ann = await player("ann@example.com");
    const ben = await player("ben@example.com");
    await solve(ann, 50_000);
    await solve(ben, 70_000);
    await send(
      "PUT",
      `/api/users/${ann.id}/display-name`,
      { displayName: "kuroneko" },
      {
        cookie: ann.cookie,
      },
    );
    const deleted = await send(
      "DELETE",
      "/api/account",
      { password: "hunter22" },
      {
        cookie: ann.cookie,
      },
    );
    expect(deleted.status).toBe(204);
    const board = (await (await send("GET", "/api/leaderboards/daily/d25")).json()) as Leaderboard;
    expect(board.entries).toEqual([{ rank: 1, name: null, timeMs: 70_000, me: false }]);
    const taken = await send(
      "PUT",
      `/api/users/${ben.id}/display-name`,
      {
        displayName: "Kuroneko",
      },
      { cookie: ben.cookie },
    );
    expect(taken.status).toBe(200);
  });
});

describe("display names", () => {
  test("are validated, unique ignoring case, and removable", async () => {
    const { send, player } = await setup();
    const ann = await player("ann@example.com", false);
    const ben = await player("ben@example.com");
    const path = `/api/users/${ann.id}/display-name`;
    const put = (displayName: unknown, cookie = ann.cookie, to = path) =>
      send("PUT", to, { displayName }, { cookie });
    expect(await (await send("GET", path, undefined, { cookie: ann.cookie })).json()).toEqual({
      displayName: null,
    });
    // ASCII only: "émile" next to "Émile", or a Cyrillic "а" in "kuroneko", would pass for another.
    for (const bad of [
      "ab",
      "x".repeat(21),
      "has space",
      "a@b.c",
      42,
      "Émile",
      "kurоneko",
      "...",
    ]) {
      await expectProblem(await put(bad), 400, "Invalid request");
    }
    await expectProblem(await put("You"), 400, "Name not allowed");
    expect((await put("Kuroneko")).status).toBe(200);
    await expectProblem(
      await put("kuroneko", ben.cookie, `/api/users/${ben.id}/display-name`),
      409,
      "Name taken",
    );
    await expectProblem(await put("tsuru", ben.cookie), 403);
    expect(await (await put(null)).json()).toEqual({ displayName: null });
    await expectProblem(await send("PUT", path, { displayName: "x1y2z3" }), 401);
  });
});
