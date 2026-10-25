import { describe, expect, test } from "bun:test";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { createApp } from "./app.ts";
import type { Problem } from "./problem.ts";
import { SESSION_COOKIE } from "./session-cookie.ts";

function setup(options: { trustProxy?: boolean } = {}) {
  const db = openDatabase(":memory:");
  const clock = new FakeClock(Date.UTC(2026, 9, 25, 12));
  const deps = accountDeps(db, clock);
  const app = createApp({
    puzzles: new PuzzleManager({
      puzzles: new SqlitePuzzleRepository(db),
      blobs: new MemoryBlobStore(),
      clock,
    }),
    jobs: new JobManager({
      jobs: new SqliteJobQueue(db),
      clock,
      newId: sequentialIds("j"),
      maxQueued: 10,
    }),
    ...deps,
    trustProxy: options.trustProxy ?? false,
  });

  /** A request as the web app sends it: JSON, same origin, with an optional session cookie. */
  const send = (
    method: string,
    path: string,
    body?: unknown,
    options: { cookie?: string; headers?: Record<string, string>; address?: string } = {},
  ) => {
    const headers: Record<string, string> = { "Sec-Fetch-Site": "same-origin", ...options.headers };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (options.cookie !== undefined) headers.Cookie = `${SESSION_COOKIE}=${options.cookie}`;
    const env = { requestIP: () => ({ address: options.address ?? "198.51.100.7" }) };
    return app.request(
      path,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      env,
    );
  };

  const signUp = (email = "ann@example.com", password = "hunter22") =>
    send("POST", "/api/auth/signup", { email, password, captchaToken: "cap" });

  const logIn = async (email = "ann@example.com", password = "hunter22", cookie?: string) => {
    const res = await send("POST", "/api/auth/login", { email, password }, { cookie });
    expect(res.status).toBe(200);
    return sessionCookie(res);
  };

  /** The token from the last mail's link. */
  const mailedToken = () => {
    const match = deps.mailer.sent.at(-1)?.text.match(/#token=(\S+)/);
    if (!match) throw new Error("no link in the last mail");
    return match[1];
  };

  return { app, clock, deps, send, signUp, logIn, mailedToken };
}

/** The session cookie a response sets: its value and attributes. */
function setCookie(res: Response): string {
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (cookie === undefined) throw new Error("no session cookie set");
  return cookie;
}

function sessionCookie(res: Response): string {
  return setCookie(res)
    .split(";")[0]
    .slice(SESSION_COOKIE.length + 1);
}

async function expectProblem(res: Response, status: number, title?: string): Promise<Problem> {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toStartWith("application/problem+json");
  const body = (await res.json()) as Problem;
  expect(body.status).toBe(status);
  if (title !== undefined) expect(body.title).toBe(title);
  return body;
}

describe("sign-up, verification, login and logout", () => {
  test("the whole path, with the cookie's security attributes", async () => {
    const { send, signUp, mailedToken } = setup();
    const created = await signUp();
    expect(created.status).toBe(204);
    expect(created.headers.getSetCookie()).toEqual([]); // sign-up doesn't log in

    expect((await send("POST", "/api/auth/verify-email", { token: mailedToken() })).status).toBe(
      204,
    );

    const login = await send("POST", "/api/auth/login", {
      email: "Ann@Example.com",
      password: "hunter22",
    });
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({
      id: "u-1",
      email: "ann@example.com",
      emailVerified: true,
      isAdmin: false,
      createdAt: "2026-10-25T12:00:00.000Z",
    });
    const cookie = setCookie(login);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Expires=Tue, 24 Nov 2026 12:00:00 GMT"); // 30 days
    const token = sessionCookie(login);

    const session = await send("GET", "/api/session", undefined, { cookie: token });
    expect(((await session.json()) as { user: { email: string } }).user.email).toBe(
      "ann@example.com",
    );

    const logout = await send("POST", "/api/auth/logout", undefined, { cookie: token });
    expect(logout.status).toBe(204);
    expect(setCookie(logout)).toContain("Max-Age=0");
    const after = await send("GET", "/api/session", undefined, { cookie: token });
    expect(await after.json()).toEqual({ user: null });
  });

  test("GET /api/auth/config gives the Turnstile site key", async () => {
    const res = await setup().send("GET", "/api/auth/config");
    expect(await res.json()).toEqual({ turnstileSiteKey: "test-site-key" });
  });

  test("an unknown session cookie means logged out and is cleared", async () => {
    const res = await setup().send("GET", "/api/session", undefined, { cookie: "stale" });
    expect(await res.json()).toEqual({ user: null });
    expect(setCookie(res)).toContain("Max-Age=0");
  });

  test("an unverified account can log in", async () => {
    const { send, signUp, logIn } = setup();
    await signUp();
    const token = await logIn();
    const res = await send("GET", "/api/session", undefined, { cookie: token });
    expect(await res.json()).toMatchObject({ user: { emailVerified: false } });
  });

  test("signing up with a taken email answers exactly like a new sign-up", async () => {
    const { signUp, deps } = setup();
    const first = await signUp();
    const second = await signUp("ANN@example.com", "something-else");
    expect(second.status).toBe(first.status);
    expect(await second.text()).toBe(await first.text());
    expect(deps.mailer.sent.map((m) => m.subject)).toEqual([
      "Confirm your email for Loophole",
      "You already have a Loophole account",
    ]);
  });

  test("a failed CAPTCHA is a 400 problem", async () => {
    const { signUp, deps } = setup();
    deps.captcha.ok = false;
    await expectProblem(await signUp(), 400, "CAPTCHA check failed");
    expect(deps.captcha.calls[0]).toEqual({ token: "cap", remoteIp: "198.51.100.7" });
  });

  test("sign-up validates the body", async () => {
    const { send } = setup();
    for (const body of [
      { email: "not-an-email", password: "hunter22", captchaToken: "c" },
      { email: "a@example.com", password: "short", captchaToken: "c" },
      { email: "a@example.com", password: "x".repeat(129), captchaToken: "c" },
      { email: "a@example.com", password: "hunter22" },
      { email: "a@example.com", password: "hunter22", captchaToken: "c", admin: true },
    ]) {
      await expectProblem(await send("POST", "/api/auth/signup", body), 400, "Invalid request");
    }
  });

  test("a wrong password and an unknown email get the same 401", async () => {
    const { send, signUp } = setup();
    await signUp();
    const wrong = await send("POST", "/api/auth/login", {
      email: "ann@example.com",
      password: "nope-nope",
    });
    const unknown = await send("POST", "/api/auth/login", {
      email: "bob@example.com",
      password: "hunter22",
    });
    const a = await expectProblem(wrong, 401, "Wrong email or password");
    const b = await expectProblem(unknown, 401, "Wrong email or password");
    expect(a).toEqual(b);
  });

  test("logging in with a session cookie replaces that session", async () => {
    const { send, signUp, logIn } = setup();
    await signUp();
    const first = await logIn();
    const second = await logIn("ann@example.com", "hunter22", first);
    expect(second).not.toBe(first);
    const old = await send("GET", "/api/session", undefined, { cookie: first });
    expect(await old.json()).toEqual({ user: null });
  });

  test("a used or made-up verification token is a 400 problem", async () => {
    const { send, signUp, mailedToken } = setup();
    await signUp();
    const token = mailedToken();
    await send("POST", "/api/auth/verify-email", { token });
    await expectProblem(
      await send("POST", "/api/auth/verify-email", { token }),
      400,
      "Invalid or expired link",
    );
  });

  test("resend and forgot-password answer 204 for unknown emails too, mailing nothing", async () => {
    const { send, deps } = setup();
    for (const path of ["/api/auth/resend-verification", "/api/auth/forgot-password"]) {
      expect((await send("POST", path, { email: "nobody@example.com" })).status).toBe(204);
    }
    expect(deps.mailer.sent).toHaveLength(0);
  });
});

describe("password reset and account deletion", () => {
  test("a reset sets the new password and logs out every session", async () => {
    const { send, signUp, logIn, mailedToken } = setup();
    await signUp();
    const token = await logIn();
    expect(
      (await send("POST", "/api/auth/forgot-password", { email: "ann@example.com" })).status,
    ).toBe(204);
    const reset = await send("POST", "/api/auth/reset-password", {
      token: mailedToken(),
      password: "brand-new-pw",
    });
    expect(reset.status).toBe(204);
    const old = await send("GET", "/api/session", undefined, { cookie: token });
    expect(await old.json()).toEqual({ user: null });
    await logIn("ann@example.com", "brand-new-pw");
  });

  test("deleting the account needs a session and the password", async () => {
    const { send, signUp, logIn, deps } = setup();
    await signUp();
    const token = await logIn();
    await expectProblem(
      await send("DELETE", "/api/account", { password: "hunter22" }),
      401,
      "Not logged in",
    );
    await expectProblem(
      await send("DELETE", "/api/account", { password: "nope-nope" }, { cookie: token }),
      401,
      "Wrong email or password",
    );
    const res = await send("DELETE", "/api/account", { password: "hunter22" }, { cookie: token });
    expect(res.status).toBe(204);
    expect(setCookie(res)).toContain("Max-Age=0");
    expect(deps.users.getByEmail("ann@example.com")).toBeNull();
    await expectProblem(
      await send("POST", "/api/auth/login", { email: "ann@example.com", password: "hunter22" }),
      401,
    );
  });
});

describe("CSRF protection", () => {
  const login = { email: "ann@example.com", password: "hunter22" };

  test("refuses state-changing requests from other sites", async () => {
    const { send } = setup();
    for (const headers of [{ "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }]) {
      await expectProblem(
        await send("POST", "/api/auth/login", login, { headers }),
        403,
        "Cross-site request refused",
      );
    }
    await expectProblem(
      await send(
        "POST",
        "/api/jobs/generate",
        { width: 5, height: 5 },
        {
          headers: { "Sec-Fetch-Site": "cross-site" },
        },
      ),
      403,
    );
  });

  test("without Sec-Fetch-Site, the Origin must match the request's host", async () => {
    const { app } = setup();
    const post = (headers: Record<string, string>) =>
      app.request("http://loophole.test/api/auth/logout", { method: "POST", headers });
    await expectProblem(await post({ Origin: "http://evil.test" }), 403);
    await expectProblem(await post({ Origin: "null" }), 403);
    expect((await post({ Origin: "http://loophole.test" })).status).toBe(204);
    expect((await post({})).status).toBe(204); // not a browser: no cookies to abuse
  });

  test("reads are never refused", async () => {
    const res = await setup().send("GET", "/api/session", undefined, {
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(res.status).toBe(200);
  });
});

describe("rate limits", () => {
  test("sign-ups are limited per address, with Retry-After", async () => {
    const { send } = setup();
    const signUp = (n: number, address: string) =>
      send(
        "POST",
        "/api/auth/signup",
        { email: `p${n}@example.com`, password: "hunter22", captchaToken: "c" },
        { address },
      );
    for (let i = 0; i < 10; i++) expect((await signUp(i, "198.51.100.7")).status).toBe(204);
    const limited = await signUp(10, "198.51.100.7");
    await expectProblem(limited, 429, "Too many requests");
    expect(limited.headers.get("Retry-After")).toBe("3600");
    expect((await signUp(11, "198.51.100.8")).status).toBe(204);
  });

  test("login attempts are limited per email across addresses", async () => {
    const { send, signUp } = setup();
    await signUp();
    for (let i = 0; i < 10; i++) {
      const res = await send(
        "POST",
        "/api/auth/login",
        { email: "ann@example.com", password: "nope-nope" },
        { address: `203.0.113.${i}` },
      );
      expect(res.status).toBe(401);
    }
    const limited = await send(
      "POST",
      "/api/auth/login",
      { email: "ann@example.com", password: "hunter22" },
      { address: "203.0.113.99" },
    );
    await expectProblem(limited, 429);
    expect(limited.headers.get("Retry-After")).toBe("900");
  });

  test("behind a trusted proxy the last X-Forwarded-For entry is the address", async () => {
    const { send } = setup({ trustProxy: true });
    const forgot = (forwarded: string) =>
      send(
        "POST",
        "/api/auth/forgot-password",
        { email: "a@example.com" },
        { headers: { "X-Forwarded-For": forwarded } },
      );
    for (let i = 0; i < 10; i++) expect((await forgot(`10.0.0.${i}, 192.0.2.1`)).status).toBe(204);
    expect((await forgot("10.0.0.1, 192.0.2.1")).status).toBe(429);
    expect((await forgot("192.0.2.1, 192.0.2.2")).status).toBe(204);
  });
});
