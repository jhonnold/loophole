import type { Database } from "bun:sqlite";
import { SqliteAccountTokenRepository } from "../adapters/db/account-token-repository.ts";
import { SqliteSessionRepository } from "../adapters/db/session-repository.ts";
import { SqliteUserRepository } from "../adapters/db/user-repository.ts";
import { MemoryMailer } from "../adapters/mail/memory-mailer.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { AccountManager } from "../managers/account-manager.ts";
import { SessionManager } from "../managers/session-manager.ts";
import type { Clock } from "../ports.ts";
import { FakeCaptcha, fakePasswordHasher, sequentialIds } from "./fakes.ts";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The account side of the API for route tests: SQLite repositories on `db`, fake password hashing
 * and CAPTCHA, mail kept in memory. Spread the result into `createApp`'s deps.
 */
export function accountDeps(db: Database, clock: Clock) {
  const users = new SqliteUserRepository(db);
  const sessions = new SessionManager({
    sessions: new SqliteSessionRepository(db),
    users,
    clock,
    newToken: sequentialIds("token"),
    ttlMs: SESSION_TTL_MS,
  });
  const limiter = new MemoryRateLimiter(clock);
  const mailer = new MemoryMailer();
  const captcha = new FakeCaptcha();
  const accounts = new AccountManager({
    users,
    tokens: new SqliteAccountTokenRepository(db),
    sessions,
    passwords: fakePasswordHasher,
    captcha,
    mailer,
    limiter,
    clock,
    newId: sequentialIds("u"),
    newToken: sequentialIds("mailed"),
    publicUrl: "http://web.test",
  });
  return {
    accounts,
    sessions,
    limiter,
    trustProxy: false,
    turnstileSiteKey: "test-site-key",
    users,
    mailer,
    captcha,
  };
}
