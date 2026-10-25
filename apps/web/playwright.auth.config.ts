import { defineConfig } from "@playwright/test";

// End-to-end test of accounts against the real API, which also serves the built app (as in
// production). Needs Mailpit (`docker compose up -d`) and access to Cloudflare's Turnstile check;
// the test skips itself without them. Run with `bun run test:e2e:auth` from this package.
export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.auth-e2e.ts",
  reporter: "list",
  use: {
    baseURL: "http://localhost:4174",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    // From the repo root, like the other server scripts.
    command: "bun run build && cd ../.. && bun apps/server/src/api/main.ts",
    url: "http://localhost:4174/api/health",
    reuseExistingServer: false,
    env: {
      PORT: "4174",
      WEB_DIR: "apps/web/build",
      // A fresh database for every run, gone when the server stops.
      DATABASE_PATH: ":memory:",
      PUBLIC_URL: "http://localhost:4174",
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
      // The blob store isn't used by these pages, but the API needs settings for it.
      S3_ENDPOINT: "http://localhost:3900",
      S3_REGION: "garage",
      S3_BUCKET: "loophole-dev",
      S3_ACCESS_KEY_ID: "unused",
      S3_SECRET_ACCESS_KEY: "unused",
    },
  },
});
