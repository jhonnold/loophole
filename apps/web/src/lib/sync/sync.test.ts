import { describe, expect, test } from "bun:test";
import { createApiClient } from "@loophole/api-client";
import { createGrid, decodeEdges } from "@loophole/core";
import { memoryStorage } from "../test-support/memory-storage.ts";
import {
  createProgressSync,
  forgetSynced,
  forgetUser,
  RETRY_MS,
  readSaved,
  SAVE_DELAY_MS,
  type Schedule,
} from "./sync.ts";

const grid = createGrid(2, 2);
// 2×2 all 2s; its only loop runs around the outside.
const SOLVED = "112211121121";
const ONE_LINE = "100000000000";
const TWO_LINES = "110000000000";
const OTHER_LINE = "010000000000";

const board = (edges: string, elapsedMs: number, assisted = false) => ({
  edges: decodeEdges(grid, edges),
  elapsedMs,
  solved: edges === SOLVED,
  assisted,
});

interface Stored {
  edges: string;
  elapsedMs: number;
  solved: boolean;
  assisted: boolean;
  version: number;
  device: string;
}

/** A record saved by another device. */
const record = (edges: string, elapsedMs: number, version = 1): Stored => ({
  edges,
  elapsedMs,
  solved: edges === SOLVED,
  assisted: false,
  version,
  device: "other",
});

/**
 * The progress API in memory, with the server's conflict rule: a solved record stays; the stored
 * board sent again keeps its version; a solved board wins; otherwise a save needs the stored
 * version or the same device; assisted only turns on. `down` makes every request fail like a
 * network error, and `status` answers every request with that error status. `hold` names a method
 * whose answers (worked out on arrival) wait in `held` until released; `hang` makes PUTs never
 * answer until their request is aborted.
 */
