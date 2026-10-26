# WT21 `difficulty-levels` — implementation plan

Branch `feat/difficulty-levels`, worktree `/home/jhonnold/projects/loophole-wt/difficulty-levels` (main `a9283dc`, WT13–20 merged). PRD: FR-7 (generation inputs: level), FR-11 (background jobs), FR-12 (hints use the puzzle's level), FR-22 (one daily per size class), FR-23 (area × level buckets), FR-25, FR-26/27 (editor publish waits for verify), FR-29 (levels, was "deferred"), NFR-1, NFR-5, NFR-6, §4 non-goals, §14 Q1. Roadmap: WT21 row of `~/.claude/plans/read-through-the-prd-noble-squirrel.md`. Handoff: DECISIONS WT15 "Generation may take minutes" (consequences) and WT20 "`meta.level`, left out at the default level" (WT21 points).

## Goal

1. **Levels end to end.** `POST /api/jobs/generate` takes `level` (`easy`/`medium`/`hard`, default hard). The stored level is `puzzleLevel(result.puzzle)` from the worker's thread (tiny boards fall back harder), never the request and never a submitted puzzle's `meta`. `puzzles.level` / `attempts.level` become text columns; every existing row (`1`) becomes `'hard'`. Loading a row rebuilds `meta.level` (left out at hard), so `HintManager` (core `findHint`) gives level-aware hints. Puzzle DTOs, daily sets, attempts, bests and leaderboards carry a `Level`; `?level=hard` replaces `?level=1`. Dailies: one level per size class from a constant (`DAILY_CLASSES`, all hard). Web: level tag on Home covers, level after the subtitle on Play / ranked start / Solved, and a new "New puzzle" panel on Home (size + level chips) — there was no generate UI before. `gen:api`.
2. **Worker fairness (WT15).** Jobs get a `priority` (verify 0, daily 1, player 2); the atomic `claimNext` orders by priority then age. A second worker loop (verification lane) claims only verifications, so a submission's check never waits behind a running 100×100 (claim order alone can't pre-empt a running job). Per-requester cap: `MAX_PENDING_GENERATIONS` (default 3) queued+running generations per `user:<id>` / `ip:<addr>`, 429 past it; the requester column is cleared when the job ends (NFR-6).
3. **Graceful shutdown.** On SIGTERM/SIGINT both loops stop claiming; the running job gets `WORKER_DRAIN_MS` (60 s) and is then stopped (thread terminated, outcome `cancelled`) and released back to the queue (`attempts` decremented). `compose.prod.yml` worker `stop_grace_period: 90s`. Documented trade-off: a long generation reruns from its seed on the next worker.
4. **Docs.** PRD §4, FR-11, FR-22, FR-29, §14 Q1; 4 DECISIONS entries; README; TESTING; server AGENTS.

Out of scope: several levels per daily size class; `.env*.example` edits (defaults suffice; those files are not readable in this environment); metrics for released jobs (a log line only); core changes (none needed).

## Validated (this machine, Bun 1.3.13, SQLite 3.51.2)

Scratch: `/tmp/claude-1000/-home-jhonnold-projects-loophole/a34715f6-7810-5a69-ba81-edd46bda034d/scratchpad/difficulty-levels/`. `staged/` is a scratch checkout of main with the four commits below made in order; `wt21-final.diff` is their sum (generated files included); `wt21-commit-<n>.patch` are the four commits without `openapi.yaml` / `packages/api-client/src/schema.ts`.

| State | `bun run check` |
|---|---|
| main `a9283dc` | 858 pass, 3 skip |
| after commit 1 (levels on the server) | 868 pass, 3 skip, green |
| after commit 2 (fairness + shutdown) | 881 pass, 3 skip, green |
| after commit 3 (web) | 886 pass, 3 skip, green |
| after commit 4 (docs) | 886 pass, 3 skip, green |

- `E2E_PORT=4391 bun run test:e2e`: 142 passed (incl. the new `generate.e2e.ts` and `a11y.e2e.ts` with the new Home controls).
- `E2E_AUTH_PORT=4392 bun run test:e2e:auth`: 5 passed; `bun run test:e2e:stories`: 6 passed (Garage + Mailpit up via `docker compose up -d` + `scripts/garage-init.sh`, then `docker compose stop`).
- `./scripts/test-under-load.sh 12 4 apps/server/src/worker apps/server/src/adapters/tasks apps/server/src/managers/job-run-manager.test.ts`: 0 of 48 runs failed.
- Migration: `ALTER TABLE … DROP COLUMN level` then `ADD COLUMN level TEXT NOT NULL DEFAULT 'hard' CHECK (…)` works on the STRICT tables inside the migration transaction with `foreign_keys = ON`; `attempts_by_bucket` must be dropped first and recreated; `PRAGMA foreign_key_check` / `integrity_check` clean.
- Shutdown by hand: worker with a 100×100 queued before the dailies made the 4 dailies first (priority), then started the 100×100; `kill -TERM` with `WORKER_DRAIN_MS=3000` → exited 3 s later, log `Job big stopped at shutdown and given back to the queue`, row `status=queued, attempts=0, claimedBy=null`.

## Design

### Levels (commit 1)

| Where | Before | After |
|---|---|---|
| `puzzles.level`, `attempts.level` | `INTEGER NOT NULL` (always 1) | `TEXT NOT NULL DEFAULT 'hard' CHECK (level IN ('easy','medium','hard'))` (migration 007: drop + add, so old rows = hard) |
| `PuzzleRecord.level`, `AttemptRecord.level` | `number` | core `Level` |
| `GenerateInput` | width, height, seed, day? | + `level?: Level` (absent in old queued jobs → hard) |
| `runTask` | `generate({width,height,seed})` | passes `level` |
| `PuzzleManager.saveGenerated` | level 1 | `puzzleLevel(parsePuzzle(generated.puzzle))` |
| `PuzzleManager.saveDaily` | clues only, level 1 | clues + `meta.level` below hard; level from generated puzzle |
| `PuzzleManager.saveSubmitted` | puzzle as given, level 1 | clues only (seed/meta stripped), `DEFAULT_LEVEL` |
| `SqlitePuzzleRepository.fromRow` | `meta = {generator}` | `meta = {generator?, level?}` (level only when ≠ hard) — the column is authoritative, `toRow` ignores `meta.level` |
| Dailies | `DAILY_SIZES = [7,10,20,40]` | `DAILY_CLASSES = [{size, level}]` all hard; `DAILY_SIZES` derived; `dailyLevel(size)`; stock passes `level` in the job input; `DailySet.puzzles[i].level` = stored puzzle's level ?? `dailyLevel(size)` |
| API | `level: z.int()`; bucket `?level=1` | `LevelSchema = z.enum(LEVELS).openapi("Level")` on Puzzle, PuzzleSummary, DailySet entries, Attempt, DailySummary.bests, Leaderboard; `GenerateRequest.level` optional enum; bucket `?level=` enum default `"hard"` |
| Web consumers | `bucketBoard(area)` with `level: 1` | `bucketBoard(area, level)`; leaderboard page passes the size's daily level from today's set (fallback `"hard"`) |

### Fairness (commit 2)

- `JOB_PRIORITY = { verify: 0, daily: 1, player: 2 }` in `domain.ts`; `Job.priority: number`, `Job.requester: string | null`; `NewJob.priority?` (default player) and `requester?` (default null).
- Migration 008: `ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 2 CHECK (priority >= 0)`; backfill `0` for `kind='verify'`, `1` for generate with `json_extract(payload,'$.day') IS NOT NULL`; index `(status, priority, created_at)`; `ADD COLUMN requester TEXT`; partial index `(requester, status) WHERE requester IS NOT NULL`.
- Claim SQL (still one statement):
  ```sql
  UPDATE jobs SET status='running', claimed_by=$worker, attempts=attempts+1, started_at=$now, heartbeat_at=$now, progress=0
  WHERE id = (SELECT id FROM jobs WHERE status='queued' AND priority <= $max ORDER BY priority, created_at, rowid LIMIT 1)
    AND status='queued'
  RETURNING *
  ```
  `$max` = `maxPriority` arg or `Number.MAX_SAFE_INTEGER`.
- `countPending(requester)`: `SELECT count(*) … WHERE requester=$requester AND status IN ('queued','running')`. `finish` and the stale sweep's fail set `requester = NULL`.
- `JobManager.enqueueGenerate(request, requester)`: per-requester check first (`TooManyPendingJobsError` → 429 "Too many generations in progress"), then the global `maxQueued` check (503), priority player. `enqueueVerify` → priority verify; `enqueueDaily` → priority daily (still skips the global cap).
- Route: requester = `user:<id>` when logged in (session cookie), else `ip:${rateLimitKey(clientAddress(c, trustProxy))}`.
- Worker: `runWorkerLoop` (main: sweeps, stocking, any job) + `runVerifyLane` (only `maxPriority: JOB_PRIORITY.verify`, worker id `<id>/verify`), run with `Promise.all` in `worker/main.ts`.

### Shutdown (commit 2)

- `TaskRunOptions.signal?: AbortSignal`; `TaskOutcome` gains `{ status: "cancelled" }`; `ThreadTaskRunner` returns cancelled at once for an aborted signal, else terminates the thread on abort.
- `JobRunManager.runNext(workerId, { maxPriority?, cancel? })`: returns false without claiming when `cancel` already aborted; passes `cancel` as the task signal; on `cancelled` calls `jobs.release(id, workerId)` (SQL: `status='queued', claimed_by=NULL, progress=0, attempts=attempts-1 WHERE id AND status='running' AND claimed_by=$worker RETURNING id`), logs a warning, no `jobFinished` metric, returns true.
- Loops: `drainAfter(signal, drainMs)` → `{ cancel, dispose }`: on `signal` abort starts a `drainMs` timer that aborts `cancel`; loops stop claiming when `signal` aborts (existing `while (!signal.aborted)`) and pass `cancel` to `runNext`; `dispose()` on exit clears the timer.
- Settings: `MAX_PENDING_GENERATIONS` (1–100, default 3) → `config.maxPendingGenerations`; `WORKER_DRAIN_MS` (default 60 000) → `config.drainMs`. Compose: worker `stop_grace_period: 90s`.

### Web (commit 3)

