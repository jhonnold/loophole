import { z } from "@hono/zod-openapi";
import { RULE_IDS } from "@loophole/core";

// Request and response bodies of the HTTP API. These are the wire shapes the OpenAPI document and
// the generated client are built from; routes translate them to and from domain types.

const Id = z.string().min(1).max(64);

const Size = z.int().min(1).max(100);

const Timestamp = z.iso.datetime().openapi({ example: "2026-10-25T12:00:00.000Z" });

export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.int(),
    detail: z.string().optional(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .openapi({ description: "Each invalid field, for 400 responses." }),
  })
  .openapi("Problem", { description: "An error, as RFC 9457 problem details." });

export const PuzzleWireSchema = z
  .object({
    v: z.literal(1),
    width: Size,
    height: Size,
    clues: z.string().openapi({ description: "One character per cell, row-major: 0-3 or '.'." }),
    seed: z.string().optional(),
    meta: z.record(z.string(), z.string()).optional(),
  })
  .openapi("PuzzleWire", { description: "A puzzle in wire format version 1 (docs/FORMAT.md)." });

export const PuzzleOriginSchema = z.enum(["generated", "submitted"]).openapi("PuzzleOrigin");

export const PuzzleSchema = z
  .object({
    id: Id,
    puzzle: PuzzleWireSchema,
    origin: PuzzleOriginSchema,
    createdAt: Timestamp,
  })
  .openapi("Puzzle", { description: "A published puzzle: clues only, never the solution." });

export const PuzzleSummarySchema = z
  .object({ id: Id, width: Size, height: Size, origin: PuzzleOriginSchema, createdAt: Timestamp })
  .openapi("PuzzleSummary");

export const PuzzleListSchema = z
  .object({ items: z.array(PuzzleSummarySchema) })
  .openapi("PuzzleList");

export const PuzzleListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20).openapi({ example: 20 }),
});

export const IdParamSchema = z.object({
  id: Id.openapi({
    param: { name: "id", in: "path" },
    example: "0b8e9f5c-6f7e-4c43-9d55-0d5f8e7b3a21",
  }),
});

export const GenerateRequestSchema = z
  .strictObject({
    width: Size,
    height: Size,
    seed: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .openapi({ description: "Same seed, size and generator version give the same puzzle." }),
  })
  .openapi("GenerateRequest");

export const JobSchema = z
  .object({
    id: Id,
    kind: z.enum(["generate", "verify"]),
    status: z.enum(["queued", "running", "done", "failed", "timeout"]),
    progress: z.number().min(0).max(1),
    result: z
      .object({ puzzleId: Id })
      .nullable()
      .openapi({ description: "Set when a generation is done." }),
    error: z.string().nullable(),
    createdAt: Timestamp,
    startedAt: Timestamp.nullable(),
    finishedAt: Timestamp.nullable(),
  })
  .openapi("Job");

export const HealthSchema = z.object({ status: z.literal("ok") }).openapi("Health");

/** A player's board; its length is checked against the puzzle after validation. */
export const EdgesSchema = z
  .string()
  .regex(/^[012]*$/)
  .max(20_200)
  .openapi({
    description:
      "The player's board: one character per edge, 0 empty, 1 line, 2 cross (docs/FORMAT.md).",
  });

export const HintRequestSchema = z.strictObject({ edges: EdgesSchema }).openapi("HintRequest");

const EdgeIndex = z.int().min(0);

export const HintSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("solved") }),
    z.object({
      kind: z.literal("mistake"),
      edge: EdgeIndex.openapi({
        description: "The first edge marked differently from the solution.",
      }),
      count: z.int().min(1).openapi({ description: "How many marks are wrong." }),
    }),
    z.object({
      kind: z.literal("step"),
      rule: z.enum(RULE_IDS),
      changes: z.array(z.object({ edge: EdgeIndex, state: z.enum(["line", "cross"]) })),
      cells: z.array(z.int().min(0)),
      dots: z.array(z.int().min(0)),
    }),
    z.object({
      kind: z.literal("reveal"),
      edge: EdgeIndex.openapi({ description: "An open edge that is a line in the solution." }),
    }),
  ])
  .openapi("Hint", {
    description:
      "The next hint: a wrong mark, the next deduction (rule, edges it decides, cells and dots it rests on), a line from the solution when no rule applies, or solved.",
  });
