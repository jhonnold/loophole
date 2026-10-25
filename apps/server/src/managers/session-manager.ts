import type { UserRecord } from "../domain.ts";
import type { Clock, SessionRepository, UserRepository } from "../ports.ts";
import { hashToken } from "./hash-token.ts";

export interface SessionManagerDeps {
  readonly sessions: SessionRepository;
  readonly users: UserRepository;
  readonly clock: Clock;
  /** A new random token (256 bits). */
  readonly newToken: () => string;
  /** How long a session lasts from login. */
  readonly ttlMs: number;
}

export interface NewSession {
  /** Goes in the cookie; never stored. */
  readonly token: string;
  readonly expiresAt: number;
}

/**
 * Login sessions: an opaque random token in the cookie, its hash in the database, a fixed
 * lifetime from login.
 */
export class SessionManager {
  readonly #deps: SessionManagerDeps;

  constructor(deps: SessionManagerDeps) {
    this.#deps = deps;
  }

  /** Starts a session for `userId`. Also clears out expired sessions. */
  async create(userId: string): Promise<NewSession> {
    const { sessions, clock, newToken, ttlMs } = this.#deps;
    const now = clock.now();
    sessions.deleteExpired(now);
    const token = newToken();
    const expiresAt = now + ttlMs;
    sessions.insert({ tokenHash: await hashToken(token), userId, createdAt: now, expiresAt });
    return { token, expiresAt };
  }

  /** The user a session token belongs to, or null when it is unknown or expired. */
  async authenticate(token: string): Promise<UserRecord | null> {
    const { sessions, users, clock } = this.#deps;
    const tokenHash = await hashToken(token);
    const session = sessions.get(tokenHash);
    if (session === null) return null;
    if (session.expiresAt <= clock.now()) {
      sessions.delete(tokenHash);
      return null;
    }
    return users.get(session.userId);
  }

  /** Ends one session (logout). Unknown tokens are ignored. */
  async end(token: string): Promise<void> {
    this.#deps.sessions.delete(await hashToken(token));
  }

  /** Ends every session of a user, such as after a password reset. */
  endAll(userId: string): void {
    this.#deps.sessions.deleteForUser(userId);
  }
}
