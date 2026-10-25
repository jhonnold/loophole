import { z } from "@hono/zod-openapi";

// Bodies of the readiness check and the admins' health report.

const Timestamp = z.iso.datetime().openapi({ example: "2026-10-25T12:00:00.000Z" });

export const ReadinessSchema = z
  .object({
    status: z.enum(["ok", "unavailable"]),
    database: z.boolean(),
    blobs: z.boolean(),
  })
  .openapi("Readiness", {
    description: "Whether the API's database and blob store answer. No error details.",
  });

const CheckSchema = z.object({
  ok: z.boolean(),
  ms: z.number().min(0),
  error: z.string().nullable(),
});

export const AdminHealthSchema = z
  .object({
    database: CheckSchema,
    blobs: CheckSchema,
    jobs: z.object({
      queued: z.int().min(0),
      running: z.int().min(0),
      oldestQueuedAt: Timestamp.nullable(),
    }),
    dailies: z
      .array(z.object({ size: z.int(), days: z.int().min(0) }))
      .openapi({ description: "Days in a row, from today on, whose daily puzzle is generated." }),
    failures: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(["generate", "verify"]),
        status: z.enum(["failed", "timeout"]),
        error: z.string().nullable(),
        finishedAt: Timestamp.nullable(),
      }),
    ),
    versions: z.object({ app: z.string(), generator: z.string(), runtime: z.string() }),
    startedAt: Timestamp,
  })
  .openapi("AdminHealth", { description: "System health for the admin page (PRD §5)." });
