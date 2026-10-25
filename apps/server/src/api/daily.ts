import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { LeaderboardEntry } from "../domain.ts";
import type { AttemptManager, AttemptView } from "../managers/attempt-manager.ts";
import type { DailyManager } from "../managers/daily-manager.ts";
import type { DisplayNameManager } from "../managers/display-name-manager.ts";
import type { Leaderboard, LeaderboardManager } from "../managers/leaderboard-manager.ts";
import type { SessionManager } from "../managers/session-manager.ts";
import type { RateLimiter, RateRule } from "../ports.ts";
import { tooManyRequests } from "./accounts.ts";
import {
  AttemptParamSchema,
  AttemptResultSchema,
  BucketBoardParamSchema,
  BucketBoardQuerySchema,
  DailyQuerySchema,
  DailySetSchema,
  DailySummarySchema,
  DisplayNameSchema,
  FinishAttemptRequestSchema,
  LeaderboardQuerySchema,
  LeaderboardSchema,
  PuzzleBoardParamSchema,
  SetDisplayNameRequestSchema,
  StartedAttemptSchema,
  UserParamSchema,
} from "./daily-schemas.ts";
import { problem, problemResponse } from "./problem.ts";
import { currentUser } from "./session-cookie.ts";

export interface DailyRouteDeps {
  readonly dailies: DailyManager;
  readonly attempts: AttemptManager;
  readonly leaderboards: LeaderboardManager;
  readonly displayNames: DisplayNameManager;
  readonly sessions: SessionManager;
  readonly limiter: RateLimiter;
}

/** Requests per user to the routes for their own daily data. */
const PLAYER_LIMIT: RateRule = { limit: 120, windowMs: 60_000 };

const notLoggedIn = problemResponse("Not logged in.");
const otherUser = problemResponse(
  "The path names another user, or the request came from another site (CSRF protection).",
);
const unconfirmed = problemResponse(
  "The path names another user, the email isn't confirmed, or the request came from another site (CSRF protection).",
);
const tooMany = problemResponse("Too many requests; `Retry-After` says when to try again.");
const noDaily = problemResponse("No daily puzzle with this id that players can see.");

const dailyRoute = createRoute({
  method: "get",
  path: "/api/daily",
  summary: "A day's daily puzzles, one per size class (today by default)",
  request: { query: DailyQuerySchema },
  responses: {
    200: {
      description: "The puzzles.",
      content: { "application/json": { schema: DailySetSchema } },
    },
    400: problemResponse("Invalid day."),
    404: problemResponse("A day still to come."),
  },
});

const summaryRoute = createRoute({
  method: "get",
  path: "/api/users/{userId}/daily",
  summary: "The logged-in player's streak, last week, today's attempts and best times",
  security: [{ session: [] }],
  request: { params: UserParamSchema },
  responses: {
    200: {
      description: "The summary.",
      content: { "application/json": { schema: DailySummarySchema } },
    },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    403: otherUser,
    429: tooMany,
  },
});

const getAttemptRoute = createRoute({
  method: "get",
  path: "/api/users/{userId}/attempts/{puzzleId}",
  summary: "The logged-in player's ranked attempt at a daily puzzle",
  security: [{ session: [] }],
  request: { params: AttemptParamSchema },
  responses: {
    200: {
      description: "The attempt, or null.",
      content: { "application/json": { schema: AttemptResultSchema } },
    },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    403: otherUser,
    404: noDaily,
    429: tooMany,
  },
});

const startRoute = createRoute({
  method: "post",
  path: "/api/users/{userId}/attempts/{puzzleId}",
  summary: "Start a ranked attempt at today's daily puzzle",
  description:
    "One attempt per player and daily (PRD FR-25): the clock starts on the server now and doesn't stop. Starting again returns the attempt already started. Needs a confirmed email.",
  security: [{ session: [] }],
  request: { params: AttemptParamSchema },
  responses: {
    200: {
      description: "The attempt.",
      content: { "application/json": { schema: StartedAttemptSchema } },
    },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    403: unconfirmed,
    404: noDaily,
    409: problemResponse("The daily's day is over: it can be played, but not ranked."),
    429: tooMany,
  },
});

