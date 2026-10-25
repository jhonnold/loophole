import type { MiddlewareHandler } from "hono";
import { problem } from "./problem.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a request comes from this site's own pages (or from no browser at all). Browsers send
 * Sec-Fetch-Site on every request; older ones send at least Origin on a cross-origin POST.
 * Without either header the request isn't from a browser, so it carries no victim's cookies.
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site !== null) return site === "same-origin" || site === "none";
  const origin = request.headers.get("Origin");
  if (origin === null) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false; // "null" and other opaque origins
  }
}

/**
 * CSRF protection (NFR-4): refuses state-changing requests made from other sites. It backs up the
 * session cookie's SameSite=Lax and the JSON-only request bodies. See DECISIONS, "CSRF".
 */
export const sameOriginOnly: MiddlewareHandler = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method) || isSameOrigin(c.req.raw)) return next();
  return problem(c, 403, "Cross-site request refused", {
    detail: "State-changing requests must come from this site's own pages.",
  });
};
