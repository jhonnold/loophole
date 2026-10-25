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

## Server

Server tests follow its layers:

- Managers are tested with the fakes in the server's test support (clock, puzzle repository, job queue, task runner) and the in-memory blob store, so they run without a database or threads.
- SQLite repositories and the job queue are tested on in-memory databases (`openDatabase(":memory:")`), which run the real migrations. The claim race test uses a database file shared by several threads.
- Routes are tested through Hono's `app.request` over real managers and in-memory adapters, with no server listening.
- The thread task runner is tested with real Bun worker threads, including a 100×100 generation stopped at its time limit.
- The S3 blob store test runs against Garage when the `S3_*` settings are set (from `.env`) and Garage answers; otherwise it is skipped, as in CI. Start Garage (README, Local services) to run it.
- The account and session managers run on fakes too (users, sessions, mailed tokens, password hashing, CAPTCHA) with the in-memory mailer and rate limiter. Route tests build the account side with `accountDeps` from the server's test support and pass a client address as `app.request`'s third argument.
- The SMTP mailer test sends through Mailpit and reads the message back from Mailpit's API when it answers on 127.0.0.1:8025; otherwise it is skipped. The Turnstile adapter is tested with a fake `fetch`, never against Cloudflare.

## Web app

The web app's game logic is plain TypeScript with `*.test.ts` files beside it, so the root `bun test` runs those tests with everything else. Bun can't load `.svelte` files or SvelteKit's `$lib` and `$app` aliases, which only resolve inside Vite, so the tested modules import neither; Svelte components hold as little logic as possible.

The components are covered by Playwright end-to-end tests (`*.e2e.ts` in the web app's `tests` folder). They build the app, serve it and drive it in Chromium at the design kit's phone sizes and on a desktop. Run them with `bun run test:e2e`. They are not part of `bun run check` because they need a local Chromium (`bunx playwright install chromium` in the web app folder).

The account end-to-end test (`tests/accounts.auth-e2e.ts`) has its own config, `playwright.auth.config.ts`: it builds the app and starts the real API serving it on port 4174, with a fresh database, Mailpit for mail and Turnstile's test keys. It replaces Cloudflare's widget script with a stub and reads the confirmation link from Mailpit's API. Run it with `bun run test:e2e:auth`; it skips itself when Mailpit or challenges.cloudflare.com can't be reached.

Frame-time checks (`tests/perf.e2e.ts`, tagged `@perf`) slow the CPU down and measure animation frames while drawing and zooming large boards. `bun run test:e2e` skips them; run them with `bun run test:perf`. They stay out of the gate because their timings depend on the machine.
