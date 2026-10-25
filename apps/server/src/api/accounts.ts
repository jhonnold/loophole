import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import type { UserRecord } from "../domain.ts";
import type { AccountManager } from "../managers/account-manager.ts";
import type { SessionManager } from "../managers/session-manager.ts";
import type { RateLimiter, RateRule } from "../ports.ts";
import {
  AuthConfigSchema,
  DeleteAccountRequestSchema,
  EmailRequestSchema,
  LogInRequestSchema,
  ResetPasswordRequestSchema,
  SessionSchema,
  SignUpRequestSchema,
  UserSchema,
  VerifyEmailRequestSchema,
} from "./account-schemas.ts";
import { clientAddress, rateLimitKey } from "./client-address.ts";
import { problem, problemResponse } from "./problem.ts";
import {
  clearSessionCookie,
  currentUser,
  SESSION_COOKIE,
  sessionToken,
  setSessionCookie,
} from "./session-cookie.ts";

export interface AccountRouteDeps {
  readonly accounts: AccountManager;
  readonly sessions: SessionManager;
  readonly limiter: RateLimiter;
  /** Take the client's address from X-Forwarded-For (see `clientAddress`). */
  readonly trustProxy: boolean;
  readonly turnstileSiteKey: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Limits per client address (NFR-4). The account manager also limits per email. */
const ADDRESS_LIMITS = {
  signup: { limit: 10, windowMs: HOUR },
  login: { limit: 20, windowMs: 15 * MINUTE },
  mail: { limit: 10, windowMs: HOUR },
  token: { limit: 20, windowMs: 15 * MINUTE },
  deleteAccount: { limit: 10, windowMs: 15 * MINUTE },
} satisfies Record<string, RateRule>;

const json = <T>(schema: T) => ({ content: { "application/json": { schema } }, required: true });

const crossSite = problemResponse("Sent from another site (CSRF protection).");
const tooMany = problemResponse("Too many attempts; `Retry-After` says when to try again.");
const invalid = problemResponse("Invalid request body.");

const configRoute = createRoute({
  method: "get",
  path: "/api/auth/config",
  summary: "Settings the sign-up form needs",
  responses: {
    200: {
      description: "Settings.",
      content: { "application/json": { schema: AuthConfigSchema } },
    },
  },
});

const sessionRoute = createRoute({
  method: "get",
  path: "/api/session",
  summary: "Who is logged in",
  responses: {
    200: {
      description: "The logged-in user, or null.",
      content: { "application/json": { schema: SessionSchema } },
    },
  },
});

const signUpRoute = createRoute({
  method: "post",
  path: "/api/auth/signup",
  summary: "Create an account",
  description:
    "Mails a verification link. The answer is the same whether or not the email already has an account; such an account gets a note instead. Does not log in.",
  request: { body: json(SignUpRequestSchema) },
  responses: {
    204: { description: "Accepted; check your email." },
    400: problemResponse("Invalid body, or the CAPTCHA check failed."),
    403: crossSite,
    429: tooMany,
  },
});

const logInRoute = createRoute({
  method: "post",
  path: "/api/auth/login",
  summary: "Log in",
  description: "Sets a new session cookie and ends the session of the cookie sent, if any.",
  request: { body: json(LogInRequestSchema) },
  responses: {
    200: {
      description: "Logged in.",
      content: { "application/json": { schema: UserSchema } },
    },
    400: invalid,
    401: problemResponse("Wrong email or password."),
    403: crossSite,
    429: tooMany,
  },
});

const logOutRoute = createRoute({
  method: "post",
  path: "/api/auth/logout",
  summary: "Log out",
  responses: { 204: { description: "Logged out (also when no one was)." }, 403: crossSite },
});

const verifyEmailRoute = createRoute({
  method: "post",
  path: "/api/auth/verify-email",
  summary: "Confirm an email address with the mailed token",
  request: { body: json(VerifyEmailRequestSchema) },
  responses: {
    204: { description: "Verified." },
    400: problemResponse("Invalid body, or the link is invalid, used or expired."),
    403: crossSite,
    429: tooMany,
  },
});

const resendRoute = createRoute({
  method: "post",
  path: "/api/auth/resend-verification",
  summary: "Mail a new verification link",
  description: "Same answer whether or not the email has an unverified account.",
  request: { body: json(EmailRequestSchema) },
  responses: { 204: { description: "Accepted." }, 400: invalid, 403: crossSite, 429: tooMany },
});

const forgotRoute = createRoute({
  method: "post",
  path: "/api/auth/forgot-password",
  summary: "Mail a password reset link",
  description: "Same answer whether or not the email has an account.",
  request: { body: json(EmailRequestSchema) },
  responses: { 204: { description: "Accepted." }, 400: invalid, 403: crossSite, 429: tooMany },
});

const resetRoute = createRoute({
  method: "post",
  path: "/api/auth/reset-password",
  summary: "Set a new password with the mailed token",
  description: "Logs the account out everywhere. Does not log in.",
  request: { body: json(ResetPasswordRequestSchema) },
  responses: {
    204: { description: "Password changed." },
    400: problemResponse("Invalid body, or the link is invalid, used or expired."),
    403: crossSite,
    429: tooMany,
  },
});

const deleteAccountRoute = createRoute({
  method: "delete",
  path: "/api/account",
  summary: "Delete the logged-in account and all its data",
  security: [{ session: [] }],
  request: { body: json(DeleteAccountRequestSchema) },
  responses: {
    204: { description: "Deleted and logged out." },
    400: invalid,
    401: problemResponse("Not logged in, or wrong password."),
    403: crossSite,
    429: tooMany,
  },
});

/** Sign-up, login, logout, email verification, password reset, account deletion. */
export function registerAccountRoutes(app: OpenAPIHono, deps: AccountRouteDeps): void {
  const { accounts, sessions, limiter, trustProxy } = deps;

  app.openAPIRegistry.registerComponent("securitySchemes", "session", {
    type: "apiKey",
    in: "cookie",
    name: SESSION_COOKIE,
  });

  const byAddress =
    (name: keyof typeof ADDRESS_LIMITS): MiddlewareHandler =>
    async (c, next) => {
      const key = `${name}:${rateLimitKey(clientAddress(c, trustProxy))}`;
      const decision = limiter.hit(key, ADDRESS_LIMITS[name]);
      if (decision.allowed) return next();
      return tooManyRequests(c, decision.retryAfterMs);
    };

  app.use("/api/auth/signup", byAddress("signup"));
  app.use("/api/auth/login", byAddress("login"));
  app.use("/api/auth/resend-verification", byAddress("mail"));
  app.use("/api/auth/forgot-password", byAddress("mail"));
  app.use("/api/auth/verify-email", byAddress("token"));
  app.use("/api/auth/reset-password", byAddress("token"));
  app.on("DELETE", "/api/account", byAddress("deleteAccount"));

  app.openapi(configRoute, (c) => c.json({ turnstileSiteKey: deps.turnstileSiteKey }, 200));

  app.openapi(sessionRoute, async (c) => {
    const user = await currentUser(c, sessions);
    return c.json({ user: user === null ? null : toUserDto(user) }, 200);
  });

  app.openapi(signUpRoute, async (c) => {
    const { email, password, captchaToken } = c.req.valid("json");
    const address = clientAddress(c, trustProxy);
    await accounts.signUp({
      email,
      password,
      captchaToken,
      remoteIp: address === "unknown" ? null : address,
    });
    return c.body(null, 204);
  });

  app.openapi(logInRoute, async (c) => {
    const { email, password } = c.req.valid("json");
    const { user, session } = await accounts.logIn(email, password, sessionToken(c));
    setSessionCookie(c, session);
    return c.json(toUserDto(user), 200);
  });

  app.openapi(logOutRoute, async (c) => {
    const token = sessionToken(c);
    if (token !== null) await sessions.end(token);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  app.openapi(verifyEmailRoute, async (c) => {
    await accounts.verifyEmail(c.req.valid("json").token);
    return c.body(null, 204);
  });

  app.openapi(resendRoute, async (c) => {
    await accounts.resendVerification(c.req.valid("json").email);
    return c.body(null, 204);
  });

  app.openapi(forgotRoute, async (c) => {
    await accounts.requestPasswordReset(c.req.valid("json").email);
    return c.body(null, 204);
  });

  app.openapi(resetRoute, async (c) => {
    const { token, password } = c.req.valid("json");
    await accounts.resetPassword(token, password);
    return c.body(null, 204);
  });

  app.openapi(deleteAccountRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    await accounts.deleteAccount(user.id, c.req.valid("json").password);
    clearSessionCookie(c);
    return c.body(null, 204);
  });
}

/** A 429 problem with `Retry-After` in whole seconds. */
export function tooManyRequests(c: Context, retryAfterMs: number) {
  c.header("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  return problem(c, 429, "Too many requests", {
    detail: "Too many attempts. Wait a little and try again.",
  });
}

function toUserDto(u: UserRecord) {
  return {
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerifiedAt !== null,
    isAdmin: u.isAdmin,
    createdAt: new Date(u.createdAt).toISOString(),
  };
}
