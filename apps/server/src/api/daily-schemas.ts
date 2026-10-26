import { z } from "@hono/zod-openapi";
import { LEVELS } from "@loophole/core";
import { isDay } from "../managers/days.ts";
import { EdgesSchema, LevelSchema } from "./schemas.ts";

// Request and response bodies of the daily puzzle, ranked attempt, leaderboard and display name
// routes (daily.ts).

const Id = z.string().min(1).max(64);

const Timestamp = z.iso.datetime().openapi({ example: "2026-10-25T12:00:00.000Z" });

/** 100 days, as for saved progress: a safe integer far above any real attempt. */
const MAX_ELAPSED_MS = 100 * 24 * 60 * 60 * 1000;

const Ms = z.int().min(0).max(MAX_ELAPSED_MS);

const Day = z
  .string()
  .refine(isDay, "Expected a calendar day as YYYY-MM-DD.")
  .openapi({ example: "2026-10-25", description: "A UTC day, YYYY-MM-DD." });

export const DailyQuerySchema = z.object({
  day: Day.optional().openapi({ description: "A UTC day up to today; default today." }),
});

export const DailySetSchema = z
  .object({
    day: Day,
    live: z.boolean().openapi({ description: "The day is today, so its puzzles can be ranked." }),
    nextAt: Timestamp.openapi({ description: "When the next day's puzzles come out (00:00 UTC)." }),
    puzzles: z.array(
      z.object({
        size: z.int().min(1).max(100).openapi({ description: "The puzzle is size × size." }),
        level: LevelSchema,
        puzzleId: z.union([Id, z.null()]).openapi({
          description: "Null while the puzzle isn't ready. Open it with GET /api/puzzles/{id}.",
        }),
      }),
    ),
  })
  .openapi("DailySet", { description: "A day's daily puzzles, one per size class (PRD FR-22)." });

export const UserParamSchema = z.object({
  userId: Id.openapi({
    param: { name: "userId", in: "path" },
    description: "Must be the logged-in user's id; anything else is refused with 403.",
  }),
});

export const AttemptParamSchema = UserParamSchema.extend({
  puzzleId: Id.openapi({ param: { name: "puzzleId", in: "path" } }),
});

export const AttemptSchema = z
  .object({
    puzzleId: Id,
    day: Day,
    area: z.int().min(1).openapi({ description: "Width × height: the leaderboard bucket." }),
    level: LevelSchema,
    status: z.enum(["playing", "finished"]),
    startedAt: Timestamp,
    finishedAt: z.union([Timestamp, z.null()]),
    elapsedMs: Ms.openapi({
      description:
        "Time on the ranked clock: since the start while playing (measured by the server), the ranked time once finished.",
    }),
    assisted: z.boolean().openapi({ description: "A hint was shown during the attempt." }),
    ranked: z.boolean().openapi({
      description:
        "The finished solve counts on leaderboards: no hint, and not faster than the loop can be drawn. False while playing.",
    }),
    rank: z.union([z.int().min(1), z.null()]).openapi({
      description: "Place on this daily's leaderboard, for a ranked solve.",
    }),
  })
  .openapi("Attempt", { description: "A player's one ranked attempt at a daily puzzle." });

export const AttemptResultSchema = z
  .object({ attempt: z.union([AttemptSchema, z.null()]) })
  .openapi("AttemptResult", { description: "`attempt` is null when none was started." });

export const StartedAttemptSchema = z.object({ attempt: AttemptSchema }).openapi("StartedAttempt");

export const FinishAttemptRequestSchema = z
  .strictObject({
    edges: EdgesSchema,
    elapsedMs: Ms.openapi({
      description:
        "The player's own clock since the attempt started; it counts when it is at most a tenth of the server's time (3 to 15 s) under it.",
    }),
  })
  .openapi("FinishAttemptRequest");

export const DailySummarySchema = z
  .object({
    day: Day,
    streak: z.int().min(0).openapi({
      description: "Consecutive days, up to today, with a finished daily (PRD FR-24).",
    }),
    week: z
      .array(z.object({ day: Day, finished: z.boolean() }))
      .openapi({ description: "The last seven days, oldest first." }),
    attempts: z.array(AttemptSchema).openapi({ description: "Today's attempts." }),
    bests: z
      .array(z.object({ area: z.int(), level: LevelSchema, timeMs: Ms }))
      .openapi({ description: "Best ranked time per leaderboard bucket." }),
  })
  .openapi("DailySummary");

export const LeaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10).openapi({ example: 10 }),
});

export const PuzzleBoardParamSchema = z.object({
  puzzleId: Id.openapi({ param: { name: "puzzleId", in: "path" } }),
});

export const BucketBoardParamSchema = z.object({
  area: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .openapi({ param: { name: "area", in: "path" }, example: 49 }),
});

export const BucketBoardQuerySchema = LeaderboardQuerySchema.extend({
  level: z.enum(LEVELS).default("hard").openapi({ example: "hard" }),
});

const LeaderboardEntrySchema = z
  .object({
    rank: z.int().min(1),
    name: z.union([z.string(), z.null()]).openapi({
      description: "The player's display name; null for a player who hasn't chosen one.",
    }),
    timeMs: Ms,
    me: z.boolean().openapi({ description: "This row is the logged-in player's." }),
  })
  .openapi("LeaderboardEntry");

export const LeaderboardSchema = z
  .object({
    area: z.int(),
    level: LevelSchema,
    total: z.int().min(0).openapi({ description: "How many players are on the board." }),
    entries: z.array(LeaderboardEntrySchema).openapi({
      description:
        "The top `limit` rows, then the logged-in player's row and its neighbours, by rank.",
    }),
    me: z.union([LeaderboardEntrySchema, z.null()]),
  })
  .openapi("Leaderboard", {
    description: "Ranked solves by time, without hinted ones (PRD FR-23).",
  });

/**
 * ASCII letters and digits, and _ . -, with at least one letter or digit; 3 to 20 characters once
 * trimmed. ASCII only, so names that differ only in case, or look alike in another script, can't
 * pass for each other (DECISIONS, "Display names").
 */
const Name = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]{3,20}$/, "Use 3 to 20 of A–Z, 0–9, _ . or -.")
  .refine((name) => /[A-Za-z0-9]/.test(name), "Use at least one letter or digit.");

export const DisplayNameSchema = z
  .object({ displayName: z.union([z.string(), z.null()]) })
  .openapi("DisplayName", { description: "The name shown on leaderboards; null for none." });

export const SetDisplayNameRequestSchema = z
  .strictObject({ displayName: z.union([Name, z.null()]) })
  .openapi("SetDisplayNameRequest");
