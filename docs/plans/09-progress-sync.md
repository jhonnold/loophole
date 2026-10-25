# Plan 09: progress sync (WT9 `progress-sync`)

Saved progress for logged-in players, synced across devices, plus an explicit way to bring a guest's progress into an account (PRD FR-21, user story "leave a puzzle and resume it on another device"; NFR-4, NFR-6).

Branch `feat/progress-sync`, worktree `/home/jhonnold/projects/loophole-wt/progress-sync`, based on main `452f304` (WT8 hints merged). Every edit below was made and tested in a prototype on exactly that commit, and revised after plan review 1 (see "Review responses" at the end). After the revision, `bun run check`, `bun run test:e2e` (57 passed), `bun run test:e2e:auth` (3 passed, three runs in a row) and `bun run test:perf` (2 passed) were all green. Applying this plan step by step to a clean `452f304` reproduces the prototype exactly. The find texts match `452f304` exactly. If one doesn't match, main has moved: stop and read the file rather than guessing.

## How to work through this plan

- Run every shell command from the worktree root, after `export PATH="$HOME/.bun/bin:$PATH"`.
- Do the steps in order. Each ends with a verification command; don't go on until it passes.
- "Create" means write the file with exactly the content shown. "Edit" means replace each find text (it occurs once in the file) with its replacement, or append where it says so. Copy the code blocks exactly: Biome checks formatting.
- Run `bun run format` before each commit, then `bun run check`. Commit with the message given, one commit per step that names one.
- Don't edit `openapi.yaml` or `packages/api-client/src/schema.ts` by hand: `bun run gen:api` writes them.
- Shell reads of `.env*` files are denied; use the Read tool if you need one. Nothing here needs `.env`.
- Docker Compose (Garage, Mailpit) is only needed for `bun run test:e2e:auth`. Start it with `docker compose up -d && ./scripts/garage-init.sh`, and when done stop it with `docker compose down` (never `-v`).

## Design in brief

**Server** (layering: entrypoints translate and validate, managers hold the rules, adapters do I/O):

- Migration `004_progress.sql` creates `progress`, one row per (user, puzzle): `edges` (edge-state string), `elapsed_ms`, `solved`, `assisted`, `version`, `device`, `created_at`, `updated_at`. It references `users(id)` and `puzzles(id)` with `ON DELETE CASCADE`, so deleting an account deletes its progress (NFR-6). Migration 003 was reserved for hints but WT8 shipped without one, so the numbers go 1, 2, 4.
- Adapter: `SqliteProgressRepository` behind a new `ProgressRepository` port.
- Manager: `ProgressManager` (`get`, `save`, `delete`, `listInProgress`). It checks the puzzle is published (`PuzzleNotFoundError` → 404), decodes the board against the puzzle (`InvalidBoardError` → 400; that error moves from `hint-manager.ts` to `errors.ts`), works out `solved` itself with `analyzeBoard`, and applies the conflict rule.
- Entrypoint: `api/progress.ts` registers four routes under `/api/users/{userId}/progress[/{puzzleId}]` (list, GET, PUT, DELETE). Each needs a session (401), refuses a `userId` that isn't the logged-in user (403: the same-account check), and counts toward 120 requests per minute per user (429). PUT and DELETE also go through the existing CSRF middleware (403), the JSON-only body rule (415) and the 64 KiB body cap (413).

**Conflict rule** (DECISIONS, "Progress conflicts"). A PUT carries `baseVersion` (the version it continued from, or null) and `device` (a random per-browser id). The server decides in this order:

1. With no stored record, the save becomes version 1.
2. A solved stored record is kept; only DELETE ("Start over") removes it.
3. The stored board sent again (a tab hidden or left without a move) is accepted without a new version. It keeps the stored device and takes the larger play time, so a glance at another device never makes the playing device stale.
4. A different board replaces the record (version + 1) when it is solved, when `baseVersion` equals the stored version, or when the same device made the stored record.
5. Otherwise the stored record is kept and returned with `accepted: false`, and the client shows it.

`assisted` only ever turns on.

**Web**:

- New module `apps/web/src/lib/sync/`, plain TypeScript with bun tests:
  - `sync.ts`: one account's sync engine, `createProgressSync`;
  - `guest.ts`: listing and importing guest saves;
  - `saves.ts`: the per-screen handle, `openSaves`;
  - `index.ts`: app wiring.
- Storage:
  - Guests and built-in puzzles keep using the guest store exactly as before.
  - A logged-in player's server puzzles write to `localStorage` under `loophole:user:<id>:…` at once and PUT 2 s after the last change. A first save of an empty board is skipped: opening a puzzle isn't progress.
  - Only one request per puzzle runs at a time, so one page's saves can't cross.
  - On tab hide and page hide, pending saves go out at once with `keepalive: true`. A puzzle whose request is still out is skipped; that request sends the newer board when it finishes.
  - Failed saves are retried (5 s, 15 s, then every 60 s, on `online`, and on next app start).
- Opening and resuming:
  - Every request a screen waits on (open, refresh, import) gives up after 4 s and falls back to the device copy.
  - When a tab comes back into sight, it refreshes from the server while paused, ignoring answers older than a save made meanwhile.
- PlayScreen changes stay small:
  - it opens a saves handle;
  - it adopts boards the sync hands it;
  - it shows "Saved to your account." and "Picked up your progress from another device."
- Home page:
  - the device statuses come from the right store;
  - logged-in players get a "Continue" list from the server;
  - the guest-import offer appears after login.
- Account page: the same offer without "Not now". Logging out removes this browser's synced account copy, keeping unsent saves. Deleting the account removes all of it.
- Guest → account import happens only from the "Add to my account" button, which names the account's email. Each guest save with marks is sent as a PUT from a fresh random device with `baseVersion: null`, so the account keeps a board it already has unless the guest's is solved. The result message counts added and kept boards separately. Imported saves leave guest storage. It is idempotent.

**WT11 compatibility**: ranked attempts should get their own table with server timing; `progress` stays the resume board, and leaderboards never read its client-reported time, `solved` or `assisted` (DECISIONS, "How ranked play builds on progress").

## Files

New files:

- server:
  - `apps/server/src/adapters/db/migrations/004_progress.sql`
  - `apps/server/src/adapters/db/progress-repository.ts` and `.test.ts`
  - `apps/server/src/managers/progress-manager.ts` and `.test.ts`
  - `apps/server/src/api/progress-schemas.ts`
  - `apps/server/src/api/progress.ts` and `.test.ts`
  - `apps/server/src/test-support/progress.ts`
- web:
  - `apps/web/src/lib/sync/{sync,guest,saves}.ts` with their tests, and `index.ts`
  - `apps/web/src/lib/components/GuestImport.svelte`
  - `apps/web/tests/progress.auth-e2e.ts`

Edited files:

- server:
  - `domain.ts`, `ports.ts`, `managers/errors.ts`, `managers/hint-manager.ts` (and its test)
  - `api/schemas.ts`, `api/app.ts`, `api/main.ts`, `api/spec.ts`
  - `test-support/fakes.ts`
  - tests: `api/app.test.ts`, `api/accounts.test.ts`, `worker/flow.test.ts`, `adapters/db/database.test.ts`
- web:
  - `game/progress.ts`, `puzzles/fixtures.ts`, `test-support/memory-storage.ts`
  - `components/PlayScreen.svelte`, `routes/+page.svelte`, `routes/account/+page.svelte`
  - `playwright.auth.config.ts`
- docs: `README.md`, `docs/DECISIONS.md`, `docs/TESTING.md`, `apps/server/AGENTS.md`, `apps/web/AGENTS.md`
- generated (by `bun run gen:api`): `openapi.yaml`, `packages/api-client/src/schema.ts`

## Steps


### Step 0. Start from a green tree

```sh
cd /home/jhonnold/projects/loophole-wt/progress-sync
export PATH="$HOME/.bun/bin:$PATH"
git status --short            # must be empty (the committed plan is fine)
git merge main                # brings in anything merged since 452f304; resolve before going on
git log --oneline -1 main
bun install
bun run check
```

Verify: `bun run check` ends with `0 fail`. If `git merge main` brought in WT10 `submissions`, read "Merge notes" at the end before Step 1: migration numbers, `createApp` call sites and the generated client are the places that overlap.

### Step 1. Progress table and repository

1.1 Create `apps/server/src/adapters/db/migrations/004_progress.sql` with exactly this content:

````sql
-- Saved progress, one row per player and puzzle (PRD FR-21). Deleting the user or the puzzle
-- deletes it (NFR-6). Times are milliseconds since the epoch.
CREATE TABLE progress (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  puzzle_id TEXT NOT NULL REFERENCES puzzles (id) ON DELETE CASCADE,
  -- Edge states in the wire format's encoding (docs/FORMAT.md): one 0, 1 or 2 per edge.
  edges TEXT NOT NULL CHECK (length(edges) > 0 AND edges NOT GLOB '*[^012]*'),
  elapsed_ms INTEGER NOT NULL CHECK (elapsed_ms >= 0),
  solved INTEGER NOT NULL CHECK (solved IN (0, 1)),
  assisted INTEGER NOT NULL CHECK (assisted IN (0, 1)),
  -- Goes up by one with every save that replaces the board; a save names the version it continued.
  version INTEGER NOT NULL CHECK (version >= 1),
  -- Random id of the browser that made that save; not linked to anything else.
  device TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, puzzle_id)
) STRICT;

CREATE INDEX progress_by_user_updated ON progress (user_id, updated_at);
````


1.2 Edit `apps/server/src/domain.ts` (each find text occurs once):

1. Append to the end of the file, after one blank line:

````ts
/** A player's saved board on one puzzle (PRD FR-21). */
export interface ProgressRecord {
  readonly userId: string;
  readonly puzzleId: string;
  /** Edge states in the wire format's encoding, one character per edge. */
  readonly edges: string;
  /** Play time on this attempt, as the player's clock counted it. */
  readonly elapsedMs: number;
  /** Worked out on the server from `edges`, never taken from the client. */
  readonly solved: boolean;
  /** A hint was shown during this attempt, on any device (PRD FR-12). */
  readonly assisted: boolean;
  /** Starts at 1 and goes up with every save that replaces the board. */
  readonly version: number;
  /** Random id of the browser that saved this board, so it never conflicts with itself. */
  readonly device: string;
  /** When this attempt was first saved. */
  readonly createdAt: number;
  readonly updatedAt: number;
}
````


1.3 Edit `apps/server/src/ports.ts` (each find text occurs once):

1. Find:

````ts
  JobInput,
  JobResult,
  PuzzleRecord,
  SessionRecord,
````

   Replace with:

````ts
  JobInput,
  JobResult,
  ProgressRecord,
  PuzzleRecord,
  SessionRecord,
````

2. Find:

````ts
  hit(key: string, rule: RateRule): RateDecision;
}
````

   Replace with:

````ts
  hit(key: string, rule: RateRule): RateDecision;
}

/** Saved progress, one record per user and puzzle (PRD FR-21). */
export interface ProgressRepository {
  get(userId: string, puzzleId: string): ProgressRecord | null;
  /** Stores `record`, replacing any record for the same user and puzzle. */
  put(record: ProgressRecord): void;
  delete(userId: string, puzzleId: string): void;
  /** The user's unsolved records, most recently updated first. */
  listUnsolved(userId: string, limit: number): ProgressRecord[];
}
````


1.4 Create `apps/server/src/adapters/db/progress-repository.ts` with exactly this content:

````ts
import type { Database } from "bun:sqlite";
import type { ProgressRecord } from "../../domain.ts";
import type { ProgressRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type ProgressRow = {
  user_id: string;
  puzzle_id: string;
  edges: string;
  elapsed_ms: number;
  solved: number;
  assisted: number;
  version: number;
  device: string;
  created_at: number;
  updated_at: number;
};

const COLUMNS =
  "user_id, puzzle_id, edges, elapsed_ms, solved, assisted, version, device, created_at, updated_at";

/** Saved progress in SQLite, keyed by user and puzzle. */
export class SqliteProgressRepository implements ProgressRepository {
  readonly #get;
  readonly #put;
  readonly #delete;
  readonly #listUnsolved;

  constructor(db: Database) {
    this.#get = db.query<ProgressRow, { userId: string; puzzleId: string }>(
      `SELECT ${COLUMNS} FROM progress WHERE user_id = $userId AND puzzle_id = $puzzleId`,
    );
    this.#put = db.query<void, ProgressRow>(
      `INSERT OR REPLACE INTO progress (${COLUMNS}) VALUES ($user_id, $puzzle_id, $edges, $elapsed_ms, $solved, $assisted, $version, $device, $created_at, $updated_at)`,
    );
    this.#delete = db.query<void, { userId: string; puzzleId: string }>(
      "DELETE FROM progress WHERE user_id = $userId AND puzzle_id = $puzzleId",
    );
    this.#listUnsolved = db.query<ProgressRow, { userId: string; limit: number }>(
      `SELECT ${COLUMNS} FROM progress WHERE user_id = $userId AND solved = 0 ORDER BY updated_at DESC, puzzle_id LIMIT $limit`,
    );
  }

  get(userId: string, puzzleId: string): ProgressRecord | null {
    const row = this.#get.get({ userId, puzzleId });
    return row === null ? null : fromRow(row);
  }

  put(record: ProgressRecord): void {
    this.#put.run({
      user_id: record.userId,
      puzzle_id: record.puzzleId,
      edges: record.edges,
      elapsed_ms: record.elapsedMs,
      solved: record.solved ? 1 : 0,
      assisted: record.assisted ? 1 : 0,
      version: record.version,
      device: record.device,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
  }

  delete(userId: string, puzzleId: string): void {
    this.#delete.run({ userId, puzzleId });
  }

  listUnsolved(userId: string, limit: number): ProgressRecord[] {
    return this.#listUnsolved.all({ userId, limit }).map(fromRow);
  }
}

function fromRow(row: ProgressRow): ProgressRecord {
  return {
    userId: row.user_id,
    puzzleId: row.puzzle_id,
    edges: row.edges,
    elapsedMs: row.elapsed_ms,
    solved: row.solved === 1,
    assisted: row.assisted === 1,
    version: row.version,
    device: row.device,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
````


1.5 Create `apps/server/src/adapters/db/progress-repository.test.ts` with exactly this content:

````ts
import { describe, expect, test } from "bun:test";
import { createPuzzle } from "@loophole/core";
import type { ProgressRecord } from "../../domain.ts";
import { openDatabase } from "./database.ts";
import { SqliteProgressRepository } from "./progress-repository.ts";
import { SqlitePuzzleRepository } from "./puzzle-repository.ts";
import { SqliteUserRepository } from "./user-repository.ts";

function setup() {
  const db = openDatabase(":memory:");
  const users = new SqliteUserRepository(db);
  for (const id of ["u1", "u2"]) {
    users.insert({
      id,
      email: `${id}@example.com`,
      passwordHash: "h",
      emailVerifiedAt: null,
      isAdmin: false,
      createdAt: 0,
    });
  }
  const puzzles = new SqlitePuzzleRepository(db);
  for (const id of ["p1", "p2", "p3"]) {
    puzzles.insert({
      id,
      puzzle: createPuzzle(2, 2),
      origin: "generated",
      status: "published",
      level: 1,
      solutionKey: `puzzles/${id}/solution.txt`,
      traceKey: null,
      createdAt: 0,
    });
  }
  return { db, users, repo: new SqliteProgressRepository(db) };
}

function record(changes: Partial<ProgressRecord> = {}): ProgressRecord {
  return {
    userId: "u1",
    puzzleId: "p1",
    edges: "100000000000",
    elapsedMs: 4200,
    solved: false,
    assisted: true,
    version: 1,
    device: "d1",
    createdAt: 10,
    updatedAt: 20,
    ...changes,
  };
}

describe("SqliteProgressRepository", () => {
  test("get returns what put stored; put replaces; delete removes", () => {
    const { repo } = setup();
    expect(repo.get("u1", "p1")).toBeNull();
    repo.put(record());
    expect(repo.get("u1", "p1")).toEqual(record());
    repo.put(record({ edges: "112211121121", solved: true, updatedAt: 30 }));
    expect(repo.get("u1", "p1")).toEqual(
      record({ edges: "112211121121", solved: true, updatedAt: 30 }),
    );
    expect(repo.get("u2", "p1")).toBeNull();
    repo.delete("u1", "p1");
    expect(repo.get("u1", "p1")).toBeNull();
  });

  test("listUnsolved gives one user's unsolved records, newest first, up to the limit", () => {
    const { repo } = setup();
    repo.put(record({ puzzleId: "p1", updatedAt: 10 }));
    repo.put(record({ puzzleId: "p2", updatedAt: 30 }));
    repo.put(record({ puzzleId: "p3", updatedAt: 20, solved: true }));
    repo.put(record({ userId: "u2", puzzleId: "p1", updatedAt: 40 }));
    expect(repo.listUnsolved("u1", 10).map((r) => r.puzzleId)).toEqual(["p2", "p1"]);
    expect(repo.listUnsolved("u1", 1).map((r) => r.puzzleId)).toEqual(["p2"]);
  });

  test("deleting the user deletes their progress (NFR-6)", () => {
    const { db, users, repo } = setup();
    repo.put(record());
    repo.put(record({ userId: "u2" }));
    users.delete("u1");
    expect(repo.get("u1", "p1")).toBeNull();
    expect(repo.get("u2", "p1")).not.toBeNull();
    expect(db.query("SELECT count(*) AS n FROM progress").get()).toEqual({ n: 1 });
  });

  test("a record must name an existing user and puzzle and hold only 0, 1 and 2", () => {
    const { repo } = setup();
    expect(() => repo.put(record({ userId: "ghost" }))).toThrow(/FOREIGN KEY/);
    expect(() => repo.put(record({ puzzleId: "ghost" }))).toThrow(/FOREIGN KEY/);
    expect(() => repo.put(record({ edges: "10000000000x" }))).toThrow(/CHECK/);
  });
});
````


1.6 The migration test lists every table and migration. Edit `apps/server/src/adapters/db/database.test.ts` (each find text occurs once):

1. Find:

````ts
      "account_tokens",
      "jobs",
      "puzzles",
      "schema_migrations",
````

   Replace with:

````ts
      "account_tokens",
      "jobs",
      "progress",
      "puzzles",
      "schema_migrations",
````

2. Find:

````ts
      .query<{ version: number }, []>("SELECT version FROM schema_migrations")
      .all();
    expect(versions).toEqual([{ version: 1 }, { version: 2 }]);
  });
````

   Replace with:

````ts
      .query<{ version: number }, []>("SELECT version FROM schema_migrations")
      .all();
    // 003 was set aside for hints, which needed no table.
    expect(versions).toEqual([{ version: 1 }, { version: 2 }, { version: 4 }]);
  });
````


Verify:

```sh
bun test apps/server/src/adapters/db && bun run --cwd apps/server typecheck && bun run lint
```

Expect `0 fail`. Commit: `feat(server): add the progress table and its repository`

### Step 2. ProgressManager and the conflict rule

2.1 Add the two shared errors. `InvalidBoardError` is still also defined in `hint-manager.ts` until Step 3; that is fine for now. Edit `apps/server/src/managers/errors.ts` (each find text occurs once):

1. Append to the end of the file, after one blank line:

````ts
/** A board does not fit its puzzle (wrong length or a bad character). */
export class InvalidBoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBoardError";
  }
}

/** There is no published puzzle with this id. */
export class PuzzleNotFoundError extends Error {
  constructor(id: string) {
    super(`No published puzzle with id ${id}.`);
    this.name = "PuzzleNotFoundError";
  }
}
````


2.2 Create `apps/server/src/managers/progress-manager.ts` with exactly this content:

````ts
import { analyzeBoard, decodeEdges, FormatError } from "@loophole/core";
import type { ProgressRecord, PuzzleRecord } from "../domain.ts";
import type { Clock, ProgressRepository } from "../ports.ts";
import { InvalidBoardError, PuzzleNotFoundError } from "./errors.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";

export interface ProgressManagerDeps {
  readonly progress: ProgressRepository;
  readonly puzzles: PuzzleManager;
  readonly clock: Clock;
}

/** What a client sends to save its board. Whether it is solved is worked out here. */
export interface ProgressInput {
  /** Edge states in the wire format's encoding. */
  readonly edges: string;
  readonly elapsedMs: number;
  readonly assisted: boolean;
  /** The version of the record this board continues from, or null if the client had none. */
  readonly baseVersion: number | null;
  /** Random id of the client's browser. */
  readonly device: string;
}

export interface SaveOutcome {
  /** The record stored after the save. */
  readonly record: ProgressRecord;
  /** False when the stored record was kept: it is solved, or the save was stale. */
  readonly accepted: boolean;
}

/** An unsolved record with its puzzle's size, for a "continue" list. */
export interface ProgressSummary {
  readonly record: ProgressRecord;
  readonly width: number;
  readonly height: number;
}

/**
 * Saved progress per player and puzzle, synced across devices (PRD FR-21). Two devices can save
 * different boards for one puzzle; `save` settles it the same way every time (DECISIONS,
 * "Progress conflicts"): a solved record stays until it is deleted; a save of the board already
 * stored only updates the play time; a solved board replaces an unsolved one; otherwise a save
 * replaces the record only if it continues from the stored version or comes from the device that
 * saved it, so a stale tab can't overwrite newer play from another device. `assisted` only ever
 * turns on.
 */
export class ProgressManager {
  readonly #deps: ProgressManagerDeps;

  constructor(deps: ProgressManagerDeps) {
    this.#deps = deps;
  }

  /** The user's record for a published puzzle, or null. Throws `PuzzleNotFoundError`. */
  get(userId: string, puzzleId: string): ProgressRecord | null {
    this.#puzzle(puzzleId);
    return this.#deps.progress.get(userId, puzzleId);
  }

  /**
   * Saves a board unless the stored record wins over it (see the class comment). Throws
   * `PuzzleNotFoundError`, or `InvalidBoardError` when `edges` does not fit the puzzle.
   */
  save(userId: string, puzzleId: string, input: ProgressInput): SaveOutcome {
    const { progress, clock } = this.#deps;
    const puzzle = this.#puzzle(puzzleId);
    let board: Uint8Array;
    try {
      board = decodeEdges(puzzle.puzzle.grid, input.edges);
    } catch (err) {
      if (err instanceof FormatError) throw new InvalidBoardError(err.message);
      throw err;
    }
    const solved = analyzeBoard(puzzle.puzzle, board).solved;
    const now = clock.now();
    const stored = progress.get(userId, puzzleId);
    if (stored === null) {
      const record: ProgressRecord = {
        userId,
        puzzleId,
        edges: input.edges,
        elapsedMs: input.elapsedMs,
        solved,
        assisted: input.assisted,
        version: 1,
        device: input.device,
        createdAt: now,
        updatedAt: now,
      };
      progress.put(record);
      return { record, accepted: true };
    }
    const assisted = stored.assisted || input.assisted;
    if (!stored.solved && input.edges === stored.edges) {
      // The same board (a tab hidden or left without a move): keep its version and device, so
      // the device that is playing doesn't find its next save stale. Play time never goes back.
      const record: ProgressRecord = {
        ...stored,
        elapsedMs: Math.max(stored.elapsedMs, input.elapsedMs),
        assisted,
        updatedAt: now,
      };
      progress.put(record);
      return { record, accepted: true };
    }
    const current = input.baseVersion === stored.version || input.device === stored.device;
    const accepted = !stored.solved && (solved || current);
    if (!accepted) {
      if (assisted === stored.assisted) return { record: stored, accepted: false };
      // Same version: the device whose board this is can carry on saving over it.
      const record = { ...stored, assisted, updatedAt: now };
      progress.put(record);
      return { record, accepted: false };
    }
    const record: ProgressRecord = {
      ...stored,
      edges: input.edges,
      elapsedMs: input.elapsedMs,
      solved,
      assisted,
      version: stored.version + 1,
      device: input.device,
      updatedAt: now,
    };
    progress.put(record);
    return { record, accepted: true };
  }

