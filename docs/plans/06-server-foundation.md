# WT6 `server-foundation` — implementation plan

Branch `feat/server-foundation`, worktree `/home/jhonnold/projects/loophole-wt/server-foundation` (based on main `bd47f75`, which includes WT5). PRD: FR-2 (wire format on the API), FR-4 (verify statuses in jobs), FR-7 (generation inputs; clues, solution and solver trace stored), FR-10 (deterministic per seed and version), FR-11 (background jobs with progress and timeout, never in the request path), FR-25 (puzzle responses never carry the solution), FR-29 (level column kept), NFR-1 (30 s verify budget inside the job limit), NFR-4 (prepared statements, input validation), NFR-6 (no personal data stored).

## Goal

The server's foundation in a new `apps/server` package, with two entrypoints over one SQLite database and one blob store:

- **API** (Hono + `@hono/zod-openapi` on `Bun.serve`): health, recent published puzzles, one puzzle's clues, queue a generation job, read a job. RFC 9457 problem responses. Serves the built SPA when `WEB_DIR` is set.
- **Worker**: polls the `jobs` table, claims atomically (`UPDATE … RETURNING`), runs `generate`/`verify` in a fresh Bun `Worker` thread with a hard `terminate()` timeout, writes throttled progress and heartbeats, stores results, recovers jobs whose worker died.
- **Layers**: entrypoints (routes, worker loop; zod validation and DTO translation) → managers (business logic over port interfaces) → adapters (SQLite repositories and queue, S3 and in-memory blob stores, thread task runner, clock). One composition root per process. Biome import rules enforce the direction.
- **Contract**: `bun run gen:api` writes the OpenAPI 3.1 document to `openapi.yaml` and generates `packages/api-client` (`openapi-typescript` + `openapi-fetch`). `bun run check` fails if they are stale.
- **Web**: the puzzle source becomes "fixtures first, then the API" through the generated client; Vite proxies `/api` in dev. Fixture ids (including `giant-100`) never touch the API.

## Follow-ups handled here

- **[WT6] `.env` and cwd**: server scripts live in the root `package.json` and run from the repo root, so Bun loads the root `.env` and relative settings resolve from the root. `.env.example` and README wording fixed (Steps 8, 9, 11; DECISIONS "Server scripts run from the repo root").
- **[WT6] keep `giant-100` reachable**: `withServer(fixtureSource, apiSource(...))` looks up fixture ids locally first; `vite preview` has no proxy, so `test:e2e` / `test:perf` never depend on a server (Step 10).
- **[WT6] throttle progress writes**: the thread posts only when the whole percent changes (≤ 90 messages per generation) and `JobRunManager` writes at most one progress row per 500 ms (Steps 5, 6; tested).
- **[WT6] synchronous generate → cancel by `Worker.terminate()`**: every task runs in a fresh thread; the timeout is `terminate()`; a test stops a 100×100 generation at 300 ms. `done === total` is not "finished": progress maps removal tests to 0–0.9 and only `done` sets 1 (Step 5; DECISIONS "Job time limits and progress").
- **[WT6] core thresholds validation + `loops.ts` doc**: Step 1.
- **[WT6] stale DECISIONS sentence (WT5 large fixtures)**: reworded to "(Written before WT3 merged.)" (Step 11).

## Out of scope

Accounts, sessions, CSRF, rate limits, Turnstile, mail (WT7); hints API (WT8, reads the trace blob); progress sync (WT9); submissions and the verify-job API (WT10; the verify job kind and thread support exist here); daily puzzles, ranked mode, leaderboards (WT11); Prometheus metrics, Dockerfile, backups (WT12); a "generate" button in the web UI; user cancel of a job (the mechanism is `terminate()`; no endpoint yet).

## How later worktrees use this

- **WT7 accounts**: add `users`/`sessions` tables as `002_*.sql`; new adapters implement new interfaces in `ports.ts` (mailer, CAPTCHA); an `AccountManager`; auth middleware in `api/app.ts`. Rate limits can wrap `POST /api/jobs/generate` too.
- **WT8 hints**: `PuzzleManager.getSolution(id)` and the trace blob (`puzzles/<id>/trace.json`, `{v:1, steps}`) feed a hint route; `core.solve(puzzle, {initial, maxSteps: 1})` per DECISIONS.
- **WT9 progress sync**: new table + repository + manager; route in `api/app.ts`.
- **WT10 submissions**: `JobManager.enqueueVerify(puzzle)` and the `verify` task already run with the 30 s budget; `JobRunManager.#store` records `{kind:"verify", status}` — WT10 extends it to publish/reject a submitted puzzle (`origin: "submitted"`) and widens the Job DTO's `result`.
- **WT11 daily**: extends the generate job payload with a purpose (daily date and size class) and `saveGenerated` with status/origin options, so pre-generated dailies are stored `unpublished` and stay out of `GET /api/puzzles` (and hints) until their release; a scheduler in the worker enqueues them. Ranked play uses the clues-only `GET /api/puzzles/{id}` and validates via `getSolution`. As written here, `saveGenerated` always publishes, which is right only for practice puzzles.
- **WT12 metrics**: counters/histograms hook into `JobRunManager.runNext` and the Hono app; the worker's loop gets an HTTP exporter.

## Design

### Packages and versions (verified with `npm view` on 2026-10-25)

| Package | Version | Where | Why this one |
|---|---|---|---|
| `hono` | 4.13.13 | server | 4.13.14 is one day old; 5.0 is RC. |
| `@hono/zod-openapi` | 1.6.3 | server | Latest; peers `zod ^4`, `hono >=4.10`. |
| `zod` | 4.6.7 | server | Latest 4.x; `@hono/zod-openapi` 1.x needs zod 4. |
| `openapi-typescript` | 7.13.0 | server (dev) | Latest. Declares peer `typescript ^5.x`; works with 6.0.3, Bun prints a peer warning on install (expected). |
| `yaml` | 2.9.1 | server (dev) | Latest; writes `openapi.yaml`. |
| `openapi-fetch` | 0.17.0 | api-client | Latest. |

Bun 1.3.13 provides `bun:sqlite`, `Bun.S3Client`, `Worker`. No other dependencies.

### Layout

```
apps/server/
  AGENTS.md, CLAUDE.md -> AGENTS.md
  package.json, tsconfig.json
  scripts/gen-api.ts             writes openapi.yaml + packages/api-client/src/schema.ts (--check compares)
  src/
    domain.ts                    domain types: PuzzleRecord, Job, Task, TaskOutcome, …
    ports.ts                     adapter interfaces managers depend on: Clock, PuzzleRepository, BlobStore, JobQueue, TaskRunner
    config.ts                    env → Config (zod), used by composition roots
    api/      (entrypoint)       app.ts (routes, errors, SPA), schemas.ts (DTOs), problem.ts, main.ts (root), spec.ts (root for the doc)
    worker/   (entrypoint)       loop.ts (poll loop), main.ts (root)
    managers/                    puzzle-manager.ts, job-manager.ts (API side), job-run-manager.ts (worker side), errors.ts
    adapters/
      clock.ts
      db/                        database.ts (open, pragmas, migrate), migrations/001_initial.sql, puzzle-repository.ts, job-queue.ts
      blob/                      memory-blob-store.ts, s3-blob-store.ts, blob-store-contract.ts (shared tests)
      tasks/                     run-task.ts (pure), task-thread.ts (thread entry), thread-task-runner.ts
    test-support/                fakes.ts, claim-thread.ts
packages/api-client/             src/index.ts (createApiClient), src/schema.ts (generated, not linted)
openapi.yaml                     generated, committed
```

Layer rules (Biome `noRestrictedImports` overrides in `biome.json`, tests exempt):

| Code in | May import | May not import |
|---|---|---|
| `managers/` | `domain.ts`, `ports.ts`, other managers, `@loophole/core` | `adapters/`, `api/`, `worker/`, `bun`, `bun:sqlite`, `hono` and `hono/*`, `@hono/*`, `zod` and `zod/*`, `node:*` |
| `api/`, `worker/` (not `main.ts`/`spec.ts`) | managers, domain, zod/Hono | `adapters/`, `bun:sqlite` |
| `adapters/` | `domain.ts`, `ports.ts`, core, Bun | `managers/`, `api/`, `worker/` |
| `main.ts`, `spec.ts` (composition roots), `config.ts` | everything | — |

### Data model (`001_initial.sql`)

- `puzzles`: `id` (for generated puzzles, the id of the job that made them; inserting an existing id does nothing), `width`, `height`, `clues` (wire clue string; CHECK length = w·h), `seed`, `generator_version`, `level` (default 1, FR-29), `origin` (`generated`|`submitted`), `status` (`published`|`unpublished`), `solution_key`, `trace_key` (nullable), `created_at` (ms). STRICT. Index `(status, created_at)`.
- `jobs`: `id`, `kind` (text, validated in code so new kinds need no table rebuild), `payload` (JSON), `status` (`queued`|`running`|`done`|`failed`|`timeout`), `progress` (0–1), `result` (JSON), `error`, `attempts`, `claimed_by`, `created_at`, `started_at`, `heartbeat_at`, `finished_at`. STRICT. Index `(status, created_at)`.
- `schema_migrations(version, name, applied_at)`: written by the runner.
- Blobs: `puzzles/<id>/solution.txt` (edge-state string, `text/plain`) and `puzzles/<id>/trace.json` (`{"v":1,"steps":[…]}`; 13 KB at 10×10, 1.3 MB at 100×100). Written before the row.

### Job lifecycle

1. `POST /api/jobs/generate` → `JobManager.enqueueGenerate` (random UUID seed if none; 503 when 100 are queued) → row `queued` → 202 + `Location`.
2. Worker loop: `JobRunManager.runNext(workerId)` → `claimNext` (oldest queued; `running`, `attempts+1`, `heartbeat_at=now`).
3. `ThreadTaskRunner.run(task, {timeoutMs, onProgress})` → fresh `Worker` → `runTask` (core `generate` with seed / `verify` with default 30 s budget) → messages `progress` | `done` | `failed`; `setTimeout` → `terminate()` → `timeout`.
4. While running: heartbeat every 5 s; progress rows at most every 500 ms (also heartbeats).
5. `done` (generate) → `PuzzleManager.saveGenerated(job.id, …)` (blobs then row, published; idempotent, so a job run twice stores one puzzle) → `finish(done, {kind:"generate", puzzleId: job.id})`. Timeouts → `timeout`; errors (including blob failures) → `failed`. No retry for either. Every update is conditional on `status='running' AND claimed_by=me`.
6. Idle loop: `recoverStale` → running jobs silent for 30 s go back to `queued` (or `failed` after 3 claims). Any error in an iteration (e.g. the database busy past 5 s) is logged and the loop continues after its poll wait; a failed heartbeat is logged and skipped.

`openDatabase` sets `busy_timeout` first and retries the WAL switch on "database is locked" (up to 50 × 20 ms), so the API and the worker can start together on a new file.

Limits: generate 60 s (`GENERATE_TIMEOUT_MS`), verify 45 s (`VERIFY_TIMEOUT_MS`). Poll 500 ms. Measured in the prototype: 10×10 job done in ~50 ms after claim; 100×100 in ~14 s with progress 0.11 → 0.87 → 1.

### API

| Method + path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/health` | — | 200 `{status:"ok"}` | — |
| `GET /api/puzzles?limit=` | `limit` 1–100, default 20 | 200 `{items:[{id,width,height,origin,createdAt}]}` newest first | 400 |
| `GET /api/puzzles/{id}` | id 1–64 chars | 200 `{id, puzzle: PuzzleWireV1, origin, createdAt}` (no solution) | 400, 404 (unknown or unpublished) |
| `POST /api/jobs/generate` | `{width 1–100, height 1–100, seed? 1–128 chars}`, strict, JSON | 202 Job, `Location: /api/jobs/<id>` | 400, 413, 415, 503 |
| `GET /api/jobs/{id}` | id 1–64 chars | 200 `{id, kind, status, progress, result: {puzzleId}|null, error, createdAt, startedAt, finishedAt}` | 400, 404 |
| anything else under `/api` | | | 404 |

Errors: `application/problem+json` `{type:"about:blank", title, status, detail?, errors?:[{path,message}]}`. Validation failures (zod `defaultHook`) list each field; malformed JSON is a 400 and a non-JSON content type a 415, both via `HTTPException`; unexpected errors are logged and returned as a bare 500 problem. Bodies under `/api` are capped at 64 KiB by Hono's `bodyLimit` (413 problem); `Bun.serve` caps every body at 1 MiB (`maxRequestBodySize`).

### Web

- `apps/web/src/lib/puzzles/api.ts`: `apiSource(client)` — list → `GET /api/puzzles?limit=20` mapped to summaries named "Generated"; get → `GET /api/puzzles/{id}`, 404 → null, other failures throw, body parsed with core's `parsePuzzle`.
- `combined.ts`: `withServer(local, server)` — list = local + server (server failure → warn, local only); get = local, else server.
- `index.ts`: `puzzleSource = withServer(fixtureSource, apiSource(createApiClient()))`.
- `vite.config.ts`: `server.proxy["/api"] = http://localhost:3000`; `preview.proxy = {}`.
- Screens, `fixtures.ts` and `large-fixtures.ts` are untouched.

## Environment notes for the implementer

- Run every command from the worktree root with `export PATH="$HOME/.bun/bin:$PATH";` first. Use absolute paths; the shell's working directory resets between calls.
- Create directories before writing files into them (`mkdir -p`). Git does not track empty folders.
- Bun installs packages per workspace (`apps/server/node_modules/…`), not in a root `node_modules`. That is normal.
- `bun install` warns `incorrect peer dependency "typescript@6.0.3"` for `openapi-typescript`. Expected; ignore.
- bun:sqlite binds `{ id }`-style parameters to `$id` placeholders only when the database is opened with `strict: true` (`openDatabase` does). Row types passed as statement parameters must be `type` aliases, not `interface`s, or `tsc` rejects them (comment in the file).
- Copy every file below exactly, including comments. After writing `.ts` files, `bun run format` may reorder imports; that's fine, but the files below are already formatted.
- `.env.example` may only be readable with the Read tool (a shell `cat` of `.env*` files can be denied). Write it with the Write tool.
- Do not stop processes with `pkill -f <pattern>`: the pattern also matches your own shell's command line. Stop servers with Ctrl-C equivalents: `kill <pid>` using pids from `ps -eo pid,args | grep '[b]un '`.
- `bun --watch` keeps a process alive after its main module finishes, so a `dev:worker` stopped with SIGTERM prints "stopped" but lingers; kill it by pid. `bun apps/server/src/worker/main.ts` (no watch) exits cleanly.
- Docker Compose's project name is `loophole` for every checkout; nothing else should be running it. Stop it with `docker compose down` (no `-v`) when done.
- `bun run check` takes about 15 s. It must pass after every step.

## Steps

Each step lists files to create (full contents) and edits to existing files (replace the old text with the new; each old text occurs exactly once). Then run the commands, then `bun run check`, then commit with the given message (conventional commits; `git add -A`).

### Step 1 — Core: validate each threshold by name; reword the test loop helper's doc

#### Edit `packages/core/src/generate.ts`

Replace:

```
  for (const [name, share] of Object.entries(thresholds)) {
    if (!(share >= 0 && share <= 1)) {
```

with:

```
  // Each field by name, so a partial object (say, parsed JSON) fails here too.
  for (const name of ["minCoverage", "minSpan"] as const) {
    const share = thresholds[name];
    if (!(share >= 0 && share <= 1)) {
```

#### Edit `packages/core/src/generate.test.ts`

Replace:

```
      { width: 5, height: 5, seed: "s", thresholds: { minCoverage: 0.4, minSpan: Number.NaN } },
```

with:

```
      { width: 5, height: 5, seed: "s", thresholds: { minCoverage: 0.4, minSpan: Number.NaN } },
      { width: 5, height: 5, seed: "s", thresholds: { minCoverage: 0.4 } as LoopThresholds },
```

#### Edit `packages/core/src/test-support/loops.ts`

Replace:

```
 * the real loop generator is WT3's.
```

with:

```
 * puzzles use `generateLoop` (loop.ts).
```

#### Verify

```sh
bun test packages/core/src/generate.test.ts   # passes; the new partial-thresholds case throws RangeError
bun run check
```

#### Commit

```sh
git add -A && git commit -m "fix(core): validate each generator threshold by name"
```

### Step 2 — Server package, domain types, adapter interfaces and the layering lint

Create the folders first: `mkdir -p apps/server/src/adapters`.

#### Create `apps/server/package.json`

```json
{
  "name": "@loophole/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p ."
  },
  "dependencies": {
    "@hono/zod-openapi": "1.6.3",
    "@loophole/core": "workspace:*",
    "hono": "4.13.13",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "openapi-typescript": "7.13.0",
    "yaml": "2.9.1"
  }
}
```

#### Create `apps/server/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "scripts"]
}
```

#### Replace the whole of `biome.json` with

```json
{
  "$schema": "https://biomejs.dev/schemas/2.6.3/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": true,
    "includes": ["**", "!docs/design", "!**/*.md", "!packages/api-client/src/schema.ts"]
  },
  "formatter": {
    "indentStyle": "space",
    "lineWidth": 100
  },
  "html": {
    "experimentalFullSupportEnabled": true
  },
  "overrides": [
    {
      "includes": ["apps/server/src/managers/**", "!**/*.test.ts"],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedImports": {
              "level": "error",
              "options": {
                "paths": {
                  "bun:sqlite": "Managers reach the database through the interfaces in ports.ts.",
                  "bun": "Managers reach I/O through the interfaces in ports.ts.",
                  "hono": "Managers know nothing of HTTP; routes in api/ translate for them.",
                  "@hono/zod-openapi": "Managers know nothing of HTTP; routes in api/ translate for them.",
                  "zod": "Input is validated at the entrypoints, before it reaches a manager."
                },
                "patterns": [
                  {
                    "group": ["**/adapters/**", "**/api/**", "**/worker/**"],
                    "message": "Managers depend only on ports.ts, domain.ts, the core package and other managers."
                  },
                  {
                    "group": ["hono/**", "@hono/**", "zod/**", "node:*"],
                    "message": "Managers know nothing of HTTP, validation libraries or I/O; use ports.ts."
                  }
                ]
              }
            }
          }
        }
      }
    },
    {
      "includes": [
        "apps/server/src/api/**",
        "apps/server/src/worker/**",
        "!apps/server/src/api/main.ts",
        "!apps/server/src/api/spec.ts",
        "!apps/server/src/worker/main.ts",
        "!**/*.test.ts"
      ],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedImports": {
              "level": "error",
              "options": {
                "paths": {
                  "bun:sqlite": "Entrypoints call managers; only the composition roots build adapters."
                },
                "patterns": [
                  {
                    "group": ["**/adapters/**"],
                    "message": "Entrypoints call managers; only the composition roots (main.ts, spec.ts) build adapters."
                  }
                ]
              }
            }
          }
        }
      }
    },
    {
      "includes": ["apps/server/src/adapters/**", "!**/*.test.ts"],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedImports": {
              "level": "error",
              "options": {
                "patterns": [
                  {
                    "group": ["**/managers/**", "**/api/**", "**/worker/**"],
                    "message": "Adapters implement ports.ts and convert data; they never call managers or entrypoints."
                  }
                ]
              }
            }
          }
        }
      }
    }
  ]
}
```

#### Create `apps/server/src/domain.ts`

```ts
import type { Puzzle, PuzzleWireV1, Step, VerifyStatus } from "@loophole/core";

/** Where a stored puzzle came from. */
export type PuzzleOrigin = "generated" | "submitted";

