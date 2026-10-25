import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// End-to-end tests of accounts and publishing against the real API, which also serves the built
// app (as in production), and the job worker. Needs Mailpit and, for publishing, Garage
// (`docker compose up -d`), and access to Cloudflare's Turnstile check; the tests skip themselves
// without them. Run with `bun run test:e2e:auth` from this package.

// A fresh database file for every run, shared by the API and the worker. Playwright loads this
// file in the runner and again in each worker process; the runner makes the folder once and the
// child processes inherit it, and globalTeardown removes it.
process.env.LOOPHOLE_E2E_DIR ??= mkdtempSync(join(tmpdir(), "loophole-e2e-"));
const env = {
  DATABASE_PATH: join(process.env.LOOPHOLE_E2E_DIR, "e2e.sqlite"),
  PUBLIC_URL: "http://localhost:4174",
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  // Garage's development bucket and key (scripts/garage-init.sh, .env.example).
  S3_ENDPOINT: "http://localhost:3900",
  S3_REGION: "garage",
  S3_BUCKET: "loophole-dev",
  S3_ACCESS_KEY_ID: "GK1a2b3c4d5e6f708192a3b4c5",
  S3_SECRET_ACCESS_KEY: "8b339f8231fe89196b07eb8766bf6f079805f64a9be09934697b94e0b1aa0a0b",
};

export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.auth-e2e.ts",
  globalTeardown: "./tests/auth-teardown.ts",
  reporter: "list",
  use: {
    baseURL: "http://localhost:4174",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // From the repo root, like the other server scripts.
      command: "bun run build && cd ../.. && bun apps/server/src/api/main.ts",
      url: "http://localhost:4174/api/health",
      reuseExistingServer: false,
      env: { ...env, PORT: "4174", WEB_DIR: "apps/web/build" },
    },
    {
      command: "cd ../.. && bun apps/server/src/worker/main.ts",
      wait: { stdout: /polling for jobs/ },
      reuseExistingServer: false,
      env,
    },
  ],
});
