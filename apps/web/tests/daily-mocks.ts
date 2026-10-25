import type { Schemas } from "@loophole/api-client";
import { decodeEdges, EdgeState, findHint, parsePuzzle } from "@loophole/core";
import type { Page, Route } from "@playwright/test";
import { FIXTURES } from "../src/lib/puzzles/fixtures.ts";
import { FIXTURE_SOLUTIONS } from "../src/lib/test-support/solutions.ts";

// A stand-in for the daily puzzle API, so the guest end-to-end tests (`bun run test:e2e`, no
// server) can open daily puzzles, ranked attempts and leaderboards. Today's 7×7 daily is the
// small-7 fixture under the id below; the other sizes aren't ready.

export const DAILY_ID = "e2e-daily-7";
export const TODAY = new Date().toISOString().slice(0, 10);

const small7 = FIXTURES.find((f) => f.id === "small-7");
if (small7 === undefined) throw new Error("small-7 fixture missing");
const small7Puzzle = parsePuzzle(small7.wire);
const small7Text = FIXTURE_SOLUTIONS["small-7"];
if (small7Text === undefined) throw new Error("small-7 solution missing");
const small7Solution = decodeEdges(small7Puzzle.grid, small7Text);

export const USER: Schemas["User"] = {
  id: "u1",
  email: "ann@example.com",
  emailVerified: true,
  isAdmin: false,
  createdAt: "2026-10-01T00:00:00.000Z",
};

export function attempt(changes: Partial<Schemas["Attempt"]> = {}): Schemas["Attempt"] {
  return {
    puzzleId: DAILY_ID,
    day: TODAY,
    area: 49,
    level: 1,
    status: "playing",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    elapsedMs: 0,
    assisted: false,
    ranked: false,
    rank: null,
    ...changes,
  };
}

/** The Solved artboard's board: the top three, a gap, then the player and their neighbours. */
export const BOARD: Schemas["Leaderboard"] = {
  area: 49,
  level: 1,
  total: 480,
  entries: [
    { rank: 1, name: "kuroneko", timeMs: 72_000, me: false },
    { rank: 2, name: "tsuru", timeMs: 79_000, me: false },
    { rank: 3, name: "inkwell", timeMs: 86_000, me: false },
    { rank: 213, name: null, timeMs: 197_000, me: false },
    { rank: 214, name: null, timeMs: 198_000, me: true },
    { rank: 215, name: "loop_de_loop", timeMs: 201_000, me: false },
  ],
  me: { rank: 214, name: null, timeMs: 198_000, me: true },
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: status < 400 ? "application/json" : "application/problem+json",
    body: JSON.stringify(body),
  });

export interface MockOptions {
  /** Log in as `USER`; a guest otherwise. */
  readonly user?: boolean;
  /** The player's attempt at today's 7×7, as the server first reports it. */
  readonly attempt?: Schemas["Attempt"] | null;
  /** The saved board on the daily, in the edge-state encoding. */
  readonly progress?: string;
  /** What finishing the attempt answers. */
  readonly finished?: Schemas["Attempt"];
  /** The player has today's 7×7 unfinished, so it is listed under "Continue". */
  readonly inProgress?: boolean;
  /** The day the daily API serves; a test changes `current` to make the next day's set come out. */
  readonly day?: { current: string };
  /** Starting the attempt is refused with a 409 because the day has ended (and the set says so). */
  readonly endsOnStart?: boolean;
}

