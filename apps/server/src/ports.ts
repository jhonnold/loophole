import type {
  AccountTokenPurpose,
  AccountTokenRecord,
  Job,
  JobInput,
  JobResult,
  PuzzleRecord,
  SessionRecord,
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
