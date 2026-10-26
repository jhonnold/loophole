import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import type { ApiMetrics, AuthFailure, BlobStore } from "../ports.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { healthManager } from "../test-support/health.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
import { SESSION_COOKIE } from "./session-cookie.ts";

/** Records what the app counts. */
class RecordingMetrics implements ApiMetrics {
  readonly requests: string[] = [];
  readonly authFailures: AuthFailure[] = [];
  request(method: string, route: string, status: number): void {
    this.requests.push(`${method} ${route} ${status}`);
  }
  authFailure(reason: AuthFailure): void {
    this.authFailures.push(reason);
  }
}

function setup(
  blobs: BlobStore = new MemoryBlobStore(),
  options: { accessLog?: boolean; webDir?: string } = {},
) {
  const db = openDatabase(":memory:");
  const clock = new FakeClock(Date.UTC(2026, 9, 25, 12));
  const deps = accountDeps(db, clock);
  const puzzles = new PuzzleManager({ puzzles: new SqlitePuzzleRepository(db), blobs, clock });
  const queue = new SqliteJobQueue(db);
  const jobs = new JobManager({
    jobs: queue,
    clock,
    newId: sequentialIds("j"),
    maxQueued: 10,
    maxPendingPerRequester: 10,
  });
  const metrics = new RecordingMetrics();
  const app = createApp({
    puzzles,
    jobs,
    ...dailyDeps(db, clock, puzzles),
    progress: sqliteProgress(db, puzzles, clock),
    health: healthManager(db, clock, blobs),
    ...submissionDeps(db, clock, puzzles, jobs),
    ...deps,
    metrics,
    accessLog: options.accessLog,
    webDir: options.webDir,
  });
  const send = (method: string, path: string, body?: unknown, cookie?: string) => {
    const headers: Record<string, string> = { "Sec-Fetch-Site": "same-origin" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (cookie !== undefined) headers.Cookie = `${SESSION_COOKIE}=${cookie}`;
    return app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  /** Signs up, confirms and logs in; returns the session cookie. */
  const logIn = async (email: string, admin: boolean) => {
    await send("POST", "/api/auth/signup", { email, password: "hunter22", captchaToken: "c" });
    const token = deps.mailer.sent.at(-1)?.text.match(/#token=(\S+)/)?.[1];
    await send("POST", "/api/auth/verify-email", { token });
    if (admin) deps.users.setAdmin(email, true);
    const res = await send("POST", "/api/auth/login", { email, password: "hunter22" });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    return cookie?.split(";")[0].slice(SESSION_COOKIE.length + 1) ?? "";
  };
  return { app, send, logIn, queue, metrics };
}

const downBlobs: BlobStore = {
  put: async () => {},
  get: async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:3900");
  },
  delete: async () => {},
};

describe("GET /api/health/ready", () => {
  test("answers 200 when the database and blob store answer", async () => {
    const res = await setup().app.request("/api/health/ready");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: true, blobs: true });
  });

  test("answers 503 without error details when the blob store is down", async () => {
    const res = await setup(downBlobs).app.request("/api/health/ready");
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "unavailable", database: true, blobs: false });
    expect(text).not.toContain("ECONNREFUSED");
  });
});

