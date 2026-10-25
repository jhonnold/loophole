import type { Hook } from "@hono/zod-openapi";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { EdgeState, type Hint, serializePuzzle } from "@loophole/core";
import type { Env } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "hono/bun";
import { HTTPException } from "hono/http-exception";
import type { Job, PuzzleRecord } from "../domain.ts";
import {
  CaptchaFailedError,
  InvalidCredentialsError,
  InvalidTokenError,
  QueueFullError,
  RateLimitedError,
} from "../managers/errors.ts";
import { type HintManager, InvalidBoardError } from "../managers/hint-manager.ts";
import type { JobManager } from "../managers/job-manager.ts";
import type { PuzzleManager } from "../managers/puzzle-manager.ts";
import { type AccountRouteDeps, registerAccountRoutes, tooManyRequests } from "./accounts.ts";
import { sameOriginOnly } from "./csrf.ts";
import { problem, problemResponse } from "./problem.ts";
import { type ReportRouteDeps, registerReportRoutes } from "./reports.ts";
import {
  GenerateRequestSchema,
  HealthSchema,
  HintRequestSchema,
  HintSchema,
  IdParamSchema,
  JobSchema,
  PuzzleListQuerySchema,
  PuzzleListSchema,
  PuzzleSchema,
} from "./schemas.ts";
import { currentUser } from "./session-cookie.ts";
import { registerSubmissionRoutes, type SubmissionRouteDeps } from "./submissions.ts";

export interface AppDeps extends AccountRouteDeps, SubmissionRouteDeps, ReportRouteDeps {
  readonly puzzles: PuzzleManager;
  readonly jobs: JobManager;
  readonly hints: HintManager;
  /** Folder of the built web app to serve at `/`, with `index.html` for unknown paths. */
  readonly webDir?: string;
}

/** Largest request body the API reads. Leaves room for a 100×100 puzzle (about 10 KB). */
const MAX_BODY_BYTES = 64 * 1024;

const healthRoute = createRoute({
  method: "get",
  path: "/api/health",
  summary: "Liveness check",
  responses: {
    200: {
      description: "The API is up.",
      content: { "application/json": { schema: HealthSchema } },
    },
  },
});

const listPuzzlesRoute = createRoute({
  method: "get",
  path: "/api/puzzles",
  summary: "Recent published puzzles, newest first",
  request: { query: PuzzleListQuerySchema },
  responses: {
    200: { description: "Puzzles.", content: { "application/json": { schema: PuzzleListSchema } } },
    400: problemResponse("Invalid query."),
  },
});

const getPuzzleRoute = createRoute({
  method: "get",
  path: "/api/puzzles/{id}",
  summary: "A published puzzle's clues (never its solution)",
  request: { params: IdParamSchema },
  responses: {
    200: { description: "The puzzle.", content: { "application/json": { schema: PuzzleSchema } } },
    400: problemResponse("Invalid id."),
    404: problemResponse("No published puzzle with this id (admins also get unpublished ones)."),
  },
});

const hintRoute = createRoute({
  method: "post",
  path: "/api/puzzles/{id}/hint",
  summary: "The next hint for a player's board",
  description:
    "Works from the player's marks and the stored solution, which is never sent (PRD FR-12, FR-25).",
  request: {
    params: IdParamSchema,
    body: { required: true, content: { "application/json": { schema: HintRequestSchema } } },
  },
  responses: {
    200: { description: "The hint.", content: { "application/json": { schema: HintSchema } } },
    400: problemResponse("Invalid id, or a board that does not fit the puzzle."),
    404: problemResponse("No published puzzle with this id."),
    413: problemResponse("Request body larger than 64 KiB."),
    403: problemResponse("Sent from another site (CSRF protection)."),
    415: problemResponse("Request body is not JSON."),
  },
});

const generateRoute = createRoute({
  method: "post",
  path: "/api/jobs/generate",
  summary: "Queue a puzzle generation",
  description: "Generation runs in the background; poll the returned job until it is done.",
  request: {
    body: { required: true, content: { "application/json": { schema: GenerateRequestSchema } } },
  },
  responses: {
    202: {
      description: "Queued. `Location` points at the job.",
      content: { "application/json": { schema: JobSchema } },
    },
    400: problemResponse("Invalid request body."),
    413: problemResponse("Request body larger than 64 KiB."),
    415: problemResponse("Request body is not JSON."),
    403: problemResponse("Sent from another site (CSRF protection)."),
    503: problemResponse("Too many jobs waiting; try again later."),
  },
});

const getJobRoute = createRoute({
  method: "get",
  path: "/api/jobs/{id}",
  summary: "A job's status, progress and result",
  request: { params: IdParamSchema },
  responses: {
    200: { description: "The job.", content: { "application/json": { schema: JobSchema } } },
    400: problemResponse("Invalid id."),
    404: problemResponse("No job with this id."),
  },
});

