# server

The Loophole backend: one package with two entrypoints that share a SQLite database and an S3-compatible blob store (Garage in development). The HTTP API (Hono with `@hono/zod-openapi`) serves puzzles, queues background jobs and, in production, the built web app. The worker polls the jobs table and runs generation and verification in Bun worker threads under a hard time limit.

The code is layered, and Biome's import rules check the direction:

- Entrypoints (HTTP routes, the worker loop) translate between wire shapes and domain types and validate input with zod. They call managers and hold no business logic.
- Managers hold the business logic. They depend on the core package and on the adapter interfaces in the ports module, not on concrete adapters, so their tests run on the fakes in test support.
- Adapters implement those interfaces (SQLite repositories and job queue, blob stores, the thread task runner, the clock, the mailer, the CAPTCHA check, password hashing, the rate limiter) and convert rows and objects to domain types.
- Each process has a composition root that reads the settings and wires adapters into managers; the OpenAPI document has its own.

Conventions:

- SQL runs as prepared statements with named parameters. A schema change is a new numbered migration file; files that have run stay as they are.
- Solutions and solver traces live in the blob store, and puzzle responses carry clues only (PRD FR-25). Server code that needs a solution reads it through the puzzle manager; hints are worked out here from the stored solution (the hint manager), so a client never needs it.
- After changing a route or a request or response schema, run `bun run gen:api` to regenerate `openapi.yaml` and the client package. The gate fails while they are stale.
- Server commands run from the repo root, so Bun loads the root `.env` and relative paths in the settings resolve from there.
- Routes that need a logged-in user call `currentUser(c, sessions)` from the session cookie module and answer 401 when it is null; routes for confirmed accounts only also check `emailVerifiedAt`. Every state-changing request under `/api` goes through the CSRF check, so list a 403 response on new POST, PUT and DELETE routes. A route without a request body isn't covered by the JSON-only rule, so it relies on that check and SameSite alone.
- Routes for one player's own data name the user in the path (`/api/users/{userId}/…`) and answer 403 when it isn't the logged-in user, as the progress routes do, so a page that still shows an earlier login can't read or write another account's data.
- A table that holds a user's data references `users(id) ON DELETE CASCADE`, so deleting the account deletes it (PRD NFR-6). Published puzzles are the exception: their `creator_id` is set to null instead.
- An unpublished puzzle is 404 to players wherever it would show up (a route, a list, a hint); only admins can open it.
- Daily puzzles are stored without their seed or generator version and with a release time, and `PuzzleManager.get` hides a puzzle before its release time, so reach puzzles players may see through it. Ranked attempts and leaderboards read the `attempts` table, never saved progress.
- In a schema, write "this registered schema or null" as `z.union([Schema, z.null()])`. `.nullable()` on a schema registered with `.openapi("Name")` makes the shared component itself nullable.
- Tests: managers with fakes, repositories on in-memory SQLite, routes through `app.request`, the task runner with real threads. The Garage test skips itself when Garage isn't running. `docs/TESTING.md` has the details.
