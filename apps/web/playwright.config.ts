import { defineConfig } from "@playwright/test";
import { E2E_PORT } from "./tests/ports.ts";

// End-to-end tests against the built app. Not part of `bun run check`: they need a Chromium build
// (`bunx playwright install chromium`). Run with `bun run test:e2e` from this package; set E2E_PORT
// to serve on another port than 4173.
export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `bun run build && bun run preview --port ${E2E_PORT} --strictPort`,
    url: `http://localhost:${E2E_PORT}`,
    // Always serve a fresh build; fails fast if something else already holds the port.
    reuseExistingServer: false,
  },
});
