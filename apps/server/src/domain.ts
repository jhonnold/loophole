import type { Puzzle, PuzzleWireV1, Step, VerifyStatus } from "@loophole/core";

/** Where a stored puzzle came from. */
export type PuzzleOrigin = "generated" | "submitted";

/** Only published puzzles are served to players. */
export type PuzzleStatus = "published" | "unpublished";

/** A stored puzzle. The solution and the solver trace live in the blob store, not here. */
export interface PuzzleRecord {
  readonly id: string;
  /** Clues, seed and `meta.generator` (the generator version), as the core models them. */
  readonly puzzle: Puzzle;
  readonly origin: PuzzleOrigin;
  readonly status: PuzzleStatus;
  /** Difficulty level. Every puzzle is level 1 until levels exist (PRD FR-29). */
  readonly level: number;
  /** Blob key of the solution, in the wire format's edge-state encoding. */
  readonly solutionKey: string;
  /** Blob key of the solver's step log (JSON), when there is one. */
  readonly traceKey: string | null;
  /** Milliseconds since the epoch. */
  readonly createdAt: number;
}

export type JobKind = "generate" | "verify";

export type JobStatus = "queued" | "running" | "done" | "failed" | "timeout";

export interface GenerateInput {
  readonly width: number;
  readonly height: number;
  readonly seed: string;
}

export interface VerifyInput {
  readonly puzzle: PuzzleWireV1;
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
  /** Times the job has been claimed by a worker. */
  readonly attempts: number;
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
}

export type TaskOutput =
  | { readonly kind: "generate"; readonly generated: GeneratedPuzzle }
  | { readonly kind: "verify"; readonly verified: VerifyOutcome };

/** How a task ended. `timeout` means the thread was stopped at the time limit. */
export type TaskOutcome =
  | { readonly status: "done"; readonly output: TaskOutput }
  | { readonly status: "failed"; readonly error: string }
  | { readonly status: "timeout" };

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
  /** Starts at 1 and goes up with every save that replaces the board. */
  readonly version: number;
  /** Random id of the browser that saved this board, so it never conflicts with itself. */
  readonly device: string;
  /** When this attempt was first saved. */
  readonly createdAt: number;
  readonly updatedAt: number;
}
