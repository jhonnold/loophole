import type { Puzzle } from "@loophole/core";
import type {
  AccountTokenPurpose,
  AccountTokenRecord,
  AttemptRecord,
  DailyRecord,
  Job,
  JobInput,
  JobKind,
  JobResult,
  LeaderboardSlice,
  ProgressRecord,
  PuzzleRecord,
  PuzzleStatus,
  ReportRecord,
  SessionRecord,
  SubmissionRecord,
  SubmissionStatus,
  SubmissionVerdict,
  Task,
  TaskOutcome,
  UserRecord,
} from "./domain.ts";

/**
 * The interfaces managers depend on. Adapters implement them; the composition roots
 * (`api/main.ts`, `worker/main.ts`) pick the implementations.
 */

export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
}

export interface PuzzleRepository {
  /** Stores a new puzzle. Does nothing when a puzzle with this id already exists. */
  insert(record: PuzzleRecord): void;
  get(id: string): PuzzleRecord | null;
  /** Published puzzles, newest first. */
  listPublished(limit: number): PuzzleRecord[];
  /** A stored puzzle, published or not, with the same size and clues as `puzzle`; null if none. */
  findByClues(puzzle: Puzzle): PuzzleRecord | null;
  /** Returns false when there is no puzzle with this id. */
  setStatus(id: string, status: PuzzleStatus): boolean;
}

/** Text blobs by key, such as solutions and solver traces. */
export interface BlobStore {
  put(key: string, body: string, contentType: string): Promise<void>;
  /** Resolves to null when there is no blob under `key`. */
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

export interface NewJob {
  readonly id: string;
  readonly job: JobInput;
  readonly createdAt: number;
}

/**
 * The jobs table. Updates to a running job name the worker that claimed it and do nothing when
 * another worker holds the job or it is no longer running.
 */
export interface JobQueue {
  enqueue(job: NewJob): Job;
  get(id: string): Job | null;
  countQueued(): number;
  /** Jobs waiting and running now, and when the oldest waiting one was queued (null if none). */
  countActive(): { queued: number; running: number; oldestQueuedAt: number | null };
  /** The most recently ended jobs that failed or timed out, newest first. */
  listFailed(limit: number): Job[];
  /** Atomically takes the oldest queued job for `workerId`, or returns null when there is none. */
  claimNext(workerId: string, now: number): Job | null;
  /** Stores progress (0 to 1); also counts as a heartbeat. */
  setProgress(id: string, workerId: string, progress: number, now: number): void;
  heartbeat(id: string, workerId: string, now: number): void;
  /** Ends a running job. Returns false when the worker no longer holds it. */
  finish(id: string, workerId: string, end: JobEnd, now: number): boolean;
  /**
   * Running jobs whose last heartbeat is before `staleBefore` go back to the queue, or fail once
   * they have been claimed `maxAttempts` times. Returns how many jobs it changed.
   */
  recoverStale(staleBefore: number, maxAttempts: number, now: number): number;
}

export type JobEnd =
  | { readonly status: "done"; readonly result: JobResult }
  | { readonly status: "failed" | "timeout"; readonly error: string };

export interface TaskRunOptions {
  /** The task is stopped and reported as `timeout` after this long. */
  readonly timeoutMs: number;
  /** Called with progress from 0 to 1, at most about once per percent. */
  readonly onProgress: (progress: number) => void;
}

/** Runs CPU-heavy tasks (generation, verification) off the caller's thread. */
export interface TaskRunner {
  run(task: Task, options: TaskRunOptions): Promise<TaskOutcome>;
}

export interface UserRepository {
  /** Stores a new user. Returns false, storing nothing, when the email is already taken. */
  insert(user: UserRecord): boolean;
  get(id: string): UserRecord | null;
  /** `email` must already be normalized (trimmed, lower-cased). */
  getByEmail(email: string): UserRecord | null;
  setPasswordHash(id: string, passwordHash: string): void;
  /** Marks the email verified at `at`, unless it already is. */
  markEmailVerified(id: string, at: number): void;
  /** Returns false when no user has this email. */
  setAdmin(email: string, isAdmin: boolean): boolean;
  /** Deletes the user and, through ON DELETE CASCADE, every row that belongs to them. */
  delete(id: string): void;
}

export interface SessionRepository {
  insert(session: SessionRecord): void;
  get(tokenHash: string): SessionRecord | null;
  delete(tokenHash: string): void;
  deleteForUser(userId: string): void;
  /** Removes sessions that expired at or before `now`. */
  deleteExpired(now: number): void;
}

export interface AccountTokenRepository {
  /** Stores `token` and drops the user's other tokens for the same purpose. */
  replace(token: AccountTokenRecord): void;
  /** Removes and returns the token with this hash and purpose, expired or not; null if none. */
  take(tokenHash: string, purpose: AccountTokenPurpose): AccountTokenRecord | null;
  /** Removes tokens that expired at or before `now`. */
  deleteExpired(now: number): void;
}

/** Password hashing (argon2id in production). */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

/** Server-side check of a CAPTCHA token from the sign-up form (Cloudflare Turnstile). */
export interface CaptchaVerifier {
  /** False when the token is invalid, expired, already used, or the check could not be made. */
  verify(token: string, remoteIp: string | null): Promise<boolean>;
}

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  /** Plain text body. */
  readonly text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** At most `limit` hits per `windowMs`. */
export interface RateRule {
  readonly limit: number;
  readonly windowMs: number;
}

export type RateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterMs: number };

/** Counts attempts per key, for the limits on the auth endpoints (NFR-4). */
export interface RateLimiter {
  /** Counts one hit under `key` and says whether it is within `rule`. */
  hit(key: string, rule: RateRule): RateDecision;
}