function fakeServer() {
  const records = new Map<string, Stored>();
  const requests: { method: string; path: string; body?: unknown; keepalive: boolean }[] = [];
  const server = {
    records,
    requests,
    down: false,
    status: 0,
    hold: "",
    held: [] as (() => void)[],
    hang: false,
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": status < 400 ? "application/json" : "application/problem+json",
      },
    });
  const dto = (id: string, { device: _, ...r }: Stored) => ({
    puzzleId: id,
    ...r,
    updatedAt: "2026-10-25T12:00:00.000Z",
  });
  const answer = (method: string, pathname: string, body: unknown): Response => {
    if (server.status) return json(server.status, { title: "Error", status: server.status });
    const match = pathname.match(/^\/api\/users\/u1\/progress(?:\/([^/]+))?$/);
    if (!match) return json(403, { title: "Logged in as someone else", status: 403 });
    const id = match[1];
    if (id === undefined) {
      const items = [...records]
        .filter(([, r]) => !r.solved)
        .map(([pid, r]) => ({ ...dto(pid, r), width: 2, height: 2 }));
      return json(200, { items });
    }
    if (id === "gone") return json(404, { title: "Puzzle not found", status: 404 });
    const stored = records.get(id);
    if (method === "GET") return json(200, { progress: stored ? dto(id, stored) : null });
    if (method === "DELETE") {
      records.delete(id);
      return new Response(null, { status: 204 });
    }
    const sent = body as {
      edges: string;
      elapsedMs: number;
      assisted: boolean;
      baseVersion: number | null;
      device: string;
    };
    const solved = sent.edges === SOLVED;
    const assisted = sent.assisted || (stored?.assisted ?? false);
    if (stored && !stored.solved && sent.edges === stored.edges) {
      const touched = {
        ...stored,
        elapsedMs: Math.max(stored.elapsedMs, sent.elapsedMs),
        assisted,
      };
      records.set(id, touched);
      return json(200, { progress: dto(id, touched), accepted: true });
    }
    const accepted =
      stored === undefined ||
      (!stored.solved &&
        (solved || sent.baseVersion === stored.version || sent.device === stored.device));
    const next: Stored = accepted
      ? {
          edges: sent.edges,
          elapsedMs: sent.elapsedMs,
          solved,
          assisted,
          version: (stored?.version ?? 0) + 1,
          device: sent.device,
        }
      : { ...(stored as Stored), assisted };
    records.set(id, next);
    return json(200, { progress: dto(id, next), accepted });
  };
  const fetch = (async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "PUT" ? await input.json() : undefined;
    requests.push({ method: input.method, path: url.pathname, body, keepalive: input.keepalive });
    if (server.down) throw new TypeError("Failed to fetch");
    if (server.hang && input.method === "PUT") {
      return new Promise<Response>((_, reject) => {
        input.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    const response = answer(input.method, url.pathname, body);
    if (server.hold === input.method) {
      await new Promise<void>((resolve) => server.held.push(resolve));
    }
    return response;
  }) as typeof globalThis.fetch;
  return { server, client: createApiClient({ baseUrl: "http://api.test", fetch }) };
}

/** A scheduler the test runs by hand. */
function manualSchedule() {
  const jobs: { fn: () => void; ms: number; done: boolean }[] = [];
  const schedule: Schedule = (fn, ms) => {
    const job = { fn, ms, done: false };
    jobs.push(job);
    return () => {
      job.done = true;
    };
  };
  const pending = () => jobs.filter((j) => !j.done);
  const runAll = async () => {
    for (const job of pending()) {
      job.done = true;
      job.fn();
    }
    await settle();
  };
  return { schedule, pending, runAll };
}

/** Lets fake requests and their handlers finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/** A signal that never aborts, so only the tests that ask for a timeout see one. */
const neverAborts = () => new AbortController().signal;

function setup(
  overrides: { timeout?: () => AbortSignal; backgroundTimeout?: () => AbortSignal } = {},
) {
  const { server, client } = fakeServer();
  const storage = memoryStorage();
  const timers = manualSchedule();
  let authLost = 0;
  const sync = createProgressSync({
    client,
    storage,
    userId: "u1",
    device: "this",
    onAuthLost: () => {
      authLost++;
    },
    schedule: timers.schedule,
    timeout: overrides.timeout ?? neverAborts,
    backgroundTimeout: overrides.backgroundTimeout ?? neverAborts,
  });
  const key = (id: string) => `loophole:user:u1:progress:${id}`;
  const unsynced = () => JSON.parse(storage.data.get("loophole:user:u1:unsynced") ?? "[]");
  return { server, storage, timers, sync, key, unsynced, authLost: () => authLost };
}

describe("progress sync: opening a puzzle", () => {
  test("takes the server's board and keeps a copy on the device", async () => {
    const { server, storage, sync, key } = setup();
    server.records.set("p1", { ...record(ONE_LINE, 4000, 3), assisted: true });
    expect(await sync.load("p1", grid)).toEqual(board(ONE_LINE, 4000, true));
    expect(readSaved(storage, key("p1"))).toEqual({
      edges: ONE_LINE,
      elapsedMs: 4000,
      solved: false,
      assisted: true,
      version: 3,
    });
    expect(sync.peek("p1", grid)).toEqual(board(ONE_LINE, 4000, true));
  });

  test("nothing on the server clears the device copy (started over elsewhere)", async () => {
    const { storage, sync, key } = setup();
    storage.setItem(key("p1"), JSON.stringify({ v: 1, edges: ONE_LINE, elapsedMs: 5 }));
    expect(await sync.load("p1", grid)).toBeNull();
    expect(storage.data.has(key("p1"))).toBe(false);
  });

  test("offline, uses the copy on the device", async () => {
    const { server, storage, sync, key } = setup();
    storage.setItem(key("p1"), JSON.stringify({ v: 1, edges: ONE_LINE, elapsedMs: 5 }));
    server.down = true;
    expect(await sync.load("p1", grid)).toEqual(board(ONE_LINE, 5));
  });

  test("an unsent save goes first and wins when it continues the server's board", async () => {
    const { server, sync, timers } = setup();
    server.records.set("p1", record(ONE_LINE, 3000));
    await sync.load("p1", grid);
    server.down = true;
    sync.save("p1", board(TWO_LINES, 9000));
    await timers.runAll();
    server.down = false;
    expect(await sync.load("p1", grid)).toEqual(board(TWO_LINES, 9000));
    expect(server.records.get("p1")).toMatchObject({
      edges: TWO_LINES,
      version: 2,
      device: "this",
    });
  });

  test("an unsent save made on a stale board gives way to the other device's", async () => {
    const { server, sync, timers } = setup();
    server.records.set("p1", record(ONE_LINE, 3000));
    await sync.load("p1", grid);
    server.down = true;
    sync.save("p1", board(TWO_LINES, 90_000));
    await timers.runAll();
    // Meanwhile another device carried on from version 1.
    server.records.set("p1", record(OTHER_LINE, 4000, 2));
    server.down = false;
    expect(await sync.load("p1", grid)).toEqual(board(OTHER_LINE, 4000));
  });
});

describe("progress sync: saving", () => {
  test("lands on the device at once and on the server after a pause", async () => {
    const { server, storage, sync, timers, key, unsynced } = setup();
    sync.save("p1", board(ONE_LINE, 1000));
    sync.save("p1", board(TWO_LINES, 2000));
    expect(readSaved(storage, key("p1"))?.edges).toBe(TWO_LINES);
    expect(unsynced()).toEqual(["p1"]);
    expect(server.requests).toEqual([]);
    expect(timers.pending().map((j) => j.ms)).toEqual([SAVE_DELAY_MS]);
    await timers.runAll();
    expect(server.requests.map((r) => [r.method, r.body])).toEqual([
      [
        "PUT",
        { edges: TWO_LINES, elapsedMs: 2000, assisted: false, baseVersion: null, device: "this" },
      ],
    ]);
    expect(unsynced()).toEqual([]);
    expect(readSaved(storage, key("p1"))?.version).toBe(1);
    sync.save("p1", board(ONE_LINE, 3000));
    await timers.runAll();
    expect(server.requests.at(-1)?.body).toMatchObject({ baseVersion: 1 });
    expect(server.records.get("p1")?.version).toBe(2);
  });

  test("moves made while a save is on its way continue from the server's new version", async () => {
    const { server, storage, sync, timers, key, unsynced } = setup();
    sync.save("p1", board(ONE_LINE, 1000));
    const [first] = timers.pending();
    first.done = true;
    first.fn();
    sync.save("p1", board(TWO_LINES, 2000));
    await settle();
    expect(readSaved(storage, key("p1"))).toMatchObject({ edges: TWO_LINES, version: 1 });
    expect(unsynced()).toEqual(["p1"]);
    await timers.runAll();
    expect(server.records.get("p1")).toMatchObject({ edges: TWO_LINES, version: 2 });
  });

  test("a save the server refuses brings in the server's board", async () => {
    const { server, storage, sync, timers, key } = setup();
    server.records.set("p1", record(SOLVED, 60_000));
    const seen: unknown[] = [];
    sync.watch("p1", grid, (p) => seen.push(p));
    sync.save("p1", { ...board(ONE_LINE, 90_000), assisted: true });
    await timers.runAll();
    // Solved stays; the hint seen on this device still marks it assisted.
    expect(seen).toEqual([{ ...board(SOLVED, 60_000), assisted: true }]);
    expect(readSaved(storage, key("p1"))).toMatchObject({ edges: SOLVED, solved: true });
  });

  test("failed saves stay marked and are sent again after a wait", async () => {
    const { server, sync, timers, unsynced } = setup();
    server.down = true;
    sync.save("p1", board(ONE_LINE, 1000));
    await timers.runAll();
    expect(unsynced()).toEqual(["p1"]);
    expect(timers.pending().map((j) => j.ms)).toEqual([RETRY_MS[0]]);
    await timers.runAll();
    expect(timers.pending().map((j) => j.ms)).toEqual([RETRY_MS[1]]);
    server.down = false;
    await timers.runAll();
    expect(unsynced()).toEqual([]);
    expect(server.records.get("p1")?.edges).toBe(ONE_LINE);
    expect(timers.pending()).toEqual([]);
  });

  test("a 401 or 403 reports the lost login and keeps the save", async () => {
    const { server, sync, timers, unsynced, authLost } = setup();
    server.status = 403;
    sync.save("p1", board(ONE_LINE, 1000));
    await timers.runAll();
    expect(authLost()).toBe(1);
    expect(unsynced()).toEqual(["p1"]);
    expect(timers.pending()).toEqual([]);
  });

  test("a board the server refuses outright is not sent again", async () => {
    const { sync, timers, unsynced } = setup();
    sync.save("gone", board(ONE_LINE, 1000));
    await timers.runAll();
    expect(unsynced()).toEqual([]);
  });

  test("flush sends unsent saves now, in requests that outlive the page", async () => {
    const { server, sync, timers } = setup();
    sync.save("p1", board(ONE_LINE, 1000));
    sync.flush();
    await settle();
    expect(server.requests.map((r) => [r.method, r.keepalive])).toEqual([["PUT", true]]);
    expect(timers.pending()).toEqual([]);
  });

  test("pushPending sends every unsent save", async () => {
    const { server, sync, timers } = setup();
    server.down = true;
    sync.save("p1", board(ONE_LINE, 1));
    sync.save("p2", board(TWO_LINES, 2));
    await timers.runAll();
    server.down = false;
    await sync.pushPending();
    expect([...server.records.keys()].sort()).toEqual(["p1", "p2"]);
  });
});

describe("progress sync: one request per puzzle", () => {
  test("a save made while another is out goes after it, so the newest board ends up stored", async () => {
    const { server, storage, sync, timers, key, unsynced } = setup();
    server.hold = "PUT";
    sync.save("p1", board(ONE_LINE, 1000));
    await timers.runAll();
    sync.save("p1", board(TWO_LINES, 2000));
    sync.flush(); // leaves it to the running request
    void sync.pushPending();
    await settle();
    expect(server.requests.filter((r) => r.method === "PUT")).toHaveLength(1);
    // Answer whatever is waiting, newest first, until nothing is left.
    while (server.held.length > 0) {
      for (const release of server.held.splice(0).reverse()) release();
      await settle();
    }
    expect(server.records.get("p1")).toMatchObject({ edges: TWO_LINES, version: 2 });
    expect(readSaved(storage, key("p1"))).toMatchObject({ edges: TWO_LINES, version: 2 });
    expect(unsynced()).toEqual([]);
  });

  test("opening a puzzle doesn't wait forever on a save the server never answers", async () => {
    const { server, storage, sync, key, unsynced } = setup({
      timeout: () => AbortSignal.timeout(50),
    });
    storage.setItem(key("p1"), JSON.stringify({ v: 1, edges: ONE_LINE, elapsedMs: 5 }));
    storage.setItem("loophole:user:u1:unsynced", '["p1"]');
    server.hang = true;
    expect(await sync.load("p1", grid)).toEqual(board(ONE_LINE, 5));
    expect(unsynced()).toEqual(["p1"]);
  });

  test("a background save that hangs gives up after its timeout, and is sent again", async () => {
    const signals: AbortController[] = [];
    const { server, sync, timers, unsynced } = setup({
      backgroundTimeout: () => {
        const aborter = new AbortController();
        signals.push(aborter);
        return aborter.signal;
      },
    });
    server.hang = true;
    sync.save("p1", board(ONE_LINE, 1000));
    await timers.runAll(); // the PUT goes out and never answers
    signals[0]?.abort();
    await settle();
    expect(unsynced()).toEqual(["p1"]);
    // The slot is free again: the save goes out on the next pass.
    server.hang = false;
    await sync.pushPending();
    expect(server.records.get("p1")).toMatchObject({ edges: ONE_LINE });
    expect(unsynced()).toEqual([]);
  });

  test("refresh ignores an answer older than a save made while it was out", async () => {
    const { server, sync, timers } = setup();
    server.records.set("p1", record(ONE_LINE, 1000));
    await sync.load("p1", grid);
    const seen: unknown[] = [];
    sync.watch("p1", grid, (p) => seen.push(p));
    server.hold = "GET";
    const refreshing = sync.refresh("p1");
    await settle();
    sync.save("p1", board(TWO_LINES, 2000));
    await timers.runAll();
    expect(server.records.get("p1")?.edges).toBe(TWO_LINES);
    for (const release of server.held.splice(0)) release();
    await refreshing;
    expect(seen).toEqual([]);
    expect(sync.peek("p1", grid)).toEqual(board(TWO_LINES, 2000));
  });

  test("a first save of an empty board is skipped; later empty boards are moves", async () => {
    const { server, storage, sync, timers, key } = setup();
    sync.save("p1", board("000000000000", 5000));
    expect(storage.data.has(key("p1"))).toBe(false);
    expect(timers.pending()).toEqual([]);
    sync.save("p1", board(ONE_LINE, 6000));
    sync.save("p1", board("000000000000", 7000));
    await timers.runAll();
    expect(server.records.get("p1")?.edges).toBe("000000000000");
  });
});

describe("progress sync: start over while a save is out", () => {
  test("an accepted save that was out when Start over ran doesn't bring the board back", async () => {
    const { server, storage, sync, timers, key } = setup();
    server.hold = "PUT";
    sync.save("p1", board(ONE_LINE, 1000));
    await timers.runAll();
    sync.clear("p1");
    while (server.held.length > 0) {
      for (const release of server.held.splice(0)) release();
      await settle();
    }
    expect(storage.data.has(key("p1"))).toBe(false);
    expect(sync.peek("p1", grid)).toBeNull();
    expect(server.records.has("p1")).toBe(false);
  });

  test("a refused save that was out when Start over ran doesn't show the other device's board", async () => {
    const { server, storage, sync, timers, key } = setup();
    server.records.set("p1", record(TWO_LINES, 2000));
    const seen: unknown[] = [];
    sync.watch("p1", grid, (p) => seen.push(p));
    server.hold = "PUT";
    sync.save("p1", board(ONE_LINE, 1000));
    await timers.runAll();
    sync.clear("p1");
    while (server.held.length > 0) {
      for (const release of server.held.splice(0)) release();
      await settle();
    }
    expect(seen).toEqual([]);
    expect(storage.data.has(key("p1"))).toBe(false);
    expect(server.records.has("p1")).toBe(false);
  });

  test("a solved board that is already stored isn't sent again", async () => {
    const { server, sync, timers } = setup();
    sync.save("p1", board(SOLVED, 1000));
    await timers.runAll();
    const sent = server.requests.length;
    sync.save("p1", board(SOLVED, 2000));
    expect(timers.pending()).toEqual([]);
    await timers.runAll();
    expect(server.requests.length).toBe(sent);
  });
});

describe("progress sync: start over, refresh and import", () => {
  test("clear deletes on the server; offline, the delete goes before later saves", async () => {
    const { server, storage, sync, timers, key } = setup();
    server.records.set("p1", record(SOLVED, 5000));
    await sync.load("p1", grid);
    server.down = true;
    sync.clear("p1");
    sync.save("p1", board(ONE_LINE, 100));
    await timers.runAll();
    expect(storage.data.get("loophole:user:u1:deleting")).toBe('["p1"]');
    server.down = false;
    server.requests.length = 0;
    await sync.pushPending();
    expect(server.requests.map((r) => r.method)).toEqual(["DELETE", "PUT"]);
    expect(server.records.get("p1")).toMatchObject({ edges: ONE_LINE, version: 1 });
    expect(storage.data.has("loophole:user:u1:deleting")).toBe(false);
    expect(readSaved(storage, key("p1"))?.edges).toBe(ONE_LINE);
  });

  test("refresh tells the watchers only when the server's board differs", async () => {
    const { server, sync } = setup();
    server.records.set("p1", record(ONE_LINE, 1000));
    await sync.load("p1", grid);
    const seen: unknown[] = [];
    sync.watch("p1", grid, (p) => seen.push(p));
    await sync.refresh("p1");
    expect(seen).toEqual([]);
    server.records.set("p1", record(TWO_LINES, 8000, 2));
    await sync.refresh("p1");
    server.records.delete("p1");
    await sync.refresh("p1");
    expect(seen).toEqual([board(TWO_LINES, 8000), null]);
  });

  test("importGuest saves as a new device, so the account keeps a board it has", async () => {
    const { server, sync } = setup();
    server.records.set("p2", record(TWO_LINES, 9000));
    const saved = { edges: ONE_LINE, elapsedMs: 5000, solved: false, assisted: false, version: 7 };
    expect(await sync.importGuest("p1", saved)).toBe("imported");
    expect(server.requests.at(-1)?.body).toMatchObject({ baseVersion: null });
    expect(server.requests.at(-1)?.body).not.toMatchObject({ device: "this" });
    // A repeat finds the same board there: nothing changes, not even its version.
    expect(await sync.importGuest("p1", saved)).toBe("imported");
    expect(server.records.get("p1")?.version).toBe(1);
    expect(await sync.importGuest("p2", saved)).toBe("kept");
    expect(await sync.importGuest("p3", { ...saved, edges: SOLVED })).toBe("imported");
    expect(await sync.importGuest("gone", saved)).toBe("skipped");
    server.down = true;
    expect(await sync.importGuest("p4", saved)).toBe("failed");
    expect(sync.peek("p2", grid)).toEqual(board(TWO_LINES, 9000));
  });

  test("list gives the unsolved puzzles, or nothing offline", async () => {
    const { server, sync } = setup();
    server.records.set("p1", record(ONE_LINE, 1000));
    server.records.set("p2", record(SOLVED, 1000));
    expect((await sync.list()).map((s) => s.puzzleId)).toEqual(["p1"]);
    server.down = true;
    expect(await sync.list()).toEqual([]);
  });

  test("forgetSynced keeps only the account's unsent saves", () => {
    const storage = memoryStorage();
    storage.setItem("loophole:user:u1:progress:p1", "x");
    storage.setItem("loophole:user:u1:progress:p2", "x");
    storage.setItem("loophole:user:u1:progress:p3", "x");
    storage.setItem("loophole:user:u1:unsynced", '["p2"]');
    storage.setItem("loophole:user:u1:deleting", '["p3"]');
    storage.setItem("loophole:user:u2:progress:p1", "x");
    forgetSynced(storage, "u1");
    expect([...storage.data.keys()].sort()).toEqual([
      "loophole:user:u1:deleting",
      "loophole:user:u1:progress:p2",
      "loophole:user:u1:progress:p3",
      "loophole:user:u1:unsynced",
      "loophole:user:u2:progress:p1",
    ]);
  });

  test("forgetUser removes one account's keys and nothing else", () => {
    const storage = memoryStorage();
    storage.setItem("loophole:user:u1:progress:p1", "x");
    storage.setItem("loophole:user:u1:unsynced", "[]");
    storage.setItem("loophole:user:u2:progress:p1", "x");
    storage.setItem("loophole:progress:p1", "x");
    forgetUser(storage, "u1");
    expect([...storage.data.keys()].sort()).toEqual([
      "loophole:progress:p1",
      "loophole:user:u2:progress:p1",
    ]);
  });
});