/** Only published puzzles are served to players. */
export type PuzzleStatus = "published" | "unpublished";

/** A stored puzzle. The solution and the solver trace live in the blob store, not here. */
export interface PuzzleRecord {
  readonly id: string;
  /** Clues, seed and `meta.generator` (the generator version), as the core models them. */
  readonly puzzle: Puzzle;
  readonly origin: PuzzleOrigin;
  readonly status: PuzzleStatus;
  /** Difficulty level. Every puzzle is level 1 until levels exist (PRD FR-29). */
  readonly level: number;
  /** Blob key of the solution, in the wire format's edge-state encoding. */
  readonly solutionKey: string;
  /** Blob key of the solver's step log (JSON), when there is one. */
  readonly traceKey: string | null;
  /** Milliseconds since the epoch. */
  readonly createdAt: number;
}

export type JobKind = "generate" | "verify";

export type JobStatus = "queued" | "running" | "done" | "failed" | "timeout";

export interface GenerateInput {
  readonly width: number;
  readonly height: number;
  readonly seed: string;
}

export interface VerifyInput {
  readonly puzzle: PuzzleWireV1;
}

/** What a finished job produced. */
export type JobResult =
  | { readonly kind: "generate"; readonly puzzleId: string }
  | { readonly kind: "verify"; readonly status: VerifyStatus };

interface JobBase {
  readonly id: string;
  readonly status: JobStatus;
  /** From 0 to 1. */
  readonly progress: number;
  readonly result: JobResult | null;
  readonly error: string | null;
  /** Times the job has been claimed by a worker. */
  readonly attempts: number;
  readonly claimedBy: string | null;
  /** Milliseconds since the epoch, like every time below. */
  readonly createdAt: number;
  readonly startedAt: number | null;
  readonly heartbeatAt: number | null;
  readonly finishedAt: number | null;
}

export type Job =
  | (JobBase & { readonly kind: "generate"; readonly input: GenerateInput })
  | (JobBase & { readonly kind: "verify"; readonly input: VerifyInput });

/** The input of a new job. */
export type JobInput =
  | { readonly kind: "generate"; readonly input: GenerateInput }
  | { readonly kind: "verify"; readonly input: VerifyInput };

/** Work run off the main thread, with a hard time limit. */
export type Task = JobInput;

export interface GeneratedPuzzle {
  /** Has `seed` and `meta.generator`. */
  readonly puzzle: PuzzleWireV1;
  /** The only solution, in edge-state encoding. */
  readonly solution: string;
  /** The solver's steps from an empty board, for hints. */
  readonly steps: readonly Step[];
}

export interface VerifyOutcome {
  readonly status: VerifyStatus;
  /** Solutions found, in edge-state encoding. */
  readonly solutions: readonly string[];
}

export type TaskOutput =
  | { readonly kind: "generate"; readonly generated: GeneratedPuzzle }
  | { readonly kind: "verify"; readonly verified: VerifyOutcome };

/** How a task ended. `timeout` means the thread was stopped at the time limit. */
export type TaskOutcome =
  | { readonly status: "done"; readonly output: TaskOutput }
  | { readonly status: "failed"; readonly error: string }
  | { readonly status: "timeout" };
```

#### Create `apps/server/src/ports.ts`

```ts
import type {
  Job,
  JobInput,
  JobResult,
  JobStatus,
  PuzzleRecord,
  Task,
  TaskOutcome,
} from "./domain.ts";

/**
 * The interfaces managers depend on. Adapters implement them; the composition roots
 * (`api/main.ts`, `worker/main.ts`) pick the implementations.
 */

export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
}

export interface PuzzleRepository {
  /** Stores a new puzzle. Does nothing when a puzzle with this id already exists. */
  insert(record: PuzzleRecord): void;
  get(id: string): PuzzleRecord | null;
  /** Published puzzles, newest first. */
  listPublished(limit: number): PuzzleRecord[];
}

/** Text blobs by key, such as solutions and solver traces. */
export interface BlobStore {
  put(key: string, body: string, contentType: string): Promise<void>;
  /** Resolves to null when there is no blob under `key`. */
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

export interface NewJob {
  readonly id: string;
  readonly job: JobInput;
  readonly createdAt: number;
}

/**
 * The jobs table. Updates to a running job name the worker that claimed it and do nothing when
 * another worker holds the job or it is no longer running.
 */
export interface JobQueue {
  enqueue(job: NewJob): Job;
  get(id: string): Job | null;
  countQueued(): number;
  /** Atomically takes the oldest queued job for `workerId`, or returns null when there is none. */
  claimNext(workerId: string, now: number): Job | null;
  /** Stores progress (0 to 1); also counts as a heartbeat. */
  setProgress(id: string, workerId: string, progress: number, now: number): void;
  heartbeat(id: string, workerId: string, now: number): void;
  /** Ends a running job. Returns false when the worker no longer holds it. */
  finish(id: string, workerId: string, end: JobEnd, now: number): boolean;
  /**
   * Running jobs whose last heartbeat is before `staleBefore` go back to the queue, or fail once
   * they have been claimed `maxAttempts` times. Returns how many jobs it changed.
   */
  recoverStale(staleBefore: number, maxAttempts: number, now: number): number;
}

export type JobEnd =
  | { readonly status: "done"; readonly result: JobResult }
  | { readonly status: Exclude<JobStatus, "queued" | "running" | "done">; readonly error: string };

export interface TaskRunOptions {
  /** The task is stopped and reported as `timeout` after this long. */
  readonly timeoutMs: number;
  /** Called with progress from 0 to 1, at most about once per percent. */
  readonly onProgress: (progress: number) => void;
}

/** Runs CPU-heavy tasks (generation, verification) off the caller's thread. */
export interface TaskRunner {
  run(task: Task, options: TaskRunOptions): Promise<TaskOutcome>;
}
```

#### Create `apps/server/src/adapters/clock.ts`

```ts
import type { Clock } from "../ports.ts";

export const systemClock: Clock = { now: () => Date.now() };
```

#### Edit `.gitignore`

Replace:

```
playwright-report/
```

with:

```
playwright-report/
/data/
```

#### Run

```sh
bun install
```

#### Verify

```sh
bun run check   # @loophole/server typecheck: Exited with code 0
```

#### Commit

```sh
git add -A && git commit -m "build(server): add the server package with domain types, ports and layering rules"
```

### Step 3 — SQLite: database, migrations, puzzle repository, job queue

#### Create `apps/server/src/adapters/db/migrations/001_initial.sql`

```sql
-- Puzzles: clues inline; the solution and the solver trace are blobs (keys below).
CREATE TABLE puzzles (
  id TEXT PRIMARY KEY,
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 100),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 100),
  clues TEXT NOT NULL CHECK (length(clues) = width * height),
  seed TEXT,
  generator_version TEXT,
  level INTEGER NOT NULL DEFAULT 1,
  origin TEXT NOT NULL CHECK (origin IN ('generated', 'submitted')),
  status TEXT NOT NULL CHECK (status IN ('published', 'unpublished')),
  solution_key TEXT NOT NULL,
  trace_key TEXT,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX puzzles_by_status_created ON puzzles (status, created_at);

-- Background jobs. Times are milliseconds since the epoch.
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'timeout')),
  progress REAL NOT NULL DEFAULT 0,
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_by TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  heartbeat_at INTEGER,
  finished_at INTEGER
) STRICT;

CREATE INDEX jobs_by_status_created ON jobs (status, created_at);
```

#### Create `apps/server/src/adapters/db/database.ts`

```ts
import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

/**
 * Opens (creating if needed) the SQLite database at `path`, or an in-memory one for ":memory:",
 * and applies any pending migrations.
 */
export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA busy_timeout = 5000");
  enableWal(db);
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

/**
 * Switches to write-ahead logging. The switch needs an exclusive lock and SQLite does not wait
 * for it (no busy handler), so when several processes open a new file at once some get "database
 * is locked": retry those for up to about a second.
 */
function enableWal(db: Database): void {
  for (let attempt = 1; ; attempt++) {
    try {
      db.run("PRAGMA journal_mode = WAL");
      return;
    } catch (err) {
      const locked = err instanceof Error && err.message.includes("database is locked");
      if (!locked || attempt >= 50) throw err;
      Bun.sleepSync(20);
    }
  }
}

/**
 * Applies the numbered `.sql` files in `migrations/` that have not run yet, in order, each in its
 * own transaction. Safe when several processes start at once: the check runs under a write lock.
 */
export function migrate(db: Database, dir = MIGRATIONS_DIR): void {
  db.run(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT",
  );
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  const applied = db.query<{ version: number }, []>("SELECT version FROM schema_migrations");
  const record = db.query(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES ($version, $name, $now)",
  );
  for (const file of files) {
    const version = Number.parseInt(file, 10);
    db.transaction(() => {
      if (applied.all().some((row) => row.version === version)) return;
      db.run(readFileSync(join(dir, file), "utf8"));
      record.run({ version, name: file, now: Date.now() });
    }).immediate();
  }
}
```

#### Create `apps/server/src/test-support/open-thread.ts`

```ts
// A thread for the concurrent-open test: opens the database at the path it is sent and answers
// with its journal mode, or with the error message if opening failed.
import { openDatabase } from "../adapters/db/database.ts";

declare const self: Worker;

self.onmessage = (event: MessageEvent<string>) => {
  try {
    const db = openDatabase(event.data);
    const row = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
    db.close();
    self.postMessage(row?.journal_mode ?? "none");
  } catch (err) {
    self.postMessage(`error: ${err instanceof Error ? err.message : String(err)}`);
  }
};
```

#### Create `apps/server/src/adapters/db/database.test.ts`

```ts
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, openDatabase } from "./database.ts";

describe("openDatabase and migrate", () => {
  test("creates the tables and records each migration once", () => {
    const db = openDatabase(":memory:");
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    expect(tables).toEqual(["jobs", "puzzles", "schema_migrations"]);
    migrate(db);
    const versions = db
      .query<{ version: number }, []>("SELECT version FROM schema_migrations")
      .all();
    expect(versions).toEqual([{ version: 1 }]);
  });

  test("applies new numbered files in numeric order and skips applied ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "loophole-migrations-"));
    try {
      writeFileSync(join(dir, "2_second.sql"), "INSERT INTO t (v) VALUES ('second');");
      writeFileSync(join(dir, "10_third.sql"), "INSERT INTO t (v) VALUES ('third');");
      writeFileSync(
        join(dir, "1_first.sql"),
        "CREATE TABLE t (v TEXT); INSERT INTO t (v) VALUES ('first');",
      );
      writeFileSync(join(dir, "notes.txt"), "not a migration");
      const db = new Database(":memory:", { strict: true });
      migrate(db, dir);
      migrate(db, dir);
      const rows = db.query<{ v: string }, []>("SELECT v FROM t ORDER BY rowid").all();
      expect(rows.map((r) => r.v)).toEqual(["first", "second", "third"]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("a file database uses write-ahead logging", () => {
    const dir = mkdtempSync(join(tmpdir(), "loophole-db-"));
    try {
      const db = openDatabase(join(dir, "nested", "test.sqlite"));
      const mode = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
      expect(mode?.journal_mode).toBe("wal");
      db.close();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("several connections opening a new file at once all succeed in WAL mode", async () => {
    const url = new URL("../../test-support/open-thread.ts", import.meta.url).href;
    for (let trial = 0; trial < 5; trial++) {
      const dir = mkdtempSync(join(tmpdir(), "loophole-open-"));
      const threads = Array.from({ length: 4 }, () => new Worker(url));
      try {
        const path = join(dir, "new.sqlite");
        const modes = await Promise.all(
          threads.map(
            (thread) =>
              new Promise<string>((resolve) => {
                thread.onmessage = (event: MessageEvent<string>) => resolve(event.data);
                thread.postMessage(path);
              }),
          ),
        );
        expect(modes).toEqual(["wal", "wal", "wal", "wal"]);
      } finally {
        for (const thread of threads) thread.terminate();
        rmSync(dir, { recursive: true });
      }
    }
  });
});
```

#### Create `apps/server/src/adapters/db/puzzle-repository.ts`

```ts
import type { Database } from "bun:sqlite";
import { type PuzzleWireV1, parsePuzzle, serializePuzzle } from "@loophole/core";
import type { PuzzleOrigin, PuzzleRecord, PuzzleStatus } from "../../domain.ts";
import type { PuzzleRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type PuzzleRow = {
  id: string;
  width: number;
  height: number;
  clues: string;
  seed: string | null;
  generator_version: string | null;
  level: number;
  origin: PuzzleOrigin;
  status: PuzzleStatus;
  solution_key: string;
  trace_key: string | null;
  created_at: number;
};

const COLUMNS =
  "id, width, height, clues, seed, generator_version, level, origin, status, solution_key, trace_key, created_at";

/** Puzzles in SQLite. Clues are stored as the wire format's clue string; only `meta.generator` is kept. */
export class SqlitePuzzleRepository implements PuzzleRepository {
  readonly #insert;
  readonly #get;
  readonly #listPublished;

  constructor(db: Database) {
    this.#insert = db.query<void, PuzzleRow>(
      `INSERT INTO puzzles (${COLUMNS}) VALUES ($id, $width, $height, $clues, $seed, $generator_version, $level, $origin, $status, $solution_key, $trace_key, $created_at) ON CONFLICT (id) DO NOTHING`,
    );
    this.#get = db.query<PuzzleRow, { id: string }>(
      `SELECT ${COLUMNS} FROM puzzles WHERE id = $id`,
    );
    this.#listPublished = db.query<PuzzleRow, { limit: number }>(
      `SELECT ${COLUMNS} FROM puzzles WHERE status = 'published' ORDER BY created_at DESC, id LIMIT $limit`,
    );
  }

  insert(record: PuzzleRecord): void {
    this.#insert.run(toRow(record));
  }

  get(id: string): PuzzleRecord | null {
    const row = this.#get.get({ id });
    return row === null ? null : fromRow(row);
  }

  listPublished(limit: number): PuzzleRecord[] {
    return this.#listPublished.all({ limit }).map(fromRow);
  }
}

function toRow(r: PuzzleRecord): PuzzleRow {
  const wire = serializePuzzle(r.puzzle);
  return {
    id: r.id,
    width: wire.width,
    height: wire.height,
    clues: wire.clues,
    seed: wire.seed ?? null,
    generator_version: wire.meta?.generator ?? null,
    level: r.level,
    origin: r.origin,
    status: r.status,
    solution_key: r.solutionKey,
    trace_key: r.traceKey,
    created_at: r.createdAt,
  };
}

function fromRow(row: PuzzleRow): PuzzleRecord {
  const wire: PuzzleWireV1 = { v: 1, width: row.width, height: row.height, clues: row.clues };
  if (row.seed !== null) wire.seed = row.seed;
  if (row.generator_version !== null) wire.meta = { generator: row.generator_version };
  return {
    id: row.id,
    puzzle: parsePuzzle(wire),
    origin: row.origin,
    status: row.status,
    level: row.level,
    solutionKey: row.solution_key,
    traceKey: row.trace_key,
    createdAt: row.created_at,
  };
}
```

#### Create `apps/server/src/adapters/db/puzzle-repository.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import type { PuzzleRecord } from "../../domain.ts";
import { openDatabase } from "./database.ts";
import { SqlitePuzzleRepository } from "./puzzle-repository.ts";

function record(id: string, createdAt: number, status: PuzzleRecord["status"] = "published") {
  const puzzle = createPuzzle(2, 2, [2, 2, 2, -1], {
    seed: `seed-${id}`,
    meta: { generator: "1" },
  });
  const r: PuzzleRecord = {
    id,
    puzzle,
    origin: "generated",
    status,
    level: 1,
    solutionKey: `puzzles/${id}/solution.txt`,
    traceKey: `puzzles/${id}/trace.json`,
    createdAt,
  };
  return r;
}

describe("SqlitePuzzleRepository", () => {
  test("get returns what insert stored, and null for an unknown id", () => {
    const repo = new SqlitePuzzleRepository(openDatabase(":memory:"));
    const r = record("a", 1000);
    repo.insert(r);
    const got = repo.get("a");
    expect(got).not.toBeNull();
    expect(serializePuzzle(got?.puzzle ?? r.puzzle)).toEqual({
      v: 1,
      width: 2,
      height: 2,
      clues: "222.",
      seed: "seed-a",
      meta: { generator: "1" },
    });
    expect({ ...got, puzzle: null }).toEqual({ ...r, puzzle: null });
    expect(repo.get("nope")).toBeNull();
  });

  test("a puzzle without seed or generator round-trips", () => {
    const repo = new SqlitePuzzleRepository(openDatabase(":memory:"));
    repo.insert({ ...record("b", 1), puzzle: createPuzzle(1, 1, [0]), traceKey: null });
    const got = repo.get("b");
    expect(got && serializePuzzle(got.puzzle)).toEqual({ v: 1, width: 1, height: 1, clues: "0" });
    expect(got?.traceKey).toBeNull();
  });

  test("listPublished is newest first, skips unpublished and honours the limit", () => {
    const repo = new SqlitePuzzleRepository(openDatabase(":memory:"));
    repo.insert(record("old", 1));
    repo.insert(record("hidden", 2, "unpublished"));
    repo.insert(record("new", 3));
    repo.insert(record("mid", 2));
    expect(repo.listPublished(10).map((r) => r.id)).toEqual(["new", "mid", "old"]);
    expect(repo.listPublished(2).map((r) => r.id)).toEqual(["new", "mid"]);
  });

  test("inserting an existing id keeps the first puzzle", () => {
    const repo = new SqlitePuzzleRepository(openDatabase(":memory:"));
    repo.insert(record("a", 1));
    repo.insert(record("a", 2));
    expect(repo.get("a")?.createdAt).toBe(1);
  });
});
```

#### Create `apps/server/src/adapters/db/job-queue.ts`

```ts
import type { Database } from "bun:sqlite";
import type { Job, JobResult, JobStatus } from "../../domain.ts";
import type { JobEnd, JobQueue, NewJob } from "../../ports.ts";

interface JobRow {
  id: string;
  kind: string;
  payload: string;
  status: JobStatus;
  progress: number;
  result: string | null;
  error: string | null;
  attempts: number;
  claimed_by: string | null;
  created_at: number;
  started_at: number | null;
  heartbeat_at: number | null;
  finished_at: number | null;
}

/**
 * The jobs table as a queue. `claimNext` is one `UPDATE … RETURNING` statement, so two workers
 * (in any processes) can never claim the same job.
 */
export class SqliteJobQueue implements JobQueue {
  readonly #insert;
  readonly #get;
  readonly #countQueued;
  readonly #claim;
  readonly #progress;
  readonly #heartbeat;
  readonly #finish;
  readonly #requeueStale;
  readonly #failStale;

  constructor(db: Database) {
    this.#insert = db.query<JobRow, { id: string; kind: string; payload: string; now: number }>(
      "INSERT INTO jobs (id, kind, payload, status, created_at) VALUES ($id, $kind, $payload, 'queued', $now) RETURNING *",
    );
    this.#get = db.query<JobRow, { id: string }>("SELECT * FROM jobs WHERE id = $id");
    this.#countQueued = db.query<{ n: number }, []>(
      "SELECT count(*) AS n FROM jobs WHERE status = 'queued'",
    );
    this.#claim = db.query<JobRow, { worker: string; now: number }>(
      `UPDATE jobs
       SET status = 'running', claimed_by = $worker, attempts = attempts + 1,
           started_at = $now, heartbeat_at = $now, progress = 0
       WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1)
         AND status = 'queued'
       RETURNING *`,
    );
    this.#progress = db.query<void, { id: string; worker: string; progress: number; now: number }>(
      "UPDATE jobs SET progress = $progress, heartbeat_at = $now WHERE id = $id AND status = 'running' AND claimed_by = $worker",
    );
    this.#heartbeat = db.query<void, { id: string; worker: string; now: number }>(
      "UPDATE jobs SET heartbeat_at = $now WHERE id = $id AND status = 'running' AND claimed_by = $worker",
    );
    this.#finish = db.query<
      { id: string },
      {
        id: string;
        worker: string;
        status: JobStatus;
        result: string | null;
        error: string | null;
        now: number;
      }
    >(
      `UPDATE jobs
       SET status = $status, result = $result, error = $error, finished_at = $now,
           progress = CASE WHEN $status = 'done' THEN 1 ELSE progress END
       WHERE id = $id AND status = 'running' AND claimed_by = $worker
       RETURNING id`,
    );
    this.#requeueStale = db.query<void, { before: number; max: number }>(
      `UPDATE jobs SET status = 'queued', claimed_by = NULL, progress = 0
       WHERE status = 'running' AND heartbeat_at < $before AND attempts < $max`,
    );
    this.#failStale = db.query<void, { before: number; max: number; now: number }>(
      `UPDATE jobs SET status = 'failed', error = 'The worker running this job stopped responding.', finished_at = $now
       WHERE status = 'running' AND heartbeat_at < $before AND attempts >= $max`,
    );
  }

  enqueue({ id, job, createdAt }: NewJob): Job {
    const row = this.#insert.get({
      id,
      kind: job.kind,
      payload: JSON.stringify(job.input),
      now: createdAt,
    });
    if (row === null) throw new Error("insert returned no row");
    return fromRow(row);
  }

  get(id: string): Job | null {
    const row = this.#get.get({ id });
    return row === null ? null : fromRow(row);
  }

  countQueued(): number {
    return this.#countQueued.get()?.n ?? 0;
  }

  claimNext(workerId: string, now: number): Job | null {
    const row = this.#claim.get({ worker: workerId, now });
    return row === null ? null : fromRow(row);
  }

  setProgress(id: string, workerId: string, progress: number, now: number): void {
    this.#progress.run({ id, worker: workerId, progress, now });
  }

  heartbeat(id: string, workerId: string, now: number): void {
    this.#heartbeat.run({ id, worker: workerId, now });
  }

  finish(id: string, workerId: string, end: JobEnd, now: number): boolean {
    const done = end.status === "done";
    const row = this.#finish.get({
      id,
      worker: workerId,
      status: end.status,
      result: done ? JSON.stringify(end.result) : null,
      error: done ? null : end.error,
      now,
    });
    return row !== null;
  }

  recoverStale(staleBefore: number, maxAttempts: number, now: number): number {
    const failed = this.#failStale.run({ before: staleBefore, max: maxAttempts, now }).changes;
    const requeued = this.#requeueStale.run({ before: staleBefore, max: maxAttempts }).changes;
    return failed + requeued;
  }
}

