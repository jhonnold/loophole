import { type Puzzle, serializePuzzle } from "@loophole/core";
import type { PuzzleRecord, SubmissionRecord, VerifyOutcome } from "../domain.ts";
import type {
  Clock,
  RateLimiter,
  RateRule,
  SubmissionDecision,
  SubmissionRepository,
} from "../ports.ts";
import { RateLimitedError } from "./errors.ts";
import type { JobManager } from "./job-manager.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";

/** Submissions one account may make (DECISIONS, "Submission limits"). */
export const SUBMISSIONS_PER_ACCOUNT: RateRule = { limit: 20, windowMs: 60 * 60 * 1000 };

export interface SubmissionManagerDeps {
  readonly submissions: SubmissionRepository;
  readonly puzzles: PuzzleManager;
  readonly jobs: JobManager;
  readonly limiter: RateLimiter;
  readonly clock: Clock;
  readonly newId: () => string;
}

/**
 * Players' puzzles (PRD FR-27): a submission is queued for the verifier, and the worker publishes
 * it when it has exactly one solution or rejects it with the verdict. A clue grid that is already
 * stored is decided at once, without a job.
 */
export class SubmissionManager {
  readonly #deps: SubmissionManagerDeps;

  constructor(deps: SubmissionManagerDeps) {
    this.#deps = deps;
  }

  /**
   * Submits `puzzle` (clues only) for `userId`. Throws `RateLimitedError` past the account's limit
   * and `QueueFullError` when the job queue is full.
   */
  submit(userId: string, puzzle: Puzzle): SubmissionRecord {
    const { submissions, puzzles, jobs, limiter, clock, newId } = this.#deps;
    const decision = limiter.hit(`submit:${userId}`, SUBMISSIONS_PER_ACCOUNT);
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterMs);
    const id = newId();
    const now = clock.now();
    const base = { id, userId, puzzle, createdAt: now };
    const existing = puzzles.findByClues(puzzle);
    let record: SubmissionRecord;
    if (existing !== null) {
      record = { ...base, ...sameClues(existing, now), jobId: null };
    } else {
      const job = jobs.enqueueVerify(serializePuzzle(puzzle), id);
      record = {
        ...base,
        status: "pending",
        verdict: null,
        puzzleId: null,
        jobId: job.id,
        decidedAt: null,
      };
    }
    submissions.insert(record);
    return record;
  }

  /** The user's own submission, or null when there is none with this id or it is someone else's. */
  get(id: string, userId: string): SubmissionRecord | null {
    const record = this.#deps.submissions.get(id);
    return record === null || record.userId !== userId ? null : this.#settle(record);
  }

  /** The user's submissions, newest first. */
  listMine(userId: string, limit: number): SubmissionRecord[] {
    return this.#deps.submissions.listForUser(userId, limit).map((r) => this.#settle(r));
  }

  /**
   * Decides a pending submission from its verification (called by the worker). A `unique` puzzle
   * is published under the submission's id, unless the same clues were stored meanwhile. Does
   * nothing when the submission is gone (the account was deleted) or already decided.
   */
  async complete(id: string, outcome: VerifyOutcome): Promise<void> {
    const { submissions, puzzles, clock } = this.#deps;
    const record = submissions.get(id);
    if (record === null || record.status !== "pending") return;
    if (outcome.status !== "unique") {
      submissions.decide(id, {
        status: "rejected",
        verdict: outcome.status,
        puzzleId: null,
        decidedAt: clock.now(),
      });
      return;
    }
    const existing = puzzles.findByClues(record.puzzle);
    if (existing !== null && existing.id !== id) {
      submissions.decide(id, sameClues(existing, clock.now()));
      return;
    }
    await puzzles.saveSubmitted(
      id,
      record.puzzle,
      outcome.solutions[0],
      outcome.steps,
      record.userId,
    );
    submissions.decide(id, {
      status: "published",
      verdict: "unique",
      puzzleId: id,
      decidedAt: clock.now(),
    });
  }

  /**
   * A pending submission whose job ended without deciding it is rejected here, when it is next
   * read: `unknown` when the job timed out, `error` when it failed, was abandoned by crashed
   * workers, or finished without finding the submission (a worker that claimed the job in the
   * moment before `submit` stored the row). `complete` always decides before the job is marked
   * done, so a done job with a pending submission never decides it later.
   */
  #settle(record: SubmissionRecord): SubmissionRecord {
    const { submissions, jobs, clock } = this.#deps;
    if (record.status !== "pending" || record.jobId === null) return record;
    const job = jobs.get(record.jobId);
    if (job === null || job.status === "queued" || job.status === "running") return record;
    const decision: SubmissionDecision = {
      status: "rejected",
      verdict: job.status === "timeout" ? "unknown" : "error",
      puzzleId: null,
      decidedAt: clock.now(),
    };
    submissions.decide(record.id, decision);
    return submissions.get(record.id) ?? record;
  }
}

/** The decision for a submission whose clues match the stored puzzle `existing`. */
function sameClues(existing: PuzzleRecord, now: number): SubmissionDecision {
  return existing.status === "published"
    ? { status: "published", verdict: "duplicate", puzzleId: existing.id, decidedAt: now }
    : { status: "rejected", verdict: "removed", puzzleId: null, decidedAt: now };
}
