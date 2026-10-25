import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ProgressRecord, UserRecord } from "../domain.ts";
import type { ProgressManager } from "../managers/progress-manager.ts";
import type { SessionManager } from "../managers/session-manager.ts";
import type { RateLimiter, RateRule } from "../ports.ts";
import { tooManyRequests } from "./accounts.ts";
import { problem, problemResponse } from "./problem.ts";
import {
  ProgressListQuerySchema,
  ProgressListSchema,
  ProgressResultSchema,
  PuzzleProgressParamSchema,
  SaveProgressRequestSchema,
  SaveProgressResultSchema,
  UserProgressParamSchema,
} from "./progress-schemas.ts";
import { currentUser } from "./session-cookie.ts";

export interface ProgressRouteDeps {
  readonly progress: ProgressManager;
  readonly sessions: SessionManager;
  readonly limiter: RateLimiter;
}

/**
 * Progress requests per user. The web app saves at most every couple of seconds per open puzzle;
 * this leaves room for several tabs and for bringing in a guest's saves.
 */
const PROGRESS_LIMIT: RateRule = { limit: 120, windowMs: 60_000 };

const notLoggedIn = problemResponse("Not logged in.");
const otherUser = problemResponse(
  "The path names another user, or the request came from another site (CSRF protection).",
);
const tooMany = problemResponse("Too many requests; `Retry-After` says when to try again.");

const listRoute = createRoute({
  method: "get",
  path: "/api/users/{userId}/progress",
  summary: "The logged-in user's unsolved puzzles, most recently saved first",
  security: [{ session: [] }],
  request: { params: UserProgressParamSchema, query: ProgressListQuerySchema },
  responses: {
    200: {
      description: "Unsolved saved progress.",
      content: { "application/json": { schema: ProgressListSchema } },
    },
    400: problemResponse("Invalid query."),
    401: notLoggedIn,
    403: otherUser,
    429: tooMany,
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/api/users/{userId}/progress/{puzzleId}",
  summary: "The logged-in user's saved board on a puzzle",
  security: [{ session: [] }],
  request: { params: PuzzleProgressParamSchema },
  responses: {
    200: {
      description: "The saved board, or null.",
      content: { "application/json": { schema: ProgressResultSchema } },
    },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    403: otherUser,
    404: problemResponse("No published puzzle with this id."),
    429: tooMany,
  },
});

const putRoute = createRoute({
  method: "put",
  path: "/api/users/{userId}/progress/{puzzleId}",
  summary: "Save the logged-in user's board on a puzzle",
  description:
    "A solved record is kept until it is deleted. Sending the board already stored only updates the play time and keeps the version. A solved board replaces an unsolved one. Otherwise the board is saved only if it continues from the stored `version` (`baseVersion`) or comes from the `device` that saved it, so a stale tab can't overwrite newer play from another device. `assisted` only ever turns on. Whether the board is solved is worked out by the server.",
  security: [{ session: [] }],
  request: {
    params: PuzzleProgressParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: SaveProgressRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "What is saved now, and whether it is the board sent.",
      content: { "application/json": { schema: SaveProgressResultSchema } },
    },
    400: problemResponse("Invalid body, or a board that does not fit the puzzle."),
    401: notLoggedIn,
    403: otherUser,
    404: problemResponse("No published puzzle with this id."),
    413: problemResponse("Request body larger than 64 KiB."),
    415: problemResponse("Request body is not JSON."),
    429: tooMany,
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/api/users/{userId}/progress/{puzzleId}",
  summary: "Forget the logged-in user's board on a puzzle (start over)",
  security: [{ session: [] }],
  request: { params: PuzzleProgressParamSchema },
  responses: {
    204: { description: "Deleted (also when nothing was saved)." },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    403: otherUser,
    429: tooMany,
  },
});

/** Saved progress for logged-in players, synced across devices (PRD FR-21). */
export function registerProgressRoutes(app: OpenAPIHono, deps: ProgressRouteDeps): void {
  const { progress, sessions, limiter } = deps;

  /**
   * The logged-in user when the path names them, or the error response to send. Naming the user
   * in the path means a page that still thinks someone else is logged in (after a login in another
   * tab) gets a 403 instead of reading or writing the new account's progress.
   */
  async function owner(c: Context, userId: string) {
    const user: UserRecord | null = await currentUser(c, sessions);
    if (user === null) return { error: problem(c, 401, "Not logged in") };
    if (user.id !== userId) {
      return {
        error: problem(c, 403, "Logged in as someone else", {
          detail: "This progress belongs to another account. Reload the page.",
        }),
      };
    }
    const decision = limiter.hit(`progress:${user.id}`, PROGRESS_LIMIT);
    if (!decision.allowed) return { error: tooManyRequests(c, decision.retryAfterMs) };
    return { user };
  }

  app.openapi(listRoute, async (c) => {
    const { userId } = c.req.valid("param");
    const { user, error } = await owner(c, userId);
    if (error) return error;
    const items = progress.listInProgress(user.id, c.req.valid("query").limit);
    return c.json(
      {
        items: items.map(({ record, width, height }) => ({
          puzzleId: record.puzzleId,
          width,
          height,
          elapsedMs: record.elapsedMs,
          assisted: record.assisted,
          updatedAt: iso(record.updatedAt),
        })),
      },
      200,
    );
  });

  app.openapi(getRoute, async (c) => {
    const { userId, puzzleId } = c.req.valid("param");
    const { user, error } = await owner(c, userId);
    if (error) return error;
    const record = progress.get(user.id, puzzleId);
    return c.json({ progress: record === null ? null : toProgressDto(record) }, 200);
  });

  app.openapi(putRoute, async (c) => {
    const { userId, puzzleId } = c.req.valid("param");
    const { user, error } = await owner(c, userId);
    if (error) return error;
    const { record, accepted } = progress.save(user.id, puzzleId, c.req.valid("json"));
    return c.json({ progress: toProgressDto(record), accepted }, 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const { userId, puzzleId } = c.req.valid("param");
    const { user, error } = await owner(c, userId);
    if (error) return error;
    progress.delete(user.id, puzzleId);
    return c.body(null, 204);
  });
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function toProgressDto(r: ProgressRecord) {
  return {
    puzzleId: r.puzzleId,
    edges: r.edges,
    elapsedMs: r.elapsedMs,
    solved: r.solved,
    assisted: r.assisted,
    version: r.version,
    updatedAt: iso(r.updatedAt),
  };
}
