import { z } from "@hono/zod-openapi";
import { EdgesSchema } from "./schemas.ts";

// Request and response bodies of the saved progress routes (progress.ts).

const Id = z.string().min(1).max(64);

const Timestamp = z.iso.datetime().openapi({ example: "2026-10-25T12:00:00.000Z" });

/** 100 days: far more than anyone plays one attempt, and a safe integer. */
export const MAX_ELAPSED_MS = 100 * 24 * 60 * 60 * 1000;

const ElapsedMs = z
  .int()
  .min(0)
  .max(MAX_ELAPSED_MS)
  .openapi({ description: "Play time on this attempt in milliseconds." });

export const UserProgressParamSchema = z.object({
  userId: Id.openapi({
    param: { name: "userId", in: "path" },
    description: "Must be the logged-in user's id; anything else is refused with 403.",
  }),
});

export const PuzzleProgressParamSchema = UserProgressParamSchema.extend({
  puzzleId: Id.openapi({ param: { name: "puzzleId", in: "path" } }),
});

export const ProgressListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20).openapi({ example: 20 }),
});

export const ProgressSchema = z
  .object({
    puzzleId: Id,
    edges: z.string().openapi({ description: "Edge states (docs/FORMAT.md)." }),
    elapsedMs: ElapsedMs,
    solved: z.boolean(),
    assisted: z.boolean().openapi({ description: "A hint was shown during this attempt." }),
    version: z.int().min(1).openapi({
      description:
        "Goes up with every save that replaces the board; send it back as `baseVersion`.",
    }),
    updatedAt: Timestamp,
  })
  .openapi("Progress", { description: "A saved board on one puzzle (PRD FR-21)." });

export const ProgressResultSchema = z
  .object({ progress: z.union([ProgressSchema, z.null()]) })
  .openapi("ProgressResult", { description: "`progress` is null when nothing is saved." });

export const SaveProgressRequestSchema = z
  .strictObject({
    edges: EdgesSchema,
    elapsedMs: ElapsedMs,
    assisted: z.boolean(),
    baseVersion: z.union([z.int().min(1), z.null()]).openapi({
      description: "The `version` this board continues from, or null when the client had none.",
    }),
    device: z
      .string()
      .min(1)
      .max(64)
      .openapi({ description: "A random id for this browser, the same on every save." }),
  })
  .openapi("SaveProgressRequest");

export const SaveProgressResultSchema = z
  .object({
    progress: ProgressSchema,
    accepted: z.boolean().openapi({
      description:
        "False when the saved record was kept instead: it is solved, or the save was stale. `progress` is then that record.",
    }),
  })
  .openapi("SaveProgressResult");

export const ProgressSummarySchema = z
  .object({
    puzzleId: Id,
    width: z.int(),
    height: z.int(),
    elapsedMs: ElapsedMs,
    assisted: z.boolean(),
    updatedAt: Timestamp,
  })
  .openapi("ProgressSummary");

export const ProgressListSchema = z
  .object({ items: z.array(ProgressSummarySchema) })
  .openapi("ProgressList");
