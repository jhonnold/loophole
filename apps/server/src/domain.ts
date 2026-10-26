import type { Level, Puzzle, PuzzleWireV1, Step, VerifyStatus } from "@loophole/core";

/** Where a stored puzzle came from. */
export type PuzzleOrigin = "generated" | "submitted";

/** Only published puzzles are served to players. */
export type PuzzleStatus = "published" | "unpublished";

/** A stored puzzle. The solution and the solver trace live in the blob store, not here. */
export interface PuzzleRecord {
  readonly id: string;
  /**
   * Clues, seed, `meta.generator` (the generator version) and, below the default level,
   * `meta.level`, as the core models them. `meta.level` always matches `level`, so hints use the
   * puzzle's level (core's `findHint`).
   */
  readonly puzzle: Puzzle;
  readonly origin: PuzzleOrigin;
  readonly status: PuzzleStatus;
  /**
   * The level a generated puzzle was made at (PRD FR-7), as the generator reported it. Submitted
   * puzzles and those from before levels are hard (core's `DEFAULT_LEVEL`).
   */
  readonly level: Level;
  /** Blob key of the solution, in the wire format's edge-state encoding. */
  readonly solutionKey: string;
  /** Blob key of the solver's step log (JSON), when there is one. */
  readonly traceKey: string | null;
  /** Milliseconds since the epoch. */
  readonly createdAt: number;
  /** The player who submitted it; null for generated puzzles and once the account is deleted. */
  readonly creatorId: string | null;
  /**
   * Players can't see the puzzle before this time (ms). Set only for daily puzzles: 00:00 UTC on
   * their day. Null for every other puzzle.
   */
  readonly releaseAt: number | null;
}

export type JobKind = "generate" | "verify";

export type JobStatus = "queued" | "running" | "done" | "failed" | "timeout";

/**
 * The order workers claim queued jobs in, lowest first and oldest first within one (DECISIONS,
 * WT21 "Worker fairness"): a player's generation, which can take many minutes at 100×100, never
 * holds up a submission's check or a daily puzzle that is waiting.
 */
export const JOB_PRIORITY = { verify: 0, daily: 1, player: 2 } as const;

export interface GenerateInput {
  readonly width: number;
  readonly height: number;
  readonly seed: string;
  /** Set when the puzzle is a daily puzzle: its UTC day, `YYYY-MM-DD` (PRD FR-22). */
  readonly day?: string;
  /** The level to generate at (PRD FR-7). Left out in jobs queued before levels: hard. */
  readonly level?: Level;
}

export interface VerifyInput {
  readonly puzzle: PuzzleWireV1;
  /** Set when the check is for a player's submission, which the worker then decides. */
  readonly submissionId?: string;
}

/** What a finished job produced. */
export type JobResult =
  | { readonly kind: "generate"; readonly puzzleId: string }
  | { readonly kind: "verify"; readonly status: VerifyStatus };

interface JobBase {
  readonly id: string;
  readonly status: JobStatus;
  /** From 0 to 1. */
  readonly progress: number;
  readonly result: JobResult | null;
  readonly error: string | null;
  /** Times the job has been claimed by a worker, not counting claims given back at shutdown. */
  readonly attempts: number;
  /** Claim order (`JOB_PRIORITY`): lower first. */
  readonly priority: number;
  /**
   * Who queued a player's generation (`user:<id>`, or `ip:<address>` for a guest), for the cap per
   * requester; null for other jobs, and once the job has ended.
   */
  readonly requester: string | null;
  readonly claimedBy: string | null;
  /** Milliseconds since the epoch, like every time below. */
  readonly createdAt: number;
  readonly startedAt: number | null;
  readonly heartbeatAt: number | null;
  readonly finishedAt: number | null;
}

export type Job =
  | (JobBase & { readonly kind: "generate"; readonly input: GenerateInput })
  | (JobBase & { readonly kind: "verify"; readonly input: VerifyInput });

/** The input of a new job. */
export type JobInput =
  | { readonly kind: "generate"; readonly input: GenerateInput }
  | { readonly kind: "verify"; readonly input: VerifyInput };

/** Work run off the main thread, with a hard time limit. */
export type Task = JobInput;

export interface GeneratedPuzzle {
  /** Has `seed` and `meta.generator`. */
  readonly puzzle: PuzzleWireV1;
  /** The only solution, in edge-state encoding. */
  readonly solution: string;
  /** The solver's steps from an empty board, for hints. */
  readonly steps: readonly Step[];
}

export interface VerifyOutcome {
  readonly status: VerifyStatus;
  /** Solutions found, in edge-state encoding. */
  readonly solutions: readonly string[];
  /** For a `unique` puzzle, the rule solver's steps from an empty board (for hints); else empty. */
  readonly steps: readonly Step[];
}

export type TaskOutput =
  | { readonly kind: "generate"; readonly generated: GeneratedPuzzle }
  | { readonly kind: "verify"; readonly verified: VerifyOutcome };

/**
 * How a task ended. `timeout` means the thread was stopped at the time limit, `cancelled` that it
 * was stopped because the worker is shutting down.
 */
export type TaskOutcome =
  | { readonly status: "done"; readonly output: TaskOutput }
  | { readonly status: "failed"; readonly error: string }
  | { readonly status: "timeout" }
  | { readonly status: "cancelled" };