/** Saved progress, one record per user and puzzle (PRD FR-21). */
export interface ProgressRepository {
  get(userId: string, puzzleId: string): ProgressRecord | null;
  /** Stores `record`, replacing any record for the same user and puzzle. */
  put(record: ProgressRecord): void;
  delete(userId: string, puzzleId: string): void;
  /** The user's unsolved records, most recently updated first. */
  listUnsolved(userId: string, limit: number): ProgressRecord[];
}

/** How a pending submission ended. */
export interface SubmissionDecision {
  readonly status: Exclude<SubmissionStatus, "pending">;
  readonly verdict: SubmissionVerdict;
  readonly puzzleId: string | null;
  readonly decidedAt: number;
}

export interface SubmissionRepository {
  insert(record: SubmissionRecord): void;
  get(id: string): SubmissionRecord | null;
  /** The user's submissions, newest first. */
  listForUser(userId: string, limit: number): SubmissionRecord[];
  /** Records the decision on a pending submission. Returns false when it was not pending. */
  decide(id: string, decision: SubmissionDecision): boolean;
  /** How many decided submissions have each verdict (PRD §10: the share rejected as unknown). */
  countByVerdict(): Partial<Record<SubmissionVerdict, number>>;
}

export interface ReportRepository {
  /** Stores a report, replacing the reporter's earlier report of the same puzzle. */
  upsert(report: ReportRecord): void;
  /** Reports of puzzles that are still published, newest first. */
  listForPublished(limit: number): ReportRecord[];
  deleteForPuzzle(puzzleId: string): void;
}

/** Daily puzzles, one row per UTC day and size class (PRD FR-22). */
export interface DailyRepository {
  get(day: string, size: number): DailyRecord | null;
  getByPuzzle(puzzleId: string): DailyRecord | null;
  /** The day's rows, smallest size first. */
  listDay(day: string): DailyRecord[];
  /** Stores a new row. Returns false, storing nothing, when the day and size already have one. */
  insert(record: DailyRecord): boolean;
  /**
   * Moves a row from attempt `fromAttempt` to the next attempt with a new job. Returns false when
   * the row is no longer at `fromAttempt` (another worker moved it first).
   */
  retry(day: string, size: number, fromAttempt: number, jobId: string): boolean;
  /**
   * Links the stored puzzle to the row whose job is `jobId`. Returns false when the row has moved
   * on to another job.
   */
  setPuzzle(
    day: string,
    size: number,
    jobId: string,
    puzzleId: string,
    generatorVersion: string | null,
  ): boolean;
  /**
   * Runs `fn` in one transaction of the database the jobs table is in, so claiming a row and
   * queueing its job happen together or not at all.
   */
  atomically<T>(fn: () => T): T;
}

/** Ranked attempts at daily puzzles, and the leaderboards built from them (PRD FR-23, FR-24). */
export interface AttemptRepository {
  get(userId: string, puzzleId: string): AttemptRecord | null;
  /** Stores a new attempt. Does nothing when the user already has one at this puzzle. */
  insert(record: AttemptRecord): void;
  /** Marks the attempt assisted unless it is finished. */
  markAssisted(userId: string, puzzleId: string): void;
  /**
   * Finishes an attempt that is still being played. Returns false when there is none (missing or
   * already finished).
   */
  finish(
    userId: string,
    puzzleId: string,
    result: { finishedAt: number; timeMs: number; ranked: boolean },
  ): boolean;
  /** The user's attempts on daily puzzles of `day`. */
  listForDay(userId: string, day: string): AttemptRecord[];
  /** Every day on which the user finished an attempt, ranked or not; any order. */
  finishedDays(userId: string): string[];
  /** The user's best ranked time in each bucket. */
  bests(userId: string): { area: number; level: number; timeMs: number }[];
  /** Ranked solves of one puzzle, fastest first: the top `limit` and `viewerId`'s neighbourhood. */
  puzzleBoard(puzzleId: string, viewerId: string | null, limit: number): LeaderboardSlice;
  /**
   * Each player's best ranked time in one bucket, fastest first: the top `limit` and `viewerId`'s
   * neighbourhood.
   */
  bucketBoard(
    area: number,
    level: number,
    viewerId: string | null,
    limit: number,
  ): LeaderboardSlice;
}

/** Names players chose to show on leaderboards. */
export interface DisplayNameRepository {
  get(userId: string): string | null;
  /**
   * Sets the user's name, or removes it when `name` is null. Returns false, changing nothing, when
   * another player has the same name (ignoring ASCII case).
   */
  set(userId: string, name: string | null, now: number): boolean;
}

/**
 * Seeds for daily puzzles: the same for the same day, size and attempt, and unguessable without
 * the server's secret (DECISIONS, "Daily puzzles").
 */
export interface DailySeeder {
  seed(day: string, size: number, attempt: number): string;
}

/** Why an authentication step was refused, for the auth failure count. */
export type AuthFailure = "login" | "captcha" | "link" | "csrf";

/** What the HTTP API counts for monitoring (Prometheus in production, DECISIONS "Metrics"). */
export interface ApiMetrics {
  /** One answered request. `route` is the route's template (`/api/puzzles/:id`), never the raw path. */
  request(method: string, route: string, status: number, seconds: number): void;
  authFailure(reason: AuthFailure): void;
}

/** What the worker counts for monitoring. */
export interface WorkerMetrics {
  /** A job ended after running for `seconds`. */
  jobFinished(kind: JobKind, status: JobEnd["status"], seconds: number): void;
  /** A daily puzzle's generation failed, timed out or was lost; the next check retries it. */
  dailyFailure(size: number): void;
}
