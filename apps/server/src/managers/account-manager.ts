import type { AccountTokenPurpose, UserRecord } from "../domain.ts";
import type {
  AccountTokenRepository,
  CaptchaVerifier,
  Clock,
  Mailer,
  PasswordHasher,
  RateLimiter,
  RateRule,
  UserRepository,
} from "../ports.ts";
import {
  CaptchaFailedError,
  InvalidCredentialsError,
  InvalidTokenError,
  RateLimitedError,
} from "./errors.ts";
import { hashToken } from "./hash-token.ts";
import type { NewSession, SessionManager } from "./session-manager.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Login attempts per email, whoever makes them (also counts account deletion attempts). It stops
 * password guessing spread over many addresses, at a price: anyone who knows an email can keep
 * that account from logging in by sending 10 bad attempts every 15 minutes (DECISIONS).
 */
export const LOGIN_PER_EMAIL: RateRule = { limit: 10, windowMs: 15 * MINUTE };
/** Mails per address; more are dropped silently, so nobody can flood an inbox. */
export const MAIL_PER_EMAIL: RateRule = { limit: 3, windowMs: HOUR };
export const VERIFY_TOKEN_TTL_MS = 24 * HOUR;
export const RESET_TOKEN_TTL_MS = HOUR;

export interface AccountManagerDeps {
  readonly users: UserRepository;
  readonly tokens: AccountTokenRepository;
  readonly sessions: SessionManager;
  readonly passwords: PasswordHasher;
  readonly captcha: CaptchaVerifier;
  readonly mailer: Mailer;
  readonly limiter: RateLimiter;
  readonly clock: Clock;
  readonly newId: () => string;
  /** A new random token (256 bits). */
  readonly newToken: () => string;
  /** Origin of the web app, without a trailing slash, for links in mail. */
  readonly publicUrl: string;
}

export interface SignUpRequest {
  readonly email: string;
  readonly password: string;
  readonly captchaToken: string;
  /** The client's address, passed on to the CAPTCHA check when known. */
  readonly remoteIp: string | null;
}

/** Emails are compared trimmed and lower-cased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Sign-up, login, email verification, password reset and account deletion (PRD FR-18 to FR-20,
 * NFR-6). Answers never reveal whether an email has an account: sign-up, resend and reset requests
 * all look the same from outside, and a wrong email fails login exactly like a wrong password.
 */
export class AccountManager {
  readonly #deps: AccountManagerDeps;
  #dummyHash: Promise<string> | null = null;

  constructor(deps: AccountManagerDeps) {
    this.#deps = deps;
  }

  /**
   * Creates an unverified account and mails a verification link. When the email already has an
   * account, mails that account a note instead. Throws `CaptchaFailedError`.
   */
  async signUp(request: SignUpRequest): Promise<void> {
    const { users, passwords, captcha, clock, newId } = this.#deps;
    if (!(await captcha.verify(request.captchaToken, request.remoteIp))) {
      throw new CaptchaFailedError();
    }
    const email = normalizeEmail(request.email);
    // Hash before looking at the email, so both outcomes take the same time.
    const passwordHash = await passwords.hash(request.password);
    const user: UserRecord = {
      id: newId(),
      email,
      passwordHash,
      emailVerifiedAt: null,
      isAdmin: false,
      createdAt: clock.now(),
    };
    if (users.insert(user)) await this.#sendVerification(user);
    else await this.#mail(email, alreadyRegisteredMail(this.#deps.publicUrl));
  }

  /**
   * Checks the password and starts a new session, ending `previousToken`'s session if one was
   * sent (a new token on every login). Throws `InvalidCredentialsError` or `RateLimitedError`.
   */
  async logIn(
    emailInput: string,
    password: string,
    previousToken: string | null,
  ): Promise<{ user: UserRecord; session: NewSession }> {
    const { users, sessions } = this.#deps;
    const email = normalizeEmail(emailInput);
    this.#limit(`login:${email}`, LOGIN_PER_EMAIL);
    const user = users.getByEmail(email);
    if (!(await this.#checkPassword(user, password)) || user === null) {
      throw new InvalidCredentialsError();
    }
    if (previousToken !== null) await sessions.end(previousToken);
    return { user, session: await sessions.create(user.id) };
  }

  /** Marks the email of the link's account verified. Throws `InvalidTokenError`. */
  async verifyEmail(token: string): Promise<void> {
    const userId = await this.#takeToken(token, "verify-email");
    this.#deps.users.markEmailVerified(userId, this.#deps.clock.now());
  }

  /** Mails a new verification link if the email has an unverified account; otherwise nothing. */
  async resendVerification(emailInput: string): Promise<void> {
    const user = this.#deps.users.getByEmail(normalizeEmail(emailInput));
    if (user !== null && user.emailVerifiedAt === null) await this.#sendVerification(user);
  }

  /** Mails a password reset link if the email has an account; otherwise nothing. */
  async requestPasswordReset(emailInput: string): Promise<void> {
    const user = this.#deps.users.getByEmail(normalizeEmail(emailInput));
    if (user === null) return;
    const token = await this.#issueToken(user.id, "reset-password", RESET_TOKEN_TTL_MS);
    await this.#mail(
      user.email,
      resetMail(`${this.#deps.publicUrl}/reset-password#token=${token}`),
    );
  }

