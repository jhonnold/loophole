import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { ReportedPuzzle } from "../domain.ts";
import type { PuzzleManager } from "../managers/puzzle-manager.ts";
import type { ReportManager } from "../managers/report-manager.ts";
import type { SessionManager } from "../managers/session-manager.ts";
import { problem, problemResponse } from "./problem.ts";
import { IdParamSchema } from "./schemas.ts";
import { currentUser } from "./session-cookie.ts";
import { ReportedPuzzleListSchema, ReportRequestSchema } from "./submission-schemas.ts";

export interface ReportRouteDeps {
  readonly reports: ReportManager;
  readonly puzzles: PuzzleManager;
  readonly sessions: SessionManager;
}

const notLoggedIn = problemResponse("Not logged in.");
const crossSite = problemResponse("Sent from another site (CSRF protection).");
const notAdmin = problemResponse("Not an admin, or sent from another site (CSRF protection).");

const reportRoute = createRoute({
  method: "post",
  path: "/api/puzzles/{id}/report",
  summary: "Report a published puzzle to the admins",
  description: "Reporting the same puzzle again replaces your earlier reason.",
  security: [{ session: [] }],
  request: {
    params: IdParamSchema,
    body: { required: true, content: { "application/json": { schema: ReportRequestSchema } } },
  },
  responses: {
    204: { description: "Reported." },
    400: problemResponse("Invalid id or body."),
    401: notLoggedIn,
    403: crossSite,
    404: problemResponse("No published puzzle with this id."),
    413: problemResponse("Request body larger than 64 KiB."),
    415: problemResponse("Request body is not JSON."),
    429: problemResponse("Too many reports; `Retry-After` says when to try again."),
  },
});

const listReportsRoute = createRoute({
  method: "get",
  path: "/api/admin/reports",
  summary: "Reported puzzles that are still published (admins only)",
  security: [{ session: [] }],
  responses: {
    200: {
      description: "Reported puzzles, the most recently reported first.",
      content: { "application/json": { schema: ReportedPuzzleListSchema } },
    },
    401: notLoggedIn,
    403: problemResponse("Not an admin."),
  },
});

const unpublishRoute = createRoute({
  method: "post",
  path: "/api/admin/puzzles/{id}/unpublish",
  summary: "Unpublish a puzzle (admins only)",
  description: "It leaves every list, and players get 404 for it (PRD FR-28).",
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: {
    204: { description: "Unpublished (also when it already was)." },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    403: notAdmin,
    404: problemResponse("No puzzle with this id."),
  },
});

const dismissRoute = createRoute({
  method: "delete",
  path: "/api/admin/puzzles/{id}/reports",
  summary: "Dismiss a puzzle's reports, keeping it published (admins only)",
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: {
    204: { description: "Dismissed." },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    403: notAdmin,
  },
});

/** Reports from players and the admins' answers to them (PRD FR-28). */
export function registerReportRoutes(app: OpenAPIHono, deps: ReportRouteDeps): void {
  const { reports, puzzles, sessions } = deps;

  app.openapi(reportRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    const found = reports.report(user.id, c.req.valid("param").id, c.req.valid("json").reason);
    if (!found) return problem(c, 404, "Puzzle not found");
    return c.body(null, 204);
  });

  app.openapi(listReportsRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    if (!user.isAdmin) return problem(c, 403, "Admins only");
    return c.json({ items: reports.listReported().map(toReportedDto) }, 200);
  });

  app.openapi(unpublishRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    if (!user.isAdmin) return problem(c, 403, "Admins only");
    if (!puzzles.unpublish(c.req.valid("param").id)) return problem(c, 404, "Puzzle not found");
    return c.body(null, 204);
  });

  app.openapi(dismissRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    if (!user.isAdmin) return problem(c, 403, "Admins only");
    reports.dismiss(c.req.valid("param").id);
    return c.body(null, 204);
  });
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function toReportedDto(r: ReportedPuzzle) {
  return {
    puzzleId: r.puzzle.id,
    width: r.puzzle.puzzle.grid.width,
    height: r.puzzle.puzzle.grid.height,
    origin: r.puzzle.origin,
    createdAt: iso(r.puzzle.createdAt),
    count: r.count,
    reports: r.reports.map((x) => ({ reason: x.reason, createdAt: iso(x.createdAt) })),
  };
}
