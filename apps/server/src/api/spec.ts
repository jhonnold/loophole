// Composition root for the OpenAPI document: builds the app over in-memory adapters, only to read
// its route definitions. `scripts/gen-api.ts` writes the result to openapi.yaml.
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import {
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_SITE_KEY,
  TurnstileVerifier,
} from "../adapters/captcha/turnstile.ts";
import { systemClock } from "../adapters/clock.ts";
import { SqliteAccountTokenRepository } from "../adapters/db/account-token-repository.ts";
import { SqliteAttemptRepository } from "../adapters/db/attempt-repository.ts";
import { SqliteDailyRepository } from "../adapters/db/daily-repository.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteDisplayNameRepository } from "../adapters/db/display-name-repository.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqliteProgressRepository } from "../adapters/db/progress-repository.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { SqliteReportRepository } from "../adapters/db/report-repository.ts";
import { SqliteSessionRepository } from "../adapters/db/session-repository.ts";
import { SqliteSubmissionRepository } from "../adapters/db/submission-repository.ts";
import { SqliteUserRepository } from "../adapters/db/user-repository.ts";
import { MemoryMailer } from "../adapters/mail/memory-mailer.ts";
import { argon2idHasher } from "../adapters/password-hasher.ts";
import { randomToken } from "../adapters/random-token.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { AccountManager } from "../managers/account-manager.ts";
import { AttemptManager } from "../managers/attempt-manager.ts";
import { DailyManager } from "../managers/daily-manager.ts";
import { DisplayNameManager } from "../managers/display-name-manager.ts";
import { HealthManager } from "../managers/health-manager.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { LeaderboardManager } from "../managers/leaderboard-manager.ts";
import { ProgressManager } from "../managers/progress-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { ReportManager } from "../managers/report-manager.ts";
import { SessionManager } from "../managers/session-manager.ts";
import { SubmissionManager } from "../managers/submission-manager.ts";
import { createApp } from "./app.ts";

export function openApiDocument() {
  const db = openDatabase(":memory:");
  const users = new SqliteUserRepository(db);
  const sessions = new SessionManager({
    sessions: new SqliteSessionRepository(db),
    users,
    clock: systemClock,
    newToken: randomToken,
    ttlMs: 1,
  });
  const limiter = new MemoryRateLimiter(systemClock);
  const blobs = new MemoryBlobStore();
  const puzzles = new PuzzleManager({
    puzzles: new SqlitePuzzleRepository(db),
    blobs,
    clock: systemClock,
  });
  const jobQueue = new SqliteJobQueue(db);
  const jobs = new JobManager({
    jobs: jobQueue,
    clock: systemClock,
    newId: () => crypto.randomUUID(),
    maxQueued: 1,
  });
  const dailyRepo = new SqliteDailyRepository(db);
  const dailies = new DailyManager({
    dailies: dailyRepo,
    puzzles,
    clock: systemClock,
  });
  const attemptRepo = new SqliteAttemptRepository(db);
  const attempts = new AttemptManager({
    attempts: attemptRepo,
    dailies,
    puzzles,
    clock: systemClock,
  });
  const app = createApp({
    accounts: new AccountManager({
      users,
      tokens: new SqliteAccountTokenRepository(db),
      sessions,
      passwords: argon2idHasher,
      captcha: new TurnstileVerifier({ secretKey: TURNSTILE_TEST_SECRET_KEY }),
      mailer: new MemoryMailer(),
      limiter,
      clock: systemClock,
      newId: () => crypto.randomUUID(),
      newToken: randomToken,
      publicUrl: "http://localhost",
    }),
    sessions,
    limiter,
    trustProxy: false,
    turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
    puzzles,
    hints: new HintManager({ puzzles, attempts }),
    dailies,
    attempts,
    leaderboards: new LeaderboardManager({ attempts: attemptRepo, dailies, puzzles }),
    displayNames: new DisplayNameManager({
      names: new SqliteDisplayNameRepository(db),
      limiter,
      clock: systemClock,
    }),
    progress: new ProgressManager({
      progress: new SqliteProgressRepository(db),
      puzzles,
      clock: systemClock,
    }),
    jobs,
    submissions: new SubmissionManager({
      submissions: new SqliteSubmissionRepository(db),
      puzzles,
      jobs,
      limiter,
      clock: systemClock,
      newId: () => crypto.randomUUID(),
    }),
    reports: new ReportManager({
      reports: new SqliteReportRepository(db),
      puzzles,
      limiter,
      clock: systemClock,
    }),
    health: new HealthManager({
      jobs: jobQueue,
      dailies: dailyRepo,
      blobs,
      clock: systemClock,
      daysAhead: 1,
      versions: { app: "spec", runtime: "spec" },
      checkTimeoutMs: 1,
    }),
  });
  const doc = app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Loophole API",
      version: "0.1.0",
      description:
        "Puzzles, background jobs, accounts, saved progress, submitted puzzles and reports, daily puzzles, ranked attempts, leaderboards and health checks. Errors are RFC 9457 problem details. State-changing requests from other sites are refused (403).",
    },
  });
  db.close();
  return doc;
}
