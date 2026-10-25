import type { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ProblemSchema } from "./schemas.ts";

export type Problem = z.infer<typeof ProblemSchema>;

/**
 * An `application/problem+json` response (RFC 9457). Built with `c.json` so route handlers
 * type-check against their declared error responses; the header overrides the content type.
 */
export function problem<S extends ContentfulStatusCode>(
  c: Context,
  status: S,
  title: string,
  extra: Pick<Problem, "detail" | "errors"> = {},
) {
  const body: Problem = { type: "about:blank", title, status, ...extra };
  return c.json(body, status, { "Content-Type": "application/problem+json" });
}

/** An error response in a route's OpenAPI definition. */
export const problemResponse = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: ProblemSchema } },
});