  /** Forgets the user's record for a puzzle ("Start over"). Unknown ids are ignored. */
  delete(userId: string, puzzleId: string): void {
    this.#deps.progress.delete(userId, puzzleId);
  }

  /** The user's unsolved records on published puzzles, most recently saved first. */
  listInProgress(userId: string, limit: number): ProgressSummary[] {
    const { progress, puzzles } = this.#deps;
    const summaries: ProgressSummary[] = [];
    for (const record of progress.listUnsolved(userId, limit)) {
      const puzzle = puzzles.get(record.puzzleId);
      if (puzzle === null) continue;
      const { width, height } = puzzle.puzzle.grid;
      summaries.push({ record, width, height });
    }
    return summaries;
  }

  #puzzle(id: string): PuzzleRecord {
    const puzzle = this.#deps.puzzles.get(id);
    if (puzzle === null) throw new PuzzleNotFoundError(id);
    return puzzle;
  }
}
````


2.3 A fake repository for manager tests. Edit `apps/server/src/test-support/fakes.ts` (each find text occurs once):

1. Find:

````ts
  AccountTokenRecord,
  Job,
  PuzzleRecord,
  SessionRecord,
````

   Replace with:

````ts
  AccountTokenRecord,
  Job,
  ProgressRecord,
  PuzzleRecord,
  SessionRecord,
````

2. Find:

````ts
  NewJob,
  PasswordHasher,
  PuzzleRepository,
  SessionRepository,
````

   Replace with:

````ts
  NewJob,
  PasswordHasher,
  ProgressRepository,
  PuzzleRepository,
  SessionRepository,
````

3. Append to the end of the file, after one blank line:

````ts
export class FakeProgressRepository implements ProgressRepository {
  readonly records = new Map<string, ProgressRecord>();

  get(userId: string, puzzleId: string): ProgressRecord | null {
    return this.records.get(`${userId}/${puzzleId}`) ?? null;
  }

  put(record: ProgressRecord): void {
    this.records.set(`${record.userId}/${record.puzzleId}`, record);
  }

  delete(userId: string, puzzleId: string): void {
    this.records.delete(`${userId}/${puzzleId}`);
  }

  listUnsolved(userId: string, limit: number): ProgressRecord[] {
    return [...this.records.values()]
      .filter((r) => r.userId === userId && !r.solved)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }
}
````


2.4 Create `apps/server/src/managers/progress-manager.test.ts` with exactly this content:

````ts
import { describe, expect, test } from "bun:test";
import { createPuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { FakeClock, FakeProgressRepository, FakePuzzleRepository } from "../test-support/fakes.ts";
import { InvalidBoardError, PuzzleNotFoundError } from "./errors.ts";
import { ProgressManager } from "./progress-manager.ts";
import { PuzzleManager } from "./puzzle-manager.ts";

// 2×2 all 2s; its only loop runs around the outside.
const SOLVED = "112211121121";
const EMPTY = "000000000000";
const ONE_LINE = "100000000000";
const OTHER_LINE = "010000000000";

function setup() {
  const clock = new FakeClock(1000);
  const repo = new FakePuzzleRepository();
  for (const [id, status] of [
    ["p1", "published"],
    ["p2", "published"],
    ["hidden", "unpublished"],
  ] as const) {
    repo.insert({
      id,
      puzzle: createPuzzle(2, 2, [2, 2, 2, 2]),
      origin: "generated",
      status,
      level: 1,
      solutionKey: `puzzles/${id}/solution.txt`,
      traceKey: null,
      createdAt: 0,
    });
  }
  const progress = new FakeProgressRepository();
  const puzzles = new PuzzleManager({ puzzles: repo, blobs: new MemoryBlobStore(), clock });
  const manager = new ProgressManager({ progress, puzzles, clock });
  return { clock, progress, manager };
}

/** A save from device `device` continuing from `baseVersion`. */
const input = (
  edges: string,
  baseVersion: number | null,
  device = "a",
  options: { elapsedMs?: number; assisted?: boolean } = {},
) => ({
  edges,
  elapsedMs: options.elapsedMs ?? 1000,
  assisted: options.assisted ?? false,
  baseVersion,
  device,
});

describe("ProgressManager", () => {
  test("stores a first save as version 1 and works out whether it is solved", () => {
    const { manager } = setup();
    expect(manager.get("u1", "p1")).toBeNull();
    const first = manager.save("u1", "p1", input(ONE_LINE, null, "a", { assisted: true }));
    expect(first).toEqual({
      accepted: true,
      record: {
        userId: "u1",
        puzzleId: "p1",
        edges: ONE_LINE,
        elapsedMs: 1000,
        solved: false,
        assisted: true,
        version: 1,
        device: "a",
        createdAt: 1000,
        updatedAt: 1000,
      },
    });
    expect(manager.get("u1", "p1")).toEqual(first.record);
    expect(manager.save("u1", "p2", input(SOLVED, null)).record.solved).toBe(true);
    expect(manager.get("u2", "p1")).toBeNull();
  });

  test("a save that continues from the stored version replaces it", () => {
    const { manager, clock } = setup();
    manager.save("u1", "p1", input(ONE_LINE, null, "a"));
    clock.advance(500);
    const next = manager.save("u1", "p1", input(EMPTY, 1, "b", { elapsedMs: 10 }));
    expect(next.accepted).toBe(true);
    expect(next.record).toMatchObject({
      edges: EMPTY,
      elapsedMs: 10,
      version: 2,
      device: "b",
      createdAt: 1000,
      updatedAt: 1500,
    });
  });

  test("a stale save from another device is refused and gets the stored record", () => {
    const { manager, clock } = setup();
    manager.save("u1", "p1", input(ONE_LINE, null, "a"));
    const stored = manager.save("u1", "p1", input(OTHER_LINE, 1, "b")).record;
    clock.advance(500);
    // Device a still thinks version 1 is current, even with far more time on its clock.
    expect(manager.save("u1", "p1", input(ONE_LINE, 1, "a", { elapsedMs: 99_000 }))).toEqual({
      accepted: false,
      record: stored,
    });
    // A device that never loaded the record doesn't overwrite it either.
    expect(manager.save("u1", "p1", input(ONE_LINE, null, "c")).accepted).toBe(false);
    expect(manager.get("u1", "p1")).toEqual(stored);
  });

  test("a save of the stored board keeps its version and device", () => {
    const { manager, clock } = setup();
    manager.save("u1", "p1", input(ONE_LINE, null, "a", { elapsedMs: 5000 }));
    clock.advance(100);
    // Device b opens the puzzle and is hidden without a move.
    const glance = manager.save("u1", "p1", input(ONE_LINE, 1, "b", { elapsedMs: 4000 }));
    expect(glance).toMatchObject({
      accepted: true,
      record: { version: 1, device: "a", elapsedMs: 5000, updatedAt: 1100 },
    });
    expect(
      manager.save("u1", "p1", input(ONE_LINE, 1, "b", { elapsedMs: 6000 })).record,
    ).toMatchObject({ version: 1, device: "a", elapsedMs: 6000 });
    // So device a, still on version 1, carries on.
    expect(manager.save("u1", "p1", input(OTHER_LINE, 1, "a"))).toMatchObject({
      accepted: true,
      record: { edges: OTHER_LINE, version: 2 },
    });
  });

  test("a device's own save is never refused as stale", () => {
    const { manager } = setup();
    manager.save("u1", "p1", input(ONE_LINE, null, "a"));
    manager.save("u1", "p1", input(OTHER_LINE, 1, "a"));
    // A save whose answer was lost (the page closed) is sent again with the old version. The
    // client sends one save per puzzle at a time, so its saves can't arrive out of order.
    const resent = manager.save("u1", "p1", input(EMPTY, 1, "a"));
    expect(resent).toMatchObject({ accepted: true, record: { edges: EMPTY, version: 3 } });
  });

  test("a cleared board is a real move: a stale device doesn't overwrite it", () => {
    const { manager } = setup();
    manager.save("u1", "p1", input(ONE_LINE, null, "a"));
    manager.save("u1", "p1", input(EMPTY, 1, "a"));
    expect(manager.save("u1", "p1", input(OTHER_LINE, 1, "b")).accepted).toBe(false);
  });

  test("a solved board wins even when stale, and stays until it is deleted", () => {
    const { manager } = setup();
    manager.save("u1", "p1", input(ONE_LINE, null, "a"));
    manager.save("u1", "p1", input(EMPTY, 1, "a"));
    const solved = manager.save("u1", "p1", input(SOLVED, 1, "b"));
    expect(solved).toMatchObject({ accepted: true, record: { solved: true, version: 3 } });
    for (const late of [input(ONE_LINE, 3, "b"), input(SOLVED, 3, "a")]) {
      expect(manager.save("u1", "p1", late)).toEqual({ accepted: false, record: solved.record });
    }
    manager.delete("u1", "p1");
    expect(manager.get("u1", "p1")).toBeNull();
    expect(manager.save("u1", "p1", input(ONE_LINE, 3, "b")).record.version).toBe(1);
  });

  test("assisted only turns on, whichever board wins", () => {
    const { manager, clock } = setup();
    manager.save("u1", "p1", input(ONE_LINE, null, "a", { assisted: true }));
    expect(manager.save("u1", "p1", input(EMPTY, 1, "a")).record.assisted).toBe(true);
    clock.advance(100);
    // A refused save that saw a hint still marks the record, without taking its version.
    manager.save("u1", "p2", input(ONE_LINE, null, "a"));
    const refused = manager.save("u1", "p2", input(EMPTY, null, "b", { assisted: true }));
    expect(refused.accepted).toBe(false);
    expect(refused.record).toMatchObject({
      edges: ONE_LINE,
      assisted: true,
      version: 1,
      device: "a",
      updatedAt: 1100,
    });
  });

  test("a board that does not fit the puzzle is refused", () => {
    const { manager } = setup();
    expect(() => manager.save("u1", "p1", input("000", null))).toThrow(InvalidBoardError);
    expect(() => manager.save("u1", "p1", input("00000000000x", null))).toThrow(InvalidBoardError);
  });

  test("unknown and unpublished puzzles are not found", () => {
    const { manager } = setup();
    for (const id of ["nope", "hidden"]) {
      expect(() => manager.get("u1", id)).toThrow(PuzzleNotFoundError);
      expect(() => manager.save("u1", id, input(EMPTY, null))).toThrow(PuzzleNotFoundError);
    }
  });

  test("lists unsolved records newest first, with the puzzle's size", () => {
    const { manager, clock, progress } = setup();
    manager.save("u1", "p1", input(ONE_LINE, null));
    clock.advance(10);
    manager.save("u1", "p2", input(ONE_LINE, null));
    clock.advance(10);
    manager.save("u2", "p1", input(ONE_LINE, null));
    // A record left on a puzzle that was unpublished later is skipped.
    progress.put({ ...manager.save("u1", "p1", input(EMPTY, 1)).record, puzzleId: "hidden" });
    const list = manager.listInProgress("u1", 10);
    expect(list.map((s) => [s.record.puzzleId, s.width, s.height])).toEqual([
      ["p1", 2, 2],
      ["p2", 2, 2],
    ]);
    manager.save("u1", "p1", input(SOLVED, 2));
    expect(manager.listInProgress("u1", 10).map((s) => s.record.puzzleId)).toEqual(["p2"]);
  });
});
````


Verify:

```sh
bun run format && bun test apps/server/src/managers && bun run --cwd apps/server typecheck && bun run lint
```

Expect `0 fail` and no lint errors (Biome's import rules check the manager imports only `ports.ts`, `domain.ts`, core and other managers). Commit: `feat(server): add ProgressManager with the cross-device conflict rule`

### Step 3. The saved progress API

3.1 The hint manager now uses the shared error. Edit `apps/server/src/managers/hint-manager.ts` (each find text occurs once):

1. Find:

````ts
import { decodeEdges, FormatError, findHint, type Hint } from "@loophole/core";
import type { PuzzleManager } from "./puzzle-manager.ts";

/** The board sent for a hint does not fit the puzzle (wrong length or a bad character). */
export class InvalidBoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBoardError";
  }
}

/**
 * How long a hint request may look for a deduction. Generated puzzles answer in a few ms; a
````

   Replace with:

````ts
import { decodeEdges, FormatError, findHint, type Hint } from "@loophole/core";
import { InvalidBoardError } from "./errors.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";

/**
 * How long a hint request may look for a deduction. Generated puzzles answer in a few ms; a
````


3.2 Edit `apps/server/src/managers/hint-manager.test.ts` (each find text occurs once):

1. Find:

````ts
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { FakeClock, FakePuzzleRepository } from "../test-support/fakes.ts";
import { HintManager, InvalidBoardError } from "./hint-manager.ts";
import { PuzzleManager } from "./puzzle-manager.ts";
````

   Replace with:

````ts
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { FakeClock, FakePuzzleRepository } from "../test-support/fakes.ts";
import { InvalidBoardError } from "./errors.ts";
import { HintManager } from "./hint-manager.ts";
import { PuzzleManager } from "./puzzle-manager.ts";
````


3.3 Share the board schema between hints and progress. The hint route's OpenAPI output doesn't change. Edit `apps/server/src/api/schemas.ts` (each find text occurs once):

1. Find:

````ts
export const HealthSchema = z.object({ status: z.literal("ok") }).openapi("Health");

export const HintRequestSchema = z
  .strictObject({
    edges: z
      .string()
      .regex(/^[012]*$/)
      .max(20_200)
      .openapi({
        description:
          "The player's board: one character per edge, 0 empty, 1 line, 2 cross (docs/FORMAT.md).",
      }),
  })
  .openapi("HintRequest");

const EdgeIndex = z.int().min(0);
````

   Replace with:

````ts
export const HealthSchema = z.object({ status: z.literal("ok") }).openapi("Health");

/** A player's board; its length is checked against the puzzle after validation. */
export const EdgesSchema = z
  .string()
  .regex(/^[012]*$/)
  .max(20_200)
  .openapi({
    description:
      "The player's board: one character per edge, 0 empty, 1 line, 2 cross (docs/FORMAT.md).",
  });

export const HintRequestSchema = z.strictObject({ edges: EdgesSchema }).openapi("HintRequest");

const EdgeIndex = z.int().min(0);
````


3.4 Create `apps/server/src/api/progress-schemas.ts` with exactly this content:

````ts
import { z } from "@hono/zod-openapi";
import { EdgesSchema } from "./schemas.ts";

// Request and response bodies of the saved progress routes (progress.ts).

const Id = z.string().min(1).max(64);

const Timestamp = z.iso.datetime().openapi({ example: "2026-10-25T12:00:00.000Z" });

/** 100 days: far more than anyone plays one attempt, and a safe integer. */
export const MAX_ELAPSED_MS = 100 * 24 * 60 * 60 * 1000;

const ElapsedMs = z
  .int()
  .min(0)
  .max(MAX_ELAPSED_MS)
  .openapi({ description: "Play time on this attempt in milliseconds." });

export const UserProgressParamSchema = z.object({
  userId: Id.openapi({
    param: { name: "userId", in: "path" },
    description: "Must be the logged-in user's id; anything else is refused with 403.",
  }),
});

export const PuzzleProgressParamSchema = UserProgressParamSchema.extend({
  puzzleId: Id.openapi({ param: { name: "puzzleId", in: "path" } }),
});

export const ProgressListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20).openapi({ example: 20 }),
});

export const ProgressSchema = z
  .object({
    puzzleId: Id,
    edges: z.string().openapi({ description: "Edge states (docs/FORMAT.md)." }),
    elapsedMs: ElapsedMs,
    solved: z.boolean(),
    assisted: z.boolean().openapi({ description: "A hint was shown during this attempt." }),
    version: z.int().min(1).openapi({
      description:
        "Goes up with every save that replaces the board; send it back as `baseVersion`.",
    }),
    updatedAt: Timestamp,
  })
  .openapi("Progress", { description: "A saved board on one puzzle (PRD FR-21)." });

export const ProgressResultSchema = z
  .object({ progress: z.union([ProgressSchema, z.null()]) })
  .openapi("ProgressResult", { description: "`progress` is null when nothing is saved." });

export const SaveProgressRequestSchema = z
  .strictObject({
    edges: EdgesSchema,
    elapsedMs: ElapsedMs,
    assisted: z.boolean(),
    baseVersion: z.union([z.int().min(1), z.null()]).openapi({
      description: "The `version` this board continues from, or null when the client had none.",
    }),
    device: z
      .string()
      .min(1)
      .max(64)
      .openapi({ description: "A random id for this browser, the same on every save." }),
  })
  .openapi("SaveProgressRequest");

export const SaveProgressResultSchema = z
  .object({
    progress: ProgressSchema,
    accepted: z.boolean().openapi({
      description:
        "False when the saved record was kept instead: it is solved, or the save was stale. `progress` is then that record.",
    }),
  })
  .openapi("SaveProgressResult");

export const ProgressSummarySchema = z
  .object({
    puzzleId: Id,
    width: z.int(),
    height: z.int(),
    elapsedMs: ElapsedMs,
    assisted: z.boolean(),
    updatedAt: Timestamp,
  })
  .openapi("ProgressSummary");

export const ProgressListSchema = z
  .object({ items: z.array(ProgressSummarySchema) })
  .openapi("ProgressList");
````


3.5 Create `apps/server/src/api/progress.ts` with exactly this content:

````ts
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ProgressRecord, UserRecord } from "../domain.ts";
import type { ProgressManager } from "../managers/progress-manager.ts";
import type { SessionManager } from "../managers/session-manager.ts";
import type { RateLimiter, RateRule } from "../ports.ts";
import { tooManyRequests } from "./accounts.ts";
import { problem, problemResponse } from "./problem.ts";
import {
  ProgressListQuerySchema,
  ProgressListSchema,
  ProgressResultSchema,
  PuzzleProgressParamSchema,
  SaveProgressRequestSchema,
  SaveProgressResultSchema,
  UserProgressParamSchema,
} from "./progress-schemas.ts";
import { currentUser } from "./session-cookie.ts";

export interface ProgressRouteDeps {
  readonly progress: ProgressManager;
  readonly sessions: SessionManager;
  readonly limiter: RateLimiter;
}

/**
 * Progress requests per user. The web app saves at most every couple of seconds per open puzzle;
 * this leaves room for several tabs and for bringing in a guest's saves.
 */
const PROGRESS_LIMIT: RateRule = { limit: 120, windowMs: 60_000 };

const notLoggedIn = problemResponse("Not logged in.");
const otherUser = problemResponse(
  "The path names another user, or the request came from another site (CSRF protection).",
);
const tooMany = problemResponse("Too many requests; `Retry-After` says when to try again.");

