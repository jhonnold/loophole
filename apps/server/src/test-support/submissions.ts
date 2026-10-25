import type { Database } from "bun:sqlite";
import { SqliteReportRepository } from "../adapters/db/report-repository.ts";
import { SqliteSubmissionRepository } from "../adapters/db/submission-repository.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import type { JobManager } from "../managers/job-manager.ts";
import type { PuzzleManager } from "../managers/puzzle-manager.ts";
import { ReportManager } from "../managers/report-manager.ts";
import { SubmissionManager } from "../managers/submission-manager.ts";
import type { Clock } from "../ports.ts";
import { sequentialIds } from "./fakes.ts";

/**
 * The submission and report side of the API for route tests: SQLite repositories on `db` and a
 * rate limiter of their own. Spread the result into `createApp`'s deps.
 */
export function submissionDeps(
  db: Database,
  clock: Clock,
  puzzles: PuzzleManager,
  jobs: JobManager,
) {
  const limiter = new MemoryRateLimiter(clock);
  const submissions = new SubmissionManager({
    submissions: new SqliteSubmissionRepository(db),
    puzzles,
    jobs,
    limiter,
    clock,
    newId: sequentialIds("s"),
  });
  const reports = new ReportManager({
    reports: new SqliteReportRepository(db),
    puzzles,
    limiter,
    clock,
  });
  return { submissions, reports };
}