describe("GET /api/admin/health", () => {
  test("is for admins only", async () => {
    const { send, logIn } = setup();
    expect((await send("GET", "/api/admin/health")).status).toBe(401);
    const player = await logIn("ann@example.com", false);
    expect((await send("GET", "/api/admin/health", undefined, player)).status).toBe(403);
  });

  test("shows checks with their errors, the queue, the daily stock, failures and versions", async () => {
    const { send, logIn, queue } = setup(downBlobs);
    queue.enqueue({
      id: "j1",
      job: { kind: "generate", input: { width: 5, height: 5, seed: "s" } },
      createdAt: Date.UTC(2026, 9, 25, 11),
    });
    queue.enqueue({
      id: "j2",
      job: { kind: "generate", input: { width: 5, height: 5, seed: "t" } },
      createdAt: Date.UTC(2026, 9, 25, 11, 30),
    });
    queue.claimNext("w", 1);
    queue.finish("j1", "w", { status: "timeout", error: "Stopped after the 60 s time limit." }, 2);
    const admin = await logIn("root@example.com", true);
    const res = await send("GET", "/api/admin/health", undefined, admin);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      database: { ok: true, error: null },
      blobs: { ok: false, error: "connect ECONNREFUSED 127.0.0.1:3900" },
      jobs: { queued: 1, running: 0, oldestQueuedAt: "2026-10-25T11:30:00.000Z" },
      dailies: [
        { size: 7, days: 0 },
        { size: 10, days: 0 },
        { size: 20, days: 0 },
        { size: 40, days: 0 },
      ],
      failures: [
        {
          id: "j1",
          kind: "generate",
          status: "timeout",
          error: "Stopped after the 60 s time limit.",
          finishedAt: "1970-01-01T00:00:00.002Z",
        },
      ],
      versions: { app: "test", runtime: "bun test" },
      startedAt: "2026-10-25T12:00:00.000Z",
    });
  });
});

/** Runs `fn` with console.info captured; returns what it logged. */
async function captureInfo(fn: () => Promise<void>): Promise<unknown[][]> {
  const info = spyOn(console, "info").mockImplementation(() => {});
  try {
    await fn();
    return info.mock.calls;
  } finally {
    info.mockRestore();
  }
}

describe("request observation", () => {
  test("the access log has the method, route template, status and time, and no path or query", async () => {
    const { app } = setup(undefined, { accessLog: true });
    const logged = await captureInfo(async () => {
      await app.request("/api/puzzles/abc-123?token=xyz");
    });
    expect(logged).toHaveLength(1);
    const [message, fields] = logged[0] as [string, Record<string, unknown>];
    expect(message).toBe("request");
    expect(Object.keys(fields).sort()).toEqual(["method", "ms", "route", "status"]);
    expect(fields).toMatchObject({ method: "GET", route: "/api/puzzles/:id", status: 404 });
    const text = JSON.stringify(logged);
    expect(text).not.toContain("abc-123");
    expect(text).not.toContain("xyz");
  });

  test("the web app's files that load are not logged, and health checks that pass", async () => {
    const webDir = mkdtempSync(join(tmpdir(), "loophole-web-"));
    try {
      writeFileSync(join(webDir, "index.html"), "<!doctype html><title>Loophole</title>");
      writeFileSync(join(webDir, "app.js"), "console.log(1);");
      const { app } = setup(undefined, { accessLog: true, webDir });
      const logged = await captureInfo(async () => {
        expect((await app.request("/app.js")).status).toBe(200);
        expect((await app.request("/")).status).toBe(200);
        expect((await app.request("/api/health")).status).toBe(200);
      });
      expect(logged).toEqual([]);
    } finally {
      rmSync(webDir, { recursive: true, force: true });
    }
  });

  test("counts requests under their route template and gives each an id", async () => {
    const { app, metrics } = setup();
    const res = await app.request("/api/puzzles/nope-123");
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    await app.request("/api/no-such-route");
    expect(metrics.requests).toEqual(["GET /api/puzzles/:id 404", "GET /api/* 404"]);
  });

  test("keeps a proxy's request id that looks like one, and replaces one that doesn't", async () => {
    const { app } = setup();
    let res = await app.request("/api/health", { headers: { "X-Request-Id": "abc-123" } });
    expect(res.headers.get("X-Request-Id")).toBe("abc-123");
    res = await app.request("/api/health", { headers: { "X-Request-Id": "bad id\n" } });
    expect(res.headers.get("X-Request-Id")).not.toBe("bad id\n");
  });

  test("counts refused logins, mailed links and cross-site requests as auth failures", async () => {
    const { app, send, metrics } = setup();
    await send("POST", "/api/auth/login", { email: "nobody@example.com", password: "hunter22" });
    await send("POST", "/api/auth/verify-email", { token: "wrong" });
    await app.request("/api/auth/logout", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(metrics.authFailures).toEqual(["login", "link", "csrf"]);
  });
});
