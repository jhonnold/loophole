// Composition root of the HTTP API process: reads the settings, builds the adapters and managers,
// and serves the app.
import { S3BlobStore } from "../adapters/blob/s3-blob-store.ts";
import { TURNSTILE_TEST_SECRET_KEY, TurnstileVerifier } from "../adapters/captcha/turnstile.ts";
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
import { installJsonLogging } from "../adapters/logging.ts";
import { BackgroundMailer } from "../adapters/mail/background-mailer.ts";
import { SmtpMailer } from "../adapters/mail/smtp-mailer.ts";
import {
  createRegistry,
  PrometheusApiMetrics,
  serveMetrics,
} from "../adapters/metrics/prometheus.ts";
import { argon2idHasher } from "../adapters/password-hasher.ts";
import { randomToken } from "../adapters/random-token.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { loadConfig } from "../config.ts";
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
import { requestContext } from "../request-context.ts";
import { createApp } from "./app.ts";

installJsonLogging({ process: "api", context: () => requestContext.getStore() });
const config = loadConfig(process.env);
const db = openDatabase(config.databasePath);
// loadConfig refuses the test secret unless PUBLIC_URL is on localhost.
const testCaptcha = config.turnstile.secretKey === TURNSTILE_TEST_SECRET_KEY;
const registry = createRegistry(config.version);
const metrics = new PrometheusApiMetrics(registry);

const blobs = new S3BlobStore(config.s3);
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
  maxQueued: config.maxQueuedJobs,
});
const users = new SqliteUserRepository(db);
const sessions = new SessionManager({
  sessions: new SqliteSessionRepository(db),
  users,
  clock: systemClock,
  newToken: randomToken,
  ttlMs: config.sessionTtlMs,
});
const limiter = new MemoryRateLimiter(systemClock, () => metrics.rateLimitEviction());
const accounts = new AccountManager({
  users,
  tokens: new SqliteAccountTokenRepository(db),
  sessions,
  passwords: argon2idHasher,
  captcha: new TurnstileVerifier({
    secretKey: config.turnstile.secretKey,
    // The test secret answers for "example.com", so the hostname check is for real keys only.
    expectedHostname: testCaptcha ? undefined : new URL(config.publicUrl).hostname,
  }),
  // Mail goes out after the answer, so its timing and errors don't show who has an account.
  mailer: new BackgroundMailer(new SmtpMailer(config.smtp), () => metrics.mailFailure()),
  limiter,
  clock: systemClock,
  newId: () => crypto.randomUUID(),
  newToken: randomToken,
  publicUrl: config.publicUrl,
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
const leaderboards = new LeaderboardManager({ attempts: attemptRepo, dailies, puzzles });
const displayNames = new DisplayNameManager({
  names: new SqliteDisplayNameRepository(db),
  limiter,
  clock: systemClock,
});
const hints = new HintManager({ puzzles, attempts });
const progress = new ProgressManager({
  progress: new SqliteProgressRepository(db),
  puzzles,
  clock: systemClock,
});
const submissions = new SubmissionManager({
  submissions: new SqliteSubmissionRepository(db),
  puzzles,
  jobs,
  limiter,
  clock: systemClock,
  newId: () => crypto.randomUUID(),
});
const reports = new ReportManager({
  reports: new SqliteReportRepository(db),
  puzzles,
  limiter,
  clock: systemClock,
});
const health = new HealthManager({
  jobs: jobQueue,
  dailies: dailyRepo,
  blobs,
  clock: systemClock,
  daysAhead: config.dailies.daysAhead,
  versions: { app: config.version, runtime: `bun ${Bun.version}` },
  checkTimeoutMs: 2_000,
});
const app = createApp({
  puzzles,
  jobs,
  hints,
  progress,
  submissions,
  reports,
  dailies,
  attempts,
  leaderboards,
  displayNames,
  accounts,
  sessions,
  limiter,
  trustProxy: config.trustProxy,
  turnstileSiteKey: config.turnstile.siteKey,
  webDir: config.webDir,
  health,
  metrics,
  accessLog: true,
});
if (testCaptcha) {
  console.warn(
    "Using Turnstile's test keys: the sign-up CAPTCHA always passes. Not for production.",
  );
}

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  // Outer cap; the app itself refuses API bodies over 64 KiB.
  maxRequestBodySize: 1024 * 1024,
  fetch: app.fetch,
});
console.log(`API listening on ${server.url}`);
if (config.metrics.apiPort !== 0) {
  const metricsServer = serveMetrics(registry, config.metrics.host, config.metrics.apiPort);
  console.log(`API metrics on ${metricsServer.url}metrics`);
}
