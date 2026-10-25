import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import type { ApiMetrics } from "../ports.ts";
import { requestContext } from "../request-context.ts";

/** A request id from the proxy is kept if it looks like one; otherwise the API makes its own. */
const REQUEST_ID = /^[\w.:-]{1,64}$/;

/**
 * Gives every request an id (`X-Request-Id`, passed on from a proxy or made here), runs it in the
 * request context so log lines carry the id, counts it by route template and logs one line when
 * it is answered (with `accessLog`). The line has the method, route template, status and time: no
 * path, query, address or body, so no ids from the URL, tokens or emails reach the log. Health
 * checks that pass aren't logged.
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
      if (!accessLog || (route.startsWith("/api/health") && status < 400)) return;
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