- `PuzzleSummary.level?: Level` — set by `apiSource` only for `origin === "generated"`; built-in and player-made puzzles have none (no tag). `levelName(level)` → "Easy"/"Medium"/"Hard"; `puzzleSubtitle(p)` → `subtitle` or `` `${subtitle} · ${levelName}` ``; used by PlayScreen, SolvedView, the ranked-start eyebrow.
- `BookCover` gets optional `level` (display string) rendered as an ink-outlined capsule next to the name (covers are always ink; a word, not a colour — NFR-5). Home passes it for dailies (`today.puzzles[i].level`) and generated practice puzzles.
- 10×10 size class renamed "Medium" → "Regular" (`SIZE_NAMES`, the `medium-10` fixture's name) so "Medium · 10×10" can't be read as a level; e2e regexes follow.
- `lib/puzzles/generate.ts`: `createPuzzleGenerator(client).generate(width, height, level, { intervalMs=1000, sleep, signal, onJob })` → POST, then GET `/api/jobs/{id}` every interval until `done` (→ `{ ok: true, puzzleId }`), `failed`/`timeout` (→ "The puzzle couldn't be made. Try again."), a refusal (→ server `detail`, else `failureMessage`), a network error (→ offline text) or abort. No overall timeout (the queue may be long). `jobStatusText(job)`: "Waiting for its turn…" / "Making the puzzle… N%". `NEW_PUZZLE_SIZES = [5, 7, 10, 15]`.
- `NewPuzzle.svelte` under the Practice heading: size chips, level chips (default Hard), button "New {level} {n}×{n} puzzle", status line (`role=status`), error (`role=alert`); on success `goto('/play/<id>')`; aborts polling on destroy.

## Rules for the implementer

- Mode EXECUTE; follow the steps in order. Prefix commands with `export PATH="$HOME/.bun/bin:$PATH";`. Work in `/home/jhonnold/projects/loophole-wt/difficulty-levels`; `bun install --frozen-lockfile` first if `node_modules` is missing. Don't clone (`/tmp` is a small tmpfs).
- The code below is exact: it is the four commits made in the planner's scratch checkout, each formatted with Biome and green under `bun run check`. Diffs are against the previous commit (commit 1 against `a9283dc`); new files are shown in full. Generated files (`openapi.yaml`, `packages/api-client/src/schema.ts`) are not shown: run `bun run gen:api` where a step says so. Fast path for each commit: `git apply /tmp/claude-1000/-home-jhonnold-projects-loophole/a34715f6-7810-5a69-ba81-edd46bda034d/scratchpad/difficulty-levels/wt21-commit-<n>.patch`, then the commit's last step. If you type a block in by hand and Biome reformats it, that is fine; behaviour must match.
- Run `bun run format`, then `bun run check` before each commit; commit with the given conventional-commit message. Do not push.
- E2E: use `E2E_PORT=4391` and `E2E_AUTH_PORT=4392`. The auth/stories suites need `docker compose up -d` and `./scripts/garage-init.sh`; afterwards `docker compose stop` (never `down -v`). Leave no background jobs or services running.
- Do not edit `.env.example` / `.env.production.example` (defaults suffice; README documents the settings).

## Commit 1 — levels on the server (FR-7, FR-12, FR-22, FR-23, FR-29)

### 1.1 Migration 007 and its test

New `007_levels.sql`: drop and re-add `level` as text on `puzzles` and `attempts` (drop/recreate `attempts_by_bucket` around it). New `migrations.test.ts` builds the schema from migrations `< 7`, inserts a puzzle and an attempt with `level = 1`, migrates and expects `'hard'`, a CHECK failure for `'expert'`, and a clean `foreign_key_check`. `database.test.ts` expects version 7.

#### `apps/server/src/adapters/db/migrations/007_levels.sql` (new file)

```diff
diff --git a/apps/server/src/adapters/db/migrations/007_levels.sql b/apps/server/src/adapters/db/migrations/007_levels.sql
new file mode 100644
index 0000000..c81b011
--- /dev/null
+++ b/apps/server/src/adapters/db/migrations/007_levels.sql
@@ -0,0 +1,14 @@
+-- Difficulty levels (PRD FR-7, FR-23, FR-29).
+
+-- A puzzle's and a ranked attempt's level are named: 'easy', 'medium' or 'hard' (core's LEVELS).
+-- Until now every row held 1, which meant hard, the only level there was, so dropping the old
+-- column and adding the new one with 'hard' as its default keeps every existing row hard.
+ALTER TABLE puzzles DROP COLUMN level;
+ALTER TABLE puzzles ADD COLUMN level TEXT NOT NULL DEFAULT 'hard'
+  CHECK (level IN ('easy', 'medium', 'hard'));
+
+DROP INDEX attempts_by_bucket;
+ALTER TABLE attempts DROP COLUMN level;
+ALTER TABLE attempts ADD COLUMN level TEXT NOT NULL DEFAULT 'hard'
+  CHECK (level IN ('easy', 'medium', 'hard'));
+CREATE INDEX attempts_by_bucket ON attempts (area, level, ranked, time_ms);
```

#### `apps/server/src/adapters/db/migrations.test.ts` (new file)

```diff
diff --git a/apps/server/src/adapters/db/migrations.test.ts b/apps/server/src/adapters/db/migrations.test.ts
new file mode 100644
index 0000000..2aaba0e
--- /dev/null
+++ b/apps/server/src/adapters/db/migrations.test.ts
@@ -0,0 +1,50 @@
+import { Database } from "bun:sqlite";
+import { describe, expect, test } from "bun:test";
+import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
+import { tmpdir } from "node:os";
+import { join } from "node:path";
+import { migrate } from "./database.ts";
+
+// Migrations that change rows already stored: each test builds the schema as it was before the
+// migration from the numbered files, adds rows as the code of that time wrote them, then migrates
+// to the latest schema.
+
+const MIGRATIONS = join(import.meta.dir, "migrations");
+
+/** A database with the migrations numbered below `version` applied, and `seed` run on it. */
+function migratedFrom(version: number, seed: (db: Database) => void): Database {
+  const dir = mkdtempSync(join(tmpdir(), "loophole-migrations-"));
+  try {
+    for (const f of readdirSync(MIGRATIONS).filter((f) => /^\d+_.+\.sql$/.test(f))) {
+      if (Number.parseInt(f, 10) < version) copyFileSync(join(MIGRATIONS, f), join(dir, f));
+    }
+    const db = new Database(":memory:", { strict: true });
+    db.run("PRAGMA foreign_keys = ON");
+    migrate(db, dir);
+    seed(db);
+    migrate(db);
+    return db;
+  } finally {
+    rmSync(dir, { recursive: true });
+  }
+}
+
+describe("007: levels", () => {
+  test("puzzles and attempts stored before levels (level 1) are hard", () => {
+    const db = migratedFrom(7, (db) => {
+      db.run(
+        "INSERT INTO puzzles (id, width, height, clues, level, origin, status, solution_key, created_at) VALUES ('p1', 1, 1, '.', 1, 'generated', 'published', 'k', 1)",
+      );
+      db.run(
+        "INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'a@example.com', 'h', 1)",
+      );
+      db.run(
+        "INSERT INTO attempts (user_id, puzzle_id, day, area, level, started_at, finished_at, time_ms, assisted, ranked) VALUES ('u1', 'p1', '2026-10-26', 1, 1, 1, 2, 1, 0, 1)",
+      );
+    });
+    expect(db.query("SELECT level FROM puzzles").all()).toEqual([{ level: "hard" }]);
+    expect(db.query("SELECT level FROM attempts").all()).toEqual([{ level: "hard" }]);
+    expect(() => db.run("UPDATE puzzles SET level = 'expert'")).toThrow(/CHECK constraint/);
+    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
+  });
+});
```

#### `apps/server/src/adapters/db/database.test.ts`

```diff
diff --git a/apps/server/src/adapters/db/database.test.ts b/apps/server/src/adapters/db/database.test.ts
index 3f8fa7b..4f2e989 100644
--- a/apps/server/src/adapters/db/database.test.ts
+++ b/apps/server/src/adapters/db/database.test.ts
@@ -39,6 +39,7 @@ describe("openDatabase and migrate", () => {
       { version: 4 },
       { version: 5 },
       { version: 6 },
+      { version: 7 },
     ]);
   });
 
```

### 1.2 Domain and ports

`PuzzleRecord.level`, `AttemptRecord.level`: `Level`; `GenerateInput.level?: Level`; `AttemptRepository.bests`/`bucketBoard` take/return `Level`.

#### `apps/server/src/domain.ts`

```diff
diff --git a/apps/server/src/domain.ts b/apps/server/src/domain.ts
index cdc02b6..5303698 100644
--- a/apps/server/src/domain.ts
+++ b/apps/server/src/domain.ts
@@ -1,4 +1,4 @@
-import type { Puzzle, PuzzleWireV1, Step, VerifyStatus } from "@loophole/core";
+import type { Level, Puzzle, PuzzleWireV1, Step, VerifyStatus } from "@loophole/core";
 
 /** Where a stored puzzle came from. */
 export type PuzzleOrigin = "generated" | "submitted";
@@ -9,12 +9,19 @@ export type PuzzleStatus = "published" | "unpublished";
 /** A stored puzzle. The solution and the solver trace live in the blob store, not here. */
 export interface PuzzleRecord {
   readonly id: string;
-  /** Clues, seed and `meta.generator` (the generator version), as the core models them. */
+  /**
+   * Clues, seed, `meta.generator` (the generator version) and, below the default level,
+   * `meta.level`, as the core models them. `meta.level` always matches `level`, so hints use the
+   * puzzle's level (core's `findHint`).
+   */
   readonly puzzle: Puzzle;
   readonly origin: PuzzleOrigin;
   readonly status: PuzzleStatus;
-  /** Difficulty level. Every puzzle is level 1 until levels exist (PRD FR-29). */
-  readonly level: number;
+  /**
+   * The level a generated puzzle was made at (PRD FR-7), as the generator reported it. Submitted
+   * puzzles and those from before levels are hard (core's `DEFAULT_LEVEL`).
+   */
+  readonly level: Level;
   /** Blob key of the solution, in the wire format's edge-state encoding. */
   readonly solutionKey: string;
   /** Blob key of the solver's step log (JSON), when there is one. */
@@ -40,6 +47,8 @@ export interface GenerateInput {
   readonly seed: string;
   /** Set when the puzzle is a daily puzzle: its UTC day, `YYYY-MM-DD` (PRD FR-22). */
   readonly day?: string;
+  /** The level to generate at (PRD FR-7). Left out in jobs queued before levels: hard. */
+  readonly level?: Level;
 }
 
 export interface VerifyInput {
@@ -242,9 +251,9 @@ export interface AttemptRecord {
   readonly puzzleId: string;
   /** The daily's UTC day. */
   readonly day: string;
-  /** Leaderboard bucket: width × height, and the puzzle's level (PRD FR-23, FR-29). */
+  /** Leaderboard bucket: width × height, and the puzzle's level (PRD FR-23). */
   readonly area: number;
-  readonly level: number;
+  readonly level: Level;
   readonly startedAt: number;
   /** Null while the attempt is being played. */
   readonly finishedAt: number | null;
```

#### `apps/server/src/ports.ts`

```diff
diff --git a/apps/server/src/ports.ts b/apps/server/src/ports.ts
index f2f297b..03e5455 100644
--- a/apps/server/src/ports.ts
+++ b/apps/server/src/ports.ts
@@ -1,4 +1,4 @@
-import type { Puzzle } from "@loophole/core";
+import type { Level, Puzzle } from "@loophole/core";
 import type {
   AccountTokenPurpose,
   AccountTokenRecord,
@@ -265,19 +265,14 @@ export interface AttemptRepository {
   /** Every day on which the user finished an attempt, ranked or not; any order. */
   finishedDays(userId: string): string[];
   /** The user's best ranked time in each bucket. */
-  bests(userId: string): { area: number; level: number; timeMs: number }[];
+  bests(userId: string): { area: number; level: Level; timeMs: number }[];
   /** Ranked solves of one puzzle, fastest first: the top `limit` and `viewerId`'s neighbourhood. */
   puzzleBoard(puzzleId: string, viewerId: string | null, limit: number): LeaderboardSlice;
   /**
    * Each player's best ranked time in one bucket, fastest first: the top `limit` and `viewerId`'s
    * neighbourhood.
    */
-  bucketBoard(
-    area: number,
-    level: number,
-    viewerId: string | null,
-    limit: number,
-  ): LeaderboardSlice;
+  bucketBoard(area: number, level: Level, viewerId: string | null, limit: number): LeaderboardSlice;
 }
 
 /** Names players chose to show on leaderboards. */
```

### 1.3 Repositories

`SqlitePuzzleRepository.fromRow` rebuilds `meta` from `generator_version` and `level` (only when not `DEFAULT_LEVEL`). Attempt repository: `Level` types (SQL unchanged; text compares). Tests: an easy and a medium (daily-shaped, no generator) record round-trip with `meta.level`; a record whose puzzle *claims* `meta.level: "easy"` but whose `level` is hard loads with no `meta.level`; other repository tests use `level: "hard"`.

#### `apps/server/src/adapters/db/puzzle-repository.ts`

```diff
diff --git a/apps/server/src/adapters/db/puzzle-repository.ts b/apps/server/src/adapters/db/puzzle-repository.ts
index bdbb447..ebbbe50 100644
--- a/apps/server/src/adapters/db/puzzle-repository.ts
+++ b/apps/server/src/adapters/db/puzzle-repository.ts
@@ -1,5 +1,12 @@
 import type { Database } from "bun:sqlite";
-import { type Puzzle, type PuzzleWireV1, parsePuzzle, serializePuzzle } from "@loophole/core";
+import {
+  DEFAULT_LEVEL,
+  type Level,
+  type Puzzle,
+  type PuzzleWireV1,
+  parsePuzzle,
+  serializePuzzle,
+} from "@loophole/core";
 import type { PuzzleOrigin, PuzzleRecord, PuzzleStatus } from "../../domain.ts";
 import type { PuzzleRepository } from "../../ports.ts";
 
@@ -11,7 +18,7 @@ type PuzzleRow = {
   clues: string;
   seed: string | null;
   generator_version: string | null;
-  level: number;
+  level: Level;
   origin: PuzzleOrigin;
   status: PuzzleStatus;
   solution_key: string;
@@ -24,7 +31,12 @@ type PuzzleRow = {
 const COLUMNS =
   "id, width, height, clues, seed, generator_version, level, origin, status, solution_key, trace_key, created_at, creator_id, release_at";
 
-/** Puzzles in SQLite. Clues are stored as the wire format's clue string; only `meta.generator` is kept. */
+/**
+ * Puzzles in SQLite. Clues are stored as the wire format's clue string; of `meta`, only the
+ * generator version is kept, in its own column. The level has its own column too, and a loaded
+ * puzzle gets `meta.level` back from it (left out at hard, as the generator does), so hints use
+ * the puzzle's level.
+ */
 export class SqlitePuzzleRepository implements PuzzleRepository {
   readonly #insert;
   readonly #get;
@@ -98,7 +110,10 @@ function toRow(r: PuzzleRecord): PuzzleRow {
 function fromRow(row: PuzzleRow): PuzzleRecord {
   const wire: PuzzleWireV1 = { v: 1, width: row.width, height: row.height, clues: row.clues };
   if (row.seed !== null) wire.seed = row.seed;
-  if (row.generator_version !== null) wire.meta = { generator: row.generator_version };
+  const meta: Record<string, string> = {};
+  if (row.generator_version !== null) meta.generator = row.generator_version;
+  if (row.level !== DEFAULT_LEVEL) meta.level = row.level;
+  if (Object.keys(meta).length > 0) wire.meta = meta;
   return {
     id: row.id,
     puzzle: parsePuzzle(wire),
```

#### `apps/server/src/adapters/db/puzzle-repository.test.ts`

```diff
diff --git a/apps/server/src/adapters/db/puzzle-repository.test.ts b/apps/server/src/adapters/db/puzzle-repository.test.ts
index b2f884a..9a9d852 100644
--- a/apps/server/src/adapters/db/puzzle-repository.test.ts
+++ b/apps/server/src/adapters/db/puzzle-repository.test.ts
@@ -14,7 +14,7 @@ function record(id: string, createdAt: number, status: PuzzleRecord["status"] =
     puzzle,
     origin: "generated",
     status,
-    level: 1,
+    level: "hard",
     solutionKey: `puzzles/${id}/solution.txt`,
     traceKey: `puzzles/${id}/trace.json`,
     createdAt,
@@ -51,6 +51,23 @@ describe("SqlitePuzzleRepository", () => {
     expect(got?.traceKey).toBeNull();
   });
 
+  test("a loaded puzzle gets meta.level back from the level column, left out at hard", () => {
+    const repo = new SqlitePuzzleRepository(openDatabase(":memory:"));
+    repo.insert({ ...record("easy", 1), level: "easy" });
+    // A daily is stored without seed or generator version; its level is kept all the same.
+    repo.insert({ ...record("daily", 1), puzzle: createPuzzle(1, 1, [0]), level: "medium" });
+    // The column decides, whatever the stored puzzle's meta says.
+    const claims = createPuzzle(1, 1, [0], { meta: { level: "easy" } });
+    repo.insert({ ...record("claims", 1), puzzle: claims, level: "hard" });
+    expect(repo.get("easy")?.level).toBe("easy");
+    expect(repo.get("easy")?.puzzle.meta).toEqual({ generator: "1", level: "easy" });
+    expect(repo.get("daily")?.puzzle.meta).toEqual({ level: "medium" });
+    expect(repo.get("claims")?.puzzle.meta).toBeUndefined();
+    expect(repo.get("a")).toBeNull();
+    repo.insert(record("a", 1));
+    expect(repo.get("a")?.puzzle.meta).toEqual({ generator: "1" });
+  });
+
   test("listPublished is newest first, skips unpublished and honours the limit", () => {
     const repo = new SqlitePuzzleRepository(openDatabase(":memory:"));
     repo.insert(record("old", 1));
```

#### `apps/server/src/adapters/db/attempt-repository.ts`

```diff
diff --git a/apps/server/src/adapters/db/attempt-repository.ts b/apps/server/src/adapters/db/attempt-repository.ts
index 91fda5e..53d88c9 100644
--- a/apps/server/src/adapters/db/attempt-repository.ts
+++ b/apps/server/src/adapters/db/attempt-repository.ts
@@ -1,4 +1,5 @@
 import type { Database } from "bun:sqlite";
+import type { Level } from "@loophole/core";
 import type { AttemptRecord, LeaderboardSlice } from "../../domain.ts";
 import type { AttemptRepository } from "../../ports.ts";
 
@@ -8,7 +9,7 @@ type AttemptRow = {
   puzzle_id: string;
   day: string;
   area: number;
-  level: number;
+  level: Level;
   started_at: number;
   finished_at: number | null;
   time_ms: number | null;
@@ -75,7 +76,7 @@ export class SqliteAttemptRepository implements AttemptRepository {
     this.#finishedDays = db.query<{ day: string }, { user: string }>(
       "SELECT DISTINCT day FROM attempts WHERE user_id = $user AND finished_at IS NOT NULL",
     );
-    this.#bests = db.query<{ area: number; level: number; time_ms: number }, { user: string }>(
+    this.#bests = db.query<{ area: number; level: Level; time_ms: number }, { user: string }>(
       `SELECT area, level, MIN(time_ms) AS time_ms FROM attempts
        WHERE user_id = $user AND ranked = 1 GROUP BY area, level ORDER BY area, level`,
     );
@@ -94,7 +95,7 @@ export class SqliteAttemptRepository implements AttemptRepository {
     // `finished_at` is when the player set their best time.
     this.#bucketBoard = db.query<
       BoardRow,
-      { area: number; level: number; viewer: string | null; limit: number }
+      { area: number; level: Level; viewer: string | null; limit: number }
     >(
       `WITH best AS (
          SELECT user_id, MIN(time_ms) AS time_ms, finished_at FROM attempts
@@ -155,7 +156,7 @@ export class SqliteAttemptRepository implements AttemptRepository {
     return this.#finishedDays.all({ user: userId }).map((r) => r.day);
   }
 
-  bests(userId: string): { area: number; level: number; timeMs: number }[] {
+  bests(userId: string): { area: number; level: Level; timeMs: number }[] {
     return this.#bests
       .all({ user: userId })
       .map((r) => ({ area: r.area, level: r.level, timeMs: r.time_ms }));
@@ -167,7 +168,7 @@ export class SqliteAttemptRepository implements AttemptRepository {
 
   bucketBoard(
     area: number,
-    level: number,
+    level: Level,
     viewerId: string | null,
     limit: number,
   ): LeaderboardSlice {
```

#### `apps/server/src/adapters/db/attempt-repository.test.ts`

```diff
diff --git a/apps/server/src/adapters/db/attempt-repository.test.ts b/apps/server/src/adapters/db/attempt-repository.test.ts
index d31cc16..e3cc9e5 100644
--- a/apps/server/src/adapters/db/attempt-repository.test.ts
+++ b/apps/server/src/adapters/db/attempt-repository.test.ts
@@ -29,7 +29,7 @@ function setup() {
       puzzle: createPuzzle(2, 2),
       origin: "generated",
       status: "published",
-      level: 1,
+      level: "hard",
       solutionKey: `puzzles/${id}/solution.txt`,
       traceKey: null,
       createdAt: 0,
@@ -51,7 +51,7 @@ function attempt(changes: Partial<AttemptRecord> = {}): AttemptRecord {
     puzzleId: "p1",
     day: "2026-10-25",
     area: 49,
-    level: 1,
+    level: "hard",
     startedAt: 1000,
     finishedAt: null,
     timeMs: null,
@@ -98,7 +98,7 @@ describe("SqliteAttemptRepository", () => {
     repo.insert(attempt({ puzzleId: "p3", day: "2026-10-26", area: 100 }));
     expect(repo.listForDay("u1", "2026-10-25").map((a) => a.puzzleId)).toEqual(["p2"]);
     expect(repo.finishedDays("u1").sort()).toEqual(["2026-10-24", "2026-10-25"]);
-    expect(repo.bests("u1")).toEqual([{ area: 49, level: 1, timeMs: 7000 }]);
+    expect(repo.bests("u1")).toEqual([{ area: 49, level: "hard", timeMs: 7000 }]);
     expect(repo.bests("u2")).toEqual([]);
   });
 
@@ -144,14 +144,14 @@ describe("SqliteAttemptRepository", () => {
     repo.insert(solved("u2", 3000, { puzzleId: "p1" }));
     repo.insert(solved("u3", 1000, { puzzleId: "p3", area: 100 }));
     repo.insert(solved("u4", 500, { puzzleId: "p2", ranked: false }));
-    expect(repo.bucketBoard(49, 1, "u2", 10)).toEqual({
+    expect(repo.bucketBoard(49, "hard", "u2", 10)).toEqual({
       total: 2,
       entries: [
         { rank: 1, userId: "u1", name: null, timeMs: 2000 },
         { rank: 2, userId: "u2", name: null, timeMs: 3000 },
       ],
     });
-    expect(repo.bucketBoard(49, 2, null, 10).total).toBe(0);
+    expect(repo.bucketBoard(49, "easy", null, 10).total).toBe(0);
   });
 
   test("deleting the account deletes its attempts, taking it off every board (NFR-6)", () => {
```

#### `apps/server/src/adapters/db/daily-repository.test.ts`

```diff
diff --git a/apps/server/src/adapters/db/daily-repository.test.ts b/apps/server/src/adapters/db/daily-repository.test.ts
index 495c01d..8e17c4c 100644
--- a/apps/server/src/adapters/db/daily-repository.test.ts
+++ b/apps/server/src/adapters/db/daily-repository.test.ts
@@ -13,7 +13,7 @@ function setup() {
     puzzle: createPuzzle(2, 2),
     origin: "generated",
     status: "published",
-    level: 1,
+    level: "hard",
     solutionKey: "puzzles/j-1/solution.txt",
     traceKey: null,
     createdAt: 0,
```

#### `apps/server/src/adapters/db/progress-repository.test.ts`

```diff
diff --git a/apps/server/src/adapters/db/progress-repository.test.ts b/apps/server/src/adapters/db/progress-repository.test.ts
index f654353..b4d31c6 100644
--- a/apps/server/src/adapters/db/progress-repository.test.ts
+++ b/apps/server/src/adapters/db/progress-repository.test.ts
@@ -26,7 +26,7 @@ function setup() {
       puzzle: createPuzzle(2, 2),
       origin: "generated",
       status: "published",
-      level: 1,
+      level: "hard",
       solutionKey: `puzzles/${id}/solution.txt`,
       traceKey: null,
       createdAt: 0,
```

#### `apps/server/src/adapters/db/report-repository.test.ts`

```diff
diff --git a/apps/server/src/adapters/db/report-repository.test.ts b/apps/server/src/adapters/db/report-repository.test.ts
index 9f9c3a5..74e3f47 100644
--- a/apps/server/src/adapters/db/report-repository.test.ts
+++ b/apps/server/src/adapters/db/report-repository.test.ts
@@ -21,7 +21,7 @@ function setup() {
       puzzle: createPuzzle(2, 1, clues),
       origin: "generated",
       status: "published",
-      level: 1,
+      level: "hard",
       solutionKey: "k",
       traceKey: null,
       createdAt: 0,
```

### 1.4 Fakes

#### `apps/server/src/test-support/fakes.ts`

```diff
diff --git a/apps/server/src/test-support/fakes.ts b/apps/server/src/test-support/fakes.ts
index b17ac9c..fa92f57 100644
--- a/apps/server/src/test-support/fakes.ts
+++ b/apps/server/src/test-support/fakes.ts
@@ -1,4 +1,4 @@
-import type { Puzzle } from "@loophole/core";
+import type { Level, Puzzle } from "@loophole/core";
 import type {
   AccountTokenPurpose,
   AccountTokenRecord,
@@ -498,8 +498,8 @@ export class FakeAttemptRepository implements AttemptRepository {
     return [...new Set(days.map((a) => a.day))];
   }
 
-  bests(userId: string): { area: number; level: number; timeMs: number }[] {
-    const best = new Map<string, { area: number; level: number; timeMs: number }>();
+  bests(userId: string): { area: number; level: Level; timeMs: number }[] {
+    const best = new Map<string, { area: number; level: Level; timeMs: number }>();
     for (const a of this.#ranked().filter((r) => r.userId === userId)) {
       const key = `${a.area}/${a.level}`;
       const old = best.get(key);
@@ -520,7 +520,7 @@ export class FakeAttemptRepository implements AttemptRepository {
 
   bucketBoard(
     area: number,
-    level: number,
+    level: Level,
     viewerId: string | null,
     limit: number,
   ): LeaderboardSlice {
```

### 1.5 Managers

- `PuzzleManager`: `#save(id, puzzle, level, …)`; `saveGenerated` → `puzzleLevel(parsed)`; `saveDaily` → level from the generated wire, stored puzzle = `cluesOnly(wire, level)`; `saveSubmitted` → `cluesOnly(serializePuzzle(puzzle), DEFAULT_LEVEL)`. Module helper `cluesOnly({width,height,clues}, level)` adds `meta: { level }` only below the default.
- `daily-manager.ts`: `DAILY_CLASSES`, derived `DAILY_SIZES`, `dailyLevel(size)`; `forDay` returns `{ size, level, puzzleId }`.
- `daily-stock-manager.ts`: job input gets `level: dailyLevel(size)`.
- `attempt-manager.ts`, `leaderboard-manager.ts`: `Level` types (`start` already copies `puzzle.level`).
- `job-manager.ts`: `GenerateRequest.level?`; input `level: request.level ?? DEFAULT_LEVEL`.
- Tests: `saveGenerated` keeps the generator's `easy`; `saveDaily` keeps `easy` in record and `meta`; a submitted puzzle with `meta.level: "easy"` and a seed is stored hard, clues only; `HintManager` end to end through `SqlitePuzzleRepository`: `generate({7×7, seed "hint-level", level "easy"})`, saved, `puzzles.get` has `meta.level === "easy"`, and a hint walk from the empty board reaches `solved` with only `step` hints, none of whose rules is in a rule group, `parity` or `lookahead`; daily set entries carry `level: "hard"`; the stock's jobs carry `level === dailyLevel(width)`; job manager takes `level`.

#### `apps/server/src/managers/puzzle-manager.ts`

```diff
diff --git a/apps/server/src/managers/puzzle-manager.ts b/apps/server/src/managers/puzzle-manager.ts
index f685fc5..95a6e77 100644
--- a/apps/server/src/managers/puzzle-manager.ts
+++ b/apps/server/src/managers/puzzle-manager.ts
@@ -1,4 +1,14 @@
-import { decodeEdges, type Puzzle, parsePuzzle, type Step } from "@loophole/core";
+import {
+  DEFAULT_LEVEL,
+  decodeEdges,
+  type Level,
+  type Puzzle,
+  type PuzzleWireV1,
+  parsePuzzle,
+  puzzleLevel,
+  type Step,
+  serializePuzzle,
+} from "@loophole/core";
 import type { GeneratedPuzzle, PuzzleOrigin, PuzzleRecord } from "../domain.ts";
 import type { BlobStore, Clock, PuzzleRepository } from "../ports.ts";
 
@@ -22,29 +32,33 @@ export class PuzzleManager {
   /**
    * Stores a generated puzzle under `id` as published: solution and trace go to the blob store
    * first, so a stored row never points at a missing blob. Saving the same id again changes
-   * nothing, so a job that runs twice stores one puzzle. Returns `id`.
+   * nothing, so a job that runs twice stores one puzzle. Its level is the one the generator put in
+   * `meta.level` (PRD FR-7), which may be above the level asked for on a tiny board. Returns `id`.
    */
   async saveGenerated(id: string, generated: GeneratedPuzzle): Promise<string> {
-    const { puzzle, solution, steps } = generated;
-    return this.#save(id, parsePuzzle(puzzle), solution, steps, "generated", null, null);
+    const { solution, steps } = generated;
+    const puzzle = parsePuzzle(generated.puzzle);
+    return this.#save(id, puzzle, puzzleLevel(puzzle), solution, steps, "generated", null, null);
   }
 
   /**
    * Stores a generated daily puzzle (PRD FR-22) that players can't see before `releaseAt`. Its
    * seed and generator version are left out, since with them anyone could rebuild the solution
-   * (DECISIONS, WT6 "Puzzle storage"); the daily's own record keeps them. Like `saveGenerated`
-   * otherwise. Returns `id`.
+   * (DECISIONS, WT6 "Puzzle storage"); the daily's own record keeps them. Its level is kept. Like
+   * `saveGenerated` otherwise. Returns `id`.
    */
   async saveDaily(id: string, generated: GeneratedPuzzle, releaseAt: number): Promise<string> {
-    const { puzzle, solution, steps } = generated;
-    const { width, height, clues } = puzzle;
-    const cluesOnly = parsePuzzle({ v: 1, width, height, clues });
-    return this.#save(id, cluesOnly, solution, steps, "generated", null, releaseAt);
+    const { solution, steps } = generated;
+    const level = puzzleLevel(parsePuzzle(generated.puzzle));
+    const puzzle = cluesOnly(generated.puzzle, level);
+    return this.#save(id, puzzle, level, solution, steps, "generated", null, releaseAt);
   }
 
   /**
    * Stores a player's verified puzzle under `id` as published, with `creatorId` as its creator
    * (PRD FR-27). Like `saveGenerated`: blobs first, and saving the same id again changes nothing.
+   * Only its clues are kept, and its level is hard whatever its `meta` says: the level of a
+   * submitted puzzle is never taken from the player.
    */
   async saveSubmitted(
     id: string,
@@ -53,12 +67,14 @@ export class PuzzleManager {
     steps: readonly Step[],
     creatorId: string,
   ): Promise<string> {
-    return this.#save(id, puzzle, solution, steps, "submitted", creatorId, null);
+    const clues = cluesOnly(serializePuzzle(puzzle), DEFAULT_LEVEL);
+    return this.#save(id, clues, DEFAULT_LEVEL, solution, steps, "submitted", creatorId, null);
   }
 
   async #save(
     id: string,
     puzzle: Puzzle,
+    level: Level,
     solution: string,
     steps: readonly Step[],
     origin: PuzzleOrigin,
@@ -76,7 +92,7 @@ export class PuzzleManager {
       puzzle,
       origin,
       status: "published",
-      level: 1,
+      level,
       solutionKey,
       traceKey,
       createdAt: clock.now(),
@@ -131,3 +147,13 @@ export class PuzzleManager {
     return text === null ? null : decodeEdges(record.puzzle.grid, text);
   }
 }
+
+/**
+ * The puzzle's clues, with `meta.level` when `level` is below the default (as `generate` writes
+ * it), and no seed or other metadata.
+ */
+function cluesOnly({ width, height, clues }: PuzzleWireV1, level: Level): Puzzle {
+  const wire: PuzzleWireV1 = { v: 1, width, height, clues };
+  if (level !== DEFAULT_LEVEL) wire.meta = { level };
+  return parsePuzzle(wire);
+}
```

#### `apps/server/src/managers/puzzle-manager.test.ts`

```diff
diff --git a/apps/server/src/managers/puzzle-manager.test.ts b/apps/server/src/managers/puzzle-manager.test.ts
index 61b3a65..c91796f 100644
--- a/apps/server/src/managers/puzzle-manager.test.ts
+++ b/apps/server/src/managers/puzzle-manager.test.ts
@@ -13,6 +13,12 @@ const GENERATED: GeneratedPuzzle = {
   steps: [{ rule: "clue-satisfied", changes: [{ edge: 0, state: 1 }], cells: [0], dots: [] }],
 };
 
+/** As the generator reports a puzzle made at easy (`meta.level`, docs/FORMAT.md). */
+const EASY: GeneratedPuzzle = {
+  ...GENERATED,
+  puzzle: { ...GENERATED.puzzle, meta: { generator: "1", level: "easy" } },
+};
+
 function setup() {
   const puzzles = new FakePuzzleRepository();
   const blobs = new MemoryBlobStore();
@@ -32,7 +38,7 @@ describe("PuzzleManager", () => {
     expect(record).toMatchObject({
       origin: "generated",
       status: "published",
-      level: 1,
+      level: "hard",
       createdAt: 5000,
       solutionKey: "puzzles/p-1/solution.txt",
       traceKey: "puzzles/p-1/trace.json",
@@ -48,6 +54,13 @@ describe("PuzzleManager", () => {
     });
   });
 
+  test("saveGenerated stores the level the generator reported (FR-7)", async () => {
+    const { puzzles, manager } = setup();
+    await manager.saveGenerated("e-1", EASY);
+    expect(puzzles.get("e-1")?.level).toBe("easy");
+    expect(puzzles.get("e-1")?.puzzle.meta).toEqual({ generator: "1", level: "easy" });
+  });
+
   test("saving the same id again keeps one puzzle", async () => {
     const { puzzles, clock, manager } = setup();
     await manager.saveGenerated("j-1", GENERATED);
@@ -109,6 +122,20 @@ describe("PuzzleManager for daily puzzles", () => {
     expect(manager.listRecent(10)).toEqual([]);
     expect(await manager.getSolution("d-1")).not.toBeNull();
   });
+
+  test("saveDaily keeps the puzzle's level, in the record and in meta", async () => {
+    const { puzzles, manager } = setup();
+    await manager.saveDaily("d-2", EASY, 6000);
+    const stored = puzzles.get("d-2");
+    expect(stored?.level).toBe("easy");
+    expect(stored && serializePuzzle(stored.puzzle)).toEqual({
+      v: 1,
+      width: 2,
+      height: 2,
+      clues: "2222",
+      meta: { level: "easy" },
+    });
+  });
 });
 
 describe("PuzzleManager for submitted puzzles", () => {
@@ -119,11 +146,26 @@ describe("PuzzleManager for submitted puzzles", () => {
     expect(puzzles.get("s-1")).toMatchObject({
       origin: "submitted",
       status: "published",
+      level: "hard",
       creatorId: "u1",
     });
     expect(await blobs.get("puzzles/s-1/solution.txt")).toBe("112211121121");
   });
 
+  test("a submitted puzzle is hard, whatever its meta says: its level never comes from the player", async () => {
+    const { puzzles, manager } = setup();
+    const claims = createPuzzle(2, 2, [2, 2, 2, 2], { seed: "x", meta: { level: "easy" } });
+    await manager.saveSubmitted("s-2", claims, "112211121121", [], "u1");
+    const stored = puzzles.get("s-2");
+    expect(stored?.level).toBe("hard");
+    expect(stored && serializePuzzle(stored.puzzle)).toEqual({
+      v: 1,
+      width: 2,
+      height: 2,
+      clues: "2222",
+    });
+  });
+
   test("unpublish hides a puzzle from players but getAny and findByClues still see it", async () => {
     const { manager, save } = setup();
     const id = await save();
```

#### `apps/server/src/managers/hint-manager.test.ts`

```diff
diff --git a/apps/server/src/managers/hint-manager.test.ts b/apps/server/src/managers/hint-manager.test.ts
index e114f2c..eb04eb0 100644
--- a/apps/server/src/managers/hint-manager.test.ts
+++ b/apps/server/src/managers/hint-manager.test.ts
@@ -1,6 +1,15 @@
 import { describe, expect, test } from "bun:test";
-import { createPuzzle, serializePuzzle } from "@loophole/core";
+import {
+  createPuzzle,
+  encodeEdges,
+  GROUP_RULES,
+  generate,
+  type RuleId,
+  serializePuzzle,
+} from "@loophole/core";
 import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
+import { openDatabase } from "../adapters/db/database.ts";
+import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
 import { FakeClock, FakePuzzleRepository } from "../test-support/fakes.ts";
 import { InvalidBoardError } from "./errors.ts";
 import { HintManager } from "./hint-manager.ts";
@@ -94,4 +103,32 @@ describe("HintManager", () => {
     blobs.blobs.delete("puzzles/p-1/solution.txt");
     await expect(hints.hint("p-1", "000000000000")).rejects.toThrow("no stored solution");
   });
+
+  test("a puzzle stored at easy gets hints from easy's rules only (FR-12)", async () => {
+    // Through the SQLite repository: the level comes back from its column into `meta.level`.
+    const puzzles = new PuzzleManager({
+      puzzles: new SqlitePuzzleRepository(openDatabase(":memory:")),
+      blobs: new MemoryBlobStore(),
+      clock: new FakeClock(5000),
+    });
+    const made = generate({ width: 7, height: 7, seed: "hint-level", level: "easy" });
+    await puzzles.saveGenerated("e-1", {
+      puzzle: serializePuzzle(made.puzzle),
+      solution: encodeEdges(made.solution),
+      steps: [],
+    });
+    expect(puzzles.get("e-1")?.puzzle.meta?.level).toBe("easy");
+    const hints = new HintManager({ puzzles, attempts: fakeAttempts() });
+    // Easy leaves out every rule group, parity and lookahead (core's LEVEL_SETTINGS).
+    const notEasy = new Set<RuleId>([...Object.values(GROUP_RULES).flat(), "parity", "lookahead"]);
+    const board = new Uint8Array(made.solution.length);
+    for (let i = 0; i < board.length; i++) {
+      const hint = await hints.hint("e-1", encodeEdges(board));
+      if (hint?.kind === "solved") return;
+      if (hint?.kind !== "step") throw new Error(`expected a step, got ${hint?.kind}`);
+      expect(notEasy.has(hint.step.rule)).toBe(false);
+      for (const { edge, state } of hint.step.changes) board[edge] = state;
+    }
+    throw new Error("the hints never solved the puzzle");
+  });
 });
```

#### `apps/server/src/managers/daily-manager.ts`

```diff
diff --git a/apps/server/src/managers/daily-manager.ts b/apps/server/src/managers/daily-manager.ts
index 750ccfb..77c63e9 100644
--- a/apps/server/src/managers/daily-manager.ts
+++ b/apps/server/src/managers/daily-manager.ts
@@ -1,11 +1,29 @@
+import { DEFAULT_LEVEL, type Level } from "@loophole/core";
 import type { DailyRecord } from "../domain.ts";
 import type { Clock, DailyRepository } from "../ports.ts";
 import { addDays, dayStart, utcDay } from "./days.ts";
 import { DailyNotFoundError } from "./errors.ts";
 import type { PuzzleManager } from "./puzzle-manager.ts";
 
-/** The daily size classes (PRD §14 question 6, design kit): each day has a W×W puzzle of each. */
-export const DAILY_SIZES: readonly number[] = [7, 10, 20, 40];
+/**
+ * The daily size classes (PRD §14 question 6, design kit) and the level each one's puzzle is made
+ * at (PRD FR-22, FR-23): each day has a W×W puzzle of each, at that level. One level per size
+ * class; all hard for now (DECISIONS, WT21 "Levels on the server").
+ */
+export const DAILY_CLASSES: readonly { readonly size: number; readonly level: Level }[] = [
+  { size: 7, level: "hard" },
+  { size: 10, level: "hard" },
+  { size: 20, level: "hard" },
+  { size: 40, level: "hard" },
+];
+
+/** The daily size classes, smallest first. */
+export const DAILY_SIZES: readonly number[] = DAILY_CLASSES.map((c) => c.size);
+
+/** The level a size class's daily puzzle is made at; hard for a size without a daily. */
+export function dailyLevel(size: number): Level {
+  return DAILY_CLASSES.find((c) => c.size === size)?.level ?? DEFAULT_LEVEL;
+}
 
 /** A day's daily puzzles. */
 export interface DailySet {
@@ -14,8 +32,15 @@ export interface DailySet {
   readonly live: boolean;
   /** When the next day's puzzles come out: the next 00:00 UTC. */
   readonly nextAt: number;
-  /** One per size class, smallest first; `puzzleId` is null while the puzzle isn't ready. */
-  readonly puzzles: readonly { readonly size: number; readonly puzzleId: string | null }[];
+  /**
+   * One per size class, smallest first; `puzzleId` is null while the puzzle isn't ready. `level` is
+   * the stored puzzle's, or the size class's while there is none.
+   */
+  readonly puzzles: readonly {
+    readonly size: number;
+    readonly level: Level;
+    readonly puzzleId: string | null;
+  }[];
 }
 
 export interface DailyManagerDeps {
@@ -54,8 +79,12 @@ export class DailyManager {
       puzzles: DAILY_SIZES.map((size) => {
         const puzzleId = rows.get(size)?.puzzleId ?? null;
         // An admin may have unpublished a broken daily.
-        const visible = puzzleId !== null && puzzles.get(puzzleId) !== null;
-        return { size, puzzleId: visible ? puzzleId : null };
+        const record = puzzleId === null ? null : puzzles.get(puzzleId);
+        return {
+          size,
+          level: record?.level ?? dailyLevel(size),
+          puzzleId: record === null ? null : puzzleId,
+        };
       }),
     };
   }
```

#### `apps/server/src/managers/daily-manager.test.ts`

```diff
diff --git a/apps/server/src/managers/daily-manager.test.ts b/apps/server/src/managers/daily-manager.test.ts
index 257bc13..11976a4 100644
--- a/apps/server/src/managers/daily-manager.test.ts
+++ b/apps/server/src/managers/daily-manager.test.ts
@@ -25,7 +25,11 @@ describe("DailyManager (FR-22)", () => {
       day: "2026-10-25",
       live: true,
       nextAt: MIDNIGHT,
-      puzzles: DAILY_SIZES.map((size) => ({ size, puzzleId: size === 7 ? "d7" : null })),
+      puzzles: DAILY_SIZES.map((size) => ({
+        size,
+        level: "hard",
+        puzzleId: size === 7 ? "d7" : null,
+      })),
     });
   });
 
@@ -37,7 +41,7 @@ describe("DailyManager (FR-22)", () => {
     expect(() => manager.forDay("2026-10-26")).toThrow(DailyNotFoundError);
     clock.time = MIDNIGHT;
     expect(manager.today()).toBe("2026-10-26");
-    expect(manager.forDay().puzzles[0]).toEqual({ size: 7, puzzleId: "tomorrow" });
+    expect(manager.forDay().puzzles[0]).toEqual({ size: 7, level: "hard", puzzleId: "tomorrow" });
     expect(manager.forDay("2026-10-25")).toMatchObject({
       live: false,
       nextAt: MIDNIGHT + 86_400_000,
```

#### `apps/server/src/managers/daily-stock-manager.ts`

```diff
diff --git a/apps/server/src/managers/daily-stock-manager.ts b/apps/server/src/managers/daily-stock-manager.ts
index b809305..87966d1 100644
--- a/apps/server/src/managers/daily-stock-manager.ts
+++ b/apps/server/src/managers/daily-stock-manager.ts
@@ -1,6 +1,6 @@
 import type { DailyRecord, GeneratedPuzzle } from "../domain.ts";
 import type { Clock, DailyRepository, DailySeeder, WorkerMetrics } from "../ports.ts";
-import { DAILY_SIZES } from "./daily-manager.ts";
+import { DAILY_SIZES, dailyLevel } from "./daily-manager.ts";
 import { addDays, dayStart, utcDay } from "./days.ts";
 import type { JobManager } from "./job-manager.ts";
 import type { PuzzleManager } from "./puzzle-manager.ts";
@@ -119,6 +119,7 @@ export class DailyStockManager {
         height: size,
         seed: seeds.seed(day, size, attempt),
         day,
+        level: dailyLevel(size),
       });
       return true;
     });
```

#### `apps/server/src/managers/daily-stock-manager.test.ts`

```diff
diff --git a/apps/server/src/managers/daily-stock-manager.test.ts b/apps/server/src/managers/daily-stock-manager.test.ts
index a7f8d01..b122147 100644
--- a/apps/server/src/managers/daily-stock-manager.test.ts
+++ b/apps/server/src/managers/daily-stock-manager.test.ts
@@ -11,7 +11,7 @@ import {
   fakeSeeds,
   sequentialIds,
 } from "../test-support/fakes.ts";
-import { DailyManager } from "./daily-manager.ts";
+import { DailyManager, dailyLevel } from "./daily-manager.ts";
 import { DailyStockManager } from "./daily-stock-manager.ts";
 import { JobManager } from "./job-manager.ts";
 import { PuzzleManager } from "./puzzle-manager.ts";
@@ -68,8 +68,12 @@ describe("DailyStockManager.stock (FR-22)", () => {
     expect(queue.get("j-1")).toMatchObject({
       kind: "generate",
       status: "queued",
-      input: { width: 7, height: 7, seed: "2026-10-25/7/0", day: "2026-10-25" },
+      input: { width: 7, height: 7, seed: "2026-10-25/7/0", day: "2026-10-25", level: "hard" },
     });
+    // Each size class at its own level (one level per size, PRD FR-22).
+    for (const job of queue.jobs.values()) {
+      if (job.kind === "generate") expect(job.input.level).toBe(dailyLevel(job.input.width));
+    }
     expect(queue.get("j-8")?.input).toMatchObject({ width: 40, day: "2026-10-26" });
     expect(repo.get("2026-10-26", 40)).toMatchObject({ attempt: 0, jobId: "j-8", puzzleId: null });
     // Running again while the jobs wait queues nothing more.
@@ -93,7 +97,7 @@ describe("DailyStockManager.stock (FR-22)", () => {
       clues: ".".repeat(49),
     });
     expect(stock.stock().missingToday).toEqual([10, 20, 40]);
-    expect(dailies.forDay().puzzles[0]).toEqual({ size: 7, puzzleId: "j-1" });
+    expect(dailies.forDay().puzzles[0]).toEqual({ size: 7, level: "hard", puzzleId: "j-1" });
 
     // Tomorrow's is stored the day before and stays hidden until midnight.
     await stock.complete("j-5", "2026-10-26", generated(7));
```

#### `apps/server/src/managers/attempt-manager.ts`

```diff
diff --git a/apps/server/src/managers/attempt-manager.ts b/apps/server/src/managers/attempt-manager.ts
index 845e015..43992da 100644
--- a/apps/server/src/managers/attempt-manager.ts
+++ b/apps/server/src/managers/attempt-manager.ts
@@ -1,4 +1,4 @@
-import { decodeEdges, EdgeState, FormatError } from "@loophole/core";
+import { decodeEdges, EdgeState, FormatError, type Level } from "@loophole/core";
 import type { AttemptRecord, DailyRecord, PuzzleRecord } from "../domain.ts";
 import type { AttemptRepository, Clock } from "../ports.ts";
 import type { DailyManager } from "./daily-manager.ts";
@@ -60,7 +60,7 @@ export interface DailySummary {
   /** Best ranked time per leaderboard bucket. */
   readonly bests: readonly {
     readonly area: number;
-    readonly level: number;
+    readonly level: Level;
     readonly timeMs: number;
   }[];
 }
```

#### `apps/server/src/managers/attempt-manager.test.ts`

```diff
diff --git a/apps/server/src/managers/attempt-manager.test.ts b/apps/server/src/managers/attempt-manager.test.ts
index 176622f..44943ea 100644
--- a/apps/server/src/managers/attempt-manager.test.ts
+++ b/apps/server/src/managers/attempt-manager.test.ts
@@ -60,7 +60,7 @@ describe("AttemptManager.start", () => {
         puzzleId: "d25",
         day: "2026-10-25",
         area: 4,
-        level: 1,
+        level: "hard",
         startedAt: T0,
         finishedAt: null,
         timeMs: null,
@@ -275,7 +275,7 @@ describe("AttemptManager.summary (FR-24)", () => {
     const both = manager.summary("u1");
     expect(both.streak).toBe(2);
     expect(both.attempts.map((a) => a.attempt.puzzleId)).toEqual(["d25"]);
-    expect(both.bests).toEqual([{ area: 4, level: 1, timeMs: 60_000 }]);
+    expect(both.bests).toEqual([{ area: 4, level: "hard", timeMs: 60_000 }]);
 
     // Two days later without playing, the streak is gone.
     clock.time = MIDNIGHT + 86_400_000;
```

#### `apps/server/src/managers/leaderboard-manager.ts`

```diff
diff --git a/apps/server/src/managers/leaderboard-manager.ts b/apps/server/src/managers/leaderboard-manager.ts
index 4962dac..474d84a 100644
--- a/apps/server/src/managers/leaderboard-manager.ts
+++ b/apps/server/src/managers/leaderboard-manager.ts
@@ -1,3 +1,4 @@
+import type { Level } from "@loophole/core";
 import type { LeaderboardEntry, LeaderboardSlice } from "../domain.ts";
 import type { AttemptRepository } from "../ports.ts";
 import type { DailyManager } from "./daily-manager.ts";
@@ -8,7 +9,7 @@ import type { PuzzleManager } from "./puzzle-manager.ts";
 export interface Leaderboard {
   /** The bucket (PRD FR-23): width × height, and the level. */
   readonly area: number;
-  readonly level: number;
+  readonly level: Level;
   /** How many players are on it. */
   readonly total: number;
   /** The top rows, then the viewer's row and its neighbours, by rank. */
@@ -46,7 +47,7 @@ export class LeaderboardManager {
   }
 
   /** The all-time board of one bucket: each player's best ranked time. */
-  forBucket(area: number, level: number, viewerId: string | null, limit: number): Leaderboard {
+  forBucket(area: number, level: Level, viewerId: string | null, limit: number): Leaderboard {
     const slice = this.#deps.attempts.bucketBoard(area, level, viewerId, limit);
     return board(area, level, slice, viewerId);
   }
@@ -54,7 +55,7 @@ export class LeaderboardManager {
 
 function board(
   area: number,
-  level: number,
+  level: Level,
   slice: LeaderboardSlice,
   viewerId: string | null,
 ): Leaderboard {
```

#### `apps/server/src/managers/leaderboard-manager.test.ts`

```diff
diff --git a/apps/server/src/managers/leaderboard-manager.test.ts b/apps/server/src/managers/leaderboard-manager.test.ts
index 37b0a0e..318d436 100644
--- a/apps/server/src/managers/leaderboard-manager.test.ts
+++ b/apps/server/src/managers/leaderboard-manager.test.ts
@@ -36,7 +36,7 @@ async function setup() {
       puzzleId,
       day: puzzleId === "d24" ? "2026-10-24" : "2026-10-25",
       area: 4,
-      level: 1,
+      level: "hard",
       startedAt: 0,
       finishedAt: timeMs,
       timeMs,
@@ -57,7 +57,7 @@ describe("LeaderboardManager (FR-23)", () => {
     names.set("u2", "tsuru", 0);
     expect(manager.forPuzzle("d25", "u1", 10)).toEqual({
       area: 4,
-      level: 1,
+      level: "hard",
       total: 2,
       entries: [
         { rank: 1, userId: "u2", name: "tsuru", timeMs: 7000 },
@@ -83,13 +83,13 @@ describe("LeaderboardManager (FR-23)", () => {
     solve("u1", "d24", 5000);
     solve("u1", "d25", 3000);
     solve("u2", "d24", 4000);
-    expect(manager.forBucket(4, 1, null, 10).entries).toEqual([
+    expect(manager.forBucket(4, "hard", null, 10).entries).toEqual([
       { rank: 1, userId: "u1", name: null, timeMs: 3000 },
       { rank: 2, userId: "u2", name: null, timeMs: 4000 },
     ]);
-    expect(manager.forBucket(49, 1, "u1", 10)).toEqual({
+    expect(manager.forBucket(49, "hard", "u1", 10)).toEqual({
       area: 49,
-      level: 1,
+      level: "hard",
       total: 0,
       entries: [],
       me: null,
```

#### `apps/server/src/managers/progress-manager.test.ts`

```diff
diff --git a/apps/server/src/managers/progress-manager.test.ts b/apps/server/src/managers/progress-manager.test.ts
index 889dd30..e401bee 100644
--- a/apps/server/src/managers/progress-manager.test.ts
+++ b/apps/server/src/managers/progress-manager.test.ts
@@ -27,7 +27,7 @@ function setup() {
       puzzle: createPuzzle(2, 2, [2, 2, 2, 2]),
       origin: "generated",
       status,
-      level: 1,
+      level: "hard",
       solutionKey: `puzzles/${id}/solution.txt`,
       traceKey: null,
       createdAt: 0,
```

#### `apps/server/src/managers/job-manager.ts`

```diff
diff --git a/apps/server/src/managers/job-manager.ts b/apps/server/src/managers/job-manager.ts
index 583fe41..6ca3307 100644
--- a/apps/server/src/managers/job-manager.ts
+++ b/apps/server/src/managers/job-manager.ts
@@ -1,4 +1,4 @@
-import type { PuzzleWireV1 } from "@loophole/core";
+import { DEFAULT_LEVEL, type Level, type PuzzleWireV1 } from "@loophole/core";
 import type { GenerateInput, Job, JobInput } from "../domain.ts";
 import type { Clock, JobQueue } from "../ports.ts";
 import { QueueFullError } from "./errors.ts";
@@ -16,6 +16,8 @@ export interface GenerateRequest {
   readonly height: number;
   /** Picked at random when absent. */
   readonly seed?: string;
+  /** Hard (core's `DEFAULT_LEVEL`) when absent. */
+  readonly level?: Level;
 }
 
 /** Queues background jobs and reports on them. The worker process runs them (`JobRunManager`). */
@@ -31,7 +33,12 @@ export class JobManager {
     const seed = request.seed ?? this.#deps.newId();
     return this.#enqueue({
       kind: "generate",
-      input: { width: request.width, height: request.height, seed },
+      input: {
+        width: request.width,
+        height: request.height,
+        seed,
+        level: request.level ?? DEFAULT_LEVEL,
+      },
     });
   }
 
```

#### `apps/server/src/managers/job-manager.test.ts`

```diff
diff --git a/apps/server/src/managers/job-manager.test.ts b/apps/server/src/managers/job-manager.test.ts
index 4b60988..e4457ae 100644
--- a/apps/server/src/managers/job-manager.test.ts
+++ b/apps/server/src/managers/job-manager.test.ts
@@ -23,13 +23,19 @@ describe("JobManager", () => {
       id: "j-1",
       kind: "generate",
       status: "queued",
-      input: { width: 10, height: 7, seed: "abc" },
+      input: { width: 10, height: 7, seed: "abc", level: "hard" },
       createdAt: 42,
     });
     expect(manager.get("j-1")).toEqual(job);
     expect(manager.get("nope")).toBeNull();
   });
 
+  test("enqueueGenerate takes the level asked for, hard by default (FR-7)", () => {
+    const { manager } = setup();
+    const job = manager.enqueueGenerate({ width: 5, height: 5, level: "easy" });
+    expect(job.kind === "generate" && job.input.level).toBe("easy");
+  });
+
   test("enqueueGenerate picks a random seed when none is given", () => {
     const { manager } = setup();
     const job = manager.enqueueGenerate({ width: 5, height: 5 });
```

### 1.6 The worker's task passes the level

Test: `runTask` at easy/medium writes `meta.level`; hard (and no level) leaves it out and equals the default.

#### `apps/server/src/adapters/tasks/run-task.ts`

```diff
diff --git a/apps/server/src/adapters/tasks/run-task.ts b/apps/server/src/adapters/tasks/run-task.ts
index 68faede..896b884 100644
--- a/apps/server/src/adapters/tasks/run-task.ts
+++ b/apps/server/src/adapters/tasks/run-task.ts
@@ -27,11 +27,12 @@ export function runTask(task: Task, onProgress: (progress: number) => void): Tas
   };
   switch (task.kind) {
     case "generate": {
-      const { width, height, seed } = task.input;
+      const { width, height, seed, level } = task.input;
       const result = generate({
         width,
         height,
         seed,
+        level,
         onProgress: ({ done, total }) => report((REMOVAL_SHARE * done) / total),
       });
       return {
```

#### `apps/server/src/adapters/tasks/run-task.test.ts`

```diff
diff --git a/apps/server/src/adapters/tasks/run-task.test.ts b/apps/server/src/adapters/tasks/run-task.test.ts
index f094792..c526592 100644
--- a/apps/server/src/adapters/tasks/run-task.test.ts
+++ b/apps/server/src/adapters/tasks/run-task.test.ts
@@ -19,6 +19,22 @@ describe("runTask", () => {
     expect(seen.at(-1)).toBeLessThanOrEqual(0.9);
   });
 
+  test("generate makes the puzzle at the level asked for, and hard without one (FR-7)", () => {
+    const at = (level?: "easy" | "medium" | "hard") => {
+      const out = runTask(
+        { kind: "generate", input: { width: 6, height: 6, seed: "run-task-level", level } },
+        () => {},
+      );
+      if (out.kind !== "generate") throw new Error("expected generate output");
+      return out.generated;
+    };
+    expect(at("easy").puzzle.meta?.level).toBe("easy");
+    expect(at("medium").puzzle.meta?.level).toBe("medium");
+    // Hard is the default, and the generator leaves `meta.level` out for it.
+    expect(at("hard").puzzle.meta?.level).toBeUndefined();
+    expect(at()).toEqual(at("hard"));
+  });
+
   test("verify reports unique with the solution, and multiple", () => {
     const unique = serializePuzzle(createPuzzle(2, 2, [2, 2, 2, 2]));
     expect(runTask({ kind: "verify", input: { puzzle: unique } }, () => {})).toEqual({
```

### 1.7 API schemas and routes

`LevelSchema` (registered `Level`), `level` on `Puzzle`/`PuzzleSummary`, optional `level` enum on `GenerateRequest`; daily schemas use `LevelSchema`; the bucket query is `z.enum(LEVELS).default("hard")` (unregistered, so no `$ref` with a default). `toPuzzleDto`/`toPuzzleSummary` add `level`. Tests: DTO and list carry `level`; an easy puzzle is served with `level: "easy"` and `meta.level`; generate stores `level: "hard"` by default and takes `"medium"`; `level: "expert"` is 400; daily set entries have `level`.

#### `apps/server/src/api/schemas.ts`

```diff
diff --git a/apps/server/src/api/schemas.ts b/apps/server/src/api/schemas.ts
index f5d08a0..6f70b0a 100644
--- a/apps/server/src/api/schemas.ts
+++ b/apps/server/src/api/schemas.ts
@@ -1,5 +1,5 @@
 import { z } from "@hono/zod-openapi";
-import { RULE_IDS } from "@loophole/core";
+import { LEVELS, RULE_IDS } from "@loophole/core";
 
 // Request and response bodies of the HTTP API. These are the wire shapes the OpenAPI document and
 // the generated client are built from; routes translate them to and from domain types.
@@ -36,17 +36,30 @@ export const PuzzleWireSchema = z
 
 export const PuzzleOriginSchema = z.enum(["generated", "submitted"]).openapi("PuzzleOrigin");
 
+export const LevelSchema = z.enum(LEVELS).openapi("Level", {
+  description:
+    "Difficulty level (PRD FR-7): which rules the generator's solver may use and how many clues stay, easiest first. Hints use the puzzle's level. Submitted puzzles count as hard.",
+});
+
 export const PuzzleSchema = z
   .object({
     id: Id,
     puzzle: PuzzleWireSchema,
     origin: PuzzleOriginSchema,
+    level: LevelSchema,
     createdAt: Timestamp,
   })
   .openapi("Puzzle", { description: "A published puzzle: clues only, never the solution." });
 
 export const PuzzleSummarySchema = z
-  .object({ id: Id, width: Size, height: Size, origin: PuzzleOriginSchema, createdAt: Timestamp })
+  .object({
+    id: Id,
+    width: Size,
+    height: Size,
+    origin: PuzzleOriginSchema,
+    level: LevelSchema,
+    createdAt: Timestamp,
+  })
   .openapi("PuzzleSummary");
 
 export const PuzzleListSchema = z
@@ -68,12 +81,13 @@ export const GenerateRequestSchema = z
   .strictObject({
     width: Size,
     height: Size,
-    seed: z
-      .string()
-      .min(1)
-      .max(128)
-      .optional()
-      .openapi({ description: "Same seed, size and generator version give the same puzzle." }),
+    seed: z.string().min(1).max(128).optional().openapi({
+      description: "Same seed, size, level and generator version give the same puzzle.",
+    }),
+    level: z.enum(LEVELS).optional().openapi({
+      description:
+        "Default hard. A board too small for the level's rules gets the next level up; the puzzle's `level` says which.",
+    }),
   })
   .openapi("GenerateRequest");
 
```

#### `apps/server/src/api/daily-schemas.ts`

```diff
diff --git a/apps/server/src/api/daily-schemas.ts b/apps/server/src/api/daily-schemas.ts
index 5c78d4c..8c22bc6 100644
--- a/apps/server/src/api/daily-schemas.ts
+++ b/apps/server/src/api/daily-schemas.ts
@@ -1,6 +1,7 @@
 import { z } from "@hono/zod-openapi";
+import { LEVELS } from "@loophole/core";
 import { isDay } from "../managers/days.ts";
-import { EdgesSchema } from "./schemas.ts";
+import { EdgesSchema, LevelSchema } from "./schemas.ts";
 
 // Request and response bodies of the daily puzzle, ranked attempt, leaderboard and display name
 // routes (daily.ts).
@@ -31,6 +32,7 @@ export const DailySetSchema = z
     puzzles: z.array(
       z.object({
         size: z.int().min(1).max(100).openapi({ description: "The puzzle is size × size." }),
+        level: LevelSchema,
         puzzleId: z.union([Id, z.null()]).openapi({
           description: "Null while the puzzle isn't ready. Open it with GET /api/puzzles/{id}.",
         }),
@@ -55,7 +57,7 @@ export const AttemptSchema = z
     puzzleId: Id,
     day: Day,
     area: z.int().min(1).openapi({ description: "Width × height: the leaderboard bucket." }),
-    level: z.int(),
+    level: LevelSchema,
     status: z.enum(["playing", "finished"]),
     startedAt: Timestamp,
     finishedAt: z.union([Timestamp, z.null()]),
@@ -101,7 +103,7 @@ export const DailySummarySchema = z
       .openapi({ description: "The last seven days, oldest first." }),
     attempts: z.array(AttemptSchema).openapi({ description: "Today's attempts." }),
     bests: z
-      .array(z.object({ area: z.int(), level: z.int(), timeMs: Ms }))
+      .array(z.object({ area: z.int(), level: LevelSchema, timeMs: Ms }))
       .openapi({ description: "Best ranked time per leaderboard bucket." }),
   })
   .openapi("DailySummary");
@@ -124,7 +126,7 @@ export const BucketBoardParamSchema = z.object({
 });
 
 export const BucketBoardQuerySchema = LeaderboardQuerySchema.extend({
-  level: z.coerce.number().int().min(1).max(100).default(1).openapi({ example: 1 }),
+  level: z.enum(LEVELS).default("hard").openapi({ example: "hard" }),
 });
 
 const LeaderboardEntrySchema = z
@@ -141,7 +143,7 @@ const LeaderboardEntrySchema = z
 export const LeaderboardSchema = z
   .object({
     area: z.int(),
-    level: z.int(),
+    level: LevelSchema,
     total: z.int().min(0).openapi({ description: "How many players are on the board." }),
     entries: z.array(LeaderboardEntrySchema).openapi({
       description:
```

#### `apps/server/src/api/app.ts`

```diff
diff --git a/apps/server/src/api/app.ts b/apps/server/src/api/app.ts
index 45af8e6..0696575 100644
--- a/apps/server/src/api/app.ts
+++ b/apps/server/src/api/app.ts
@@ -291,6 +291,7 @@ function toPuzzleDto(r: PuzzleRecord) {
     id: r.id,
     puzzle: serializePuzzle(r.puzzle),
     origin: r.origin,
+    level: r.level,
     createdAt: iso(r.createdAt),
   };
 }
@@ -301,6 +302,7 @@ function toPuzzleSummary(r: PuzzleRecord) {
     width: r.puzzle.grid.width,
     height: r.puzzle.grid.height,
     origin: r.origin,
+    level: r.level,
     createdAt: iso(r.createdAt),
   };
 }
```

#### `apps/server/src/api/app.test.ts`

```diff
diff --git a/apps/server/src/api/app.test.ts b/apps/server/src/api/app.test.ts
index 02594b4..b8109b3 100644
--- a/apps/server/src/api/app.test.ts
+++ b/apps/server/src/api/app.test.ts
@@ -55,7 +55,7 @@ function setup(options: { webDir?: string; maxQueued?: number } = {}) {
       solution: SOLUTION,
       steps: [],
     });
-  return { app, repo, queue, clock, savePuzzle };
+  return { app, repo, queue, clock, puzzles, savePuzzle };
 }
 
 const postJson = (body: unknown) => ({
@@ -91,12 +91,28 @@ describe("puzzles", () => {
       id,
       puzzle: { v: 1, width: 2, height: 2, clues: "2222", seed: "s", meta: { generator: "1" } },
       origin: "generated",
+      level: "hard",
       createdAt: "2026-10-25T12:00:00.000Z",
     });
     expect(text).not.toContain(SOLUTION);
     expect(text).not.toContain("solution");
   });
 
+  test("a puzzle made below hard is served with its level, in the DTO and in meta (FR-7)", async () => {
+    const { app, puzzles } = setup();
+    const wire = serializePuzzle(
+      createPuzzle(2, 2, [2, 2, 2, 2], { seed: "s", meta: { generator: "6", level: "easy" } }),
+    );
+    await puzzles.saveGenerated("easy-1", { puzzle: wire, solution: SOLUTION, steps: [] });
+    const body = await (await app.request("/api/puzzles/easy-1")).json();
+    expect(body).toMatchObject({
+      level: "easy",
+      puzzle: { meta: { generator: "6", level: "easy" } },
+    });
+    const list = await (await app.request("/api/puzzles")).json();
+    expect(list).toMatchObject({ items: [{ id: "easy-1", level: "easy" }] });
+  });
+
   test("GET /api/puzzles/{id} is 404 for unknown and unpublished puzzles", async () => {
     const { app, repo, savePuzzle } = setup();
     const id = await savePuzzle();
@@ -115,7 +131,14 @@ describe("puzzles", () => {
     const res = await app.request("/api/puzzles?limit=1");
     expect(await res.json()).toEqual({
       items: [
-        { id: b, width: 2, height: 2, origin: "generated", createdAt: "2026-10-25T12:00:01.000Z" },
+        {
+          id: b,
+          width: 2,
+          height: 2,
+          origin: "generated",
+          level: "hard",
+          createdAt: "2026-10-25T12:00:01.000Z",
+        },
       ],
     });
     const all = (await (await app.request("/api/puzzles")).json()) as { items: { id: string }[] };
@@ -196,7 +219,17 @@ describe("jobs", () => {
       startedAt: null,
       finishedAt: null,
     });
-    expect(queue.get("j-1")?.input).toEqual({ width: 10, height: 7, seed: "x" });
+    expect(queue.get("j-1")?.input).toEqual({ width: 10, height: 7, seed: "x", level: "hard" });
+  });
+
+  test("POST /api/jobs/generate takes a level (FR-7)", async () => {
+    const { app, queue } = setup();
+    const res = await app.request(
+      "/api/jobs/generate",
+      postJson({ width: 7, height: 7, level: "medium" }),
+    );
+    expect(res.status).toBe(202);
+    expect(queue.get("j-2")?.input).toMatchObject({ width: 7, height: 7, level: "medium" });
   });
 
   test("POST /api/jobs/generate validates the body", async () => {
@@ -209,6 +242,7 @@ describe("jobs", () => {
       { width: 5, height: 5, seed: "" },
       { width: 5, height: 5, seed: "x".repeat(129) },
       { width: 5, height: 5, extra: true },
+      { width: 5, height: 5, level: "expert" },
     ]) {
       const problem = await expectProblem(
         await app.request("/api/jobs/generate", postJson(body)),
```

#### `apps/server/src/api/daily.test.ts`

```diff
diff --git a/apps/server/src/api/daily.test.ts b/apps/server/src/api/daily.test.ts
index 51864eb..186645f 100644
--- a/apps/server/src/api/daily.test.ts
+++ b/apps/server/src/api/daily.test.ts
@@ -119,21 +119,21 @@ describe("GET /api/daily (FR-22)", () => {
       live: true,
       nextAt: "2026-10-26T00:00:00.000Z",
       puzzles: [
-        { size: 7, puzzleId: "d25" },
-        { size: 10, puzzleId: null },
-        { size: 20, puzzleId: null },
-        { size: 40, puzzleId: null },
+        { size: 7, level: "hard", puzzleId: "d25" },
+        { size: 10, level: "hard", puzzleId: null },
+        { size: 20, level: "hard", puzzleId: null },
+        { size: 40, level: "hard", puzzleId: null },
       ],
     });
     const past = (await (await send("GET", "/api/daily?day=2026-10-24")).json()) as DailySet;
     expect(past).toMatchObject({ day: "2026-10-24", live: false });
-    expect(past.puzzles[0]).toEqual({ size: 7, puzzleId: "d24" });
+    expect(past.puzzles[0]).toEqual({ size: 7, level: "hard", puzzleId: "d24" });
     await expectProblem(await send("GET", "/api/daily?day=2026-10-26"), 404);
     await expectProblem(await send("GET", "/api/daily?day=2026-02-30"), 400);
     clock.time = MIDNIGHT;
     const next = (await (await send("GET", "/api/daily")).json()) as DailySet;
     expect(next).toMatchObject({ day: "2026-10-26", live: true });
-    expect(next.puzzles[0]).toEqual({ size: 7, puzzleId: "d26" });
+    expect(next.puzzles[0]).toEqual({ size: 7, level: "hard", puzzleId: "d26" });
   });
 
   test("a daily is served with clues only, no seed or generator version, and only from its day (FR-25)", async () => {
@@ -183,7 +183,7 @@ describe("ranked attempts (FR-17, FR-25)", () => {
         puzzleId: "d25",
         day: "2026-10-25",
         area: 4,
-        level: 1,
+        level: "hard",
         status: "playing",
         startedAt: new Date(T0).toISOString(),
         finishedAt: null,
@@ -211,7 +211,7 @@ describe("ranked attempts (FR-17, FR-25)", () => {
       day: "2026-10-25",
       streak: 1,
       attempts: [{ puzzleId: "d25", rank: 1 }],
-      bests: [{ area: 4, level: 1, timeMs: 64_000 }],
+      bests: [{ area: 4, level: "hard", timeMs: 64_000 }],
     });
     expect(summary.week).toHaveLength(7);
   });
@@ -363,7 +363,7 @@ describe("leaderboards (FR-23)", () => {
     const board = await res.json();
     expect(board).toEqual({
       area: 4,
-      level: 1,
+      level: "hard",
       total: 2,
       entries: [
         { rank: 1, name: "tsuru", timeMs: 50_000, me: false },
@@ -378,7 +378,7 @@ describe("leaderboards (FR-23)", () => {
     const guest = (await (
       await send("GET", "/api/leaderboards/areas/4?limit=1")
     ).json()) as Leaderboard;
-    expect(guest).toMatchObject({ area: 4, level: 1, total: 2, me: null });
+    expect(guest).toMatchObject({ area: 4, level: "hard", total: 2, me: null });
     expect(guest.entries).toEqual([{ rank: 1, name: "tsuru", timeMs: 50_000, me: false }]);
     await expectProblem(await send("GET", "/api/leaderboards/daily/d26"), 404);
     await expectProblem(await send("GET", "/api/leaderboards/areas/0"), 400);
```

### 1.8 `gen:api` and the web app's consumers of the changed types

Run `bun run gen:api` (regenerates `openapi.yaml` and `packages/api-client/src/schema.ts`). Then the web compiles again with: `bucketBoard(area, level, limit)`; the leaderboard page reads today's set first and passes the size's `level` for "All time"; mocks and unit fixtures use `"hard"` and give daily set entries a level.

#### `apps/web/src/lib/daily/api.ts`

```diff
diff --git a/apps/web/src/lib/daily/api.ts b/apps/web/src/lib/daily/api.ts
index 811fe80..595c278 100644
--- a/apps/web/src/lib/daily/api.ts
+++ b/apps/web/src/lib/daily/api.ts
@@ -1,4 +1,5 @@
 import type { ApiClient, Schemas } from "@loophole/api-client";
+import type { Level } from "@loophole/core";
 import { failureMessage } from "../auth/auth.ts";
 
 export type DailySet = Schemas["DailySet"];
@@ -99,11 +100,14 @@ export function createDailyApi(client: ApiClient) {
         }),
       ),
 
-    /** The all-time leaderboard of an area (width × height), or null when it can't be read. */
-    bucketBoard: (area: number, limit = BOARD_LIMIT) =>
+    /**
+     * The all-time leaderboard of an area (width × height) and level, or null when it can't be
+     * read.
+     */
+    bucketBoard: (area: number, level: Level, limit = BOARD_LIMIT) =>
       read(() =>
         client.GET("/api/leaderboards/areas/{area}", {
-          params: { path: { area }, query: { limit, level: 1 } },
+          params: { path: { area }, query: { limit, level } },
         }),
       ),
 
```

#### `apps/web/src/routes/leaderboard/+page.svelte`

```diff
diff --git a/apps/web/src/routes/leaderboard/+page.svelte b/apps/web/src/routes/leaderboard/+page.svelte
index 080b96a..7a71a95 100644
--- a/apps/web/src/routes/leaderboard/+page.svelte
+++ b/apps/web/src/routes/leaderboard/+page.svelte
@@ -24,14 +24,16 @@
     const latest = () => token === loads;
     board = undefined;
     missing = false;
+    const today = await daily.day();
+    if (!latest()) return;
+    const ofSize = today?.puzzles.find((p) => p.size === forSize);
     if (forScope === "all") {
-      const result = await daily.bucketBoard(forSize * forSize);
+      // The bucket is the size's area at the level its dailies are made at (PRD FR-23).
+      const result = await daily.bucketBoard(forSize * forSize, ofSize?.level ?? "hard");
       if (latest()) board = result;
       return;
     }
-    const today = await daily.day();
-    if (!latest()) return;
-    const puzzleId = today?.puzzles.find((p) => p.size === forSize)?.puzzleId ?? null;
+    const puzzleId = ofSize?.puzzleId ?? null;
     if (today !== null && puzzleId === null) {
       missing = true;
       board = null;
```

#### `apps/web/src/lib/daily/api.test.ts`

```diff
diff --git a/apps/web/src/lib/daily/api.test.ts b/apps/web/src/lib/daily/api.test.ts
index 75b9156..b03afbd 100644
--- a/apps/web/src/lib/daily/api.test.ts
+++ b/apps/web/src/lib/daily/api.test.ts
@@ -6,7 +6,7 @@ const SET = {
   day: "2026-10-25",
   live: true,
   nextAt: "2026-10-26T00:00:00.000Z",
-  puzzles: [{ size: 7, puzzleId: "d7" }],
+  puzzles: [{ size: 7, level: "hard" as const, puzzleId: "d7" }],
 };
 
 /** A daily API whose fetch answers `respond` for every request, recording what was sent. */
@@ -52,7 +52,7 @@ describe("createDailyApi", () => {
       puzzleId: "d7",
       day: "2026-10-25",
       area: 49,
-      level: 1,
+      level: "hard",
       status: "playing",
       startedAt: "2026-10-25T10:00:00.000Z",
       finishedAt: null,
```

#### `apps/web/src/lib/daily/finish.test.ts`

```diff
diff --git a/apps/web/src/lib/daily/finish.test.ts b/apps/web/src/lib/daily/finish.test.ts
index 3d58792..c3094a9 100644
--- a/apps/web/src/lib/daily/finish.test.ts
+++ b/apps/web/src/lib/daily/finish.test.ts
@@ -7,7 +7,7 @@ const ATTEMPT: Attempt = {
   puzzleId: "d1",
   day: "2026-10-25",
   area: 49,
-  level: 1,
+  level: "hard",
   status: "finished",
   startedAt: "2026-10-25T10:00:00.000Z",
   finishedAt: "2026-10-25T10:03:18.000Z",
```

#### `apps/web/src/lib/daily/view.test.ts`

```diff
diff --git a/apps/web/src/lib/daily/view.test.ts b/apps/web/src/lib/daily/view.test.ts
index 9457489..7ce4bce 100644
--- a/apps/web/src/lib/daily/view.test.ts
+++ b/apps/web/src/lib/daily/view.test.ts
@@ -17,7 +17,7 @@ const PLAYING: Attempt = {
   puzzleId: "d1",
   day: "2026-10-25",
   area: 49,
-  level: 1,
+  level: "hard",
   status: "playing",
   startedAt: "2026-10-25T10:00:00.000Z",
   finishedAt: null,
```

#### `apps/web/src/lib/puzzles/api.test.ts`

```diff
diff --git a/apps/web/src/lib/puzzles/api.test.ts b/apps/web/src/lib/puzzles/api.test.ts
index 081b695..db6ccec 100644
--- a/apps/web/src/lib/puzzles/api.test.ts
+++ b/apps/web/src/lib/puzzles/api.test.ts
@@ -7,6 +7,7 @@ const PUZZLE: Schemas["Puzzle"] = {
   id: "p1",
   puzzle: { v: 1, width: 2, height: 2, clues: "2222", seed: "s", meta: { generator: "1" } },
   origin: "generated",
+  level: "hard",
   createdAt: "2026-10-25T12:00:00.000Z",
 };
 
```

#### `apps/web/tests/daily-mocks.ts`

```diff
diff --git a/apps/web/tests/daily-mocks.ts b/apps/web/tests/daily-mocks.ts
index 4d4af38..bd23837 100644
--- a/apps/web/tests/daily-mocks.ts
+++ b/apps/web/tests/daily-mocks.ts
@@ -31,7 +31,7 @@ export function attempt(changes: Partial<Schemas["Attempt"]> = {}): Schemas["Att
     puzzleId: DAILY_ID,
     day: TODAY,
     area: 49,
-    level: 1,
+    level: "hard",
     status: "playing",
     startedAt: new Date().toISOString(),
     finishedAt: null,
@@ -46,7 +46,7 @@ export function attempt(changes: Partial<Schemas["Attempt"]> = {}): Schemas["Att
 /** The Solved artboard's board: the top three, a gap, then the player and their neighbours. */
 export const BOARD: Schemas["Leaderboard"] = {
   area: 49,
-  level: 1,
+  level: "hard",
   total: 480,
   entries: [
     { rank: 1, name: "kuroneko", timeMs: 72_000, me: false },
@@ -103,10 +103,10 @@ export async function mockDailyApi(page: Page, options: MockOptions = {}) {
       live: !ended,
       nextAt: `${dayAfter(served.current)}T00:00:00.000Z`,
       puzzles: [
-        { size: 7, puzzleId: DAILY_ID },
-        { size: 10, puzzleId: null },
-        { size: 20, puzzleId: null },
-        { size: 40, puzzleId: null },
+        { size: 7, level: "hard", puzzleId: DAILY_ID },
+        { size: 10, level: "hard", puzzleId: null },
+        { size: 20, level: "hard", puzzleId: null },
+        { size: 40, level: "hard", puzzleId: null },
       ],
     }),
   );
@@ -115,6 +115,7 @@ export async function mockDailyApi(page: Page, options: MockOptions = {}) {
       id: DAILY_ID,
       puzzle: small7?.wire,
       origin: "generated",
+      level: "hard",
       createdAt: `${TODAY}T00:00:00.000Z`,
     }),
   );
@@ -128,7 +129,7 @@ export async function mockDailyApi(page: Page, options: MockOptions = {}) {
         finished: back > 0,
       })),
       attempts: current === null ? [] : [current],
-      bests: [{ area: 49, level: 1, timeMs: 171_000 }],
+      bests: [{ area: 49, level: "hard", timeMs: 171_000 }],
     }),
   );
   await page.route(`**/api/users/u1/attempts/${DAILY_ID}`, (route) => {
```

### 1.9 Check and commit

`bun run format && bun run check` (868 pass, 3 skip). Commit: `feat(server): store, serve and generate difficulty levels`

## Commit 2 — worker fairness and graceful shutdown (FR-11, FR-26/27, NFR-1, NFR-6)

### 2.1 Migration 008 and its test

Adds `priority` (backfilled from kind/input) and `requester` with their indexes. The migration test gets a second case: jobs inserted before 008 (a player generation, a daily, a verify) come out with priorities 2, 1, 0 and no requester. `database.test.ts` expects version 8.

#### `apps/server/src/adapters/db/migrations/008_job_order.sql` (new file)

```diff
diff --git a/apps/server/src/adapters/db/migrations/008_job_order.sql b/apps/server/src/adapters/db/migrations/008_job_order.sql
new file mode 100644
index 0000000..1afc9d1
--- /dev/null
+++ b/apps/server/src/adapters/db/migrations/008_job_order.sql
@@ -0,0 +1,16 @@
+-- The order workers claim jobs in, and who queued a player's generation (DECISIONS, WT21 "Worker
+-- fairness").
+
+-- Workers claim the queued job with the lowest priority first, oldest first within one: 0 for
+-- verifications, 1 for daily puzzles, 2 for players' generations (JOB_PRIORITY). Jobs queued
+-- before this migration get theirs from their kind and input.
+ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 2 CHECK (priority >= 0);
+UPDATE jobs SET priority = 0 WHERE kind = 'verify';
+UPDATE jobs SET priority = 1 WHERE kind = 'generate' AND json_extract(payload, '$.day') IS NOT NULL;
+CREATE INDEX jobs_by_claim_order ON jobs (status, priority, created_at);
+
+-- Who asked for a player's generation (`user:<id>`, or `ip:<address>` for a guest), so each
+-- requester has a cap on generations queued or running at once. Null for verifications and daily
+-- puzzles, and set to null when the job ends, so no address or account outlives its job (NFR-6).
+ALTER TABLE jobs ADD COLUMN requester TEXT;
+CREATE INDEX jobs_by_requester ON jobs (requester, status) WHERE requester IS NOT NULL;
```

#### `apps/server/src/adapters/db/migrations.test.ts`

```diff
diff --git a/apps/server/src/adapters/db/migrations.test.ts b/apps/server/src/adapters/db/migrations.test.ts
index 2aaba0e..f6b502c 100644
--- a/apps/server/src/adapters/db/migrations.test.ts
+++ b/apps/server/src/adapters/db/migrations.test.ts
@@ -48,3 +48,31 @@ describe("007: levels", () => {
     expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
   });
 });
+
+describe("008: job order", () => {
+  test("queued jobs get their priority from their kind and input, and no requester", () => {
+    const db = migratedFrom(8, (db) => {
+      const job = db.query(
+        "INSERT INTO jobs (id, kind, payload, status, created_at) VALUES ($id, $kind, $payload, 'queued', $at)",
+      );
+      job.run({
+        id: "player",
+        kind: "generate",
+        payload: '{"width":5,"height":5,"seed":"s"}',
+        at: 1,
+      });
+      job.run({
+        id: "daily",
+        kind: "generate",
+        payload: '{"width":7,"height":7,"seed":"s","day":"2026-10-26"}',
+        at: 2,
+      });
+      job.run({ id: "verify", kind: "verify", payload: '{"puzzle":{}}', at: 3 });
+    });
+    expect(db.query("SELECT id, priority, requester FROM jobs ORDER BY created_at").all()).toEqual([
+      { id: "player", priority: 2, requester: null },
+      { id: "daily", priority: 1, requester: null },
+      { id: "verify", priority: 0, requester: null },
+    ]);
+  });
+});
```

#### `apps/server/src/adapters/db/database.test.ts`

```diff
diff --git a/apps/server/src/adapters/db/database.test.ts b/apps/server/src/adapters/db/database.test.ts
index 4f2e989..b28db51 100644
--- a/apps/server/src/adapters/db/database.test.ts
+++ b/apps/server/src/adapters/db/database.test.ts
@@ -40,6 +40,7 @@ describe("openDatabase and migrate", () => {
       { version: 5 },
       { version: 6 },
       { version: 7 },
+      { version: 8 },
     ]);
   });
 
```

### 2.2 Domain and ports

`JOB_PRIORITY`; `Job.priority`/`requester`; `TaskOutcome` `cancelled`; `NewJob.priority?`/`requester?`; `JobQueue.countPending`, `claimNext(…, maxPriority?)`, `release`; `TaskRunOptions.signal?`.

#### `apps/server/src/domain.ts`

```diff
diff --git a/apps/server/src/domain.ts b/apps/server/src/domain.ts
index 5303698..e93905d 100644
--- a/apps/server/src/domain.ts
+++ b/apps/server/src/domain.ts
@@ -41,6 +41,13 @@ export type JobKind = "generate" | "verify";
 
 export type JobStatus = "queued" | "running" | "done" | "failed" | "timeout";
 
+/**
+ * The order workers claim queued jobs in, lowest first and oldest first within one (DECISIONS,
+ * WT21 "Worker fairness"): a player's generation, which can take many minutes at 100×100, never
+ * holds up a submission's check or a daily puzzle that is waiting.
+ */
+export const JOB_PRIORITY = { verify: 0, daily: 1, player: 2 } as const;
+
 export interface GenerateInput {
   readonly width: number;
   readonly height: number;
@@ -69,8 +76,15 @@ interface JobBase {
   readonly progress: number;
   readonly result: JobResult | null;
   readonly error: string | null;
-  /** Times the job has been claimed by a worker. */
+  /** Times the job has been claimed by a worker, not counting claims given back at shutdown. */
   readonly attempts: number;
+  /** Claim order (`JOB_PRIORITY`): lower first. */
+  readonly priority: number;
+  /**
+   * Who queued a player's generation (`user:<id>`, or `ip:<address>` for a guest), for the cap per
+   * requester; null for other jobs, and once the job has ended.
+   */
+  readonly requester: string | null;
   readonly claimedBy: string | null;
   /** Milliseconds since the epoch, like every time below. */
   readonly createdAt: number;
@@ -112,11 +126,15 @@ export type TaskOutput =
   | { readonly kind: "generate"; readonly generated: GeneratedPuzzle }
   | { readonly kind: "verify"; readonly verified: VerifyOutcome };
 
-/** How a task ended. `timeout` means the thread was stopped at the time limit. */
+/**
+ * How a task ended. `timeout` means the thread was stopped at the time limit, `cancelled` that it
+ * was stopped because the worker is shutting down.
+ */
 export type TaskOutcome =
   | { readonly status: "done"; readonly output: TaskOutput }
   | { readonly status: "failed"; readonly error: string }
-  | { readonly status: "timeout" };
+  | { readonly status: "timeout" }
+  | { readonly status: "cancelled" };
 
 /** A registered player (PRD §5). Holds only what NFR-6 allows: the email and the password hash. */
 export interface UserRecord {
```

#### `apps/server/src/ports.ts`

```diff
diff --git a/apps/server/src/ports.ts b/apps/server/src/ports.ts
index 03e5455..26e7cd2 100644
--- a/apps/server/src/ports.ts
+++ b/apps/server/src/ports.ts
@@ -56,6 +56,10 @@ export interface NewJob {
   readonly id: string;
   readonly job: JobInput;
   readonly createdAt: number;
+  /** Claim order (`JOB_PRIORITY`), lower first; `JOB_PRIORITY.player` when left out. */
+  readonly priority?: number;
+  /** Who queued a player's generation (`Job.requester`); null when left out. */
+  readonly requester?: string | null;
 }
 
 /**
@@ -66,17 +70,29 @@ export interface JobQueue {
   enqueue(job: NewJob): Job;
   get(id: string): Job | null;
   countQueued(): number;
+  /** Jobs that `requester` queued which are waiting or running now. */
+  countPending(requester: string): number;
   /** Jobs waiting and running now, and when the oldest waiting one was queued (null if none). */
   countActive(): { queued: number; running: number; oldestQueuedAt: number | null };
   /** The most recently ended jobs that failed or timed out, newest first. */
   listFailed(limit: number): Job[];
-  /** Atomically takes the oldest queued job for `workerId`, or returns null when there is none. */
-  claimNext(workerId: string, now: number): Job | null;
+  /**
+   * Atomically takes the queued job with the lowest priority, the oldest among those, for
+   * `workerId`, or returns null when there is none. With `maxPriority`, only jobs whose priority is
+   * at most that are taken.
+   */
+  claimNext(workerId: string, now: number, maxPriority?: number): Job | null;
   /** Stores progress (0 to 1); also counts as a heartbeat. */
   setProgress(id: string, workerId: string, progress: number, now: number): void;
   heartbeat(id: string, workerId: string, now: number): void;
-  /** Ends a running job. Returns false when the worker no longer holds it. */
+  /** Ends a running job and forgets its requester. Returns false when the worker no longer holds it. */
   finish(id: string, workerId: string, end: JobEnd, now: number): boolean;
+  /**
+   * Gives a running job back to the queue, as it was before `workerId` claimed it (the claim isn't
+   * counted in `attempts`), for a worker that is shutting down. Returns false when the worker no
+   * longer holds it.
+   */
+  release(id: string, workerId: string): boolean;
   /**
    * Running jobs whose last heartbeat is before `staleBefore` go back to the queue, or fail once
    * they have been claimed `maxAttempts` times. Returns how many of each.
@@ -97,6 +113,8 @@ export interface TaskRunOptions {
   readonly timeoutMs: number;
   /** Called with progress from 0 to 1, at most about once per percent. */
   readonly onProgress: (progress: number) => void;
+  /** Stops the task when aborted; it then ends as `cancelled`. */
+  readonly signal?: AbortSignal;
 }
 
 /** Runs CPU-heavy tasks (generation, verification) off the caller's thread. */
```

### 2.3 Job queue and thread runner adapters

SQL as in Design. Tests: enqueue returns `priority: 2, requester: null`; claim order verify-old, verify-new, daily, player-old, player-new; `maxPriority` leaves lower jobs queued; `countPending` counts queued+running per requester and `finish` clears it; `release` only for the holder, `attempts` back to 0, old worker can't finish, next claim makes `attempts: 1`. Thread runner: aborting at 200 ms stops a 100×100 generation within 2 s as `cancelled`; an already-aborted signal starts nothing.

#### `apps/server/src/adapters/db/job-queue.ts`

```diff
diff --git a/apps/server/src/adapters/db/job-queue.ts b/apps/server/src/adapters/db/job-queue.ts
index 4576926..562ed3e 100644
--- a/apps/server/src/adapters/db/job-queue.ts
+++ b/apps/server/src/adapters/db/job-queue.ts
@@ -1,5 +1,5 @@
 import type { Database } from "bun:sqlite";
-import type { Job, JobResult, JobStatus } from "../../domain.ts";
+import { JOB_PRIORITY, type Job, type JobResult, type JobStatus } from "../../domain.ts";
 import type { JobEnd, JobQueue, NewJob } from "../../ports.ts";
 
 interface JobRow {
@@ -11,6 +11,8 @@ interface JobRow {
   result: string | null;
   error: string | null;
   attempts: number;
+  priority: number;
+  requester: string | null;
   claimed_by: string | null;
   created_at: number;
   started_at: number | null;
@@ -20,40 +22,58 @@ interface JobRow {
 
 /**
  * The jobs table as a queue. `claimNext` is one `UPDATE … RETURNING` statement, so two workers
- * (in any processes) can never claim the same job.
+ * (in any processes) can never claim the same job. Jobs are claimed by priority, then oldest first.
  */
 export class SqliteJobQueue implements JobQueue {
   readonly #insert;
   readonly #get;
   readonly #countQueued;
+  readonly #countPending;
   readonly #countActive;
   readonly #listFailed;
   readonly #claim;
   readonly #progress;
   readonly #heartbeat;
   readonly #finish;
+  readonly #release;
   readonly #requeueStale;
   readonly #failStale;
 
   constructor(db: Database) {
-    this.#insert = db.query<JobRow, { id: string; kind: string; payload: string; now: number }>(
-      "INSERT INTO jobs (id, kind, payload, status, created_at) VALUES ($id, $kind, $payload, 'queued', $now) RETURNING *",
+    this.#insert = db.query<
+      JobRow,
+      {
+        id: string;
+        kind: string;
+        payload: string;
+        priority: number;
+        requester: string | null;
+        now: number;
+      }
+    >(
+      "INSERT INTO jobs (id, kind, payload, status, priority, requester, created_at) VALUES ($id, $kind, $payload, 'queued', $priority, $requester, $now) RETURNING *",
     );
     this.#get = db.query<JobRow, { id: string }>("SELECT * FROM jobs WHERE id = $id");
     this.#countQueued = db.query<{ n: number }, []>(
       "SELECT count(*) AS n FROM jobs WHERE status = 'queued'",
     );
+    this.#countPending = db.query<{ n: number }, { requester: string }>(
+      "SELECT count(*) AS n FROM jobs WHERE requester = $requester AND status IN ('queued', 'running')",
+    );
     this.#countActive = db.query<{ status: JobStatus; n: number; oldest: number }, []>(
       "SELECT status, count(*) AS n, min(created_at) AS oldest FROM jobs WHERE status IN ('queued', 'running') GROUP BY status",
     );
     this.#listFailed = db.query<JobRow, { limit: number }>(
       "SELECT * FROM jobs WHERE status IN ('failed', 'timeout') ORDER BY finished_at DESC, rowid DESC LIMIT $limit",
     );
-    this.#claim = db.query<JobRow, { worker: string; now: number }>(
+    this.#claim = db.query<JobRow, { worker: string; now: number; max: number }>(
       `UPDATE jobs
        SET status = 'running', claimed_by = $worker, attempts = attempts + 1,
            started_at = $now, heartbeat_at = $now, progress = 0
-       WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1)
+       WHERE id = (
+           SELECT id FROM jobs WHERE status = 'queued' AND priority <= $max
+           ORDER BY priority, created_at, rowid LIMIT 1
+         )
          AND status = 'queued'
        RETURNING *`,
     );
@@ -76,7 +96,12 @@ export class SqliteJobQueue implements JobQueue {
     >(
       `UPDATE jobs
        SET status = $status, result = $result, error = $error, finished_at = $now,
-           progress = CASE WHEN $status = 'done' THEN 1 ELSE progress END
+           progress = CASE WHEN $status = 'done' THEN 1 ELSE progress END, requester = NULL
+       WHERE id = $id AND status = 'running' AND claimed_by = $worker
+       RETURNING id`,
+    );
+    this.#release = db.query<{ id: string }, { id: string; worker: string }>(
+      `UPDATE jobs SET status = 'queued', claimed_by = NULL, progress = 0, attempts = attempts - 1
        WHERE id = $id AND status = 'running' AND claimed_by = $worker
        RETURNING id`,
     );
@@ -85,16 +110,18 @@ export class SqliteJobQueue implements JobQueue {
        WHERE status = 'running' AND heartbeat_at < $before AND attempts < $max`,
     );
     this.#failStale = db.query<void, { before: number; max: number; now: number }>(
-      `UPDATE jobs SET status = 'failed', error = 'The worker running this job stopped responding.', finished_at = $now
+      `UPDATE jobs SET status = 'failed', error = 'The worker running this job stopped responding.', finished_at = $now, requester = NULL
        WHERE status = 'running' AND heartbeat_at < $before AND attempts >= $max`,
     );
   }
 
-  enqueue({ id, job, createdAt }: NewJob): Job {
+  enqueue({ id, job, createdAt, priority = JOB_PRIORITY.player, requester = null }: NewJob): Job {
     const row = this.#insert.get({
       id,
       kind: job.kind,
       payload: JSON.stringify(job.input),
+      priority,
+      requester,
       now: createdAt,
     });
     if (row === null) throw new Error("insert returned no row");
@@ -110,6 +137,10 @@ export class SqliteJobQueue implements JobQueue {
     return this.#countQueued.get()?.n ?? 0;
   }
 
+  countPending(requester: string): number {
+    return this.#countPending.get({ requester })?.n ?? 0;
+  }
+
   countActive(): { queued: number; running: number; oldestQueuedAt: number | null } {
     const counts = { queued: 0, running: 0, oldestQueuedAt: null as number | null };
     for (const row of this.#countActive.all()) {
@@ -127,8 +158,8 @@ export class SqliteJobQueue implements JobQueue {
     return this.#listFailed.all({ limit }).map(fromRow);
   }
 
-  claimNext(workerId: string, now: number): Job | null {
-    const row = this.#claim.get({ worker: workerId, now });
+  claimNext(workerId: string, now: number, maxPriority = Number.MAX_SAFE_INTEGER): Job | null {
+    const row = this.#claim.get({ worker: workerId, now, max: maxPriority });
     return row === null ? null : fromRow(row);
   }
 
@@ -153,6 +184,10 @@ export class SqliteJobQueue implements JobQueue {
     return row !== null;
   }
 
+  release(id: string, workerId: string): boolean {
+    return this.#release.get({ id, worker: workerId }) !== null;
+  }
+
   recoverStale(
     staleBefore: number,
     maxAttempts: number,
@@ -172,6 +207,8 @@ function fromRow(row: JobRow): Job {
     result: row.result === null ? null : (JSON.parse(row.result) as JobResult),
     error: row.error,
     attempts: row.attempts,
+    priority: row.priority,
+    requester: row.requester,
     claimedBy: row.claimed_by,
     createdAt: row.created_at,
     startedAt: row.started_at,
```

#### `apps/server/src/adapters/db/job-queue.test.ts`

```diff
diff --git a/apps/server/src/adapters/db/job-queue.test.ts b/apps/server/src/adapters/db/job-queue.test.ts
index 3d3c384..a75d485 100644
--- a/apps/server/src/adapters/db/job-queue.test.ts
+++ b/apps/server/src/adapters/db/job-queue.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, test } from "bun:test";
-import type { JobInput } from "../../domain.ts";
+import { JOB_PRIORITY, type JobInput } from "../../domain.ts";
 import { openDatabase } from "./database.ts";
 import { SqliteJobQueue } from "./job-queue.ts";
 
@@ -29,6 +29,8 @@ describe("SqliteJobQueue", () => {
       result: null,
       error: null,
       attempts: 0,
+      priority: JOB_PRIORITY.player,
+      requester: null,
       claimedBy: null,
       createdAt: 5,
       startedAt: null,
@@ -130,4 +132,55 @@ describe("SqliteJobQueue", () => {
     queue.claimNext("w", 8);
     expect(queue.countActive()).toEqual({ queued: 0, running: 1, oldestQueuedAt: null });
   });
+
+  test("claimNext takes verifications, then daily puzzles, then players' jobs, oldest first in each", () => {
+    const queue = queueWith();
+    const add = (id: string, priority: number, createdAt: number) =>
+      queue.enqueue({ id, job: generate(id), createdAt, priority });
+    add("player-old", JOB_PRIORITY.player, 1);
+    add("daily", JOB_PRIORITY.daily, 2);
+    add("verify-new", JOB_PRIORITY.verify, 4);
+    add("verify-old", JOB_PRIORITY.verify, 3);
+    add("player-new", JOB_PRIORITY.player, 5);
+    const order = [1, 2, 3, 4, 5].map(() => queue.claimNext("w", 10)?.id);
+    expect(order).toEqual(["verify-old", "verify-new", "daily", "player-old", "player-new"]);
+  });
+
+  test("claimNext with maxPriority leaves lower-priority jobs queued", () => {
+    const queue = queueWith("a");
+    queue.enqueue({ id: "v", job: generate("v"), createdAt: 200, priority: JOB_PRIORITY.verify });
+    expect(queue.claimNext("w", 1, JOB_PRIORITY.verify)?.id).toBe("v");
+    expect(queue.claimNext("w", 1, JOB_PRIORITY.verify)).toBeNull();
+    expect(queue.get("a")?.status).toBe("queued");
+  });
+
+  test("countPending counts a requester's waiting and running jobs; an ended job forgets its requester", () => {
+    const queue = queueWith();
+    const add = (id: string, requester: string) =>
+      queue.enqueue({ id, job: generate(id), createdAt: 1, requester });
+    add("a", "ip:1.2.3.4");
+    add("b", "ip:1.2.3.4");
+    add("c", "user:u1");
+    expect(queue.countPending("ip:1.2.3.4")).toBe(2);
+    queue.claimNext("w", 2);
+    expect(queue.countPending("ip:1.2.3.4")).toBe(2);
+    queue.finish("a", "w", { status: "done", result: { kind: "generate", puzzleId: "a" } }, 3);
+    expect(queue.countPending("ip:1.2.3.4")).toBe(1);
+    expect(queue.get("a")?.requester).toBeNull();
+    expect(queue.get("b")?.requester).toBe("ip:1.2.3.4");
+    expect(queue.countPending("user:u1")).toBe(1);
+    expect(queue.countPending("user:nobody")).toBe(0);
+  });
+
+  test("release gives a running job back to the queue without counting the claim", () => {
+    const queue = queueWith("a");
+    queue.claimNext("w1", 1000);
+    expect(queue.release("a", "w2")).toBe(false);
+    expect(queue.release("a", "w1")).toBe(true);
+    expect(queue.get("a")).toMatchObject({ status: "queued", claimedBy: null, attempts: 0 });
+    expect(queue.release("a", "w1")).toBe(false);
+    // The old worker can no longer finish it; the next claim does.
+    expect(queue.finish("a", "w1", { status: "failed", error: "x" }, 1001)).toBe(false);
+    expect(queue.claimNext("w2", 1002)).toMatchObject({ id: "a", claimedBy: "w2", attempts: 1 });
+  });
 });
```

#### `apps/server/src/adapters/tasks/thread-task-runner.ts`

```diff
diff --git a/apps/server/src/adapters/tasks/thread-task-runner.ts b/apps/server/src/adapters/tasks/thread-task-runner.ts
index 0155c57..a675037 100644
--- a/apps/server/src/adapters/tasks/thread-task-runner.ts
+++ b/apps/server/src/adapters/tasks/thread-task-runner.ts
@@ -11,7 +11,7 @@ const THREAD_URL = new URL("./task-thread.ts", import.meta.url).href;
 
 /**
  * Runs each task in a fresh Bun Worker thread. Generation is synchronous and cannot be
- * interrupted from inside, so the time limit (and any cancel) is `Worker.terminate()`.
+ * interrupted from inside, so the time limit and a cancel (`signal`) are `Worker.terminate()`.
  */
 export class ThreadTaskRunner implements TaskRunner {
   readonly #threadUrl: string;
@@ -21,7 +21,8 @@ export class ThreadTaskRunner implements TaskRunner {
     this.#threadUrl = threadUrl;
   }
 
-  run(task: Task, { timeoutMs, onProgress }: TaskRunOptions): Promise<TaskOutcome> {
+  run(task: Task, { timeoutMs, onProgress, signal }: TaskRunOptions): Promise<TaskOutcome> {
+    if (signal?.aborted) return Promise.resolve({ status: "cancelled" });
     return new Promise((resolve) => {
       const thread = new Worker(this.#threadUrl);
       let settled = false;
@@ -29,9 +30,12 @@ export class ThreadTaskRunner implements TaskRunner {
         if (settled) return;
         settled = true;
         clearTimeout(timer);
+        signal?.removeEventListener("abort", cancel);
         thread.terminate();
         resolve(outcome);
       };
+      const cancel = () => settle({ status: "cancelled" });
+      signal?.addEventListener("abort", cancel);
       const timer = setTimeout(() => settle({ status: "timeout" }), timeoutMs);
       thread.onmessage = (event: MessageEvent<ThreadMessage>) => {
         const message = event.data;
```

#### `apps/server/src/adapters/tasks/thread-task-runner.test.ts`

```diff
diff --git a/apps/server/src/adapters/tasks/thread-task-runner.test.ts b/apps/server/src/adapters/tasks/thread-task-runner.test.ts
index 7d7c817..239d00a 100644
--- a/apps/server/src/adapters/tasks/thread-task-runner.test.ts
+++ b/apps/server/src/adapters/tasks/thread-task-runner.test.ts
@@ -37,6 +37,25 @@ describe("ThreadTaskRunner", () => {
     expect(performance.now() - started).toBeLessThan(2_000);
   });
 
+  test("stops a long generation when its signal aborts (worker shutdown)", async () => {
+    const controller = new AbortController();
+    setTimeout(() => controller.abort(), 200);
+    const started = performance.now();
+    const outcome = await runner.run(
+      { kind: "generate", input: { width: 100, height: 100, seed: "shutdown" } },
+      { timeoutMs: 60_000, onProgress: () => {}, signal: controller.signal },
+    );
+    expect(outcome).toEqual({ status: "cancelled" });
+    expect(performance.now() - started).toBeLessThan(2_000);
+    // A signal that has already aborted starts nothing.
+    expect(
+      await runner.run(
+        { kind: "generate", input: { width: 5, height: 5, seed: "s" } },
+        { timeoutMs: 60_000, onProgress: () => {}, signal: controller.signal },
+      ),
+    ).toEqual({ status: "cancelled" });
+  });
+
   test("reports the core's error as failed", async () => {
     const outcome = await runner.run(
       { kind: "generate", input: { width: 0, height: 5, seed: "s" } },
```

### 2.4 Fakes

`FakeJobQueue` mirrors the SQL: stored `priority`/`requester`, `countPending`, priority-sorted stable claim with `maxPriority`, `finish`/stale-fail clear `requester`, `release`.

#### `apps/server/src/test-support/fakes.ts`

```diff
diff --git a/apps/server/src/test-support/fakes.ts b/apps/server/src/test-support/fakes.ts
index fa92f57..086809c 100644
--- a/apps/server/src/test-support/fakes.ts
+++ b/apps/server/src/test-support/fakes.ts
@@ -1,22 +1,23 @@
 import type { Level, Puzzle } from "@loophole/core";
-import type {
-  AccountTokenPurpose,
-  AccountTokenRecord,
-  AttemptRecord,
-  DailyRecord,
-  Job,
-  LeaderboardEntry,
-  LeaderboardSlice,
-  ProgressRecord,
-  PuzzleRecord,
-  PuzzleStatus,
-  ReportRecord,
-  SessionRecord,
-  SubmissionRecord,
-  SubmissionVerdict,
-  Task,
-  TaskOutcome,
-  UserRecord,
+import {
+  type AccountTokenPurpose,
+  type AccountTokenRecord,
+  type AttemptRecord,
+  type DailyRecord,
+  JOB_PRIORITY,
+  type Job,
+  type LeaderboardEntry,
+  type LeaderboardSlice,
+  type ProgressRecord,
+  type PuzzleRecord,
+  type PuzzleStatus,
+  type ReportRecord,
+  type SessionRecord,
+  type SubmissionRecord,
+  type SubmissionVerdict,
+  type Task,
+  type TaskOutcome,
+  type UserRecord,
 } from "../domain.ts";
 import type {
   AccountTokenRepository,
@@ -150,14 +151,14 @@ export class FakeReportRepository implements ReportRepository {
   }
 }
 
-/** The jobs table in a Map, with the same claim rules as the SQLite queue. */
+/** The jobs table in a Map, with the same claim rules as the SQLite queue (priority, then oldest). */
 export class FakeJobQueue implements JobQueue {
   readonly jobs = new Map<string, Job>();
   /** Every progress write, in order. */
   readonly progressWrites: { id: string; progress: number; at: number }[] = [];
   heartbeats = 0;
 
-  enqueue({ id, job, createdAt }: NewJob): Job {
+  enqueue({ id, job, createdAt, priority = JOB_PRIORITY.player, requester = null }: NewJob): Job {
     const stored = {
       ...job,
       id,
@@ -166,6 +167,8 @@ export class FakeJobQueue implements JobQueue {
       result: null,
       error: null,
       attempts: 0,
+      priority,
+      requester,
       claimedBy: null,
       createdAt,
       startedAt: null,
@@ -184,6 +187,12 @@ export class FakeJobQueue implements JobQueue {
     return [...this.jobs.values()].filter((j) => j.status === "queued").length;
   }
 
+  countPending(requester: string): number {
+    return [...this.jobs.values()].filter(
+      (j) => j.requester === requester && (j.status === "queued" || j.status === "running"),
+    ).length;
+  }
+
   countActive(): { queued: number; running: number; oldestQueuedAt: number | null } {
     const all = [...this.jobs.values()];
     const queued = all.filter((j) => j.status === "queued");
@@ -201,8 +210,11 @@ export class FakeJobQueue implements JobQueue {
       .slice(0, limit);
   }
 
-  claimNext(workerId: string, now: number): Job | null {
-    const next = [...this.jobs.values()].find((j) => j.status === "queued");
+  claimNext(workerId: string, now: number, maxPriority = Number.MAX_SAFE_INTEGER): Job | null {
+    // Map order is insertion order, which stands in for created_at; sort is stable.
+    const next = [...this.jobs.values()]
+      .filter((j) => j.status === "queued" && j.priority <= maxPriority)
+      .sort((a, b) => a.priority - b.priority)[0];
     if (next === undefined) return null;
     return this.#update(next.id, {
       status: "running",
@@ -231,12 +243,24 @@ export class FakeJobQueue implements JobQueue {
     this.#update(
       id,
       end.status === "done"
-        ? { status: "done", progress: 1, result: end.result, finishedAt: now }
-        : { status: end.status, error: end.error, finishedAt: now },
+        ? { status: "done", progress: 1, result: end.result, finishedAt: now, requester: null }
+        : { status: end.status, error: end.error, finishedAt: now, requester: null },
     );
     return true;
   }
 
+  release(id: string, workerId: string): boolean {
+    const job = this.jobs.get(id);
+    if (job === undefined || !this.#holds(id, workerId)) return false;
+    this.#update(id, {
+      status: "queued",
+      claimedBy: null,
+      progress: 0,
+      attempts: job.attempts - 1,
+    });
+    return true;
+  }
+
   recoverStale(
     staleBefore: number,
     maxAttempts: number,
@@ -247,7 +271,12 @@ export class FakeJobQueue implements JobQueue {
       if (job.status !== "running" || (job.heartbeatAt ?? 0) >= staleBefore) continue;
       if (job.attempts >= maxAttempts) {
         counts.lost++;
-        this.#update(job.id, { status: "failed", error: "stale", finishedAt: now });
+        this.#update(job.id, {
+          status: "failed",
+          error: "stale",
+          finishedAt: now,
+          requester: null,
+        });
       } else {
         counts.requeued++;
         this.#update(job.id, { status: "queued", claimedBy: null, progress: 0 });
```

### 2.5 Managers

`TooManyPendingJobsError(limit)`; `JobManagerDeps.maxPendingPerRequester` (required); `enqueueGenerate(request, requester)`; priorities on all three enqueue paths. `JobRunManager`: `RunNextOptions`, cancel handling and release. Tests: the cap (2 for `user:u1`; another requester unaffected; a running job still counts; after it ends a new one is accepted), priorities and `requester: null` for verify and daily; `runNext` with `maxPriority` skips a player job; a cancelled task → job queued, `claimedBy: null`, `attempts: 0`, warning logged, no `jobFinished`, and nothing claimed afterwards; the stock's jobs have daily priority.

#### `apps/server/src/managers/errors.ts`

```diff
diff --git a/apps/server/src/managers/errors.ts b/apps/server/src/managers/errors.ts
index 988fe54..78a0b44 100644
--- a/apps/server/src/managers/errors.ts
+++ b/apps/server/src/managers/errors.ts
@@ -6,6 +6,19 @@ export class QueueFullError extends Error {
   }
 }
 
+/**
+ * The requester already has as many generations queued or running as allowed; one has to finish
+ * first (DECISIONS, WT21 "Worker fairness").
+ */
+export class TooManyPendingJobsError extends Error {
+  constructor(limit: number) {
+    super(
+      `You already have ${limit} puzzles being generated. Wait for one to finish, then try again.`,
+    );
+    this.name = "TooManyPendingJobsError";
+  }
+}
+
 /** The email and password don't match an account. Says nothing about which one was wrong. */
 export class InvalidCredentialsError extends Error {
   constructor() {
```

#### `apps/server/src/managers/job-manager.ts`

```diff
diff --git a/apps/server/src/managers/job-manager.ts b/apps/server/src/managers/job-manager.ts
index 6ca3307..01f9738 100644
--- a/apps/server/src/managers/job-manager.ts
+++ b/apps/server/src/managers/job-manager.ts
@@ -1,7 +1,7 @@
 import { DEFAULT_LEVEL, type Level, type PuzzleWireV1 } from "@loophole/core";
-import type { GenerateInput, Job, JobInput } from "../domain.ts";
+import { type GenerateInput, JOB_PRIORITY, type Job, type JobInput } from "../domain.ts";
 import type { Clock, JobQueue } from "../ports.ts";
-import { QueueFullError } from "./errors.ts";
+import { QueueFullError, TooManyPendingJobsError } from "./errors.ts";
 
 export interface JobManagerDeps {
   readonly jobs: JobQueue;
@@ -9,6 +9,8 @@ export interface JobManagerDeps {
   readonly newId: () => string;
   /** New jobs are refused while this many are waiting. */
   readonly maxQueued: number;
+  /** A requester's generations are refused while this many of theirs are waiting or running. */
+  readonly maxPendingPerRequester: number;
 }
 
 export interface GenerateRequest {
@@ -28,45 +30,58 @@ export class JobManager {
     this.#deps = deps;
   }
 
-  /** Queues a puzzle generation (PRD FR-11: never in the request path). Throws `QueueFullError`. */
-  enqueueGenerate(request: GenerateRequest): Job {
-    const seed = request.seed ?? this.#deps.newId();
-    return this.#enqueue({
-      kind: "generate",
-      input: {
-        width: request.width,
-        height: request.height,
-        seed,
-        level: request.level ?? DEFAULT_LEVEL,
-      },
-    });
+  /**
+   * Queues a player's puzzle generation (PRD FR-11: never in the request path). `requester` names
+   * who asked (`user:<id>`, or `ip:<address>` for a guest). Players' generations are claimed after
+   * every verification and daily puzzle (`JOB_PRIORITY`). Throws `TooManyPendingJobsError` while
+   * the requester has `maxPendingPerRequester` generations waiting or running, and
+   * `QueueFullError`.
+   */
+  enqueueGenerate(request: GenerateRequest, requester: string): Job {
+    const { jobs, newId, maxPendingPerRequester } = this.#deps;
+    if (jobs.countPending(requester) >= maxPendingPerRequester) {
+      throw new TooManyPendingJobsError(maxPendingPerRequester);
+    }
+    const input: GenerateInput = {
+      width: request.width,
+      height: request.height,
+      seed: request.seed ?? newId(),
+      level: request.level ?? DEFAULT_LEVEL,
+    };
+    return this.#enqueue({ kind: "generate", input }, JOB_PRIORITY.player, requester);
   }
 
   /**
    * Queues a uniqueness check of a puzzle (PRD FR-4), for the submission `submissionId` when given.
-   * Throws `QueueFullError`.
+   * Checks are claimed before every other job. Throws `QueueFullError`.
    */
   enqueueVerify(puzzle: PuzzleWireV1, submissionId?: string): Job {
     const input = submissionId === undefined ? { puzzle } : { puzzle, submissionId };
-    return this.#enqueue({ kind: "verify", input });
+    return this.#enqueue({ kind: "verify", input }, JOB_PRIORITY.verify, null);
   }
 
   /**
-   * Queues the generation of a daily puzzle under job id `id` (PRD FR-22). Never refused for a
-   * full queue: the scheduler's few jobs a day must not wait behind players' jobs.
+   * Queues the generation of a daily puzzle under job id `id` (PRD FR-22), claimed after
+   * verifications and before players' generations. Never refused for a full queue: the
+   * scheduler's few jobs a day must not wait behind players' jobs.
    */
   enqueueDaily(id: string, input: GenerateInput & { readonly day: string }): Job {
     const { jobs, clock } = this.#deps;
-    return jobs.enqueue({ id, job: { kind: "generate", input }, createdAt: clock.now() });
+    return jobs.enqueue({
+      id,
+      job: { kind: "generate", input },
+      createdAt: clock.now(),
+      priority: JOB_PRIORITY.daily,
+    });
   }
 
   get(id: string): Job | null {
     return this.#deps.jobs.get(id);
   }
 
-  #enqueue(job: JobInput): Job {
+  #enqueue(job: JobInput, priority: number, requester: string | null): Job {
     const { jobs, clock, newId, maxQueued } = this.#deps;
     if (jobs.countQueued() >= maxQueued) throw new QueueFullError(maxQueued);
-    return jobs.enqueue({ id: newId(), job, createdAt: clock.now() });
+    return jobs.enqueue({ id: newId(), job, createdAt: clock.now(), priority, requester });
   }
 }
```

#### `apps/server/src/managers/job-manager.test.ts`

```diff
diff --git a/apps/server/src/managers/job-manager.test.ts b/apps/server/src/managers/job-manager.test.ts
index e4457ae..434ef04 100644
--- a/apps/server/src/managers/job-manager.test.ts
+++ b/apps/server/src/managers/job-manager.test.ts
@@ -1,72 +1,101 @@
 import { describe, expect, test } from "bun:test";
 import { createPuzzle, serializePuzzle } from "@loophole/core";
+import { JOB_PRIORITY } from "../domain.ts";
 import { FakeClock, FakeJobQueue, sequentialIds } from "../test-support/fakes.ts";
-import { QueueFullError } from "./errors.ts";
+import { QueueFullError, TooManyPendingJobsError } from "./errors.ts";
 import { JobManager } from "./job-manager.ts";
 
-function setup(maxQueued = 10) {
+function setup(maxQueued = 10, maxPendingPerRequester = 10) {
   const jobs = new FakeJobQueue();
   const manager = new JobManager({
     jobs,
     clock: new FakeClock(42),
     newId: sequentialIds("j"),
     maxQueued,
+    maxPendingPerRequester,
   });
   return { jobs, manager };
 }
 
 describe("JobManager", () => {
-  test("enqueueGenerate queues a generation with the given seed", () => {
+  test("enqueueGenerate queues a player's generation with the given seed, at hard by default", () => {
     const { manager } = setup();
-    const job = manager.enqueueGenerate({ width: 10, height: 7, seed: "abc" });
+    const job = manager.enqueueGenerate({ width: 10, height: 7, seed: "abc" }, "ip:1.2.3.4");
     expect(job).toMatchObject({
       id: "j-1",
       kind: "generate",
       status: "queued",
       input: { width: 10, height: 7, seed: "abc", level: "hard" },
+      priority: JOB_PRIORITY.player,
+      requester: "ip:1.2.3.4",
       createdAt: 42,
     });
     expect(manager.get("j-1")).toEqual(job);
     expect(manager.get("nope")).toBeNull();
   });
 
-  test("enqueueGenerate takes the level asked for, hard by default (FR-7)", () => {
+  test("enqueueGenerate takes the level asked for (FR-7)", () => {
     const { manager } = setup();
-    const job = manager.enqueueGenerate({ width: 5, height: 5, level: "easy" });
+    const job = manager.enqueueGenerate({ width: 5, height: 5, level: "easy" }, "user:u1");
     expect(job.kind === "generate" && job.input.level).toBe("easy");
   });
 
   test("enqueueGenerate picks a random seed when none is given", () => {
     const { manager } = setup();
-    const job = manager.enqueueGenerate({ width: 5, height: 5 });
+    const job = manager.enqueueGenerate({ width: 5, height: 5 }, "user:u1");
     expect(job.kind === "generate" && job.input.seed).toBe("j-1");
     expect(job.id).toBe("j-2");
   });
 
-  test("enqueueVerify queues a verification", () => {
+  test("enqueueVerify queues a verification, claimed before everything else", () => {
     const { manager } = setup();
     const puzzle = serializePuzzle(createPuzzle(2, 2, [2, 2, 2, 2]));
-    expect(manager.enqueueVerify(puzzle)).toMatchObject({ kind: "verify", input: { puzzle } });
+    expect(manager.enqueueVerify(puzzle)).toMatchObject({
+      kind: "verify",
+      input: { puzzle },
+      priority: JOB_PRIORITY.verify,
+      requester: null,
+    });
   });
 
   test("refuses new jobs while the queue is full", () => {
     const { manager } = setup(2);
-    manager.enqueueGenerate({ width: 5, height: 5, seed: "a" });
-    manager.enqueueGenerate({ width: 5, height: 5, seed: "b" });
-    expect(() => manager.enqueueGenerate({ width: 5, height: 5, seed: "c" })).toThrow(
+    manager.enqueueGenerate({ width: 5, height: 5, seed: "a" }, "ip:1");
+    manager.enqueueGenerate({ width: 5, height: 5, seed: "b" }, "ip:2");
+    expect(() => manager.enqueueGenerate({ width: 5, height: 5, seed: "c" }, "ip:3")).toThrow(
       QueueFullError,
     );
   });
 
+  test("refuses a requester's generation while they have the most allowed waiting or running", () => {
+    const { jobs, manager } = setup(10, 2);
+    const first = manager.enqueueGenerate({ width: 5, height: 5 }, "user:u1");
+    manager.enqueueGenerate({ width: 5, height: 5 }, "user:u1");
+    expect(() => manager.enqueueGenerate({ width: 5, height: 5 }, "user:u1")).toThrow(
+      TooManyPendingJobsError,
+    );
+    // Someone else isn't held back.
+    manager.enqueueGenerate({ width: 5, height: 5 }, "ip:1.2.3.4");
+    // A running job still counts; once it has ended, the requester may queue another.
+    jobs.claimNext("w", 50);
+    expect(() => manager.enqueueGenerate({ width: 5, height: 5 }, "user:u1")).toThrow(
+      TooManyPendingJobsError,
+    );
+    jobs.finish(first.id, "w", { status: "failed", error: "boom" }, 60);
+    expect(manager.enqueueGenerate({ width: 5, height: 5 }, "user:u1").status).toBe("queued");
+  });
+
   test("enqueueDaily queues a daily's generation under its id, even when the queue is full", () => {
     const { manager } = setup(1);
-    manager.enqueueGenerate({ width: 5, height: 5, seed: "a" });
-    const input = { width: 7, height: 7, seed: "s", day: "2026-10-25" };
+    manager.enqueueGenerate({ width: 5, height: 5, seed: "a" }, "ip:1");
+    const input = { width: 7, height: 7, seed: "s", day: "2026-10-25", level: "hard" } as const;
     expect(manager.enqueueDaily("d-1", input)).toMatchObject({
       id: "d-1",
       kind: "generate",
       status: "queued",
       input,
+      priority: JOB_PRIORITY.daily,
+      requester: null,
     });
   });
 });
```

#### `apps/server/src/managers/job-run-manager.ts`

```diff
diff --git a/apps/server/src/managers/job-run-manager.ts b/apps/server/src/managers/job-run-manager.ts
index 22b26f9..be92774 100644
--- a/apps/server/src/managers/job-run-manager.ts
+++ b/apps/server/src/managers/job-run-manager.ts
@@ -33,6 +33,17 @@ export interface JobRunManagerDeps {
   readonly metrics?: Pick<WorkerMetrics, "jobFinished" | "jobsLost">;
 }
 
+export interface RunNextOptions {
+  /** Claims only jobs whose priority is at most this (`JOB_PRIORITY`); any job when left out. */
+  readonly maxPriority?: number;
+  /**
+   * Aborted when the worker is shutting down and the job may not run any longer: the task is
+   * stopped and the job given back to the queue for another worker. Nothing is claimed once it
+   * has aborted.
+   */
+  readonly cancel?: AbortSignal;
+}
+
 /** Runs queued jobs, one at a time per worker: claim, run off-thread, store the outcome. */
 export class JobRunManager {
   readonly #deps: JobRunManagerDeps;
@@ -41,10 +52,14 @@ export class JobRunManager {
     this.#deps = deps;
   }
 
-  /** Claims and runs the oldest queued job. Resolves to false when the queue was empty. */
-  async runNext(workerId: string): Promise<boolean> {
+  /**
+   * Claims and runs the next queued job (by priority, then oldest first). Resolves to false when
+   * there was none to claim.
+   */
+  async runNext(workerId: string, options: RunNextOptions = {}): Promise<boolean> {
     const { jobs, tasks, clock, settings } = this.#deps;
-    const job = jobs.claimNext(workerId, clock.now());
+    if (options.cancel?.aborted) return false;
+    const job = jobs.claimNext(workerId, clock.now(), options.maxPriority);
     if (job === null) return false;
     const timeoutMs =
       job.kind === "generate" ? settings.generateTimeoutMs : settings.verifyTimeoutMs;
@@ -63,13 +78,16 @@ export class JobRunManager {
         console.error(`Heartbeat for job ${job.id} failed:`, err);
       }
     }, settings.heartbeatMs);
-    let end: JobEnd;
+    let end: JobEnd | "cancelled";
     try {
       const outcome = await tasks.run(toTask(job), {
         timeoutMs,
         onProgress,
+        signal: options.cancel,
       });
-      if (outcome.status === "done") {
+      if (outcome.status === "cancelled") {
+        end = "cancelled";
+      } else if (outcome.status === "done") {
         end = { status: "done", result: await this.#store(job, outcome.output) };
       } else if (outcome.status === "timeout") {
         end = { status: "timeout", error: `Stopped after the ${timeoutMs / 1000} s time limit.` };
@@ -81,6 +99,13 @@ export class JobRunManager {
     } finally {
       clearInterval(heartbeat);
     }
+    if (end === "cancelled") {
+      // The worker is shutting down: the next worker runs the job again from the start.
+      if (jobs.release(job.id, workerId)) {
+        console.warn(`Job ${job.id} stopped at shutdown and given back to the queue`);
+      }
+      return true;
+    }
     const finishedAt = clock.now();
     // Counted only when the job really ended here: a job taken back is run again, and counted then.
     if (jobs.finish(job.id, workerId, end, finishedAt)) {
```

#### `apps/server/src/managers/job-run-manager.test.ts`

```diff
diff --git a/apps/server/src/managers/job-run-manager.test.ts b/apps/server/src/managers/job-run-manager.test.ts
index b53818e..b7e138f 100644
--- a/apps/server/src/managers/job-run-manager.test.ts
+++ b/apps/server/src/managers/job-run-manager.test.ts
@@ -2,7 +2,7 @@ import { describe, expect, spyOn, test } from "bun:test";
 import { createPuzzle, serializePuzzle } from "@loophole/core";
 import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
 import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
-import type { TaskOutcome } from "../domain.ts";
+import { JOB_PRIORITY, type TaskOutcome } from "../domain.ts";
 import {
   FakeClock,
   FakeJobQueue,
@@ -52,7 +52,13 @@ function setup(runner: FakeTaskRunner, settings = SETTINGS) {
   const submissions = new SubmissionManager({
     submissions: new FakeSubmissionRepository(),
     puzzles,
-    jobs: new JobManager({ jobs, clock, newId: sequentialIds("j"), maxQueued: 10 }),
+    jobs: new JobManager({
+      jobs,
+      clock,
+      newId: sequentialIds("j"),
+      maxQueued: 10,
+      maxPendingPerRequester: 10,
+    }),
     limiter: new MemoryRateLimiter(clock),
     clock,
     newId: sequentialIds("s"),
@@ -252,6 +258,48 @@ describe("JobRunManager.runNext", () => {
   });
 });
 
+describe("JobRunManager.runNext: priorities and shutdown", () => {
+  test("with maxPriority it claims only jobs at that priority or above", async () => {
+    const runner = new FakeTaskRunner(async () => GENERATED);
+    const { jobs, manager, enqueue } = setup(runner);
+    enqueue("player");
+    const verifyOnly = { maxPriority: JOB_PRIORITY.verify };
+    expect(await manager.runNext("w/verify", verifyOnly)).toBe(false);
+    const puzzle = serializePuzzle(createPuzzle(2, 2));
+    jobs.enqueue({
+      id: "v1",
+      job: { kind: "verify", input: { puzzle } },
+      createdAt: 1,
+      priority: JOB_PRIORITY.verify,
+    });
+    expect(await manager.runNext("w/verify", verifyOnly)).toBe(true);
+    expect(jobs.get("v1")?.claimedBy).toBe("w/verify");
+    expect(jobs.get("player")?.status).toBe("queued");
+  });
+
+  test("a job stopped at shutdown goes back to the queue, its claim not counted", async () => {
+    const cancel = new AbortController();
+    const runner = new FakeTaskRunner(
+      (_task, { signal }) =>
+        new Promise((resolve) => {
+          signal?.addEventListener("abort", () => resolve({ status: "cancelled" }));
+          cancel.abort();
+        }),
+    );
+    const { jobs, manager, enqueue, finished } = setup(runner);
+    enqueue("j1");
+    const warn = spyOn(console, "warn").mockImplementation(() => {});
+    expect(await manager.runNext("w", { cancel: cancel.signal })).toBe(true);
+    expect(warn).toHaveBeenCalledWith("Job j1 stopped at shutdown and given back to the queue");
+    warn.mockRestore();
+    expect(jobs.get("j1")).toMatchObject({ status: "queued", claimedBy: null, attempts: 0 });
+    expect(finished).toEqual([]);
+    // Once stopping, nothing more is claimed.
+    expect(await manager.runNext("w", { cancel: cancel.signal })).toBe(false);
+    expect(runner.calls).toHaveLength(1);
+  });
+});
+
 describe("JobRunManager.recoverStale", () => {
   test("requeues jobs silent for longer than staleMs", async () => {
     const { clock, jobs, manager, enqueue } = setup(new FakeTaskRunner(async () => GENERATED));
```

#### `apps/server/src/managers/daily-stock-manager.test.ts`

```diff
diff --git a/apps/server/src/managers/daily-stock-manager.test.ts b/apps/server/src/managers/daily-stock-manager.test.ts
index b122147..741354d 100644
--- a/apps/server/src/managers/daily-stock-manager.test.ts
+++ b/apps/server/src/managers/daily-stock-manager.test.ts
@@ -1,7 +1,7 @@
 import { describe, expect, spyOn, test } from "bun:test";
 import { serializePuzzle } from "@loophole/core";
 import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
-import type { GeneratedPuzzle } from "../domain.ts";
+import { type GeneratedPuzzle, JOB_PRIORITY } from "../domain.ts";
 import { SMALL_DAILY } from "../test-support/daily.ts";
 import {
   FakeClock,
@@ -25,7 +25,13 @@ function setup(daysAhead = 2) {
   const puzzleRepo = new FakePuzzleRepository();
   const puzzles = new PuzzleManager({ puzzles: puzzleRepo, blobs: new MemoryBlobStore(), clock });
   // A tiny queue: the scheduler's jobs must get in even when players have filled it.
-  const jobs = new JobManager({ jobs: queue, clock, newId: sequentialIds("x"), maxQueued: 1 });
+  const jobs = new JobManager({
+    jobs: queue,
+    clock,
+    newId: sequentialIds("x"),
+    maxQueued: 1,
+    maxPendingPerRequester: 10,
+  });
   /** Size classes counted as failed generations. */
   const failures: number[] = [];
   const stock = new DailyStockManager({
@@ -69,6 +75,8 @@ describe("DailyStockManager.stock (FR-22)", () => {
       kind: "generate",
       status: "queued",
       input: { width: 7, height: 7, seed: "2026-10-25/7/0", day: "2026-10-25", level: "hard" },
+      priority: JOB_PRIORITY.daily,
+      requester: null,
     });
     // Each size class at its own level (one level per size, PRD FR-22).
     for (const job of queue.jobs.values()) {
@@ -165,6 +173,7 @@ describe("DailyStockManager.stock (FR-22)", () => {
         clock: first.clock,
         newId: sequentialIds("y"),
         maxQueued: 1,
+        maxPendingPerRequester: 10,
       }),
       puzzles: first.puzzles,
       seeds: fakeSeeds,
```

### 2.6 Every other `JobManager` construction gets `maxPendingPerRequester: 10`

Mechanical; `spec.ts` is the OpenAPI composition root.

#### `apps/server/src/api/spec.ts`

```diff
diff --git a/apps/server/src/api/spec.ts b/apps/server/src/api/spec.ts
index 9fe80dd..1c9a076 100644
--- a/apps/server/src/api/spec.ts
+++ b/apps/server/src/api/spec.ts
@@ -61,6 +61,7 @@ export function openApiDocument() {
     clock: systemClock,
     newId: () => crypto.randomUUID(),
     maxQueued: 1,
+    maxPendingPerRequester: 10,
   });
   const dailyRepo = new SqliteDailyRepository(db);
   const dailies = new DailyManager({
```

#### `apps/server/src/api/accounts.test.ts`

```diff
diff --git a/apps/server/src/api/accounts.test.ts b/apps/server/src/api/accounts.test.ts
index 0d8d656..c00a961 100644
--- a/apps/server/src/api/accounts.test.ts
+++ b/apps/server/src/api/accounts.test.ts
@@ -29,6 +29,7 @@ function setup(options: { trustProxy?: boolean } = {}) {
     clock,
     newId: sequentialIds("j"),
     maxQueued: 10,
+    maxPendingPerRequester: 10,
   });
   const app = createApp({
     puzzles,
```

#### `apps/server/src/api/daily.test.ts`

```diff
diff --git a/apps/server/src/api/daily.test.ts b/apps/server/src/api/daily.test.ts
index 186645f..833af9d 100644
--- a/apps/server/src/api/daily.test.ts
+++ b/apps/server/src/api/daily.test.ts
@@ -43,6 +43,7 @@ async function setup() {
     clock,
     newId: sequentialIds("j"),
     maxQueued: 10,
+    maxPendingPerRequester: 10,
   });
   const daily = dailyDeps(db, clock, puzzles);
   await storeDaily(daily.dailyRepo, puzzles, "2026-10-24", "d24");
```

#### `apps/server/src/api/health.test.ts`

```diff
diff --git a/apps/server/src/api/health.test.ts b/apps/server/src/api/health.test.ts
index 9c96af4..d07b26f 100644
--- a/apps/server/src/api/health.test.ts
+++ b/apps/server/src/api/health.test.ts
@@ -39,7 +39,13 @@ function setup(
   const deps = accountDeps(db, clock);
   const puzzles = new PuzzleManager({ puzzles: new SqlitePuzzleRepository(db), blobs, clock });
   const queue = new SqliteJobQueue(db);
-  const jobs = new JobManager({ jobs: queue, clock, newId: sequentialIds("j"), maxQueued: 10 });
+  const jobs = new JobManager({
+    jobs: queue,
+    clock,
+    newId: sequentialIds("j"),
+    maxQueued: 10,
+    maxPendingPerRequester: 10,
+  });
   const metrics = new RecordingMetrics();
   const app = createApp({
     puzzles,
```

#### `apps/server/src/api/progress.test.ts`

```diff
diff --git a/apps/server/src/api/progress.test.ts b/apps/server/src/api/progress.test.ts
index 7d1f864..310fdd0 100644
--- a/apps/server/src/api/progress.test.ts
+++ b/apps/server/src/api/progress.test.ts
@@ -41,6 +41,7 @@ async function setup() {
     clock,
     newId: sequentialIds("j"),
     maxQueued: 10,
+    maxPendingPerRequester: 10,
   });
   const app = createApp({
     puzzles,
```

#### `apps/server/src/api/submissions.test.ts`

```diff
diff --git a/apps/server/src/api/submissions.test.ts b/apps/server/src/api/submissions.test.ts
index 0bbece3..f9cb023 100644
--- a/apps/server/src/api/submissions.test.ts
+++ b/apps/server/src/api/submissions.test.ts
@@ -30,7 +30,13 @@ function setup() {
     clock,
   });
   const queue = new SqliteJobQueue(db);
-  const jobs = new JobManager({ jobs: queue, clock, newId: sequentialIds("j"), maxQueued: 100 });
+  const jobs = new JobManager({
+    jobs: queue,
+    clock,
+    newId: sequentialIds("j"),
+    maxQueued: 100,
+    maxPendingPerRequester: 10,
+  });
   const app = createApp({
     puzzles,
     jobs,
```

#### `apps/server/src/managers/submission-manager.test.ts`

```diff
diff --git a/apps/server/src/managers/submission-manager.test.ts b/apps/server/src/managers/submission-manager.test.ts
index 9462f5c..6520d21 100644
--- a/apps/server/src/managers/submission-manager.test.ts
+++ b/apps/server/src/managers/submission-manager.test.ts
@@ -36,7 +36,13 @@ function setup() {
   const blobs = new MemoryBlobStore();
   const repo = new FakeSubmissionRepository();
   const puzzles = new PuzzleManager({ puzzles: puzzleRepo, blobs, clock });
-  const jobs = new JobManager({ jobs: queue, clock, newId: sequentialIds("j"), maxQueued: 100 });
+  const jobs = new JobManager({
+    jobs: queue,
+    clock,
+    newId: sequentialIds("j"),
+    maxQueued: 100,
+    maxPendingPerRequester: 10,
+  });
   const manager = new SubmissionManager({
     submissions: repo,
     puzzles,
```

#### `apps/server/src/worker/flow.test.ts`

```diff
diff --git a/apps/server/src/worker/flow.test.ts b/apps/server/src/worker/flow.test.ts
index 7f23f4d..d4b62dd 100644
--- a/apps/server/src/worker/flow.test.ts
+++ b/apps/server/src/worker/flow.test.ts
@@ -33,6 +33,7 @@ function setup(verifyTimeoutMs = 10_000) {
     clock: systemClock,
     newId: () => crypto.randomUUID(),
     maxQueued: 10,
+    maxPendingPerRequester: 10,
   });
   const { submissions, reports } = submissionDeps(db, systemClock, puzzles, jobs);
   const runs = new JobRunManager({
```

### 2.7 Route, settings, composition roots

`POST /api/jobs/generate` is async: requester from the session or the address; 429 documented and mapped. `config.ts`: `MAX_PENDING_GENERATIONS`, `WORKER_DRAIN_MS`. `api/main.ts` and `worker/main.ts` pass `maxPendingPerRequester`. Tests: requester `ip:unknown` stored on a route job; with cap 2, the third request from `198.51.100.7` is 429 "Too many generations in progress", another address and a logged-in user behind the same address each get their own cap (the test logs in by inserting a user and `sessions.create`); config defaults and overrides.

#### `apps/server/src/api/app.ts`

```diff
diff --git a/apps/server/src/api/app.ts b/apps/server/src/api/app.ts
index 0696575..4d211dc 100644
--- a/apps/server/src/api/app.ts
+++ b/apps/server/src/api/app.ts
@@ -19,6 +19,7 @@ import {
   PuzzleNotFoundError,
   QueueFullError,
   RateLimitedError,
+  TooManyPendingJobsError,
   WrongSolutionError,
 } from "../managers/errors.ts";
 import type { HintManager } from "../managers/hint-manager.ts";
@@ -27,6 +28,7 @@ import type { ProgressManager } from "../managers/progress-manager.ts";
 import type { PuzzleManager } from "../managers/puzzle-manager.ts";
 import type { ApiMetrics } from "../ports.ts";
 import { type AccountRouteDeps, registerAccountRoutes, tooManyRequests } from "./accounts.ts";
+import { clientAddress, rateLimitKey } from "./client-address.ts";
 import { sameOriginOnly } from "./csrf.ts";
 import { type DailyRouteDeps, registerDailyRoutes } from "./daily.ts";
 import { type HealthRouteDeps, registerHealthRoutes } from "./health.ts";
@@ -130,7 +132,8 @@ const generateRoute = createRoute({
   method: "post",
   path: "/api/jobs/generate",
   summary: "Queue a puzzle generation",
-  description: "Generation runs in the background; poll the returned job until it is done.",
+  description:
+    "Generation runs in the background; poll the returned job until it is done. Each player (or, for guests, each address) may have a few generations waiting or running at once.",
   request: {
     body: { required: true, content: { "application/json": { schema: GenerateRequestSchema } } },
   },
@@ -143,6 +146,9 @@ const generateRoute = createRoute({
     413: problemResponse("Request body larger than 64 KiB."),
     415: problemResponse("Request body is not JSON."),
     403: problemResponse("Sent from another site (CSRF protection)."),
+    429: problemResponse(
+      "This player or address already has as many generations waiting or running as allowed.",
+    ),
     503: problemResponse("Too many jobs waiting; try again later."),
   },
 });
@@ -214,8 +220,11 @@ export function createApp(deps: AppDeps): OpenAPIHono {
     return c.json(toHintDto(hint), 200);
   });
 
-  app.openapi(generateRoute, (c) => {
-    const job = jobs.enqueueGenerate(c.req.valid("json"));
+  app.openapi(generateRoute, async (c) => {
+    const user = await currentUser(c, deps.sessions);
+    const requester =
+      user === null ? `ip:${rateLimitKey(clientAddress(c, deps.trustProxy))}` : `user:${user.id}`;
+    const job = jobs.enqueueGenerate(c.req.valid("json"), requester);
     c.header("Location", `/api/jobs/${job.id}`);
     return c.json(toJobDto(job), 202);
   });
@@ -245,6 +254,8 @@ export function createApp(deps: AppDeps): OpenAPIHono {
   app.onError((err, c) => {
     if (err instanceof QueueFullError)
       return problem(c, 503, "Queue full", { detail: err.message });
+    if (err instanceof TooManyPendingJobsError)
+      return problem(c, 429, "Too many generations in progress", { detail: err.message });
     if (err instanceof InvalidBoardError)
       return problem(c, 400, "Invalid board", { detail: err.message });
     if (err instanceof PuzzleNotFoundError)
```

#### `apps/server/src/api/app.test.ts`

```diff
diff --git a/apps/server/src/api/app.test.ts b/apps/server/src/api/app.test.ts
index b8109b3..1cd27e0 100644
--- a/apps/server/src/api/app.test.ts
+++ b/apps/server/src/api/app.test.ts
@@ -17,10 +17,11 @@ import { sqliteProgress } from "../test-support/progress.ts";
 import { submissionDeps } from "../test-support/submissions.ts";
 import { createApp } from "./app.ts";
 import type { Problem } from "./problem.ts";
+import { SESSION_COOKIE } from "./session-cookie.ts";
 
 const SOLUTION = "112211121121";
 
-function setup(options: { webDir?: string; maxQueued?: number } = {}) {
+function setup(options: { webDir?: string; maxQueued?: number; maxPending?: number } = {}) {
   const db = openDatabase(":memory:");
   const clock = new FakeClock(Date.UTC(2026, 9, 25, 12));
   const repo = new SqlitePuzzleRepository(db);
@@ -35,11 +36,13 @@ function setup(options: { webDir?: string; maxQueued?: number } = {}) {
     clock,
     newId: sequentialIds("j"),
     maxQueued: options.maxQueued ?? 10,
+    maxPendingPerRequester: options.maxPending ?? 10,
   });
+  const accounts = accountDeps(db, clock);
   const app = createApp({
     puzzles,
     jobs,
-    ...accountDeps(db, clock),
+    ...accounts,
     ...dailyDeps(db, clock, puzzles),
     progress: sqliteProgress(db, puzzles, clock),
     health: healthManager(db, clock),
@@ -55,7 +58,19 @@ function setup(options: { webDir?: string; maxQueued?: number } = {}) {
       solution: SOLUTION,
       steps: [],
     });
-  return { app, repo, queue, clock, puzzles, savePuzzle };
+  /** A logged-in user's session cookie. */
+  const logIn = async (id: string) => {
+    accounts.users.insert({
+      id,
+      email: `${id}@example.com`,
+      passwordHash: "h",
+      emailVerifiedAt: null,
+      isAdmin: false,
+      createdAt: clock.now(),
+    });
+    return `${SESSION_COOKIE}=${(await accounts.sessions.create(id)).token}`;
+  };
+  return { app, repo, queue, clock, puzzles, savePuzzle, logIn };
 }
 
 const postJson = (body: unknown) => ({
@@ -219,7 +234,10 @@ describe("jobs", () => {
       startedAt: null,
       finishedAt: null,
     });
-    expect(queue.get("j-1")?.input).toEqual({ width: 10, height: 7, seed: "x", level: "hard" });
+    expect(queue.get("j-1")).toMatchObject({
+      input: { width: 10, height: 7, seed: "x", level: "hard" },
+      requester: "ip:unknown",
+    });
   });
 
   test("POST /api/jobs/generate takes a level (FR-7)", async () => {
@@ -232,6 +250,31 @@ describe("jobs", () => {
     expect(queue.get("j-2")?.input).toMatchObject({ width: 7, height: 7, level: "medium" });
   });
 
+  test("POST /api/jobs/generate is 429 once a requester has the most generations pending", async () => {
+    const { app, logIn } = setup({ maxPending: 2 });
+    const from = (address: string, cookie?: string) => {
+      const init = postJson({ width: 5, height: 5 });
+      const headers = cookie === undefined ? init.headers : { ...init.headers, Cookie: cookie };
+      return app.request(
+        "/api/jobs/generate",
+        { ...init, headers },
+        {
+          requestIP: () => ({ address }),
+        },
+      );
+    };
+    expect((await from("198.51.100.7")).status).toBe(202);
+    expect((await from("198.51.100.7")).status).toBe(202);
+    const refused = await expectProblem(await from("198.51.100.7"), 429);
+    expect(refused.title).toBe("Too many generations in progress");
+    // Another address, and a logged-in player behind the same address, each have their own cap.
+    expect((await from("203.0.113.9")).status).toBe(202);
+    const cookie = await logIn("u1");
+    expect((await from("198.51.100.7", cookie)).status).toBe(202);
+    expect((await from("198.51.100.7", cookie)).status).toBe(202);
+    await expectProblem(await from("198.51.100.7", cookie), 429);
+  });
+
   test("POST /api/jobs/generate validates the body", async () => {
     const { app } = setup();
     for (const body of [
```

#### `apps/server/src/config.ts`

```diff
diff --git a/apps/server/src/config.ts b/apps/server/src/config.ts
index 512ddc8..0518415 100644
--- a/apps/server/src/config.ts
+++ b/apps/server/src/config.ts
@@ -37,6 +37,8 @@ const EnvSchema = z.object({
   WORKER_ID: z.string().min(1).optional(),
   GENERATE_TIMEOUT_MS: Ms.default(1_800_000),
   VERIFY_TIMEOUT_MS: Ms.default(45_000),
+  MAX_PENDING_GENERATIONS: z.coerce.number().int().min(1).max(100).default(3),
+  WORKER_DRAIN_MS: Ms.default(60_000),
   PUBLIC_URL: z.url(),
   TRUST_PROXY: z.stringbool().default(false),
   TURNSTILE_SITE_KEY: z.string().min(1).default(TURNSTILE_TEST_SITE_KEY),
@@ -69,6 +71,13 @@ export interface Config {
   readonly pollMs: number;
   /** New jobs are refused while this many are waiting. */
   readonly maxQueuedJobs: number;
+  /** A player's (or a guest address's) generations are refused while this many are waiting or running. */
+  readonly maxPendingGenerations: number;
+  /**
+   * After SIGTERM or SIGINT, how long the worker lets a running job go on before it stops the job
+   * and gives it back to the queue. `compose.prod.yml`'s `stop_grace_period` must be longer.
+   */
+  readonly drainMs: number;
   readonly jobs: JobRunSettings;
   /** Origin of the web app, without a trailing slash; links in mail point here. */
   readonly publicUrl: string;
@@ -165,6 +174,8 @@ export function loadConfig(env: Record<string, string | undefined>): Config {
     workerId: `${e.WORKER_ID ?? hostname()}-${process.pid}`,
     pollMs: 500,
     maxQueuedJobs: 100,
+    maxPendingGenerations: e.MAX_PENDING_GENERATIONS,
+    drainMs: e.WORKER_DRAIN_MS,
     jobs: {
       generateTimeoutMs: e.GENERATE_TIMEOUT_MS,
       verifyTimeoutMs: e.VERIFY_TIMEOUT_MS,
```

#### `apps/server/src/config.test.ts`

```diff
diff --git a/apps/server/src/config.test.ts b/apps/server/src/config.test.ts
index 5f01e8b..050eed7 100644
--- a/apps/server/src/config.test.ts
+++ b/apps/server/src/config.test.ts
@@ -26,6 +26,8 @@ describe("loadConfig", () => {
         secretAccessKey: "secret",
       },
       jobs: { generateTimeoutMs: 1_800_000, verifyTimeoutMs: 45_000 },
+      maxPendingGenerations: 3,
+      drainMs: 60_000,
       publicUrl: "http://localhost:5173",
       trustProxy: false,
       turnstile: {
@@ -56,6 +58,8 @@ describe("loadConfig", () => {
       WEB_DIR: "apps/web/build",
       WORKER_ID: "w1",
       GENERATE_TIMEOUT_MS: "1000",
+      MAX_PENDING_GENERATIONS: "5",
+      WORKER_DRAIN_MS: "30000",
       APP_VERSION: "4f8cb61",
       METRICS_HOST: "0.0.0.0",
       API_METRICS_PORT: "9464",
@@ -67,6 +71,8 @@ describe("loadConfig", () => {
       webDir: "apps/web/build",
       workerId: `w1-${process.pid}`,
       jobs: { generateTimeoutMs: 1000 },
+      maxPendingGenerations: 5,
+      drainMs: 30_000,
       version: "4f8cb61",
       metrics: { host: "0.0.0.0", apiPort: 9464, workerPort: 9465 },
     });
```

#### `apps/server/src/api/main.ts`

```diff
diff --git a/apps/server/src/api/main.ts b/apps/server/src/api/main.ts
index 09a84db..ff52b7b 100644
--- a/apps/server/src/api/main.ts
+++ b/apps/server/src/api/main.ts
@@ -63,6 +63,7 @@ const jobs = new JobManager({
   clock: systemClock,
   newId: () => crypto.randomUUID(),
   maxQueued: config.maxQueuedJobs,
+  maxPendingPerRequester: config.maxPendingGenerations,
 });
 const users = new SqliteUserRepository(db);
 const sessions = new SessionManager({
```

### 2.8 Worker loops, drain and Compose

`LaneOptions` (`runs`, `workerId`, `pollMs`, `signal`, `drainMs`); `WorkerLoopOptions extends LaneOptions`; `runVerifyLane`; `drainAfter`. `worker/main.ts` runs both loops with `Promise.all` and `drainMs: config.drainMs`. Compose: `stop_grace_period: 90s` with a comment. Loop tests: existing ones get `drainMs`; on stop the loop claims once only and the running job's `cancel` aborts ≥ 60 ms after a stop at 20 ms with `drainMs: 50`; a job ending within the drain is not cancelled; the verify lane passes `maxPriority: JOB_PRIORITY.verify` and its own worker id and stops on abort.

#### `apps/server/src/worker/loop.ts`

```diff
diff --git a/apps/server/src/worker/loop.ts b/apps/server/src/worker/loop.ts
index befaef9..c20dc8f 100644
--- a/apps/server/src/worker/loop.ts
+++ b/apps/server/src/worker/loop.ts
@@ -1,29 +1,41 @@
+import { JOB_PRIORITY } from "../domain.ts";
 import type { DailyStockManager } from "../managers/daily-stock-manager.ts";
 import type { JobRunManager } from "../managers/job-run-manager.ts";
 
-export interface WorkerLoopOptions {
-  readonly runs: Pick<JobRunManager, "runNext" | "recoverStale">;
-  readonly dailies: Pick<DailyStockManager, "stock">;
+export interface LaneOptions {
+  readonly runs: Pick<JobRunManager, "runNext">;
   readonly workerId: string;
-  /** How long to wait when the queue is empty. */
+  /** How long to wait when there is no job to claim. */
   readonly pollMs: number;
+  /** Stops the lane: no job is claimed once it aborts, and the running one gets `drainMs`. */
+  readonly signal: AbortSignal;
+  /**
+   * After `signal` aborts, how long a running job may go on before it is stopped and given back to
+   * the queue (DECISIONS, WT21 "Graceful shutdown").
+   */
+  readonly drainMs: number;
+}
+
+export interface WorkerLoopOptions extends LaneOptions {
+  readonly runs: Pick<JobRunManager, "runNext" | "recoverStale">;
+  readonly dailies: Pick<DailyStockManager, "stock">;
   /** Least time between two sweeps for abandoned jobs, whether the worker is busy or idle. */
   readonly sweepMs: number;
   /** Least time between two checks that the coming days' daily puzzles are generated. */
   readonly stockMs: number;
-  /** Stops the loop after the current job. */
-  readonly signal: AbortSignal;
   /** Milliseconds, for the sweep timer. */
   readonly now?: () => number;
 }
 
 /**
- * The worker's main loop: run jobs back to back while there are any; when the queue is empty,
- * wait `pollMs` before looking again. Abandoned jobs are taken back once at start and then every
- * `sweepMs`, busy or idle, so a dead worker's job does not wait for the queue to drain. Daily
- * puzzles are stocked at start and then every `stockMs` the same way; one of today's still missing
- * at two checks in a row is late, and logged as an error. An error (say, the database staying busy)
- * is logged and the loop carries on after the same wait.
+ * The worker's main loop: run jobs back to back while there are any, by priority (`JOB_PRIORITY`);
+ * when the queue is empty, wait `pollMs` before looking again. Abandoned jobs are taken back once
+ * at start and then every `sweepMs`, busy or idle, so a dead worker's job does not wait for the
+ * queue to drain. Daily puzzles are stocked at start and then every `stockMs` the same way; one of
+ * today's still missing at two checks in a row is late, and logged as an error. An error (say, the
+ * database staying busy) is logged and the loop carries on after the same wait. When `signal`
+ * aborts, the loop claims nothing more, and a running job that hasn't ended `drainMs` later is
+ * stopped and given back to the queue.
  */
 export async function runWorkerLoop({
   runs,
@@ -33,11 +45,13 @@ export async function runWorkerLoop({
   sweepMs,
   stockMs,
   signal,
+  drainMs,
   now = () => performance.now(),
 }: WorkerLoopOptions) {
   let lastSweep = Number.NEGATIVE_INFINITY;
   let lastStock = Number.NEGATIVE_INFINITY;
   let missing = new Set<number>();
+  const drain = drainAfter(signal, drainMs);
   while (!signal.aborted) {
     try {
       if (now() - lastSweep >= sweepMs) {
@@ -57,12 +71,49 @@ export async function runWorkerLoop({
         }
         missing = new Set(missingToday);
       }
-      if (await runs.runNext(workerId)) continue;
+      if (await runs.runNext(workerId, { cancel: drain.cancel })) continue;
     } catch (err) {
       console.error("Worker loop error:", err);
     }
     await sleep(pollMs, signal);
   }
+  drain.dispose();
+}
+
+/**
+ * A second loop in the worker that runs only verifications (`JOB_PRIORITY.verify`), each at most
+ * `VERIFY_TIMEOUT_MS`, next to whatever the main loop runs: a submission's check never waits for
+ * a long generation to end (DECISIONS, WT21 "Worker fairness"). Stops like the main loop.
+ */
+export async function runVerifyLane({ runs, workerId, pollMs, signal, drainMs }: LaneOptions) {
+  const drain = drainAfter(signal, drainMs);
+  while (!signal.aborted) {
+    try {
+      const options = { maxPriority: JOB_PRIORITY.verify, cancel: drain.cancel };
+      if (await runs.runNext(workerId, options)) continue;
+    } catch (err) {
+      console.error("Verification lane error:", err);
+    }
+    await sleep(pollMs, signal);
+  }
+  drain.dispose();
+}
+
+/** A signal that aborts `ms` after `signal` does; `dispose` drops the timer. */
+function drainAfter(signal: AbortSignal, ms: number) {
+  const controller = new AbortController();
+  let timer: ReturnType<typeof setTimeout> | undefined;
+  const start = () => {
+    timer = setTimeout(() => controller.abort(), ms);
+  };
+  signal.addEventListener("abort", start, { once: true });
+  return {
+    cancel: controller.signal,
+    dispose() {
+      signal.removeEventListener("abort", start);
+      clearTimeout(timer);
+    },
+  };
 }
 
 function sleep(ms: number, signal: AbortSignal): Promise<void> {
```

#### `apps/server/src/worker/loop.test.ts`

```diff
diff --git a/apps/server/src/worker/loop.test.ts b/apps/server/src/worker/loop.test.ts
index bcbc3a0..450b4e2 100644
--- a/apps/server/src/worker/loop.test.ts
+++ b/apps/server/src/worker/loop.test.ts
@@ -1,6 +1,8 @@
 import { describe, expect, spyOn, test } from "bun:test";
+import { JOB_PRIORITY } from "../domain.ts";
 import type { StockReport } from "../managers/daily-stock-manager.ts";
-import { runWorkerLoop } from "./loop.ts";
+import type { RunNextOptions } from "../managers/job-run-manager.ts";
+import { runVerifyLane, runWorkerLoop } from "./loop.ts";
 
 /** A scheduler that reports nothing to do. */
 const stocked = { stock: (): StockReport => ({ queued: 0, missingToday: [] }) };
@@ -34,6 +36,7 @@ describe("runWorkerLoop", () => {
       pollMs: 60_000,
       sweepMs: 5_000,
       stockMs: 60_000,
+      drainMs: 60_000,
       now: () => time,
       signal: controller.signal,
     });
@@ -77,6 +80,7 @@ describe("runWorkerLoop", () => {
       pollMs: 60_000,
       sweepMs: 60_000,
       stockMs: 60_000,
+      drainMs: 60_000,
       signal: controller.signal,
     });
     expect(recovered).toBe(1);
@@ -103,6 +107,7 @@ describe("runWorkerLoop", () => {
       pollMs: 1,
       sweepMs: 60_000,
       stockMs: 60_000,
+      drainMs: 60_000,
       signal: controller.signal,
     });
     expect(calls).toBe(2);
@@ -142,6 +147,7 @@ describe("runWorkerLoop", () => {
       pollMs: 1,
       sweepMs: 60_000,
       stockMs: 60_000,
+      drainMs: 60_000,
       now: () => time,
       signal: controller.signal,
     });
@@ -153,4 +159,90 @@ describe("runWorkerLoop", () => {
     error.mockRestore();
     log.mockRestore();
   });
+
+  test("on stop it claims nothing more, and stops a job still running after drainMs", async () => {
+    const controller = new AbortController();
+    const seen: RunNextOptions[] = [];
+    let cancelledAfter = -1;
+    const runs = {
+      async runNext(_workerId: string, options: RunNextOptions = {}) {
+        seen.push(options);
+        // A long job: it ends only when the loop cancels it.
+        const started = performance.now();
+        await new Promise<void>((resolve) =>
+          options.cancel?.addEventListener("abort", () => resolve()),
+        );
+        cancelledAfter = performance.now() - started;
+        return true;
+      },
+      recoverStale: () => ({ requeued: 0, lost: 0 }),
+    };
+    setTimeout(() => controller.abort(), 20);
+    await runWorkerLoop({
+      runs,
+      dailies: stocked,
+      workerId: "w",
+      pollMs: 1,
+      sweepMs: 60_000,
+      stockMs: 60_000,
+      drainMs: 50,
+      signal: controller.signal,
+    });
+    // One claim only: after the stop, the loop ended instead of claiming again.
+    expect(seen).toHaveLength(1);
+    expect(seen[0].cancel?.aborted).toBe(true);
+    expect(cancelledAfter).toBeGreaterThanOrEqual(60);
+  });
+
+  test("a job that ends within drainMs of the stop is not cancelled", async () => {
+    const controller = new AbortController();
+    let cancel: AbortSignal | undefined;
+    const runs = {
+      async runNext(_workerId: string, options: RunNextOptions = {}) {
+        cancel = options.cancel;
+        controller.abort();
+        await new Promise((resolve) => setTimeout(resolve, 10));
+        return true;
+      },
+      recoverStale: () => ({ requeued: 0, lost: 0 }),
+    };
+    await runWorkerLoop({
+      runs,
+      dailies: stocked,
+      workerId: "w",
+      pollMs: 1,
+      sweepMs: 60_000,
+      stockMs: 60_000,
+      drainMs: 1_000,
+      signal: controller.signal,
+    });
+    await new Promise((resolve) => setTimeout(resolve, 20));
+    expect(cancel?.aborted).toBe(false);
+  });
+});
+
+describe("runVerifyLane", () => {
+  test("claims only verifications, polls while there are none, and stops like the main loop", async () => {
+    const controller = new AbortController();
+    const calls: { workerId: string; options: RunNextOptions }[] = [];
+    const runs = {
+      async runNext(workerId: string, options: RunNextOptions = {}) {
+        calls.push({ workerId, options });
+        if (calls.length === 3) controller.abort();
+        return calls.length === 1;
+      },
+    };
+    await runVerifyLane({
+      runs,
+      workerId: "w/verify",
+      pollMs: 1,
+      drainMs: 60_000,
+      signal: controller.signal,
+    });
+    expect(calls).toHaveLength(3);
+    for (const call of calls) {
+      expect(call.workerId).toBe("w/verify");
+      expect(call.options.maxPriority).toBe(JOB_PRIORITY.verify);
+    }
+  });
 });
```

#### `apps/server/src/worker/main.ts`

```diff
diff --git a/apps/server/src/worker/main.ts b/apps/server/src/worker/main.ts
index cf863d1..52b61ba 100644
--- a/apps/server/src/worker/main.ts
+++ b/apps/server/src/worker/main.ts
@@ -1,5 +1,6 @@
 // Composition root of the job worker process: reads the settings, builds the adapters and
-// managers, and runs jobs until SIGINT or SIGTERM. The job in progress finishes first.
+// managers, and runs jobs until SIGINT or SIGTERM: a job in progress gets WORKER_DRAIN_MS to
+// finish, then is stopped and given back to the queue.
 import { S3BlobStore } from "../adapters/blob/s3-blob-store.ts";
 import { systemClock } from "../adapters/clock.ts";
 import { hmacDailySeeder } from "../adapters/daily-seeds.ts";
@@ -22,7 +23,7 @@ import { JobManager } from "../managers/job-manager.ts";
 import { JobRunManager } from "../managers/job-run-manager.ts";
 import { PuzzleManager } from "../managers/puzzle-manager.ts";
 import { SubmissionManager } from "../managers/submission-manager.ts";
-import { runWorkerLoop } from "./loop.ts";
+import { runVerifyLane, runWorkerLoop } from "./loop.ts";
 
 installJsonLogging({ process: "worker" });
 const config = loadConfig(process.env);
@@ -40,6 +41,7 @@ const jobs = new JobManager({
   clock: systemClock,
   newId: () => crypto.randomUUID(),
   maxQueued: config.maxQueuedJobs,
+  maxPendingPerRequester: config.maxPendingGenerations,
 });
 // The worker only decides submissions; queueing them and the per-account limit are the API's.
 const submissionRepo = new SqliteSubmissionRepository(db);
@@ -90,15 +92,17 @@ const metricsServer =
     : serveMetrics(registry, config.metrics.host, config.metrics.workerPort);
 if (metricsServer !== null) console.log(`Worker metrics on ${metricsServer.url}metrics`);
 console.log(`Worker ${config.workerId} polling for jobs`);
-await runWorkerLoop({
-  runs,
-  dailies,
-  workerId: config.workerId,
-  pollMs: config.pollMs,
-  sweepMs: config.jobs.staleMs / 2,
-  stockMs: config.dailies.stockMs,
-  signal: controller.signal,
-});
+const lane = { runs, pollMs: config.pollMs, signal: controller.signal, drainMs: config.drainMs };
+await Promise.all([
+  runWorkerLoop({
+    ...lane,
+    dailies,
+    workerId: config.workerId,
+    sweepMs: config.jobs.staleMs / 2,
+    stockMs: config.dailies.stockMs,
+  }),
+  runVerifyLane({ ...lane, workerId: `${config.workerId}/verify` }),
+]);
 metricsServer?.stop();
 db.close();
 console.log(`Worker ${config.workerId} stopped`);
```

#### `compose.prod.yml`

```diff
diff --git a/compose.prod.yml b/compose.prod.yml
index b47c9e1..e3c2637 100644
--- a/compose.prod.yml
+++ b/compose.prod.yml
@@ -50,6 +50,11 @@ services:
   worker:
     <<: *app
     command: ["bun", "apps/server/src/worker/main.ts"]
+    # On `docker compose stop`/`up` the worker stops claiming jobs and gives a running one
+    # WORKER_DRAIN_MS (60 s by default) to finish; a job still running then goes back to the queue
+    # for the next worker. Keep this longer than WORKER_DRAIN_MS, or Docker kills the worker first
+    # and the job only comes back once it is found stale (30 s later).
+    stop_grace_period: 90s
     environment:
       S3_ENDPOINT: http://garage:3900
       METRICS_HOST: 0.0.0.0
```

### 2.9 Check and commit

`bun run gen:api` (the 429 response), `bun run format && bun run check` (881 pass, 3 skip). Timing check: `./scripts/test-under-load.sh 12 4 apps/server/src/worker apps/server/src/adapters/tasks apps/server/src/managers/job-run-manager.test.ts` (0 failures expected; a Bun segfault while threads tear down is a known Bun bug, TESTING.md). Commit: `feat(server): claim verifications and dailies first, cap pending generations, drain on shutdown`

## Commit 3 — levels in the web app, and new practice puzzles (FR-7, FR-29, NFR-2, NFR-5)

### 3.1 Puzzle source: level, names, subtitle

#### `apps/web/src/lib/puzzles/source.ts`

```diff
diff --git a/apps/web/src/lib/puzzles/source.ts b/apps/web/src/lib/puzzles/source.ts
index 4ae6d1d..a99be3e 100644
--- a/apps/web/src/lib/puzzles/source.ts
+++ b/apps/web/src/lib/puzzles/source.ts
@@ -1,4 +1,4 @@
-import type { Hint, Puzzle } from "@loophole/core";
+import type { Hint, Level, Puzzle } from "@loophole/core";
 
 export interface PuzzleSummary {
   /** Stable id; also the key for saved progress. */
@@ -11,6 +11,11 @@ export interface PuzzleSummary {
   readonly height: number;
   /** Where a server puzzle came from; built-in puzzles have none. */
   readonly origin?: "generated" | "submitted";
+  /**
+   * The level a generated server puzzle was made at (PRD FR-7). Built-in and player-made puzzles
+   * have none: they weren't made at a level.
+   */
+  readonly level?: Level;
 }
 
 /** The header title, e.g. "Small · 7×7". */
@@ -18,6 +23,22 @@ export function puzzleTitle(p: PuzzleSummary): string {
   return `${p.name} · ${p.width}×${p.height}`;
 }
 
+const LEVEL_NAMES: Readonly<Record<Level, string>> = {
+  easy: "Easy",
+  medium: "Medium",
+  hard: "Hard",
+};
+
+/** "Easy", "Medium" or "Hard". */
+export function levelName(level: Level): string {
+  return LEVEL_NAMES[level];
+}
+
+/** The header's second line with the level after it, e.g. "Practice · 練習 · Easy". */
+export function puzzleSubtitle(p: PuzzleSummary): string {
+  return p.level === undefined ? p.subtitle : `${p.subtitle} · ${levelName(p.level)}`;
+}
+
 export interface PuzzleEntry extends PuzzleSummary {
   readonly puzzle: Puzzle;
 }
```

#### `apps/web/src/lib/puzzles/source.test.ts` (new file)

```diff
diff --git a/apps/web/src/lib/puzzles/source.test.ts b/apps/web/src/lib/puzzles/source.test.ts
new file mode 100644
index 0000000..17b8ac6
--- /dev/null
+++ b/apps/web/src/lib/puzzles/source.test.ts
@@ -0,0 +1,15 @@
+import { expect, test } from "bun:test";
+import { levelName, puzzleSubtitle, puzzleTitle } from "./source.ts";
+
+const SUMMARY = { id: "p1", name: "Generated", subtitle: "Practice · 練習", width: 7, height: 7 };
+
+test("the header names the puzzle, and its level when it was made at one", () => {
+  expect(puzzleTitle(SUMMARY)).toBe("Generated · 7×7");
+  expect(puzzleSubtitle(SUMMARY)).toBe("Practice · 練習");
+  expect(puzzleSubtitle({ ...SUMMARY, level: "easy" })).toBe("Practice · 練習 · Easy");
+  expect(["easy", "medium", "hard"].map((l) => levelName(l as "easy"))).toEqual([
+    "Easy",
+    "Medium",
+    "Hard",
+  ]);
+});
```

#### `apps/web/src/lib/puzzles/api.ts`

```diff
diff --git a/apps/web/src/lib/puzzles/api.ts b/apps/web/src/lib/puzzles/api.ts
index 2776e10..3dd191e 100644
--- a/apps/web/src/lib/puzzles/api.ts
+++ b/apps/web/src/lib/puzzles/api.ts
@@ -13,6 +13,8 @@ function summary(p: Schemas["PuzzleSummary"]): PuzzleSummary {
     width: p.width,
     height: p.height,
     origin: p.origin,
+    // Player-made puzzles count as hard on the server, but weren't made at a level.
+    level: p.origin === "generated" ? p.level : undefined,
   };
 }
 
```

#### `apps/web/src/lib/puzzles/api.test.ts`

```diff
diff --git a/apps/web/src/lib/puzzles/api.test.ts b/apps/web/src/lib/puzzles/api.test.ts
index db6ccec..312c04f 100644
--- a/apps/web/src/lib/puzzles/api.test.ts
+++ b/apps/web/src/lib/puzzles/api.test.ts
@@ -5,9 +5,16 @@ import { apiSource } from "./api.ts";
 
 const PUZZLE: Schemas["Puzzle"] = {
   id: "p1",
-  puzzle: { v: 1, width: 2, height: 2, clues: "2222", seed: "s", meta: { generator: "1" } },
+  puzzle: {
+    v: 1,
+    width: 2,
+    height: 2,
+    clues: "2222",
+    seed: "s",
+    meta: { generator: "1", level: "easy" },
+  },
   origin: "generated",
-  level: "hard",
+  level: "easy",
   createdAt: "2026-10-25T12:00:00.000Z",
 };
 
@@ -36,7 +43,18 @@ describe("apiSource", () => {
     const { client, urls } = clientFor({
       "/api/puzzles": [
         200,
-        { items: [{ id: "p1", width: 10, height: 7, origin: "generated", createdAt: "x" }] },
+        {
+          items: [
+            {
+              id: "p1",
+              width: 10,
+              height: 7,
+              origin: "generated",
+              level: "medium",
+              createdAt: "x",
+            },
+          ],
+        },
       ],
     });
     expect(await apiSource(client).list()).toEqual([
@@ -47,27 +65,38 @@ describe("apiSource", () => {
         width: 10,
         height: 7,
         origin: "generated",
+        level: "medium",
       },
     ]);
     expect(urls).toEqual(["/api/puzzles?limit=20"]);
   });
 
-  test("a submitted puzzle is listed as player-made", async () => {
+  test("a submitted puzzle is listed as player-made, without a level", async () => {
     const { client } = clientFor({
       "/api/puzzles": [
         200,
-        { items: [{ id: "s1", width: 5, height: 5, origin: "submitted", createdAt: "x" }] },
+        {
+          items: [
+            { id: "s1", width: 5, height: 5, origin: "submitted", level: "hard", createdAt: "x" },
+          ],
+        },
       ],
     });
-    expect(await apiSource(client).list()).toMatchObject([
-      { id: "s1", name: "Player-made", origin: "submitted" },
-    ]);
+    const [entry] = await apiSource(client).list();
+    expect(entry).toMatchObject({ id: "s1", name: "Player-made", origin: "submitted" });
+    expect(entry.level).toBeUndefined();
   });
 
   test("get parses the wire puzzle, and is null on 404", async () => {
     const { client } = clientFor({ "/api/puzzles/p1": [200, PUZZLE] });
     const entry = await apiSource(client).get("p1");
-    expect(entry).toMatchObject({ id: "p1", name: "Generated", width: 2, height: 2 });
+    expect(entry).toMatchObject({
+      id: "p1",
+      name: "Generated",
+      width: 2,
+      height: 2,
+      level: "easy",
+    });
     expect(entry && serializePuzzle(entry.puzzle)).toEqual(PUZZLE.puzzle);
     expect(await apiSource(client).get("nope")).toBeNull();
   });
```

#### `apps/web/src/lib/puzzles/index.ts`

```diff
diff --git a/apps/web/src/lib/puzzles/index.ts b/apps/web/src/lib/puzzles/index.ts
index 8854b96..51ed5a6 100644
--- a/apps/web/src/lib/puzzles/index.ts
+++ b/apps/web/src/lib/puzzles/index.ts
@@ -2,14 +2,26 @@ import { createApiClient } from "@loophole/api-client";
 import { apiSource } from "./api.ts";
 import { withServer } from "./combined.ts";
 import { fixtureSource } from "./fixtures.ts";
+import { createPuzzleGenerator } from "./generate.ts";
 import { createReports } from "./reports.ts";
 import type { PuzzleSource } from "./source.ts";
 
+export { type GenerateResult, jobStatusText, NEW_PUZZLE_SIZES } from "./generate.ts";
 export type { ReportedPuzzle } from "./reports.ts";
-export { type PuzzleEntry, type PuzzleSource, type PuzzleSummary, puzzleTitle } from "./source.ts";
+export {
+  levelName,
+  type PuzzleEntry,
+  type PuzzleSource,
+  type PuzzleSummary,
+  puzzleSubtitle,
+  puzzleTitle,
+} from "./source.ts";
 
 /** The puzzle source the screens use: the built-in fixtures, then puzzles from the API. */
 export const puzzleSource: PuzzleSource = withServer(fixtureSource, apiSource(createApiClient()));
 
 /** Reporting puzzles and the admins' list of reports. */
 export const reports = createReports(createApiClient());
+
+/** New practice puzzles from the server (Home's Practice section). */
+export const generator = createPuzzleGenerator(createApiClient());
```

### 3.2 Generator client

#### `apps/web/src/lib/puzzles/generate.ts` (new file)

```diff
diff --git a/apps/web/src/lib/puzzles/generate.ts b/apps/web/src/lib/puzzles/generate.ts
new file mode 100644
index 0000000..1411b45
--- /dev/null
+++ b/apps/web/src/lib/puzzles/generate.ts
@@ -0,0 +1,95 @@
+import type { ApiClient, Schemas } from "@loophole/api-client";
+import type { Level } from "@loophole/core";
+import { failureMessage } from "../auth/auth.ts";
+
+export type Job = Schemas["Job"];
+
+/** The sizes Home offers for a new practice puzzle (Home artboard, Practice). */
+export const NEW_PUZZLE_SIZES: readonly number[] = [5, 7, 10, 15];
+
+export type GenerateResult =
+  | { readonly ok: true; readonly puzzleId: string }
+  | { readonly ok: false; readonly message: string };
+
+export interface GenerateOptions {
+  /** Time between two looks at the job. */
+  readonly intervalMs?: number;
+  readonly sleep?: (ms: number) => Promise<void>;
+  /** Stops following the job when aborted (the page was left); the job itself carries on. */
+  readonly signal?: AbortSignal;
+  /** Called with the job each time it is read, for a progress line. */
+  readonly onJob?: (job: Job) => void;
+}
+
+const OFFLINE = "Couldn't reach the server. Check your connection and try again.";
+const FAILED = "The puzzle couldn't be made. Try again.";
+const STOPPED = "Stopped waiting for the puzzle.";
+
+/**
+ * Why a request was refused. The server's own words first: its 429 here says how many puzzles the
+ * player already has on the way, which the generic "too many attempts" would not.
+ */
+function refusal(status: number, problem: unknown): string {
+  const detail = (problem as { detail?: unknown } | undefined)?.detail;
+  return typeof detail === "string" ? detail : failureMessage(status, problem);
+}
+
+/** What a job's progress line says: waiting in the queue, or how far generation has got. */
+export function jobStatusText(job: Job): string {
+  if (job.status === "queued") return "Waiting for its turn…";
+  return `Making the puzzle… ${Math.round(job.progress * 100)}%`;
+}
+
+/** New practice puzzles from the server's worker (PRD FR-7, FR-11), over the generated client. */
+export function createPuzzleGenerator(client: ApiClient) {
+  async function read(id: string): Promise<Job | string> {
+    try {
+      const { data, error, response } = await client.GET("/api/jobs/{id}", {
+        params: { path: { id } },
+      });
+      return data ?? refusal(response.status, error);
+    } catch {
+      return OFFLINE;
+    }
+  }
+
+  return {
+    /**
+     * Queues a `width` × `height` puzzle at `level` and waits until it is made, however long the
+     * queue is. Resolves to the new puzzle's id, or to a message saying why there is none.
+     */
+    async generate(
+      width: number,
+      height: number,
+      level: Level,
+      options: GenerateOptions = {},
+    ): Promise<GenerateResult> {
+      const interval = options.intervalMs ?? 1_000;
+      const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
+      let job: Job | string;
+      try {
+        const { data, error, response } = await client.POST("/api/jobs/generate", {
+          body: { width, height, level },
+        });
+        job = data ?? refusal(response.status, error);
+      } catch {
+        job = OFFLINE;
+      }
+      for (;;) {
+        if (typeof job === "string") return { ok: false, message: job };
+        options.onJob?.(job);
+        if (job.status === "done" && job.result !== null) {
+          return { ok: true, puzzleId: job.result.puzzleId };
+        }
+        if (job.status === "failed" || job.status === "timeout") {
+          return { ok: false, message: FAILED };
+        }
+        await sleep(interval);
+        if (options.signal?.aborted) return { ok: false, message: STOPPED };
+        job = await read(job.id);
+      }
+    },
+  };
+}
+
+export type PuzzleGenerator = ReturnType<typeof createPuzzleGenerator>;
```

#### `apps/web/src/lib/puzzles/generate.test.ts` (new file)

```diff
diff --git a/apps/web/src/lib/puzzles/generate.test.ts b/apps/web/src/lib/puzzles/generate.test.ts
new file mode 100644
index 0000000..e649755
--- /dev/null
+++ b/apps/web/src/lib/puzzles/generate.test.ts
@@ -0,0 +1,107 @@
+import { describe, expect, test } from "bun:test";
+import { createApiClient } from "@loophole/api-client";
+import { createPuzzleGenerator, type Job, jobStatusText } from "./generate.ts";
+
+const QUEUED: Job = {
+  id: "j1",
+  kind: "generate",
+  status: "queued",
+  progress: 0,
+  result: null,
+  error: null,
+  createdAt: "2026-10-26T12:00:00.000Z",
+  startedAt: null,
+  finishedAt: null,
+};
+const RUNNING: Job = { ...QUEUED, status: "running", progress: 0.4 };
+const DONE: Job = { ...QUEUED, status: "done", progress: 1, result: { puzzleId: "j1" } };
+
+/** A client whose fetch answers each request with the next of `answers` and records them. */
+function clientFor(answers: [number, unknown][]) {
+  const requests: { method: string; path: string; body: unknown }[] = [];
+  const fetch = (async (input: Request) => {
+    const url = new URL(input.url);
+    const body = input.method === "POST" ? await input.json() : undefined;
+    requests.push({ method: input.method, path: url.pathname, body });
+    const [status, answer] = answers.shift() ?? [500, { title: "No answer" }];
+    return new Response(JSON.stringify(answer), {
+      status,
+      headers: { "Content-Type": status < 400 ? "application/json" : "application/problem+json" },
+    });
+  }) as typeof globalThis.fetch;
+  return { client: createApiClient({ baseUrl: "http://api.test", fetch }), requests };
+}
+
+const noWait = { sleep: async () => {} };
+
+describe("puzzle generator", () => {
+  test("queues the size and level, follows the job and resolves to the new puzzle", async () => {
+    const { client, requests } = clientFor([
+      [202, QUEUED],
+      [200, RUNNING],
+      [200, DONE],
+    ]);
+    const seen: string[] = [];
+    const result = await createPuzzleGenerator(client).generate(7, 7, "easy", {
+      ...noWait,
+      onJob: (job) => seen.push(jobStatusText(job)),
+    });
+    expect(result).toEqual({ ok: true, puzzleId: "j1" });
+    expect(requests).toEqual([
+      { method: "POST", path: "/api/jobs/generate", body: { width: 7, height: 7, level: "easy" } },
+      { method: "GET", path: "/api/jobs/j1", body: undefined },
+      { method: "GET", path: "/api/jobs/j1", body: undefined },
+    ]);
+    expect(seen).toEqual([
+      "Waiting for its turn…",
+      "Making the puzzle… 40%",
+      "Making the puzzle… 100%",
+    ]);
+  });
+
+  test("a refusal comes back with the server's words, the per-player cap included", async () => {
+    const detail =
+      "You already have 3 puzzles being generated. Wait for one to finish, then try again.";
+    const { client } = clientFor([
+      [429, { title: "Too many generations in progress", status: 429, detail }],
+      [503, { title: "Queue full", status: 503 }],
+    ]);
+    const generator = createPuzzleGenerator(client);
+    expect(await generator.generate(5, 5, "hard", noWait)).toEqual({ ok: false, message: detail });
+    expect(await generator.generate(5, 5, "hard", noWait)).toEqual({
+      ok: false,
+      message: "Queue full",
+    });
+  });
+
+  test("a failed or timed-out job, and a lost connection, end with a message", async () => {
+    const failed = clientFor([
+      [202, QUEUED],
+      [200, { ...QUEUED, status: "timeout" }],
+    ]);
+    expect(await createPuzzleGenerator(failed.client).generate(5, 5, "hard", noWait)).toEqual({
+      ok: false,
+      message: "The puzzle couldn't be made. Try again.",
+    });
+    const offline = createApiClient({
+      baseUrl: "http://api.test",
+      fetch: (async () => {
+        throw new TypeError("Failed to fetch");
+      }) as unknown as typeof globalThis.fetch,
+    });
+    const result = await createPuzzleGenerator(offline).generate(5, 5, "hard", noWait);
+    expect(result.ok).toBe(false);
+    expect(!result.ok && result.message).toContain("Couldn't reach the server");
+  });
+
+  test("stops following the job when aborted", async () => {
+    const { client, requests } = clientFor([[202, QUEUED]]);
+    const controller = new AbortController();
+    const result = await createPuzzleGenerator(client).generate(5, 5, "hard", {
+      sleep: async () => controller.abort(),
+      signal: controller.signal,
+    });
+    expect(result.ok).toBe(false);
+    expect(requests).toHaveLength(1);
+  });
+});
```

### 3.3 "Medium" 10×10 becomes "Regular"

#### `apps/web/src/lib/daily/days.ts`

```diff
diff --git a/apps/web/src/lib/daily/days.ts b/apps/web/src/lib/daily/days.ts
index a653411..59e189e 100644
--- a/apps/web/src/lib/daily/days.ts
+++ b/apps/web/src/lib/daily/days.ts
@@ -5,8 +5,11 @@ const DAY_MS = 24 * 60 * 60 * 1000;
 /** The daily size classes, smallest first. */
 export const DAILY_SIZES = [7, 10, 20, 40];
 
-/** Display names of the daily size classes (Home artboard). */
-const SIZE_NAMES: Record<number, string> = { 7: "Small", 10: "Medium", 20: "Large", 40: "Giant" };
+/**
+ * Display names of the daily size classes (Home artboard). The artboard's "Medium" for 10×10 is
+ * "Regular" here, since Medium is also a level (DECISIONS, WT21).
+ */
+const SIZE_NAMES: Record<number, string> = { 7: "Small", 10: "Regular", 20: "Large", 40: "Giant" };
 
 /** "Small" for 7, … ; "15×15" for a size without a name. */
 export function sizeName(size: number): string {
```

#### `apps/web/src/lib/daily/days.test.ts`

```diff
diff --git a/apps/web/src/lib/daily/days.test.ts b/apps/web/src/lib/daily/days.test.ts
index 5b15057..20e3156 100644
--- a/apps/web/src/lib/daily/days.test.ts
+++ b/apps/web/src/lib/daily/days.test.ts
@@ -15,7 +15,7 @@ import {
 
 describe("daily names and dates", () => {
   test("size classes have the Home artboard's names and cover tints", () => {
-    expect([7, 10, 20, 40].map(sizeName)).toEqual(["Small", "Medium", "Large", "Giant"]);
+    expect([7, 10, 20, 40].map(sizeName)).toEqual(["Small", "Regular", "Large", "Giant"]);
     expect(sizeName(15)).toBe("15×15");
     expect([7, 10, 20, 40].map(coverTint)).toEqual(["#F2C4CE", "#E8DFC4", "#C8DAE6", "#D5E3C2"]);
   });
```

#### `apps/web/src/lib/puzzles/fixtures.ts`

```diff
diff --git a/apps/web/src/lib/puzzles/fixtures.ts b/apps/web/src/lib/puzzles/fixtures.ts
index 5807992..23a63b0 100644
--- a/apps/web/src/lib/puzzles/fixtures.ts
+++ b/apps/web/src/lib/puzzles/fixtures.ts
@@ -30,7 +30,7 @@ export const FIXTURES: readonly FixtureRecord[] = [
   },
   {
     id: "medium-10",
-    name: "Medium",
+    name: "Regular",
     subtitle: "Practice · 練習",
     wire: {
       v: 1,
```

### 3.4 Screens

#### `apps/web/src/lib/components/BookCover.svelte`

```diff
diff --git a/apps/web/src/lib/components/BookCover.svelte b/apps/web/src/lib/components/BookCover.svelte
index bd1282d..fae10c9 100644
--- a/apps/web/src/lib/components/BookCover.svelte
+++ b/apps/web/src/lib/components/BookCover.svelte
@@ -8,10 +8,12 @@
     width: number;
     height: number;
     name: string;
+    /** The level the puzzle was made at, e.g. "Hard"; none for puzzles not made at a level. */
+    level?: string;
     status: CoverStatus;
   }
 
-  let { href, width, height, name, status }: Props = $props();
+  let { href, width, height, name, level, status }: Props = $props();
 
   // The dot paper gets finer for bigger boards (Home artboard: 12px, then 8px and 5px).
   const dots = $derived(width >= 40 ? 5 : width >= 20 ? 8 : 12);
@@ -29,7 +31,10 @@
 >
   <span class="badge">{width}×{height}</span>
   <span class="kana">スリザーリンク</span>
-  <span class="name">{name}</span>
+  <span class="title">
+    <span class="name">{name}</span>
+    {#if level !== undefined}<span class="level">{level}</span>{/if}
+  </span>
   <span class="paper" aria-hidden="true"></span>
   <span class="status">
     {#if status.kind === "solved"}
@@ -78,6 +83,13 @@
     letter-spacing: 0.08em;
   }
 
+  .title {
+    display: flex;
+    flex-wrap: wrap;
+    align-items: center;
+    gap: 4px 8px;
+  }
+
   .name {
     font-family: var(--font-display);
     font-weight: 900;
@@ -85,6 +97,16 @@
     line-height: 1;
   }
 
+  /* The level as a small ink-outlined tag beside the name: a word, never a colour alone (NFR-5). */
+  .level {
+    padding: 1px 7px;
+    border: 1.5px solid #1e1c19;
+    border-radius: 999px;
+    font-size: 12px;
+    font-weight: 700;
+    line-height: 1.4;
+  }
+
   .paper {
     flex: 1 1 auto;
     border: 2px solid #1e1c19;
```

#### `apps/web/src/lib/components/NewPuzzle.svelte` (new file)

```diff
diff --git a/apps/web/src/lib/components/NewPuzzle.svelte b/apps/web/src/lib/components/NewPuzzle.svelte
new file mode 100644
index 0000000..79f6cb0
--- /dev/null
+++ b/apps/web/src/lib/components/NewPuzzle.svelte
@@ -0,0 +1,127 @@
+<script lang="ts">
+  import { LEVELS, type Level } from "@loophole/core";
+  import { onDestroy } from "svelte";
+  import { goto } from "$app/navigation";
+  import { generator, jobStatusText, levelName, NEW_PUZZLE_SIZES } from "../puzzles/index.ts";
+
+  let size = $state(7);
+  let level = $state<Level>("hard");
+  let busy = $state(false);
+  let status = $state("");
+  let error = $state("");
+  // Stops following the job when Home is left; the worker still makes the puzzle.
+  const controller = new AbortController();
+  onDestroy(() => controller.abort());
+
+  async function make() {
+    busy = true;
+    error = "";
+    status = "Asking for a puzzle…";
+    const result = await generator.generate(size, size, level, {
+      signal: controller.signal,
+      onJob: (job) => {
+        status = jobStatusText(job);
+      },
+    });
+    if (controller.signal.aborted) return;
+    busy = false;
+    status = "";
+    if (result.ok) await goto(`/play/${encodeURIComponent(result.puzzleId)}`);
+    else error = result.message;
+  }
+</script>
+
+<!-- A new practice puzzle from the worker (Home artboard, Practice: size chips and "New 7×7
+     puzzle"), with a level to choose (PRD FR-7). -->
+<div class="new-puzzle">
+  <fieldset class="choices">
+    <legend class="visually-hidden">Size</legend>
+    {#each NEW_PUZZLE_SIZES as s (s)}
+      <button type="button" class="chip" aria-pressed={s === size} disabled={busy} onclick={() => (size = s)}>{s}×{s}</button>
+    {/each}
+  </fieldset>
+  <fieldset class="choices">
+    <legend class="visually-hidden">Level</legend>
+    {#each LEVELS as l (l)}
+      <button type="button" class="chip" aria-pressed={l === level} disabled={busy} onclick={() => (level = l)}>{levelName(l)}</button>
+    {/each}
+  </fieldset>
+  <button type="button" class="primary" disabled={busy} onclick={make}>New {levelName(level).toLowerCase()} {size}×{size} puzzle</button>
+  {#if status}<p class="soft" role="status">{status}</p>{/if}
+  {#if error}<p class="error" role="alert">{error}</p>{/if}
+</div>
+
+<style>
+  .new-puzzle {
+    display: flex;
+    flex-direction: column;
+    gap: 10px;
+  }
+
+  .choices {
+    margin: 0;
+    padding: 0 0 2px;
+    border: 0;
+    min-width: 0;
+    display: flex;
+    gap: 8px;
+    overflow-x: auto;
+  }
+
+  /* Size and level chips, as on the leaderboard page (Home artboard, Practice). */
+  .chip {
+    flex: 0 0 auto;
+    height: 44px;
+    padding: 0 14px;
+    border-radius: 8px;
+    border: 2px solid var(--hairline);
+    background: var(--sheet);
+    color: var(--ink);
+    font-size: 15px;
+    font-weight: 700;
+    cursor: pointer;
+    touch-action: manipulation;
+  }
+
+  .chip[aria-pressed="true"] {
+    border-color: var(--ink);
+    background: var(--ink);
+    color: var(--on-ink);
+  }
+
+  .primary {
+    align-self: flex-start;
+    height: 48px;
+    padding: 0 28px;
+    border: 0;
+    border-radius: 999px;
+    background: var(--ink);
+    color: var(--on-ink);
+    font-size: 16px;
+    font-weight: 700;
+    cursor: pointer;
+    touch-action: manipulation;
+  }
+
+  .primary:disabled,
+  .chip:disabled {
+    cursor: default;
+  }
+
+  .primary:disabled {
+    opacity: 0.6;
+  }
+
+  .soft {
+    margin: 0;
+    font-size: 14px;
+    color: var(--ink-soft);
+  }
+
+  .error {
+    margin: 0;
+    padding: 10px 12px;
+    border-left: 4px solid var(--shu);
+    background: var(--sheet);
+  }
+</style>
```

#### `apps/web/src/routes/+page.svelte`

```diff
diff --git a/apps/web/src/routes/+page.svelte b/apps/web/src/routes/+page.svelte
index 28d35d1..bd90372 100644
--- a/apps/web/src/routes/+page.svelte
+++ b/apps/web/src/routes/+page.svelte
@@ -1,10 +1,11 @@
 <script lang="ts">
   import type { Schemas } from "@loophole/api-client";
-  import { createGrid } from "@loophole/core";
+  import { createGrid, type Level } from "@loophole/core";
   import { onMount } from "svelte";
   import { auth } from "$lib/auth/index.ts";
   import BookCover from "$lib/components/BookCover.svelte";
   import GuestImport from "$lib/components/GuestImport.svelte";
+  import NewPuzzle from "$lib/components/NewPuzzle.svelte";
   import SiteHeader from "$lib/components/SiteHeader.svelte";
   import StreakCard from "$lib/components/StreakCard.svelte";
   import type { DailySet, DailySummary } from "$lib/daily/api.ts";
@@ -21,6 +22,7 @@
   import { daily } from "$lib/daily/index.ts";
   import { type CoverStatus, coverStatus } from "$lib/daily/view.ts";
   import { formatClock } from "$lib/game/timer.ts";
+  import { levelName } from "$lib/puzzles/index.ts";
   import { inProgress, localProgress } from "$lib/sync/index.ts";
   import type { PageProps } from "./$types";
 
@@ -38,7 +40,7 @@
   let fetchedAt = 0;
 
   const day = $derived(today?.day ?? utcDay(now));
-  const dailyCovers: { size: number; puzzleId: string | null }[] = $derived(
+  const dailyCovers: { size: number; level?: Level; puzzleId: string | null }[] = $derived(
     today?.puzzles ?? DAILY_SIZES.map((size) => ({ size, puzzleId: null })),
   );
   const msLeft = $derived(today ? Math.max(0, Date.parse(today.nextAt) - now) : msToNextDay(now));
@@ -144,6 +146,7 @@
             width={p.size}
             height={p.size}
             name={sizeName(p.size)}
+            level={p.level === undefined ? undefined : levelName(p.level)}
             status={dailyStatuses[p.size] ?? coverStatus({ size: p.size, ready: p.puzzleId !== null })}
           />
         </li>
@@ -177,6 +180,7 @@
       <h2 id="practice-h">Practice <span class="jp">練習</span></h2>
       <span class="soft">fresh, proven unique</span>
     </div>
+    <NewPuzzle />
     <ul class="covers">
       {#each data.puzzles as p (p.id)}
         <li>
@@ -185,6 +189,7 @@
             width={p.width}
             height={p.height}
             name={p.name}
+            level={p.level === undefined ? undefined : levelName(p.level)}
             status={statuses[p.id] ?? coverStatus({ size: p.width, ready: true })}
           />
         </li>
```

#### `apps/web/src/lib/components/PlayScreen.svelte`

```diff
diff --git a/apps/web/src/lib/components/PlayScreen.svelte b/apps/web/src/lib/components/PlayScreen.svelte
index 9b03b6e..b1d05b5 100644
--- a/apps/web/src/lib/components/PlayScreen.svelte
+++ b/apps/web/src/lib/components/PlayScreen.svelte
@@ -34,7 +34,7 @@
     stop,
   } from "../game/timer.ts";
   import { clampView, type View, viewLayout, zoomLimits } from "../game/viewport.ts";
-  import { type PuzzleEntry, puzzleSource, puzzleTitle } from "../puzzles/index.ts";
+  import { type PuzzleEntry, puzzleSource, puzzleSubtitle, puzzleTitle } from "../puzzles/index.ts";
   import { openSaves, type PuzzleSaves } from "../sync/index.ts";
   import BoardView from "./BoardView.svelte";
   import HintCard from "./HintCard.svelte";
@@ -368,7 +368,7 @@
     </a>
     <div class="titles">
       <h1>{puzzleTitle(entry)}</h1>
-      <span class="subtitle">{entry.subtitle}</span>
+      <span class="subtitle">{puzzleSubtitle(entry)}</span>
       <span class="subtitle count"><b>{analysis.satisfiedClues}</b> of {analysis.clueCount} clues</span>
     </div>
     <div class="pill">
```

#### `apps/web/src/lib/components/SolvedView.svelte`

```diff
diff --git a/apps/web/src/lib/components/SolvedView.svelte b/apps/web/src/lib/components/SolvedView.svelte
index fac5b15..f09bfde 100644
--- a/apps/web/src/lib/components/SolvedView.svelte
+++ b/apps/web/src/lib/components/SolvedView.svelte
@@ -5,7 +5,7 @@
   import { daily } from "../daily/index.ts";
   import { shareText } from "../daily/view.ts";
   import { formatClock } from "../game/timer.ts";
-  import type { PuzzleEntry } from "../puzzles/index.ts";
+  import { type PuzzleEntry, puzzleSubtitle } from "../puzzles/index.ts";
   import { openSaves } from "../sync/index.ts";
   import LeaderboardCard from "./LeaderboardCard.svelte";
   import SolvedBoard from "./SolvedBoard.svelte";
@@ -82,7 +82,7 @@
     </a>
     <div class="titles">
       <h1>{entry.name} · {size}×{size}</h1>
-      <span class="subtitle">{entry.subtitle}</span>
+      <span class="subtitle">{puzzleSubtitle(entry)}</span>
     </div>
     <button type="button" class="round" onclick={share}>
       <span class="visually-hidden">{shareNote || "Share result"}</span>
```

#### `apps/web/src/routes/daily/[day]/[size]/+page.svelte`

```diff
diff --git a/apps/web/src/routes/daily/[day]/[size]/+page.svelte b/apps/web/src/routes/daily/[day]/[size]/+page.svelte
index f783a6a..b2ce1e2 100644
--- a/apps/web/src/routes/daily/[day]/[size]/+page.svelte
+++ b/apps/web/src/routes/daily/[day]/[size]/+page.svelte
@@ -10,6 +10,7 @@
   import { sizeName } from "$lib/daily/days.ts";
   import { daily, finisherFor } from "$lib/daily/index.ts";
   import { dailyMode } from "$lib/daily/view.ts";
+  import { puzzleSubtitle } from "$lib/puzzles/index.ts";
   import { openSaves } from "$lib/sync/index.ts";
   import type { PageProps } from "./$types";
 
@@ -137,7 +138,7 @@
 {:else if mode.kind === "gate"}
   <SiteHeader />
   <main class="page">
-    <p class="eyebrow">{data.entry.subtitle}</p>
+    <p class="eyebrow">{puzzleSubtitle(data.entry)}</p>
     <h1>{name}</h1>
     <div class="card">
       <h2>Ranked solve</h2>
```

### 3.5 End-to-end tests

`daily.e2e.ts`: the 7×7 cover contains "Hard"; the guest daily subtitle matches `/^Daily · .* · Hard$/`; "Next: Regular 10×10". Stories: `/Regular/`. New `generate.e2e.ts` (phone 390×844, routes stood in with `page.route`): Hard pressed by default; pick 10×10 + Easy; no sideways scroll; the POST body is `{ width: 10, height: 10, level: "easy" }`; after one running poll and a done poll the page is `/play/p-easy` with heading "Generated · 10×10" and "Practice · 練習 · Easy"; a 429 shows the server's `detail` in `role=alert` and the button is enabled again.

#### `apps/web/tests/daily.e2e.ts`

```diff
diff --git a/apps/web/tests/daily.e2e.ts b/apps/web/tests/daily.e2e.ts
index 1c94f09..c18ea05 100644
--- a/apps/web/tests/daily.e2e.ts
+++ b/apps/web/tests/daily.e2e.ts
@@ -25,6 +25,8 @@ test.describe("home on a phone (Home artboard, FR-22, FR-24)", () => {
     const small = covers.getByRole("link", { name: /Small.*New · not started/ });
     await expect(small).toHaveAttribute("href", `/daily/${TODAY}/7`);
     await expect(small).toHaveCSS("background-color", "rgb(242, 196, 206)");
+    // Each cover names its level (PRD FR-7, FR-22).
+    await expect(small).toContainText("Hard");
     await expect(covers.getByText("Not ready yet")).toHaveCount(3);
     await expect(page.getByText("With an account, your daily solves are ranked")).toBeVisible();
     await expect(page.getByRole("heading", { name: "Practice 練習" })).toBeVisible();
@@ -86,7 +88,7 @@ test.describe("daily play", () => {
     await mockDailyApi(page);
     await page.goto(`/daily/${TODAY}/7`);
     await expect(page.getByRole("heading", { name: "Small · 7×7" })).toBeVisible();
-    await expect(page.getByText("Daily ·").first()).toBeVisible();
+    await expect(page.getByText(/^Daily · .* · Hard$/).first()).toBeVisible();
     await expect(board(page)).toBeVisible();
     await expect(page.getByText("Playing unranked.")).toBeVisible();
   });
@@ -197,7 +199,7 @@ test.describe("Solved screen (Solved artboard, FR-23, FR-24)", () => {
     await expect(rows.filter({ hasText: "kuroneko" })).toContainText("01:12");
     await expect(rows.filter({ hasText: "You" })).toContainText("214");
     await expect(rows.filter({ hasText: "Anonymous" })).toContainText("213");
-    await expect(page.getByRole("link", { name: /Next: Medium 10×10/ })).toHaveAttribute(
+    await expect(page.getByRole("link", { name: /Next: Regular 10×10/ })).toHaveAttribute(
       "href",
       `/daily/${TODAY}/10`,
     );
```

#### `apps/web/tests/stories.story-e2e.ts`

```diff
diff --git a/apps/web/tests/stories.story-e2e.ts b/apps/web/tests/stories.story-e2e.ts
index 24df8a1..760933b 100644
--- a/apps/web/tests/stories.story-e2e.ts
+++ b/apps/web/tests/stories.story-e2e.ts
@@ -276,7 +276,7 @@ test("as a player, I can play today's daily puzzle and keep a streak", async ({
   await page.goto("/");
   await expect(page.getByLabel("Streak")).toContainText("0 day streak");
   const covers = page.getByRole("list", { name: "Today's daily puzzles" });
-  await covers.getByRole("link", { name: /Medium/ }).click();
+  await covers.getByRole("link", { name: /Regular/ }).click();
   await page.getByRole("button", { name: "Start" }).click();
   await expect(board(page)).toBeVisible();
   // 10×10 needs at least 10 s to count (0.1 s per cell).
@@ -284,6 +284,6 @@ test("as a player, I can play today's daily puzzle and keep a streak", async ({
   await expect(page.getByText("Rank today")).toBeVisible({ timeout: 15_000 });
   await page.goto("/");
   await expect(page.getByLabel("Streak")).toContainText("1 day streak");
-  await expect(covers.getByRole("link", { name: /Medium.*Solved/ })).toBeVisible();
+  await expect(covers.getByRole("link", { name: /Regular.*Solved/ })).toBeVisible();
   await page.context().close();
 });
```

#### `apps/web/tests/generate.e2e.ts` (new file)

```diff
diff --git a/apps/web/tests/generate.e2e.ts b/apps/web/tests/generate.e2e.ts
new file mode 100644
index 0000000..96afb11
--- /dev/null
+++ b/apps/web/tests/generate.e2e.ts
@@ -0,0 +1,84 @@
+import { expect, type Route, test } from "@playwright/test";
+import { FIXTURES } from "../src/lib/puzzles/fixtures.ts";
+import { scrollsSideways } from "./board.ts";
+
+// A new practice puzzle from Home's Practice section (PRD FR-7, FR-11), against a stand-in for the
+// job and puzzle routes: `bun run test:e2e` runs with no server.
+
+const medium10 = FIXTURES.find((f) => f.id === "medium-10");
+if (medium10 === undefined) throw new Error("medium-10 fixture missing");
+
+const JOB = {
+  id: "j1",
+  kind: "generate",
+  status: "queued",
+  progress: 0,
+  result: null,
+  error: null,
+  createdAt: "2026-10-26T12:00:00.000Z",
+  startedAt: null,
+  finishedAt: null,
+};
+
+const json = (route: Route, body: unknown, status = 200) =>
+  route.fulfill({
+    status,
+    contentType: status < 400 ? "application/json" : "application/problem+json",
+    body: JSON.stringify(body),
+  });
+
+test.describe("a new practice puzzle on a phone", () => {
+  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
+
+  test("pick a size and a level, wait for the worker, then play it with its level shown", async ({
+    page,
+  }) => {
+    let polls = 0;
+    await page.route("**/api/jobs/generate", (route) => json(route, JOB, 202));
+    await page.route("**/api/jobs/j1", (route) =>
+      json(
+        route,
+        ++polls < 2
+          ? { ...JOB, status: "running", progress: 0.5 }
+          : { ...JOB, status: "done", progress: 1, result: { puzzleId: "p-easy" } },
+      ),
+    );
+    await page.route("**/api/puzzles/p-easy", (route) =>
+      json(route, {
+        id: "p-easy",
+        puzzle: { ...medium10.wire, meta: { generator: "6", level: "easy" } },
+        origin: "generated",
+        level: "easy",
+        createdAt: "2026-10-26T12:00:01.000Z",
+      }),
+    );
+    await page.goto("/");
+    const sizes = page.getByRole("group", { name: "Size" });
+    const levels = page.getByRole("group", { name: "Level" });
+    await expect(levels.getByRole("button", { name: "Hard" })).toHaveAttribute(
+      "aria-pressed",
+      "true",
+    );
+    await sizes.getByRole("button", { name: "10×10" }).click();
+    await levels.getByRole("button", { name: "Easy" }).click();
+    expect(await scrollsSideways(page)).toBe(false);
+    const sent = page.waitForRequest("**/api/jobs/generate");
+    await page.getByRole("button", { name: "New easy 10×10 puzzle" }).click();
+    expect((await sent).postDataJSON()).toEqual({ width: 10, height: 10, level: "easy" });
+    await page.waitForURL("**/play/p-easy");
+    await expect(page.getByRole("heading", { name: "Generated · 10×10" })).toBeVisible();
+    await expect(page.getByText("Practice · 練習 · Easy")).toBeVisible();
+  });
+
+  test("a refusal is shown in the server's words", async ({ page }) => {
+    const detail =
+      "You already have 3 puzzles being generated. Wait for one to finish, then try again.";
+    await page.route("**/api/jobs/generate", (route) =>
+      json(route, { title: "Too many generations in progress", status: 429, detail }, 429),
+    );
+    await page.goto("/");
+    await page.getByRole("button", { name: "New hard 7×7 puzzle" }).click();
+    await expect(page.getByRole("alert")).toHaveText(detail);
+    await expect(page.getByRole("button", { name: "New hard 7×7 puzzle" })).toBeEnabled();
+  });
+});
```

### 3.6 Check, end-to-end, commit

`bun run format && bun run check` (886 pass, 3 skip). From `apps/web`: `E2E_PORT=4391 bun run test:e2e` (142 passed). Then from the repo root `docker compose up -d && ./scripts/garage-init.sh`, from `apps/web` `E2E_AUTH_PORT=4392 bun run test:e2e:auth` (5) and `E2E_AUTH_PORT=4392 bun run test:e2e:stories` (6), then `docker compose stop`. Commit: `feat(web): show puzzle levels and make practice puzzles at a chosen level`

## Commit 4 — docs

PRD §4 (difficulty ratings no longer a non-goal, except for player-made puzzles), FR-11, FR-22, FR-29 (P1, no longer deferred), §14 Q1; DECISIONS: 4 entries appended after WT20's (levels on the server; worker fairness; graceful shutdown; levels in the web app); README (status, server section with `level` and fairness, `?level=hard`, deploy drain); TESTING (migration tests, shutdown tests); server AGENTS (level column is the source; priorities, verify lane, drain).

#### `docs/PRD.md`

```diff
diff --git a/docs/PRD.md b/docs/PRD.md
index e3665d4..713305b 100644
--- a/docs/PRD.md
+++ b/docs/PRD.md
@@ -32,7 +32,7 @@ Existing Slitherlink sites and apps are either ad-heavy, desktop-oriented, limit
 - Native apps, offline/PWA install, real-time multiplayer.
 - Monetization.
 - Human moderation of submissions.
-- Difficulty ratings (deferred until we know which techniques matter; see §14).
+- Difficulty ratings for player-made puzzles: they count as hard (FR-29). Generated puzzles have levels (FR-7).
 - Submission rate limits and size limits beyond the 100-per-side cap (deferred; small user base).
 
 ## 5. Users
@@ -72,7 +72,7 @@ Priority: **P0** = required for launch, **P1** = soon after.
 - FR-8 (P0). The generator builds a random loop and rejects loops that are too small or thin. Defaults (tunable): the loop must enclose at least ~40% of cells, and its bounding box must span at least ~80% of both dimensions. Thresholds live in config and have tests.
 - FR-9 (P0). Clues are derived from the loop and then removed while uniqueness still holds, so the final puzzle has the same solution and is `unique`.
 - FR-10 (P0). Generation is deterministic for a given seed and version.
-- FR-11 (P0). Large grids are generated by background jobs with progress and a timeout; they are never generated in the request path.
+- FR-11 (P0). Large grids are generated by background jobs with progress and a timeout; they are never generated in the request path. Verifications and daily puzzles go ahead of players' generations, and each player (or guest address) may have only a few generations waiting or running at once.
 
 ### 7.4 Player client
 - FR-12 (P1). Hint: highlights the cells involved in the next forced deduction, using only the rules of the puzzle's level, and explains the rule in words. Using a hint marks the solve as assisted and excludes it from ranked leaderboards.
@@ -89,7 +89,7 @@ Priority: **P0** = required for launch, **P1** = soon after.
 - FR-21 (P0). Auto-saved in-progress state per puzzle, synced across devices; guests use local storage and can migrate to an account.
 
 ### 7.6 Daily puzzle and leaderboards
-- FR-22 (P0). One daily puzzle per size class, the same for everyone, switching at 00:00 UTC.
+- FR-22 (P0). One daily puzzle per size class, the same for everyone, switching at 00:00 UTC. Each size class has one level (FR-29).
 - FR-23 (P0). Leaderboards are bucketed by area (W×H, so 10×15 and 5×30 share a bucket) and level. Rank is by solve time. Hint-assisted solves are excluded.
 - FR-24 (P1). Streaks and personal bests.
 - FR-25 (P0). For ranked puzzles the server does not send the solution; it validates a submitted solution and sanity-checks timing.
@@ -100,7 +100,7 @@ Priority: **P0** = required for launch, **P1** = soon after.
 - FR-28 (P1). Users can report puzzles; admins can unpublish.
 
 ### 7.8 Levels
-- FR-29 (deferred). "Level" in leaderboard buckets is a placeholder. For v1 all puzzles share one level; the field is kept in the schema so difficulty can be added without a migration. See §14.
+- FR-29 (P1). Puzzles have a level: easy, medium or hard (FR-3, FR-7). A generated puzzle keeps the level it was made at, a submitted one counts as hard, and the player sees a generated puzzle's level on its cover and while playing. Players choose the level of a new practice puzzle. Each daily size class has one level, hard for every size in v1, and leaderboards are bucketed by it (FR-23).
 
 ## 8. Non-functional requirements
 
@@ -157,7 +157,7 @@ Working name: **Loophole** (pun on the loop you draw and the "way out" of a logi
 
 ## 14. Open questions
 
-1. Difficulty: which techniques define levels? Answered for the generator (WT20, `docs/DECISIONS.md`): three levels, easy, medium and hard, set by the rules the solver may use and how many clues stay (FR-3, FR-7). Serving them (the generate request, the daily level, leaderboard buckets) is still open; until then the server makes and serves one level, hard.
+1. Difficulty: which techniques define levels? Answered (WT20 and WT21, `docs/DECISIONS.md`): three levels, easy, medium and hard, set by the rules the solver may use and how many clues stay (FR-3, FR-7); the server stores and serves each puzzle's level, and players pick one for practice puzzles (FR-29). Still open: whether a size class's daily should be other than hard, or come at more than one level.
 2. Hosting target and database choice (Postgres assumed).
 3. CAPTCHA provider (e.g. hCaptcha, Cloudflare Turnstile).
 4. SMTP provider for verification and reset emails.
```

#### `docs/DECISIONS.md`

```diff
diff --git a/docs/DECISIONS.md b/docs/DECISIONS.md
index c71c43d..32389b9 100644
--- a/docs/DECISIONS.md
+++ b/docs/DECISIONS.md
@@ -706,3 +706,23 @@ Entry format:
 - **Question:** How do the server and the web app know a puzzle's level, how do hints pick their rules, and does the default output change?
 - **Decision:** A generated puzzle below the default level has `meta.level` (`easy` or `medium`, `docs/FORMAT.md`); at hard it is left out, so the default output is byte-identical to before levels and `GENERATOR_VERSION` stays `"6"` (the version covers every level; changing a level's settings later changes its output and needs a bump). `puzzleLevel(puzzle)` reads `meta.level` and falls back to hard, which also covers puzzles from the editor and from before levels. `findHint` solves with the rules of the puzzle's level, so an easy puzzle's hints name only easy rules; a board those rules cannot move on gets a revealed line, as before. A board too small for a level's rules (no loop's full clue set solved by them in 100 loops: 1×1 at easy and medium, since no rule says the loop exists and only lookahead finds it; the 2×2 square, all 2s, and some 2×3 and 3×2 loops at easy) gets the next level up, from a fresh generator, so it is exactly that level's puzzle and `meta.level` says so. The server keeps only `meta.generator` today, so served puzzles count as hard until WT21 stores the level (its `level` column holds 1 for every puzzle, which is hard). WT21 has to rebuild `meta.level` from what it stores when it loads a puzzle (or hints stay hard), take the level from `puzzleLevel(result.puzzle)` rather than the request, never from a submitted puzzle's `meta`, and keep today's `level = 1` rows hard.
 - **Reason:** Left out at the default, no generated puzzle changes (126 boards from 1×1 to 100×2 compared with the generator before levels, puzzle, solution, steps and stats, and 144 more on other seeds in plan review 1; the goldens are unchanged) and a stored puzzle without the key means what it meant. Hints with every rule on an easy puzzle would name parity, lookahead or corner rules the puzzle never needed; with the level's rules a hint walk on a generated easy and a generated medium 10×10 reaches the solution with no reveal (`hint.test.ts`). Throwing for a tiny board instead would make the level option fail for sizes the API allows. Connectivity without parity throws like colouring (plan review 2): it stays sound, but stops being exact, because the same puzzle gives a different `two-exits` result from an empty board than from a board with more marks (5×4 `2.....0..33..02.2...`, edge 1), so the generator's monotone clue tests could not rely on it. No level uses that combination; the agreement tests cover easy's settings and corners alone without parity.
+
+## 2026-10-26 · WT21 `difficulty-levels` · Levels on the server: a named column, rebuilt into `meta.level`
+- **Question:** How does the server store, serve and use a puzzle's level (PRD FR-7, FR-12, FR-22, FR-23, FR-29), given the WT20 handoff: rebuild `meta.level` on load, take the level from the generator's result, never from a submission, and keep today's `level = 1` rows hard?
+- **Decision:** Migration 007 replaces the integer `level` columns of `puzzles` and `attempts` with text ones, `'easy'`, `'medium'` or `'hard'` (core's `LEVELS`, checked by a constraint), default `'hard'`: every row so far held 1, which was hard, so dropping the old column and adding the new one keeps them hard. `PuzzleRecord.level` and `AttemptRecord.level` are core's `Level`. A generated puzzle's level is `puzzleLevel` of what the worker's thread returned, so a tiny board that fell back to a harder level is stored at that one; the request's level only goes into the job. A daily keeps its level though its seed and generator version are left out; a submitted puzzle keeps only its clues and is hard. The puzzle repository writes the level to its column and, loading a row, puts it back in `meta.level` (left out at hard, as the generator writes it), so `findHint` uses the puzzle's level and the served wire puzzle says it too. The API has a `Level` schema: `level` on `Puzzle`, `PuzzleSummary`, `Attempt`, the summary's bests, `Leaderboard` and each entry of `DailySet`; `POST /api/jobs/generate` takes an optional `level` (default hard); the all-time board is `GET /api/leaderboards/areas/{area}?level=hard` (was `?level=1`). Dailies: `DAILY_CLASSES` in `daily-manager.ts` gives each size class one level, all hard; the scheduler passes it to the job, and `DailySet` gives the stored puzzle's level, or the class's while it isn't ready. The daily seed does not include the level: a size class's level changing later changes its puzzles from that day on, and the stored puzzle's level column says which it was.
+- **Reason:** Names on the wire and in the database say what they mean, and the leaderboard query `?level=1` was the only place the integer had leaked to; a number would have needed a mapping where 1 means the hardest. Keeping the column the source and rebuilding `meta` from it means no code path can serve or hint a level the server didn't decide. Several levels per daily size class would need a day row per size and level and a seed per level; nothing asks for it yet (PRD §14 Q1 keeps it open).
+
+## 2026-10-26 · WT21 `difficulty-levels` · Worker fairness: claim order, a verification lane and a cap per requester
+- **Question:** A 100×100 generation holds the single worker for 6–19 minutes (WT15), anyone may queue one, and the editor's publish gives up after 90 s when its verification waits behind one. What keeps players' long jobs from holding up everyone else?
+- **Decision:** Jobs have a `priority` (migration 008, `JOB_PRIORITY`): 0 for verifications, 1 for daily puzzles, 2 for players' generations; `claimNext` takes the lowest, oldest first within one, still in one `UPDATE … RETURNING`. Jobs already queued get theirs from their kind and input in the migration. Claim order alone can't help a verification that arrives while a 100×100 is running, so the worker runs a second loop, the verification lane (`runVerifyLane`, worker id `<id>/verify`), that claims only priority 0 next to the main loop; a verification is at most `VERIFY_TIMEOUT_MS` (45 s), so the lane never holds a core for long, and the main loop still runs verifications when it is free. Sweeps and daily stocking stay in the main loop. A player's generation records its requester, `user:<id>` when logged in and `ip:<address>` otherwise (the rate limits' address key), and `POST /api/jobs/generate` answers 429 while that requester has `MAX_PENDING_GENERATIONS` (3) generations queued or running. The requester is cleared when the job ends (`finish` and the stale sweep's failure), so no address or account id stays in the jobs table after its job (NFR-6). The queue's overall cap (100 waiting, 503) stays.
+- **Reason:** Measured on the dev stack: with a 100×100 queued before the day's dailies, the worker made the four dailies first and then started the 100×100. Three pending generations lets a player queue the next puzzle while playing one without one person filling the queue; per address for guests, as for the auth rate limits, so one NAT shares a cap but a logged-in player behind it has their own. Alternatives: a priority within players' jobs by size (a small puzzle ahead of a 100×100) would help a second player too, but reorders one player's own jobs and needs the size in the claim query; a second worker process would also run verifications alongside, but costs a second container and its memory all the time, where the lane only uses a thread while a verification runs.
+
+## 2026-10-26 · WT21 `difficulty-levels` · Graceful shutdown: a drain, then the job goes back to the queue
+- **Question:** Docker gives a stopping container 10 s before killing it, so a deploy killed any generation longer than that, and the job came back only when the stale sweep found it 30 s later, its attempt used up. Can the worker wait for a 100×100 to finish instead?
+- **Decision:** Not in full: that could hold a deploy for up to 30 minutes (`GENERATE_TIMEOUT_MS`). On SIGTERM or SIGINT both loops stop claiming at once; the job running gets `WORKER_DRAIN_MS` (60 s) to finish, which covers every verification and daily and most players' puzzles; then its thread is stopped (`TaskRunOptions.signal`, outcome `cancelled`) and `JobQueue.release` puts it back in the queue with its claim taken back (`attempts` one lower), so deploys never use up a job's attempts. The next worker starts it again from the beginning; generation is deterministic, so the puzzle is the same. `compose.prod.yml` gives the worker `stop_grace_period: 90s`, longer than the drain.
+- **Reason:** A minute is enough for nearly every job and keeps deploys quick; the cost is the lost work on a long generation, which reruns from its seed. Checked by hand: a worker with a 100×100 running and `WORKER_DRAIN_MS=3000` exited 3 s after SIGTERM, and the job was queued again with 0 attempts.
+
+## 2026-10-26 · WT21 `difficulty-levels` · Levels in the web app
+- **Question:** Where does the web app show levels, how does a player choose one, and what of the 10×10 size class called "Medium"?
+- **Decision:** Generated server puzzles show their level: a small ink-outlined tag beside the name on Home's covers (dailies and practice), and after the subtitle on the play, ranked-start and Solved screens ("Daily · Sun 25 Oct · 今日の問題 · Hard"). Built-in and player-made puzzles show none, since they weren't made at a level, though the server counts submitted ones as hard. The 10×10 size class is now "Regular" (Small, Regular, Large, Giant), so "Medium · 10×10" can't be read as a level. Home's Practice section gets the artboard's size chips (5×5, 7×7, 10×10, 15×15) and level chips (Easy, Medium, Hard; hard first, as the server's default) and a "New hard 7×7 puzzle" button: it queues the generation, shows "Waiting for its turn…" or the progress, and opens the puzzle when it is made, however long the queue; a refusal (the 429 cap, a full queue, no server) is shown in the server's words. `lib/puzzles/generate.ts` holds the logic, tested under `bun test`; `tests/generate.e2e.ts` covers the screen with the job routes stood in for. The leaderboard page asks for the all-time board at the level of that size's dailies.
+- **Reason:** A level is a fact about how a puzzle was made; showing hard on a player's own puzzle would claim something nobody checked. The artboard's chips were left out in WT11 because nothing served them; the generate request now does. No "Custom" size: the editor already takes any size.
```

#### `README.md`

````diff
diff --git a/README.md b/README.md
index 6e3d79e..ae7ee56 100644
--- a/README.md
+++ b/README.md
@@ -4,7 +4,7 @@ Loophole is a web app for Slitherlink, the Japanese loop puzzle: draw one closed
 
 ## Status
 
-Early development. The repo has the build tooling, the local dev services, the design kit, the puzzle engine (the grid model, the wire format, rule checks for play, a brute-force solution counter for tests, a seeded random number generator, a rule-based solver that records each deduction for hints, a verifier that says whether a puzzle has one solution, none, several, or could not be decided in time, and a generator that makes a puzzle with exactly one solution from a seed, at one of three levels: easy, medium or hard, which differ in the rules the solver may use and in how many clues stay) and a first web app. The web app plays a few built-in puzzles on phones and desktops: tap or drag to draw, keyboard play, undo and redo, a pausable timer, error highlighting, solve detection, light and dark themes, and progress saved in the browser. A Hint button (or H) shows the next forced deduction from the player's board, with the rule's name, a one-line explanation and its pattern drawn small, or points out a mark that doesn't fit; using one marks the attempt as assisted. Boards too big for the screen zoom and pan (pinch, wheel or the zoom buttons) with an overview map, and boards over 30×30 draw on a canvas. The server has its foundation: an HTTP API that serves puzzles, gives hints from each puzzle's stored solution and queues generation jobs, and a worker that generates puzzles in the background with progress and a time limit, keeping each solution in blob storage. The web app lists the server's puzzles after its built-in ones. Players can sign up with an email and password (behind a CAPTCHA, with email confirmation), log in and out, reset a forgotten password and delete their account; guests play exactly as before. Logged-in players' progress on server puzzles syncs to their account, so they can leave a puzzle on one device and carry on on another (a "Continue" list on the home page shows unsolved ones), and they can bring progress they saved as a guest into their account. Anyone can make a puzzle in the editor (Create), which says as they place clues whether it has one answer, none or several, and shows two answers side by side when there are several; players with a confirmed email publish it, the worker proves it has one solution before it goes up, and its link can be shared. Players can report a puzzle, and admins see the reports and can unpublish it. The worker also makes a daily puzzle for each size class (7×7, 10×10, 20×20 and 40×40) a few days ahead, the same for everyone and hidden until 00:00 UTC on its day, and the API checks ranked solves of them against the stored solution and the clock, keeps leaderboards, streaks and personal bests, and lets players choose a name for the leaderboards. The home page shows today's puzzles as book covers with a countdown to the next ones and, for logged-in players, their streak. A confirmed player gets one ranked try at each daily, on a clock that doesn't stop, and the Solved screen shows the time, the rank and the leaderboard of that size; guests play the dailies unranked. The leaderboard page (Ranks) shows each size's board for today and of all time. For launch, the API and the worker export Prometheus metrics and write JSON logs, the API has a readiness check, and there is a production Docker image with a Compose file and a database backup script. Admins see system health on the admin page, and end-to-end suites cover the PRD's user stories and check accessibility in both themes. Each phase's plan is in [`docs/plans/`](docs/plans/).
+Early development. The repo has the build tooling, the local dev services, the design kit, the puzzle engine (the grid model, the wire format, rule checks for play, a brute-force solution counter for tests, a seeded random number generator, a rule-based solver that records each deduction for hints, a verifier that says whether a puzzle has one solution, none, several, or could not be decided in time, and a generator that makes a puzzle with exactly one solution from a seed, at one of three levels: easy, medium or hard, which differ in the rules the solver may use and in how many clues stay) and a first web app. The web app plays a few built-in puzzles on phones and desktops: tap or drag to draw, keyboard play, undo and redo, a pausable timer, error highlighting, solve detection, light and dark themes, and progress saved in the browser. A Hint button (or H) shows the next forced deduction from the player's board, with the rule's name, a one-line explanation and its pattern drawn small, or points out a mark that doesn't fit; using one marks the attempt as assisted. Boards too big for the screen zoom and pan (pinch, wheel or the zoom buttons) with an overview map, and boards over 30×30 draw on a canvas. The server has its foundation: an HTTP API that serves puzzles, gives hints from each puzzle's stored solution and queues generation jobs, and a worker that generates puzzles in the background with progress and a time limit, keeping each solution in blob storage. The web app lists the server's puzzles after its built-in ones. Players can sign up with an email and password (behind a CAPTCHA, with email confirmation), log in and out, reset a forgotten password and delete their account; guests play exactly as before. Logged-in players' progress on server puzzles syncs to their account, so they can leave a puzzle on one device and carry on on another (a "Continue" list on the home page shows unsolved ones), and they can bring progress they saved as a guest into their account. Anyone can make a puzzle in the editor (Create), which says as they place clues whether it has one answer, none or several, and shows two answers side by side when there are several; players with a confirmed email publish it, the worker proves it has one solution before it goes up, and its link can be shared. Players can report a puzzle, and admins see the reports and can unpublish it. The worker also makes a daily puzzle for each size class (7×7, 10×10, 20×20 and 40×40) a few days ahead, the same for everyone and hidden until 00:00 UTC on its day, and the API checks ranked solves of them against the stored solution and the clock, keeps leaderboards, streaks and personal bests, and lets players choose a name for the leaderboards. The home page shows today's puzzles as book covers with a countdown to the next ones and, for logged-in players, their streak. Each generated puzzle shows the level it was made at, and the home page's Practice section asks the worker for a new puzzle of a chosen size and level; the dailies are all hard for now. A confirmed player gets one ranked try at each daily, on a clock that doesn't stop, and the Solved screen shows the time, the rank and the leaderboard of that size; guests play the dailies unranked. The leaderboard page (Ranks) shows each size's board for today and of all time. For launch, the API and the worker export Prometheus metrics and write JSON logs, the API has a readiness check, and there is a production Docker image with a Compose file and a database backup script. Admins see system health on the admin page, and end-to-end suites cover the PRD's user stories and check accessibility in both themes. Each phase's plan is in [`docs/plans/`](docs/plans/).
 
 ## Quickstart
 
@@ -75,15 +75,17 @@ bun run dev:api      # http://localhost:3000
 bun run dev:worker
 ```
 
-Both restart when a file changes. They share the SQLite database at `data/loophole.sqlite` (created on first start) and keep solutions in Garage. Ask for a puzzle, poll the job, then fetch the puzzle:
+Both restart when a file changes. They share the SQLite database at `data/loophole.sqlite` (created on first start) and keep solutions in Garage. Ask for a puzzle (`level` is `easy`, `medium` or `hard`, the default), poll the job, then fetch the puzzle:
 
 ```sh
-curl -s -X POST localhost:3000/api/jobs/generate -H 'content-type: application/json' -d '{"width":10,"height":10}'
+curl -s -X POST localhost:3000/api/jobs/generate -H 'content-type: application/json' -d '{"width":10,"height":10,"level":"easy"}'
 curl -s localhost:3000/api/jobs/<job id>        # status, progress, then result.puzzleId
-curl -s localhost:3000/api/puzzles/<puzzle id>  # clues only
+curl -s localhost:3000/api/puzzles/<puzzle id>  # clues only, and the level
 curl -s -X POST localhost:3000/api/puzzles/<puzzle id>/hint -H 'content-type: application/json' -d '{"edges":"<edge string>"}'
 ```
 
+The worker claims verifications first, then daily puzzles, then players' generations, oldest first in each, and runs verifications in a second lane of their own, so a submission's check never waits for a long generation (a 100×100 takes minutes). Each player, or each address for guests, may have 3 generations waiting or running at once (`MAX_PENDING_GENERATIONS`); more are refused with 429.
+
 The hint takes the player's board in the edge-state encoding (docs/FORMAT.md) and answers with a wrong mark, the next deduction, a line from the solution when no rule applies, or "solved". The API is described in [`openapi.yaml`](openapi.yaml). To serve the built web app from the API as in production, build it (`bun run --cwd apps/web build`) and set `WEB_DIR=apps/web/build` in `.env`.
 
 ### Accounts in development
@@ -121,7 +123,7 @@ The worker generates today's daily puzzles and those of the next two days when i
 curl -s localhost:3000/api/daily                        # today's puzzle ids by size
 curl -s 'localhost:3000/api/daily?day=2026-10-24'       # an earlier day's
 curl -s localhost:3000/api/leaderboards/daily/<puzzle id>
-curl -s 'localhost:3000/api/leaderboards/areas/49?level=1'
+curl -s 'localhost:3000/api/leaderboards/areas/49?level=hard'
 ```
 
 Ranked attempts need a logged-in player with a confirmed email: `POST /api/users/<user id>/attempts/<puzzle id>` starts the clock, and `POST /api/users/<user id>/attempts/<puzzle id>/finish` with `{"edges": …, "elapsedMs": …}` sends the solved board. `docs/DECISIONS.md` has the timing rules.
@@ -151,7 +153,7 @@ Loophole runs as one Docker image with two commands, the API (which also serves
 
 4. Point the reverse proxy at `127.0.0.1:3000` with TLS and compression on (for Caddy: `reverse_proxy 127.0.0.1:3000` and `encode zstd gzip`). The API trusts the last `X-Forwarded-For` entry (`TRUST_PROXY=true` in the Compose file), so nothing but the proxy may reach port 3000: Compose publishes it on 127.0.0.1 only. If the proxy runs on another machine, publish it on the private interface the proxy uses, never on 0.0.0.0.
 
-The database lives in the `loophole-data` volume (`/data/loophole.sqlite`), blobs in `garage-data` and `garage-meta`. To update, pull the code, run `docker compose build` and `docker compose up -d`; migrations run when the API and the worker start. `GET /api/health` says the process is up; `GET /api/health/ready` also checks the database and Garage and answers 503 when either fails, which the Compose health checks use. Logs are one JSON object per line (`docker compose logs api`), with a request id that the API also sends back as `X-Request-Id`; they never hold emails, tokens or passwords.
+The database lives in the `loophole-data` volume (`/data/loophole.sqlite`), blobs in `garage-data` and `garage-meta`. To update, pull the code, run `docker compose build` and `docker compose up -d`; migrations run when the API and the worker start. Stopping the worker (a deploy, `docker compose stop`) lets the job it is running finish for up to `WORKER_DRAIN_MS` (60 s by default; the Compose file's `stop_grace_period` is 90 s); a job still running then, such as a large generation, goes back to the queue and starts again on the new worker. `GET /api/health` says the process is up; `GET /api/health/ready` also checks the database and Garage and answers 503 when either fails, which the Compose health checks use. Logs are one JSON object per line (`docker compose logs api`), with a request id that the API also sends back as `X-Request-Id`; they never hold emails, tokens or passwords.
 
 ## Monitoring
 
````

#### `docs/TESTING.md`

```diff
diff --git a/docs/TESTING.md b/docs/TESTING.md
index 2e390fc..1a5ea2d 100644
--- a/docs/TESTING.md
+++ b/docs/TESTING.md
@@ -49,6 +49,8 @@ Server tests follow its layers:
 - Managers are tested with the fakes in the server's test support (clock, puzzle repository, job queue, task runner) and the in-memory blob store, so they run without a database or threads.
 - SQLite repositories and the job queue are tested on in-memory databases (`openDatabase(":memory:")`), which run the real migrations. The claim race test and the concurrent-open test use a database file shared by several child processes (`Bun.spawn`), as the API and the worker share one; threads would not do (`docs/DECISIONS.md`, "Concurrent-open tests use processes").
 - Routes are tested through Hono's `app.request` over real managers and in-memory adapters, with no server listening.
+- A migration that changes existing rows gets a test that builds the schema before it from the numbered files, adds rows as the older code wrote them, then migrates (`migrations.test.ts`).
+- The worker loop's shutdown (stop claiming, drain, then cancel) is tested with a scripted job runner; the thread runner's cancel stops a real 100×100 generation.
 - The thread task runner is tested with real Bun worker threads, including a 100×100 generation stopped at its time limit.
 - The S3 blob store test runs against Garage when the `S3_*` settings are set (from `.env`) and Garage answers; otherwise it is skipped, as in CI. Start Garage (README, Local services) to run it.
 - The account and session managers run on fakes too (users, sessions, mailed tokens, password hashing, CAPTCHA) with the in-memory mailer and rate limiter. Route tests build the account side with `accountDeps` from the server's test support and pass a client address as `app.request`'s third argument.
```

#### `apps/server/AGENTS.md`

```diff
diff --git a/apps/server/AGENTS.md b/apps/server/AGENTS.md
index 0569e56..d186e69 100644
--- a/apps/server/AGENTS.md
+++ b/apps/server/AGENTS.md
@@ -19,7 +19,9 @@ Conventions:
 - Routes for one player's own data name the user in the path (`/api/users/{userId}/…`) and answer 403 when it isn't the logged-in user, as the progress routes do, so a page that still shows an earlier login can't read or write another account's data.
 - A table that holds a user's data references `users(id) ON DELETE CASCADE`, so deleting the account deletes it (PRD NFR-6). Published puzzles are the exception: their `creator_id` is set to null instead.
 - An unpublished puzzle is 404 to players wherever it would show up (a route, a list, a hint); only admins can open it.
-- `PuzzleManager.get` hides a daily puzzle before its release time, so reach puzzles players may see through it. Ranked attempts and leaderboards read the `attempts` table, not saved progress.
+- `PuzzleManager.get` hides a daily puzzle before its release time, so reach puzzles players may see through it.
+- A stored puzzle's level is its `level` column: the generator's result decides it for generated puzzles, and submitted ones are hard. The puzzle repository puts it back in `meta.level` when it loads a row, so hints use it; never take a level from a puzzle a client sent.
+- Workers claim jobs by `priority` (`JOB_PRIORITY` in the domain module: verifications, then daily puzzles, then players' generations), and the worker runs verifications in a lane of their own. On SIGTERM it drains for `WORKER_DRAIN_MS`, then gives the running job back to the queue. Ranked attempts and leaderboards read the `attempts` table, not saved progress.
 - In a schema, write "this registered schema or null" as `z.union([Schema, z.null()])`. `.nullable()` on a schema registered with `.openapi("Name")` makes the shared component itself nullable.
 - Count for monitoring through the `ApiMetrics` and `WorkerMetrics` ports (optional deps, so tests can leave them out). Label metrics by route template or a small fixed set of values, not by ids or raw paths.
 - Log with `console.*`: the composition roots turn every call into a JSON line with the request id and mask emails, tokens and secrets. Still keep emails, tokens and message bodies out of log calls.
```

`bun run check`; commit: `docs: WT21 difficulty levels, worker fairness and shutdown (DECISIONS, PRD, README, TESTING, server AGENTS)`

## Final checks

- `bun run check` green after each of the 4 commits; `git status` clean; nothing pushed.
- `git diff a9283dc --stat -- packages/core` is empty (no core change).
- `grep -rn "level: 1\b\|level=1" apps docs README.md | grep -v "node_modules\|docs/plans\|docs/DECISIONS"` finds nothing.
- No `docker compose` services and no background `bun`/`vite`/worker processes left running.

## Acceptance criteria

1. **FR-7:** `POST /api/jobs/generate` accepts `level` ∈ {easy, medium, hard} (default hard; anything else 400); the job input carries it; `runTask` generates at it (`app.test`, `job-manager.test`, `run-task.test`).
2. **FR-7 / WT20 handoff:** the stored level is the generator's (`puzzleLevel(result.puzzle)`), so a tiny board's fallback is stored at the harder level; a submitted puzzle is hard and stored clues-only whatever its `meta` says (`puzzle-manager.test`).
3. **Migration / FR-29:** rows stored before levels (`level = 1`) read back `'hard'` in `puzzles` and `attempts`; the column rejects other names (`migrations.test`).
4. **FR-12:** a puzzle stored at easy loads with `meta.level: "easy"` from the database and its hints use no group rule, parity or lookahead all the way to solved (`hint-manager.test` on SQLite); hard rows load without `meta.level`; the column wins over a stored `meta` (`puzzle-repository.test`).
5. **FR-22 / FR-23:** each daily size class has one level from `DAILY_CLASSES` (all hard), passed into its job; `GET /api/daily` entries carry `level`; attempts, bests and boards carry `Level`; `GET /api/leaderboards/areas/{area}?level=hard` (default hard) (`daily-stock-manager.test`, `daily-manager.test`, `daily.test`, `leaderboard-manager.test`, `attempt-repository.test`).
6. **FR-29 / UI:** Home covers of generated puzzles and dailies show a level tag; Play, ranked start and Solved show "… · Hard"; built-in and player-made puzzles show none; Home's Practice section makes a puzzle at a chosen size and level and opens it (`generate.e2e.ts`, `daily.e2e.ts`, `source.test`, `generate.test`); a11y passes on Home in both themes.
7. **FR-11 fairness:** queued jobs are claimed verify → daily → player, oldest first in each, in one atomic statement (`job-queue.test`, claim race test unchanged); a verification runs in its own lane while the main loop is busy (`loop.test`, `job-run-manager.test`); jobs queued before the change get priorities from their kind (`migrations.test`).
8. **Cap / NFR-6:** a requester (`user:<id>` or `ip:<addr>`) with `MAX_PENDING_GENERATIONS` (3) generations queued or running gets 429 with an explanation; others are unaffected; the requester is cleared when the job ends (`app.test`, `job-manager.test`, `job-queue.test`).
9. **Shutdown:** after SIGTERM/SIGINT nothing more is claimed; the running job gets `WORKER_DRAIN_MS` (60 s), then its thread is stopped and the job is queued again without counting the attempt; Compose `stop_grace_period: 90s` (`loop.test`, `thread-task-runner.test`, `job-run-manager.test`, `job-queue.test`; manual check in Validated).
10. **Docs:** PRD §4/FR-11/FR-22/FR-29/§14 Q1, DECISIONS ×4, README, TESTING, server AGENTS updated; `gen:api` clean (`check:api`).

## Assumptions and open questions (resolved by assumption; the orchestrator may override)

1. **Text level columns** (drop + re-add with default `'hard'`) instead of an integer mapping where 1 = hard. The only integer that leaked was `?level=1` on the bucket board; the API now takes names. Alternative: keep integers with `hard = 1` and a mapping in the adapters — smaller migration, odd numbering.
2. **One level per daily size class, a constant, all hard** (`DAILY_CLASSES`). The daily seed does not include the level; changing a class's level later changes that class's puzzles from then on, and the puzzle row records which level it was. Multiple levels per size would need `dailies (day, size, level)` and is left for PRD §14 Q1.
3. **Verification lane** goes beyond the brief's "claim verify jobs first": claim order can't help a verify that arrives while a 100×100 is already running, which is the WT15 editor-90-s case. The lane costs one extra cheap claim query per poll and a second thread only while a verification runs. Drop it (keep only the priority) if one job at a time per worker is a hard rule; then the 90 s gap stays documented.
4. **Cap = 3 per requester**, counting queued + running, keyed by user id when logged in, else by the rate limits' address key (IPv4, IPv6 /64). The 100-job global cap stays. A logged-out player behind a shared NAT shares a cap. No cap on verifications (submissions already have 20/hour/account).
5. **Drain 60 s, grace 90 s;** a job still running is released, not waited for (a full drain could hold a deploy for 30 minutes). Released claims don't count toward `maxAttempts`. No metric for releases (warning log line).
6. **Levels shown only for generated puzzles.** Submitted puzzles are hard on the server (hints use every rule) but get no tag in the UI. Built-in fixtures get none.
7. **"Medium" (10×10 size name) renamed "Regular"** to avoid "Medium · 10×10 · Hard". Alternative: keep the artboard's name and accept the clash.
8. **New generate UI** (there was none): sizes 5/7/10/15 as on the Home artboard (no "Custom" — the editor covers any size), levels Easy/Medium/Hard, default Hard (= server default), waits for the job however long it takes (the queue can be minutes behind a 100×100 now that players' jobs come last), stops polling when Home is left.
9. `.env.example` / `.env.production.example` are not updated (not readable here); the two new settings have safe defaults and are in README and `config.ts`.
