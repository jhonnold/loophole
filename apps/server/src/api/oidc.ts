import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { OidcLoginError, type OidcLoginFailure } from "../managers/errors.ts";
import type { OidcLoginManager } from "../managers/oidc-login-manager.ts";
import type { ApiMetrics, OidcPending, RateLimiter } from "../ports.ts";
import { limitByAddress } from "./accounts.ts";
import { problemResponse } from "./problem.ts";
import { sessionToken, setSessionCookie } from "./session-cookie.ts";

export interface OidcRouteDeps {
  readonly oidc: { readonly manager: OidcLoginManager };
  readonly limiter: RateLimiter;
  readonly trustProxy: boolean;
  readonly metrics: ApiMetrics;
}

/** Holds the state, nonce and PKCE verifier while the player is at the provider. */
export const OIDC_COOKIE = "__Host-loophole_oidc";

/** Long enough to log in at the provider, second factor included. */
const PENDING_MAX_AGE_S = 10 * 60;

/** Lax, so the browser sends it on the provider's redirect back (a top-level GET). */
const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "Lax", path: "/" } as const;

/** Per client address, for starting and finishing a login together (NFR-4). */
const OIDC_LIMIT = { limit: 20, windowMs: 15 * 60_000 };

/** Where a failed login lands: the login page shows a message for the reason. */
type FailureReason = OidcLoginFailure | "unavailable";
const failedLogin = (reason: FailureReason) => `/login#oidc_error=${reason}`;

const redirect = (description: string) => ({
  description,
  headers: { Location: { schema: { type: "string" as const } } },
});

const startRoute = createRoute({
  method: "get",
  path: "/api/auth/oidc/start",
  summary: "Log in through single sign-on",
  description:
    "Open in the browser (not with fetch). Sends the browser to the identity provider, which sends it back to the callback. Only when `AuthConfig.oidc` is set; otherwise 404.",
  responses: {
    302: redirect(
      "To the identity provider, or to `/login#oidc_error=unavailable` when it can't be reached.",
    ),
    429: problemResponse("Too many attempts; `Retry-After` says when to try again."),
  },
});

const callbackRoute = createRoute({
  method: "get",
  path: "/api/auth/oidc/callback",
  summary: "Where the identity provider sends the browser back",
  description:
    "Takes the provider's query parameters (`code`, `state`, `iss`, or `error`). Logs in to the account tied to the identity or with its email, or makes a new one, and sets a new session cookie.",
  responses: {
    302: redirect(
      "To `/` when logged in, else to `/login#oidc_error=<failed|no-email|email-unverified>`.",
    ),
    429: problemResponse("Too many attempts; `Retry-After` says when to try again."),
  },
});

/** Single sign-on through an OpenID Connect provider (PRD FR-30). */
export function registerOidcRoutes(app: OpenAPIHono, deps: OidcRouteDeps): void {
  const { manager } = deps.oidc;
  const limit = limitByAddress(deps.limiter, deps.trustProxy, "oidc", OIDC_LIMIT);
  app.use("/api/auth/oidc/*", limit);

  app.openapi(startRoute, async (c) => {
    const started = await manager.begin();
    if (started === null) return fail(c, deps.metrics, "unavailable");
    setCookie(c, OIDC_COOKIE, encodePending(started.pending), {
      ...COOKIE_OPTIONS,
      maxAge: PENDING_MAX_AGE_S,
    });
    return c.redirect(started.url, 302);
  });

  app.openapi(callbackRoute, async (c) => {
    const pending = decodePending(getCookie(c, OIDC_COOKIE));
    // Used once: a second visit to the same callback URL finds no cookie.
    deleteCookie(c, OIDC_COOKIE, COOKIE_OPTIONS);
    // No cookie means this browser didn't start the login (or took too long): refuse, so another
    // site can't log the player in to someone else's account (login CSRF).
    if (pending === null) return fail(c, deps.metrics, "failed");
    try {
      const callback = new URL(c.req.url).searchParams;
      const { session } = await manager.finish(callback, pending, sessionToken(c));
      setSessionCookie(c, session);
      return c.redirect("/", 302);
    } catch (err) {
      if (err instanceof OidcLoginError) return fail(c, deps.metrics, err.reason);
      throw err;
    }
  });
}

function fail(c: Context, metrics: ApiMetrics, reason: FailureReason) {
  metrics.authFailure("oidc");
  return c.redirect(failedLogin(reason), 302);
}

function encodePending(p: OidcPending): string {
  return Buffer.from(JSON.stringify([p.state, p.nonce, p.codeVerifier])).toString("base64url");
}

/** The pending login from the cookie, or null when there is none or it isn't one of ours. */
export function decodePending(value: string | undefined): OidcPending | null {
  if (value === undefined || value.length > 1024) return null;
  try {
    const parts: unknown = JSON.parse(Buffer.from(value, "base64url").toString());
    if (
      !Array.isArray(parts) ||
      parts.length !== 3 ||
      !parts.every((s) => typeof s === "string" && s.length > 0)
    ) {
      return null;
    }
    const [state, nonce, codeVerifier] = parts as string[];
    return { state, nonce, codeVerifier };
  } catch {
    return null;
  }
}
