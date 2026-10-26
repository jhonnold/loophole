import { describe, expect, test } from "bun:test";
import { createApiClient } from "@loophole/api-client";
import { createPuzzleGenerator, type Job, jobStatusText } from "./generate.ts";

const QUEUED: Job = {
  id: "j1",
  kind: "generate",
  status: "queued",
  progress: 0,
  result: null,
  error: null,
  createdAt: "2026-10-26T12:00:00.000Z",
  startedAt: null,
  finishedAt: null,
};
const RUNNING: Job = { ...QUEUED, status: "running", progress: 0.4 };
const DONE: Job = { ...QUEUED, status: "done", progress: 1, result: { puzzleId: "j1" } };

/** A client whose fetch answers each request with the next of `answers` and records them. */
function clientFor(answers: [number, unknown][]) {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const fetch = (async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "POST" ? await input.json() : undefined;
    requests.push({ method: input.method, path: url.pathname, body });
    const [status, answer] = answers.shift() ?? [500, { title: "No answer" }];
    return new Response(JSON.stringify(answer), {
      status,
      headers: { "Content-Type": status < 400 ? "application/json" : "application/problem+json" },
    });
  }) as typeof globalThis.fetch;
  return { client: createApiClient({ baseUrl: "http://api.test", fetch }), requests };
}

const noWait = { sleep: async () => {} };

describe("puzzle generator", () => {
  test("queues the size and level, follows the job and resolves to the new puzzle", async () => {
    const { client, requests } = clientFor([
      [202, QUEUED],
      [200, RUNNING],
      [200, DONE],
    ]);
    const seen: string[] = [];
    const result = await createPuzzleGenerator(client).generate(7, 7, "easy", {
      ...noWait,
      onJob: (job) => seen.push(jobStatusText(job)),
    });
    expect(result).toEqual({ ok: true, puzzleId: "j1" });
    expect(requests).toEqual([
      { method: "POST", path: "/api/jobs/generate", body: { width: 7, height: 7, level: "easy" } },
      { method: "GET", path: "/api/jobs/j1", body: undefined },
      { method: "GET", path: "/api/jobs/j1", body: undefined },
    ]);
    expect(seen).toEqual([
      "Waiting for its turn…",
      "Making the puzzle… 40%",
      "Making the puzzle… 100%",
    ]);
  });

  test("a refusal comes back with the server's words, the per-player cap included", async () => {
    const detail =
      "You already have 3 puzzles being generated. Wait for one to finish, then try again.";
    const { client } = clientFor([
      [429, { title: "Too many generations in progress", status: 429, detail }],
      [503, { title: "Queue full", status: 503 }],
    ]);
    const generator = createPuzzleGenerator(client);
    expect(await generator.generate(5, 5, "hard", noWait)).toEqual({ ok: false, message: detail });
    expect(await generator.generate(5, 5, "hard", noWait)).toEqual({
      ok: false,
      message: "Queue full",
    });
  });

  test("a failed or timed-out job, and a lost connection, end with a message", async () => {
    const failed = clientFor([
      [202, QUEUED],
      [200, { ...QUEUED, status: "timeout" }],
    ]);
    expect(await createPuzzleGenerator(failed.client).generate(5, 5, "hard", noWait)).toEqual({
      ok: false,
      message: "The puzzle couldn't be made. Try again.",
    });
    const offline = createApiClient({
      baseUrl: "http://api.test",
      fetch: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof globalThis.fetch,
    });
    const result = await createPuzzleGenerator(offline).generate(5, 5, "hard", noWait);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("Couldn't reach the server");
  });

  test("a failed look at the job is tried again before the wait is given up", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    const blip = clientFor([
      [202, QUEUED],
      [503, { title: "Unavailable", status: 503 }],
      [200, DONE],
    ]);
    expect(await createPuzzleGenerator(blip.client).generate(5, 5, "hard", { sleep })).toEqual({
      ok: true,
      puzzleId: "j1",
    });
    expect(blip.requests.filter((r) => r.method === "GET")).toHaveLength(2);

    const down = clientFor([
      [202, QUEUED],
      [503, { title: "Unavailable", status: 503 }],
      [503, { title: "Unavailable", status: 503 }],
      [503, { title: "Unavailable", status: 503 }],
      [200, DONE],
    ]);
    expect(await createPuzzleGenerator(down.client).generate(5, 5, "hard", noWait)).toEqual({
      ok: false,
      message: "Unavailable",
    });
    expect(down.requests.filter((r) => r.method === "GET")).toHaveLength(3);
  });

  test("stops following the job when aborted", async () => {
    const { client, requests } = clientFor([[202, QUEUED]]);
    const controller = new AbortController();
    const result = await createPuzzleGenerator(client).generate(5, 5, "hard", {
      sleep: async () => controller.abort(),
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    expect(requests).toHaveLength(1);
  });
});