function fromRow(row: JobRow): Job {
  const base = {
    id: row.id,
    status: row.status,
    progress: row.progress,
    result: row.result === null ? null : (JSON.parse(row.result) as JobResult),
    error: row.error,
    attempts: row.attempts,
    claimedBy: row.claimed_by,
    createdAt: row.created_at,
    startedAt: row.started_at,
    heartbeatAt: row.heartbeat_at,
    finishedAt: row.finished_at,
  };
  const input = JSON.parse(row.payload);
  switch (row.kind) {
    case "generate":
      return { ...base, kind: "generate", input };
    case "verify":
      return { ...base, kind: "verify", input };
    default:
      throw new Error(`job ${row.id} has unknown kind ${row.kind}`);
  }
}
```

#### Create `apps/server/src/adapters/db/job-queue.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import type { JobInput } from "../../domain.ts";
import { openDatabase } from "./database.ts";
import { SqliteJobQueue } from "./job-queue.ts";

const generate = (seed: string): JobInput => ({
  kind: "generate",
  input: { width: 5, height: 5, seed },
});

function queueWith(...seeds: string[]) {
  const queue = new SqliteJobQueue(openDatabase(":memory:"));
  seeds.forEach((seed, i) => {
    queue.enqueue({ id: seed, job: generate(seed), createdAt: 100 + i });
  });
  return queue;
}

describe("SqliteJobQueue", () => {
  test("enqueue stores a queued job with its input", () => {
    const queue = queueWith();
    const job = queue.enqueue({ id: "j1", job: generate("s"), createdAt: 5 });
    expect(job).toEqual({
      id: "j1",
      kind: "generate",
      input: { width: 5, height: 5, seed: "s" },
      status: "queued",
      progress: 0,
      result: null,
      error: null,
      attempts: 0,
      claimedBy: null,
      createdAt: 5,
      startedAt: null,
      heartbeatAt: null,
      finishedAt: null,
    });
    expect(queue.get("j1")).toEqual(job);
    expect(queue.get("nope")).toBeNull();
    expect(queue.countQueued()).toBe(1);
  });

  test("claimNext takes the oldest queued job once, then returns null", () => {
    const queue = queueWith("a", "b");
    const first = queue.claimNext("w1", 1000);
    expect(first).toMatchObject({
      id: "a",
      status: "running",
      claimedBy: "w1",
      attempts: 1,
      startedAt: 1000,
      heartbeatAt: 1000,
    });
    expect(queue.claimNext("w2", 1001)?.id).toBe("b");
    expect(queue.claimNext("w1", 1002)).toBeNull();
    expect(queue.countQueued()).toBe(0);
  });

  test("progress, heartbeat and finish apply only for the claiming worker", () => {
    const queue = queueWith("a");
    queue.claimNext("w1", 1000);
    queue.setProgress("a", "w2", 0.9, 1500);
    queue.heartbeat("a", "w2", 1500);
    expect(queue.get("a")).toMatchObject({ progress: 0, heartbeatAt: 1000 });
    queue.setProgress("a", "w1", 0.5, 2000);
    expect(queue.get("a")).toMatchObject({ progress: 0.5, heartbeatAt: 2000 });
    queue.heartbeat("a", "w1", 2500);
    expect(queue.get("a")?.heartbeatAt).toBe(2500);
    const result = { kind: "generate", puzzleId: "p1" } as const;
    expect(queue.finish("a", "w2", { status: "done", result }, 3000)).toBe(false);
    expect(queue.finish("a", "w1", { status: "done", result }, 3000)).toBe(true);
    expect(queue.get("a")).toMatchObject({
      status: "done",
      progress: 1,
      result,
      error: null,
      finishedAt: 3000,
    });
    expect(queue.finish("a", "w1", { status: "failed", error: "late" }, 4000)).toBe(false);
  });

  test("finish records failures and timeouts with their message and last progress", () => {
    const queue = queueWith("a", "b");
    queue.claimNext("w", 1);
    queue.claimNext("w", 1);
    queue.setProgress("b", "w", 0.3, 2);
    queue.finish("a", "w", { status: "failed", error: "boom" }, 2);
    queue.finish("b", "w", { status: "timeout", error: "too slow" }, 3);
    expect(queue.get("a")).toMatchObject({ status: "failed", error: "boom", result: null });
    expect(queue.get("b")).toMatchObject({
      status: "timeout",
      error: "too slow",
      progress: 0.3,
      finishedAt: 3,
    });
  });

  test("recoverStale requeues silent jobs, and fails them after the last attempt", () => {
    const queue = queueWith("a", "b");
    queue.claimNext("w1", 1000);
    queue.claimNext("w1", 1000);
    queue.heartbeat("b", "w1", 5000);
    // "a" went silent at 1000; "b" is still beating.
    expect(queue.recoverStale(2000, 2, 6000)).toBe(1);
    expect(queue.get("a")).toMatchObject({ status: "queued", claimedBy: null, attempts: 1 });
    expect(queue.get("b")?.status).toBe("running");
    // The old worker can no longer report on "a".
    expect(queue.finish("a", "w1", { status: "failed", error: "x" }, 6000)).toBe(false);
    // Second attempt goes silent too: with maxAttempts 2 it fails for good.
    expect(queue.claimNext("w2", 7000)?.id).toBe("a");
    expect(queue.recoverStale(8000, 2, 9000)).toBe(2);
    expect(queue.get("a")).toMatchObject({ status: "failed", attempts: 2, finishedAt: 9000 });
    expect(queue.get("a")?.error).toContain("stopped responding");
    expect(queue.get("b")?.status).toBe("queued");
  });
});
```

#### Create `apps/server/src/test-support/claim-thread.ts`

```ts
// A thread for the claim race test. On "open" it connects to the shared database file and
// answers "ready"; on "go" it claims jobs until none are left and posts the ids it got.
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";

declare const self: Worker;

export type ClaimThreadMessage =
  | { readonly type: "open"; readonly path: string; readonly worker: string }
  | { readonly type: "go" };

let queue: SqliteJobQueue | null = null;
let worker = "";

self.onmessage = (event: MessageEvent<ClaimThreadMessage>) => {
  const message = event.data;
  if (message.type === "open") {
    queue = new SqliteJobQueue(openDatabase(message.path));
    worker = message.worker;
    self.postMessage("ready");
    return;
  }
  if (queue === null) throw new Error("go before open");
  const ids: string[] = [];
  for (let job = queue.claimNext(worker, 0); job !== null; job = queue.claimNext(worker, 0)) {
    ids.push(job.id);
  }
  self.postMessage(ids);
};
```

#### Create `apps/server/src/adapters/db/claim-race.test.ts`

```ts
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaimThreadMessage } from "../../test-support/claim-thread.ts";
import { openDatabase } from "./database.ts";
import { SqliteJobQueue } from "./job-queue.ts";

const THREADS = 4;
const JOBS = 2000;
const THREAD_URL = new URL("../../test-support/claim-thread.ts", import.meta.url).href;

/** Sends `message` and resolves with the thread's next reply. */
function ask<T>(thread: Worker, message: ClaimThreadMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    thread.onmessage = (event: MessageEvent<T>) => resolve(event.data);
    thread.onerror = (event) => reject(new Error(event.message));
    thread.postMessage(message);
  });
}

test("workers on separate connections never claim the same job", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loophole-claim-"));
  const threads = Array.from({ length: THREADS }, () => new Worker(THREAD_URL));
  try {
    const path = join(dir, "jobs.sqlite");
    const db = openDatabase(path);
    const queue = new SqliteJobQueue(db);
    db.transaction(() => {
      for (let i = 0; i < JOBS; i++) {
        queue.enqueue({
          id: `job-${i}`,
          job: { kind: "generate", input: { width: 5, height: 5, seed: `s${i}` } },
          createdAt: i,
        });
      }
    })();
    // Every thread connects first, then all start claiming at once.
    await Promise.all(threads.map((t, i) => ask(t, { type: "open", path, worker: `w${i}` })));
    const claimed = await Promise.all(threads.map((t) => ask<string[]>(t, { type: "go" })));
    const all = claimed.flat();
    expect(all.length).toBe(JOBS);
    expect(new Set(all).size).toBe(JOBS);
    expect(queue.countQueued()).toBe(0);
    db.close();
  } finally {
    for (const t of threads) t.terminate();
    rmSync(dir, { recursive: true });
  }
});
```

#### Verify

```sh
bun test apps/server/src/adapters/db   # 14 pass
bun run check
```

#### Commit

```sh
git add -A && git commit -m "feat(server): store puzzles and jobs in SQLite with numbered migrations"
```

### Step 4 — Blob stores: in-memory and S3 (Garage)

#### Create `apps/server/src/adapters/blob/memory-blob-store.ts`

```ts
import type { BlobStore } from "../../ports.ts";

/** Blobs in a Map, for tests and the OpenAPI document. Not shared between processes. */
export class MemoryBlobStore implements BlobStore {
  readonly blobs = new Map<string, { body: string; contentType: string }>();

  async put(key: string, body: string, contentType: string): Promise<void> {
    this.blobs.set(key, { body, contentType });
  }

  async get(key: string): Promise<string | null> {
    return this.blobs.get(key)?.body ?? null;
  }

  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }
}
```

#### Create `apps/server/src/adapters/blob/s3-blob-store.ts`

```ts
import { S3Client } from "bun";
import type { BlobStore } from "../../ports.ts";

export interface S3Settings {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/** Blobs in an S3-compatible bucket (Garage in development) through Bun's S3 client. */
export class S3BlobStore implements BlobStore {
  readonly #client: S3Client;

  constructor(settings: S3Settings) {
    this.#client = new S3Client(settings);
  }

  async put(key: string, body: string, contentType: string): Promise<void> {
    await this.#client.write(key, body, { type: contentType });
  }

  async get(key: string): Promise<string | null> {
    const file = this.#client.file(key);
    if (!(await file.exists())) return null;
    return await file.text();
  }

  async delete(key: string): Promise<void> {
    await this.#client.delete(key);
  }
}
```

#### Create `apps/server/src/adapters/blob/blob-store-contract.ts`

```ts
import { expect, test } from "bun:test";
import type { BlobStore } from "../../ports.ts";

/** The behaviour every `BlobStore` shares. Each implementation's test file calls this. */
export function blobStoreContract(makeStore: () => BlobStore, prefix: string): void {
  test("get returns what put stored, and null for a missing key", async () => {
    const store = makeStore();
    const key = `${prefix}/a.txt`;
    await store.put(key, "112211121121", "text/plain");
    expect(await store.get(key)).toBe("112211121121");
    expect(await store.get(`${prefix}/missing.txt`)).toBeNull();
    await store.delete(key);
  });

  test("put replaces and delete removes", async () => {
    const store = makeStore();
    const key = `${prefix}/b.json`;
    await store.put(key, "[1]", "application/json");
    await store.put(key, "[2]", "application/json");
    expect(await store.get(key)).toBe("[2]");
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
  });
}
```

#### Create `apps/server/src/adapters/blob/memory-blob-store.test.ts`

```ts
import { describe } from "bun:test";
import { blobStoreContract } from "./blob-store-contract.ts";
import { MemoryBlobStore } from "./memory-blob-store.ts";

describe("MemoryBlobStore", () => {
  blobStoreContract(() => new MemoryBlobStore(), "test");
});
```

#### Create `apps/server/src/adapters/blob/s3-blob-store.test.ts`

```ts
import { describe } from "bun:test";
import { blobStoreContract } from "./blob-store-contract.ts";
import { S3BlobStore, type S3Settings } from "./s3-blob-store.ts";

// Runs against a real bucket (Garage from docker-compose.yml) when the S3_* settings are in the
// environment (copy .env.example to .env) and the endpoint answers; otherwise it is skipped.
const env = process.env;
const settings: S3Settings | null =
  env.S3_ENDPOINT &&
  env.S3_REGION &&
  env.S3_BUCKET &&
  env.S3_ACCESS_KEY_ID &&
  env.S3_SECRET_ACCESS_KEY
    ? {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        bucket: env.S3_BUCKET,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      }
    : null;

async function reachable(endpoint: string): Promise<boolean> {
  try {
    await fetch(endpoint, { signal: AbortSignal.timeout(500) });
    return true;
  } catch {
    return false;
  }
}

const available = settings !== null && (await reachable(settings.endpoint));

describe.skipIf(!available)("S3BlobStore against Garage", () => {
  const prefix = `test/${crypto.randomUUID()}`;
  blobStoreContract(() => new S3BlobStore(settings as S3Settings), prefix);
});
```

#### Verify

```sh
bun test apps/server/src/adapters/blob   # 2 pass, 2 skip without Garage
bun run check
```

#### Commit

```sh
git add -A && git commit -m "feat(server): add in-memory and S3 blob stores"
```

### Step 5 — Task runner: generation and verification in Bun worker threads

#### Create `apps/server/src/adapters/tasks/run-task.ts`

```ts
import { encodeEdges, generate, parsePuzzle, serializePuzzle, verify } from "@loophole/core";
import type { Task, TaskOutput } from "../../domain.ts";

/**
 * Share of a generation's progress given to clue removal tests; the whole-board solves after the
 * last test make no progress calls (DECISIONS "Generation progress and cancellation").
 */
const REMOVAL_SHARE = 0.9;

/**
 * Runs one task to the end on the calling thread. `onProgress` gets values from 0 to 1, only when
 * the whole percent changes. Throws what the core throws for bad input.
 */
export function runTask(task: Task, onProgress: (progress: number) => void): TaskOutput {
  let lastPercent = 0;
  const report = (progress: number) => {
    const percent = Math.floor(progress * 100);
    if (percent <= lastPercent) return;
    lastPercent = percent;
    onProgress(percent / 100);
  };
  switch (task.kind) {
    case "generate": {
      const { width, height, seed } = task.input;
      const result = generate({
        width,
        height,
        seed,
        onProgress: ({ done, total }) => report((REMOVAL_SHARE * done) / total),
      });
      return {
        kind: "generate",
        generated: {
          puzzle: serializePuzzle(result.puzzle),
          solution: encodeEdges(result.solution),
          steps: result.solve.steps,
        },
      };
    }
    case "verify": {
      // Default time budget: 30 s (PRD NFR-1). The task runner's timeout is the outer limit.
      const result = verify(parsePuzzle(task.input.puzzle));
      return {
        kind: "verify",
        verified: { status: result.status, solutions: result.solutions.map(encodeEdges) },
      };
    }
  }
}
```

#### Create `apps/server/src/adapters/tasks/run-task.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { runTask } from "./run-task.ts";

describe("runTask", () => {
  test("generate is deterministic per seed and reports rising progress below 1", () => {
    const task = { kind: "generate", input: { width: 8, height: 6, seed: "run-task" } } as const;
    const seen: number[] = [];
    const a = runTask(task, (p) => seen.push(p));
    const b = runTask(task, () => {});
    expect(a).toEqual(b);
    if (a.kind !== "generate") throw new Error("expected generate output");
    expect(a.generated.puzzle).toMatchObject({ v: 1, width: 8, height: 6, seed: "run-task" });
    expect(a.generated.solution).toMatch(/^[12]+$/);
    expect(a.generated.steps.length).toBeGreaterThan(0);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.length).toBeLessThanOrEqual(90);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    expect(seen.at(-1)).toBeLessThanOrEqual(0.9);
  });

  test("verify reports unique with the solution, and multiple", () => {
    const unique = serializePuzzle(createPuzzle(2, 2, [2, 2, 2, 2]));
    expect(runTask({ kind: "verify", input: { puzzle: unique } }, () => {})).toEqual({
      kind: "verify",
      verified: { status: "unique", solutions: ["112211121121"] },
    });
    const open = serializePuzzle(createPuzzle(2, 2));
    const out = runTask({ kind: "verify", input: { puzzle: open } }, () => {});
    expect(out.kind === "verify" && out.verified.status).toBe("multiple");
  });

  test("bad input throws the core's error", () => {
    expect(() =>
      runTask({ kind: "generate", input: { width: 0, height: 5, seed: "s" } }, () => {}),
    ).toThrow(RangeError);
  });
});
```

#### Create `apps/server/src/adapters/tasks/thread-task-runner.ts`

```ts
import type { Task, TaskOutcome, TaskOutput } from "../../domain.ts";
import type { TaskRunner, TaskRunOptions } from "../../ports.ts";

/** Messages from `task-thread.ts`. */
export type ThreadMessage =
  | { readonly type: "progress"; readonly progress: number }
  | { readonly type: "done"; readonly output: TaskOutput }
  | { readonly type: "failed"; readonly error: string };

const THREAD_URL = new URL("./task-thread.ts", import.meta.url).href;

