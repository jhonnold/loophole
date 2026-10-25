import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { HealthManager, HealthReport } from "../managers/health-manager.ts";
import type { SessionManager } from "../managers/session-manager.ts";
import { AdminHealthSchema, ReadinessSchema } from "./health-schemas.ts";
import { problem, problemResponse } from "./problem.ts";
import { currentUser } from "./session-cookie.ts";

export interface HealthRouteDeps {
  readonly health: HealthManager;
  readonly sessions: SessionManager;
}

const readyRoute = createRoute({
  method: "get",
  path: "/api/health/ready",
  summary: "Readiness check: the database and the blob store answer",
  description:
    "For container health checks and load balancers. `/api/health` only says the process is up.",
  responses: {
    200: { description: "Ready.", content: { "application/json": { schema: ReadinessSchema } } },
    503: {
      description: "The database or the blob store isn't answering.",
      content: { "application/json": { schema: ReadinessSchema } },
    },
  },
});

const adminHealthRoute = createRoute({
  method: "get",
  path: "/api/admin/health",
  summary: "System health: checks, job queue, daily stock, recent failures, versions (admins only)",
  security: [{ session: [] }],
  responses: {
    200: {
      description: "The health report.",
      content: { "application/json": { schema: AdminHealthSchema } },
    },
    401: problemResponse("Not logged in."),
    403: problemResponse("Not an admin."),
  },
});

/** Readiness for orchestration, and the admins' health report. */
export function registerHealthRoutes(app: OpenAPIHono, deps: HealthRouteDeps): void {
  const { health, sessions } = deps;

  app.openapi(readyRoute, async (c) => {
    const r = await health.readiness();
    const body = {
      status: r.ok ? ("ok" as const) : ("unavailable" as const),
      database: r.database.ok,
      blobs: r.blobs.ok,
    };
    return r.ok ? c.json(body, 200) : c.json(body, 503);
  });

  app.openapi(adminHealthRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    if (!user.isAdmin) return problem(c, 403, "Admins only");
    return c.json(toAdminHealthDto(await health.report()), 200);
  });
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function toAdminHealthDto(r: HealthReport) {
  return {
    database: r.readiness.database,
    blobs: r.readiness.blobs,
    jobs: {
      queued: r.jobs.queued,
      running: r.jobs.running,
      oldestQueuedAt: r.jobs.oldestQueuedAt === null ? null : iso(r.jobs.oldestQueuedAt),
    },
    dailies: r.dailies.map((d) => ({ size: d.size, days: d.days })),
    failures: r.failures.map((j) => ({
      id: j.id,
      kind: j.kind,
      status: j.status === "timeout" ? ("timeout" as const) : ("failed" as const),
      error: j.error,
      finishedAt: j.finishedAt === null ? null : iso(j.finishedAt),
    })),
    versions: r.versions,
    startedAt: iso(r.startedAt),
  };
}
