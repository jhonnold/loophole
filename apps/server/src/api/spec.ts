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
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { SqliteSessionRepository } from "../adapters/db/session-repository.ts";
import { SqliteUserRepository } from "../adapters/db/user-repository.ts";
import { MemoryMailer } from "../adapters/mail/memory-mailer.ts";
import { argon2idHasher } from "../adapters/password-hasher.ts";
import { randomToken } from "../adapters/random-token.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { AccountManager } from "../managers/account-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { SessionManager } from "../managers/session-manager.ts";
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
    puzzles: new PuzzleManager({
      puzzles: new SqlitePuzzleRepository(db),
      blobs: new MemoryBlobStore(),
      clock: systemClock,
    }),
    jobs: new JobManager({
      jobs: new SqliteJobQueue(db),
      clock: systemClock,
      newId: () => crypto.randomUUID(),
      maxQueued: 1,
    }),
  });
  const doc = app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Loophole API",
      version: "0.1.0",
      description:
        "Puzzles, background jobs and accounts. Errors are RFC 9457 problem details. State-changing requests from other sites are refused (403).",
    },
  });
  db.close();
  return doc;
}