/**
 * Runs each task in a fresh Bun Worker thread. Generation is synchronous and cannot be
 * interrupted from inside, so the time limit (and any cancel) is `Worker.terminate()`.
 */
export class ThreadTaskRunner implements TaskRunner {
  run(task: Task, { timeoutMs, onProgress }: TaskRunOptions): Promise<TaskOutcome> {
    return new Promise((resolve) => {
      const thread = new Worker(THREAD_URL);
      let settled = false;
      const settle = (outcome: TaskOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        thread.terminate();
        resolve(outcome);
      };
      const timer = setTimeout(() => settle({ status: "timeout" }), timeoutMs);
      thread.onmessage = (event: MessageEvent<ThreadMessage>) => {
        const message = event.data;
        if (message.type === "progress") {
          if (!settled) onProgress(message.progress);
        } else if (message.type === "done") {
          settle({ status: "done", output: message.output });
        } else {
          settle({ status: "failed", error: message.error });
        }
      };
      thread.onerror = (event) => settle({ status: "failed", error: event.message });
      thread.postMessage(task);
    });
  }
}
```

#### Create `apps/server/src/adapters/tasks/task-thread.ts`

```ts
// Entry point of the thread a ThreadTaskRunner starts for each task. It runs one task and posts
// progress messages, then one final message.
import type { Task } from "../../domain.ts";
import { runTask } from "./run-task.ts";
import type { ThreadMessage } from "./thread-task-runner.ts";

declare const self: Worker;

function send(message: ThreadMessage): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<Task>) => {
  try {
    const output = runTask(event.data, (progress) => send({ type: "progress", progress }));
    send({ type: "done", output });
  } catch (err) {
    send({ type: "failed", error: err instanceof Error ? err.message : String(err) });
  }
};
```

#### Create `apps/server/src/adapters/tasks/thread-task-runner.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { ThreadTaskRunner } from "./thread-task-runner.ts";

describe("ThreadTaskRunner", () => {
  const runner = new ThreadTaskRunner();

  test("runs a generation in a thread and passes progress on", async () => {
    const seen: number[] = [];
    const outcome = await runner.run(
      { kind: "generate", input: { width: 6, height: 6, seed: "thread" } },
      { timeoutMs: 10_000, onProgress: (p) => seen.push(p) },
    );
    expect(outcome.status).toBe("done");
    expect(seen.length).toBeGreaterThan(0);
  });

  test("stops a long generation at the time limit", async () => {
    const started = performance.now();
    const outcome = await runner.run(
      { kind: "generate", input: { width: 100, height: 100, seed: "too-slow" } },
      { timeoutMs: 300, onProgress: () => {} },
    );
    expect(outcome).toEqual({ status: "timeout" });
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  test("reports the core's error as failed", async () => {
    const outcome = await runner.run(
      { kind: "generate", input: { width: 0, height: 5, seed: "s" } },
      { timeoutMs: 10_000, onProgress: () => {} },
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.error).toContain("grid size");
  });
});
```

#### Verify

```sh
bun test apps/server/src/adapters/tasks   # 6 pass in about 0.5 s
bun run check
```

#### Commit

```sh
git add -A && git commit -m "feat(server): run generation and verification in worker threads with a hard time limit"
```

### Step 6 — Managers and test fakes

#### Create `apps/server/src/test-support/fakes.ts`

```ts
import type { Job, PuzzleRecord, Task, TaskOutcome } from "../domain.ts";
import type {
  Clock,
  JobEnd,
  JobQueue,
  NewJob,
  PuzzleRepository,
  TaskRunner,
  TaskRunOptions,
} from "../ports.ts";

/** A clock that only moves when told to. */
export class FakeClock implements Clock {
  constructor(public time = 1_000_000) {}

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    this.time += ms;
  }
}

/** Ids "id-1", "id-2", … in order. */
export function sequentialIds(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

export class FakePuzzleRepository implements PuzzleRepository {
  readonly records = new Map<string, PuzzleRecord>();

  insert(record: PuzzleRecord): void {
    if (!this.records.has(record.id)) this.records.set(record.id, record);
  }

  get(id: string): PuzzleRecord | null {
    return this.records.get(id) ?? null;
  }

  listPublished(limit: number): PuzzleRecord[] {
    return [...this.records.values()]
      .filter((r) => r.status === "published")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
}

/** The jobs table in a Map, with the same claim rules as the SQLite queue. */
export class FakeJobQueue implements JobQueue {
  readonly jobs = new Map<string, Job>();
  /** Every progress write, in order. */
  readonly progressWrites: { id: string; progress: number; at: number }[] = [];
  heartbeats = 0;

  enqueue({ id, job, createdAt }: NewJob): Job {
    const stored = {
      ...job,
      id,
      status: "queued",
      progress: 0,
      result: null,
      error: null,
      attempts: 0,
      claimedBy: null,
      createdAt,
      startedAt: null,
      heartbeatAt: null,
      finishedAt: null,
    } as Job;
    this.jobs.set(id, stored);
    return stored;
  }

  get(id: string): Job | null {
    return this.jobs.get(id) ?? null;
  }

  countQueued(): number {
    return [...this.jobs.values()].filter((j) => j.status === "queued").length;
  }

  claimNext(workerId: string, now: number): Job | null {
    const next = [...this.jobs.values()].find((j) => j.status === "queued");
    if (next === undefined) return null;
    return this.#update(next.id, {
      status: "running",
      claimedBy: workerId,
      attempts: next.attempts + 1,
      startedAt: now,
      heartbeatAt: now,
      progress: 0,
    });
  }

  setProgress(id: string, workerId: string, progress: number, now: number): void {
    if (!this.#holds(id, workerId)) return;
    this.progressWrites.push({ id, progress, at: now });
    this.#update(id, { progress, heartbeatAt: now });
  }

  heartbeat(id: string, workerId: string, now: number): void {
    if (!this.#holds(id, workerId)) return;
    this.heartbeats++;
    this.#update(id, { heartbeatAt: now });
  }

  finish(id: string, workerId: string, end: JobEnd, now: number): boolean {
    if (!this.#holds(id, workerId)) return false;
    this.#update(
      id,
      end.status === "done"
        ? { status: "done", progress: 1, result: end.result, finishedAt: now }
        : { status: end.status, error: end.error, finishedAt: now },
    );
    return true;
  }

  recoverStale(staleBefore: number, maxAttempts: number, now: number): number {
    let changed = 0;
    for (const job of this.jobs.values()) {
      if (job.status !== "running" || (job.heartbeatAt ?? 0) >= staleBefore) continue;
      changed++;
      if (job.attempts >= maxAttempts) {
        this.#update(job.id, { status: "failed", error: "stale", finishedAt: now });
      } else {
        this.#update(job.id, { status: "queued", claimedBy: null, progress: 0 });
      }
    }
    return changed;
  }

  #holds(id: string, workerId: string): boolean {
    const job = this.jobs.get(id);
    return job?.status === "running" && job.claimedBy === workerId;
  }

  #update(id: string, changes: Partial<Job>): Job {
    const job = { ...this.jobs.get(id), ...changes } as Job;
    this.jobs.set(id, job);
    return job;
  }
}

/** A task runner whose behaviour each test scripts. Records the tasks and options it got. */
export class FakeTaskRunner implements TaskRunner {
  readonly calls: { task: Task; options: TaskRunOptions }[] = [];

  constructor(
    private readonly behave: (task: Task, options: TaskRunOptions) => Promise<TaskOutcome>,
  ) {}

  run(task: Task, options: TaskRunOptions): Promise<TaskOutcome> {
    this.calls.push({ task, options });
    return this.behave(task, options);
  }
}
```

#### Create `apps/server/src/managers/errors.ts`

```ts
/** The job queue already holds as many queued jobs as allowed; try again later. */
export class QueueFullError extends Error {
  constructor(limit: number) {
    super(`The job queue is full (${limit} jobs waiting). Try again later.`);
    this.name = "QueueFullError";
  }
}
```

#### Create `apps/server/src/managers/puzzle-manager.ts`

```ts
import { decodeEdges, parsePuzzle } from "@loophole/core";
import type { GeneratedPuzzle, PuzzleRecord } from "../domain.ts";
import type { BlobStore, Clock, PuzzleRepository } from "../ports.ts";

export interface PuzzleManagerDeps {
  readonly puzzles: PuzzleRepository;
  readonly blobs: BlobStore;
  readonly clock: Clock;
}

/**
 * Stores and serves puzzles. Players only ever get clues: solutions stay in the blob store and
 * are read back only through `getSolution`, for server-side checks (PRD FR-25).
 */
export class PuzzleManager {
  readonly #deps: PuzzleManagerDeps;

  constructor(deps: PuzzleManagerDeps) {
    this.#deps = deps;
  }

  /**
   * Stores a generated puzzle under `id` as published: solution and trace go to the blob store
   * first, so a stored row never points at a missing blob. Saving the same id again changes
   * nothing, so a job that runs twice stores one puzzle. Returns `id`.
   */
  async saveGenerated(id: string, generated: GeneratedPuzzle): Promise<string> {
    const { puzzles, blobs, clock } = this.#deps;
    const solutionKey = `puzzles/${id}/solution.txt`;
    const traceKey = `puzzles/${id}/trace.json`;
    await blobs.put(solutionKey, generated.solution, "text/plain");
    await blobs.put(traceKey, JSON.stringify({ v: 1, steps: generated.steps }), "application/json");
    puzzles.insert({
      id,
      puzzle: parsePuzzle(generated.puzzle),
      origin: "generated",
      status: "published",
      level: 1,
      solutionKey,
      traceKey,
      createdAt: clock.now(),
    });
    return id;
  }

  /** A published puzzle, or null when there is none with this id. */
  get(id: string): PuzzleRecord | null {
    const record = this.#deps.puzzles.get(id);
    return record?.status === "published" ? record : null;
  }

  /** The newest published puzzles, newest first. */
  listRecent(limit: number): PuzzleRecord[] {
    return this.#deps.puzzles.listPublished(limit);
  }

  /**
   * The stored solution of any puzzle, published or not, as edge states. For server-side use
   * only (ranked validation, hints); never send it to a client for a ranked puzzle.
   */
  async getSolution(id: string): Promise<Uint8Array | null> {
    const record = this.#deps.puzzles.get(id);
    if (record === null) return null;
    const text = await this.#deps.blobs.get(record.solutionKey);
    return text === null ? null : decodeEdges(record.puzzle.grid, text);
  }
}
```

#### Create `apps/server/src/managers/puzzle-manager.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import type { GeneratedPuzzle } from "../domain.ts";
import { FakeClock, FakePuzzleRepository, sequentialIds } from "../test-support/fakes.ts";
import { PuzzleManager } from "./puzzle-manager.ts";

const GENERATED: GeneratedPuzzle = {
  puzzle: serializePuzzle(
    createPuzzle(2, 2, [2, 2, 2, 2], { seed: "s", meta: { generator: "1" } }),
  ),
  solution: "112211121121",
  steps: [{ rule: "clue-satisfied", changes: [{ edge: 0, state: 1 }], cells: [0], dots: [] }],
};

function setup() {
  const puzzles = new FakePuzzleRepository();
  const blobs = new MemoryBlobStore();
  const clock = new FakeClock(5000);
  const manager = new PuzzleManager({ puzzles, blobs, clock });
  const ids = sequentialIds("p");
  const save = () => manager.saveGenerated(ids(), GENERATED);
  return { puzzles, blobs, clock, manager, save };
}

describe("PuzzleManager", () => {
  test("saveGenerated stores the solution and trace as blobs and the clues as a published row", async () => {
    const { puzzles, blobs, save } = setup();
    const id = await save();
    expect(id).toBe("p-1");
    const record = puzzles.get(id);
    expect(record).toMatchObject({
      origin: "generated",
      status: "published",
      level: 1,
      createdAt: 5000,
      solutionKey: "puzzles/p-1/solution.txt",
      traceKey: "puzzles/p-1/trace.json",
    });
    expect(record && serializePuzzle(record.puzzle)).toEqual(GENERATED.puzzle);
    expect(blobs.blobs.get("puzzles/p-1/solution.txt")).toEqual({
      body: "112211121121",
      contentType: "text/plain",
    });
    expect(JSON.parse((await blobs.get("puzzles/p-1/trace.json")) ?? "")).toEqual({
      v: 1,
      steps: GENERATED.steps,
    });
  });

  test("saving the same id again keeps one puzzle", async () => {
    const { puzzles, clock, manager } = setup();
    await manager.saveGenerated("j-1", GENERATED);
    clock.advance(10);
    expect(await manager.saveGenerated("j-1", GENERATED)).toBe("j-1");
    expect(puzzles.records.size).toBe(1);
    expect(puzzles.get("j-1")?.createdAt).toBe(5000);
  });

  test("a failed blob write stores no row", async () => {
    const { puzzles, blobs, manager } = setup();
    blobs.put = async () => {
      throw new Error("bucket unavailable");
    };
    await expect(manager.saveGenerated("p-1", GENERATED)).rejects.toThrow("bucket unavailable");
    expect(puzzles.records.size).toBe(0);
  });

  test("get and listRecent serve published puzzles only", async () => {
    const { puzzles, clock, manager, save } = setup();
    const a = await save();
    clock.advance(10);
    const b = await save();
    const hidden = puzzles.get(b);
    if (hidden === null) throw new Error("missing");
    puzzles.records.set("hidden", { ...hidden, id: "hidden", status: "unpublished" });
    expect(manager.get(a)?.id).toBe(a);
    expect(manager.get("hidden")).toBeNull();
    expect(manager.get("nope")).toBeNull();
    expect(manager.listRecent(10).map((r) => r.id)).toEqual([b, a]);
  });

  test("getSolution reads the solution blob back as edge states", async () => {
    const { manager, save } = setup();
    const id = await save();
    expect(Array.from((await manager.getSolution(id)) ?? [])).toEqual(
      Array.from("112211121121", Number),
    );
    expect(await manager.getSolution("nope")).toBeNull();
  });
});
```

#### Create `apps/server/src/managers/job-manager.ts`

```ts
import type { PuzzleWireV1 } from "@loophole/core";
import type { Job, JobInput } from "../domain.ts";
import type { Clock, JobQueue } from "../ports.ts";
import { QueueFullError } from "./errors.ts";

export interface JobManagerDeps {
  readonly jobs: JobQueue;
  readonly clock: Clock;
  readonly newId: () => string;
  /** New jobs are refused while this many are waiting. */
  readonly maxQueued: number;
}

export interface GenerateRequest {
  readonly width: number;
  readonly height: number;
  /** Picked at random when absent. */
  readonly seed?: string;
}

/** Queues background jobs and reports on them. The worker process runs them (`JobRunManager`). */
export class JobManager {
  readonly #deps: JobManagerDeps;

  constructor(deps: JobManagerDeps) {
    this.#deps = deps;
  }

  /** Queues a puzzle generation (PRD FR-11: never in the request path). Throws `QueueFullError`. */
  enqueueGenerate(request: GenerateRequest): Job {
    const seed = request.seed ?? this.#deps.newId();
    return this.#enqueue({
      kind: "generate",
      input: { width: request.width, height: request.height, seed },
    });
  }

  /** Queues a uniqueness check of a puzzle (PRD FR-4). Throws `QueueFullError`. */
  enqueueVerify(puzzle: PuzzleWireV1): Job {
    return this.#enqueue({ kind: "verify", input: { puzzle } });
  }

  get(id: string): Job | null {
    return this.#deps.jobs.get(id);
  }

  #enqueue(job: JobInput): Job {
    const { jobs, clock, newId, maxQueued } = this.#deps;
    if (jobs.countQueued() >= maxQueued) throw new QueueFullError(maxQueued);
    return jobs.enqueue({ id: newId(), job, createdAt: clock.now() });
  }
}
```

#### Create `apps/server/src/managers/job-manager.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { FakeClock, FakeJobQueue, sequentialIds } from "../test-support/fakes.ts";
import { QueueFullError } from "./errors.ts";
import { JobManager } from "./job-manager.ts";

function setup(maxQueued = 10) {
  const jobs = new FakeJobQueue();
  const manager = new JobManager({
    jobs,
    clock: new FakeClock(42),
    newId: sequentialIds("j"),
    maxQueued,
  });
  return { jobs, manager };
}

describe("JobManager", () => {
  test("enqueueGenerate queues a generation with the given seed", () => {
    const { manager } = setup();
    const job = manager.enqueueGenerate({ width: 10, height: 7, seed: "abc" });
    expect(job).toMatchObject({
      id: "j-1",
      kind: "generate",
      status: "queued",
      input: { width: 10, height: 7, seed: "abc" },
      createdAt: 42,
    });
    expect(manager.get("j-1")).toEqual(job);
    expect(manager.get("nope")).toBeNull();
  });

  test("enqueueGenerate picks a random seed when none is given", () => {
    const { manager } = setup();
    const job = manager.enqueueGenerate({ width: 5, height: 5 });
    expect(job.kind === "generate" && job.input.seed).toBe("j-1");
    expect(job.id).toBe("j-2");
  });

  test("enqueueVerify queues a verification", () => {
    const { manager } = setup();
    const puzzle = serializePuzzle(createPuzzle(2, 2, [2, 2, 2, 2]));
    expect(manager.enqueueVerify(puzzle)).toMatchObject({ kind: "verify", input: { puzzle } });
  });

  test("refuses new jobs while the queue is full", () => {
    const { manager } = setup(2);
    manager.enqueueGenerate({ width: 5, height: 5, seed: "a" });
    manager.enqueueGenerate({ width: 5, height: 5, seed: "b" });
    expect(() => manager.enqueueGenerate({ width: 5, height: 5, seed: "c" })).toThrow(
      QueueFullError,
    );
  });
});
```

#### Create `apps/server/src/managers/job-run-manager.ts`

```ts
import type { Job, JobResult, Task, TaskOutput } from "../domain.ts";
import type { Clock, JobEnd, JobQueue, TaskRunner } from "../ports.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";

export interface JobRunSettings {
  /** Hard time limit for a generation. */
  readonly generateTimeoutMs: number;
  /** Hard time limit for a verification; above core's own 30 s budget (PRD NFR-1). */
  readonly verifyTimeoutMs: number;
  /** Least time between two progress writes for one job. */
  readonly progressIntervalMs: number;
  /** Time between heartbeats while a job runs. */
  readonly heartbeatMs: number;
  /** A running job with no heartbeat for this long is treated as abandoned. */
  readonly staleMs: number;
  /** A job abandoned this many times fails instead of going back to the queue. */
  readonly maxAttempts: number;
}

export interface JobRunManagerDeps {
  readonly jobs: JobQueue;
  readonly tasks: TaskRunner;
  readonly puzzles: PuzzleManager;
  readonly clock: Clock;
  readonly settings: JobRunSettings;
}

/** Runs queued jobs, one at a time per worker: claim, run off-thread, store the outcome. */
export class JobRunManager {
  readonly #deps: JobRunManagerDeps;

  constructor(deps: JobRunManagerDeps) {
    this.#deps = deps;
  }