/** Turns zod validation failures into 400 problem responses. */
const validationHook: Hook<unknown, Env, string, unknown> = (result, c) => {
  if (result.success) return;
  const errors = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  return problem(c, 400, "Invalid request", {
    detail: errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join("; "),
    errors,
  });
};

/** The HTTP API: routes translate between wire shapes and domain types; managers do the work. */
export function createApp(deps: AppDeps): OpenAPIHono {
  const { puzzles, jobs, hints } = deps;
  const app = new OpenAPIHono({ defaultHook: validationHook });

  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => problem(c, 413, "Request body too large"),
    }),
  );
  app.use("/api/*", sameOriginOnly);

  app.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));

  app.openapi(listPuzzlesRoute, (c) => {
    const { limit } = c.req.valid("query");
    return c.json({ items: puzzles.listRecent(limit).map(toPuzzleSummary) }, 200);
  });

  app.openapi(getPuzzleRoute, async (c) => {
    const id = c.req.valid("param").id;
    let record = puzzles.get(id);
    // Admins can still open an unpublished puzzle, to review it (PRD FR-28).
    if (record === null && (await currentUser(c, deps.sessions))?.isAdmin) {
      record = puzzles.getAny(id);
    }
    if (record === null) return problem(c, 404, "Puzzle not found");
    return c.json(toPuzzleDto(record), 200);
  });

  app.openapi(hintRoute, async (c) => {
    const hint = await hints.hint(c.req.valid("param").id, c.req.valid("json").edges);
    if (hint === null) return problem(c, 404, "Puzzle not found");
    return c.json(toHintDto(hint), 200);
  });

  app.openapi(generateRoute, (c) => {
    const job = jobs.enqueueGenerate(c.req.valid("json"));
    c.header("Location", `/api/jobs/${job.id}`);
    return c.json(toJobDto(job), 202);
  });

  app.openapi(getJobRoute, (c) => {
    const job = jobs.get(c.req.valid("param").id);
    if (job === null) return problem(c, 404, "Job not found");
    return c.json(toJobDto(job), 200);
  });

  registerAccountRoutes(app, deps);
  registerSubmissionRoutes(app, deps);
  registerReportRoutes(app, deps);

  app.all("/api/*", (c) => problem(c, 404, "Not found"));

  if (deps.webDir !== undefined) {
    app.use("*", serveStatic({ root: deps.webDir }));
    app.get("*", serveStatic({ root: deps.webDir, path: "index.html" }));
  }

  app.notFound((c) => problem(c, 404, "Not found"));

  app.onError((err, c) => {
    if (err instanceof QueueFullError)
      return problem(c, 503, "Queue full", { detail: err.message });
    if (err instanceof InvalidBoardError)
      return problem(c, 400, "Invalid board", { detail: err.message });
    if (err instanceof InvalidCredentialsError)
      return problem(c, 401, "Wrong email or password", { detail: err.message });
    if (err instanceof CaptchaFailedError)
      return problem(c, 400, "CAPTCHA check failed", { detail: err.message });
    if (err instanceof InvalidTokenError)
      return problem(c, 400, "Invalid or expired link", { detail: err.message });
    if (err instanceof RateLimitedError) return tooManyRequests(c, err.retryAfterMs);
    if (err instanceof HTTPException) return problem(c, err.status, err.message);
    console.error(err);
    return problem(c, 500, "Internal server error");
  });

  return app;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function toPuzzleDto(r: PuzzleRecord) {
  return {
    id: r.id,
    puzzle: serializePuzzle(r.puzzle),
    origin: r.origin,
    createdAt: iso(r.createdAt),
  };
}

function toPuzzleSummary(r: PuzzleRecord) {
  return {
    id: r.id,
    width: r.puzzle.grid.width,
    height: r.puzzle.grid.height,
    origin: r.origin,
    createdAt: iso(r.createdAt),
  };
}

function toHintDto(hint: Hint) {
  switch (hint.kind) {
    case "solved":
      return { kind: "solved" as const };
    case "mistake":
      return { kind: "mistake" as const, edge: hint.edge, count: hint.count };
    case "reveal":
      return { kind: "reveal" as const, edge: hint.edge };
    case "step":
      return {
        kind: "step" as const,
        rule: hint.step.rule,
        changes: hint.step.changes.map((ch) => ({
          edge: ch.edge,
          state: ch.state === EdgeState.Line ? ("line" as const) : ("cross" as const),
        })),
        cells: [...hint.step.cells],
        dots: [...hint.step.dots],
      };
  }
}

function toJobDto(job: Job) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    result: job.result?.kind === "generate" ? { puzzleId: job.result.puzzleId } : null,
    error: job.error,
    createdAt: iso(job.createdAt),
    startedAt: job.startedAt === null ? null : iso(job.startedAt),
    finishedAt: job.finishedAt === null ? null : iso(job.finishedAt),
  };
}
