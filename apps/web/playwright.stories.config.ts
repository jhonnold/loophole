import { defineConfig } from "@playwright/test";
import auth from "./playwright.auth.config.ts";

// The PRD §6 user stories, end to end on the full stack: the same API (serving the built app),
// worker, fresh database, Mailpit and Garage as `bun run test:e2e:auth`. The tests skip themselves
// when Mailpit, Garage or challenges.cloudflare.com can't be reached. Run with
// `bun run test:e2e:stories` from the repo root; E2E_AUTH_PORT changes the port as for the auth tests.
export default defineConfig({ ...auth, testMatch: "**/*.story-e2e.ts" });