const listRoute = createRoute({
  method: "get",
  path: "/api/users/{userId}/progress",
  summary: "The logged-in user's unsolved puzzles, most recently saved first",
  security: [{ session: [] }],
  request: { params: UserProgressParamSchema, query: ProgressListQuerySchema },
  responses: {
    200: {
      description: "Unsolved saved progress.",
      content: { "application/json": { schema: ProgressListSchema } },
    },
    400: problemResponse("Invalid query."),
    401: notLoggedIn,
    403: otherUser,
    429: tooMany,
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/api/users/{userId}/progress/{puzzleId}",
  summary: "The logged-in user's saved board on a puzzle",
  security: [{ session: [] }],
  request: { params: PuzzleProgressParamSchema },
  responses: {
    200: {
      description: "The saved board, or null.",
      content: { "application/json": { schema: ProgressResultSchema } },
    },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    403: otherUser,
    404: problemResponse("No published puzzle with this id."),
    429: tooMany,
  },
});

const putRoute = createRoute({
  method: "put",
  path: "/api/users/{userId}/progress/{puzzleId}",
  summary: "Save the logged-in user's board on a puzzle",
  description:
    "A solved record is kept until it is deleted. Sending the board already stored only updates the play time and keeps the version. A solved board replaces an unsolved one. Otherwise the board is saved only if it continues from the stored `version` (`baseVersion`) or comes from the `device` that saved it, so a stale tab can't overwrite newer play from another device. `assisted` only ever turns on. Whether the board is solved is worked out by the server.",
  security: [{ session: [] }],
  request: {
    params: PuzzleProgressParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: SaveProgressRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "What is saved now, and whether it is the board sent.",
      content: { "application/json": { schema: SaveProgressResultSchema } },
    },
    400: problemResponse("Invalid body, or a board that does not fit the puzzle."),
    401: notLoggedIn,
    403: otherUser,
    404: problemResponse("No published puzzle with this id."),
    413: problemResponse("Request body larger than 64 KiB."),
    415: problemResponse("Request body is not JSON."),
    429: tooMany,
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/api/users/{userId}/progress/{puzzleId}",
  summary: "Forget the logged-in user's board on a puzzle (start over)",
  security: [{ session: [] }],
  request: { params: PuzzleProgressParamSchema },
  responses: {
    204: { description: "Deleted (also when nothing was saved)." },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    403: otherUser,
    429: tooMany,
  },
});

/** Saved progress for logged-in players, synced across devices (PRD FR-21). */
export function registerProgressRoutes(app: OpenAPIHono, deps: ProgressRouteDeps): void {
  const { progress, sessions, limiter } = deps;

  /**
   * The logged-in user when the path names them, or the error response to send. Naming the user
   * in the path means a page that still thinks someone else is logged in (after a login in another
   * tab) gets a 403 instead of reading or writing the new account's progress.
   */
  async function owner(c: Context, userId: string) {
    const user: UserRecord | null = await currentUser(c, sessions);
    if (user === null) return { error: problem(c, 401, "Not logged in") };
    if (user.id !== userId) {
      return {
        error: problem(c, 403, "Logged in as someone else", {
          detail: "This progress belongs to another account. Reload the page.",
        }),
      };
    }
    const decision = limiter.hit(`progress:${user.id}`, PROGRESS_LIMIT);
    if (!decision.allowed) return { error: tooManyRequests(c, decision.retryAfterMs) };
    return { user };
  }

  app.openapi(listRoute, async (c) => {
    const { userId } = c.req.valid("param");
    const { user, error } = await owner(c, userId);
    if (error) return error;
    const items = progress.listInProgress(user.id, c.req.valid("query").limit);
    return c.json(
      {
        items: items.map(({ record, width, height }) => ({
          puzzleId: record.puzzleId,
          width,
          height,
          elapsedMs: record.elapsedMs,
          assisted: record.assisted,
          updatedAt: iso(record.updatedAt),
        })),
      },
      200,
    );
  });

  app.openapi(getRoute, async (c) => {
    const { userId, puzzleId } = c.req.valid("param");
    const { user, error } = await owner(c, userId);
    if (error) return error;
    const record = progress.get(user.id, puzzleId);
    return c.json({ progress: record === null ? null : toProgressDto(record) }, 200);
  });

  app.openapi(putRoute, async (c) => {
    const { userId, puzzleId } = c.req.valid("param");
    const { user, error } = await owner(c, userId);
    if (error) return error;
    const { record, accepted } = progress.save(user.id, puzzleId, c.req.valid("json"));
    return c.json({ progress: toProgressDto(record), accepted }, 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const { userId, puzzleId } = c.req.valid("param");
    const { user, error } = await owner(c, userId);
    if (error) return error;
    progress.delete(user.id, puzzleId);
    return c.body(null, 204);
  });
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function toProgressDto(r: ProgressRecord) {
  return {
    puzzleId: r.puzzleId,
    edges: r.edges,
    elapsedMs: r.elapsedMs,
    solved: r.solved,
    assisted: r.assisted,
    version: r.version,
    updatedAt: iso(r.updatedAt),
  };
}
````


3.6 Wire the routes and errors into the app. Edit `apps/server/src/api/app.ts` (each find text occurs once):

1. Find:

````ts
import {
  CaptchaFailedError,
  InvalidCredentialsError,
  InvalidTokenError,
  QueueFullError,
  RateLimitedError,
} from "../managers/errors.ts";
import { type HintManager, InvalidBoardError } from "../managers/hint-manager.ts";
import type { JobManager } from "../managers/job-manager.ts";
import type { PuzzleManager } from "../managers/puzzle-manager.ts";
import { type AccountRouteDeps, registerAccountRoutes, tooManyRequests } from "./accounts.ts";
import { sameOriginOnly } from "./csrf.ts";
import { problem, problemResponse } from "./problem.ts";
import {
  GenerateRequestSchema,
````

   Replace with:

````ts
import {
  CaptchaFailedError,
  InvalidBoardError,
  InvalidCredentialsError,
  InvalidTokenError,
  PuzzleNotFoundError,
  QueueFullError,
  RateLimitedError,
} from "../managers/errors.ts";
import type { HintManager } from "../managers/hint-manager.ts";
import type { JobManager } from "../managers/job-manager.ts";
import type { ProgressManager } from "../managers/progress-manager.ts";
import type { PuzzleManager } from "../managers/puzzle-manager.ts";
import { type AccountRouteDeps, registerAccountRoutes, tooManyRequests } from "./accounts.ts";
import { sameOriginOnly } from "./csrf.ts";
import { problem, problemResponse } from "./problem.ts";
import { registerProgressRoutes } from "./progress.ts";
import {
  GenerateRequestSchema,
````

2. Find:

````ts
  readonly jobs: JobManager;
  readonly hints: HintManager;
  /** Folder of the built web app to serve at `/`, with `index.html` for unknown paths. */
  readonly webDir?: string;
````

   Replace with:

````ts
  readonly jobs: JobManager;
  readonly hints: HintManager;
  readonly progress: ProgressManager;
  /** Folder of the built web app to serve at `/`, with `index.html` for unknown paths. */
  readonly webDir?: string;
````

3. Find:

````ts

  registerAccountRoutes(app, deps);

  app.all("/api/*", (c) => problem(c, 404, "Not found"));
````

   Replace with:

````ts

  registerAccountRoutes(app, deps);
  registerProgressRoutes(app, deps);

  app.all("/api/*", (c) => problem(c, 404, "Not found"));
````

4. Find:

````ts
    if (err instanceof InvalidBoardError)
      return problem(c, 400, "Invalid board", { detail: err.message });
    if (err instanceof InvalidCredentialsError)
      return problem(c, 401, "Wrong email or password", { detail: err.message });
````

   Replace with:

````ts
    if (err instanceof InvalidBoardError)
      return problem(c, 400, "Invalid board", { detail: err.message });
    if (err instanceof PuzzleNotFoundError)
      return problem(c, 404, "Puzzle not found", { detail: err.message });
    if (err instanceof InvalidCredentialsError)
      return problem(c, 401, "Wrong email or password", { detail: err.message });
````


3.7 Composition root of the API. Edit `apps/server/src/api/main.ts` (each find text occurs once):

1. Find:

````ts
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { SqliteSessionRepository } from "../adapters/db/session-repository.ts";
````

   Replace with:

````ts
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqliteProgressRepository } from "../adapters/db/progress-repository.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { SqliteSessionRepository } from "../adapters/db/session-repository.ts";
````

2. Find:

````ts
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { SessionManager } from "../managers/session-manager.ts";
````

   Replace with:

````ts
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { ProgressManager } from "../managers/progress-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { SessionManager } from "../managers/session-manager.ts";
````

3. Find:

````ts
});
const hints = new HintManager({ puzzles });
const app = createApp({
  puzzles,
  jobs,
  hints,
  accounts,
  sessions,
````

   Replace with:

````ts
});
const hints = new HintManager({ puzzles });
const progress = new ProgressManager({
  progress: new SqliteProgressRepository(db),
  puzzles,
  clock: systemClock,
});
const app = createApp({
  puzzles,
  jobs,
  hints,
  progress,
  accounts,
  sessions,
````


3.8 Composition root of the OpenAPI document. Edit `apps/server/src/api/spec.ts` (each find text occurs once):

1. Find:

````ts
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { SqliteSessionRepository } from "../adapters/db/session-repository.ts";
````

   Replace with:

````ts
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqliteProgressRepository } from "../adapters/db/progress-repository.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { SqliteSessionRepository } from "../adapters/db/session-repository.ts";
````

2. Find:

````ts
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { SessionManager } from "../managers/session-manager.ts";
````

   Replace with:

````ts
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { ProgressManager } from "../managers/progress-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { SessionManager } from "../managers/session-manager.ts";
````

3. Find:

````ts
    puzzles,
    hints: new HintManager({ puzzles }),
    jobs: new JobManager({
      jobs: new SqliteJobQueue(db),
````

   Replace with:

````ts
    puzzles,
    hints: new HintManager({ puzzles }),
    progress: new ProgressManager({
      progress: new SqliteProgressRepository(db),
      puzzles,
      clock: systemClock,
    }),
    jobs: new JobManager({
      jobs: new SqliteJobQueue(db),
````

4. Find:

````ts
      version: "0.1.0",
      description:
        "Puzzles, background jobs and accounts. Errors are RFC 9457 problem details. State-changing requests from other sites are refused (403).",
    },
  });
````

   Replace with:

````ts
      version: "0.1.0",
      description:
        "Puzzles, background jobs, accounts and saved progress. Errors are RFC 9457 problem details. State-changing requests from other sites are refused (403).",
    },
  });
````


3.9 A helper for route tests. Create `apps/server/src/test-support/progress.ts` with exactly this content:

````ts
import type { Database } from "bun:sqlite";
import { SqliteProgressRepository } from "../adapters/db/progress-repository.ts";
import { ProgressManager } from "../managers/progress-manager.ts";
import type { PuzzleManager } from "../managers/puzzle-manager.ts";
import type { Clock } from "../ports.ts";

/** The progress manager over SQLite on `db`, for route tests: pass it to `createApp` as `progress`. */
export function sqliteProgress(
  db: Database,
  puzzles: PuzzleManager,
  clock: Clock,
): ProgressManager {
  return new ProgressManager({ progress: new SqliteProgressRepository(db), puzzles, clock });
}
````


3.10 Every `createApp` call now passes `progress`. Edit `apps/server/src/api/app.test.ts` (each find text occurs once):

1. Find:

````ts
import { accountDeps } from "../test-support/accounts.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { createApp } from "./app.ts";
import type { Problem } from "./problem.ts";
````

   Replace with:

````ts
import { accountDeps } from "../test-support/accounts.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { createApp } from "./app.ts";
import type { Problem } from "./problem.ts";
````

2. Find:

````ts
    ...accountDeps(db, clock),
    hints: new HintManager({ puzzles }),
    webDir: options.webDir,
  });
````

   Replace with:

````ts
    ...accountDeps(db, clock),
    hints: new HintManager({ puzzles }),
    progress: sqliteProgress(db, puzzles, clock),
    webDir: options.webDir,
  });
````


3.11 Edit `apps/server/src/api/accounts.test.ts` (each find text occurs once):

1. Find:

````ts
import { accountDeps } from "../test-support/accounts.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { createApp } from "./app.ts";
import type { Problem } from "./problem.ts";
````

   Replace with:

````ts
import { accountDeps } from "../test-support/accounts.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { createApp } from "./app.ts";
import type { Problem } from "./problem.ts";
````

2. Find:

