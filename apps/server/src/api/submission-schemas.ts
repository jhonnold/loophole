import { z } from "@hono/zod-openapi";

// Request and response bodies of the submission and report routes (submissions.ts, reports.ts).

const Id = z.string().min(1).max(64);

const Size = z.int().min(1).max(100);

const Timestamp = z.iso.datetime().openapi({ example: "2026-10-25T12:00:00.000Z" });

export const SubmitRequestSchema = z
  .strictObject({
    width: Size,
    height: Size,
    clues: z
      .string()
      .max(10_000)
      .regex(/^[0-3.]*$/)
      .openapi({ description: "One character per cell, row-major: 0-3 or '.' (docs/FORMAT.md)." }),
  })
  .refine((b) => b.clues.length === b.width * b.height, {
    path: ["clues"],
    message: "must have one character per cell (width × height)",
  })
  .openapi("SubmitRequest", { description: "A puzzle to publish: its size and clues." });

export const SubmissionSchema = z
  .object({
    id: Id,
    width: Size,
    height: Size,
    status: z.enum(["pending", "published", "rejected"]),
    verdict: z
      .enum(["unique", "duplicate", "none", "multiple", "unknown", "removed", "error"])
      .nullable()
      .openapi({
        description:
          "Null while pending. `unique`: published. `duplicate`: the same clues were already published, see `puzzleId`. `none`, `multiple`: no solution, or more than one. `unknown`: the verifier ran out of time. `removed`: the same clues were unpublished by an admin. `error`: the check failed.",
      }),
    puzzleId: Id.nullable().openapi({ description: "The published puzzle to play and share." }),
    createdAt: Timestamp,
    decidedAt: Timestamp.nullable(),
  })
  .openapi("Submission", { description: "A submitted puzzle and the verifier's verdict." });

export const SubmissionListSchema = z
  .object({ items: z.array(SubmissionSchema) })
  .openapi("SubmissionList");

export const ReportRequestSchema = z
  .strictObject({
    reason: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .openapi({ description: "What is wrong with the puzzle, 1 to 500 characters." }),
  })
  .openapi("ReportRequest");

export const ReportedPuzzleSchema = z
  .object({
    puzzleId: Id,
    width: Size,
    height: Size,
    origin: z.enum(["generated", "submitted"]),
    createdAt: Timestamp,
    count: z.int().min(1).openapi({ description: "How many players reported it." }),
    reports: z
      .array(z.object({ reason: z.string(), createdAt: Timestamp }))
      .openapi({ description: "The newest reports first, at most five." }),
  })
  .openapi("ReportedPuzzle");

export const ReportedPuzzleListSchema = z
  .object({ items: z.array(ReportedPuzzleSchema) })
  .openapi("ReportedPuzzleList");