const finishRoute = createRoute({
  method: "post",
  path: "/api/users/{userId}/attempts/{puzzleId}/finish",
  summary: "Finish a ranked attempt with the solved board",
  description:
    "The server checks the board against the stored solution (PRD FR-17, FR-25) and sets the ranked time: the player's own time, but never more than a tenth of the server's time (3 to 15 s) under it. A solve is ranked unless a hint was used or it was faster than the loop can be drawn. Sending it again returns the finished attempt unchanged.",
  security: [{ session: [] }],
  request: {
    params: AttemptParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: FinishAttemptRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "The finished attempt, with its rank.",
      content: { "application/json": { schema: StartedAttemptSchema } },
    },
    400: problemResponse("Invalid body, a board that doesn't fit, or not the solution."),
    401: notLoggedIn,
    403: unconfirmed,
    404: problemResponse("No such daily, or no attempt started at it."),
    413: problemResponse("Request body larger than 64 KiB."),
    415: problemResponse("Request body is not JSON."),
    429: tooMany,
  },
});

const puzzleBoardRoute = createRoute({
  method: "get",
  path: "/api/leaderboards/daily/{puzzleId}",
  summary: "A daily puzzle's leaderboard",
  description:
    "Ranked solves by time; ties go to whoever finished first. When logged in, the player's own row and its neighbours are included even outside the top.",
  request: { params: PuzzleBoardParamSchema, query: LeaderboardQuerySchema },
  responses: {
    200: {
      description: "The leaderboard.",
      content: { "application/json": { schema: LeaderboardSchema } },
    },
    400: problemResponse("Invalid id or query."),
    404: noDaily,
  },
});

const bucketBoardRoute = createRoute({
  method: "get",
  path: "/api/leaderboards/areas/{area}",
  summary: "The all-time leaderboard of one area and level",
  description:
    "Each player's best ranked time on daily puzzles of this area (width × height) and level (PRD FR-23).",
  request: { params: BucketBoardParamSchema, query: BucketBoardQuerySchema },
  responses: {
    200: {
      description: "The leaderboard.",
      content: { "application/json": { schema: LeaderboardSchema } },
    },
    400: problemResponse("Invalid area or query."),
  },
});

const getNameRoute = createRoute({
  method: "get",
  path: "/api/users/{userId}/display-name",
  summary: "The name the logged-in player shows on leaderboards",
  security: [{ session: [] }],
  request: { params: UserParamSchema },
  responses: {
    200: {
      description: "The name, or null.",
      content: { "application/json": { schema: DisplayNameSchema } },
    },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    403: otherUser,
    429: tooMany,
  },
});

const setNameRoute = createRoute({
  method: "put",
  path: "/api/users/{userId}/display-name",
  summary: "Choose, change or remove the name shown on leaderboards",
  description:
    "3 to 20 of A–Z, a–z, 0–9, _ . or -, with at least one letter or digit. Names are public and unique, ignoring case. Null removes it: the player then shows as anonymous.",
  security: [{ session: [] }],
  request: {
    params: UserParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: SetDisplayNameRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "The name now.",
      content: { "application/json": { schema: DisplayNameSchema } },
    },
    400: problemResponse("Invalid body, or a name that can't be used."),
    401: notLoggedIn,
    403: otherUser,
    409: problemResponse("Another player has this name."),
    413: problemResponse("Request body larger than 64 KiB."),
    415: problemResponse("Request body is not JSON."),
    429: tooMany,
  },
});