/** The UTC day after `day` (`YYYY-MM-DD`). */
export function dayAfter(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Answers the daily API (and the session and progress routes it needs) from fixed data. */
export async function mockDailyApi(page: Page, options: MockOptions = {}) {
  let current = options.attempt ?? null;
  // The saved board on the daily: PUT replaces it and DELETE (Start over, or a ranked start) drops it.
  let stored = options.progress === undefined ? null : { edges: options.progress, solved: true };
  await page.route("**/api/session", (route) => json(route, { user: options.user ? USER : null }));
  // The day the set is for; a test moves it on to show the next day's set.
  const served = options.day ?? { current: TODAY };
  let ended = false;
  await page.route("**/api/daily*", (route) =>
    json(route, {
      day: served.current,
      live: !ended,
      nextAt: `${dayAfter(served.current)}T00:00:00.000Z`,
      puzzles: [
        { size: 7, puzzleId: DAILY_ID },
        { size: 10, puzzleId: null },
        { size: 20, puzzleId: null },
        { size: 40, puzzleId: null },
      ],
    }),
  );
  await page.route(`**/api/puzzles/${DAILY_ID}`, (route) =>
    json(route, {
      id: DAILY_ID,
      puzzle: small7?.wire,
      origin: "generated",
      createdAt: `${TODAY}T00:00:00.000Z`,
    }),
  );
  await page.route(`**/api/leaderboards/**`, (route) => json(route, BOARD));
  await page.route("**/api/users/u1/daily", (route) =>
    json(route, {
      day: TODAY,
      streak: 12,
      week: [6, 5, 4, 3, 2, 1, 0].map((back) => ({
        day: new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10),
        finished: back > 0,
      })),
      attempts: current === null ? [] : [current],
      bests: [{ area: 49, level: 1, timeMs: 171_000 }],
    }),
  );
  await page.route(`**/api/users/u1/attempts/${DAILY_ID}`, (route) => {
    if (route.request().method() === "POST") {
      if (options.endsOnStart) {
        ended = true;
        return json(
          route,
          { title: "The day has ended", status: 409, detail: "That day is over." },
          409,
        );
      }
      current = attempt();
    }
    return json(route, { attempt: current });
  });
  // The hint for today's 7×7, worked out from its solution as the app's own hints are.
  await page.route(`**/api/puzzles/${DAILY_ID}/hint`, (route) => {
    const { edges } = route.request().postDataJSON() as { edges: string };
    const hint = findHint(small7Puzzle, small7Solution, decodeEdges(small7Puzzle.grid, edges));
    if (hint.kind !== "step") throw new Error(`expected a step, got ${hint.kind}`);
    return json(route, {
      kind: "step",
      rule: hint.step.rule,
      cells: hint.step.cells,
      dots: hint.step.dots,
      changes: hint.step.changes.map((c) => ({
        edge: c.edge,
        state: c.state === EdgeState.Line ? "line" : "cross",
      })),
    });
  });
  await page.route(`**/api/users/u1/attempts/${DAILY_ID}/finish`, (route) => {
    current = options.finished ?? attempt({ status: "finished", ranked: true, rank: 1 });
    return json(route, { attempt: current });
  });
  await page.route("**/api/users/u1/progress*", (route) =>
    json(route, {
      items: options.inProgress
        ? [
            {
              puzzleId: DAILY_ID,
              width: 7,
              height: 7,
              elapsedMs: 30_000,
              assisted: false,
              updatedAt: new Date().toISOString(),
            },
          ]
        : [],
    }),
  );
  await page.route(`**/api/users/u1/progress/${DAILY_ID}`, async (route) => {
    const request = route.request();
    if (request.method() === "DELETE") {
      stored = null;
      return route.fulfill({ status: 204 });
    }
    if (request.method() === "PUT") {
      const body = request.postDataJSON() as { edges: string; elapsedMs: number };
      stored = { edges: body.edges, solved: false };
      const progress = {
        puzzleId: DAILY_ID,
        edges: body.edges,
        elapsedMs: body.elapsedMs,
        solved: false,
        assisted: false,
        version: 2,
        updatedAt: new Date().toISOString(),
      };
      return json(route, { progress, accepted: true });
    }
    if (stored === null) return json(route, { progress: null });
    return json(route, {
      progress: {
        puzzleId: DAILY_ID,
        edges: stored.edges,
        elapsedMs: 198_000,
        solved: stored.solved,
        assisted: false,
        version: 1,
        updatedAt: new Date().toISOString(),
      },
    });
  });
}
