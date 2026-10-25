import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The request an API log line belongs to. The API's request middleware runs each request inside
 * `requestContext.run`, and the JSON log writer adds the id to every line logged meanwhile.
 */
export const requestContext = new AsyncLocalStorage<{ readonly requestId: string }>();
