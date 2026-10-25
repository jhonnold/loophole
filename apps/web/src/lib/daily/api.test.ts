import { describe, expect, test } from "bun:test";
import { createApiClient } from "@loophole/api-client";
import { type Attempt, createDailyApi } from "./api.ts";

const SET = {
  day: "2026-10-25",
  live: true,
  nextAt: "2026-10-26T00:00:00.000Z",
  puzzles: [{ size: 7, puzzleId: "d7" }],
};

/** A daily API whose fetch answers `respond` for every request, recording what was sent. */
function apiFor(respond: (req: Request) => Response | Promise<Response>) {
  const sent: { method: string; url: string; body: unknown }[] = [];
  const fetch = (async (req: Request) => {
    const url = new URL(req.url);
    const text = req.method === "GET" ? "" : await req.text();
    sent.push({
      method: req.method,
      url: url.pathname + url.search,
      body: text ? JSON.parse(text) : null,
    });
    return respond(req);
  }) as typeof globalThis.fetch;
  return { api: createDailyApi(createApiClient({ baseUrl: "http://api.test", fetch })), sent };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": status < 400 ? "application/json" : "application/problem+json" },
  });

describe("createDailyApi", () => {
  test("reads a day's puzzles, and null when the server can't be reached", async () => {
    const { api, sent } = apiFor(() => json(200, SET));
    expect(await api.day()).toEqual(SET);
    expect(await api.day("2026-10-24")).toEqual(SET);
    expect(sent.map((s) => s.url)).toEqual(["/api/daily", "/api/daily?day=2026-10-24"]);

    const down = apiFor(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await down.api.day()).toBeNull();
    // `vite preview` answers API paths with the app's own page.
    const page = apiFor(() => new Response("<!doctype html>", { status: 200 }));
    expect(await page.api.day()).toBeNull();
  });

  test("starts and finishes attempts, with the time in whole milliseconds", async () => {
    const attempt: Attempt = {
      puzzleId: "d7",
      day: "2026-10-25",
      area: 49,
      level: 1,
      status: "playing",
      startedAt: "2026-10-25T10:00:00.000Z",
      finishedAt: null,
      elapsedMs: 0,
      assisted: false,
      ranked: false,
      rank: null,
    };
    const { api, sent } = apiFor(() => json(200, { attempt }));
    expect(await api.start("u1", "d7")).toEqual({ ok: true, value: attempt });
    expect(await api.finish("u1", "d7", "1122", 1234.6)).toEqual({ ok: true, value: attempt });
    expect(sent).toEqual([
      { method: "POST", url: "/api/users/u1/attempts/d7", body: null },
      {
        method: "POST",
        url: "/api/users/u1/attempts/d7/finish",
        body: { edges: "1122", elapsedMs: 1235 },
      },
    ]);
  });

  test("a refused action carries its status and the server's reason", async () => {
    const { api } = apiFor(() =>
      json(409, { type: "about:blank", title: "Name taken", status: 409, detail: "Taken." }),
    );
    expect(await api.setDisplayName("u1", "tsuru")).toEqual({
      ok: false,
      status: 409,
      message: "Taken.",
    });
    const down = apiFor(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await down.api.attempt("u1", "d7")).toMatchObject({ ok: false, status: 0 });
  });

  test("dayResult tells a day to come from a server that can't be reached", async () => {
    const early = apiFor(() =>
      json(404, { type: "about:blank", title: "Daily puzzle not found", status: 404 }),
    );
    expect(await early.api.dayResult("2026-10-26")).toMatchObject({ ok: false, status: 404 });
    const { api } = apiFor(() => json(200, SET));
    expect(await api.dayResult("2026-10-25")).toEqual({ ok: true, value: SET });
  });

  test("an attempt that was never started reads as null", async () => {
    const { api } = apiFor(() => json(200, { attempt: null }));
    expect(await api.attempt("u1", "d7")).toEqual({ ok: true, value: null });
  });
});