/** Daily puzzles, ranked attempts, leaderboards and display names (PRD FR-17, FR-22 to FR-25). */
export function registerDailyRoutes(app: OpenAPIHono, deps: DailyRouteDeps): void {
  const { dailies, attempts, leaderboards, displayNames, sessions, limiter } = deps;

  /**
   * The logged-in user when the path names them, or the error response to send (as for saved
   * progress). With `confirmed`, the email must be confirmed too (DECISIONS, "What unconfirmed
   * accounts can do").
   */
  async function owner(c: Context, userId: string, confirmed = false) {
    const user = await currentUser(c, sessions);
    if (user === null) return { error: problem(c, 401, "Not logged in") };
    if (user.id !== userId) {
      return {
        error: problem(c, 403, "Logged in as someone else", {
          detail: "This belongs to another account. Reload the page.",
        }),
      };
    }
    if (confirmed && user.emailVerifiedAt === null) {
      return {
        error: problem(c, 403, "Email not confirmed", {
          detail: "Confirm your email address to play ranked.",
        }),
      };
    }
    const decision = limiter.hit(`daily:${user.id}`, PLAYER_LIMIT);
    if (!decision.allowed) return { error: tooManyRequests(c, decision.retryAfterMs) };
    return { user };
  }

  app.openapi(dailyRoute, (c) => {
    const set = dailies.forDay(c.req.valid("query").day);
    return c.json({ ...set, nextAt: iso(set.nextAt), puzzles: [...set.puzzles] }, 200);
  });

  app.openapi(summaryRoute, async (c) => {
    const { user, error } = await owner(c, c.req.valid("param").userId);
    if (error) return error;
    const s = attempts.summary(user.id);
    return c.json(
      {
        day: s.day,
        streak: s.streak,
        week: [...s.week],
        attempts: s.attempts.map(toAttemptDto),
        bests: [...s.bests],
      },
      200,
    );
  });

  app.openapi(getAttemptRoute, async (c) => {
    const { userId, puzzleId } = c.req.valid("param");
    const { user, error } = await owner(c, userId);
    if (error) return error;
    const view = attempts.get(user.id, puzzleId);
    return c.json({ attempt: view === null ? null : toAttemptDto(view) }, 200);
  });

  app.openapi(startRoute, async (c) => {
    const { userId, puzzleId } = c.req.valid("param");
    const { user, error } = await owner(c, userId, true);
    if (error) return error;
    return c.json({ attempt: toAttemptDto(attempts.start(user.id, puzzleId)) }, 200);
  });

  app.openapi(finishRoute, async (c) => {
    const { userId, puzzleId } = c.req.valid("param");
    const { user, error } = await owner(c, userId, true);
    if (error) return error;
    const view = await attempts.finish(user.id, puzzleId, c.req.valid("json"));
    return c.json({ attempt: toAttemptDto(view) }, 200);
  });

  app.openapi(puzzleBoardRoute, async (c) => {
    const viewer = await currentUser(c, sessions);
    const board = leaderboards.forPuzzle(
      c.req.valid("param").puzzleId,
      viewer?.id ?? null,
      c.req.valid("query").limit,
    );
    return c.json(toLeaderboardDto(board, viewer?.id ?? null), 200);
  });

  app.openapi(bucketBoardRoute, async (c) => {
    const viewer = await currentUser(c, sessions);
    const { level, limit } = c.req.valid("query");
    const board = leaderboards.forBucket(
      c.req.valid("param").area,
      level,
      viewer?.id ?? null,
      limit,
    );
    return c.json(toLeaderboardDto(board, viewer?.id ?? null), 200);
  });

  app.openapi(getNameRoute, async (c) => {
    const { user, error } = await owner(c, c.req.valid("param").userId);
    if (error) return error;
    return c.json({ displayName: displayNames.get(user.id) }, 200);
  });

  app.openapi(setNameRoute, async (c) => {
    const { user, error } = await owner(c, c.req.valid("param").userId);
    if (error) return error;
    const displayName = displayNames.set(user.id, c.req.valid("json").displayName);
    return c.json({ displayName }, 200);
  });
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function toAttemptDto({ attempt: a, elapsedMs, rank }: AttemptView) {
  return {
    puzzleId: a.puzzleId,
    day: a.day,
    area: a.area,
    level: a.level,
    status: a.finishedAt === null ? ("playing" as const) : ("finished" as const),
    startedAt: iso(a.startedAt),
    finishedAt: a.finishedAt === null ? null : iso(a.finishedAt),
    elapsedMs,
    assisted: a.assisted,
    ranked: a.ranked,
    rank,
  };
}

/** Player ids never leave the server: a row says only whether it is the viewer's. */
function toLeaderboardDto(board: Leaderboard, viewerId: string | null) {
  const entry = (e: LeaderboardEntry) => ({
    rank: e.rank,
    name: e.name,
    timeMs: e.timeMs,
    me: e.userId === viewerId,
  });
  return {
    area: board.area,
    level: board.level,
    total: board.total,
    entries: board.entries.map(entry),
    me: board.me === null ? null : entry(board.me),
  };
}
