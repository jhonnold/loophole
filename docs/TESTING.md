# Testing

## Runner

Tests run with `bun test`, Bun's built-in, Jest-compatible runner. Put test files next to the code they test and name them `*.test.ts`. Import `describe`, `test` and `expect` from `bun:test`.

Running a subset:

```sh
bun test packages/core        # one workspace
bun test -t "is commutative"  # tests whose name matches
```

`bun test` also picks up `*.spec.ts`, so Playwright end-to-end tests use a different suffix (for example `*.e2e.ts` with Playwright's `testMatch`).

## Property tests

Use [fast-check](https://fast-check.dev) for properties that should hold for every input, especially in the core package (PRD NFR-3: the solver, verifier and generator have unit and property tests):

```ts
import fc from "fast-check";

test("is commutative", () => {
  fc.assert(fc.property(fc.integer(), fc.integer(), (a, b) => add(a, b) === add(b, a)));
});
```

When a property fails, fast-check prints a `seed` and `path`. To replay that exact case while debugging, pass them back: `fc.assert(prop, { seed, path })`. Turn the shrunk counterexample into a plain unit test so it stays covered.

## The gate

`bun run check` runs, in order:

1. `bun run lint`: Biome lint and format check
2. `bun run typecheck`: each workspace's `typecheck` script. Every workspace defines a `typecheck` script; one without it is skipped silently.
3. `bun run check:api`: fails if `openapi.yaml` or the generated API client no longer match the server's routes (`bun run gen:api` fixes it)
4. `bun run test`: `bun test` over the whole repo

GitHub Actions runs `bun install --frozen-lockfile` and then `bun run check` on every push to `main` and on every pull request.

### Timing-sensitive tests

`./scripts/test-under-load.sh [copies] [rounds] [bun test arguments]` runs `bun test` several times at once (6 copies, 5 rounds by default), which slows each run down the way a busy machine or CI does, and lists every test that failed and how often. Run it after adding a test that waits on threads, timers or other processes, for example `./scripts/test-under-load.sh 16 6 apps/server`. Bun 1.3.13 itself crashes now and then under this load ("panic: Segmentation fault", about 1 run in 50 at 16 copies, while worker threads are torn down); that is a Bun bug, not a failing test (`docs/DECISIONS.md`, "Concurrent-open tests use processes").

## Server

Server tests follow its layers:

- Managers are tested with the fakes in the server's test support (clock, puzzle repository, job queue, task runner) and the in-memory blob store, so they run without a database or threads.
- SQLite repositories and the job queue are tested on in-memory databases (`openDatabase(":memory:")`), which run the real migrations. The claim race test and the concurrent-open test use a database file shared by several child processes (`Bun.spawn`), as the API and the worker share one; threads would not do (`docs/DECISIONS.md`, "Concurrent-open tests use processes").
- Routes are tested through Hono's `app.request` over real managers and in-memory adapters, with no server listening.
- The thread task runner is tested with real Bun worker threads, including a 100×100 generation stopped at its time limit.
- The S3 blob store test runs against Garage when the `S3_*` settings are set (from `.env`) and Garage answers; otherwise it is skipped, as in CI. Start Garage (README, Local services) to run it.
- The account and session managers run on fakes too (users, sessions, mailed tokens, password hashing, CAPTCHA) with the in-memory mailer and rate limiter. Route tests build the account side with `accountDeps` from the server's test support and pass a client address as `app.request`'s third argument.
- The SMTP mailer test sends through Mailpit and reads the message back from Mailpit's API when it answers on 127.0.0.1:8025; otherwise it is skipped. The Turnstile adapter is tested with a fake `fetch`, never against Cloudflare.
- The daily puzzle, ranked attempt, leaderboard and display name managers run on fakes too. `FakeAttemptRepository` ranks by the same rules as the SQL (time, then who finished first), and the SQLite repository tests check the SQL itself. A fake clock takes tests across 00:00 UTC. Route tests build the daily side with `dailyDeps` and store daily puzzles with `storeDaily`, both from the server's test support.
- Every route test passes `health: healthManager(db, clock)` (server test support) to `createApp`. Request counts and auth failures are checked with a recording `ApiMetrics` in `api/health.test.ts`; the Prometheus adapter is tested on its own registry, and its metrics server on a free port. The JSON log writer's tests check that emails, tokens and passwords are masked.
- `bun run bench:jobs` is the server-side performance check (NFR-1): generations up to 30×30 and two 100×100 verifications through the real thread runner, failing when a budget is missed. It is not part of the check, since its timings depend on the machine.

## Web app

The web app's game logic is plain TypeScript with `*.test.ts` files beside it, so the root `bun test` runs those tests with everything else. Bun can't load `.svelte` files or SvelteKit's `$lib` and `$app` aliases, which only resolve inside Vite, so the tested modules import neither; Svelte components hold as little logic as possible.

The components are covered by Playwright end-to-end tests (`*.e2e.ts` in the web app's `tests` folder). They build the app, serve it and drive it in Chromium at the design kit's phone sizes and on a desktop. Run them with `bun run test:e2e`; they serve the build on port 4173, or on `E2E_PORT` when it is set, which side-by-side worktrees need. They are not part of `bun run check` because they need a local Chromium (`bunx playwright install chromium` in the web app folder).

The account, publishing and progress end-to-end tests (`tests/*.auth-e2e.ts`) have their own config, `playwright.auth.config.ts`: it builds the app and starts the real API serving it on port 4174 (or `E2E_AUTH_PORT`) and a worker, sharing a fresh database file in the temp folder, with Mailpit for mail, Garage for solutions and Turnstile's test keys. The account test replaces Cloudflare's widget script with a stub and reads the confirmation link from Mailpit's API; the publishing test signs up through the API, publishes a puzzle from the editor and opens its link; the progress test has the worker generate a 5×5 puzzle and plays it in two browser contexts logged in to the same account; the daily test waits for the worker to generate today's puzzles (the config keeps `DAILY_DAYS_AHEAD` at 2) and solves the 7×7 ranked, working out the solution from the clues with core's `verify`. Run them with `bun run test:e2e:auth`; they skip themselves when Mailpit or challenges.cloudflare.com can't be reached, and the publishing and progress tests also when Garage can't.

The daily puzzle screens need the API, which `vite preview` doesn't have, so `tests/daily.e2e.ts` answers the daily, attempt, leaderboard, session and progress routes itself with `page.route` (`tests/daily-mocks.ts`), with the small-7 fixture as today's 7×7.

The web app's sync module is tested under `bun test` against a fake progress API that applies the server's conflict rule, with a hand-run scheduler in place of timers.

The editor's live check runs in a Web Worker; its logic (`lib/editor/checker.ts`) takes the worker and the timers as parameters, so its tests drive a fake worker and fake timers. `tests/editor.e2e.ts` covers the editor in Chromium with no server.

Frame-time checks (`tests/perf.e2e.ts`, tagged `@perf`) slow the CPU down and measure animation frames while drawing and zooming large boards. `bun run test:e2e` skips them; run them with `bun run test:perf`. They stay out of the gate because their timings depend on the machine.
