import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { parsePuzzle } from "@loophole/core";
import type { SubmissionRecord } from "../domain.ts";
import type { SessionManager } from "../managers/session-manager.ts";
import type { SubmissionManager } from "../managers/submission-manager.ts";
import { problem, problemResponse } from "./problem.ts";
import { IdParamSchema } from "./schemas.ts";
import { currentUser } from "./session-cookie.ts";
import {
  SubmissionListSchema,
  SubmissionSchema,
  SubmitRequestSchema,
} from "./submission-schemas.ts";

export interface SubmissionRouteDeps {
  readonly submissions: SubmissionManager;
  readonly sessions: SessionManager;
}

/** How many submissions the list returns. */
const LIST_LIMIT = 50;

const notLoggedIn = problemResponse("Not logged in.");

const submitRoute = createRoute({
  method: "post",
  path: "/api/submissions",
  summary: "Submit a puzzle for publishing",
  description:
    "The server checks that the puzzle has exactly one solution in the background (PRD FR-27); poll the returned submission until it is no longer pending. Unique puzzles are published at once. Needs a confirmed email.",
  security: [{ session: [] }],
  request: {
    body: { required: true, content: { "application/json": { schema: SubmitRequestSchema } } },
  },
  responses: {
    202: {
      description: "Accepted. `Location` points at the submission.",
      content: { "application/json": { schema: SubmissionSchema } },
    },
    400: problemResponse("Invalid request body."),
    401: notLoggedIn,
    403: problemResponse("Email not confirmed, or sent from another site (CSRF protection)."),
    413: problemResponse("Request body larger than 64 KiB."),
    415: problemResponse("Request body is not JSON."),
    429: problemResponse("Too many submissions; `Retry-After` says when to try again."),
    503: problemResponse("Too many jobs waiting; try again later."),
  },
});

const listRoute = createRoute({
  method: "get",
  path: "/api/submissions",
  summary: "The logged-in player's submissions, newest first",
  security: [{ session: [] }],
  responses: {
    200: {
      description: "Submissions.",
      content: { "application/json": { schema: SubmissionListSchema } },
    },
    401: notLoggedIn,
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/api/submissions/{id}",
  summary: "One of the logged-in player's submissions",
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: "The submission.",
      content: { "application/json": { schema: SubmissionSchema } },
    },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    404: problemResponse("No submission of yours with this id."),
  },
});

/** Submitting puzzles and following what became of them (PRD FR-27). */
export function registerSubmissionRoutes(app: OpenAPIHono, deps: SubmissionRouteDeps): void {
  const { submissions, sessions } = deps;

  app.openapi(submitRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    // DECISIONS, "What unconfirmed accounts can do".
    if (user.emailVerifiedAt === null) {
      return problem(c, 403, "Email not confirmed", {
        detail: "Confirm your email address before submitting puzzles.",
      });
    }
    const { width, height, clues } = c.req.valid("json");
    const record = submissions.submit(user.id, parsePuzzle({ v: 1, width, height, clues }));
    c.header("Location", `/api/submissions/${record.id}`);
    return c.json(toSubmissionDto(record), 202);
  });

  app.openapi(listRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    return c.json({ items: submissions.listMine(user.id, LIST_LIMIT).map(toSubmissionDto) }, 200);
  });

  app.openapi(getRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    const record = submissions.get(c.req.valid("param").id, user.id);
    if (record === null) return problem(c, 404, "Submission not found");
    return c.json(toSubmissionDto(record), 200);
  });
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function toSubmissionDto(r: SubmissionRecord) {
  return {
    id: r.id,
    width: r.puzzle.grid.width,
    height: r.puzzle.grid.height,
    status: r.status,
    verdict: r.verdict,
    puzzleId: r.puzzleId,
    createdAt: iso(r.createdAt),
    decidedAt: r.decidedAt === null ? null : iso(r.decidedAt),
  };
}