  /** Claims and runs the oldest queued job. Resolves to false when the queue was empty. */
  async runNext(workerId: string): Promise<boolean> {
    const { jobs, tasks, clock, settings } = this.#deps;
    const job = jobs.claimNext(workerId, clock.now());
    if (job === null) return false;
    const timeoutMs =
      job.kind === "generate" ? settings.generateTimeoutMs : settings.verifyTimeoutMs;
    let lastWrite = Number.NEGATIVE_INFINITY;
    const onProgress = (progress: number) => {
      const now = clock.now();
      if (now - lastWrite < settings.progressIntervalMs) return;
      lastWrite = now;
      jobs.setProgress(job.id, workerId, progress, now);
    };
    const heartbeat = setInterval(() => {
      try {
        jobs.heartbeat(job.id, workerId, clock.now());
      } catch (err) {
        // A missed beat is harmless; the next one, or the job's end, writes again.
        console.error(`Heartbeat for job ${job.id} failed:`, err);
      }
    }, settings.heartbeatMs);
    let end: JobEnd;
    try {
      const outcome = await tasks.run(toTask(job), {
        timeoutMs,
        onProgress,
      });
      if (outcome.status === "done") {
        end = { status: "done", result: await this.#store(job, outcome.output) };
      } else if (outcome.status === "timeout") {
        end = { status: "timeout", error: `Stopped after the ${timeoutMs / 1000} s time limit.` };
      } else {
        end = { status: "failed", error: outcome.error };
      }
    } catch (err) {
      end = { status: "failed", error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearInterval(heartbeat);
    }
    jobs.finish(job.id, workerId, end, clock.now());
    return true;
  }

  /** Requeues or fails running jobs whose worker stopped sending heartbeats. */
  recoverStale(): number {
    const { jobs, clock, settings } = this.#deps;
    const now = clock.now();
    return jobs.recoverStale(now - settings.staleMs, settings.maxAttempts, now);
  }

  /** Stores what a task produced. A generated puzzle takes its job's id. */
  async #store(job: Job, output: TaskOutput): Promise<JobResult> {
    switch (output.kind) {
      case "generate":
        await this.#deps.puzzles.saveGenerated(job.id, output.generated);
        return { kind: "generate", puzzleId: job.id };
      case "verify":
        return { kind: "verify", status: output.verified.status };
    }
  }
}

function toTask(job: Job): Task {
  return job.kind === "generate"
    ? { kind: "generate", input: job.input }
    : { kind: "verify", input: job.input };
}
```

#### Create `apps/server/src/managers/job-run-manager.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import type { TaskOutcome } from "../domain.ts";
import {
  FakeClock,
  FakeJobQueue,
  FakePuzzleRepository,
  FakeTaskRunner,
} from "../test-support/fakes.ts";
import { JobRunManager, type JobRunSettings } from "./job-run-manager.ts";
import { PuzzleManager } from "./puzzle-manager.ts";

const SETTINGS: JobRunSettings = {
  generateTimeoutMs: 60_000,
  verifyTimeoutMs: 45_000,
  progressIntervalMs: 500,
  heartbeatMs: 5_000,
  staleMs: 30_000,
  maxAttempts: 3,
};

const GENERATED: TaskOutcome = {
  status: "done",
  output: {
    kind: "generate",
    generated: {
      puzzle: serializePuzzle(
        createPuzzle(2, 2, [2, 2, 2, 2], { seed: "s", meta: { generator: "1" } }),
      ),
      solution: "112211121121",
      steps: [],
    },
  },
};

function setup(runner: FakeTaskRunner, settings = SETTINGS) {
  const clock = new FakeClock();
  const jobs = new FakeJobQueue();
  const puzzleRepo = new FakePuzzleRepository();
  const blobs = new MemoryBlobStore();
  const puzzles = new PuzzleManager({
    puzzles: puzzleRepo,
    blobs,
    clock,
  });
  const manager = new JobRunManager({ jobs, tasks: runner, puzzles, clock, settings });
  const enqueue = (id: string) =>
    jobs.enqueue({
      id,
      job: { kind: "generate", input: { width: 2, height: 2, seed: "s" } },
      createdAt: clock.now(),
    });
  return { clock, jobs, puzzleRepo, blobs, manager, enqueue };
}

describe("JobRunManager.runNext", () => {
  test("resolves false when nothing is queued", async () => {
    const runner = new FakeTaskRunner(async () => GENERATED);
    expect(await setup(runner).manager.runNext("w")).toBe(false);
    expect(runner.calls.length).toBe(0);
  });

  test("a finished generation stores the puzzle and its id in the job", async () => {
    const runner = new FakeTaskRunner(async () => GENERATED);
    const { jobs, puzzleRepo, blobs, manager, enqueue } = setup(runner);
    enqueue("j1");
    expect(await manager.runNext("w")).toBe(true);
    expect(runner.calls[0].task).toEqual({
      kind: "generate",
      input: { width: 2, height: 2, seed: "s" },
    });
    expect(runner.calls[0].options.timeoutMs).toBe(60_000);
    expect(jobs.get("j1")).toMatchObject({
      status: "done",
      progress: 1,
      result: { kind: "generate", puzzleId: "j1" },
    });
    expect(puzzleRepo.get("j1")?.status).toBe("published");
    expect(await blobs.get("puzzles/j1/solution.txt")).toBe("112211121121");
  });

  test("a verification uses the verify time limit and records the status", async () => {
    const runner = new FakeTaskRunner(async () => ({
      status: "done",
      output: { kind: "verify", verified: { status: "multiple", solutions: ["1", "2"] } },
    }));
    const { jobs, manager } = setup(runner);
    const puzzle = serializePuzzle(createPuzzle(2, 2));
    jobs.enqueue({ id: "v1", job: { kind: "verify", input: { puzzle } }, createdAt: 0 });
    await manager.runNext("w");
    expect(runner.calls[0].options.timeoutMs).toBe(45_000);
    expect(jobs.get("v1")).toMatchObject({
      status: "done",
      result: { kind: "verify", status: "multiple" },
    });
  });

  test("a timeout ends the job as timeout", async () => {
    const { jobs, manager, enqueue } = setup(
      new FakeTaskRunner(async () => ({ status: "timeout" })),
    );
    enqueue("j1");
    await manager.runNext("w");
    expect(jobs.get("j1")).toMatchObject({ status: "timeout", result: null });
    expect(jobs.get("j1")?.error).toContain("60 s");
  });

  test("a task error, or a failure storing the result, ends the job as failed", async () => {
    const failing = setup(
      new FakeTaskRunner(async () => ({ status: "failed", error: "bad size" })),
    );
    failing.enqueue("j1");
    await failing.manager.runNext("w");
    expect(failing.jobs.get("j1")).toMatchObject({ status: "failed", error: "bad size" });

    const storing = setup(new FakeTaskRunner(async () => GENERATED));
    storing.blobs.put = async () => {
      throw new Error("bucket unavailable");
    };
    storing.enqueue("j2");
    await storing.manager.runNext("w");
    expect(storing.jobs.get("j2")).toMatchObject({ status: "failed", error: "bucket unavailable" });
  });

  test("progress writes are throttled to one per interval", async () => {
    let clock: FakeClock | undefined;
    const runner = new FakeTaskRunner(async (_task, { onProgress }) => {
      for (let i = 1; i <= 100; i++) {
        clock?.advance(20); // 100 updates over 2 s
        onProgress(i / 100);
      }
      return GENERATED;
    });
    const s = setup(runner);
    clock = s.clock;
    s.enqueue("j1");
    await s.manager.runNext("w");
    // At most one write per 500 ms of the 2 s run, the first one immediately.
    expect(s.jobs.progressWrites.map((w) => w.progress)).toEqual([0.01, 0.26, 0.51, 0.76]);
  });

  test("sends heartbeats while a task runs", async () => {
    const runner = new FakeTaskRunner(async () => {
      await Bun.sleep(60);
      return GENERATED;
    });
    const s = setup(runner, { ...SETTINGS, heartbeatMs: 10 });
    s.enqueue("j1");
    await s.manager.runNext("w");
    expect(s.jobs.heartbeats).toBeGreaterThanOrEqual(2);
  });

  test("a job taken back by recovery and run again stores one puzzle", async () => {
    let s: ReturnType<typeof setup> | undefined;
    let runs = 0;
    const runner = new FakeTaskRunner(async () => {
      // On the first run the job goes stale and is requeued while the task is still going.
      if (++runs === 1) {
        s?.clock.advance(SETTINGS.staleMs + 1);
        s?.manager.recoverStale();
      }
      return GENERATED;
    });
    s = setup(runner);
    s.enqueue("j1");
    await s.manager.runNext("w");
    // The late result is stored but cannot finish the job, which is queued again.
    expect(s.jobs.get("j1")).toMatchObject({ status: "queued", result: null });
    expect(s.puzzleRepo.records.size).toBe(1);
    await s.manager.runNext("w2");
    expect(s.jobs.get("j1")).toMatchObject({
      status: "done",
      claimedBy: "w2",
      result: { kind: "generate", puzzleId: "j1" },
    });
    expect(s.puzzleRepo.records.size).toBe(1);
  });
});

describe("JobRunManager.recoverStale", () => {
  test("requeues jobs silent for longer than staleMs", async () => {
    const { clock, jobs, manager, enqueue } = setup(new FakeTaskRunner(async () => GENERATED));
    enqueue("j1");
    jobs.claimNext("dead-worker", clock.now());
    clock.advance(SETTINGS.staleMs);
    expect(manager.recoverStale()).toBe(0);
    clock.advance(1);
    expect(manager.recoverStale()).toBe(1);
    expect(jobs.get("j1")).toMatchObject({ status: "queued", claimedBy: null });
  });
});
```

#### Verify

```sh
bun test apps/server/src/managers   # 18 pass
bun run check
```

#### Commit

```sh
git add -A && git commit -m "feat(server): add puzzle, job and job-run managers"
```

### Step 7 — Settings and the HTTP API

#### Create `apps/server/src/config.ts`

```ts
import { hostname } from "node:os";
import { z } from "zod";
import type { S3Settings } from "./adapters/blob/s3-blob-store.ts";
import type { JobRunSettings } from "./managers/job-run-manager.ts";

const Port = z.coerce.number().int().min(1).max(65535);
const Ms = z.coerce.number().int().positive();

const EnvSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: Port.default(3000),
  DATABASE_PATH: z.string().min(1).default("data/loophole.sqlite"),
  WEB_DIR: z.string().min(1).optional(),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  WORKER_ID: z.string().min(1).optional(),
  GENERATE_TIMEOUT_MS: Ms.default(60_000),
  VERIFY_TIMEOUT_MS: Ms.default(45_000),
});

export interface Config {
  readonly host: string;
  readonly port: number;
  /** Relative paths resolve against the working directory: the repo root for the root scripts. */
  readonly databasePath: string;
  readonly webDir: string | undefined;
  readonly s3: S3Settings;
  readonly workerId: string;
  /** How long an idle worker waits before looking for jobs again. */
  readonly pollMs: number;
  /** New jobs are refused while this many are waiting. */
  readonly maxQueuedJobs: number;
  readonly jobs: JobRunSettings;
}

/** Reads the server's settings from environment variables (see `.env.example`). Throws on bad values. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(
      `Invalid server settings (copy .env.example to .env at the repo root):\n  ${problems.join("\n  ")}`,
    );
  }
  const e = parsed.data;
  return {
    host: e.HOST,
    port: e.PORT,
    databasePath: e.DATABASE_PATH,
    webDir: e.WEB_DIR,
    s3: {
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
    },
    workerId: e.WORKER_ID ?? `${hostname()}-${process.pid}`,
    pollMs: 500,
    maxQueuedJobs: 100,
    jobs: {
      generateTimeoutMs: e.GENERATE_TIMEOUT_MS,
      verifyTimeoutMs: e.VERIFY_TIMEOUT_MS,
      progressIntervalMs: 500,
      heartbeatMs: 5_000,
      staleMs: 30_000,
      maxAttempts: 3,
    },
  };
}
```

#### Create `apps/server/src/config.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config.ts";

const S3 = {
  S3_ENDPOINT: "http://localhost:3900",
  S3_REGION: "garage",
  S3_BUCKET: "loophole-dev",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
};

describe("loadConfig", () => {
  test("fills in defaults", () => {
    const config = loadConfig(S3);
    expect(config).toMatchObject({
      host: "127.0.0.1",
      port: 3000,
      databasePath: "data/loophole.sqlite",
      webDir: undefined,
      s3: {
        endpoint: "http://localhost:3900",
        region: "garage",
        bucket: "loophole-dev",
        accessKeyId: "key",
        secretAccessKey: "secret",
      },
      jobs: { generateTimeoutMs: 60_000, verifyTimeoutMs: 45_000 },
    });
    expect(config.workerId).toContain(String(process.pid));
  });

  test("reads overrides", () => {
    const config = loadConfig({
      ...S3,
      PORT: "8080",
      DATABASE_PATH: "/var/lib/loophole/db.sqlite",
      WEB_DIR: "apps/web/build",
      WORKER_ID: "w1",
      GENERATE_TIMEOUT_MS: "1000",
    });
    expect(config).toMatchObject({
      port: 8080,
      databasePath: "/var/lib/loophole/db.sqlite",
      webDir: "apps/web/build",
      workerId: "w1",
      jobs: { generateTimeoutMs: 1000 },
    });
  });

  test("names every missing or bad setting", () => {
    expect(() => loadConfig({ PORT: "nope" })).toThrow(/PORT[\s\S]*S3_ENDPOINT/);
  });
});
```

#### Create `apps/server/src/api/problem.ts`

```ts
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: { path: string; message: string }[];
}

/**
 * An `application/problem+json` response (RFC 9457). Built with `c.json` so route handlers
 * type-check against their declared error responses; the header overrides the content type.
 */
export function problem<S extends ContentfulStatusCode>(
  c: Context,
  status: S,
  title: string,
  extra: Pick<Problem, "detail" | "errors"> = {},
) {
  const body: Problem = { type: "about:blank", title, status, ...extra };
  return c.json(body, status, { "Content-Type": "application/problem+json" });
}
```

#### Create `apps/server/src/api/schemas.ts`

```ts
import { z } from "@hono/zod-openapi";

// Request and response bodies of the HTTP API. These are the wire shapes the OpenAPI document and
// the generated client are built from; routes translate them to and from domain types.

const Id = z.string().min(1).max(64);

const Size = z.int().min(1).max(100);

const Timestamp = z.iso.datetime().openapi({ example: "2026-10-25T12:00:00.000Z" });

export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.int(),
    detail: z.string().optional(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .openapi({ description: "Each invalid field, for 400 responses." }),
  })
  .openapi("Problem", { description: "An error, as RFC 9457 problem details." });

export const PuzzleWireSchema = z
  .object({
    v: z.literal(1),
    width: Size,
    height: Size,
    clues: z.string().openapi({ description: "One character per cell, row-major: 0-3 or '.'." }),
    seed: z.string().optional(),
    meta: z.record(z.string(), z.string()).optional(),
  })
  .openapi("PuzzleWire", { description: "A puzzle in wire format version 1 (docs/FORMAT.md)." });

export const PuzzleOriginSchema = z.enum(["generated", "submitted"]).openapi("PuzzleOrigin");

export const PuzzleSchema = z
  .object({
    id: Id,
    puzzle: PuzzleWireSchema,
    origin: PuzzleOriginSchema,
    createdAt: Timestamp,
  })
  .openapi("Puzzle", { description: "A published puzzle: clues only, never the solution." });

export const PuzzleSummarySchema = z
  .object({ id: Id, width: Size, height: Size, origin: PuzzleOriginSchema, createdAt: Timestamp })
  .openapi("PuzzleSummary");

export const PuzzleListSchema = z
  .object({ items: z.array(PuzzleSummarySchema) })
  .openapi("PuzzleList");

export const PuzzleListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20).openapi({ example: 20 }),
});

export const IdParamSchema = z.object({
  id: Id.openapi({
    param: { name: "id", in: "path" },
    example: "0b8e9f5c-6f7e-4c43-9d55-0d5f8e7b3a21",
  }),
});

export const GenerateRequestSchema = z
  .strictObject({
    width: Size,
    height: Size,
    seed: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .openapi({ description: "Same seed, size and generator version give the same puzzle." }),
  })
  .openapi("GenerateRequest");

export const JobSchema = z
  .object({
    id: Id,
    kind: z.enum(["generate", "verify"]),
    status: z.enum(["queued", "running", "done", "failed", "timeout"]),
    progress: z.number().min(0).max(1),
    result: z
      .object({ puzzleId: Id })
      .nullable()
      .openapi({ description: "Set when a generation is done." }),
    error: z.string().nullable(),
    createdAt: Timestamp,
    startedAt: Timestamp.nullable(),
    finishedAt: Timestamp.nullable(),
  })
  .openapi("Job");

export const HealthSchema = z.object({ status: z.literal("ok") }).openapi("Health");
```

#### Create `apps/server/src/api/app.ts`

```ts
import type { Hook } from "@hono/zod-openapi";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { serializePuzzle } from "@loophole/core";
import type { Env } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "hono/bun";
import { HTTPException } from "hono/http-exception";
import type { Job, PuzzleRecord } from "../domain.ts";
import { QueueFullError } from "../managers/errors.ts";
import type { JobManager } from "../managers/job-manager.ts";
import type { PuzzleManager } from "../managers/puzzle-manager.ts";
import { problem } from "./problem.ts";
import {
  GenerateRequestSchema,
  HealthSchema,
  IdParamSchema,
  JobSchema,
  ProblemSchema,
  PuzzleListQuerySchema,
  PuzzleListSchema,
  PuzzleSchema,
} from "./schemas.ts";

export interface AppDeps {
  readonly puzzles: PuzzleManager;
  readonly jobs: JobManager;
  /** Folder of the built web app to serve at `/`, with `index.html` for unknown paths. */
  readonly webDir?: string;
}

/** Largest request body the API reads. Leaves room for a 100×100 puzzle (about 10 KB). */
export const MAX_BODY_BYTES = 64 * 1024;

const problemResponse = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: ProblemSchema } },
});

const healthRoute = createRoute({
  method: "get",
  path: "/api/health",
  summary: "Liveness check",
  responses: {
    200: {
      description: "The API is up.",
      content: { "application/json": { schema: HealthSchema } },
    },
  },
});

const listPuzzlesRoute = createRoute({
  method: "get",
  path: "/api/puzzles",
  summary: "Recent published puzzles, newest first",
  request: { query: PuzzleListQuerySchema },
  responses: {
    200: { description: "Puzzles.", content: { "application/json": { schema: PuzzleListSchema } } },
    400: problemResponse("Invalid query."),
  },
});

const getPuzzleRoute = createRoute({
  method: "get",
  path: "/api/puzzles/{id}",
  summary: "A published puzzle's clues (never its solution)",
  request: { params: IdParamSchema },
  responses: {
    200: { description: "The puzzle.", content: { "application/json": { schema: PuzzleSchema } } },
    400: problemResponse("Invalid id."),
    404: problemResponse("No published puzzle with this id."),
  },
});

const generateRoute = createRoute({
  method: "post",
  path: "/api/jobs/generate",
  summary: "Queue a puzzle generation",
  description: "Generation runs in the background; poll the returned job until it is done.",
  request: {
    body: { required: true, content: { "application/json": { schema: GenerateRequestSchema } } },
  },
  responses: {
    202: {
      description: "Queued. `Location` points at the job.",
      content: { "application/json": { schema: JobSchema } },
    },
    400: problemResponse("Invalid request body."),
    413: problemResponse("Request body larger than 64 KiB."),
    415: problemResponse("Request body is not JSON."),
    503: problemResponse("Too many jobs waiting; try again later."),
  },
});

const getJobRoute = createRoute({
  method: "get",
  path: "/api/jobs/{id}",
  summary: "A job's status, progress and result",
  request: { params: IdParamSchema },
  responses: {
    200: { description: "The job.", content: { "application/json": { schema: JobSchema } } },
    400: problemResponse("Invalid id."),
    404: problemResponse("No job with this id."),
  },
});

