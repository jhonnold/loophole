import { describe, expect, test } from "bun:test";
import { createApiClient } from "@loophole/api-client";
import { createPuzzle } from "@loophole/core";
import { createSubmissions, type Submission, shareUrl, verdictText } from "./submit.ts";

const PENDING: Submission = {
  id: "s1",
  width: 2,
  height: 2,
  status: "pending",
  verdict: null,
  puzzleId: null,
  createdAt: "2026-10-25T12:00:00.000Z",
  decidedAt: null,
};
const PUBLISHED: Submission = {
  ...PENDING,
  status: "published",
  verdict: "unique",
  puzzleId: "s1",
  decidedAt: "2026-10-25T12:00:01.000Z",
};

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

describe("submissions client", () => {
  test("submit posts the size and clues", async () => {
    const { client, requests } = clientFor([[202, PENDING]]);
    const result = await createSubmissions(client).submit(createPuzzle(2, 2, [2, -1, -1, 3]));
    expect(result).toEqual({ ok: true, submission: PENDING });
    expect(requests).toEqual([
      { method: "POST", path: "/api/submissions", body: { width: 2, height: 2, clues: "2..3" } },
    ]);
  });

  test("a refusal comes back with the server's explanation", async () => {
    const { client } = clientFor([
      [
        403,
        { title: "Email not confirmed", detail: "Confirm your email address first.", status: 403 },
      ],
      [429, { title: "Too many requests", status: 429 }],
    ]);
    const s = createSubmissions(client);
    expect(await s.submit(createPuzzle(1, 1))).toEqual({
      ok: false,
      message: "Confirm your email address first.",
    });
    expect((await s.submit(createPuzzle(1, 1))).ok).toBe(false);
  });

  test("waitFor polls until the submission is decided", async () => {
    const { client, requests } = clientFor([
      [200, PENDING],
      [200, PUBLISHED],
    ]);
    const slept: number[] = [];
    const result = await createSubmissions(client).waitFor("s1", {
      intervalMs: 500,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(result).toEqual({ ok: true, submission: PUBLISHED });
    expect(slept).toEqual([500, 500]);
    expect(requests.map((r) => r.path)).toEqual(["/api/submissions/s1", "/api/submissions/s1"]);
  });

  test("waitFor gives up after its timeout", async () => {
    const { client } = clientFor([
      [200, PENDING],
      [200, PENDING],
    ]);
    const result = await createSubmissions(client).waitFor("s1", {
      intervalMs: 500,
      timeoutMs: 1_000,
      sleep: async () => {},
    });
    expect(result.ok).toBe(false);
  });

  test("list returns the items, or null when they can't be read", async () => {
    const { client } = clientFor([
      [200, { items: [PUBLISHED] }],
      [401, { title: "Not logged in", status: 401 }],
    ]);
    const s = createSubmissions(client);
    expect(await s.list()).toEqual([PUBLISHED]);
    expect(await s.list()).toBeNull();
  });

  test("every verdict has words, and the share link points at the play page", () => {
    for (const v of [
      "unique",
      "duplicate",
      "none",
      "multiple",
      "unknown",
      "removed",
      "error",
    ] as const) {
      expect(verdictText(v).title.length).toBeGreaterThan(0);
    }
    expect(shareUrl("https://loophole.test", "a b")).toBe("https://loophole.test/play/a%20b");
  });
});
