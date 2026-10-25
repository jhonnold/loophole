import createClient from "openapi-fetch";
import type { components, paths } from "./schema.ts";

export type { components, paths };

export type Schemas = components["schemas"];

/** A typed client for the Loophole API (openapi.yaml). */
export type ApiClient = ReturnType<typeof createClient<paths>>;

export interface ApiClientOptions {
  /** Origin of the API. Default "": same origin as the page. */
  readonly baseUrl?: string;
  /** Default the global `fetch`. Tests pass their own. */
  readonly fetch?: typeof fetch;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  return createClient<paths>({ baseUrl: options.baseUrl ?? "", fetch: options.fetch });
}
