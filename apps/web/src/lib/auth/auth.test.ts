import { describe, expect, test } from "bun:test";
import { createApiClient } from "@loophole/api-client";
import { get } from "svelte/store";
import { createAuth, failureMessage, tokenFromHash, type User } from "./auth.ts";

const USER: User = {
  id: "u1",
  email: "ann@example.com",
  emailVerified: false,
  isAdmin: false,
  createdAt: "2026-10-25T12:00:00.000Z",
};

type Reply = [status: number, body?: unknown];

/**
 * An auth store over a fake API: `routes` maps "METHOD /path" to a reply (or a function giving
 * one). Records each request as "METHOD /path" with its JSON body.
 */
function setup(routes: Record<string, Reply | (() => Reply)>) {
  const requests: { route: string; body: unknown }[] = [];
  const fetch = (async (input: Request) => {
    const route = `${input.method} ${new URL(input.url).pathname}`;
    const text = await input.text();
    requests.push({ route, body: text ? JSON.parse(text) : undefined });
    const entry = routes[route];
    const [status, body] =
      typeof entry === "function" ? entry() : (entry ?? [404, { title: "Not found" }]);
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": status < 400 ? "application/json" : "application/problem+json" },
    });
  }) as typeof globalThis.fetch;
  const auth = createAuth(createApiClient({ baseUrl: "http://api.test", fetch }));
  return { auth, requests };
}

describe("auth store", () => {
  test("starts loading; refresh sets the user or guest", async () => {
    let user: User | null = USER;
    const { auth } = setup({ "GET /api/session": () => [200, { user }] });
    expect(get(auth)).toEqual({ status: "loading" });
    await auth.refresh();
    expect(get(auth)).toEqual({ status: "user", user: USER });
    user = null;
    await auth.refresh();
    expect(get(auth)).toEqual({ status: "guest" });
  });

  test("a missing or unreachable API means guest", async () => {
    const { auth } = setup({ "GET /api/session": [500, { title: "Internal server error" }] });
    await auth.refresh();
    expect(get(auth)).toEqual({ status: "guest" });
    const offline = createAuth(
      createApiClient({
        baseUrl: "http://api.test",
        fetch: (async () => {
          throw new TypeError("Failed to fetch");
        }) as unknown as typeof globalThis.fetch,
      }),
    );
    await offline.refresh();
    expect(get(offline)).toEqual({ status: "guest" });
    expect(await offline.logIn("a@example.com", "pw")).toEqual({
      ok: false,
      message: "Couldn't reach the server. Check your connection and try again.",
    });
    expect(await offline.turnstileSiteKey()).toBeNull();
  });

  test("logIn sends the credentials and stores the user", async () => {
    const { auth, requests } = setup({ "POST /api/auth/login": [200, USER] });
    expect(await auth.logIn("ann@example.com", "hunter22")).toEqual({ ok: true });
    expect(requests).toEqual([
      { route: "POST /api/auth/login", body: { email: "ann@example.com", password: "hunter22" } },
    ]);
    expect(get(auth)).toEqual({ status: "user", user: USER });
  });

  test("a failed login reports the server's message and changes nothing", async () => {
    const { auth } = setup({
      "POST /api/auth/login": [
        401,
        {
          type: "about:blank",
          title: "Wrong email or password",
          status: 401,
          detail: "The email or password is wrong.",
        },
      ],
    });
    expect(await auth.logIn("ann@example.com", "nope")).toEqual({
      ok: false,
      message: "The email or password is wrong.",
    });
    expect(get(auth)).toEqual({ status: "loading" });
  });

  test("logOut, a password reset and account deletion all leave a guest", async () => {
    const { auth, requests } = setup({
      "POST /api/auth/login": [200, USER],
      "POST /api/auth/logout": [204],
      "POST /api/auth/reset-password": [204],
      "DELETE /api/account": [204],
    });
    await auth.logIn("ann@example.com", "hunter22");
    await auth.logOut();
    expect(get(auth)).toEqual({ status: "guest" });
    await auth.logIn("ann@example.com", "hunter22");
    expect(await auth.resetPassword("tok", "new-password")).toEqual({ ok: true });
    expect(get(auth)).toEqual({ status: "guest" });
    await auth.logIn("ann@example.com", "hunter22");
    expect(await auth.deleteAccount("hunter22")).toEqual({ ok: true });
    expect(get(auth)).toEqual({ status: "guest" });
    expect(requests.at(-1)).toEqual({
      route: "DELETE /api/account",
      body: { password: "hunter22" },
    });
  });

  test("verifying an email refreshes the logged-in user", async () => {
    const { auth } = setup({
      "POST /api/auth/verify-email": [204],
      "GET /api/session": [200, { user: { ...USER, emailVerified: true } }],
    });
    expect(await auth.verifyEmail("tok")).toEqual({ ok: true });
    expect(get(auth)).toMatchObject({ status: "user", user: { emailVerified: true } });
  });

  test("sign-up, resend and reset requests pass their fields through", async () => {
    const { auth, requests } = setup({
      "POST /api/auth/signup": [204],
      "POST /api/auth/resend-verification": [204],
      "POST /api/auth/forgot-password": [204],
      "GET /api/auth/config": [200, { turnstileSiteKey: "site" }],
    });
    expect(await auth.signUp("a@example.com", "hunter22", "cap")).toEqual({ ok: true });
    expect(await auth.resendVerification("a@example.com")).toEqual({ ok: true });
    expect(await auth.requestPasswordReset("a@example.com")).toEqual({ ok: true });
    expect(await auth.turnstileSiteKey()).toBe("site");
    expect(requests.map((r) => r.body)).toEqual([
      { email: "a@example.com", password: "hunter22", captchaToken: "cap" },
      { email: "a@example.com" },
      { email: "a@example.com" },
      undefined,
    ]);
  });
});

describe("helpers", () => {
  test("failureMessage", () => {
    expect(failureMessage(429, { title: "Too many requests" })).toBe(
      "Too many attempts. Wait a few minutes and try again.",
    );
    expect(failureMessage(400, { title: "Invalid request", detail: "password: Too small" })).toBe(
      "Check the form and try again.",
    );
    expect(
      failureMessage(400, {
        title: "CAPTCHA check failed",
        detail: "The CAPTCHA check failed. Try again.",
      }),
    ).toBe("The CAPTCHA check failed. Try again.");
    expect(failureMessage(403, { title: "Cross-site request refused" })).toBe(
      "Cross-site request refused",
    );
    expect(failureMessage(502, undefined)).toBe("Something went wrong (HTTP 502).");
  });

  test("tokenFromHash", () => {
    expect(tokenFromHash("#token=abc_-1")).toBe("abc_-1");
    expect(tokenFromHash("token=abc")).toBe("abc");
    expect(tokenFromHash("")).toBeNull();
    expect(tokenFromHash("#token=")).toBeNull();
    expect(tokenFromHash("#other=1")).toBeNull();
  });
});
