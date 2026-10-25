import { describe, expect, test } from "bun:test";
import { MemoryMailer } from "../adapters/mail/memory-mailer.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import {
  FakeAccountTokenRepository,
  FakeCaptcha,
  FakeClock,
  FakeSessionRepository,
  FakeUserRepository,
  fakePasswordHasher,
  sequentialIds,
} from "../test-support/fakes.ts";
import {
  AccountManager,
  normalizeEmail,
  RESET_TOKEN_TTL_MS,
  VERIFY_TOKEN_TTL_MS,
} from "./account-manager.ts";
import {
  CaptchaFailedError,
  InvalidCredentialsError,
  InvalidTokenError,
  RateLimitedError,
} from "./errors.ts";
import { SessionManager } from "./session-manager.ts";

function setup() {
  const clock = new FakeClock(1_000_000);
  const users = new FakeUserRepository();
  const tokens = new FakeAccountTokenRepository();
  const sessions = new SessionManager({
    sessions: new FakeSessionRepository(),
    users,
    clock,
    newToken: sequentialIds("session"),
    ttlMs: 60_000,
  });
  const mailer = new MemoryMailer();
  const captcha = new FakeCaptcha();
  const accounts = new AccountManager({
    users,
    tokens,
    sessions,
    passwords: fakePasswordHasher,
    captcha,
    mailer,
    limiter: new MemoryRateLimiter(clock),
    clock,
    newId: sequentialIds("u"),
    newToken: sequentialIds("mailed"),
    publicUrl: "http://web.test",
  });
  const signUp = (email = " Ann@Example.com", password = "hunter22") =>
    accounts.signUp({ email, password, captchaToken: "cap", remoteIp: "203.0.113.5" });
  return { clock, users, tokens, sessions, mailer, captcha, accounts, signUp };
}

