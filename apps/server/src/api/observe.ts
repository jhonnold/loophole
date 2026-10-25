import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import type { ApiMetrics } from "../ports.ts";
import { requestContext } from "../request-context.ts";

/** A request id from the proxy is kept if it looks like one; otherwise the API makes its own. */
const REQUEST_ID = /^[\w.:-]{1,64}$/;
/** The route templates of the web app's static files (`*`) and its page fallback (`/*`). */
const STATIC_ROUTES = new Set(["*", "/*"]);

/**
 * Gives every request an id (`X-Request-Id`, passed on from a proxy or made here), runs it in the
 * request context so log lines carry the id, counts it by route template and logs one line when
 * it is answered (with `accessLog`). The line has the method, route template, status and time: no
 * path, query, address or body, so no ids from the URL, tokens or emails reach the log. Health
 * checks that pass, and the web app's files that load, aren't logged (the metrics count them).
 */
export function observe(metrics: ApiMetrics, accessLog: boolean): MiddlewareHandler {
  return async (c, next) => {
    const given = c.req.header("X-Request-Id");
    const requestId = given !== undefined && REQUEST_ID.test(given) ? given : crypto.randomUUID();
    const started = performance.now();
    await requestContext.run({ requestId }, async () => {
      await next();
      c.header("X-Request-Id", requestId);
      const route = routePath(c) || "unmatched";
      const status = c.res.status;
      const seconds = (performance.now() - started) / 1000;
      metrics.request(c.req.method, route, status, seconds);
      const quiet = status < 400 && (STATIC_ROUTES.has(route) || route.startsWith("/api/health"));
      if (!accessLog || quiet) return;
      const level = status >= 500 ? "error" : "info";
      console[level]("request", {
        method: c.req.method,
        route,
        status,
        ms: Math.round(seconds * 1000),
      });
    });
  };
}