````ts
    puzzles,
    hints: new HintManager({ puzzles }),
    jobs: new JobManager({
      jobs: new SqliteJobQueue(db),
````

   Replace with:

````ts
    puzzles,
    hints: new HintManager({ puzzles }),
    progress: sqliteProgress(db, puzzles, clock),
    jobs: new JobManager({
      jobs: new SqliteJobQueue(db),
````


3.12 Edit `apps/server/src/worker/flow.test.ts` (each find text occurs once):

1. Find:

````ts
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";

// The whole path in one process: the API queues a generation, the worker's manager runs it in a
````

   Replace with:

````ts
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { sqliteProgress } from "../test-support/progress.ts";

// The whole path in one process: the API queues a generation, the worker's manager runs it in a
````

2. Find:

````ts
  const hints = new HintManager({ puzzles });
  return {
    app: createApp({ puzzles, jobs, hints, ...accountDeps(db, systemClock) }),
    runs,
    puzzles,
````

   Replace with:

````ts
  const hints = new HintManager({ puzzles });
  return {
    app: createApp({
      puzzles,
      jobs,
      hints,
      progress: sqliteProgress(db, puzzles, systemClock),
      ...accountDeps(db, systemClock),
    }),
    runs,
    puzzles,
````


3.13 Route tests: auth, the same-account check, CSRF, JSON-only, validation, conflicts, the rate limit and account deletion. Create `apps/server/src/api/progress.test.ts` with exactly this content:

````ts
import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { createApp } from "./app.ts";
import type { Problem } from "./problem.ts";
import { SESSION_COOKIE } from "./session-cookie.ts";

// 2×2 all 2s; its only loop runs around the outside.
const SOLVED = "112211121121";
const ONE_LINE = "100000000000";
const OTHER_LINE = "010000000000";

async function setup() {
  const db = openDatabase(":memory:");
  const clock = new FakeClock(Date.UTC(2026, 9, 25, 12));
  const deps = accountDeps(db, clock);
  const puzzles = new PuzzleManager({
    puzzles: new SqlitePuzzleRepository(db),
    blobs: new MemoryBlobStore(),
    clock,
  });
  await puzzles.saveGenerated("p1", {
    puzzle: serializePuzzle(createPuzzle(2, 2, [2, 2, 2, 2])),
    solution: SOLVED,
    steps: [],
  });
  const app = createApp({
    puzzles,
    hints: new HintManager({ puzzles }),
    progress: sqliteProgress(db, puzzles, clock),
    jobs: new JobManager({
      jobs: new SqliteJobQueue(db),
      clock,
      newId: sequentialIds("j"),
      maxQueued: 10,
    }),
    ...deps,
  });

  /** A request as the web app sends it: JSON, same origin, with an optional session cookie. */
  const send = (
    method: string,
    path: string,
    body?: unknown,
    options: { cookie?: string; headers?: Record<string, string> } = {},
  ) => {
    const headers: Record<string, string> = { "Sec-Fetch-Site": "same-origin", ...options.headers };
    if (body !== undefined) headers["Content-Type"] ??= "application/json";
    if (options.cookie !== undefined) headers.Cookie = `${SESSION_COOKIE}=${options.cookie}`;
    const env = { requestIP: () => ({ address: "198.51.100.7" }) };
    return app.request(
      path,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      env,
    );
  };

  /** Signs up and logs in `email`; returns its user id and session cookie. */
  const account = async (email: string) => {
    await send("POST", "/api/auth/signup", { email, password: "hunter22", captchaToken: "cap" });
    const res = await send("POST", "/api/auth/login", { email, password: "hunter22" });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    const cookie = res.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
      ?.split(";")[0]
      .slice(SESSION_COOKIE.length + 1);
    if (cookie === undefined) throw new Error("no session cookie");
    return { id, cookie };
  };

  return { db, clock, send, account };
}

async function expectProblem(res: Response, status: number, title?: string): Promise<Problem> {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toStartWith("application/problem+json");
  const body = (await res.json()) as Problem;
  if (title !== undefined) expect(body.title).toBe(title);
  return body;
}

const save = (
  edges: string,
  elapsedMs: number,
  options: { assisted?: boolean; baseVersion?: number | null; device?: string } = {},
) => ({
  edges,
  elapsedMs,
  assisted: options.assisted ?? false,
  baseVersion: options.baseVersion ?? null,
  device: options.device ?? "browser-1",
});

describe("saved progress routes", () => {
  test("save, read back, list and delete (FR-21)", async () => {
    const { send, account, clock } = await setup();
    const { id, cookie } = await account("ann@example.com");
    const path = `/api/users/${id}/progress/p1`;

    expect(await (await send("GET", path, undefined, { cookie })).json()).toEqual({
      progress: null,
    });

    const saved = await send("PUT", path, save(ONE_LINE, 4200, { assisted: true }), { cookie });
    expect(saved.status).toBe(200);
    const progress = {
      puzzleId: "p1",
      edges: ONE_LINE,
      elapsedMs: 4200,
      solved: false,
      assisted: true,
      version: 1,
      updatedAt: "2026-10-25T12:00:00.000Z",
    };
    expect(await saved.json()).toEqual({ progress, accepted: true });
    expect(await (await send("GET", path, undefined, { cookie })).json()).toEqual({ progress });

    clock.advance(1000);
    const list = await send("GET", `/api/users/${id}/progress`, undefined, { cookie });
    expect(await list.json()).toEqual({
      items: [
        {
          puzzleId: "p1",
          width: 2,
          height: 2,
          elapsedMs: 4200,
          assisted: true,
          updatedAt: "2026-10-25T12:00:00.000Z",
        },
      ],
    });

    expect((await send("DELETE", path, undefined, { cookie })).status).toBe(204);
    expect(await (await send("GET", path, undefined, { cookie })).json()).toEqual({
      progress: null,
    });
  });

  test("conflicts between devices (DECISIONS, Progress conflicts)", async () => {
    const { send, account } = await setup();
    const { id, cookie } = await account("ann@example.com");
    const path = `/api/users/${id}/progress/p1`;
    const phone = { device: "phone" };
    const laptop = { device: "laptop" };

    await send("PUT", path, save(ONE_LINE, 1000, phone), { cookie });
    const continued = await send(
      "PUT",
      path,
      save(OTHER_LINE, 2000, { ...laptop, baseVersion: 1 }),
      {
        cookie,
      },
    );
    expect(await continued.json()).toMatchObject({ accepted: true, progress: { version: 2 } });

    // The laptop's board sent again from elsewhere (a tab hidden without a move) takes no version.
    const glance = await send("PUT", path, save(OTHER_LINE, 2500, { ...phone, baseVersion: 2 }), {
      cookie,
    });
    expect(await glance.json()).toMatchObject({
      accepted: true,
      progress: { edges: OTHER_LINE, elapsedMs: 2500, version: 2 },
    });

    // The phone's tab still shows version 1: its save is stale and gets the laptop's board.
    const stale = await send("PUT", path, save(ONE_LINE, 90_000, { ...phone, baseVersion: 1 }), {
      cookie,
    });
    expect(await stale.json()).toMatchObject({
      accepted: false,
      progress: { edges: OTHER_LINE, elapsedMs: 2500, version: 2 },
    });

    // A solved board wins even when stale, and then stays.
    const solved = await send("PUT", path, save(SOLVED, 7000, { ...phone, baseVersion: 1 }), {
      cookie,
    });
    expect(await solved.json()).toMatchObject({ accepted: true, progress: { solved: true } });
    const after = await send("PUT", path, save(ONE_LINE, 8000, { ...phone, baseVersion: 3 }), {
      cookie,
    });
    expect(await after.json()).toMatchObject({ accepted: false, progress: { edges: SOLVED } });
  });

  test("needs a login, and only the logged-in user's own path", async () => {
    const { send, account } = await setup();
    const ann = await account("ann@example.com");
    const bob = await account("bob@example.com");
    const annPath = `/api/users/${ann.id}/progress/p1`;

    await expectProblem(await send("GET", annPath), 401, "Not logged in");
    await expectProblem(await send("PUT", annPath, save(ONE_LINE, 1)), 401);
    await expectProblem(await send("GET", `/api/users/${ann.id}/progress`), 401);
    await expectProblem(await send("DELETE", annPath), 401);

    for (const [method, body] of [
      ["GET", undefined],
      ["PUT", save(ONE_LINE, 1)],
      ["DELETE", undefined],
    ] as const) {
      await expectProblem(
        await send(method, annPath, body, { cookie: bob.cookie }),
        403,
        "Logged in as someone else",
      );
    }
    await expectProblem(
      await send("GET", `/api/users/${ann.id}/progress`, undefined, { cookie: bob.cookie }),
      403,
    );
  });

  test("refuses cross-site writes (CSRF) and bodies that aren't JSON", async () => {
    const { send, account } = await setup();
    const { id, cookie } = await account("ann@example.com");
    const path = `/api/users/${id}/progress/p1`;
    const crossSite = { "Sec-Fetch-Site": "cross-site" };

    await expectProblem(
      await send("PUT", path, save(ONE_LINE, 1), { cookie, headers: crossSite }),
      403,
      "Cross-site request refused",
    );
    await expectProblem(await send("DELETE", path, undefined, { cookie, headers: crossSite }), 403);
    const form = await send("PUT", path, save(ONE_LINE, 1), {
      cookie,
      headers: { "Content-Type": "text/plain" },
    });
    expect(form.status).toBe(415);
  });

  test("validates the board and the body", async () => {
    const { send, account } = await setup();
    const { id, cookie } = await account("ann@example.com");
    const path = `/api/users/${id}/progress/p1`;

    await expectProblem(await send("PUT", path, save("000", 1), { cookie }), 400, "Invalid board");
    for (const body of [
      save("00000000000x", 1),
      save(ONE_LINE, -1),
      save(ONE_LINE, 1.5),
      save(ONE_LINE, 1, { baseVersion: 0 }),
      save(ONE_LINE, 1, { device: "" }),
      { ...save(ONE_LINE, 1), solved: true },
      { edges: ONE_LINE, elapsedMs: 1, assisted: false, device: "d" },
    ]) {
      await expectProblem(await send("PUT", path, body, { cookie }), 400, "Invalid request");
    }
    await expectProblem(
      await send("PUT", `/api/users/${id}/progress/nope`, save(ONE_LINE, 1), { cookie }),
      404,
      "Puzzle not found",
    );
    await expectProblem(
      await send("GET", `/api/users/${id}/progress/nope`, undefined, { cookie }),
      404,
    );
  });

  test("limits each user to 120 progress requests a minute", async () => {
    const { send, account, clock } = await setup();
    const { id, cookie } = await account("ann@example.com");
    const path = `/api/users/${id}/progress/p1`;
    for (let i = 0; i < 120; i++) {
      expect((await send("GET", path, undefined, { cookie })).status).toBe(200);
    }
    const limited = await send("PUT", path, save(ONE_LINE, 1), { cookie });
    await expectProblem(limited, 429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    clock.advance(60_000);
    expect((await send("GET", path, undefined, { cookie })).status).toBe(200);
  });

  test("deleting the account deletes its progress (NFR-6)", async () => {
    const { send, account, db } = await setup();
    const { id, cookie } = await account("ann@example.com");
    await send("PUT", `/api/users/${id}/progress/p1`, save(ONE_LINE, 1), { cookie });
    const count = () => db.query("SELECT count(*) AS n FROM progress").get();
    expect(count()).toEqual({ n: 1 });
    expect(
      (await send("DELETE", "/api/account", { password: "hunter22" }, { cookie })).status,
    ).toBe(204);
    expect(count()).toEqual({ n: 0 });
  });
});
````


3.14 Regenerate the contract and the client:

```sh
bun run format && bun run gen:api
git diff --stat -- openapi.yaml packages/api-client/src/schema.ts
```

Expect both files to change (new `/api/users/{userId}/progress…` paths and the `Progress`, `ProgressResult`, `SaveProgressRequest`, `SaveProgressResult`, `ProgressSummary`, `ProgressList` schemas; the API description now ends "accounts and saved progress"). The `HintRequest` schema must not change.

Verify: `bun run check` → `0 fail`. Commit: `feat(server): add the saved progress API`

### Step 4. The web sync module

4.1 The test storage can list its keys (guest import and account deletion need that). Replace the whole of `apps/web/src/lib/test-support/memory-storage.ts` with:

````ts
import type { KeyValueStorage } from "../game/progress.ts";

/** An in-memory stand-in for `localStorage` in tests. */
export function memoryStorage(): KeyValueStorage &
  Pick<Storage, "key" | "length"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}
````


4.2 `browserStorage()` returns the full `Storage`, so the sync module can list keys. Edit `apps/web/src/lib/game/progress.ts` (each find text occurs once):

1. Find:

````ts
 * does so when site data is blocked), so components must go through this rather than touch it.
 */
export function browserStorage(): KeyValueStorage | null {
  try {
    return globalThis.localStorage ?? null;
````

   Replace with:

````ts
 * does so when site data is blocked), so components must go through this rather than touch it.
 */
export function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
````


4.3 Edit `apps/web/src/lib/puzzles/fixtures.ts` (each find text occurs once):

1. Find:

````ts
];

function summary(f: FixtureRecord): PuzzleSummary {
  return {
````

   Replace with:

````ts
];

/** Whether `id` is a built-in puzzle. The server doesn't hold these, so their progress stays on the device. */
export function isBuiltIn(id: string): boolean {
  return FIXTURES.some((f) => f.id === id);
}

function summary(f: FixtureRecord): PuzzleSummary {
  return {
````


4.4 The sync engine for one account. Create `apps/web/src/lib/sync/sync.ts` with exactly this content:

````ts
import type { ApiClient, Schemas } from "@loophole/api-client";
import { decodeEdges, encodeEdges, type Grid } from "@loophole/core";
import type { KeyValueStorage, Progress } from "../game/progress.ts";

/** Browser storage that can also list its keys; `localStorage` fits. */
export type ListableStorage = KeyValueStorage & Pick<Storage, "key" | "length">;

/** A save as stored on the device and sent to the server: edges in the wire encoding. */
export interface SavedBoard {
  readonly edges: string;
  readonly elapsedMs: number;
  readonly solved: boolean;
  readonly assisted: boolean;
  /** The server's version this board continues from; null for guest saves and new boards. */
  readonly version: number | null;
}

/** How long after the last change a save goes to the server. */
export const SAVE_DELAY_MS = 2000;
/** How long opening a puzzle waits for the server before using the copy on this device. */
export const LOAD_TIMEOUT_MS = 4000;
/** Waits before trying failed saves again; the last one repeats. */
export const RETRY_MS = [5_000, 15_000, 60_000] as const;

/** Runs `fn` after `ms` and returns a function that cancels it. Tests pass a manual one. */
export type Schedule = (fn: () => void, ms: number) => () => void;

export const realSchedule: Schedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

/** Reads a save in the guest store's format (`{v: 1, edges, elapsedMs, solved, assisted?}`). */
export function readSaved(storage: KeyValueStorage | null, key: string): SavedBoard | null {
  try {
    const text = storage?.getItem(key);
    if (!text) return null;
    const data = JSON.parse(text) as Record<string, unknown>;
    if (data.v !== 1 || typeof data.edges !== "string" || !/^[012]+$/.test(data.edges)) {
      return null;
    }
    const elapsedMs =
      typeof data.elapsedMs === "number" && Number.isFinite(data.elapsedMs) && data.elapsedMs > 0
        ? Math.round(data.elapsedMs)
        : 0;
    return {
      edges: data.edges,
      elapsedMs,
      solved: data.solved === true,
      assisted: data.assisted === true,
      version:
        Number.isInteger(data.version) && Number(data.version) >= 1 ? Number(data.version) : null,
    };
  } catch {
    return null;
  }
}

function writeSaved(storage: KeyValueStorage | null, key: string, saved: SavedBoard): void {
  try {
    storage?.setItem(key, JSON.stringify({ v: 1, ...saved }));
  } catch {
    // Quota or private mode: the server copy still counts.
  }
}

function remove(storage: KeyValueStorage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

function toProgress(grid: Grid, saved: SavedBoard | null): Progress | null {
  if (saved === null) return null;
  try {
    const { elapsedMs, solved, assisted } = saved;
    return { edges: decodeEdges(grid, saved.edges), elapsedMs, solved, assisted };
  } catch {
    return null;
  }
}

function fromProgress(p: Progress, version: number | null): SavedBoard {
  return {
    edges: encodeEdges(p.edges),
    elapsedMs: Math.round(p.elapsedMs),
    solved: p.solved,
    assisted: p.assisted,
    version,
  };
}

function fromServer(p: Schemas["Progress"]): SavedBoard {
  const { edges, elapsedMs, solved, assisted, version } = p;
  return { edges, elapsedMs, solved, assisted, version };
}

function same(a: SavedBoard | null, b: SavedBoard | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Key prefix of everything stored on this device for one account. */
export function userPrefix(userId: string): string {
  return `loophole:user:${userId}:`;
}

/** Removes everything stored on this device for an account (after deleting it, NFR-6). */
export function forgetUser(storage: ListableStorage | null, userId: string): void {
  if (storage === null) return;
  const prefix = userPrefix(userId);
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Storage refused; nothing more to do.
  }
}

/**
 * Removes the account's synced boards from this device (on logout), keeping only saves that
 * haven't reached the server yet, so they go out at the account's next login.
 */
export function forgetSynced(storage: ListableStorage | null, userId: string): void {
  if (storage === null) return;
  const prefix = `${userPrefix(userId)}progress:`;
  const keep = new Set([
    ...storedSet(storage, `${userPrefix(userId)}unsynced`).list(),
    ...storedSet(storage, `${userPrefix(userId)}deleting`).list(),
  ]);
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(prefix) && !keep.has(key.slice(prefix.length))) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Storage refused; nothing more to do.
  }
}

/** A set of puzzle ids kept in storage as a JSON array. */
function storedSet(storage: KeyValueStorage | null, key: string) {
  const read = (): string[] => {
    try {
      const value = JSON.parse(storage?.getItem(key) ?? "[]");
      return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
    } catch {
      return [];
    }
  };
  const write = (ids: string[]) => {
    try {
      if (ids.length === 0) storage?.removeItem(key);
      else storage?.setItem(key, JSON.stringify(ids));
    } catch {
      // Quota or private mode.
    }
  };
  return {
    list: read,
    has: (id: string) => read().includes(id),
    add(id: string) {
      const ids = read();
      if (!ids.includes(id)) write([...ids, id]);
    },
    remove(id: string) {
      write(read().filter((x) => x !== id));
    },
  };
}

/** What happened to one guest save brought into the account. */
export type ImportOutcome = "imported" | "kept" | "skipped" | "failed";

/** Called with the board to show when the server has a different one than this device. */
export type RemoteListener = (progress: Progress | null) => void;

export interface ProgressSyncDeps {
  readonly client: ApiClient;
  readonly storage: KeyValueStorage | null;
  readonly userId: string;
  /** A random id for this browser, the same on every save (see DECISIONS, "Progress conflicts"). */
  readonly device: string;
  /** The server says the session is gone or belongs to someone else (401 or 403). */
  readonly onAuthLost: () => void;
  readonly schedule?: Schedule;
  /** A signal that aborts after `LOAD_TIMEOUT_MS`, for requests a screen waits on. */
  readonly timeout?: () => AbortSignal;
}

/**
 * One account's saved progress (PRD FR-21). Every save lands on the device at once, under the
 * account's own keys, and goes to the server shortly after; saves that fail stay marked and are
 * sent again later. The server settles conflicts between devices (DECISIONS, "Progress
 * conflicts"), and its answer replaces the copy here.
 */
export interface ProgressSync {
  readonly userId: string;
  /** The saved board, from the server when it answers in time, else the copy on this device. */
  load(puzzleId: string, grid: Grid): Promise<Progress | null>;
  /** The copy on this device, without asking the server. */
  peek(puzzleId: string, grid: Grid): Progress | null;
  /** Saves a board. A first save of an empty board is skipped: opening a puzzle isn't progress. */
  save(puzzleId: string, progress: Progress): void;
  /** Forgets the puzzle here and on the server ("Start over"). */
  clear(puzzleId: string): void;
  /** Sends every unsent save now, in requests that outlive the page. */
  flush(): void;
  /** Asks the server again (the tab came back) and tells the watchers if its board differs. */
  refresh(puzzleId: string): Promise<void>;
  /** Sends every save that hasn't reached the server yet. */
  pushPending(): Promise<void>;
  watch(puzzleId: string, grid: Grid, listener: RemoteListener): () => void;
  /** Saves a guest's board into the account; the server keeps whichever board wins. */
  importGuest(puzzleId: string, saved: SavedBoard): Promise<ImportOutcome>;
  /** The account's unsolved puzzles, most recent first; empty when the server can't be reached. */
  list(): Promise<Schemas["ProgressSummary"][]>;
  /** Stops timers; later saves stay on the device until this account syncs again. */
  close(): void;
}

type PushResult = "ok" | "retry" | "auth";

interface PushInit {
  readonly keepalive?: boolean;
  readonly signal?: AbortSignal;
}

function classify(status: number): PushResult | "drop" {
  if (status === 401 || status === 403) return "auth";
  if (status === 429 || status >= 500) return "retry";
  return "drop";
}

/** Resolves with "retry" when `signal` aborts: a screen stops waiting for a slow server. */
function untilAborted(signal: AbortSignal): Promise<PushResult> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve("retry");
    else signal.addEventListener("abort", () => resolve("retry"), { once: true });
  });
}

export function createProgressSync(deps: ProgressSyncDeps): ProgressSync {
  const { client, storage, userId, device, onAuthLost } = deps;
  const schedule = deps.schedule ?? realSchedule;
  const timeout = deps.timeout ?? (() => AbortSignal.timeout(LOAD_TIMEOUT_MS));
  const prefix = userPrefix(userId);
  const boardKey = (puzzleId: string) => `${prefix}progress:${puzzleId}`;
  const unsynced = storedSet(storage, `${prefix}unsynced`);
  const deleting = storedSet(storage, `${prefix}deleting`);
  const path = (puzzleId: string) => ({ params: { path: { userId, puzzleId } } });
  const pending = (puzzleId: string) => unsynced.has(puzzleId) || deleting.has(puzzleId);

  const timers = new Map<string, () => void>();
  /** Bumped on every save, so a server answer to an older save doesn't mark a newer one sent. */
  const versions = new Map<string, number>();
  /** The request running for each puzzle; there is never more than one. */
  const inflight = new Map<string, Promise<PushResult>>();
  const watchers = new Map<string, Set<{ grid: Grid; listener: RemoteListener }>>();
  let retries = 0;
  let cancelRetry: (() => void) | null = null;
  let closed = false;

  function notify(puzzleId: string, saved: SavedBoard | null) {
    for (const w of watchers.get(puzzleId) ?? []) w.listener(toProgress(w.grid, saved));
  }

  function scheduleRetry() {
    if (closed || cancelRetry !== null) return;
    const wait = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)];
    retries++;
    cancelRetry = schedule(() => {
      cancelRetry = null;
      void pushPending();
    }, wait);
  }

  function handle(result: PushResult) {
    if (result === "auth") onAuthLost();
    else if (result === "retry") scheduleRetry();
  }

  /**
   * Sends the puzzle's unsent delete and save. Only one request per puzzle runs at a time, so the
   * server gets this page's saves in order: a later call waits and then sends the newest board,
   * except a keepalive flush, which leaves the save marked for the running request to follow up.
   */
  function push(puzzleId: string, init: PushInit = {}): Promise<PushResult> {
    const running = inflight.get(puzzleId);
    if (running !== undefined) {
      if (init.keepalive) return Promise.resolve("ok");
      return running.then(() => push(puzzleId, init));
    }
    const started = versions.get(puzzleId);
    const run = pushNow(puzzleId, init).finally(() => {
      inflight.delete(puzzleId);
      // A save made while this request was out goes next, unless its own timer will send it.
      if (
        !closed &&
        unsynced.has(puzzleId) &&
        versions.get(puzzleId) !== started &&
        !timers.has(puzzleId)
      ) {
        void push(puzzleId).then(handle);
      }
    });
    inflight.set(puzzleId, run);
    return run;
  }

  async function pushNow(puzzleId: string, init: PushInit): Promise<PushResult> {
    if (deleting.has(puzzleId)) {
      let status: number;
      try {
        status = (
          await client.DELETE("/api/users/{userId}/progress/{puzzleId}", {
            ...path(puzzleId),
            ...init,
          })
        ).response.status;
      } catch {
        return "retry";
      }
      const result = status === 204 ? "drop" : classify(status);
      if (result !== "drop") return result;
      deleting.remove(puzzleId);
    }
    if (!unsynced.has(puzzleId)) return "ok";
    const saved = readSaved(storage, boardKey(puzzleId));
    if (saved === null) {
      unsynced.remove(puzzleId);
      return "ok";
    }
    const version = versions.get(puzzleId);
    let answer: Awaited<ReturnType<typeof putBoard>>;
    try {
      answer = await putBoard(puzzleId, saved, device, init);
    } catch {
      return "retry";
    }
    const { data, response } = answer;
    if (data === undefined) {
      const result = classify(response.status);
      if (result !== "drop") return result;
      console.warn(`Progress for ${puzzleId} was refused (HTTP ${response.status})`);
      unsynced.remove(puzzleId);
      return "ok";
    }
    const server = fromServer(data.progress);
    if (!data.accepted) {
      // Another device is further on, or this puzzle is solved: show the server's board.
      writeSaved(storage, boardKey(puzzleId), server);
      unsynced.remove(puzzleId);
      notify(puzzleId, server);
    } else if (versions.get(puzzleId) === version) {
      writeSaved(storage, boardKey(puzzleId), server);
      unsynced.remove(puzzleId);
    } else {
      // Newer moves were saved here meanwhile: they now continue from the server's version.
      const latest = readSaved(storage, boardKey(puzzleId));
      if (latest !== null) {
        writeSaved(storage, boardKey(puzzleId), { ...latest, version: server.version });
      }
    }
    return "ok";
  }

  function putBoard(puzzleId: string, saved: SavedBoard, from: string, init: PushInit) {
    const { edges, elapsedMs, assisted, version } = saved;
    return client.PUT("/api/users/{userId}/progress/{puzzleId}", {
      ...path(puzzleId),
      body: { edges, elapsedMs, assisted, baseVersion: version, device: from },
      ...init,
    });
  }

  /** Sends the unsent save, giving up on waiting (not on the save) when `signal` aborts. */
  function pushWithin(puzzleId: string, signal: AbortSignal): Promise<PushResult> {
    return Promise.race([push(puzzleId, { signal }), untilAborted(signal)]);
  }

  async function pushPending(): Promise<void> {
    const ids = new Set([...deleting.list(), ...unsynced.list()]);
    for (const id of ids) {
      const result = await push(id);
      if (result !== "ok") {
        handle(result);
        return;
      }
    }
    retries = 0;
  }

  function pushSoon(puzzleId: string) {
    timers.get(puzzleId)?.();
    if (closed) return;
    timers.set(
      puzzleId,
      schedule(() => {
        timers.delete(puzzleId);
        void push(puzzleId).then(handle);
      }, SAVE_DELAY_MS),
    );
  }

  return {
    userId,

    async load(puzzleId, grid) {
      const local = () => toProgress(grid, readSaved(storage, boardKey(puzzleId)));
      const signal = timeout();
      try {
        if (pending(puzzleId)) {
          // Send this device's unsent save first; the server's answer is what to show.
          handle(await pushWithin(puzzleId, signal));
          return local();
        }
        const { data, response } = await client.GET("/api/users/{userId}/progress/{puzzleId}", {
          ...path(puzzleId),
          signal,
        });
        if (data === undefined) {
          if (classify(response.status) === "auth") onAuthLost();
          return local();
        }
        if (data.progress === null) {
          // Nothing on the server: never saved, or started over on another device.
          remove(storage, boardKey(puzzleId));
          return null;
        }
        const server = fromServer(data.progress);
        writeSaved(storage, boardKey(puzzleId), server);
        return toProgress(grid, server);
      } catch {
        return local();
      }
    },

    peek(puzzleId, grid) {
      return toProgress(grid, readSaved(storage, boardKey(puzzleId)));
    },

    save(puzzleId, progress) {
      const here = readSaved(storage, boardKey(puzzleId));
      const saved = fromProgress(progress, here?.version ?? null);
      // Opening a puzzle and leaving it isn't progress, and an empty record would block a later
      // guest import.
      if (here === null && !/[12]/.test(saved.edges)) return;
      writeSaved(storage, boardKey(puzzleId), saved);
      unsynced.add(puzzleId);
      versions.set(puzzleId, (versions.get(puzzleId) ?? 0) + 1);
      pushSoon(puzzleId);
    },

    clear(puzzleId) {
      timers.get(puzzleId)?.();
      timers.delete(puzzleId);
      remove(storage, boardKey(puzzleId));
      unsynced.remove(puzzleId);
      deleting.add(puzzleId);
      if (!closed) void push(puzzleId).then(handle);
    },

    flush() {
      if (closed) return;
      for (const cancel of timers.values()) cancel();
      timers.clear();
      for (const id of new Set([...deleting.list(), ...unsynced.list()])) {
        void push(id, { keepalive: true }).then(handle);
      }
    },

    async refresh(puzzleId) {
      if (closed) return;
      const signal = timeout();
      if (pending(puzzleId) || inflight.has(puzzleId)) {
        handle(await pushWithin(puzzleId, signal));
        return;
      }
      const before = versions.get(puzzleId);
      try {
        const { data, response } = await client.GET("/api/users/{userId}/progress/{puzzleId}", {
          ...path(puzzleId),
          signal,
        });
        if (data === undefined) {
          if (classify(response.status) === "auth") onAuthLost();
          return;
        }
        // A save made while the request was out is newer than this answer.
        if (pending(puzzleId) || inflight.has(puzzleId) || versions.get(puzzleId) !== before) {
          return;
        }
        const server = data.progress === null ? null : fromServer(data.progress);
        const here = readSaved(storage, boardKey(puzzleId));
        if (same(server, here)) return;
        if (server === null) remove(storage, boardKey(puzzleId));
        else writeSaved(storage, boardKey(puzzleId), server);
        notify(puzzleId, server);
      } catch {
        // Offline: keep what is here.
      }
    },

    pushPending,

    watch(puzzleId, grid, listener) {
      const entry = { grid, listener };
      const set = watchers.get(puzzleId) ?? new Set();
      set.add(entry);
      watchers.set(puzzleId, set);
      return () => set.delete(entry);
    },

    async importGuest(puzzleId, saved) {
      const signal = timeout();
      if (pending(puzzleId)) {
        const result = await pushWithin(puzzleId, signal);
        if (result !== "ok") {
          handle(result);
          return "failed";
        }
      }
      try {
        // As a new device that has seen no version: the account's board wins unless this one is
        // solved, and nothing on this device can match it later by accident.
        const { data, response } = await putBoard(
          puzzleId,
          { ...saved, version: null },
          crypto.randomUUID(),
          { signal },
        );
        if (data === undefined) {
          const result = classify(response.status);
          if (result === "auth") onAuthLost();
          return result === "drop" ? "skipped" : "failed";
        }
        writeSaved(storage, boardKey(puzzleId), fromServer(data.progress));
        return data.accepted ? "imported" : "kept";
      } catch {
        return "failed";
      }
    },

    async list() {
      try {
        const { data } = await client.GET("/api/users/{userId}/progress", {
          params: { path: { userId }, query: { limit: 20 } },
          signal: timeout(),
        });
        return data?.items ?? [];
      } catch {
        return [];
      }
    },

    close() {
      closed = true;
      for (const cancel of timers.values()) cancel();
      timers.clear();
      cancelRetry?.();
      cancelRetry = null;
    },
  };
}
````


4.5 Its tests, against a fake progress API that applies the server's conflict rule, with a hand-run scheduler. Create `apps/web/src/lib/sync/sync.test.ts` with exactly this content:

````ts
import { describe, expect, test } from "bun:test";
import { createApiClient } from "@loophole/api-client";
import { createGrid, decodeEdges } from "@loophole/core";
import { memoryStorage } from "../test-support/memory-storage.ts";
import {
  createProgressSync,
  forgetSynced,
  forgetUser,
  RETRY_MS,
  readSaved,
  SAVE_DELAY_MS,
  type Schedule,
} from "./sync.ts";

const grid = createGrid(2, 2);
// 2×2 all 2s; its only loop runs around the outside.
const SOLVED = "112211121121";
const ONE_LINE = "100000000000";
const TWO_LINES = "110000000000";
const OTHER_LINE = "010000000000";

const board = (edges: string, elapsedMs: number, assisted = false) => ({
  edges: decodeEdges(grid, edges),
  elapsedMs,
  solved: edges === SOLVED,
  assisted,
});

interface Stored {
  edges: string;
  elapsedMs: number;
  solved: boolean;
  assisted: boolean;
  version: number;
  device: string;
}

/** A record saved by another device. */
const record = (edges: string, elapsedMs: number, version = 1): Stored => ({
  edges,
  elapsedMs,
  solved: edges === SOLVED,
  assisted: false,
  version,
  device: "other",
});

/**
 * The progress API in memory, with the server's conflict rule: a solved record stays; the stored
 * board sent again keeps its version; a solved board wins; otherwise a save needs the stored
 * version or the same device; assisted only turns on. `down` makes every request fail like a
 * network error, and `status` answers every request with that error status. `hold` names a method
 * whose answers (worked out on arrival) wait in `held` until released; `hang` makes PUTs never
 * answer until their request is aborted.
 */
function fakeServer() {
  const records = new Map<string, Stored>();
  const requests: { method: string; path: string; body?: unknown; keepalive: boolean }[] = [];
  const server = {
    records,
    requests,
    down: false,
    status: 0,
    hold: "",
    held: [] as (() => void)[],
    hang: false,
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": status < 400 ? "application/json" : "application/problem+json",
      },
    });
  const dto = (id: string, { device: _, ...r }: Stored) => ({
    puzzleId: id,
    ...r,
    updatedAt: "2026-10-25T12:00:00.000Z",
  });
  const answer = (method: string, pathname: string, body: unknown): Response => {
    if (server.status) return json(server.status, { title: "Error", status: server.status });
    const match = pathname.match(/^\/api\/users\/u1\/progress(?:\/([^/]+))?$/);
    if (!match) return json(403, { title: "Logged in as someone else", status: 403 });
    const id = match[1];
    if (id === undefined) {
      const items = [...records]
        .filter(([, r]) => !r.solved)
        .map(([pid, r]) => ({ ...dto(pid, r), width: 2, height: 2 }));
      return json(200, { items });
    }
    if (id === "gone") return json(404, { title: "Puzzle not found", status: 404 });
    const stored = records.get(id);
    if (method === "GET") return json(200, { progress: stored ? dto(id, stored) : null });
    if (method === "DELETE") {
      records.delete(id);
      return new Response(null, { status: 204 });
    }
    const sent = body as {
      edges: string;
      elapsedMs: number;
      assisted: boolean;
      baseVersion: number | null;
      device: string;
    };
    const solved = sent.edges === SOLVED;
    const assisted = sent.assisted || (stored?.assisted ?? false);
    if (stored && !stored.solved && sent.edges === stored.edges) {
      const touched = {
        ...stored,
        elapsedMs: Math.max(stored.elapsedMs, sent.elapsedMs),
        assisted,
      };
      records.set(id, touched);
      return json(200, { progress: dto(id, touched), accepted: true });
    }
    const accepted =
      stored === undefined ||
      (!stored.solved &&
        (solved || sent.baseVersion === stored.version || sent.device === stored.device));
    const next: Stored = accepted
      ? {
          edges: sent.edges,
          elapsedMs: sent.elapsedMs,
          solved,
          assisted,
          version: (stored?.version ?? 0) + 1,
          device: sent.device,
        }
      : { ...(stored as Stored), assisted };
    records.set(id, next);
    return json(200, { progress: dto(id, next), accepted });
  };
  const fetch = (async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "PUT" ? await input.json() : undefined;
    requests.push({ method: input.method, path: url.pathname, body, keepalive: input.keepalive });
    if (server.down) throw new TypeError("Failed to fetch");
    if (server.hang && input.method === "PUT") {
      return new Promise<Response>((_, reject) => {
        input.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    const response = answer(input.method, url.pathname, body);
    if (server.hold === input.method) {
      await new Promise<void>((resolve) => server.held.push(resolve));
    }
    return response;
  }) as typeof globalThis.fetch;
  return { server, client: createApiClient({ baseUrl: "http://api.test", fetch }) };
}

/** A scheduler the test runs by hand. */
function manualSchedule() {
  const jobs: { fn: () => void; ms: number; done: boolean }[] = [];
  const schedule: Schedule = (fn, ms) => {
    const job = { fn, ms, done: false };
    jobs.push(job);
    return () => {
      job.done = true;
    };
  };
  const pending = () => jobs.filter((j) => !j.done);
  const runAll = async () => {
    for (const job of pending()) {
      job.done = true;
      job.fn();
    }
    await settle();
  };
  return { schedule, pending, runAll };
}

/** Lets fake requests and their handlers finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function setup() {
  const { server, client } = fakeServer();
  const storage = memoryStorage();
  const timers = manualSchedule();
  let authLost = 0;
  const sync = createProgressSync({
    client,
    storage,
    userId: "u1",
    device: "this",
    onAuthLost: () => {
      authLost++;
    },
    schedule: timers.schedule,
    timeout: () => AbortSignal.timeout(50),
  });
  const key = (id: string) => `loophole:user:u1:progress:${id}`;
  const unsynced = () => JSON.parse(storage.data.get("loophole:user:u1:unsynced") ?? "[]");
  return { server, storage, timers, sync, key, unsynced, authLost: () => authLost };
}

describe("progress sync: opening a puzzle", () => {
  test("takes the server's board and keeps a copy on the device", async () => {
    const { server, storage, sync, key } = setup();
    server.records.set("p1", { ...record(ONE_LINE, 4000, 3), assisted: true });
    expect(await sync.load("p1", grid)).toEqual(board(ONE_LINE, 4000, true));
    expect(readSaved(storage, key("p1"))).toEqual({
      edges: ONE_LINE,
      elapsedMs: 4000,
      solved: false,
      assisted: true,
      version: 3,
    });
    expect(sync.peek("p1", grid)).toEqual(board(ONE_LINE, 4000, true));
  });

  test("nothing on the server clears the device copy (started over elsewhere)", async () => {
    const { storage, sync, key } = setup();
    storage.setItem(key("p1"), JSON.stringify({ v: 1, edges: ONE_LINE, elapsedMs: 5 }));
    expect(await sync.load("p1", grid)).toBeNull();
    expect(storage.data.has(key("p1"))).toBe(false);
  });

  test("offline, uses the copy on the device", async () => {
    const { server, storage, sync, key } = setup();
    storage.setItem(key("p1"), JSON.stringify({ v: 1, edges: ONE_LINE, elapsedMs: 5 }));
    server.down = true;
    expect(await sync.load("p1", grid)).toEqual(board(ONE_LINE, 5));
  });

  test("an unsent save goes first and wins when it continues the server's board", async () => {
    const { server, sync, timers } = setup();
    server.records.set("p1", record(ONE_LINE, 3000));
    await sync.load("p1", grid);
    server.down = true;
    sync.save("p1", board(TWO_LINES, 9000));
    await timers.runAll();
    server.down = false;
    expect(await sync.load("p1", grid)).toEqual(board(TWO_LINES, 9000));
    expect(server.records.get("p1")).toMatchObject({
      edges: TWO_LINES,
      version: 2,
      device: "this",
    });
  });

  test("an unsent save made on a stale board gives way to the other device's", async () => {
    const { server, sync, timers } = setup();
    server.records.set("p1", record(ONE_LINE, 3000));
    await sync.load("p1", grid);
    server.down = true;
    sync.save("p1", board(TWO_LINES, 90_000));
    await timers.runAll();
    // Meanwhile another device carried on from version 1.
    server.records.set("p1", record(OTHER_LINE, 4000, 2));
    server.down = false;
    expect(await sync.load("p1", grid)).toEqual(board(OTHER_LINE, 4000));
  });
});

describe("progress sync: saving", () => {
  test("lands on the device at once and on the server after a pause", async () => {
    const { server, storage, sync, timers, key, unsynced } = setup();
    sync.save("p1", board(ONE_LINE, 1000));
    sync.save("p1", board(TWO_LINES, 2000));
    expect(readSaved(storage, key("p1"))?.edges).toBe(TWO_LINES);
    expect(unsynced()).toEqual(["p1"]);
    expect(server.requests).toEqual([]);
    expect(timers.pending().map((j) => j.ms)).toEqual([SAVE_DELAY_MS]);
    await timers.runAll();
    expect(server.requests.map((r) => [r.method, r.body])).toEqual([
      [
        "PUT",
        { edges: TWO_LINES, elapsedMs: 2000, assisted: false, baseVersion: null, device: "this" },
      ],
    ]);
    expect(unsynced()).toEqual([]);
    expect(readSaved(storage, key("p1"))?.version).toBe(1);
    sync.save("p1", board(ONE_LINE, 3000));
    await timers.runAll();
    expect(server.requests.at(-1)?.body).toMatchObject({ baseVersion: 1 });
    expect(server.records.get("p1")?.version).toBe(2);
  });

  test("moves made while a save is on its way continue from the server's new version", async () => {
    const { server, storage, sync, timers, key, unsynced } = setup();
    sync.save("p1", board(ONE_LINE, 1000));
    const [first] = timers.pending();
    first.done = true;
    first.fn();
    sync.save("p1", board(TWO_LINES, 2000));
    await settle();
    expect(readSaved(storage, key("p1"))).toMatchObject({ edges: TWO_LINES, version: 1 });
    expect(unsynced()).toEqual(["p1"]);
    await timers.runAll();
    expect(server.records.get("p1")).toMatchObject({ edges: TWO_LINES, version: 2 });
  });

  test("a save the server refuses brings in the server's board", async () => {
    const { server, storage, sync, timers, key } = setup();
    server.records.set("p1", record(SOLVED, 60_000));
    const seen: unknown[] = [];
    sync.watch("p1", grid, (p) => seen.push(p));
    sync.save("p1", { ...board(ONE_LINE, 90_000), assisted: true });
    await timers.runAll();
    // Solved stays; the hint seen on this device still marks it assisted.
    expect(seen).toEqual([{ ...board(SOLVED, 60_000), assisted: true }]);
    expect(readSaved(storage, key("p1"))).toMatchObject({ edges: SOLVED, solved: true });
  });

  test("failed saves stay marked and are sent again after a wait", async () => {
    const { server, sync, timers, unsynced } = setup();
    server.down = true;
    sync.save("p1", board(ONE_LINE, 1000));
    await timers.runAll();
    expect(unsynced()).toEqual(["p1"]);
    expect(timers.pending().map((j) => j.ms)).toEqual([RETRY_MS[0]]);
    await timers.runAll();
    expect(timers.pending().map((j) => j.ms)).toEqual([RETRY_MS[1]]);
    server.down = false;
    await timers.runAll();
    expect(unsynced()).toEqual([]);
    expect(server.records.get("p1")?.edges).toBe(ONE_LINE);
    expect(timers.pending()).toEqual([]);
  });

  test("a 401 or 403 reports the lost login and keeps the save", async () => {
    const { server, sync, timers, unsynced, authLost } = setup();
    server.status = 403;
    sync.save("p1", board(ONE_LINE, 1000));
    await timers.runAll();
    expect(authLost()).toBe(1);
    expect(unsynced()).toEqual(["p1"]);
    expect(timers.pending()).toEqual([]);
  });

  test("a board the server refuses outright is not sent again", async () => {
    const { sync, timers, unsynced } = setup();
    sync.save("gone", board(ONE_LINE, 1000));
    await timers.runAll();
    expect(unsynced()).toEqual([]);
  });

  test("flush sends unsent saves now, in requests that outlive the page", async () => {
    const { server, sync, timers } = setup();
    sync.save("p1", board(ONE_LINE, 1000));
    sync.flush();
    await settle();
    expect(server.requests.map((r) => [r.method, r.keepalive])).toEqual([["PUT", true]]);
    expect(timers.pending()).toEqual([]);
  });

  test("pushPending sends every unsent save", async () => {
    const { server, sync, timers } = setup();
    server.down = true;
    sync.save("p1", board(ONE_LINE, 1));
    sync.save("p2", board(TWO_LINES, 2));
    await timers.runAll();
    server.down = false;
    await sync.pushPending();
    expect([...server.records.keys()].sort()).toEqual(["p1", "p2"]);
  });
});

describe("progress sync: one request per puzzle", () => {
  test("a save made while another is out goes after it, so the newest board ends up stored", async () => {
    const { server, storage, sync, timers, key, unsynced } = setup();
    server.hold = "PUT";
    sync.save("p1", board(ONE_LINE, 1000));
    await timers.runAll();
    sync.save("p1", board(TWO_LINES, 2000));
    sync.flush(); // leaves it to the running request
    void sync.pushPending();
    await settle();
    expect(server.requests.filter((r) => r.method === "PUT")).toHaveLength(1);
    // Answer whatever is waiting, newest first, until nothing is left.
    while (server.held.length > 0) {
      for (const release of server.held.splice(0).reverse()) release();
      await settle();
    }
    expect(server.records.get("p1")).toMatchObject({ edges: TWO_LINES, version: 2 });
    expect(readSaved(storage, key("p1"))).toMatchObject({ edges: TWO_LINES, version: 2 });
    expect(unsynced()).toEqual([]);
  });

  test("opening a puzzle doesn't wait forever on a save the server never answers", async () => {
    const { server, storage, sync, key, unsynced } = setup();
    storage.setItem(key("p1"), JSON.stringify({ v: 1, edges: ONE_LINE, elapsedMs: 5 }));
    storage.setItem("loophole:user:u1:unsynced", '["p1"]');
    server.hang = true;
    expect(await sync.load("p1", grid)).toEqual(board(ONE_LINE, 5));
    expect(unsynced()).toEqual(["p1"]);
  });

  test("refresh ignores an answer older than a save made while it was out", async () => {
    const { server, sync, timers } = setup();
    server.records.set("p1", record(ONE_LINE, 1000));
    await sync.load("p1", grid);
    const seen: unknown[] = [];
    sync.watch("p1", grid, (p) => seen.push(p));
    server.hold = "GET";
    const refreshing = sync.refresh("p1");
    await settle();
    sync.save("p1", board(TWO_LINES, 2000));
    await timers.runAll();
    expect(server.records.get("p1")?.edges).toBe(TWO_LINES);
    for (const release of server.held.splice(0)) release();
    await refreshing;
    expect(seen).toEqual([]);
    expect(sync.peek("p1", grid)).toEqual(board(TWO_LINES, 2000));
  });

  test("a first save of an empty board is skipped; later empty boards are moves", async () => {
    const { server, storage, sync, timers, key } = setup();
    sync.save("p1", board("000000000000", 5000));
    expect(storage.data.has(key("p1"))).toBe(false);
    expect(timers.pending()).toEqual([]);
    sync.save("p1", board(ONE_LINE, 6000));
    sync.save("p1", board("000000000000", 7000));
    await timers.runAll();
    expect(server.records.get("p1")?.edges).toBe("000000000000");
  });
});

describe("progress sync: start over, refresh and import", () => {
  test("clear deletes on the server; offline, the delete goes before later saves", async () => {
    const { server, storage, sync, timers, key } = setup();
    server.records.set("p1", record(SOLVED, 5000));
    await sync.load("p1", grid);
    server.down = true;
    sync.clear("p1");
    sync.save("p1", board(ONE_LINE, 100));
    await timers.runAll();
    expect(storage.data.get("loophole:user:u1:deleting")).toBe('["p1"]');
    server.down = false;
    server.requests.length = 0;
    await sync.pushPending();
    expect(server.requests.map((r) => r.method)).toEqual(["DELETE", "PUT"]);
    expect(server.records.get("p1")).toMatchObject({ edges: ONE_LINE, version: 1 });
    expect(storage.data.has("loophole:user:u1:deleting")).toBe(false);
    expect(readSaved(storage, key("p1"))?.edges).toBe(ONE_LINE);
  });

  test("refresh tells the watchers only when the server's board differs", async () => {
    const { server, sync } = setup();
    server.records.set("p1", record(ONE_LINE, 1000));
    await sync.load("p1", grid);
    const seen: unknown[] = [];
    sync.watch("p1", grid, (p) => seen.push(p));
    await sync.refresh("p1");
    expect(seen).toEqual([]);
    server.records.set("p1", record(TWO_LINES, 8000, 2));
    await sync.refresh("p1");
    server.records.delete("p1");
    await sync.refresh("p1");
    expect(seen).toEqual([board(TWO_LINES, 8000), null]);
  });

  test("importGuest saves as a new device, so the account keeps a board it has", async () => {
    const { server, sync } = setup();
    server.records.set("p2", record(TWO_LINES, 9000));
    const saved = { edges: ONE_LINE, elapsedMs: 5000, solved: false, assisted: false, version: 7 };
    expect(await sync.importGuest("p1", saved)).toBe("imported");
    expect(server.requests.at(-1)?.body).toMatchObject({ baseVersion: null });
    expect(server.requests.at(-1)?.body).not.toMatchObject({ device: "this" });
    // A repeat finds the same board there: nothing changes, not even its version.
    expect(await sync.importGuest("p1", saved)).toBe("imported");
    expect(server.records.get("p1")?.version).toBe(1);
    expect(await sync.importGuest("p2", saved)).toBe("kept");
    expect(await sync.importGuest("p3", { ...saved, edges: SOLVED })).toBe("imported");
    expect(await sync.importGuest("gone", saved)).toBe("skipped");
    server.down = true;
    expect(await sync.importGuest("p4", saved)).toBe("failed");
    expect(sync.peek("p2", grid)).toEqual(board(TWO_LINES, 9000));
  });

  test("list gives the unsolved puzzles, or nothing offline", async () => {
    const { server, sync } = setup();
    server.records.set("p1", record(ONE_LINE, 1000));
    server.records.set("p2", record(SOLVED, 1000));
    expect((await sync.list()).map((s) => s.puzzleId)).toEqual(["p1"]);
    server.down = true;
    expect(await sync.list()).toEqual([]);
  });

  test("forgetSynced keeps only the account's unsent saves", () => {
    const storage = memoryStorage();
    storage.setItem("loophole:user:u1:progress:p1", "x");
    storage.setItem("loophole:user:u1:progress:p2", "x");
    storage.setItem("loophole:user:u1:progress:p3", "x");
    storage.setItem("loophole:user:u1:unsynced", '["p2"]');
    storage.setItem("loophole:user:u1:deleting", '["p3"]');
    storage.setItem("loophole:user:u2:progress:p1", "x");
    forgetSynced(storage, "u1");
    expect([...storage.data.keys()].sort()).toEqual([
      "loophole:user:u1:deleting",
      "loophole:user:u1:progress:p2",
      "loophole:user:u1:progress:p3",
      "loophole:user:u1:unsynced",
      "loophole:user:u2:progress:p1",
    ]);
  });

  test("forgetUser removes one account's keys and nothing else", () => {
    const storage = memoryStorage();
    storage.setItem("loophole:user:u1:progress:p1", "x");
    storage.setItem("loophole:user:u1:unsynced", "[]");
    storage.setItem("loophole:user:u2:progress:p1", "x");
    storage.setItem("loophole:progress:p1", "x");
    forgetUser(storage, "u1");
    expect([...storage.data.keys()].sort()).toEqual([
      "loophole:progress:p1",
      "loophole:user:u2:progress:p1",
    ]);
  });
});
````


4.6 Create `apps/web/src/lib/sync/guest.ts` with exactly this content:

````ts
import { progressKey } from "../game/progress.ts";
import { type ListableStorage, readSaved, type SavedBoard } from "./sync.ts";

const GUEST_PREFIX = progressKey("");

export interface GuestSave {
  readonly puzzleId: string;
  readonly saved: SavedBoard;
}

/**
 * Guest saves in this browser that an account could take: readable ones with at least one mark,
 * for puzzles the server may hold (not the built-in ones, whose progress stays on the device).
 */
export function guestSaves(
  storage: ListableStorage | null,
  isBuiltIn: (id: string) => boolean,
): GuestSave[] {
  if (storage === null) return [];
  const found: GuestSave[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === null || !key.startsWith(GUEST_PREFIX)) continue;
      const puzzleId = key.slice(GUEST_PREFIX.length);
      if (puzzleId === "" || isBuiltIn(puzzleId)) continue;
      const saved = readSaved(storage, key);
      if (saved !== null && /[12]/.test(saved.edges)) found.push({ puzzleId, saved });
    }
  } catch {
    return [];
  }
  return found.sort((a, b) => a.puzzleId.localeCompare(b.puzzleId));
}

