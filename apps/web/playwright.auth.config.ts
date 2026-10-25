import { defineConfig } from "@playwright/test";

// End-to-end tests of accounts and saved progress against the real API, which also serves the
// built app (as in production), with a job worker beside it. They need access to Cloudflare's
// Turnstile check; the account test also needs Mailpit and the progress test Garage
// (`docker compose up -d`, then `scripts/garage-init.sh`). Each test skips itself without what it
// needs. Run with `bun run test:e2e:auth` from this package.
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
    // From the repo root, like the other server scripts. The worker generates the puzzles the
    // progress test plays; Playwright stops it with the API.
    command:
      "bun run build && cd ../.. && rm -f data/e2e-auth.sqlite* && (bun apps/server/src/worker/main.ts & bun apps/server/src/api/main.ts)",
    url: "http://localhost:4174/api/health",
    reuseExistingServer: false,
    env: {
      PORT: "4174",
      WEB_DIR: "apps/web/build",
      // A fresh database for every run, shared by the API and the worker.
      DATABASE_PATH: "data/e2e-auth.sqlite",
      PUBLIC_URL: "http://localhost:4174",
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
      // Garage's dev bucket and key (.env.example), for the generated puzzles' solutions.
      S3_ENDPOINT: "http://localhost:3900",
      S3_REGION: "garage",
      S3_BUCKET: "loophole-dev",
      S3_ACCESS_KEY_ID: "GK1a2b3c4d5e6f708192a3b4c5",
      S3_SECRET_ACCESS_KEY: "8b339f8231fe89196b07eb8766bf6f079805f64a9be09934697b94e0b1aa0a0b",
    },
  },
});