/** Turns zod validation failures into 400 problem responses. */
const validationHook: Hook<unknown, Env, string, unknown> = (result, c) => {
  if (result.success) return;
  const errors = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  return problem(c, 400, "Invalid request", {
    detail: errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join("; "),
    errors,
  });
};

/** The HTTP API: routes translate between wire shapes and domain types; managers do the work. */
export function createApp(deps: AppDeps): OpenAPIHono {
  const { puzzles, jobs } = deps;
  const app = new OpenAPIHono({ defaultHook: validationHook });

  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => problem(c, 413, "Request body too large"),
    }),
  );

  app.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));

  app.openapi(listPuzzlesRoute, (c) => {
    const { limit } = c.req.valid("query");
    return c.json({ items: puzzles.listRecent(limit).map(toPuzzleSummary) }, 200);
  });

  app.openapi(getPuzzleRoute, (c) => {
    const record = puzzles.get(c.req.valid("param").id);
    if (record === null) return problem(c, 404, "Puzzle not found");
    return c.json(toPuzzleDto(record), 200);
  });

  app.openapi(generateRoute, (c) => {
    const job = jobs.enqueueGenerate(c.req.valid("json"));
    c.header("Location", `/api/jobs/${job.id}`);
    return c.json(toJobDto(job), 202);
  });

  app.openapi(getJobRoute, (c) => {
    const job = jobs.get(c.req.valid("param").id);
    if (job === null) return problem(c, 404, "Job not found");
    return c.json(toJobDto(job), 200);
  });

  app.all("/api/*", (c) => problem(c, 404, "Not found"));

  if (deps.webDir !== undefined) {
    app.use("*", serveStatic({ root: deps.webDir }));
    app.get("*", serveStatic({ root: deps.webDir, path: "index.html" }));
  }

  app.notFound((c) => problem(c, 404, "Not found"));

  app.onError((err, c) => {
    if (err instanceof QueueFullError)
      return problem(c, 503, "Queue full", { detail: err.message });
    if (err instanceof HTTPException) return problem(c, err.status, err.message);
    console.error(err);
    return problem(c, 500, "Internal server error");
  });

  return app;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function toPuzzleDto(r: PuzzleRecord) {
  return {
    id: r.id,
    puzzle: serializePuzzle(r.puzzle),
    origin: r.origin,
    createdAt: iso(r.createdAt),
  };
}

function toPuzzleSummary(r: PuzzleRecord) {
  return {
    id: r.id,
    width: r.puzzle.grid.width,
    height: r.puzzle.grid.height,
    origin: r.origin,
    createdAt: iso(r.createdAt),
  };
}

function toJobDto(job: Job) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    result: job.result?.kind === "generate" ? { puzzleId: job.result.puzzleId } : null,
    error: job.error,
    createdAt: iso(job.createdAt),
    startedAt: job.startedAt === null ? null : iso(job.startedAt),
    finishedAt: job.finishedAt === null ? null : iso(job.finishedAt),
  };
}
```

#### Create `apps/server/src/api/app.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { createApp } from "./app.ts";
import type { Problem } from "./problem.ts";

const SOLUTION = "112211121121";

function setup(options: { webDir?: string; maxQueued?: number } = {}) {
  const db = openDatabase(":memory:");
  const clock = new FakeClock(Date.UTC(2026, 9, 25, 12));
  const repo = new SqlitePuzzleRepository(db);
  const queue = new SqliteJobQueue(db);
  const puzzles = new PuzzleManager({
    puzzles: repo,
    blobs: new MemoryBlobStore(),
    clock,
  });
  const jobs = new JobManager({
    jobs: queue,
    clock,
    newId: sequentialIds("j"),
    maxQueued: options.maxQueued ?? 10,
  });
  const app = createApp({ puzzles, jobs, webDir: options.webDir });
  const puzzleIds = sequentialIds("p");
  const savePuzzle = () =>
    puzzles.saveGenerated(puzzleIds(), {
      puzzle: serializePuzzle(
        createPuzzle(2, 2, [2, 2, 2, 2], { seed: "s", meta: { generator: "1" } }),
      ),
      solution: SOLUTION,
      steps: [],
    });
  return { app, repo, queue, clock, savePuzzle };
}

const postJson = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

async function expectProblem(res: Response, status: number): Promise<Problem> {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toStartWith("application/problem+json");
  const body = (await res.json()) as Problem;
  expect(body).toMatchObject({ type: "about:blank", status });
  return body;
}

describe("GET /api/health", () => {
  test("answers ok", async () => {
    const res = await setup().app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("puzzles", () => {
  test("GET /api/puzzles/{id} returns the clues and never the solution", async () => {
    const { app, savePuzzle } = setup();
    const id = await savePuzzle();
    const res = await app.request(`/api/puzzles/${id}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      id,
      puzzle: { v: 1, width: 2, height: 2, clues: "2222", seed: "s", meta: { generator: "1" } },
      origin: "generated",
      createdAt: "2026-10-25T12:00:00.000Z",
    });
    expect(text).not.toContain(SOLUTION);
    expect(text).not.toContain("solution");
  });

  test("GET /api/puzzles/{id} is 404 for unknown and unpublished puzzles", async () => {
    const { app, repo, savePuzzle } = setup();
    const id = await savePuzzle();
    const record = repo.get(id);
    if (record === null) throw new Error("missing");
    repo.insert({ ...record, id: "hidden", status: "unpublished" });
    await expectProblem(await app.request("/api/puzzles/nope"), 404);
    await expectProblem(await app.request("/api/puzzles/hidden"), 404);
  });

  test("GET /api/puzzles lists recent published puzzles, newest first", async () => {
    const { app, clock, savePuzzle } = setup();
    const a = await savePuzzle();
    clock.advance(1000);
    const b = await savePuzzle();
    const res = await app.request("/api/puzzles?limit=1");
    expect(await res.json()).toEqual({
      items: [
        { id: b, width: 2, height: 2, origin: "generated", createdAt: "2026-10-25T12:00:01.000Z" },
      ],
    });
    const all = (await (await app.request("/api/puzzles")).json()) as { items: { id: string }[] };
    expect(all.items.map((p) => p.id)).toEqual([b, a]);
  });

  test("GET /api/puzzles rejects a bad limit", async () => {
    const body = await expectProblem(await setup().app.request("/api/puzzles?limit=0"), 400);
    expect(body.errors?.[0].path).toBe("limit");
  });
});

describe("jobs", () => {
  test("POST /api/jobs/generate queues a job and points at it", async () => {
    const { app, queue } = setup();
    const res = await app.request(
      "/api/jobs/generate",
      postJson({ width: 10, height: 7, seed: "x" }),
    );
    expect(res.status).toBe(202);
    expect(res.headers.get("Location")).toBe("/api/jobs/j-1");
    expect(await res.json()).toEqual({
      id: "j-1",
      kind: "generate",
      status: "queued",
      progress: 0,
      result: null,
      error: null,
      createdAt: "2026-10-25T12:00:00.000Z",
      startedAt: null,
      finishedAt: null,
    });
    expect(queue.get("j-1")?.input).toEqual({ width: 10, height: 7, seed: "x" });
  });

  test("POST /api/jobs/generate validates the body", async () => {
    const { app } = setup();
    for (const body of [
      { width: 0, height: 5 },
      { width: 101, height: 5 },
      { width: 5.5, height: 5 },
      { width: 5 },
      { width: 5, height: 5, seed: "" },
      { width: 5, height: 5, seed: "x".repeat(129) },
      { width: 5, height: 5, extra: true },
    ]) {
      const problem = await expectProblem(
        await app.request("/api/jobs/generate", postJson(body)),
        400,
      );
      expect(problem.errors?.length).toBeGreaterThan(0);
    }
    await expectProblem(await app.request("/api/jobs/generate", postJson("{not json")), 400);
  });

  test("POST /api/jobs/generate refuses bodies over 64 KiB and non-JSON bodies", async () => {
    const { app, queue } = setup();
    const big = JSON.stringify({ width: 5, height: 5, seed: "s", pad: "x".repeat(100 * 1024) });
    await expectProblem(await app.request("/api/jobs/generate", postJson(big)), 413);
    const text = { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" };
    await expectProblem(await app.request("/api/jobs/generate", text), 415);
    expect(queue.countQueued()).toBe(0);
  });

  test("ids longer than 64 characters are 400 problems", async () => {
    const { app } = setup();
    const long = "x".repeat(65);
    await expectProblem(await app.request(`/api/puzzles/${long}`), 400);
    await expectProblem(await app.request(`/api/jobs/${long}`), 400);
  });

  test("POST /api/jobs/generate is 503 when the queue is full", async () => {
    const { app } = setup({ maxQueued: 1 });
    await app.request("/api/jobs/generate", postJson({ width: 5, height: 5 }));
    await expectProblem(
      await app.request("/api/jobs/generate", postJson({ width: 5, height: 5 })),
      503,
    );
  });

  test("GET /api/jobs/{id} reports progress and the puzzle id when done", async () => {
    const { app, queue, clock } = setup();
    await app.request("/api/jobs/generate", postJson({ width: 5, height: 5, seed: "x" }));
    queue.claimNext("w", clock.now());
    queue.setProgress("j-1", "w", 0.5, clock.now());
    expect(await (await app.request("/api/jobs/j-1")).json()).toMatchObject({
      status: "running",
      progress: 0.5,
      startedAt: "2026-10-25T12:00:00.000Z",
    });
    queue.finish(
      "j-1",
      "w",
      { status: "done", result: { kind: "generate", puzzleId: "p-9" } },
      clock.now(),
    );
    expect(await (await app.request("/api/jobs/j-1")).json()).toMatchObject({
      status: "done",
      progress: 1,
      result: { puzzleId: "p-9" },
    });
    await expectProblem(await app.request("/api/jobs/nope"), 404);
  });
});

describe("other paths", () => {
  test("unknown API paths are 404 problems", async () => {
    await expectProblem(await setup().app.request("/api/nothing"), 404);
    await expectProblem(await setup().app.request("/elsewhere"), 404);
  });

  test("serves the web app with index.html for client-side routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loophole-web-"));
    try {
      writeFileSync(join(dir, "index.html"), "<html>app</html>");
      writeFileSync(join(dir, "robots.txt"), "User-agent: *");
      const { app } = setup({ webDir: dir });
      expect(await (await app.request("/robots.txt")).text()).toBe("User-agent: *");
      expect(await (await app.request("/")).text()).toBe("<html>app</html>");
      expect(await (await app.request("/play/abc")).text()).toBe("<html>app</html>");
      await expectProblem(await app.request("/api/nothing"), 404);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
```

#### Create `apps/server/src/api/main.ts`

```ts
// Composition root of the HTTP API process: reads the settings, builds the adapters and managers,
// and serves the app.
import { S3BlobStore } from "../adapters/blob/s3-blob-store.ts";
import { systemClock } from "../adapters/clock.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { loadConfig } from "../config.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { createApp } from "./app.ts";

const config = loadConfig(process.env);
const db = openDatabase(config.databasePath);

const puzzles = new PuzzleManager({
  puzzles: new SqlitePuzzleRepository(db),
  blobs: new S3BlobStore(config.s3),
  clock: systemClock,
});
const jobs = new JobManager({
  jobs: new SqliteJobQueue(db),
  clock: systemClock,
  newId: () => crypto.randomUUID(),
  maxQueued: config.maxQueuedJobs,
});
const app = createApp({ puzzles, jobs, webDir: config.webDir });

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  // Outer cap; the app itself refuses API bodies over 64 KiB.
  maxRequestBodySize: 1024 * 1024,
  fetch: app.fetch,
});
console.log(`API listening on ${server.url}`);
```

#### Verify

```sh
bun test apps/server/src/api apps/server/src/config.test.ts   # 16 pass
bun run check
```

#### Commit

```sh
git add -A && git commit -m "feat(server): serve puzzles and generation jobs over HTTP"
```

### Step 8 — The worker process

#### Create `apps/server/src/worker/loop.ts`

```ts
import type { JobRunManager } from "../managers/job-run-manager.ts";

export interface WorkerLoopOptions {
  readonly runs: Pick<JobRunManager, "runNext" | "recoverStale">;
  readonly workerId: string;
  /** How long to wait when the queue is empty. */
  readonly pollMs: number;
  /** Stops the loop after the current job. */
  readonly signal: AbortSignal;
}

/**
 * The worker's main loop: run jobs back to back while there are any; when the queue is empty,
 * take back abandoned jobs and wait `pollMs` before looking again. An error (say, the database
 * staying busy) is logged and the loop carries on after the same wait.
 */
export async function runWorkerLoop({ runs, workerId, pollMs, signal }: WorkerLoopOptions) {
  while (!signal.aborted) {
    try {
      if (await runs.runNext(workerId)) continue;
      const recovered = runs.recoverStale();
      if (recovered > 0) console.log(`Recovered ${recovered} abandoned job(s)`);
    } catch (err) {
      console.error("Worker loop error:", err);
    }
    await sleep(pollMs, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}
```

#### Create `apps/server/src/worker/loop.test.ts`

```ts
import { describe, expect, spyOn, test } from "bun:test";
import { runWorkerLoop } from "./loop.ts";

describe("runWorkerLoop", () => {
  test("runs jobs back to back, recovers when idle, and stops on abort", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    let queued = 3;
    const runs = {
      async runNext(workerId: string) {
        calls.push(`run:${workerId}`);
        if (queued === 0) return false;
        queued--;
        return true;
      },
      recoverStale() {
        calls.push("recover");
        controller.abort();
        return 0;
      },
    };
    await runWorkerLoop({ runs, workerId: "w", pollMs: 60_000, signal: controller.signal });
    expect(calls).toEqual(["run:w", "run:w", "run:w", "run:w", "recover"]);
  });

  test("an abort wakes an idle loop at once", async () => {
    const controller = new AbortController();
    const runs = { runNext: async () => false, recoverStale: () => 0 };
    const started = performance.now();
    setTimeout(() => controller.abort(), 20);
    await runWorkerLoop({ runs, workerId: "w", pollMs: 60_000, signal: controller.signal });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test("an error is logged and the loop carries on", async () => {
    const controller = new AbortController();
    const error = spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const runs = {
      async runNext() {
        calls++;
        if (calls === 1) throw new Error("database is locked");
        controller.abort();
        return false;
      },
      recoverStale: () => 0,
    };
    await runWorkerLoop({ runs, workerId: "w", pollMs: 1, signal: controller.signal });
    expect(calls).toBe(2);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
```

#### Create `apps/server/src/worker/main.ts`

```ts
// Composition root of the job worker process: reads the settings, builds the adapters and
// managers, and runs jobs until SIGINT or SIGTERM. The job in progress finishes first.
import { S3BlobStore } from "../adapters/blob/s3-blob-store.ts";
import { systemClock } from "../adapters/clock.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { ThreadTaskRunner } from "../adapters/tasks/thread-task-runner.ts";
import { loadConfig } from "../config.ts";
import { JobRunManager } from "../managers/job-run-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { runWorkerLoop } from "./loop.ts";

const config = loadConfig(process.env);
const db = openDatabase(config.databasePath);

const puzzles = new PuzzleManager({
  puzzles: new SqlitePuzzleRepository(db),
  blobs: new S3BlobStore(config.s3),
  clock: systemClock,
});
const runs = new JobRunManager({
  jobs: new SqliteJobQueue(db),
  tasks: new ThreadTaskRunner(),
  puzzles,
  clock: systemClock,
  settings: config.jobs,
});

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => controller.abort());
}

console.log(`Worker ${config.workerId} polling for jobs`);
await runWorkerLoop({
  runs,
  workerId: config.workerId,
  pollMs: config.pollMs,
  signal: controller.signal,
});
db.close();
console.log(`Worker ${config.workerId} stopped`);
```

#### Create `apps/server/src/worker/flow.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { analyzeBoard, GENERATOR_VERSION, parsePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { systemClock } from "../adapters/clock.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { ThreadTaskRunner } from "../adapters/tasks/thread-task-runner.ts";
import { createApp } from "../api/app.ts";
import { JobManager } from "../managers/job-manager.ts";
import { JobRunManager } from "../managers/job-run-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";

// The whole path in one process: the API queues a generation, the worker's manager runs it in a
// real thread, and the API serves the stored puzzle.
function setup() {
  const db = openDatabase(":memory:");
  const queue = new SqliteJobQueue(db);
  const blobs = new MemoryBlobStore();
  const puzzles = new PuzzleManager({
    puzzles: new SqlitePuzzleRepository(db),
    blobs,
    clock: systemClock,
  });
  const jobs = new JobManager({
    jobs: queue,
    clock: systemClock,
    newId: () => crypto.randomUUID(),
    maxQueued: 10,
  });
  const runs = new JobRunManager({
    jobs: queue,
    tasks: new ThreadTaskRunner(),
    puzzles,
    clock: systemClock,
    settings: {
      generateTimeoutMs: 10_000,
      verifyTimeoutMs: 10_000,
      progressIntervalMs: 0,
      heartbeatMs: 1_000,
      staleMs: 30_000,
      maxAttempts: 3,
    },
  });
  return { app: createApp({ puzzles, jobs }), runs, puzzles };
}

async function generateViaApi(
  app: ReturnType<typeof setup>["app"],
  runs: JobRunManager,
  seed: string,
) {
  const res = await app.request("/api/jobs/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ width: 7, height: 7, seed }),
  });
  const { id } = (await res.json()) as { id: string };
  expect(await runs.runNext("w")).toBe(true);
  const job = (await (await app.request(`/api/jobs/${id}`)).json()) as {
    status: string;
    progress: number;
    result: { puzzleId: string } | null;
  };
  expect(job).toMatchObject({ status: "done", progress: 1 });
  if (job.result === null) throw new Error("no result");
  return job.result.puzzleId;
}

describe("generation from request to stored puzzle", () => {
  test("a queued generation is run, stored and served without its solution", async () => {
    const { app, runs, puzzles } = setup();
    const puzzleId = await generateViaApi(app, runs, "flow");
    const body = (await (await app.request(`/api/puzzles/${puzzleId}`)).json()) as {
      puzzle: unknown;
    };
    const puzzle = parsePuzzle(body.puzzle);
    expect(puzzle.seed).toBe("flow");
    expect(puzzle.meta).toEqual({ generator: GENERATOR_VERSION });
    const solution = await puzzles.getSolution(puzzleId);
    if (solution === null) throw new Error("no solution");
    expect(analyzeBoard(puzzle, solution).solved).toBe(true);
  });

  test("the same seed and size give the same puzzle (FR-10)", async () => {
    const { app, runs, puzzles } = setup();
    const a = puzzles.get(await generateViaApi(app, runs, "same"));
    const b = puzzles.get(await generateViaApi(app, runs, "same"));
    if (a === null || b === null) throw new Error("missing");
    expect(a.id).not.toBe(b.id);
    expect(Array.from(a.puzzle.clues)).toEqual(Array.from(b.puzzle.clues));
  });
});
```

#### Edit `package.json`

Replace:

```
    "test:perf": "bun run --cwd apps/web test:perf"
```

with:

```
    "test:perf": "bun run --cwd apps/web test:perf",
    "dev:api": "bun --watch apps/server/src/api/main.ts",
    "dev:worker": "bun --watch apps/server/src/worker/main.ts"
```

#### Verify

```sh
bun test apps/server/src/worker   # 5 pass
bun run check
```

#### Commit

```sh
git add -A && git commit -m "feat(server): add the job worker process"
```

### Step 9 — OpenAPI document, generated client, staleness check

#### Create `apps/server/src/api/spec.ts`

```ts
// Composition root for the OpenAPI document: builds the app over in-memory adapters, only to read
// its route definitions. `scripts/gen-api.ts` writes the result to openapi.yaml.
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { systemClock } from "../adapters/clock.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { createApp } from "./app.ts";

export function openApiDocument() {
  const db = openDatabase(":memory:");
  const app = createApp({
    puzzles: new PuzzleManager({
      puzzles: new SqlitePuzzleRepository(db),
      blobs: new MemoryBlobStore(),
      clock: systemClock,
    }),
    jobs: new JobManager({
      jobs: new SqliteJobQueue(db),
      clock: systemClock,
      newId: () => crypto.randomUUID(),
      maxQueued: 1,
    }),
  });
  const doc = app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Loophole API",
      version: "0.1.0",
      description: "Puzzles and background jobs. Errors are RFC 9457 problem details.",
    },
  });
  db.close();
  return doc;
}
```

#### Create `apps/server/scripts/gen-api.ts`

```ts
// Writes openapi.yaml from the API's route definitions and the typed client in
// packages/api-client from openapi.yaml. With --check, writes nothing and exits 1 if either file
// is out of date. Run from the repo root: `bun run gen:api` / `bun run check:api`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import openapiTS, { astToString } from "openapi-typescript";
import { stringify } from "yaml";
import { openApiDocument } from "../src/api/spec.ts";

const root = join(import.meta.dir, "../../..");
const specPath = join(root, "openapi.yaml");
const schemaPath = join(root, "packages/api-client/src/schema.ts");

const spec = `# Generated by \`bun run gen:api\` from apps/server/src/api. Do not edit.\n${stringify(openApiDocument())}`;
const schema = `// Generated by \`bun run gen:api\` from openapi.yaml. Do not edit.\n\n${astToString(await openapiTS(spec))}`;

const outputs: [path: string, text: string][] = [
  [specPath, spec],
  [schemaPath, schema],
];

if (process.argv.includes("--check")) {
  const stale = outputs.filter(([path, text]) => {
    try {
      return readFileSync(path, "utf8") !== text;
    } catch {
      return true;
    }
  });
  if (stale.length > 0) {
    for (const [path] of stale) console.error(`Out of date: ${path}`);
    console.error("Run `bun run gen:api` and commit the result.");
    process.exit(1);
  }
  console.log("openapi.yaml and the API client are up to date.");
} else {
  for (const [path, text] of outputs) writeFileSync(path, text);
  console.log(`Wrote ${specPath} and ${schemaPath}`);
}
```

#### Create `packages/api-client/package.json`

```json
{
  "name": "@loophole/api-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p ."
  },
  "dependencies": {
    "openapi-fetch": "0.17.0"
  }
}
```

#### Create `packages/api-client/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ESNext", "DOM"],
    "types": []
  },
  "include": ["src"]
}
```

#### Create `packages/api-client/src/index.ts`

```ts
import createClient from "openapi-fetch";
import type { components, paths } from "./schema.ts";

export type { components, paths };

export type Schemas = components["schemas"];

/** A typed client for the Loophole API (openapi.yaml). */
export type ApiClient = ReturnType<typeof createClient<paths>>;

export interface ApiClientOptions {
  /** Origin of the API. Default "": same origin as the page. */
  readonly baseUrl?: string;
  /** Default the global `fetch`. Tests pass their own. */
  readonly fetch?: typeof fetch;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  return createClient<paths>({ baseUrl: options.baseUrl ?? "", fetch: options.fetch });
}
```

#### Edit `package.json`

Replace:

```
    "check": "bun run lint && bun run typecheck && bun run test",
```

with:

```
    "check": "bun run lint && bun run typecheck && bun run check:api && bun run test",
```

#### Edit `package.json`

Replace:

```
    "dev:worker": "bun --watch apps/server/src/worker/main.ts"
```

with:

```
    "dev:worker": "bun --watch apps/server/src/worker/main.ts",
    "gen:api": "bun apps/server/scripts/gen-api.ts",
    "check:api": "bun apps/server/scripts/gen-api.ts --check"
```

#### Run

```sh
bun install
bun run gen:api
```

`bun run gen:api` creates `openapi.yaml` and `packages/api-client/src/schema.ts` (about 340 lines each). Commit them as generated; do not edit them by hand. Run `bun run check:api` right after: it must print `openapi.yaml and the API client are up to date.`

#### Verify

```sh
bun run check:api
bun run check   # now includes 'openapi.yaml and the API client are up to date.'
```

#### Commit

```sh
git add -A && git commit -m "feat(api-client): generate the OpenAPI document and a typed client, checked in the gate"
```

### Step 10 — Web: built-in puzzles first, then the API

#### Create `apps/web/src/lib/puzzles/api.ts`

```ts
import type { ApiClient, Schemas } from "@loophole/api-client";
import { parsePuzzle } from "@loophole/core";
import type { PuzzleSource, PuzzleSummary } from "./source.ts";

/** How many recent server puzzles the list shows. */
const LIST_LIMIT = 20;

function summary(p: Schemas["PuzzleSummary"]): PuzzleSummary {
  return {
    id: p.id,
    name: "Generated",
    subtitle: "Practice · 練習",
    width: p.width,
    height: p.height,
  };
}

/** Puzzles from the server's API: recent published puzzles, clues only. */
export function apiSource(client: ApiClient): PuzzleSource {
  return {
    async list() {
      const { data, response } = await client.GET("/api/puzzles", {
        params: { query: { limit: LIST_LIMIT } },
      });
      if (data === undefined) throw new Error(`Could not list puzzles (HTTP ${response.status})`);
      return data.items.map(summary);
    },
    async get(id) {
      const { data, response } = await client.GET("/api/puzzles/{id}", {
        params: { path: { id } },
      });
      if (response.status === 404) return null;
      if (data === undefined)
        throw new Error(`Could not load puzzle ${id} (HTTP ${response.status})`);
      const { width, height } = data.puzzle;
      return { ...summary({ ...data, width, height }), puzzle: parsePuzzle(data.puzzle) };
    },
  };
}
```

#### Create `apps/web/src/lib/puzzles/api.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { createApiClient, type Schemas } from "@loophole/api-client";
import { serializePuzzle } from "@loophole/core";
import { apiSource } from "./api.ts";

const PUZZLE: Schemas["Puzzle"] = {
  id: "p1",
  puzzle: { v: 1, width: 2, height: 2, clues: "2222", seed: "s", meta: { generator: "1" } },
  origin: "generated",
  createdAt: "2026-10-25T12:00:00.000Z",
};

/** A client whose fetch answers from `routes` (path → [status, body]) and records the URLs. */
function clientFor(routes: Record<string, [number, unknown]>) {
  const urls: string[] = [];
  const fetch = (async (input: Request) => {
    const url = new URL(input.url);
    urls.push(url.pathname + url.search);
    const [status, body] = routes[url.pathname] ?? [404, { title: "Not found" }];
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": status < 400 ? "application/json" : "application/problem+json" },
    });
  }) as typeof globalThis.fetch;
  return { client: createApiClient({ baseUrl: "http://api.test", fetch }), urls };
}

