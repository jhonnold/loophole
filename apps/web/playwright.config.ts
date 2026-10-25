import { defineConfig } from "@playwright/test";

// End-to-end tests against the built app. Not part of `bun run check`: they need a Chromium build
// (`bunx playwright install chromium`). Run with `bun run test:e2e` from this package.
export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run build && bun run preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    // Always serve a fresh build; fails fast if something else already holds the port.
    reuseExistingServer: false,
  },
});