export interface ImportSummary {
  /** The guest's board is now the account's. */
  readonly imported: number;
  /** The account already had a board for the puzzle, and kept it (the guest's wasn't solved). */
  readonly kept: number;
  /** The server no longer has the puzzle, or refused the board. */
  readonly skipped: number;
  /** Stopped early because the server couldn't be reached; the rest stay for another try. */
  readonly failed: boolean;
}

/**
 * Brings this browser's guest saves into the account, one at a time, after the player asked to.
 * Each save leaves guest storage once the server has decided on it, so running this again only
 * sends what is left; the server's rules make a repeat harmless anyway.
 */
export async function importGuestSaves(
  importOne: (
    puzzleId: string,
    saved: SavedBoard,
  ) => Promise<"imported" | "kept" | "skipped" | "failed">,
  storage: ListableStorage | null,
  isBuiltIn: (id: string) => boolean,
): Promise<ImportSummary> {
  const counts = { imported: 0, kept: 0, skipped: 0 };
  for (const { puzzleId, saved } of guestSaves(storage, isBuiltIn)) {
    const outcome = await importOne(puzzleId, saved);
    if (outcome === "failed") return { ...counts, failed: true };
    counts[outcome]++;
    try {
      storage?.removeItem(progressKey(puzzleId));
    } catch {
      // Left behind; the next import sends it again, harmlessly.
    }
  }
  return { ...counts, failed: false };
}
````


4.7 Create `apps/web/src/lib/sync/guest.test.ts` with exactly this content:

````ts
import { describe, expect, test } from "bun:test";
import { memoryStorage } from "../test-support/memory-storage.ts";
import { guestSaves, importGuestSaves } from "./guest.ts";
import type { ImportOutcome, SavedBoard } from "./sync.ts";

const isBuiltIn = (id: string) => id === "small-7";

