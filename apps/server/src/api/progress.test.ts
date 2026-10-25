import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { healthManager } from "../test-support/health.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
import type { Problem } from "./problem.ts";
import { SESSION_COOKIE } from "./session-cookie.ts";

// 2×2 all 2s; its only loop runs around the outside.
const SOLVED = "112211121121";
const ONE_LINE = "100000000000";
const OTHER_LINE = "010000000000";
const T0 = Date.UTC(2026, 9, 25, 12);

async function setup() {
  const db = openDatabase(":memory:");
  const clock = new FakeClock(T0);
  const deps = accountDeps(db, clock);
  const puzzles = new PuzzleManager({
    puzzles: new SqlitePuzzleRepository(db),
    blobs: new MemoryBlobStore(),
    clock,
  });
  await puzzles.saveGenerated("p1", {
    puzzle: serializePuzzle(createPuzzle(2, 2, [2, 2, 2, 2])),
    solution: SOLVED,
    steps: [],
  });
  const jobs = new JobManager({
    jobs: new SqliteJobQueue(db),
    clock,
    newId: sequentialIds("j"),
    maxQueued: 10,
  });
  const app = createApp({
    puzzles,
    ...dailyDeps(db, clock, puzzles),
    progress: sqliteProgress(db, puzzles, clock),
    health: healthManager(db, clock),
    jobs,
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
    if (body !== undefined) headers["Content-Type"] ??= "application/json";
    if (options.cookie !== undefined) headers.Cookie = `${SESSION_COOKIE}=${options.cookie}`;
    const env = { requestIP: () => ({ address: "198.51.100.7" }) };
    return app.request(
      path,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      env,
    );
  };

  /** Signs up and logs in `email`; returns its user id and session cookie. */
  const account = async (email: string) => {
    await send("POST", "/api/auth/signup", { email, password: "hunter22", captchaToken: "cap" });
    const res = await send("POST", "/api/auth/login", { email, password: "hunter22" });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    const cookie = res.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
      ?.split(";")[0]
      .slice(SESSION_COOKIE.length + 1);
    if (cookie === undefined) throw new Error("no session cookie");
    return { id, cookie };
  };

  return { db, clock, send, account };
}

async function expectProblem(res: Response, status: number, title?: string): Promise<Problem> {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toStartWith("application/problem+json");
  const body = (await res.json()) as Problem;
  if (title !== undefined) expect(body.title).toBe(title);
  return body;
}

const save = (
  edges: string,
  elapsedMs: number,
  options: { assisted?: boolean; baseVersion?: number | null; device?: string } = {},
) => ({
  edges,
  elapsedMs,
  assisted: options.assisted ?? false,
  baseVersion: options.baseVersion ?? null,
  device: options.device ?? "browser-1",
});

describe("saved progress routes", () => {
  test("save, read back, list and delete (FR-21)", async () => {
    const { send, account, clock } = await setup();
    const { id, cookie } = await account("ann@example.com");
    const path = `/api/users/${id}/progress/p1`;

    expect(await (await send("GET", path, undefined, { cookie })).json()).toEqual({
      progress: null,
    });

    const saved = await send("PUT", path, save(ONE_LINE, 4200, { assisted: true }), { cookie });
    expect(saved.status).toBe(200);
    const progress = {
      puzzleId: "p1",
      edges: ONE_LINE,
      elapsedMs: 4200,
      solved: false,
      assisted: true,
      // A new attempt's version is the server's time, so it can't repeat after Start over.
      version: T0,
      updatedAt: "2026-10-25T12:00:00.000Z",
    };
    expect(await saved.json()).toEqual({ progress, accepted: true });
    expect(await (await send("GET", path, undefined, { cookie })).json()).toEqual({ progress });

    clock.advance(1000);
    const list = await send("GET", `/api/users/${id}/progress`, undefined, { cookie });
    expect(await list.json()).toEqual({
      items: [
        {
          puzzleId: "p1",
          width: 2,
          height: 2,
          elapsedMs: 4200,
          assisted: true,
          updatedAt: "2026-10-25T12:00:00.000Z",
        },
      ],
    });

    expect((await send("DELETE", path, undefined, { cookie })).status).toBe(204);
    expect(await (await send("GET", path, undefined, { cookie })).json()).toEqual({
      progress: null,
    });
  });

  test("conflicts between devices (DECISIONS, Progress conflicts)", async () => {
    const { send, account } = await setup();
    const { id, cookie } = await account("ann@example.com");
    const path = `/api/users/${id}/progress/p1`;
    const phone = { device: "phone" };
    const laptop = { device: "laptop" };

    const first = await send("PUT", path, save(ONE_LINE, 1000, phone), { cookie });
    const v1 = ((await first.json()) as { progress: { version: number } }).progress.version;
    const continued = await send(
      "PUT",
      path,
      save(OTHER_LINE, 2000, { ...laptop, baseVersion: v1 }),
      {
        cookie,
      },
    );
    expect(await continued.json()).toMatchObject({
      accepted: true,
      progress: { version: v1 + 1 },
    });

    // The laptop's board sent again from elsewhere (a tab hidden without a move) takes no version.
    const glance = await send(
      "PUT",
      path,
      save(OTHER_LINE, 2500, { ...phone, baseVersion: v1 + 1 }),
      { cookie },
    );
    expect(await glance.json()).toMatchObject({
      accepted: true,
      progress: { edges: OTHER_LINE, elapsedMs: 2500, version: v1 + 1 },
    });

    // The phone's tab still shows version 1: its save is stale and gets the laptop's board.
    const stale = await send("PUT", path, save(ONE_LINE, 90_000, { ...phone, baseVersion: v1 }), {
      cookie,
    });
    expect(await stale.json()).toMatchObject({
      accepted: false,
      progress: { edges: OTHER_LINE, elapsedMs: 2500, version: v1 + 1 },
    });

    // A solved board wins even when stale, and then stays.
    const solved = await send("PUT", path, save(SOLVED, 7000, { ...phone, baseVersion: v1 }), {
      cookie,
    });
    expect(await solved.json()).toMatchObject({ accepted: true, progress: { solved: true } });
    const after = await send("PUT", path, save(ONE_LINE, 8000, { ...phone, baseVersion: v1 + 2 }), {
      cookie,
    });
    expect(await after.json()).toMatchObject({ accepted: false, progress: { edges: SOLVED } });
  });

  test("needs a login, and only the logged-in user's own path", async () => {
    const { send, account } = await setup();
    const ann = await account("ann@example.com");
    const bob = await account("bob@example.com");
    const annPath = `/api/users/${ann.id}/progress/p1`;

    await expectProblem(await send("GET", annPath), 401, "Not logged in");
    await expectProblem(await send("PUT", annPath, save(ONE_LINE, 1)), 401);
    await expectProblem(await send("GET", `/api/users/${ann.id}/progress`), 401);
    await expectProblem(await send("DELETE", annPath), 401);

    for (const [method, body] of [
      ["GET", undefined],
      ["PUT", save(ONE_LINE, 1)],
      ["DELETE", undefined],
    ] as const) {
      await expectProblem(
        await send(method, annPath, body, { cookie: bob.cookie }),
        403,
        "Logged in as someone else",
      );
    }
    await expectProblem(
      await send("GET", `/api/users/${ann.id}/progress`, undefined, { cookie: bob.cookie }),
      403,
    );
  });

  test("refuses cross-site writes (CSRF) and bodies that aren't JSON", async () => {
    const { send, account } = await setup();
    const { id, cookie } = await account("ann@example.com");
    const path = `/api/users/${id}/progress/p1`;
    const crossSite = { "Sec-Fetch-Site": "cross-site" };

    await expectProblem(
      await send("PUT", path, save(ONE_LINE, 1), { cookie, headers: crossSite }),
      403,
      "Cross-site request refused",
    );
    await expectProblem(await send("DELETE", path, undefined, { cookie, headers: crossSite }), 403);
    const form = await send("PUT", path, save(ONE_LINE, 1), {
      cookie,
      headers: { "Content-Type": "text/plain" },
    });
    expect(form.status).toBe(415);
    // The 64 KiB body cap applies to the progress routes too.
    await expectProblem(await send("PUT", path, save("0".repeat(70_000), 1), { cookie }), 413);
  });

  test("validates the board and the body", async () => {
    const { send, account } = await setup();
    const { id, cookie } = await account("ann@example.com");
    const path = `/api/users/${id}/progress/p1`;

    await expectProblem(await send("PUT", path, save("000", 1), { cookie }), 400, "Invalid board");
    for (const body of [
      save("00000000000x", 1),
      save(ONE_LINE, -1),
      save(ONE_LINE, 1.5),
      save(ONE_LINE, 1, { baseVersion: 0 }),
      save(ONE_LINE, 1, { device: "" }),
      { ...save(ONE_LINE, 1), solved: true },
      { edges: ONE_LINE, elapsedMs: 1, assisted: false, device: "d" },
    ]) {
      await expectProblem(await send("PUT", path, body, { cookie }), 400, "Invalid request");
    }
    await expectProblem(
      await send("PUT", `/api/users/${id}/progress/nope`, save(ONE_LINE, 1), { cookie }),
      404,
      "Puzzle not found",
    );
    await expectProblem(
      await send("GET", `/api/users/${id}/progress/nope`, undefined, { cookie }),
      404,
    );
  });

  test("limits each user to 120 progress requests a minute", async () => {
    const { send, account, clock } = await setup();
    const { id, cookie } = await account("ann@example.com");
    const path = `/api/users/${id}/progress/p1`;
    for (let i = 0; i < 120; i++) {
      expect((await send("GET", path, undefined, { cookie })).status).toBe(200);
    }
    const limited = await send("PUT", path, save(ONE_LINE, 1), { cookie });
    await expectProblem(limited, 429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    clock.advance(60_000);
    expect((await send("GET", path, undefined, { cookie })).status).toBe(200);
  });

  test("deleting the account deletes its progress (NFR-6)", async () => {
    const { send, account, db } = await setup();
    const { id, cookie } = await account("ann@example.com");
    await send("PUT", `/api/users/${id}/progress/p1`, save(ONE_LINE, 1), { cookie });
    const count = () => db.query("SELECT count(*) AS n FROM progress").get();
    expect(count()).toEqual({ n: 1 });
    expect(
      (await send("DELETE", "/api/account", { password: "hunter22" }, { cookie })).status,
    ).toBe(204);
    expect(count()).toEqual({ n: 0 });
  });
});
