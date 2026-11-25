import type { Schemas } from "@loophole/api-client";
import type { Page } from "@playwright/test";
import { USER } from "./daily-mocks.ts";

// A stand-in for the admin API, so the admin page can be checked with no server.

export const HEALTH: Schemas["AdminHealth"] = {
  database: { ok: true, ms: 1, error: null },
  blobs: { ok: false, ms: 2000, error: "No answer within 2000 ms" },
  jobs: { queued: 2, running: 1, oldestQueuedAt: new Date(Date.now() - 125_000).toISOString() },
  dailies: [
    { size: 7, days: 3 },
    { size: 10, days: 3 },
    { size: 20, days: 1 },
    { size: 40, days: 0 },
  ],
  failures: [
    {
      id: "j9",
      kind: "generate",
      status: "timeout",
      error: "Stopped after the 60 s time limit.",
      finishedAt: new Date(Date.now() - 600_000).toISOString(),
    },
  ],
  versions: { app: "4f8cb61", generator: "1", runtime: "bun 1.3.13" },
  startedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
};

/** Logs in as an admin and answers the health report and an empty reports list. */
export async function mockAdminApi(page: Page) {
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { user: { ...USER, isAdmin: true } } }),
  );
  await page.route("**/api/admin/health", (route) => route.fulfill({ json: HEALTH }));
  await page.route("**/api/admin/reports", (route) => route.fulfill({ json: { items: [] } }));
}
