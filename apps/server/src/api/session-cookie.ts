import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { UserRecord } from "../domain.ts";
import type { NewSession, SessionManager } from "../managers/session-manager.ts";

export const SESSION_COOKIE = "loophole_session";

/** Real tokens are 43 characters; anything much longer is not worth hashing. */
const MAX_TOKEN_LENGTH = 128;

const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "Lax", path: "/" } as const;

/** The session token from the request's cookie, or null. */
export function sessionToken(c: Context): string | null {
  const token = getCookie(c, SESSION_COOKIE);
  return token !== undefined && token.length > 0 && token.length <= MAX_TOKEN_LENGTH ? token : null;
}

/** Secure, HttpOnly, SameSite=Lax, for the whole site, until the session expires. */
export function setSessionCookie(c: Context, session: NewSession): void {
  setCookie(c, SESSION_COOKIE, session.token, {
    ...COOKIE_OPTIONS,
    expires: new Date(session.expiresAt),
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, COOKIE_OPTIONS);
}

/**
 * The logged-in user, or null. A cookie whose session is gone or expired is cleared. Routes that
 * need a user (progress sync, submissions, leaderboards) call this and answer 401 on null.
 */
export async function currentUser(
  c: Context,
  sessions: SessionManager,
): Promise<UserRecord | null> {
  const token = sessionToken(c);
  if (token === null) return null;
  const user = await sessions.authenticate(token);
  if (user === null) clearSessionCookie(c);
  return user;
}