describe("apiSource", () => {
  test("list maps the server's recent puzzles to summaries", async () => {
    const { client, urls } = clientFor({
      "/api/puzzles": [
        200,
        { items: [{ id: "p1", width: 10, height: 7, origin: "generated", createdAt: "x" }] },
      ],
    });
    expect(await apiSource(client).list()).toEqual([
      { id: "p1", name: "Generated", subtitle: "Practice · 練習", width: 10, height: 7 },
    ]);
    expect(urls).toEqual(["/api/puzzles?limit=20"]);
  });

  test("get parses the wire puzzle, and is null on 404", async () => {
    const { client } = clientFor({ "/api/puzzles/p1": [200, PUZZLE] });
    const entry = await apiSource(client).get("p1");
    expect(entry).toMatchObject({ id: "p1", name: "Generated", width: 2, height: 2 });
    expect(entry && serializePuzzle(entry.puzzle)).toEqual(PUZZLE.puzzle);
    expect(await apiSource(client).get("nope")).toBeNull();
  });

  test("other failures throw", async () => {
    const error: [number, unknown] = [500, { title: "Internal server error" }];
    const { client } = clientFor({ "/api/puzzles": error, "/api/puzzles/p1": error });
    await expect(apiSource(client).list()).rejects.toThrow("HTTP 500");
    await expect(apiSource(client).get("p1")).rejects.toThrow("HTTP 500");
  });
});
```

#### Create `apps/web/src/lib/puzzles/combined.ts`

```ts
import type { PuzzleSource } from "./source.ts";

/**
 * The built-in puzzles first, then the server's. Built-in ids are looked up locally, so they keep
 * working (and the end-to-end and frame-time tests keep their boards) with no server running. If
 * the server can't be reached, the list holds just the built-in puzzles.
 */
export function withServer(local: PuzzleSource, server: PuzzleSource): PuzzleSource {
  return {
    async list() {
      const remote = await server.list().catch((err: unknown) => {
        console.warn("Server puzzles unavailable:", err);
        return [];
      });
      return [...(await local.list()), ...remote];
    },
    async get(id) {
      return (await local.get(id)) ?? (await server.get(id));
    },
  };
}
```

#### Create `apps/web/src/lib/puzzles/combined.test.ts`

```ts
import { describe, expect, spyOn, test } from "bun:test";
import { createPuzzle } from "@loophole/core";
import { withServer } from "./combined.ts";
import type { PuzzleEntry, PuzzleSource } from "./source.ts";

function entry(id: string): PuzzleEntry {
  return { id, name: id, subtitle: "", width: 1, height: 1, puzzle: createPuzzle(1, 1) };
}

function sourceOf(...ids: string[]): PuzzleSource {
  return {
    list: async () => ids.map((id) => ({ ...entry(id) })),
    get: async (id) => (ids.includes(id) ? entry(id) : null),
  };
}

const down: PuzzleSource = {
  list: async () => {
    throw new Error("offline");
  },
  get: async () => {
    throw new Error("offline");
  },
};