function storageWith(entries: Record<string, unknown>) {
  const storage = memoryStorage();
  for (const [key, value] of Object.entries(entries)) {
    storage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  return storage;
}

const save = (edges: string, elapsedMs = 1000) => ({ v: 1, edges, elapsedMs, solved: false });

describe("guest saves", () => {
  test("lists readable guest saves with marks, of server puzzles only", () => {
    const storage = storageWith({
      "loophole:progress:b": save("1000", 2000),
      "loophole:progress:a": { ...save("2000"), assisted: true },
      "loophole:progress:small-7": save("1000"),
      "loophole:progress:broken": "not json",
      "loophole:progress:blank": save("0000"),
      "loophole:user:u1:progress:c": save("1000"),
      "loophole:theme": "dark",
    });
    expect(guestSaves(storage, isBuiltIn)).toEqual([
      {
        puzzleId: "a",
        saved: { edges: "2000", elapsedMs: 1000, solved: false, assisted: true, version: null },
      },
      {
        puzzleId: "b",
        saved: { edges: "1000", elapsedMs: 2000, solved: false, assisted: false, version: null },
      },
    ]);
    expect(guestSaves(null, isBuiltIn)).toEqual([]);
  });

  test("import sends each save once and removes it from guest storage", async () => {
    const storage = storageWith({
      "loophole:progress:a": save("1000"),
      "loophole:progress:b": save("2000"),
      "loophole:progress:c": save("0001"),
      "loophole:progress:small-7": save("1000"),
    });
    const outcomes: Record<string, ImportOutcome> = { a: "imported", b: "kept", c: "skipped" };
    const sent: string[] = [];
    const importOne = async (id: string, _saved: SavedBoard) => {
      sent.push(id);
      return outcomes[id];
    };
    expect(await importGuestSaves(importOne, storage, isBuiltIn)).toEqual({
      imported: 1,
      kept: 1,
      skipped: 1,
      failed: false,
    });
    expect(sent).toEqual(["a", "b", "c"]);
    expect([...storage.data.keys()]).toEqual(["loophole:progress:small-7"]);
    // Running it again has nothing left to send.
    expect(await importGuestSaves(importOne, storage, isBuiltIn)).toMatchObject({ imported: 0 });
    expect(sent).toHaveLength(3);
  });

  test("stops at the first failure and keeps the rest for another try", async () => {
    const storage = storageWith({
      "loophole:progress:a": save("1000"),
      "loophole:progress:b": save("2000"),
    });
    const importOne = async (id: string) => (id === "a" ? "imported" : "failed") as ImportOutcome;
    expect(await importGuestSaves(importOne, storage, isBuiltIn)).toEqual({
      imported: 1,
      kept: 0,
      skipped: 0,
      failed: true,
    });
    expect([...storage.data.keys()]).toEqual(["loophole:progress:b"]);
  });
});
````


4.8 Create `apps/web/src/lib/sync/saves.ts` with exactly this content:

````ts
import type { Grid } from "@loophole/core";
import type { Readable } from "svelte/store";
import type { AuthState } from "../auth/auth.ts";
import type { Progress, ProgressStore } from "../game/progress.ts";
import type { ProgressSync, RemoteListener } from "./sync.ts";

/** Resolves with the auth state once it is known (not "loading"). */
export function settled(auth: Readable<AuthState>): Promise<AuthState> {
  return new Promise((resolve) => {
    let done = false;
    let unsubscribe: (() => void) | undefined;
    unsubscribe = auth.subscribe((state) => {
      if (done || state.status === "loading") return;
      done = true;
      resolve(state);
      unsubscribe?.();
    });
    if (done) unsubscribe();
  });
}

/** Saving and restoring one puzzle's progress for the play screen. */
export interface PuzzleSaves {
  /** After `load`: true when saves go to the account, false when they stay on this device. */
  readonly synced: boolean;
  load(): Promise<Progress | null>;
  save(progress: Progress): void;
  clear(): void;
  /** The page is going away or out of sight: send unsent saves now. */
  flush(): void;
  /** The page is back in sight: pick up a newer board from another device. */
  refresh(): void;
  close(): void;
}

export interface SavesDeps {
  /** The logged-in account's sync once auth is known, or null for a guest. */
  readonly account: () => Promise<ProgressSync | null>;
  readonly guest: ProgressStore;
  readonly isBuiltIn: (id: string) => boolean;
}

/**
 * Where a puzzle's progress goes: built-in puzzles and guests use this device's guest store, as
 * before; a logged-in player's server puzzles sync with the account. Nothing is saved until
 * `load` has resolved, so a screen left early can't write an empty board anywhere.
 */
export function openSaves(
  deps: SavesDeps,
  puzzleId: string,
  grid: Grid,
  onremote: RemoteListener,
): PuzzleSaves {
  let sync: ProgressSync | null = null;
  let loaded = false;
  let closed = false;
  let unwatch = () => {};
  return {
    get synced() {
      return sync !== null;
    },
    async load() {
      if (!deps.isBuiltIn(puzzleId)) sync = await deps.account();
      loaded = true;
      if (sync === null) return deps.guest.load(puzzleId, grid);
      if (!closed) unwatch = sync.watch(puzzleId, grid, onremote);
      return sync.load(puzzleId, grid);
    },
    save(progress) {
      if (!loaded) return;
      if (sync === null) deps.guest.save(puzzleId, progress);
      else sync.save(puzzleId, progress);
    },
    clear() {
      if (!loaded) return;
      if (sync === null) deps.guest.clear(puzzleId);
      else sync.clear(puzzleId);
    },
    flush() {
      if (loaded) sync?.flush();
    },
    refresh() {
      if (loaded && !closed) void sync?.refresh(puzzleId);
    },
    close() {
      closed = true;
      unwatch();
    },
  };
}
````


4.9 Create `apps/web/src/lib/sync/saves.test.ts` with exactly this content:

````ts
import { describe, expect, test } from "bun:test";
import { createGrid } from "@loophole/core";
import { writable } from "svelte/store";
import type { AuthState } from "../auth/auth.ts";
import { createProgressStore, type Progress } from "../game/progress.ts";
import { memoryStorage } from "../test-support/memory-storage.ts";
import { openSaves, settled } from "./saves.ts";
import type { ProgressSync } from "./sync.ts";

const grid = createGrid(2, 2);
const progress: Progress = {
  edges: new Uint8Array(12).fill(1, 0, 1),
  elapsedMs: 1000,
  solved: false,
  assisted: false,
};

/** Records the calls a saves handle makes on the account's sync. */
function fakeSync() {
  const calls: string[] = [];
  const sync = {
    userId: "u1",
    load: async (id: string) => {
      calls.push(`load ${id}`);
      return progress;
    },
    save: (id: string) => calls.push(`save ${id}`),
    clear: (id: string) => calls.push(`clear ${id}`),
    flush: () => calls.push("flush"),
    refresh: async (id: string) => {
      calls.push(`refresh ${id}`);
    },
    watch: (id: string) => {
      calls.push(`watch ${id}`);
      return () => calls.push(`unwatch ${id}`);
    },
  } as unknown as ProgressSync;
  return { sync, calls };
}

function setup(loggedIn: boolean) {
  const storage = memoryStorage();
  const guest = createProgressStore(storage);
  const { sync, calls } = fakeSync();
  const deps = {
    account: async () => (loggedIn ? sync : null),
    guest,
    isBuiltIn: (id: string) => id === "small-7",
  };
  return { storage, guest, calls, deps };
}

describe("openSaves", () => {
  test("a logged-in player's server puzzle syncs with the account", async () => {
    const { deps, calls, storage } = setup(true);
    const saves = openSaves(deps, "p1", grid, () => {});
    saves.save(progress); // before load: ignored
    expect(await saves.load()).toEqual(progress);
    expect(saves.synced).toBe(true);
    saves.save(progress);
    saves.flush();
    saves.refresh();
    saves.clear();
    saves.close();
    expect(calls).toEqual([
      "watch p1",
      "load p1",
      "save p1",
      "flush",
      "refresh p1",
      "clear p1",
      "unwatch p1",
    ]);
    expect(storage.data.size).toBe(0);
  });

  test("guests and built-in puzzles use the guest store", async () => {
    for (const [loggedIn, id] of [
      [false, "p1"],
      [true, "small-7"],
    ] as const) {
      const { deps, calls, guest } = setup(loggedIn);
      guest.save(id, progress);
      const saves = openSaves(deps, id, grid, () => {});
      expect(await saves.load()).toEqual(progress);
      expect(saves.synced).toBe(false);
      saves.clear();
      expect(guest.load(id, grid)).toBeNull();
      expect(calls).toEqual([]);
    }
  });
});

describe("settled", () => {
  test("waits for the first answer that isn't loading", async () => {
    const store = writable<AuthState>({ status: "loading" });
    const result = settled(store);
    store.set({ status: "guest" });
    expect(await result).toEqual({ status: "guest" });
    expect(await settled(store)).toEqual({ status: "guest" });
  });
});
````


4.10 App wiring: one sync per logged-in account, the device id, and the functions the components call. It is not unit-tested, like `auth/index.ts`; the end-to-end tests cover it. Create `apps/web/src/lib/sync/index.ts` with exactly this content:

````ts
import { createApiClient, type Schemas } from "@loophole/api-client";
import type { Grid } from "@loophole/core";
import type { AuthState } from "../auth/auth.ts";
import { auth } from "../auth/index.ts";
import { browserStorage, createProgressStore, type Progress } from "../game/progress.ts";
import { isBuiltIn } from "../puzzles/fixtures.ts";
import { guestSaves, type ImportSummary, importGuestSaves } from "./guest.ts";
import { openSaves as open, type PuzzleSaves, settled } from "./saves.ts";
import {
  createProgressSync,
  forgetSynced,
  forgetUser,
  type ProgressSync,
  type RemoteListener,
} from "./sync.ts";

export type { PuzzleSaves } from "./saves.ts";

// The app's saved progress: guest storage for guests and built-in puzzles, and for a logged-in
// player one ProgressSync, replaced whenever the logged-in account changes.

const client = createApiClient();
const storage = browserStorage();
const guest = createProgressStore(storage);
let current: ProgressSync | null = null;

/** A random id for this browser, kept in storage (a new one per page if storage is blocked). */
function deviceId(): string {
  const key = "loophole:device";
  try {
    const id = storage?.getItem(key);
    if (id) return id;
    const fresh = crypto.randomUUID();
    storage?.setItem(key, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}
const device = deviceId();

function syncFor(state: AuthState): ProgressSync | null {
  if (state.status !== "user") {
    current?.close();
    current = null;
    return null;
  }
  if (current?.userId !== state.user.id) {
    current?.close();
    current = createProgressSync({
      client,
      storage,
      userId: state.user.id,
      device,
      // The session ended or changed in another tab: find out who is logged in now.
      onAuthLost: () => void auth.refresh(),
    });
  }
  return current;
}

// Saves made offline, or before a page closed, go out once the account is known again.
auth.subscribe((state) => {
  if (state.status !== "loading") void syncFor(state)?.pushPending();
});
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void current?.pushPending());
}

async function account(): Promise<ProgressSync | null> {
  return syncFor(await settled(auth));
}

/** Saving and restoring one puzzle for the play screen. */
export function openSaves(puzzleId: string, grid: Grid, onremote: RemoteListener): PuzzleSaves {
  return open({ account, guest, isBuiltIn }, puzzleId, grid, onremote);
}

/** The progress on this device for the puzzle list: the account's copy, or the guest's. */
export async function localProgress(puzzleId: string, grid: Grid): Promise<Progress | null> {
  const sync = isBuiltIn(puzzleId) ? null : await account();
  return sync === null ? guest.load(puzzleId, grid) : sync.peek(puzzleId, grid);
}

/** The logged-in account's unsolved puzzles from the server; empty for guests or offline. */
export async function inProgress(): Promise<Schemas["ProgressSummary"][]> {
  return (await account())?.list() ?? [];
}

/** How many guest saves in this browser could be brought into an account. */
export function importableGuestSaves(): number {
  return guestSaves(storage, isBuiltIn).length;
}

/**
 * Brings this browser's guest saves into the account logged in as `userId`, only when the player
 * asks. Refuses if that is no longer who is logged in.
 */
export async function importGuestProgress(userId: string): Promise<ImportSummary> {
  const sync = await account();
  if (sync === null || sync.userId !== userId) {
    return { imported: 0, kept: 0, skipped: 0, failed: true };
  }
  return importGuestSaves((id, saved) => sync.importGuest(id, saved), storage, isBuiltIn);
}

/** After logout: drops this browser's copy of the account's synced boards, keeping unsent saves. */
export function forgetSyncedProgress(userId: string): void {
  if (current?.userId === userId) {
    current.close();
    current = null;
  }
  forgetSynced(storage, userId);
}

/** Removes this device's copy of a deleted account's progress (NFR-6). */
export function forgetAccount(userId: string): void {
  if (current?.userId === userId) {
    current.close();
    current = null;
  }
  forgetUser(storage, userId);
}
````


Verify:

```sh
bun run format && bun test apps/web/src/lib && bun run --cwd apps/web typecheck && bun run lint
```

Expect `0 fail` (one `console.warn` line, "Progress for gone was refused (HTTP 404)", is expected) and `0 ERRORS 0 WARNINGS`. Commit: `feat(web): add the progress sync module`

### Step 5. Play screen

The play screen opens a saves handle instead of the guest store. The load is now asynchronous (for a server puzzle it waits for the auth store and the server), so `ready` turns true when it resolves, and `save()` does nothing before then. The changes, in order of the edits:

- imports;
- state for `synced` and `remoteNote`;
- the `save` guard;
- clearing the note on a move;
- `adopt` (takes a board the sync hands over; un-pauses if that board is solved, since a solved board can't be resumed);
- Start over;
- the asynchronous load;
- flushing on hide and pagehide, and refreshing when visible again;
- the solved card text;
- the note.

Edit `apps/web/src/lib/components/PlayScreen.svelte` (each find text occurs once):

1. Find:

````svelte
  import { type Command, screenCommand } from "../game/keyboard.ts";
  import { violationMessages } from "../game/messages.ts";
  import { browserStorage, createProgressStore, type ProgressStore } from "../game/progress.ts";
  import {
    createStopwatch,
````

   Replace with:

````svelte
  import { type Command, screenCommand } from "../game/keyboard.ts";
  import { violationMessages } from "../game/messages.ts";
  import type { Progress } from "../game/progress.ts";
  import {
    createStopwatch,
````

2. Find:

````svelte
  import { clampView, type View, viewLayout, zoomLimits } from "../game/viewport.ts";
  import { type PuzzleEntry, puzzleSource, puzzleTitle } from "../puzzles/index.ts";
  import BoardView from "./BoardView.svelte";
  import HintCard from "./HintCard.svelte";
````

   Replace with:

````svelte
  import { clampView, type View, viewLayout, zoomLimits } from "../game/viewport.ts";
  import { type PuzzleEntry, puzzleSource, puzzleTitle } from "../puzzles/index.ts";
  import { openSaves, type PuzzleSaves } from "../sync/index.ts";
  import BoardView from "./BoardView.svelte";
  import HintCard from "./HintCard.svelte";
````

3. Find:

````svelte
  let paused = $state(false);
  let ready = $state(false);
  let store: ProgressStore | null = null;
  let boardView: { focus(): void } | undefined = $state();
````

   Replace with:

````svelte
  let paused = $state(false);
  let ready = $state(false);
  let saves: PuzzleSaves | null = null;
  // Whether progress goes to the account (logged in, server puzzle) or stays on this device.
  let synced = $state(false);
  // The board was just replaced with a newer one saved on another device.
  let remoteNote = $state(false);
  let boardView: { focus(): void } | undefined = $state();
````

4. Find:

````svelte

  function save() {
    store?.save(entry.id, {
      edges: board.edges,
      elapsedMs: elapsed(watch, performance.now()),
````

   Replace with:

````svelte

  function save() {
    if (!ready) return;
    saves?.save({
      edges: board.edges,
      elapsedMs: elapsed(watch, performance.now()),
````

5. Find:

````svelte
    board = next;
    hintFailed = false;
    save();
  }
````

   Replace with:

````svelte
    board = next;
    hintFailed = false;
    remoteNote = false;
    save();
  }
````

6. Find:

````svelte
  }

  // Pausing unmounts the board, so after it remounts (on resume or start over) focus goes back to
  // it, and keyboard players keep their place.
````

   Replace with:

````svelte
  }

  // Another device saved further, or the server kept a solved board: show that board instead.
  // Usually this happens while paused, when the tab comes back into sight.
  function adopt(saved: Progress | null) {
    if (!ready || destroyed) return;
    board = createBoard(grid.edgeCount, saved?.edges);
    lastEdit = undefined;
    hint = null;
    hintOpen = false;
    assisted = saved?.assisted ?? false;
    now = performance.now();
    watch = createStopwatch(saved?.elapsedMs ?? 0);
    const done = analyzeBoard(puzzle, board.edges).solved;
    if (done) paused = false;
    else if (!paused) watch = start(watch, now);
    remoteNote = true;
  }

  // Pausing unmounts the board, so after it remounts (on resume or start over) focus goes back to
  // it, and keyboard players keep their place.
````

7. Find:

````svelte

  function startOver() {
    store?.clear(entry.id);
    board = createBoard(grid.edgeCount);
    now = performance.now();
````

   Replace with:

````svelte

  function startOver() {
    saves?.clear();
    remoteNote = false;
    board = createBoard(grid.edgeCount);
    now = performance.now();
````

8. Find:

````svelte
    };
    wideQuery.addEventListener("change", onwide);
    store = createProgressStore(browserStorage());
    const saved = store.load(entry.id, grid);
    if (saved !== null) {
      board = createBoard(grid.edgeCount, saved.edges);
      watch = createStopwatch(saved.elapsedMs);
      assisted = saved.assisted;
    }
    now = performance.now();
    if (!analyzeBoard(puzzle, board.edges).solved) watch = start(watch, now);
    ready = true;

    const tick = setInterval(() => {
````

   Replace with:

````svelte
    };
    wideQuery.addEventListener("change", onwide);
    const opened = openSaves(entry.id, grid, adopt);
    saves = opened;
    opened.load().then((saved) => {
      if (destroyed) return;
      if (saved !== null) {
        board = createBoard(grid.edgeCount, saved.edges);
        watch = createStopwatch(saved.elapsedMs);
        assisted = saved.assisted;
      }
      synced = opened.synced;
      now = performance.now();
      if (!analyzeBoard(puzzle, board.edges).solved) watch = start(watch, now);
      ready = true;
    });

    const tick = setInterval(() => {
````

9. Find:

````svelte
    }, 250);
    // Leaving the tab pauses the clock (and hides the board) and saves, since a phone may never
    // come back to this page.
    const onvisibility = () => {
      if (document.visibilityState === "hidden") {
        setPaused(true);
        save();
      }
    };
    document.addEventListener("visibilitychange", onvisibility);
    window.addEventListener("pagehide", save);
    return () => {
      clearInterval(tick);
      wideQuery.removeEventListener("change", onwide);
      document.removeEventListener("visibilitychange", onvisibility);
      window.removeEventListener("pagehide", save);
      save();
    };
  });
````

   Replace with:

````svelte
    }, 250);
    // Leaving the tab pauses the clock (and hides the board) and saves, since a phone may never
    // come back to this page. Coming back picks up a board saved meanwhile on another device.
    const onvisibility = () => {
      if (document.visibilityState === "hidden") {
        setPaused(true);
        save();
        saves?.flush();
      } else {
        saves?.refresh();
      }
    };
    const onpagehide = () => {
      save();
      saves?.flush();
    };
    document.addEventListener("visibilitychange", onvisibility);
    window.addEventListener("pagehide", onpagehide);
    return () => {
      clearInterval(tick);
      wideQuery.removeEventListener("change", onwide);
      document.removeEventListener("visibilitychange", onvisibility);
      window.removeEventListener("pagehide", onpagehide);
      save();
      saves?.flush();
      saves?.close();
    };
  });
````

10. Find:

````svelte
              <span class="solved-title">Solved in {clock}</span>
              {#if assisted}<span class="assisted">Hint used</span>{/if}
              <span class="soft">Saved on this device.</span>
            </div>
            <button type="button" class="primary" onclick={startOver}>Start over</button>
````

   Replace with:

````svelte
              <span class="solved-title">Solved in {clock}</span>
              {#if assisted}<span class="assisted">Hint used</span>{/if}
              <span class="soft">{synced ? "Saved to your account." : "Saved on this device."}</span>
            </div>
            <button type="button" class="primary" onclick={startOver}>Start over</button>
````

11. Find:

````svelte
        {:else if hintFailed}
          <p class="card hint-failed" role="status">Couldn't get a hint just now. Try again in a moment.</p>
        {:else if messages.length > 0}
          <div class="card errors" role="status">
````

   Replace with:

````svelte
        {:else if hintFailed}
          <p class="card hint-failed" role="status">Couldn't get a hint just now. Try again in a moment.</p>
        {:else if remoteNote}
          <p class="card hint-failed" role="status">Picked up your progress from another device.</p>
        {:else if messages.length > 0}
          <div class="card errors" role="status">
````


Verify:

```sh
bun run format && bun run check && bun run test:e2e
```

Expect `0 fail` and `57 passed` (the guest end-to-end tests need no API and must not change). Save the end-to-end output so failing test names are kept: `bun run test:e2e 2>&1 | tee /tmp/claude-1000/-home-jhonnold-projects-loophole/a34715f6-7810-5a69-ba81-edd46bda034d/scratchpad/progress-sync/e2e-step5.log`. Run it twice. See "Risks" if a run fails. Commit: `feat(web): sync play screen progress with the account`

### Step 6. Continue list and the guest import offer

6.1 Create `apps/web/src/lib/components/GuestImport.svelte` with exactly this content:

````svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { auth } from "../auth/index.ts";
  import { importableGuestSaves, importGuestProgress } from "../sync/index.ts";

  interface Props {
    /** Show a "Not now" button that hides the offer until the next visit. */
    dismissible?: boolean;
    /** Called after saves were brought in, so the page can show them. */
    onimported?: () => void;
  }

  let { dismissible = false, onimported }: Props = $props();

  // Guest progress joins an account only when the player asks, never by itself on login, so a
  // session they didn't mean to use can't take this browser's saves (DECISIONS).
  let count = $state(0);
  let busy = $state(false);
  let done = $state("");
  let error = $state("");
  let dismissed = $state(false);

  onMount(() => {
    count = importableGuestSaves();
  });

  function plural(n: number): string {
    return n === 1 ? "1 puzzle" : `${n} puzzles`;
  }

  async function bringIn(userId: string) {
    busy = true;
    error = "";
    const result = await importGuestProgress(userId);
    busy = false;
    count = importableGuestSaves();
    if (result.failed) {
      error = "Couldn't reach the server. Check your connection and try again.";
      return;
    }
    const added =
      result.imported > 0 ? `Added your progress on ${plural(result.imported)} to your account.` : "";
    const kept =
      result.kept > 0
        ? `Your account already had progress on ${plural(result.kept)}, so it kept its own.`
        : "";
    done = [added, kept].filter(Boolean).join(" ") || "Those puzzles are no longer available.";
    onimported?.();
  }
</script>

{#if $auth.status === "user" && !dismissed && (count > 0 || done)}
  {@const user = $auth.user}
  <section class="auth offer" aria-labelledby="offer-h">
    {#if done}
      <p class="done" role="status">{done}</p>
    {:else}
      <h2 id="offer-h">Progress from before you logged in</h2>
      <p>
        This browser has progress on {plural(count)} you played without an account. Add it to
        <b>{user.email}</b>? Where your account already has progress on a puzzle, it keeps its own unless
        this browser's is solved.
      </p>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="actions">
        <button class="primary" type="button" disabled={busy} onclick={() => bringIn(user.id)}>Add to my account</button>
        {#if dismissible}
          <button class="secondary" type="button" disabled={busy} onclick={() => (dismissed = true)}>Not now</button>
        {/if}
      </div>
    {/if}
  </section>
{/if}

<style>
  .offer {
    max-width: none;
    margin: 0 0 16px;
    padding: 14px 16px;
    border: 2px solid var(--ink);
    border-radius: 6px;
    background: var(--sheet);
  }

  .offer h2 {
    margin-top: 0;
  }

  .offer .done {
    margin: 0;
    padding: 0;
    border: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
</style>
````


6.2 Home page: device statuses through `localProgress`, the "Continue" list, the offer. Edit `apps/web/src/routes/+page.svelte` (each find text occurs once):

1. Find:

````svelte
<script lang="ts">
  import { createGrid } from "@loophole/core";
  import { onMount } from "svelte";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import { browserStorage, createProgressStore } from "$lib/game/progress.ts";
  import { formatClock } from "$lib/game/timer.ts";
  import type { PageProps } from "./$types";
````

   Replace with:

````svelte
<script lang="ts">
  import type { Schemas } from "@loophole/api-client";
  import { createGrid } from "@loophole/core";
  import { onMount } from "svelte";
  import GuestImport from "$lib/components/GuestImport.svelte";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import { formatClock } from "$lib/game/timer.ts";
  import { inProgress, localProgress } from "$lib/sync/index.ts";
  import type { PageProps } from "./$types";
````

2. Find:

````svelte
  type Status = { kind: "new" } | { kind: "playing" | "solved"; clock: string };
  let statuses: Record<string, Status> = $state({});

  onMount(() => {
    const store = createProgressStore(browserStorage());
    for (const p of data.puzzles) {
      const saved = store.load(p.id, createGrid(p.width, p.height));
      statuses[p.id] =
        saved === null
````

   Replace with:

````svelte
  type Status = { kind: "new" } | { kind: "playing" | "solved"; clock: string };
  let statuses: Record<string, Status> = $state({});
  // A logged-in player's unsolved puzzles from the server, so they can carry on from any device.
  let resume: Schemas["ProgressSummary"][] = $state([]);

  async function refresh() {
    for (const p of data.puzzles) {
      const saved = await localProgress(p.id, createGrid(p.width, p.height));
      statuses[p.id] =
        saved === null
````

3. Find:

````svelte
          : { kind: saved.solved ? "solved" : "playing", clock: formatClock(saved.elapsedMs) };
    }
  });

  // Pale cover tints per size class (design kit, Colour). Text on covers is always ink.
  function tint(width: number): string {
````

   Replace with:

````svelte
          : { kind: saved.solved ? "solved" : "playing", clock: formatClock(saved.elapsedMs) };
    }
    resume = await inProgress();
  }

  onMount(() => {
    refresh();
  });

  function nameOf(id: string): string {
    return data.puzzles.find((p) => p.id === id)?.name ?? "Puzzle";
  }

  // Pale cover tints per size class (design kit, Colour). Text on covers is always ink.
  function tint(width: number): string {
````

4. Find:

````svelte

<main class="page">
  <h1>Practice puzzles</h1>
  <ul class="covers">
````

   Replace with:

````svelte

<main class="page">
  <GuestImport dismissible onimported={refresh} />
  {#if resume.length > 0}
    <h2>Continue</h2>
    <ul class="resume">
      {#each resume as r (r.puzzleId)}
        <li>
          <a href="/play/{r.puzzleId}">
            <b>{nameOf(r.puzzleId)} · {r.width}×{r.height}</b>
            <span>In progress · {formatClock(r.elapsedMs)}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
  <h1>Practice puzzles</h1>
  <ul class="covers">
````

5. Find:

````svelte
  }

  .covers {
    list-style: none;
````

   Replace with:

````svelte
  }

  h2 {
    margin: 0 0 10px;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 22px;
  }

  .resume {
    list-style: none;
    margin: 0 0 20px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .resume a {
    min-height: 44px;
    padding: 8px 14px;
    border: 2px solid var(--ink);
    border-radius: 6px;
    background: var(--sheet);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 12px;
  }

  .resume span {
    font-size: 14px;
    color: var(--ink-soft);
  }

  .covers {
    list-style: none;
````


6.3 Account page: the offer; on logout, dropping this browser's synced boards (unsent ones stay); after deletion, dropping all of them (NFR-6). Edit `apps/web/src/routes/account/+page.svelte` (each find text occurs once):

1. Find:

````svelte
  import { goto } from "$app/navigation";
  import { auth } from "$lib/auth/index.ts";
  import SiteHeader from "$lib/components/SiteHeader.svelte";

  let resent = $state(false);
````

   Replace with:

````svelte
  import { goto } from "$app/navigation";
  import { auth } from "$lib/auth/index.ts";
  import GuestImport from "$lib/components/GuestImport.svelte";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import { forgetAccount, forgetSyncedProgress } from "$lib/sync/index.ts";

  let resent = $state(false);
````

2. Find:

````svelte
  }

  async function logOut() {
    logOutError = "";
    const result = await auth.logOut();
    if (result.ok) await goto("/");
    else logOutError = result.message;
  }

  async function deleteAccount(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
````

   Replace with:

````svelte
  }

  async function logOut(userId: string) {
    logOutError = "";
    const result = await auth.logOut();
    if (result.ok) {
      forgetSyncedProgress(userId);
      await goto("/");
    } else logOutError = result.message;
  }

  async function deleteAccount(event: SubmitEvent, userId: string) {
    event.preventDefault();
    busy = true;
````

3. Find:

````svelte
    const result = await auth.deleteAccount(password);
    busy = false;
    if (result.ok) await goto("/");
    else error = result.message;
  }
</script>
````

   Replace with:

````svelte
    const result = await auth.deleteAccount(password);
    busy = false;
    if (result.ok) {
      forgetAccount(userId);
      await goto("/");
    } else error = result.message;
  }
</script>
````

4. Find:

````svelte
      {/if}
    {/if}
    <p><button class="primary" type="button" onclick={logOut}>Log out</button></p>
    {#if logOutError}<p class="error" role="alert">{logOutError}</p>{/if}

    <h2>Delete account</h2>
    <p>
      This removes your email, password and everything saved for your account, for good. Progress
      saved in this browser stays.
    </p>
    <form onsubmit={deleteAccount}>
      <label>
        Password
````

   Replace with:

````svelte
      {/if}
    {/if}
    <GuestImport />
    <p><button class="primary" type="button" onclick={() => logOut(user.id)}>Log out</button></p>
    {#if logOutError}<p class="error" role="alert">{logOutError}</p>{/if}

    <h2>Delete account</h2>
    <p>
      This removes your email, password and everything saved for your account, for good, including
      this browser's copy of it. Progress you saved here without an account stays.
    </p>
    <form onsubmit={(e) => deleteAccount(e, user.id)}>
      <label>
        Password
````


Verify:

```sh
bun run format && bun run check && bun run test:e2e
```

Expect `0 fail` and `57 passed`. Commit: `feat(web): continue list and opt-in guest progress import`

### Step 7. Progress end-to-end test

7.1 The auth config now starts the worker beside the API on a shared database file, with Garage's dev keys. Playwright stops both: it kills the command's process group. Edit `apps/web/playwright.auth.config.ts` (each find text occurs once):

1. Find:

````ts
import { defineConfig } from "@playwright/test";

// End-to-end test of accounts against the real API, which also serves the built app (as in
// production). Needs Mailpit (`docker compose up -d`) and access to Cloudflare's Turnstile check;
// the test skips itself without them. Run with `bun run test:e2e:auth` from this package.
export default defineConfig({
  testDir: "tests",
````

   Replace with:

````ts
import { defineConfig } from "@playwright/test";

// End-to-end tests of accounts and saved progress against the real API, which also serves the
// built app (as in production), with a job worker beside it. They need access to Cloudflare's
// Turnstile check; the account test also needs Mailpit and the progress test Garage
// (`docker compose up -d`, then `scripts/garage-init.sh`). Each test skips itself without what it
// needs. Run with `bun run test:e2e:auth` from this package.
export default defineConfig({
  testDir: "tests",
````

2. Find:

````ts
  },
  webServer: {
    // From the repo root, like the other server scripts.
    command: "bun run build && cd ../.. && bun apps/server/src/api/main.ts",
    url: "http://localhost:4174/api/health",
    reuseExistingServer: false,
````

   Replace with:

````ts
  },
  webServer: {
    // From the repo root, like the other server scripts. The worker generates the puzzles the
    // progress test plays; Playwright stops it with the API.
    command:
      "bun run build && cd ../.. && rm -f data/e2e-auth.sqlite* && (bun apps/server/src/worker/main.ts & bun apps/server/src/api/main.ts)",
    url: "http://localhost:4174/api/health",
    reuseExistingServer: false,
````

3. Find:

````ts
      PORT: "4174",
      WEB_DIR: "apps/web/build",
      // A fresh database for every run, gone when the server stops.
      DATABASE_PATH: ":memory:",
      PUBLIC_URL: "http://localhost:4174",
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
````

   Replace with:

````ts
      PORT: "4174",
      WEB_DIR: "apps/web/build",
      // A fresh database for every run, shared by the API and the worker.
      DATABASE_PATH: "data/e2e-auth.sqlite",
      PUBLIC_URL: "http://localhost:4174",
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
````

4. Find:

````ts
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
````

   Replace with:

````ts
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
````


7.2 Create `apps/web/tests/progress.auth-e2e.ts` with exactly this content:

````ts
import { createGrid, hEdgeIndex } from "@loophole/core";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { board, edgePoint, lines, savedLines } from "./board.ts";

const PASSWORD = "hunter22-e2e";
/** Turnstile's test secret (set in the config) accepts this token. */
const CAPTCHA_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const grid = createGrid(5, 5);

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

test.beforeAll(async () => {
  // The worker keeps generated solutions in Garage; sign-up checks the CAPTCHA with Cloudflare.
  test.skip(
    !(await reachable("http://localhost:3903/health")) ||
      !(await reachable("https://challenges.cloudflare.com/turnstile/v0/siteverify")),
    "needs Garage (docker compose up -d, scripts/garage-init.sh) and access to challenges.cloudflare.com",
  );
});

/** A new account, made through the API. Its email stays unconfirmed, which is enough to sync. */
async function signUp(request: APIRequestContext): Promise<string> {
  const email = `e2e-${crypto.randomUUID()}@loophole.test`;
  const res = await request.post("/api/auth/signup", {
    data: { email, password: PASSWORD, captchaToken: CAPTCHA_TOKEN },
  });
  expect(res.status()).toBe(204);
  return email;
}

/** A fresh 5×5 puzzle from the API, generated by the worker. */
async function generatePuzzle(request: APIRequestContext): Promise<string> {
  const res = await request.post("/api/jobs/generate", { data: { width: 5, height: 5 } });
  expect(res.status()).toBe(202);
  const { id } = (await res.json()) as { id: string };
  let puzzleId = "";
  await expect
    .poll(
      async () => {
        const job = (await (await request.get(`/api/jobs/${id}`)).json()) as {
          status: string;
          result: { puzzleId: string } | null;
        };
        puzzleId = job.result?.puzzleId ?? "";
        return job.status;
      },
      { timeout: 30_000 },
    )
    .toBe("done");
  return puzzleId;
}

async function logIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Account" })).toBeVisible();
}

/** Waits until the play screen has loaded its progress: the board takes input from then on. */
async function boardReady(page: Page) {
  await expect(board(page)).toHaveAttribute("tabindex", "0");
}

/** Clicks horizontal edge (row, col) and waits until the server has the save. */
async function drawAndSync(page: Page, row: number, col: number) {
  await boardReady(page);
  const saved = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes("/progress/") && r.ok(),
  );
  const p = await edgePoint(page, grid, hEdgeIndex(grid, row, col));
  await page.mouse.click(p.x, p.y);
  await saved;
}

/** Hides and shows the tab, as switching apps on a phone does. */
async function hideAndShow(page: Page) {
  for (const state of ["hidden", "visible"]) {
    await page.evaluate((s) => {
      Object.defineProperty(document, "visibilityState", { value: s, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);
  }
}

test("progress follows the account to another browser (FR-21)", async ({
  page,
  browser,
  request,
}) => {
  const puzzleId = await generatePuzzle(request);
  const email = await signUp(request);

  await logIn(page, email);
  await page.goto(`/play/${puzzleId}`);
  await drawAndSync(page, 0, 0);
  await expect(lines(page)).toHaveCount(1);

  // Another browser, with nothing stored: the home page offers the puzzle, and it opens as left.
  const other = await (await browser.newContext()).newPage();
  await logIn(other, email);
  await other.getByRole("link", { name: /5×5.*In progress/ }).click();
  await expect(other).toHaveURL(`/play/${puzzleId}`);
  await expect(lines(other)).toHaveCount(1);
  await drawAndSync(other, 5, 4);
  await expect(lines(other)).toHaveCount(2);

  // Back on the first browser: coming back to the tab picks up the newer board.
  await hideAndShow(page);
  await page.getByRole("button", { name: "Resume" }).first().click();
  await expect(lines(page)).toHaveCount(2);
  await expect(page.getByText("Picked up your progress from another device.")).toBeVisible();
  await other.context().close();
});

test("guest progress joins the account only when asked (FR-21)", async ({
  page,
  browser,
  request,
}) => {
  const puzzleId = await generatePuzzle(request);
  const email = await signUp(request);

  await page.goto(`/play/${puzzleId}`);
  await boardReady(page);
  const p = await edgePoint(page, grid, hEdgeIndex(grid, 0, 0));
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => savedLines(page, puzzleId)).toBe(1);

  await logIn(page, email);
  await expect(
    page.getByRole("heading", { name: "Progress from before you logged in" }),
  ).toBeVisible();
  // Logging in alone doesn't move it: the account's board is still empty.
  const loaded = page.waitForResponse(
    (r) => r.request().method() === "GET" && r.url().includes(`/progress/${puzzleId}`),
  );
  await page.goto(`/play/${puzzleId}`);
  expect(await (await loaded).json()).toEqual({ progress: null });
  await expect(lines(page)).toHaveCount(0);

  await page.goto("/");
  await page.getByRole("button", { name: "Add to my account" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Added your progress on 1 puzzle to your account.",
  );
  expect(await savedLines(page, puzzleId)).toBe(0);

  const other = await (await browser.newContext()).newPage();
  await logIn(other, email);
  await other.goto(`/play/${puzzleId}`);
  await expect(lines(other)).toHaveCount(1);
  await other.context().close();
});
````


Verify (needs Docker):

```sh
docker compose up -d && ./scripts/garage-init.sh
bun run format && bun run --cwd apps/web typecheck
for i in 1 2 3; do bun run test:e2e:auth; done
pgrep -fa 'src/(api|worker)/main.ts' || echo "no servers left"
```

Expect `3 passed` on each of the three runs (the account test plus the two progress tests) and "no servers left". The progress tests wait for the board to take input (`tabindex="0"`) before every click, because the screen stays locked until its progress has loaded. Then stop Docker with `docker compose down` (not `-v`). Without Garage the two progress tests skip themselves, and without Mailpit the account test does, as before. Commit: `test(web): cross-device progress end-to-end test`

### Step 8. Docs

8.1 Edit `README.md` (each find text occurs once):

1. Find:

````markdown
## Status

Early development. The repo has the build tooling, the local dev services, the design kit, the puzzle engine (the grid model, the wire format, rule checks for play, a brute-force solution counter for tests, a seeded random number generator, a rule-based solver that records each deduction for hints, a verifier that says whether a puzzle has one solution, none, several, or could not be decided in time, and a generator that makes a puzzle with exactly one solution from a seed) and a first web app. The web app plays a few built-in puzzles on phones and desktops: tap or drag to draw, keyboard play, undo and redo, a pausable timer, error highlighting, solve detection, light and dark themes, and progress saved in the browser. A Hint button (or H) shows the next forced deduction from the player's board, with the rule's name, a one-line explanation and its pattern drawn small, or points out a mark that doesn't fit; using one marks the attempt as assisted. Boards too big for the screen zoom and pan (pinch, wheel or the zoom buttons) with an overview map, and boards over 30×30 draw on a canvas. The server has its foundation: an HTTP API that serves puzzles, gives hints from each puzzle's stored solution and queues generation jobs, and a worker that generates puzzles in the background with progress and a time limit, keeping each solution in blob storage. The web app lists the server's puzzles after its built-in ones. Players can sign up with an email and password (behind a CAPTCHA, with email confirmation), log in and out, reset a forgotten password and delete their account; guests play exactly as before. Daily puzzles and the rest come in later phases; each phase's plan is in [`docs/plans/`](docs/plans/).

## Quickstart
````

   Replace with:

````markdown
## Status

Early development. The repo has the build tooling, the local dev services, the design kit, the puzzle engine (the grid model, the wire format, rule checks for play, a brute-force solution counter for tests, a seeded random number generator, a rule-based solver that records each deduction for hints, a verifier that says whether a puzzle has one solution, none, several, or could not be decided in time, and a generator that makes a puzzle with exactly one solution from a seed) and a first web app. The web app plays a few built-in puzzles on phones and desktops: tap or drag to draw, keyboard play, undo and redo, a pausable timer, error highlighting, solve detection, light and dark themes, and progress saved in the browser. A Hint button (or H) shows the next forced deduction from the player's board, with the rule's name, a one-line explanation and its pattern drawn small, or points out a mark that doesn't fit; using one marks the attempt as assisted. Boards too big for the screen zoom and pan (pinch, wheel or the zoom buttons) with an overview map, and boards over 30×30 draw on a canvas. The server has its foundation: an HTTP API that serves puzzles, gives hints from each puzzle's stored solution and queues generation jobs, and a worker that generates puzzles in the background with progress and a time limit, keeping each solution in blob storage. The web app lists the server's puzzles after its built-in ones. Players can sign up with an email and password (behind a CAPTCHA, with email confirmation), log in and out, reset a forgotten password and delete their account; guests play exactly as before. Logged-in players' progress on server puzzles syncs to their account, so they can leave a puzzle on one device and carry on on another (a "Continue" list on the home page shows unsolved ones), and they can bring progress they saved as a guest into their account. Daily puzzles and the rest come in later phases; each phase's plan is in [`docs/plans/`](docs/plans/).

## Quickstart
````

2. Find:

````markdown
```

`bun run test:e2e:auth` builds the web app, starts the API serving it on port 4174 with a fresh database, and goes through sign-up, the emailed link, login and logout in Chromium. It needs Mailpit running and access to challenges.cloudflare.com, and skips itself without them.

## Scripts
````

   Replace with:

````markdown
```

`bun run test:e2e:auth` builds the web app, starts the API serving it on port 4174 with a fresh database (`data/e2e-auth.sqlite`) and a job worker beside it, and runs two tests in Chromium. The account test goes through sign-up, the emailed link, login and logout; it needs Mailpit. The progress test plays a generated puzzle in one browser and carries on in another, and brings a guest's progress into an account; it needs Garage (with `scripts/garage-init.sh` run once). Both need access to challenges.cloudflare.com, and each skips itself without what it needs.

### Saved progress

Guests' progress stays in the browser, as before. For a logged-in player, progress on server puzzles is kept in the browser under their account and sent to the API a couple of seconds after each change, and when the tab is hidden or closed; saves that fail are sent again later. Opening a puzzle takes the account's board from the API (or the browser's copy when offline), and coming back to a tab picks up a board saved meanwhile on another device. The built-in puzzles aren't on the server, so their progress stays in the browser even when logged in. After logging in, the home page and the account page offer to add progress saved as a guest in this browser to the account; nothing moves until the player says so. `docs/DECISIONS.md` has the rules for conflicting saves.

## Scripts
````

3. Find:

````markdown
| `bun run test:e2e` | Build the web app and run its Playwright tests |
| `bun run test:perf` | Build the web app and run its frame-time checks |
| `bun run test:e2e:auth` | Build the web app, serve it from the API and run the account end-to-end test (needs Mailpit) |
| `bun run admin <email>` | Make an account an admin; `--revoke` takes it away |
| `bun run --cwd packages/core bench` | Time puzzle verification on 10×10 to 100×100 boards (not part of the check) |
````

   Replace with:

````markdown
| `bun run test:e2e` | Build the web app and run its Playwright tests |
| `bun run test:perf` | Build the web app and run its frame-time checks |
| `bun run test:e2e:auth` | Build the web app, serve it from the API with a worker and run the account and progress end-to-end tests (needs Mailpit and Garage) |
| `bun run admin <email>` | Make an account an admin; `--revoke` takes it away |
| `bun run --cwd packages/core bench` | Time puzzle verification on 10×10 to 100×100 boards (not part of the check) |
````


8.2 Edit `apps/server/AGENTS.md` (each find text occurs once):

1. Find:

````markdown
- Server commands run from the repo root, so Bun loads the root `.env` and relative paths in the settings resolve from there.
- Routes that need a logged-in user call `currentUser(c, sessions)` from the session cookie module and answer 401 when it is null; routes for confirmed accounts only also check `emailVerifiedAt`. Every state-changing request under `/api` goes through the CSRF check, so list a 403 response on new POST, PUT and DELETE routes. A route without a request body isn't covered by the JSON-only rule, so it relies on that check and SameSite alone.
- A table that holds a user's data references `users(id) ON DELETE CASCADE`, so deleting the account deletes it (PRD NFR-6).
- In a schema, write "this registered schema or null" as `z.union([Schema, z.null()])`. `.nullable()` on a schema registered with `.openapi("Name")` makes the shared component itself nullable.
````

   Replace with:

````markdown
- Server commands run from the repo root, so Bun loads the root `.env` and relative paths in the settings resolve from there.
- Routes that need a logged-in user call `currentUser(c, sessions)` from the session cookie module and answer 401 when it is null; routes for confirmed accounts only also check `emailVerifiedAt`. Every state-changing request under `/api` goes through the CSRF check, so list a 403 response on new POST, PUT and DELETE routes. A route without a request body isn't covered by the JSON-only rule, so it relies on that check and SameSite alone.
- Routes for one player's own data name the user in the path (`/api/users/{userId}/…`) and answer 403 when it isn't the logged-in user, as the progress routes do, so a page that still shows an earlier login can't read or write another account's data.
- A table that holds a user's data references `users(id) ON DELETE CASCADE`, so deleting the account deletes it (PRD NFR-6).
- In a schema, write "this registered schema or null" as `z.union([Schema, z.null()])`. `.nullable()` on a schema registered with `.openapi("Name")` makes the shared component itself nullable.
````


8.3 Edit `apps/web/AGENTS.md` (each find text occurs once):

1. Find:

````markdown
- Theme colours come from the CSS custom properties in the app stylesheet, which follow the design kit (`docs/design/README.md`). Book-cover tints are the one exception: they are the same in both themes.
- App code type-checks without Bun's types; tests and test helpers use a second config that adds them.
- Who is logged in comes from the auth store, a plain module over the generated client with tests beside it. The root layout refreshes it once; the shared site header shows it. The account pages are plain forms styled by the `.auth` rules in the app stylesheet.
- End-to-end tests end in `.e2e.ts` and run with `bun run test:e2e`. They need a local Chromium and are not part of `bun run check`. Frame-time checks are tagged `@perf` and run with `bun run test:perf` instead. The account test ends in `.auth-e2e.ts` and runs against the real API with its own config (`bun run test:e2e:auth`).
````

   Replace with:

````markdown
- Theme colours come from the CSS custom properties in the app stylesheet, which follow the design kit (`docs/design/README.md`). Book-cover tints are the one exception: they are the same in both themes.
- App code type-checks without Bun's types; tests and test helpers use a second config that adds them.
- Saved progress goes through the sync module: guests and built-in puzzles use the guest store in browser storage, as before; a logged-in player's server puzzles keep a copy under the account's own keys and sync with the API. Guest progress joins an account only through the "Add to my account" button, never on login by itself.
- Who is logged in comes from the auth store, a plain module over the generated client with tests beside it. The root layout refreshes it once; the shared site header shows it. The account pages are plain forms styled by the `.auth` rules in the app stylesheet.
- End-to-end tests end in `.e2e.ts` and run with `bun run test:e2e`. They need a local Chromium and are not part of `bun run check`. Frame-time checks are tagged `@perf` and run with `bun run test:perf` instead. The account test ends in `.auth-e2e.ts` and runs against the real API with its own config (`bun run test:e2e:auth`).
````


8.4 Edit `docs/TESTING.md` (each find text occurs once):

1. Find:

````markdown
The components are covered by Playwright end-to-end tests (`*.e2e.ts` in the web app's `tests` folder). They build the app, serve it and drive it in Chromium at the design kit's phone sizes and on a desktop. Run them with `bun run test:e2e`. They are not part of `bun run check` because they need a local Chromium (`bunx playwright install chromium` in the web app folder).

The account end-to-end test (`tests/accounts.auth-e2e.ts`) has its own config, `playwright.auth.config.ts`: it builds the app and starts the real API serving it on port 4174, with a fresh database, Mailpit for mail and Turnstile's test keys. It replaces Cloudflare's widget script with a stub and reads the confirmation link from Mailpit's API. Run it with `bun run test:e2e:auth`; it skips itself when Mailpit or challenges.cloudflare.com can't be reached.

Frame-time checks (`tests/perf.e2e.ts`, tagged `@perf`) slow the CPU down and measure animation frames while drawing and zooming large boards. `bun run test:e2e` skips them; run them with `bun run test:perf`. They stay out of the gate because their timings depend on the machine.
````

   Replace with:

````markdown
The components are covered by Playwright end-to-end tests (`*.e2e.ts` in the web app's `tests` folder). They build the app, serve it and drive it in Chromium at the design kit's phone sizes and on a desktop. Run them with `bun run test:e2e`. They are not part of `bun run check` because they need a local Chromium (`bunx playwright install chromium` in the web app folder).

The account end-to-end tests (`tests/*.auth-e2e.ts`) have their own config, `playwright.auth.config.ts`: it builds the app and starts the real API serving it on port 4174, with a job worker beside it sharing a fresh database file, Mailpit for mail, Garage for blobs and Turnstile's test keys. The account test replaces Cloudflare's widget script with a stub and reads the confirmation link from Mailpit's API; the progress test signs up through the API, has the worker generate a 5×5 puzzle, and plays it in two browser contexts logged in to the same account. Run them with `bun run test:e2e:auth`; each skips itself when what it needs (Mailpit or Garage, and challenges.cloudflare.com) can't be reached.

The web app's sync module is tested under `bun test` against a fake progress API that applies the server's conflict rule, with a hand-run scheduler in place of timers.

Frame-time checks (`tests/perf.e2e.ts`, tagged `@perf`) slow the CPU down and measure animation frames while drawing and zooming large boards. `bun run test:e2e` skips them; run them with `bun run test:perf`. They stay out of the gate because their timings depend on the machine.
````


8.5 Edit `docs/DECISIONS.md` (each find text occurs once):

1. Find:

````markdown
- **Decision:** The card replaces the tool tray (Hint artboard). Apply makes the hint's move as one undo step; "I'll draw it" or Escape closes the card and leaves the washes and ghosts on the board until the move is made or one of its edges is marked to something else. H asks for a hint; focus goes to the card's first button and back to the board when it closes. A zoomed board pans the hint into view. Seeing a hint marks the attempt assisted: guest progress stores `assisted` (an optional field of the v1 object; older saves load as not assisted), Start over clears it, and a "Hint used" tag shows in the status line, the desktop time card and the solved card. The tag takes the zoom tip's place in the status line. Rule titles live in core next to the rule text (`RULE_TITLE`); the small rule pictures live in the web app.
- **Reason:** It follows the design kit (hints replace the tray, ai wash, dashed ghost), keeps every action reachable from the keyboard (NFR-5), and the words on the card and tag carry the meaning, not the colour. Counting a hint that was only looked at is the simplest rule that cannot be gamed by dismissing the card. Practice puzzles are never ranked, so the tag says "Hint used"; ranked play (WT11) adds "unranked". On phones the card is compacted (floated figure, smaller type, no figure on the smallest phones) so the longest hint fits under a 7×7 without scrolling or moving the board; an end-to-end test checks every rule small-7 uses at 360×560 and 390×664. Each rule's figure shows the reason for the move, not only the move; lookahead has no figure.
````

   Replace with:

````markdown
- **Decision:** The card replaces the tool tray (Hint artboard). Apply makes the hint's move as one undo step; "I'll draw it" or Escape closes the card and leaves the washes and ghosts on the board until the move is made or one of its edges is marked to something else. H asks for a hint; focus goes to the card's first button and back to the board when it closes. A zoomed board pans the hint into view. Seeing a hint marks the attempt assisted: guest progress stores `assisted` (an optional field of the v1 object; older saves load as not assisted), Start over clears it, and a "Hint used" tag shows in the status line, the desktop time card and the solved card. The tag takes the zoom tip's place in the status line. Rule titles live in core next to the rule text (`RULE_TITLE`); the small rule pictures live in the web app.
- **Reason:** It follows the design kit (hints replace the tray, ai wash, dashed ghost), keeps every action reachable from the keyboard (NFR-5), and the words on the card and tag carry the meaning, not the colour. Counting a hint that was only looked at is the simplest rule that cannot be gamed by dismissing the card. Practice puzzles are never ranked, so the tag says "Hint used"; ranked play (WT11) adds "unranked". On phones the card is compacted (floated figure, smaller type, no figure on the smallest phones) so the longest hint fits under a 7×7 without scrolling or moving the board; an end-to-end test checks every rule small-7 uses at 360×560 and 390×664. Each rule's figure shows the reason for the move, not only the move; lookahead has no figure.

## 2026-10-25 · WT9 `progress-sync` · Saved progress API
- **Question:** How is a logged-in player's progress stored and served (FR-21, NFR-4, NFR-6)?
- **Decision:** Migration 004 adds `progress`, one row per user and puzzle: the edge-state string, play time, `solved`, `assisted`, `version`, `device`, `created_at` and `updated_at`, referencing `users(id)` and `puzzles(id)` with `ON DELETE CASCADE`. Routes: `GET /api/users/{userId}/progress?limit=` (unsolved, most recent first, with sizes), and `GET`, `PUT` and `DELETE /api/users/{userId}/progress/{puzzleId}`. Every route needs a session and answers 403 when `userId` isn't the logged-in user. They share a limit of 120 requests a minute per user. `PUT` takes `{edges, elapsedMs, assisted, baseVersion, device}` and answers `{progress, accepted}`. The edge string must fit the puzzle (400), play time is a whole number of milliseconds up to 100 days, and `solved` is worked out on the server with `analyzeBoard`. Unknown or unpublished puzzles answer 404. `ProgressManager` holds the rules and `SqliteProgressRepository` the SQL. `InvalidBoardError` moved to the shared manager errors, and `PuzzleNotFoundError` joined it. Only puzzles on the server sync: the built-in puzzles live in the web app, so their progress stays in the browser's guest store even when logged in. Migration 003 was set aside for hints, which needed none, so the numbers go 001, 002, 004.
- **Reason:** With the user in the path, a page that still shows an earlier login (another tab logged in as someone else) gets a 403 instead of writing into, or reading from, the other account. That is the same-account check guest import relies on. The server can only check a board against puzzles it holds. Working out `solved` on the server keeps a client from storing a solve it didn't make. The limit leaves room for several tabs and for bringing in a guest's saves.

## 2026-10-25 · WT9 `progress-sync` · Progress conflicts
- **Question:** Two devices can save different boards for one puzzle. Which one is kept?
- **Decision:** Every save names the `version` it continued from (`baseVersion`, null when the client had none) and a random id for its browser (`device`, kept in `localStorage` under `loophole:device`). The server decides in this order:
  1. With no stored record, the save is stored as version 1.
  2. A solved stored record is kept (only `DELETE`, "Start over", removes it).
  3. The stored board sent again, as when a tab is hidden or left without a move, is accepted without a new version. It keeps the stored device and takes the larger play time.
  4. A different board replaces the record, with the version plus one, when it is solved, when it continues from the stored version, or when the same device made the stored record.
  5. Otherwise the stored record is kept and sent back with `accepted: false`, and the client shows that board.

  `assisted` only ever turns on: a refused save that saw a hint still marks the record, without a new version. The web app sends one request per puzzle at a time, so one page's saves reach the server in order.
- **Reason:** The common conflict is a stale tab: a phone left on the puzzle while the player went on at a laptop. Last-write-wins by client time would let that tab overwrite the laptop's work as soon as it was touched, and clocks on different devices disagree anyway. "More play time wins" fails the same way, because a visible tab left idle keeps its clock running. Versions spot staleness exactly. Rule 3 keeps a glance at another device from making the playing device stale. The device id means a save whose answer was lost (the page closed mid-request) can be sent again with the old version. A solve is never lost to an unsolved board. A cleared board is a move like any other, so a stale device can't overwrite it.

  Costs:
  - A device that played offline, while another device carried on from the same version, loses its offline moves for that puzzle when it comes back. The player sees "Picked up your progress from another device".
  - After "Start over" (the record is deleted), a stale device that still shows the old unsolved board and makes a move stores it as a new record, which the first device then picks up. That needs a device left open on the puzzle from before it was solved. A tombstone row would prevent it, at the cost of a flag that every read would have to respect.
  - Two tabs of one browser share a device id, so they never refuse each other's saves. The last one to save wins, and the other tab learns of it only when it is hidden and shown again.

## 2026-10-25 · WT9 `progress-sync` · Syncing in the web app
- **Question:** When does the web app save to the server, and what happens offline?
- **Decision:** This applies to a logged-in player's server puzzles.
  - **Saving.** Each save goes at once to `localStorage` under the account's own keys (`loophole:user:<id>:progress:<puzzle>`), and the puzzle is marked unsent. The save goes to the API 2 s after the last change. A first save of an empty board is skipped, because opening a puzzle isn't progress.
  - **Leaving.** When the tab is hidden, or the page is hidden or closed, unsent saves go out at once with `fetch(..., {keepalive: true})`, since a JSON `PUT` can't go through `sendBeacon`. Only one request per puzzle runs at a time: a later save waits for it and then sends the newest board. A flush skips a puzzle whose request is still out; that request sends the newer board when it finishes.
  - **Retries.** Failed saves stay marked. They are retried after 5 s, 15 s, then every 60 s, when the browser comes back online, and when the account is next known on app start. A "Start over" made offline is remembered and sent before any later save.
  - **Opening.** Opening a puzzle sends this device's unsent save first, and otherwise reads the server's board. Every request a screen waits on (opening, coming back to the tab, importing) gives up after 4 s and uses the device copy; the save stays marked. If the server has nothing, the device copy is cleared: the puzzle was started over elsewhere.
  - **Coming back.** When the tab comes back into sight, the screen asks the server again. It takes a newer board while still paused, and ignores an answer older than a save it made meanwhile.
  - **Losing the login.** A 401 or 403 refreshes the auth store and keeps unsent saves for that account's next login.
  - **Logout and deletion.** Logging out from the account page removes the account's synced boards from this browser and keeps only unsent ones. Deleting the account removes all of them.
  - **Structure.** The play screen's progress code lives in the sync module (`$lib/sync`). The screen only opens a saves handle and adopts boards it is given.
- **Reason:** Writing locally first keeps FR-21's auto-save working with no network, and per-account keys keep one person's progress out of another's on a shared browser. Debouncing keeps a drag from sending a request per edge. One request per puzzle keeps two saves from crossing and leaving the server on the older board. The keepalive request is the one way to send a JSON body while a page is closing, and the 64 KiB keepalive budget fits a 100×100 board (about 20 KB). The timeouts keep a hanging network from locking the board.

## 2026-10-25 · WT9 `progress-sync` · Guest progress into an account
- **Question:** How does a guest's progress join an account without a stale or unexpected session taking it (FR-21, accounts review)?
- **Decision:** Only when the player asks.
  - **The offer.** After login, the home page shows "Progress from before you logged in", naming the account's email, with "Add to my account" and "Not now". The account page shows the same offer without "Not now".
  - **What is sent.** Each guest save of a server puzzle, with at least one mark, goes as a `PUT` from a new random device with no `baseVersion`. So the account keeps a board it already has unless the guest's is solved or the same. The result names how many boards were added and how many the account kept.
  - **Same-account checks.** The import refuses to run if the logged-in user is no longer the one the offer named, and the path check refuses it on the server too.
  - **Cleanup.** Each guest save leaves guest storage once the server has answered for it (taken, kept, or puzzle gone). A network failure stops the run and leaves the rest for another try. Running it again only sends what is left, and a repeat of a save already taken changes nothing.
  - **Built-in puzzles** are left out.
- **Reason:** Moving guest progress silently on login would let a session the player didn't mean to use (a shared computer, a stale tab) take this browser's saves. An explicit button that names the account rules that out. Treating guest saves as a device that has never synced reuses the conflict rule instead of adding a merge just for imports. Because a puzzle only opened while logged in leaves no record, it doesn't block an import.

## 2026-10-25 · WT9 `progress-sync` · How ranked play builds on progress
- **Question:** How should daily ranked play (WT11), with server-validated solves and timing, use the progress records?
- **Decision:** Keep ranked attempts in their own table (for example `ranked_attempts`, keyed by user and puzzle, with server start and finish times, the validated result and assists recorded through the hint endpoint), referencing `users(id) ON DELETE CASCADE`. The progress row stays the board a player resumes on any device, daily puzzles included. Leaderboards never read `progress.elapsedMs`, `solved` or `assisted`: play time comes from the player's clock, and `assisted` from what the client says. Ranked mode can still save the board through these routes.
- **Reason:** The two records answer different questions: where did I leave this board, and what counts for the leaderboard. Keeping them apart means no migration of `progress` and no rule here bending for ranking.

## 2026-10-25 · WT9 `progress-sync` · Progress end-to-end test
- **Question:** How is cross-device sync tested in a browser, when it needs a puzzle stored on the server?
- **Decision:** `playwright.auth.config.ts` now starts the job worker beside the API, sharing a fresh database file `data/e2e-auth.sqlite` (deleted before each run), with Garage's dev keys from `.env.example`. `tests/progress.auth-e2e.ts` signs up through the API, has the worker generate a 5×5 puzzle, and plays it in two browser contexts logged in to the same account. It also brings a guest's save into an account through the button. It skips itself when Garage or challenges.cloudflare.com can't be reached; Mailpit isn't needed, since login works before the email is confirmed. `bun run test:e2e` is unchanged and needs no API.
- **Reason:** A real generated puzzle tests the path production takes, without test-only seeding code in the server. Later phases (submissions, daily puzzles) need the worker in end-to-end tests too.
````


Verify: `bun run check` → `0 fail`. Commit: `docs: progress sync in README, AGENTS, TESTING and DECISIONS`

### Step 9. Final verification and a live cross-device check

```sh
bun run check
bun run test:e2e
bun run test:perf
docker compose up -d && ./scripts/garage-init.sh
bun run test:e2e:auth
docker compose down
git status --short   # empty; data/ is git-ignored
```

Expect: `0 fail`, `57 passed`, `2 passed`, `3 passed`. Check `docker ps` shows no loophole containers afterwards. The first progress test is the live cross-device check. Two browser contexts are logged in to one account:

- one draws a line;
- the other finds the puzzle in "Continue", sees the line, and draws a second;
- the first hides and shows its tab: its stale save is refused, and it picks up two lines with the "Picked up your progress from another device." note.

Optional manual check: with Docker up and `.env` in place, run `bun run dev:api`, `bun run dev:worker` and `bun run dev:web`. Queue a puzzle with the curl command in the README. Log in at http://localhost:5173 in a normal window and in a private window, play the puzzle in one, and open it in the other.


## Commits

1. `feat(server): add the progress table and its repository` (Step 1)
2. `feat(server): add ProgressManager with the cross-device conflict rule` (Step 2)
3. `feat(server): add the saved progress API` (Step 3)
4. `feat(web): add the progress sync module` (Step 4)
5. `feat(web): sync play screen progress with the account` (Step 5)
6. `feat(web): continue list and opt-in guest progress import` (Step 6)
7. `test(web): cross-device progress end-to-end test` (Step 7)
8. `docs: progress sync in README, AGENTS, TESTING and DECISIONS` (Step 8)

## Acceptance criteria

| # | Criterion | Requirement | Checked by |
|---|---|---|---|
| 1 | A logged-in player's board, play time, solved and assisted flags on a server puzzle are saved to the account automatically and restored on another device | FR-21, §6 story | `progress.test.ts` "save, read back, list and delete"; `progress.auth-e2e.ts` first test |
| 2 | Saves reach the server about 2 s after the last change and at once when the tab or page is hidden; one request per puzzle at a time, so the newest board ends up stored; failed saves are retried; offline play keeps working from the device copy; a screen never waits more than 4 s | FR-21 | `sync.test.ts` "saving", "opening" and "one request per puzzle" groups |
| 3 | Conflicts between devices follow one documented rule: a stale tab can't overwrite newer play, a glance at another device doesn't make the playing one stale, a solve is never lost, a cleared board isn't overwritten by a stale device, `assisted` only turns on | FR-21 (DECISIONS "Progress conflicts") | `progress-manager.test.ts`, `progress.test.ts` "conflicts between devices", `sync.test.ts`, e2e first test (stale tab picks up the newer board) |
| 4 | Guests keep their `localStorage` progress unchanged; built-in puzzles stay on the device even when logged in | FR-21 | unchanged `progress.test.ts` (web), `saves.test.ts`, `bun run test:e2e` 57 passed with no API |
| 5 | Guest progress joins an account only through "Add to my account", which names the account; the import is idempotent; a page that still shows an earlier login can't move it into another account | FR-21; accounts review follow-up | `guest.test.ts`, `sync.test.ts` "importGuest", `progress.test.ts` 403 test, e2e second test |
| 6 | Progress routes need a session (401), only serve the logged-in user's own path (403), refuse cross-site writes (403) and non-JSON bodies (415), validate the board against the puzzle (400) and the body (400), answer 404 for unknown puzzles, and limit 120 requests a minute per user (429) | NFR-4 | `progress.test.ts` |
| 7 | Deleting an account deletes its progress on the server (cascade) and this browser's account copy; logging out drops the synced copy and keeps unsent saves | NFR-6 | `progress-repository.test.ts`, `progress.test.ts` "deleting the account…", `sync.test.ts` "forgetUser" and "forgetSynced" |
| 8 | `solved` is worked out on the server from the board, never taken from the client | FR-17 (spirit), NFR-4 | `progress-manager.test.ts` first test; `progress.test.ts` rejects a `solved` field |
| 9 | Layering: the route module only translates and validates; `ProgressManager` holds the rules and depends only on `ports.ts`, `domain.ts`, core and `PuzzleManager`; SQL lives in `SqliteProgressRepository`; only `main.ts` and `spec.ts` build adapters | §Stack (layering) | `bun run lint` (Biome import rules), review |
| 10 | The OpenAPI document and the generated client include the new routes | §Stack (contract) | `bun run check:api` in `bun run check` |
| 11 | `bun run check`, `bun run test:e2e`, `bun run test:perf` and `bun run test:e2e:auth` pass | NFR-3 | Step 9 |

## DECISIONS entries

Step 8.5 appends these to `docs/DECISIONS.md` (full text above):

- Saved progress API
- Progress conflicts
- Syncing in the web app
- Guest progress into an account
- How ranked play builds on progress
- Progress end-to-end test

## Merge notes

**WT8 `hints`** is already merged into main (`452f304`), and this plan is written against it:

- the synced record carries `assisted`, with the same meaning as the guest store's;
- the hint route keeps its OpenAPI output (Step 3.3 only extracts `EdgesSchema`);
- `InvalidBoardError` moves to `managers/errors.ts` (Step 3.1–3.2).

No migration 003 exists; that number stays unused.

**WT10 `submissions`**, planned in parallel, will likely touch the same places. When merging main into this branch, or this branch into main after WT10:

- **Migrations.**
  - Keep both files: this branch adds `004_progress.sql`, WT10 adds `005_*.sql`. Don't renumber either.
  - In `apps/server/src/adapters/db/database.test.ts`, the expected tables list gets both new tables (alphabetical). The expected versions become `[1, 2, 4, 5]`.
- **`AppDeps` and `createApp` callers.**
  - Both branches add a field to `AppDeps` in `api/app.ts` and to every `createApp({...})` call. Keep both fields everywhere: `main.ts`, `spec.ts`, `app.test.ts`, `accounts.test.ts`, `worker/flow.test.ts`, `progress.test.ts`, and any WT10 test file that calls `createApp`. A WT10 test that builds the app needs `progress: sqliteProgress(db, puzzles, clock)` (from `test-support/progress.ts`).
  - Keep both branches' `registerXRoutes(app, deps)` lines and both sets of `onError` mappings. If WT10 also adds a "puzzle not found" error, keep one class (`PuzzleNotFoundError` in `managers/errors.ts`) and map it once.
- **Shared server files.** `domain.ts`, `ports.ts`, `managers/errors.ts` and `test-support/fakes.ts` get additions from both branches: keep both. If WT10 also needs `InvalidBoardError` for its editor, import it from `managers/errors.ts`.
- **Generated files.** Never hand-merge `openapi.yaml` or `packages/api-client/src/schema.ts`: take either side, then run `bun run gen:api` and commit the result. The gate (`bun run check:api`) fails until they are regenerated.
- **Docs.** README, DECISIONS (both sets of entries at the bottom, in merge order) and the AGENTS files: keep both sides' text.
- **Puzzle ownership.** WT10's submitted puzzles become `puzzles` rows, so progress works for them without changes. If WT10 lets admins delete puzzle rows (rather than unpublish), `progress` rows go with them through `ON DELETE CASCADE`; unpublishing hides them from the Continue list.

**WT11 `daily-leaderboards`**: see the DECISIONS entry "How ranked play builds on progress". In short:

- add a separate ranked-attempt table with server timing;
- never rank from `progress.elapsedMs`, `solved` or `assisted`;
- reuse the `/api/users/{userId}/…` same-account pattern for the player's own routes;
- daily puzzles sync through these routes like any server puzzle.

## Risks

- **Async load on the play screen.** The board is locked until progress loads. That is instant for built-in puzzles. For server puzzles it waits for the auth answer and the server (at most 4 s, then the device copy). The progress end-to-end tests wait for `tabindex="0"` before clicking.
- **Intermittent guest end-to-end failures.**
  - In prototyping, two runs of `bun run test:e2e` failed (7 and 15 tests). Both came right after a heavy command, while the host's load average was about 14 from other agents. Failing test names weren't captured.
  - About 30 further runs were all green: on the prototype and on a clean `452f304` checkout, after the gate and under extra parallel CPU load.
  - So it is unexplained, and not shown to come from this change. Built-in puzzles, which every guest test uses, resolve their progress in two microtasks.
  - If it recurs, keep the log (Step 5 tees it) and rerun the same tests on main before changing anything. An existing WT12 follow-up covers timing-sensitive tests.
- **Stale offline device.** A device that played offline, while another device continued from the same version, loses its offline moves for that puzzle when it reconnects (documented trade-off; the note tells the player).
- **Keepalive limits.** Browsers cap in-flight keepalive bodies at 64 KiB in total. One 100×100 board is about 20 KB, so a flush of several large boards at once could drop some. They stay marked unsent and go out on the next app start.
- **E2E prerequisites.** `test:e2e:auth` now starts a worker and needs Garage for the progress tests. Without it they skip (not fail).

## Unresolved questions (with the defaults this plan uses)

1. Built-in (fixture) puzzles don't sync, because the server can't validate boards for puzzles it doesn't hold. Default: they stay device-only even when logged in; daily and generated puzzles sync. Revisit if the built-ins remain the main practice set in production.
2. Should the e2e harness seed a puzzle without the worker and Garage? Default: no. A real generation keeps test-only code out of the server, and later phases need the worker in e2e anyway.
3. Conflict policy: version + device instead of last-write-wins or "more play time". Default as written. Alternative if product prefers: on a stale save, show both boards and let the player choose (more UI, deferred).
4. On logout, the account page drops this browser's synced boards and keeps only unsent ones, so they still go out at the next login. A session that ends any other way (expired, or logged out in another tab) keeps the copy until the next logout or account deletion. Default as written.
5. Start over deletes the record, so a stale device can bring back the old unsolved board (documented cost). Default: accept it. Alternative: a tombstone row with a `cleared` flag that every read respects.

## Review responses

Plan review 1 (`plan-review-1.md`), one line per finding:

1. **Major, same board bumps the version: fixed.** `ProgressManager.save` keeps the version and device when the board equals the stored one (larger play time, `assisted` ORed). There is a manager test ("a save of the stored board keeps its version and device"), a route test step (the "glance" in "conflicts between devices"), and the DECISIONS rule 3.
2. **Major, saves crossing: fixed.**
   - `createProgressSync` keeps one request per puzzle (`inflight`); later calls wait and then send the newest board.
   - `flush()` skips a puzzle with a request out, and that request re-pushes when it settles.
   - The new `sync.test.ts` test holds answers and releases them newest first; it fails on the old code.
   - The manager test is renamed: "a device's own save is never refused as stale" (a resend after a lost answer).
3. **Major, no timeout on unsent-save open: fixed.**
   - `load`, `refresh` and `importGuest` race their push against a timeout signal (`timeout` dep, default 4 s), and `list` uses it too.
   - The PUT and DELETE carry the signal.
   - On timeout the device copy is used and the save stays marked.
   - The new test with a never-answering PUT fails on the old code.
4. **Major, e2e clicks too early: fixed.** `boardReady()` waits for `tabindex="0"` before every click in both progress tests. Step 7 runs `test:e2e:auth` three times; three green runs after the revision.
5. **Minor, `refresh()` adopting a stale answer: fixed.** It returns if the save counter changed, a save is pending, or a request is out. The new test "refresh ignores an answer older than a save made while it was out" fails on the old code.
6. **Minor, Start over and Clear undone by a stale tab:**
   - **Clear:** fixed. The "blank board" clause is gone, so a cleared board is a move a stale device can't overwrite; the manager test is "a cleared board is a real move".
   - **Imports:** still work, because the client no longer stores a first save of an empty board (opening a puzzle leaves no record).
   - **Start over:** documented as a cost in DECISIONS rather than adding a tombstone (Unresolved question 5).
7. **Minor, two tabs in one browser: documented** as a known limit in DECISIONS "Progress conflicts". There is no `storage` listener; it is optional, and tabs refresh when shown again.
8. **Minor, import message wording: fixed.** "Added your progress on N puzzles to your account." plus "Your account already had progress on M, so it kept its own." when M > 0. The e2e expectation still matches its case (1 added, 0 kept).
9. **Minor, residue after logout: fixed** for logout from the account page. `forgetSynced(userId)` removes the synced `progress:` keys and keeps the unsent ones, with a test. Sessions ending another way keep the copy; this is recorded in DECISIONS and Unresolved question 4.