  /**
   * Sets a new password from a reset link and ends every session of the account. The link proves
   * the user reads that inbox, so the email counts as verified too. Throws `InvalidTokenError`.
   */
  async resetPassword(token: string, password: string): Promise<void> {
    const { users, passwords, sessions, clock } = this.#deps;
    const userId = await this.#takeToken(token, "reset-password");
    users.setPasswordHash(userId, await passwords.hash(password));
    users.markEmailVerified(userId, clock.now());
    sessions.endAll(userId);
  }

  /**
   * Deletes the account and everything stored for it (NFR-6), after checking the password.
   * Throws `InvalidCredentialsError` or `RateLimitedError`.
   */
  async deleteAccount(userId: string, password: string): Promise<void> {
    const { users } = this.#deps;
    const user = users.get(userId);
    if (user === null) throw new InvalidCredentialsError();
    this.#limit(`login:${user.email}`, LOGIN_PER_EMAIL);
    if (!(await this.#checkPassword(user, password))) throw new InvalidCredentialsError();
    users.delete(userId);
  }

  /** Verifies against a throwaway hash when there is no user, so unknown emails take as long. */
  async #checkPassword(user: UserRecord | null, password: string): Promise<boolean> {
    const { passwords } = this.#deps;
    if (user !== null) return passwords.verify(password, user.passwordHash);
    this.#dummyHash ??= passwords.hash("not anybody's password");
    await passwords.verify(password, await this.#dummyHash);
    return false;
  }

  async #sendVerification(user: UserRecord): Promise<void> {
    const token = await this.#issueToken(user.id, "verify-email", VERIFY_TOKEN_TTL_MS);
    await this.#mail(user.email, verifyMail(`${this.#deps.publicUrl}/verify-email#token=${token}`));
  }

  async #issueToken(userId: string, purpose: AccountTokenPurpose, ttlMs: number): Promise<string> {
    const { tokens, clock, newToken } = this.#deps;
    const now = clock.now();
    tokens.deleteExpired(now);
    const token = newToken();
    tokens.replace({
      tokenHash: await hashToken(token),
      userId,
      purpose,
      createdAt: now,
      expiresAt: now + ttlMs,
    });
    return token;
  }

  /** Uses up a token and returns its user's id. Throws `InvalidTokenError`. */
  async #takeToken(token: string, purpose: AccountTokenPurpose): Promise<string> {
    const { tokens, clock } = this.#deps;
    const record = tokens.take(await hashToken(token), purpose);
    if (record === null || record.expiresAt <= clock.now()) throw new InvalidTokenError();
    return record.userId;
  }

  async #mail(to: string, mail: { subject: string; text: string }): Promise<void> {
    if (!this.#deps.limiter.hit(`mail:${to}`, MAIL_PER_EMAIL).allowed) return;
    await this.#deps.mailer.send({ to, ...mail });
  }

  #limit(key: string, rule: RateRule): void {
    const decision = this.#deps.limiter.hit(key, rule);
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterMs);
  }
}

function verifyMail(link: string) {
  return {
    subject: "Confirm your email for Loophole",
    text: `Welcome to Loophole.\n\nOpen this link to confirm your email address. It works once and expires in 24 hours.\n\n${link}\n\nIf you didn't sign up, ignore this email.\n`,
  };
}

function resetMail(link: string) {
  return {
    subject: "Reset your Loophole password",
    text: `Someone asked to reset the password for this email address on Loophole.\n\nOpen this link to choose a new password. It works once and expires in 1 hour.\n\n${link}\n\nIf it wasn't you, ignore this email; your password stays as it is.\n`,
  };
}

function alreadyRegisteredMail(publicUrl: string) {
  return {
    subject: "You already have a Loophole account",
    text: `Someone tried to sign up for Loophole with this email address, but it already has an account.\n\nLog in: ${publicUrl}/login\nForgot your password? ${publicUrl}/forgot-password\n\nIf it wasn't you, ignore this email.\n`,
  };
}