describe("withServer", () => {
  test("lists local puzzles first, then the server's", async () => {
    const ids = (await withServer(sourceOf("a", "b"), sourceOf("c")).list()).map((s) => s.id);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  test("an unreachable server leaves the local list", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const ids = (await withServer(sourceOf("a"), down).list()).map((s) => s.id);
    expect(ids).toEqual(["a"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("get finds local ids without asking the server, then asks the server", async () => {
    const source = withServer(sourceOf("a"), down);
    expect((await source.get("a"))?.id).toBe("a");
    await expect(source.get("z")).rejects.toThrow("offline");
    expect((await withServer(sourceOf("a"), sourceOf("z")).get("z"))?.id).toBe("z");
    expect(await withServer(sourceOf("a"), sourceOf("z")).get("y")).toBeNull();
  });
});
```

#### Replace the whole of `apps/web/src/lib/puzzles/index.ts` with

```ts
import { createApiClient } from "@loophole/api-client";
import { apiSource } from "./api.ts";
import { withServer } from "./combined.ts";
import { fixtureSource } from "./fixtures.ts";
import type { PuzzleSource } from "./source.ts";

export { type PuzzleEntry, type PuzzleSource, type PuzzleSummary, puzzleTitle } from "./source.ts";

/** The puzzle source the screens use: the built-in fixtures, then puzzles from the API. */
export const puzzleSource: PuzzleSource = withServer(fixtureSource, apiSource(createApiClient()));
```

#### Replace the whole of `apps/web/vite.config.ts` with

```ts
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  // In development the API (`bun run dev:api`, port 3000) is reached through Vite. `vite preview`
  // gets no proxy, so the end-to-end tests see only the built-in puzzles.
  server: { proxy: { "/api": "http://localhost:3000" } },
  preview: { proxy: {} },
});
```

#### Edit `apps/web/package.json`

Replace:

```
  "dependencies": {
    "@loophole/core": "workspace:*"
  },
```

with:

```
  "dependencies": {
    "@loophole/api-client": "workspace:*",
    "@loophole/core": "workspace:*"
  },
```

#### Run

```sh
bun install
```

#### Verify

```sh
bun test apps/web/src/lib/puzzles   # all pass
bun run check
```

#### Commit

```sh
git add -A && git commit -m "feat(web): list and load puzzles from the API after the built-in ones"
```

### Step 11 — Docs: AGENTS, README, TESTING, .env.example, DECISIONS

#### Create `apps/server/AGENTS.md`

```markdown
# server

The Loophole backend: one package with two entrypoints that share a SQLite database and an S3-compatible blob store (Garage in development). The HTTP API (Hono with `@hono/zod-openapi`) serves puzzles, queues background jobs and, in production, the built web app. The worker polls the jobs table and runs generation and verification in Bun worker threads under a hard time limit.

The code is layered, and Biome's import rules check the direction:

- Entrypoints (HTTP routes, the worker loop) translate between wire shapes and domain types and validate input with zod. They call managers and hold no business logic.
- Managers hold the business logic. They depend on the core package and on the adapter interfaces in the ports module, not on concrete adapters, so their tests run on the fakes in test support.
- Adapters implement those interfaces (SQLite repositories and job queue, blob stores, the thread task runner, the clock) and convert rows and objects to domain types.
- Each process has a composition root that reads the settings and wires adapters into managers; the OpenAPI document has its own.

Conventions:

- SQL runs as prepared statements with named parameters. A schema change is a new numbered migration file; files that have run stay as they are.
- Solutions and solver traces live in the blob store, and puzzle responses carry clues only (PRD FR-25). Server code that needs a solution reads it through the puzzle manager.
- After changing a route or a request or response schema, run `bun run gen:api` to regenerate `openapi.yaml` and the client package. The gate fails while they are stale.
- Server commands run from the repo root, so Bun loads the root `.env` and relative paths in the settings resolve from there.
- Tests: managers with fakes, repositories on in-memory SQLite, routes through `app.request`, the task runner with real threads. The Garage test skips itself when Garage isn't running. `docs/TESTING.md` has the details.
```

#### Replace the whole of `.env.example` with

```sh
# Dev defaults matching docker-compose.yml and scripts/garage-init.sh. Copy to .env at the repo root.
# Bun loads .env from the working directory, so these apply to the scripts in the root package.json
# (run them from the repo root), which is also where relative paths below resolve.

# API server
HOST=127.0.0.1
PORT=3000
# Serve the built web app (bun run --cwd apps/web build) from the API too, as in production.
# WEB_DIR=apps/web/build

# SQLite database shared by the API and the worker
DATABASE_PATH=data/loophole.sqlite

# Blob storage (Garage)
S3_ENDPOINT=http://localhost:3900
S3_REGION=garage
S3_BUCKET=loophole-dev
S3_ACCESS_KEY_ID=GK1a2b3c4d5e6f708192a3b4c5
S3_SECRET_ACCESS_KEY=8b339f8231fe89196b07eb8766bf6f079805f64a9be09934697b94e0b1aa0a0b

# Mail (Mailpit)
SMTP_HOST=localhost
SMTP_PORT=1025
```

#### Symlink `apps/server/CLAUDE.md` → `AGENTS.md`

```sh
ln -s AGENTS.md apps/server/CLAUDE.md
```

#### Edit `AGENTS.md`

Replace:

```
- The web app is a SvelteKit single-page app that talks to the API.
```

with:

```
- The web app is a SvelteKit single-page app that talks to the API.
- The API's contract is an OpenAPI document generated from the server's route definitions, together with a typed client package that the web app uses. `bun run gen:api` regenerates both after a route changes.
```

#### Edit `apps/web/AGENTS.md`

Replace:

```
- Screens get puzzles through the puzzle source interface, so the built-in fixtures can be replaced by the API without touching the screens.
```

with:

```
- Screens get puzzles through the puzzle source interface. The built-in fixtures come first, so their ids work with no server running; the rest come from the API through the generated client package. In development Vite proxies `/api` to the API server.
```

#### Edit `docs/TESTING.md`

Replace:

```
2. `bun run typecheck`: each workspace's `typecheck` script. Every workspace defines a `typecheck` script; one without it is skipped silently.
3. `bun run test`: `bun test` over the whole repo
```

with:

```
2. `bun run typecheck`: each workspace's `typecheck` script. Every workspace defines a `typecheck` script; one without it is skipped silently.
3. `bun run check:api`: fails if `openapi.yaml` or the generated API client no longer match the server's routes (`bun run gen:api` fixes it)
4. `bun run test`: `bun test` over the whole repo
```

#### Edit `docs/TESTING.md`

Replace:

```
## Web app
```

with:

```
## Server

Server tests follow its layers:

- Managers are tested with the fakes in the server's test support (clock, puzzle repository, job queue, task runner) and the in-memory blob store, so they run without a database or threads.
- SQLite repositories and the job queue are tested on in-memory databases (`openDatabase(":memory:")`), which run the real migrations. The claim race test uses a database file shared by several threads.
- Routes are tested through Hono's `app.request` over real managers and in-memory adapters, with no server listening.
- The thread task runner is tested with real Bun worker threads, including a 100×100 generation stopped at its time limit.
- The S3 blob store test runs against Garage when the `S3_*` settings are set (from `.env`) and Garage answers; otherwise it is skipped, as in CI. Start Garage (README, Local services) to run it.

## Web app
```

#### Edit `README.md`

Replace:

```
The server is being built in phases; each phase's plan is in [`docs/plans/`](docs/plans/).
```

with:

```
The server has its foundation: an HTTP API that serves puzzles and queues generation jobs, and a worker that generates puzzles in the background with progress and a time limit, keeping each solution in blob storage. The web app lists the server's puzzles after its built-in ones. Accounts, hints, daily puzzles and the rest come in later phases; each phase's plan is in [`docs/plans/`](docs/plans/).
```

#### Edit `README.md`

Replace:

```
Then open http://localhost:5173. Puzzles come from a few built-in fixtures until the server exists.
```

with:

```
Then open http://localhost:5173. The list shows the built-in puzzles, then any from the API if it is running (see Server below; Vite forwards `/api` to it).
```

#### Edit `README.md`

Replace:

```
The init script is safe to run again. To pick up the dev settings, copy `.env.example` to `.env`; Bun loads `.env` automatically.
```

with:

```
The init script is safe to run again. To pick up the dev settings, copy `.env.example` to `.env` at the repo root. Bun loads `.env` from the directory a command runs in, so run the scripts below from the repo root.
```

#### Edit `README.md`

Replace:

```
All of these credentials are for local development only. `docker compose down` stops the services. `docker compose down -v` also deletes their data, so run the init script again afterwards.
```

with:

````
All of these credentials are for local development only. `docker compose down` stops the services. `docker compose down -v` also deletes their data, so run the init script again afterwards.

### Server

With the local services running and `.env` in place, start the API and the worker, each in its own terminal, from the repo root:

```sh
bun run dev:api      # http://localhost:3000
bun run dev:worker
```

Both restart when a file changes. They share the SQLite database at `data/loophole.sqlite` (created on first start) and keep solutions in Garage. Ask for a puzzle, poll the job, then fetch the puzzle:

```sh
curl -s -X POST localhost:3000/api/jobs/generate -H 'content-type: application/json' -d '{"width":10,"height":10}'
curl -s localhost:3000/api/jobs/<job id>        # status, progress, then result.puzzleId
curl -s localhost:3000/api/puzzles/<puzzle id>  # clues only
```

The API is described in [`openapi.yaml`](openapi.yaml). To serve the built web app from the API as in production, build it (`bun run --cwd apps/web build`) and set `WEB_DIR=apps/web/build` in `.env`.
````

#### Edit `README.md`

Replace:

```
| `bun run dev:web` | Start the web app's dev server on port 5173 |
```

with:

```
| `bun run dev:web` | Start the web app's dev server on port 5173 |
| `bun run dev:api` | Start the HTTP API on port 3000, restarting on changes |
| `bun run dev:worker` | Start the job worker, restarting on changes |
| `bun run gen:api` | Regenerate `openapi.yaml` and the API client from the server's routes |
| `bun run check:api` | Fail if `openapi.yaml` or the API client is out of date (part of the check) |
```

#### Edit `README.md`

Replace:

```
| `bun run check` | Lint, typecheck every workspace and run all tests. CI runs this. |
```

with:

```
| `bun run check` | Lint, typecheck every workspace, check the API contract is current and run all tests. CI runs this. |
```

#### Edit `README.md`

Replace:

```
packages/core      Puzzle engine shared by server and web
apps/web           Player web app (SvelteKit, single-page)
apps/              The server comes in a later phase
infra/garage/      Garage config for local development
scripts/           Dev helper scripts
docs/PRD.md        Product requirements
docs/FORMAT.md     Puzzle and board-state wire format
docs/design/       Design kit; open docs/design/index.html
docs/plans/        Implementation plan for each phase
docs/TESTING.md    How tests are organized
docs/DECISIONS.md  Log of decisions made during the build
```

with:

```
packages/core        Puzzle engine shared by server and web
packages/api-client  Typed API client generated from openapi.yaml
apps/server          HTTP API and job worker
apps/web             Player web app (SvelteKit, single-page)
openapi.yaml         The API contract, generated from the server's routes
infra/garage/        Garage config for local development
scripts/             Dev helper scripts
docs/PRD.md          Product requirements
docs/FORMAT.md       Puzzle and board-state wire format
docs/design/         Design kit; open docs/design/index.html
docs/plans/          Implementation plan for each phase
docs/TESTING.md      How tests are organized
docs/DECISIONS.md    Log of decisions made during the build
```

#### Edit `docs/DECISIONS.md`

Replace:

```
- **Question:** The generator doesn't exist yet. Where do 20×20
```

with:

```
- **Question:** (Written before WT3 merged.) Where do 20×20
```

#### Append to the end of `docs/DECISIONS.md`

Add these entries after the last entry (the file then ends with the last line below):

```markdown

## 2026-10-25 · WT6 `server-foundation` · Server layers and how they are checked
- **Question:** How is the server split into entrypoints, managers and adapters, and what keeps the layers apart?
- **Decision:** `apps/server/src` has `api/` and `worker/` (entrypoints, each with a `main.ts` composition root), `managers/`, `adapters/`, plus `domain.ts` (domain types) and `ports.ts` (the adapter interfaces managers depend on). Biome `noRestrictedImports` overrides enforce the direction: managers can't import adapters, entrypoints, `bun:sqlite`, Hono or zod; entrypoints other than the composition roots (`main.ts`, `spec.ts`) can't import adapters; adapters can't import managers or entrypoints. Tests are exempt. The API process uses `JobManager` (queue and report); the worker uses `JobRunManager` (claim, run, store), so the API never holds a task runner.
- **Reason:** The lint makes a layering slip fail the gate instead of waiting for review. Keeping interfaces in one module outside `adapters/` lets the manager rule be a plain "no imports from adapters".

## 2026-10-25 · WT6 `server-foundation` · Server scripts run from the repo root
- **Question:** Bun loads `.env` only from the working directory, but workspace scripts run in their package's folder. How do the server processes get the root `.env`?
- **Decision:** The server's scripts (`dev:api`, `dev:worker`, `gen:api`, `check:api`) live in the root `package.json` and call the entrypoints by path, so they run in the repo root, Bun loads the root `.env`, and relative settings (`DATABASE_PATH=data/loophole.sqlite`, `WEB_DIR`) resolve against the root. `.env.example` and the README say so.
- **Reason:** One `.env`, no `--env-file=../../.env` in every script, and paths in settings mean the same thing from every script. `data/` is git-ignored.

## 2026-10-25 · WT6 `server-foundation` · Synchronous repositories, asynchronous blob store
- **Question:** Should the repository and queue interfaces return promises?
- **Decision:** No. `PuzzleRepository` and `JobQueue` are synchronous, like `bun:sqlite`; `BlobStore` and `TaskRunner` are asynchronous. Statements are prepared once per repository with `db.query` and named parameters (`strict: true`). Migrations are numbered `.sql` files applied in order, each in an immediate transaction, recorded in `schema_migrations`. `openDatabase` sets `busy_timeout` (5 s) first, then switches to WAL, retrying "database is locked" for up to about a second.
- **Reason:** SQLite calls are synchronous and fast; promises would add ceremony with no gain. A move to another database would change the interfaces anyway. Switching a new file to WAL takes an exclusive lock that SQLite does not wait for, so the API and the worker starting together on a new database could crash one of them (reproduced in review: about half of simultaneous starts); the retry fixes that, and the immediate transaction then serializes the migrations.

## 2026-10-25 · WT6 `server-foundation` · Puzzle storage and blob keys
- **Question:** What goes in SQLite and what goes in the blob store?
- **Decision:** The `puzzles` row holds the clue string (wire format), size, seed, generator version, `level` (1 for all, FR-29), `origin` (generated/submitted), `status` (published/unpublished), the blob keys and `created_at` (ms). Solutions go to `puzzles/<id>/solution.txt` (edge-state encoding) and the solver's steps to `puzzles/<id>/trace.json` (`{"v":1,"steps":[...]}`, about 1.3 MB at 100×100), written before the row so a row never points at a missing blob. `GET /api/puzzles/{id}` returns clues only; `PuzzleManager.getSolution` reads a solution server-side. Job ids, and seeds the user leaves out, are random UUIDs; a generated puzzle takes the id of the job that made it, and inserting an existing puzzle id does nothing, so a job that runs twice (a worker recovered while still finishing) stores one puzzle. Only `meta.generator` is kept from a puzzle's metadata.
- **Reason:** Clues are small and served on every play; solutions and traces are only needed for checks and hints (FR-25, FR-6). A failed blob write leaves at most an orphaned blob, never a broken row.

## 2026-10-25 · WT6 `server-foundation` · Job queue: claiming, heartbeats, retries
- **Question:** How do workers share the jobs table, and what happens to jobs that crash, fail or run too long?
- **Decision:** `claimNext` is one `UPDATE … WHERE id = (SELECT … oldest queued) AND status = 'queued' RETURNING *`. Every later update names the claiming worker and does nothing if another worker holds the job. A running job sends a heartbeat every 5 s; progress writes count as heartbeats. When idle, a worker requeues running jobs with no heartbeat for 30 s, and fails them once they have been claimed 3 times. A job that fails or times out is not retried, since generation is deterministic and would do the same again. The worker loop logs an error from the database (or anything else) and carries on after its poll wait instead of exiting; a failed heartbeat is logged and skipped. `jobs.kind` has no CHECK constraint (validated in code), so new kinds need no table rebuild; `status` does.
- **Reason:** SQLite runs each statement atomically under its write lock, so no two workers can claim one job (tested with four threads on one file). Heartbeats separate a crashed worker from a slow job.

## 2026-10-25 · WT6 `server-foundation` · Job time limits and progress
- **Question:** What limits apply to generation and verification jobs, and how is progress reported (FR-11, NFR-1)?
- **Decision:** Each task runs in a fresh Bun `Worker`; the time limit is `terminate()` (generate is synchronous, so a stop can't be cooperative). Limits: 60 s for generation (100×100 takes about 13 s) and 45 s for verification, which runs `verify` with its default 30 s budget inside. Both are settings (`GENERATE_TIMEOUT_MS`, `VERIFY_TIMEOUT_MS`). The thread maps generation progress to 0–0.9 (clue removal tests are about 90% of the time; whole-board solves follow with no progress calls) and posts only when the whole percent changes; the worker writes progress to the job row at most every 500 ms. A timed-out or failed job keeps its last progress. On SIGINT/SIGTERM the worker finishes the job in hand, then exits.
- **Reason:** A hard outer limit holds even for code that never yields. Throttling at both ends keeps 10,000 progress calls on a 100×100 board down to a handful of database writes.

## 2026-10-25 · WT6 `server-foundation` · HTTP API shape and errors
- **Question:** What do the first endpoints look like, and how are errors reported?
- **Decision:** `GET /api/health`; `GET /api/puzzles?limit=` (recent published, newest first, default 20, at most 100); `GET /api/puzzles/{id}`; `POST /api/jobs/generate` (`{width, height, seed?}`, unknown fields rejected) answering 202 with the job and a `Location` header; `GET /api/jobs/{id}` (`status`, `progress` 0–1, `result.puzzleId` when done, `error`). Times are ISO 8601 strings. Every error is RFC 9457 problem details (`application/problem+json`, `{type, title, status, detail?, errors?}`), with `errors` listing each invalid field for 400s. While 100 jobs are queued, new ones get 503. Request bodies under `/api` are capped at 64 KiB (413), enough for a 100×100 puzzle; `Bun.serve` caps every body at 1 MiB. With `WEB_DIR` set, the API also serves the built web app with `index.html` for unknown non-API paths.
- **Reason:** One error shape for validation, missing resources and server faults. The body cap stops one request from making the server read and parse many megabytes (Bun's default limit is 128 MB). The queue cap stops an open endpoint from piling up unbounded CPU work before accounts and rate limits exist.

## 2026-10-25 · WT6 `server-foundation` · OpenAPI document and generated client
- **Question:** Where do the spec and the client live, and how does the gate catch a stale one?
- **Decision:** `bun run gen:api` builds the app over in-memory adapters, writes the OpenAPI 3.1 document to `openapi.yaml` at the repo root, and writes `openapi-typescript` types to `packages/api-client/src/schema.ts`; the package wraps them with `openapi-fetch`. `bun run check:api` (in `bun run check`, after typecheck) regenerates in memory and fails if either file differs. The generated `schema.ts` is excluded from Biome. Versions: `hono` 4.13.13 (4.13.14 is a day old), `@hono/zod-openapi` 1.6.3, `zod` 4.6.7, `openapi-typescript` 7.13.0, `openapi-fetch` 0.17.0, `yaml` 2.9.1.
- **Reason:** Comparing with the files on disk, not `git diff`, lets the gate pass on uncommitted but regenerated work. `openapi-typescript` declares a TypeScript 5 peer range; it works with 6.0.3 and Bun only warns.

## 2026-10-25 · WT6 `server-foundation` · Web app: built-in puzzles first, then the API
- **Question:** How does the web app get server puzzles while keeping the fixtures (including `giant-100` for `test:perf`)?
- **Decision:** `puzzleSource` combines the fixture source and an API source built on the generated client: the list is the fixtures followed by up to 20 recent server puzzles ("Generated"), or just the fixtures if the API can't be reached; `get` looks up fixture ids locally before asking the API. Vite proxies `/api` to `localhost:3000` in `vite dev`; `vite preview` has no proxy.
- **Reason:** The end-to-end and frame-time tests keep their boards with no server, and the screens did not change. Without a preview proxy the Playwright runs never depend on whether an API happens to be running.
```

#### Verify

```sh
bun run check
ls -l apps/server/CLAUDE.md   # -> AGENTS.md
```

#### Commit

```sh
git add -A && git commit -m "docs: describe the server, the API contract and the dev workflow"
```


### Step 12 — end-to-end run (no commit)

With Docker running, from the worktree root:

```sh
export PATH="$HOME/.bun/bin:$PATH"
docker compose up -d && ./scripts/garage-init.sh
cp .env.example .env
bun test apps/server/src/adapters/blob     # 4 pass, 0 skip: the S3 contract runs against Garage
bun run dev:api > /tmp/api.log 2>&1 &       # or a second terminal
bun run dev:worker > /tmp/worker.log 2>&1 &
curl -s localhost:3000/api/health                                    # {"status":"ok"}
curl -s -i -X POST localhost:3000/api/jobs/generate -H 'content-type: application/json' -d '{"width":10,"height":10,"seed":"e2e"}'
# 202, Location: /api/jobs/<job id>. Start the API and the worker together on a new DATABASE_PATH: neither may crash.
curl -s localhost:3000/api/jobs/<job id>          # status "done", progress 1, result.puzzleId
curl -s localhost:3000/api/puzzles/<puzzle id>    # clues, seed "e2e", meta.generator "1"; no solution
docker compose exec -T garage /garage bucket info loophole-dev | grep -E 'Objects|Size'   # 2 more objects per generated puzzle (solution + trace)
curl -s "localhost:5173/api/puzzles"  # only if `bun run dev:web` is running: the proxy reaches the API
python3 -c "print('{\"width\":5,\"height\":5,\"pad\":\"'+'x'*100000+'\"}')" > /tmp/big.json
curl -s -X POST localhost:3000/api/jobs/generate -H 'content-type: application/json' --data-binary @/tmp/big.json   # 413 problem
```

Optional: `bun run test:e2e` (Chromium) still passes, with no API needed. Then stop the servers by pid (see Environment notes) and `docker compose down`. Delete `.env` and `data/` if you like; both are git-ignored. Record anything unexpected in the final report.

### Step 13 — final check

`bun run check` passes; `git status` is clean; `git log --oneline main..` shows the 11 commits above.

## Acceptance criteria

| # | Criterion | How it's checked |
|---|---|---|
| 1 | FR-11: generation never runs in the request path; `POST /api/jobs/generate` returns 202 with a job | `app.test.ts` "queues a job and points at it" (job row `queued`, no puzzle created); flow test |
| 2 | FR-11: jobs report progress and have a hard timeout | `thread-task-runner.test.ts` (100×100 stopped at 300 ms → `timeout`), `job-run-manager.test.ts` (timeout → status `timeout`, throttled progress), Step 12 |
| 3 | FR-25: a puzzle response carries clues only | `app.test.ts` asserts the body has no `solution` key or solution string; DTO has no such field in `openapi.yaml` |
| 4 | FR-7: generated puzzle, solution and solver trace are stored (clues inline, the rest as blobs) | `puzzle-manager.test.ts`, flow test (`getSolution` solves the served puzzle), Step 12 (solution and trace objects in Garage) |
| 5 | FR-10: same seed and size give the same puzzle via jobs | `flow.test.ts` "the same seed and size give the same puzzle"; `run-task.test.ts` |
| 6 | FR-4 / NFR-1: verify jobs use `verify`'s 30 s budget inside a longer hard limit | `run-task.ts` default budget; `job-run-manager.test.ts` verify timeout 45 000 |
| 7 | FR-2: puzzles cross the API in wire format v1 and are parsed with core | `app.test.ts`, `api.test.ts` (web) |
| 8 | FR-29: `level` kept in the schema | `001_initial.sql`; repository round-trip test |
| 9 | Atomic claim; no job claimed twice | `claim-race.test.ts` (4 threads, 2000 jobs, one file) |
| 10 | Stale-job recovery; old worker can't overwrite | `job-queue.test.ts` "recoverStale…", `job-run-manager.test.ts` "a job taken back by recovery…" |
| 11 | NFR-4: prepared statements only; input validated with zod at the entrypoints | repositories use `db.query` with named parameters; `app.test.ts` validation cases → 400 problems |
| 12 | Consistent error shape | every error test checks `application/problem+json` and `type`/`status` |
| 13 | Layering: entrypoints translate, managers hold logic over ports, adapters convert; composition roots wire | Biome overrides fail the gate on a wrong-direction import (prototype checked by adding violations); manager tests use fakes only |
| 14 | Contract: `openapi.yaml` and `packages/api-client` are generated and the gate fails when stale | `bun run check:api` in `bun run check`; edit a schema description without regenerating → check fails |
| 15 | Web reads the API through the generated client; fixtures (incl. `giant-100`) work with no server | `api.test.ts`, `combined.test.ts`; `test:e2e` passes with no API |
| 16 | `.env` convention documented; core thresholds fix; loops.ts doc; DECISIONS reword | Steps 1, 11 |
| 17 | Garage integration test skips cleanly without Garage | `s3-blob-store.test.ts` shows 2 skip in CI/without Garage, 2 pass with it |
| 18 | Gate fast and stable | `bun run check` ≈ 15 s; server tests ≈ 0.9 s, 5 repeated runs green in the prototype |
| 19 | Two processes opening a new database at once both succeed in WAL mode | `database.test.ts` "several connections opening a new file at once…" (4 threads × 5 trials; failed every run before the retry) |
| 20 | Request bodies are bounded | `app.test.ts` 100 KB body → 413 problem; Step 12 |
| 21 | A job run twice stores one puzzle | `puzzle-manager.test.ts` "saving the same id again…", `job-run-manager.test.ts` "a job taken back by recovery and run again stores one puzzle" |
| 22 | One error does not kill the worker | `loop.test.ts` "an error is logged and the loop carries on"; heartbeat callback catches |

## Prototype

The whole plan was built in a scratch clone on main `bd47f75` and replayed step by step in a second fresh clone by script: `bun run check` passed after every step, and the final tree matched the prototype file for file (including `bun.lock` and the generated `openapi.yaml`). Also run there: api + worker + Garage end to end (10×10 and 100×100 generations, progress polled, both blobs in Garage), a 2 s `GENERATE_TIMEOUT_MS` on a 100×100 (→ `timeout`, "Stopped after the 2 s time limit."), a worker killed with `kill -9` mid-job (job requeued after 30 s by the restarted worker and finished, `attempts` 2), the Vite dev proxy, the S3 contract test against Garage, and `bun run test:e2e` (40 passed).

After review round 1 the changed steps were re-validated the same way (replay: gate green after every step, final tree identical to the prototype; 378 pass, 2 skip) and live: API and worker started together on a new database file, a 10×10 job stored its puzzle under the job's id, a 100 KB body got the 413 problem, a 50 MB body was refused by `Bun.serve` in under a millisecond (API RSS 78 MB), a `text/plain` body got 415. Six processes opening one new file at once, 20 times: no "database is locked".

## Unresolved questions

- Queue cap for anonymous generation: 100 queued jobs → 503 until WT7 adds rate limits. Default: keep.
- Generated puzzles from `POST /api/jobs/generate` are published and listed for everyone. Default: yes (practice pool); WT10/WT11 can add filters.
- Ids are random UUIDs (long share URLs). Default: keep; WT10 may add short share ids.

## Review responses

Round 1 (`plan-review-1.md`), all findings accepted:

1. WAL switch on a new file: `busy_timeout` first, bounded retry of `journal_mode = WAL` (Step 3, `database.ts`); new concurrent-open test with 4 threads on a path that doesn't exist yet (`test-support/open-thread.ts`), which failed on every run before the fix; DECISIONS reason reworded.
2. Body limit: `bodyLimit` 64 KiB on `/api/*` with a 413 problem, `maxRequestBodySize` 1 MiB on `Bun.serve`, a 100 KB test, a DECISIONS line (Step 7).
3. Managers lint: `bun` in `paths` and a `hono/**`, `@hono/**`, `zod/**`, `node:*` pattern (Step 2); the four injected imports now fail, real code passes.
4. Duplicate puzzles: a generated puzzle takes its job's id, `saveGenerated(id, …)` and the repository insert are idempotent (`ON CONFLICT (id) DO NOTHING`); `PuzzleManager` no longer takes `newId`; the recovery test now returns `done`, re-runs the job and asserts one puzzle (Steps 3, 6).
5. Worker resilience: try/catch per loop iteration (log, wait, continue) and in the heartbeat callback, with a loop test (Steps 6, 8).
6. OpenAPI: 400 on both id routes, 413 and 415 on generate; tests for long ids and `text/plain`; regenerated (Steps 7, 9).
7. WT11 bullet reworded: dailies need an unpublished save path, added by WT11.