/** A registered player (PRD §5). Holds only what NFR-6 allows: the email and the password hash. */
export interface UserRecord {
  readonly id: string;
  /** Trimmed and lower-cased; unique. */
  readonly email: string;
  /** argon2id, in PHC string format. */
  readonly passwordHash: string;
  /** When the email was confirmed, or null while it is unverified. */
  readonly emailVerifiedAt: number | null;
  /** Set only by the admin script (`bun run admin`), for unpublishing and system health. */
  readonly isAdmin: boolean;
  readonly createdAt: number;
}

/** A login session. The cookie holds the token; only its hash is stored. */
export interface SessionRecord {
  readonly tokenHash: string;
  readonly userId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export type AccountTokenPurpose = "verify-email" | "reset-password";

/** A single-use token mailed to a user. Only its hash is stored. */
export interface AccountTokenRecord {
  readonly tokenHash: string;
  readonly userId: string;
  readonly purpose: AccountTokenPurpose;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** A player's saved board on one puzzle (PRD FR-21). */
export interface ProgressRecord {
  readonly userId: string;
  readonly puzzleId: string;
  /** Edge states in the wire format's encoding, one character per edge. */
  readonly edges: string;
  /** Play time on this attempt, as the player's clock counted it. */
  readonly elapsedMs: number;
  /** Worked out on the server from `edges`, never taken from the client. */
  readonly solved: boolean;
  /** A hint was shown during this attempt, on any device (PRD FR-12). */
  readonly assisted: boolean;
  /** Starts at the clock's time when the attempt is first saved, then goes up by one with every save that replaces the board. */
  readonly version: number;
  /** Random id of the browser that saved this board, so it never conflicts with itself. */
  readonly device: string;
  /** When this attempt was first saved. */
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type SubmissionStatus = "pending" | "published" | "rejected";

/**
 * Why a submission was published or rejected (PRD FR-27):
 * - `unique`: verified to have one solution, and published.
 * - `duplicate`: a puzzle with the same clues is already published; the submission points at it.
 * - `none`, `multiple`, `unknown`: the verifier's answer (`unknown`: out of time).
 * - `removed`: a puzzle with the same clues was unpublished by an admin.
 * - `error`: the check failed for another reason.
 */
export type SubmissionVerdict =
  | "unique"
  | "duplicate"
  | "none"
  | "multiple"
  | "unknown"
  | "removed"
  | "error";

/** A player's submitted puzzle and what became of it. */
export interface SubmissionRecord {
  readonly id: string;
  readonly userId: string;
  /** Clues only: no seed or metadata. */
  readonly puzzle: Puzzle;
  readonly status: SubmissionStatus;
  /** Null while pending. */
  readonly verdict: SubmissionVerdict | null;
  /** The published puzzle: this submission's own, or an earlier one with the same clues. */
  readonly puzzleId: string | null;
  /** The verification job, or null when none was needed. */
  readonly jobId: string | null;
  readonly createdAt: number;
  readonly decidedAt: number | null;
}

/** A player's report of a published puzzle (PRD FR-28). */
export interface ReportRecord {
  readonly puzzleId: string;
  readonly reporterId: string;
  readonly reason: string;
  readonly createdAt: number;
}

/** A reported puzzle, for the admins' list. */
export interface ReportedPuzzle {
  readonly puzzle: PuzzleRecord;
  /** How many players reported it. */
  readonly count: number;
  /** The newest reports first, at most a few. */
  readonly reports: readonly ReportRecord[];
}

/** The daily puzzle of one size class on one UTC day, the same for everyone (PRD FR-22). */
export interface DailyRecord {
  /** The UTC day, `YYYY-MM-DD`. */
  readonly day: string;
  /** The size class: the puzzle is `size` × `size`. */
  readonly size: number;
  /** Goes up by one each time generation fails; the seed is derived from day, size and this. */
  readonly attempt: number;
  /** The generation job for the current attempt. */
  readonly jobId: string;
  /** Null until the worker has stored the puzzle. */
  readonly puzzleId: string | null;
  /** The generator version that made the puzzle, so it can be regenerated (FR-10). */
  readonly generatorVersion: string | null;
  readonly createdAt: number;
}

/**
 * A player's one ranked attempt at a daily puzzle (PRD FR-17, FR-23, FR-25). The clock runs from
 * `startedAt` and never stops; the server checks the solution and the time.
 */
export interface AttemptRecord {
  readonly userId: string;
  readonly puzzleId: string;
  /** The daily's UTC day. */
  readonly day: string;
  /** Leaderboard bucket: width × height, and the puzzle's level (PRD FR-23). */
  readonly area: number;
  readonly level: Level;
  readonly startedAt: number;
  /** Null while the attempt is being played. */
  readonly finishedAt: number | null;
  /** The ranked time; null while playing. */
  readonly timeMs: number | null;
  /** A hint was shown during the attempt (PRD FR-12). */
  readonly assisted: boolean;
  /** Set when finished: the solve counts on leaderboards (no hint, a plausible time). */
  readonly ranked: boolean;
}

/** One row of a leaderboard. */
export interface LeaderboardEntry {
  /** 1 for the fastest. Ties go to whoever finished first. */
  readonly rank: number;
  readonly userId: string;
  /** The player's chosen display name, or null when they haven't picked one. */
  readonly name: string | null;
  readonly timeMs: number;
}

/** A slice of a leaderboard: the top rows, and the viewer's row with its neighbours. */
export interface LeaderboardSlice {
  /** How many players are on the board. */
  readonly total: number;
  /** The top `limit` rows, then the viewer's row and the rows either side of it; by rank. */
  readonly entries: readonly LeaderboardEntry[];
}