/** The token from the link in the last mail. */
function lastLinkToken(mailer: MemoryMailer): string {
  const match = mailer.sent.at(-1)?.text.match(/#token=(\S+)/);
  if (!match) throw new Error("no link in the last mail");
  return match[1];
}

describe("AccountManager sign-up and verification", () => {
  test("normalizeEmail trims and lower-cases", () => {
    expect(normalizeEmail("  Ann@Example.COM ")).toBe("ann@example.com");
  });

  test("signUp stores an unverified user with a hashed password and mails a link", async () => {
    const { users, mailer, captcha, signUp } = setup();
    await signUp();
    expect(captcha.calls).toEqual([{ token: "cap", remoteIp: "203.0.113.5" }]);
    expect(users.get("u-1")).toEqual({
      id: "u-1",
      email: "ann@example.com",
      passwordHash: "hashed:hunter22",
      emailVerifiedAt: null,
      isAdmin: false,
      createdAt: 1_000_000,
    });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe("ann@example.com");
    expect(mailer.sent[0].subject).toBe("Confirm your email for Loophole");
    expect(mailer.sent[0].text).toContain("http://web.test/verify-email#token=mailed-1");
  });

  test("a failed CAPTCHA stores and mails nothing", async () => {
    const { users, mailer, captcha, signUp } = setup();
    captcha.ok = false;
    await expect(signUp()).rejects.toBeInstanceOf(CaptchaFailedError);
    expect(users.users.size).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });

  test("signing up with a taken email changes nothing and mails the owner a note", async () => {
    const { users, mailer, signUp } = setup();
    await signUp();
    await signUp("ann@example.com", "other-password");
    expect(users.users.size).toBe(1);
    expect(users.get("u-1")?.passwordHash).toBe("hashed:hunter22");
    expect(mailer.sent.at(-1)).toMatchObject({
      to: "ann@example.com",
      subject: "You already have a Loophole account",
    });
    expect(mailer.sent.at(-1)?.text).toContain("http://web.test/forgot-password");
    expect(mailer.sent.at(-1)?.text).not.toContain("#token=");
  });

  test("verifyEmail marks the email verified, once", async () => {
    const { clock, users, mailer, accounts, signUp } = setup();
    await signUp();
    const token = lastLinkToken(mailer);
    clock.advance(5);
    await accounts.verifyEmail(token);
    expect(users.get("u-1")?.emailVerifiedAt).toBe(1_000_005);
    await expect(accounts.verifyEmail(token)).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(accounts.verifyEmail("made-up")).rejects.toBeInstanceOf(InvalidTokenError);
  });

  test("a verification link expires after 24 hours", async () => {
    const { clock, users, mailer, accounts, signUp } = setup();
    await signUp();
    clock.advance(VERIFY_TOKEN_TTL_MS);
    await expect(accounts.verifyEmail(lastLinkToken(mailer))).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
    expect(users.get("u-1")?.emailVerifiedAt).toBeNull();
  });

  test("resendVerification replaces the link, and mails only unverified accounts", async () => {
    const { mailer, accounts, signUp } = setup();
    await signUp();
    const first = lastLinkToken(mailer);
    await accounts.resendVerification("ANN@example.com");
    const second = lastLinkToken(mailer);
    expect(second).not.toBe(first);
    await expect(accounts.verifyEmail(first)).rejects.toBeInstanceOf(InvalidTokenError);
    await accounts.verifyEmail(second);
    await accounts.resendVerification("ann@example.com");
    await accounts.resendVerification("nobody@example.com");
    expect(mailer.sent).toHaveLength(2);
  });

  test("at most 3 mails per address per hour; more are dropped silently", async () => {
    const { clock, mailer, accounts, signUp } = setup();
    await signUp();
    for (let i = 0; i < 5; i++) await accounts.resendVerification("ann@example.com");
    expect(mailer.sent).toHaveLength(3);
    clock.advance(60 * 60_000);
    await accounts.resendVerification("ann@example.com");
    expect(mailer.sent).toHaveLength(4);
  });
});

describe("AccountManager login", () => {
  test("logIn checks the password and starts a session, verified or not", async () => {
    const { accounts, sessions, signUp } = setup();
    await signUp();
    const { user, session } = await accounts.logIn("Ann@example.com", "hunter22", null);
    expect(user.id).toBe("u-1");
    expect(session.token).toBe("session-1");
    expect((await sessions.authenticate("session-1"))?.id).toBe("u-1");
  });

  test("a wrong password and an unknown email fail the same way", async () => {
    const { accounts, signUp } = setup();
    await signUp();
    await expect(accounts.logIn("ann@example.com", "nope", null)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await expect(accounts.logIn("bob@example.com", "hunter22", null)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  test("logging in again replaces the session sent with the request", async () => {
    const { accounts, sessions, signUp } = setup();
    await signUp();
    await accounts.logIn("ann@example.com", "hunter22", null);
    await accounts.logIn("ann@example.com", "hunter22", "session-1");
    expect(await sessions.authenticate("session-1")).toBeNull();
    expect(await sessions.authenticate("session-2")).not.toBeNull();
  });

  test("after 10 attempts in 15 minutes an email is locked for the rest of the window", async () => {
    const { clock, accounts, signUp } = setup();
    await signUp();
    for (let i = 0; i < 10; i++) {
      await expect(accounts.logIn("ann@example.com", "nope", null)).rejects.toBeInstanceOf(
        InvalidCredentialsError,
      );
    }
    clock.advance(60_000);
    const locked = accounts.logIn("ann@example.com", "hunter22", null);
    await expect(locked).rejects.toBeInstanceOf(RateLimitedError);
    await expect(locked).rejects.toMatchObject({ retryAfterMs: 14 * 60_000 });
    clock.advance(14 * 60_000);
    expect((await accounts.logIn("ann@example.com", "hunter22", null)).user.id).toBe("u-1");
  });
});

describe("AccountManager password reset and deletion", () => {
  test("a reset link sets the new password, verifies the email and logs out everywhere", async () => {
    const { mailer, users, accounts, sessions, signUp } = setup();
    await signUp();
    await accounts.logIn("ann@example.com", "hunter22", null);
    await accounts.requestPasswordReset(" ann@EXAMPLE.com");
    expect(mailer.sent.at(-1)?.subject).toBe("Reset your Loophole password");
    expect(mailer.sent.at(-1)?.text).toContain("http://web.test/reset-password#token=");
    const token = lastLinkToken(mailer);
    await accounts.resetPassword(token, "new-password");
    expect(users.get("u-1")?.passwordHash).toBe("hashed:new-password");
    expect(users.get("u-1")?.emailVerifiedAt).not.toBeNull();
    expect(await sessions.authenticate("session-1")).toBeNull();
    await expect(accounts.logIn("ann@example.com", "hunter22", null)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await accounts.logIn("ann@example.com", "new-password", null);
    await expect(accounts.resetPassword(token, "again-again")).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  test("reset links expire after an hour and are not verification links", async () => {
    const { clock, mailer, accounts, signUp } = setup();
    await signUp();
    await accounts.requestPasswordReset("ann@example.com");
    const token = lastLinkToken(mailer);
    await expect(accounts.verifyEmail(token)).rejects.toBeInstanceOf(InvalidTokenError);
    await accounts.requestPasswordReset("ann@example.com");
    clock.advance(RESET_TOKEN_TTL_MS);
    await expect(
      accounts.resetPassword(lastLinkToken(mailer), "new-password"),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  test("a reset request for an unknown email mails nothing", async () => {
    const { mailer, accounts } = setup();
    await accounts.requestPasswordReset("nobody@example.com");
    expect(mailer.sent).toHaveLength(0);
  });

  test("deleteAccount needs the password, then removes the user", async () => {
    const { users, accounts, sessions, signUp } = setup();
    await signUp();
    await accounts.logIn("ann@example.com", "hunter22", null);
    await expect(accounts.deleteAccount("u-1", "nope")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(users.get("u-1")).not.toBeNull();
    await accounts.deleteAccount("u-1", "hunter22");
    expect(users.get("u-1")).toBeNull();
    expect(await sessions.authenticate("session-1")).toBeNull();
    await expect(accounts.deleteAccount("u-1", "hunter22")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });
});
