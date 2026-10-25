# WT12a `launch-hardening` (server and ops) — implementation plan

WT12 is the last phase (PRD §11 M8: hardening, monitoring, deployment). It is split in two plans, done in order on the same branch:

- **12a (this plan): server and ops.** The flaky database test, Prometheus metrics, JSON logs with request ids, readiness and the admin health report (API side), refusing development settings in production, the production Docker image and Compose file, sample Prometheus config and alerts, SQLite backup and restore, a server-side performance check, docs.
- **12b (`docs/plans/12b-launch-hardening-web.md`): tests and web.** The admin health page, the clock and input-lock test, accessibility checks, the PRD §6 user-story suite, the time-to-first-interaction check, the end-to-end job in CI, the Home polling follow-up, docs.

Branch and worktree: `feat/launch-hardening` at `/home/jhonnold/projects/loophole-wt/launch-hardening`, starting from main `781a247` (WT11b merged). Check first: `git log --oneline -1` shows `781a247` or a later main merged in, and `grep -c AdminHealth openapi.yaml` prints `0`.

PRD: M8; NFR-1 (performance budgets), NFR-4 (security: no secrets in logs, refuse test keys), NFR-6 (privacy: no emails in logs), §5 (admins view system health), §10 (metrics feed the success measures), §12 (risks: spam/abuse and cheating need visibility).

## How to work through this plan

- Prefix every shell command with `export PATH="$HOME/.bun/bin:$PATH";` and run it from the worktree root. Run `bun install` once in a fresh worktree.
- **Create** means: write the file with exactly the content between the four-backtick fences (the Write tool).
- **Replace the whole of** means: overwrite the file with the content shown.
- **Edit** means: apply each numbered Find/Replace with the Edit tool, in order. Each Find block is copied from the file as it is at that point, including indentation, and occurs exactly once.
- **Append** means: add the text at the end of the file.
- **Delete** means: `git rm` the file.
- Never edit `openapi.yaml` or `packages/api-client/src/schema.ts` by hand: `bun run gen:api` writes them (step A4).
- Shell reads of `.env*` files are denied: change `.env.example` with the Edit tool, and write `.env.production` and `.env.garage` (A10 only, never committed) with the Write tool.
- After each step run its verification. `bun run check` must pass before each commit. If Biome reports formatting only, run `bun run format` and check again.
- Docker: start the dev services with `docker compose up -d` (then `./scripts/garage-init.sh`) only when a step needs them, and stop them afterwards with `docker compose stop` if you started them. Never `docker compose down`, never `-v`, never delete volumes you didn't create. Images you build are tagged `loophole-wt12-*` and removed at the end of A10.
- End-to-end runs (A4's auth config change, 12b): other worktrees may hold the default ports, so use `E2E_PORT=4303` and `E2E_AUTH_PORT=4304`.
- Commit after each step with the message given (conventional commits). Don't push.

## What this builds

- **The flaky test (follow-up).** "several connections opening a new file at once…" failed about 1 in 25 runs with "no such savepoint" / "cannot start a transaction within a transaction". The cause is in Bun, not in the migrations: bun:sqlite hands out connection handles from a per-process table without a lock, so two threads opening at the same moment can share a connection. Production opens one connection per process, so only the tests change: the concurrent-open and claim race tests spawn child processes (A1). `scripts/test-under-load.sh` runs `bun test` several copies at once; about 300 full runs found no other failing test (Bun itself crashes about 1 run in 50 at 16 copies, a Bun bug recorded in DECISIONS).
- **Metrics (M8).** `prom-client` 15.1.3 behind two ports (`ApiMetrics`, `WorkerMetrics`); managers never import it. The API counts requests by route template, status and duration, auth failures (login, CAPTCHA, mailed link, cross-site), mail failures and rate-limiter evictions (follow-ups); 429s show in the status label. The worker counts jobs by kind and status with their durations (timeouts are `status="timeout"`), failed daily generations, and gauges jobs queued and running, the days of daily puzzles stocked ahead per size (follow-up) and decided submissions by verdict (PRD §10: the share rejected as `unknown`). Biome refuses `prom-client` outside the adapter and the composition roots. Each process serves `/metrics` on its own port (`API_METRICS_PORT`, `WORKER_METRICS_PORT`; off in development, 9470 and 9471 in production, bound to 127.0.0.1), so metrics are never on the public site and need no token. Garage's built-in metrics are on its admin port with its metrics token. `ops/prometheus.yml` and `ops/alerts.yml` are samples (daily missing or stock low, daily generation failing, mail failing, job timeouts, backlog, 5xx, floods, auth failures, a target down); dashboards are out of scope.
- **Health.** `GET /api/health` stays liveness; `GET /api/health/ready` checks the database and Garage (200/503, no details); `GET /api/admin/health` (admins) adds errors, the queue, the daily stock, the latest failed jobs and versions. The page for it is 12b.
- **Logs.** One JSON object per line with `time`, `level`, `process`, `msg`, fields and the request id; emails, tokens (including base64url tokens with dashes), passwords and keys are masked by the writer (tested). The access log has method, route template, status and time only.
- **Production.** A multi-stage `Dockerfile` (Bun 1.3.13 slim), `compose.prod.yml` (API, worker, Garage; named volumes; health checks; the app's settings in `.env.production` and Garage's secrets in `.env.garage`, each read only by its own containers; only 127.0.0.1 ports, the API's behind a reverse proxy), and `loadConfig` refusing every development default on a public `PUBLIC_URL` (follow-up: production Turnstile keys enforced). `SMTP_REQUIRE_TLS=false` for a relay inside Docker is documented (follow-up).
- **Backups.** `scripts/backup-sqlite.sh` (online `VACUUM INTO`, checked, gzipped, the newest 14 kept; inside the container in production) and `apps/server/scripts/restore-db.ts`, covered by an automated test, with the Garage bucket copy (rclone with a read-only key) and restore steps in the README.
- **Perf (NFR-1).** `bun run bench:jobs`: generation and verification through the worker's real thread runner, failing when a budget is missed. `test:perf` stays as it is (12b adds a check to it).
- **Auth mail via jobs (follow-up "only if needed")**: not needed; mail already goes out after the answer (`BackgroundMailer`), and failures are now counted and alerted on (DECISIONS).

## Out of scope

Dashboards; choosing a host (PRD §14); a durable mail queue; upgrading Bun (1.4.x may fix the handle race and the crash, recorded in DECISIONS); the web pieces (12b).

## Steps

### A1 The concurrent-open and claim race tests run in child processes

The flaky test is not a migration race. bun:sqlite keeps every open database of a process in one table indexed by handle number and grows it without a lock, so two **threads** opening a database at the same moment can get the same handle and share one SQLite connection; their transactions then collide ("cannot start a transaction within a transaction", "no such savepoint"). Measured in the prototype: four threads opening four different files got a duplicate handle in 1 of 300 rounds. The API and the worker are separate processes that open the database once each on their main thread, so production code is not affected and needs no change. The two tests that open one file from several threads (`database.test.ts` and `claim-race.test.ts`) model several processes, so they now spawn child processes, with a 30 s timeout each, and the claim test kills its children when it ends, so none is left waiting for the go file. With the WAL retry in `openDatabase` removed, the new open test fails 16 times in 20, so it still guards that fix. The step also adds `scripts/test-under-load.sh`, the documented way to run tests several copies at once.

**Delete `apps/server/src/test-support/open-thread.ts`**: `git rm apps/server/src/test-support/open-thread.ts`

**Create `apps/server/src/test-support/open-child.ts`**:

````ts
// A child process for the concurrent-open test: opens the database at the path it is given and
// prints its journal mode, or the error message if opening failed.
import { openDatabase } from "../adapters/db/database.ts";

try {
  const db = openDatabase(process.argv[2]);
  const row = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
  db.close();
  console.log(row?.journal_mode ?? "none");
} catch (err) {
  console.log(`error: ${err instanceof Error ? err.message : String(err)}`);
}
````

**Edit `apps/server/src/adapters/db/database.test.ts`**: 1 replacement, in order.

1. Find:
````ts
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
````
   Replace with:
````ts
    }
  });

  // Separate processes, as the API and the worker are. Threads would not do: bun:sqlite's table of
  // open databases is shared by a process's threads without a lock, so two threads opening at the
  // same moment can get the same connection (DECISIONS, "Concurrent-open tests use processes").
  test("several processes opening a new file at once all succeed in WAL mode", async () => {
    const script = new URL("../../test-support/open-child.ts", import.meta.url).pathname;
    for (let trial = 0; trial < 5; trial++) {
      const dir = mkdtempSync(join(tmpdir(), "loophole-open-"));
      try {
        const path = join(dir, "new.sqlite");
        const children = Array.from({ length: 4 }, () =>
          Bun.spawn([process.execPath, script, path], { stdout: "pipe", stderr: "inherit" }),
        );
        const modes = await Promise.all(
          children.map(async (child) => (await new Response(child.stdout).text()).trim()),
        );
        expect(modes).toEqual(["wal", "wal", "wal", "wal"]);
      } finally {
        rmSync(dir, { recursive: true });
      }
    }
  }, 30_000);
});
````

**Delete `apps/server/src/test-support/claim-thread.ts`**: `git rm apps/server/src/test-support/claim-thread.ts`

**Create `apps/server/src/test-support/claim-child.ts`**:

````ts
// A child process for the claim race test: `bun claim-child.ts <database> <worker id> <go file>`.
// It connects to the shared database, prints "ready", waits until the go file exists, then claims
// jobs until none are left and prints the ids it got as JSON.
import { existsSync } from "node:fs";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";

const [path, worker, goFile] = process.argv.slice(2);
const queue = new SqliteJobQueue(openDatabase(path));
console.log("ready");
while (!existsSync(goFile)) Bun.sleepSync(1);
const ids: string[] = [];
for (let job = queue.claimNext(worker, 0); job !== null; job = queue.claimNext(worker, 0)) {
  ids.push(job.id);
}
console.log(JSON.stringify(ids));
````

**Replace the whole of `apps/server/src/adapters/db/claim-race.test.ts`**:

````ts
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./database.ts";
import { SqliteJobQueue } from "./job-queue.ts";

const WORKERS = 4;
const JOBS = 2000;
const SCRIPT = new URL("../../test-support/claim-child.ts", import.meta.url).pathname;

// Separate processes, as workers are in production (DECISIONS, "Concurrent-open tests use
// processes").
test("workers on separate connections never claim the same job", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loophole-claim-"));
  const running: { kill(): void }[] = [];
  try {
    const path = join(dir, "jobs.sqlite");
    const goFile = join(dir, "go");
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
    const children = Array.from({ length: WORKERS }, (_, i) =>
      Bun.spawn([process.execPath, SCRIPT, path, `w${i}`, goFile], {
        stdout: "pipe",
        stderr: "inherit",
      }),
    );
    running.push(...children);
    // Every worker connects first, then all start claiming at once.
    const readers = children.map((child) => child.stdout.getReader());
    const decoder = new TextDecoder();
    const output = children.map(() => "");
    await Promise.all(
      readers.map(async (reader, i) => {
        while (!output[i].includes("ready\n")) {
          const { value, done } = await reader.read();
          if (done) throw new Error(`worker ${i} exited before connecting`);
          output[i] += decoder.decode(value);
        }
      }),
    );
    writeFileSync(goFile, "");
    const claimed = await Promise.all(
      readers.map(async (reader, i) => {
        for (let r = await reader.read(); !r.done; r = await reader.read()) {
          output[i] += decoder.decode(r.value);
        }
        return JSON.parse(output[i].slice(output[i].indexOf("ready\n") + 6)) as string[];
      }),
    );
    const all = claimed.flat();
    expect(all.length).toBe(JOBS);
    expect(new Set(all).size).toBe(JOBS);
    expect(queue.countQueued()).toBe(0);
    db.close();
  } finally {
    // A worker still waiting for the go file (another failed early) must not outlive the test.
    for (const child of running) child.kill();
    rmSync(dir, { recursive: true });
  }
}, 30_000);
````

**Create `scripts/test-under-load.sh`**:

````bash
#!/usr/bin/env bash
# Runs `bun test` several times at once, round after round, to shake out timing-sensitive tests.
# Usage: ./scripts/test-under-load.sh [copies at once, default 6] [rounds, default 5] [bun test args...]
# Prints each failing test (and any Bun crash) with how often it happened; exits 1 if any run failed.
set -uo pipefail

cd "$(dirname "$0")/.."

COPIES="${1:-6}"
ROUNDS="${2:-5}"
shift $(( $# > 2 ? 2 : $# ))
LOGS="$(mktemp -d "${TMPDIR:-/tmp}/loophole-load-XXXXXX")"

echo "Running bun test $* — $COPIES at once, $ROUNDS rounds; load average now: $(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || uptime)"
for c in $(seq 1 "$COPIES"); do
  (
    for r in $(seq 1 "$ROUNDS"); do
      if ! bun test "$@" >"$LOGS/run-$c-$r.log" 2>&1; then
        echo "failed" >"$LOGS/run-$c-$r.failed"
      fi
    done
  ) &
done
wait

runs=$((COPIES * ROUNDS))
failed=$(find "$LOGS" -name '*.failed' | wc -l)
echo "$failed of $runs runs failed."
if [ "$failed" -gt 0 ]; then
  grep -h -E '^\(fail\)|panic:|Bun has crashed' "$LOGS"/*.log | sed -E 's/ \[[0-9.]+m?s\]$//' | sort | uniq -c | sort -rn
  echo "Logs: $LOGS"
  exit 1
fi
rm -rf "$LOGS"
````

**Run** (make the script executable):

```sh
chmod +x scripts/test-under-load.sh
```

**Verify:** `bun run check`; then `bun test apps/server/src/adapters/db/` passes, and `./scripts/test-under-load.sh 8 3 apps/server/src/adapters/db` prints `0 of 24 runs failed.` (A Bun segfault under heavy load is a Bun bug, not a failing test; see the DECISIONS entry in A9.)

**Commit:** stage the paths above (the two deletions included) and commit `test(server): run the concurrent-open and claim race tests in child processes`

### A2 Settings: production checks, metrics ports and the app version

A `PUBLIC_URL` that isn't on localhost already means production for Turnstile's test secret and the daily seed secret. This step extends that rule to every development default that would make a public site unsafe or quietly broken, and reports all of them at once. It also adds `APP_VERSION` (the Docker image sets it to the git commit), `METRICS_HOST`, `API_METRICS_PORT` and `WORKER_METRICS_PORT` (0, the default, means no metrics listener).

**Replace the whole of `apps/server/src/config.ts`**:

````ts
import { hostname } from "node:os";
import { z } from "zod";
import type { S3Settings } from "./adapters/blob/s3-blob-store.ts";
import {
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_SITE_KEY,
} from "./adapters/captcha/turnstile.ts";
import type { SmtpSettings } from "./adapters/mail/smtp-mailer.ts";
import type { JobRunSettings } from "./managers/job-run-manager.ts";

/**
 * The daily seed secret for development and tests. Like Turnstile's test keys, it is refused for a
 * site that isn't on localhost: anyone could work out daily puzzles made with it.
 */
export const DEV_DAILY_SEED_SECRET = "loophole-dev-daily-seed-secret";

/** Garage's development access key (scripts/garage-init.sh); public, so never for a real site. */
export const DEV_S3_ACCESS_KEY_ID = "GK1a2b3c4d5e6f708192a3b4c5";

const DEFAULT_MAIL_FROM = "Loophole <no-reply@loophole.localhost>";

const Port = z.coerce.number().int().min(1).max(65535);
/** A port, or 0 for "don't listen". */
const OptionalPort = z.coerce.number().int().min(0).max(65535).default(0);
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
  PUBLIC_URL: z.url(),
  TRUST_PROXY: z.stringbool().default(false),
  TURNSTILE_SITE_KEY: z.string().min(1).default(TURNSTILE_TEST_SITE_KEY),
  TURNSTILE_SECRET_KEY: z.string().min(1).default(TURNSTILE_TEST_SECRET_KEY),
  SMTP_HOST: z.string().min(1).default("localhost"),
  SMTP_PORT: Port.default(1025),
  SMTP_SECURE: z.stringbool().default(false),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_REQUIRE_TLS: z.stringbool().optional(),
  MAIL_FROM: z.string().min(1).default(DEFAULT_MAIL_FROM),
  DAILY_SEED_SECRET: z.string().min(16).default(DEV_DAILY_SEED_SECRET),
  DAILY_DAYS_AHEAD: z.coerce.number().int().min(1).max(30).default(3),
  APP_VERSION: z.string().min(1).default("dev"),
  METRICS_HOST: z.string().min(1).default("127.0.0.1"),
  API_METRICS_PORT: OptionalPort,
  WORKER_METRICS_PORT: OptionalPort,
});

export interface Config {
  readonly host: string;
  readonly port: number;
  /** Relative paths resolve against the working directory: the repo root for the root scripts. */
  readonly databasePath: string;
  readonly webDir: string | undefined;
  readonly s3: S3Settings;
  /** Unique per process: the name (WORKER_ID, or the host) plus the pid, so a reclaimed job's old worker can't match the new one. */
  readonly workerId: string;
  /** How long an idle worker waits before looking for jobs again. */
  readonly pollMs: number;
  /** New jobs are refused while this many are waiting. */
  readonly maxQueuedJobs: number;
  readonly jobs: JobRunSettings;
  /** Origin of the web app, without a trailing slash; links in mail point here. */
  readonly publicUrl: string;
  /** Behind a reverse proxy: take the client's address from the last X-Forwarded-For entry. */
  readonly trustProxy: boolean;
  readonly turnstile: { readonly siteKey: string; readonly secretKey: string };
  readonly smtp: SmtpSettings;
  /** How long a login session lasts. */
  readonly sessionTtlMs: number;
  readonly dailies: {
    /** Daily seeds are derived from this, so they can't be guessed (worker only). */
    readonly seedSecret: string;
    /** How many days, today included, the worker keeps generated. */
    readonly daysAhead: number;
    /** How often the worker checks that the coming days are generated. */
    readonly stockMs: number;
  };
  /** Which build is running (the git commit in a production image), or "dev". */
  readonly version: string;
  /** Where each process serves Prometheus metrics; port 0 means it doesn't. */
  readonly metrics: {
    readonly host: string;
    readonly apiPort: number;
    readonly workerPort: number;
  };
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
  const publicUrl = new URL(e.PUBLIC_URL);
  const local = publicUrl.hostname === "localhost" || publicUrl.hostname === "127.0.0.1";
  // A site that isn't on localhost is a real deployment: refuse every development default that
  // would make it unsafe or quietly broken (DECISIONS, "Production settings").
  const problems: string[] = [];
  if (!local) {
    if (e.TURNSTILE_SECRET_KEY === TURNSTILE_TEST_SECRET_KEY) {
      // Fail closed: the test secret passes every token, so it must never guard a real site.
      problems.push(
        "TURNSTILE_SECRET_KEY is Cloudflare's always-pass test key. Set TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY to a real Turnstile widget's keys.",
      );
    }
    if (e.TURNSTILE_SITE_KEY === TURNSTILE_TEST_SITE_KEY) {
      problems.push("TURNSTILE_SITE_KEY is Cloudflare's test key. Set a real widget's site key.");
    }
    if (e.DAILY_SEED_SECRET === DEV_DAILY_SEED_SECRET) {
      problems.push(
        "DAILY_SEED_SECRET is the development value. Set it to a long random string (for example `openssl rand -base64 32`) and keep it secret.",
      );
    }
    if (e.S3_ACCESS_KEY_ID === DEV_S3_ACCESS_KEY_ID) {
      problems.push(
        "S3_ACCESS_KEY_ID is Garage's public development key. Create a key of your own (README, Production).",
      );
    }
    if (publicUrl.protocol !== "https:") {
      problems.push(
        "PUBLIC_URL must be https: the session cookie is Secure and links go out by mail.",
      );
    }
    if (env.SMTP_HOST === undefined) {
      problems.push(
        "SMTP_HOST is not set, so mail would go to localhost:1025. Set the SMTP_* settings.",
      );
    }
    if (e.MAIL_FROM === DEFAULT_MAIL_FROM) {
      problems.push("MAIL_FROM is the development address. Set an address at your own domain.");
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `PUBLIC_URL (${e.PUBLIC_URL}) is not localhost, so these development settings are refused:\n  ${problems.join("\n  ")}`,
    );
  }
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
    workerId: `${e.WORKER_ID ?? hostname()}-${process.pid}`,
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
    publicUrl: e.PUBLIC_URL.replace(/\/+$/, ""),
    trustProxy: e.TRUST_PROXY,
    turnstile: { siteKey: e.TURNSTILE_SITE_KEY, secretKey: e.TURNSTILE_SECRET_KEY },
    smtp: {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      user: e.SMTP_USER,
      password: e.SMTP_PASSWORD,
      from: e.MAIL_FROM,
      requireTls: e.SMTP_REQUIRE_TLS,
    },
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
    dailies: { seedSecret: e.DAILY_SEED_SECRET, daysAhead: e.DAILY_DAYS_AHEAD, stockMs: 60_000 },
    version: e.APP_VERSION,
    metrics: {
      host: e.METRICS_HOST,
      apiPort: e.API_METRICS_PORT,
      workerPort: e.WORKER_METRICS_PORT,
    },
  };
}
````

**Edit `apps/server/src/config.test.ts`**: 4 replacements, in order.

1. Find:
````ts
      },
      sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
      dailies: { seedSecret: "loophole-dev-daily-seed-secret", daysAhead: 3, stockMs: 60_000 },
    });
    expect(config.workerId).toContain(String(process.pid));
  });
````
   Replace with:
````ts
      },
      sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
      dailies: { seedSecret: "loophole-dev-daily-seed-secret", daysAhead: 3, stockMs: 60_000 },
      version: "dev",
      metrics: { host: "127.0.0.1", apiPort: 0, workerPort: 0 },
    });
    expect(config.workerId).toContain(String(process.pid));
  });
````

2. Find:
````ts
      WEB_DIR: "apps/web/build",
      WORKER_ID: "w1",
      GENERATE_TIMEOUT_MS: "1000",
    });
    expect(config).toMatchObject({
      port: 8080,
````
   Replace with:
````ts
      WEB_DIR: "apps/web/build",
      WORKER_ID: "w1",
      GENERATE_TIMEOUT_MS: "1000",
      APP_VERSION: "4f8cb61",
      METRICS_HOST: "0.0.0.0",
      API_METRICS_PORT: "9464",
      WORKER_METRICS_PORT: "9465",
    });
    expect(config).toMatchObject({
      port: 8080,
````

3. Find:
````ts
      webDir: "apps/web/build",
      workerId: `w1-${process.pid}`,
      jobs: { generateTimeoutMs: 1000 },
    });
  });

````
   Replace with:
````ts
      webDir: "apps/web/build",
      workerId: `w1-${process.pid}`,
      jobs: { generateTimeoutMs: 1000 },
      version: "4f8cb61",
      metrics: { host: "0.0.0.0", apiPort: 9464, workerPort: 9465 },
    });
  });

````

4. Find:
````ts
    expect(() => loadConfig({ ...site, DAILY_SEED_SECRET: "short" })).toThrow(/DAILY_SEED_SECRET/);
  });

  test("requires PUBLIC_URL: there is no default", () => {
    expect(() => loadConfig({ ...S3, PUBLIC_URL: undefined })).toThrow(/PUBLIC_URL/);
  });
````
   Replace with:
````ts
    expect(() => loadConfig({ ...site, DAILY_SEED_SECRET: "short" })).toThrow(/DAILY_SEED_SECRET/);
  });

  test("refuses every development default for a site that isn't on localhost, naming each", () => {
    let message = "";
    try {
      loadConfig({
        ...S3,
        S3_ACCESS_KEY_ID: "GK1a2b3c4d5e6f708192a3b4c5",
        PUBLIC_URL: "http://loophole.example",
      });
    } catch (err) {
      message = (err as Error).message;
    }
    for (const name of [
      "TURNSTILE_SECRET_KEY",
      "TURNSTILE_SITE_KEY",
      "DAILY_SEED_SECRET",
      "S3_ACCESS_KEY_ID",
      "PUBLIC_URL must be https",
      "SMTP_HOST",
      "MAIL_FROM",
    ]) {
      expect(message).toContain(name);
    }
  });

  test("a production site with its own settings starts", () => {
    const config = loadConfig({
      ...S3,
      PUBLIC_URL: "https://loophole.example",
      TURNSTILE_SITE_KEY: "site",
      TURNSTILE_SECRET_KEY: "secret",
      DAILY_SEED_SECRET: "a-long-random-production-secret",
      SMTP_HOST: "smtp.example",
      MAIL_FROM: "Loophole <hi@loophole.example>",
    });
    expect(config.publicUrl).toBe("https://loophole.example");
  });

  test("requires PUBLIC_URL: there is no default", () => {
    expect(() => loadConfig({ ...S3, PUBLIC_URL: undefined })).toThrow(/PUBLIC_URL/);
  });
````

**Edit `.env.example`**: 1 replacement, in order.

1. Find:
````example
DAILY_SEED_SECRET=loophole-dev-daily-seed-secret
# How many days, today included, the worker keeps generated.
# DAILY_DAYS_AHEAD=3
````
   Replace with:
````example
DAILY_SEED_SECRET=loophole-dev-daily-seed-secret
# How many days, today included, the worker keeps generated.
# DAILY_DAYS_AHEAD=3

# Monitoring: each process can serve Prometheus metrics on a port of its own (0 or unset: off).
# METRICS_HOST=127.0.0.1
# API_METRICS_PORT=9470
# WORKER_METRICS_PORT=9471
````

**Verify:** `bun run check`; `bun test apps/server/src/config.test.ts` shows 10 pass.

**Commit:** `feat(server): refuse development settings on a public site; metrics and version settings`

### A3 Metrics, JSON logs and health checks behind ports

The layering stays as it is: managers and adapters report counts through two new ports, `ApiMetrics` and `WorkerMetrics`; only `adapters/metrics/prometheus.ts` imports `prom-client`. Biome's import rules now refuse `prom-client` in managers and routes, as they refuse `nodemailer`. The metrics deps are optional, so existing tests need no change. Mail failures and rate-limiter evictions are callbacks on those two adapters. The job queue gets two reads for the gauges and the health report, and the submissions table one (decided submissions by verdict, for PRD §10's share rejected as `unknown`). The log writer masks runs of 40 or more base64url characters, dashes included: session and mailed tokens are 43 characters and about half contain a `-`. `adapters/logging.ts` replaces `console.*` with JSON line writers that mask emails, tokens and secrets; `request-context.ts` holds the request id for log lines. `HealthManager` checks the database and the blob store and builds the admin report. Nothing is wired into the processes yet (A4).

**Run** (add prom-client to the server; 15.1.3 is the latest release, from June 2024):

```sh
cd apps/server && bun add --exact prom-client@15.1.3
```

**Edit `biome.json`**: 2 replacements, in order.

1. Find:
````json
                  "hono": "Managers know nothing of HTTP; routes in api/ translate for them.",
                  "@hono/zod-openapi": "Managers know nothing of HTTP; routes in api/ translate for them.",
                  "zod": "Input is validated at the entrypoints, before it reaches a manager.",
                  "nodemailer": "Managers send mail through the Mailer interface in ports.ts."
                },
                "patterns": [
                  {
````
   Replace with:
````json
                  "hono": "Managers know nothing of HTTP; routes in api/ translate for them.",
                  "@hono/zod-openapi": "Managers know nothing of HTTP; routes in api/ translate for them.",
                  "zod": "Input is validated at the entrypoints, before it reaches a manager.",
                  "nodemailer": "Managers send mail through the Mailer interface in ports.ts.",
                  "prom-client": "Managers count through the ApiMetrics and WorkerMetrics interfaces in ports.ts."
                },
                "patterns": [
                  {
````

2. Find:
````json
              "options": {
                "paths": {
                  "bun:sqlite": "Entrypoints call managers; only the composition roots build adapters.",
                  "nodemailer": "Entrypoints call managers; only the composition roots build adapters."
                },
                "patterns": [
                  {
````
   Replace with:
````json
              "options": {
                "paths": {
                  "bun:sqlite": "Entrypoints call managers; only the composition roots build adapters.",
                  "nodemailer": "Entrypoints call managers; only the composition roots build adapters.",
                  "prom-client": "Entrypoints report through the ApiMetrics and WorkerMetrics interfaces in ports.ts."
                },
                "patterns": [
                  {
````

**Edit `apps/server/src/ports.ts`**: 4 replacements, in order.

1. Find:
````ts
  DailyRecord,
  Job,
  JobInput,
  JobResult,
  LeaderboardSlice,
  ProgressRecord,
````
   Replace with:
````ts
  DailyRecord,
  Job,
  JobInput,
  JobKind,
  JobResult,
  LeaderboardSlice,
  ProgressRecord,
````

2. Find:
````ts
  enqueue(job: NewJob): Job;
  get(id: string): Job | null;
  countQueued(): number;
  /** Atomically takes the oldest queued job for `workerId`, or returns null when there is none. */
  claimNext(workerId: string, now: number): Job | null;
  /** Stores progress (0 to 1); also counts as a heartbeat. */
````
   Replace with:
````ts
  enqueue(job: NewJob): Job;
  get(id: string): Job | null;
  countQueued(): number;
  /** Jobs waiting and running now, and when the oldest waiting one was queued (null if none). */
  countActive(): { queued: number; running: number; oldestQueuedAt: number | null };
  /** The most recently ended jobs that failed or timed out, newest first. */
  listFailed(limit: number): Job[];
  /** Atomically takes the oldest queued job for `workerId`, or returns null when there is none. */
  claimNext(workerId: string, now: number): Job | null;
  /** Stores progress (0 to 1); also counts as a heartbeat. */
````

3. Find:
````ts
  listForUser(userId: string, limit: number): SubmissionRecord[];
  /** Records the decision on a pending submission. Returns false when it was not pending. */
  decide(id: string, decision: SubmissionDecision): boolean;
}

export interface ReportRepository {
````
   Replace with:
````ts
  listForUser(userId: string, limit: number): SubmissionRecord[];
  /** Records the decision on a pending submission. Returns false when it was not pending. */
  decide(id: string, decision: SubmissionDecision): boolean;
  /** How many decided submissions have each verdict (PRD §10: the share rejected as unknown). */
  countByVerdict(): Partial<Record<SubmissionVerdict, number>>;
}

export interface ReportRepository {
````

4. Find:
````ts
export interface DailySeeder {
  seed(day: string, size: number, attempt: number): string;
}
````
   Replace with:
````ts
export interface DailySeeder {
  seed(day: string, size: number, attempt: number): string;
}

/** Why an authentication step was refused, for the auth failure count. */
export type AuthFailure = "login" | "captcha" | "link" | "csrf";

/** What the HTTP API counts for monitoring (Prometheus in production, DECISIONS "Metrics"). */
export interface ApiMetrics {
  /** One answered request. `route` is the route's template (`/api/puzzles/:id`), never the raw path. */
  request(method: string, route: string, status: number, seconds: number): void;
  authFailure(reason: AuthFailure): void;
}

/** What the worker counts for monitoring. */
export interface WorkerMetrics {
  /** A job ended after running for `seconds`. */
  jobFinished(kind: JobKind, status: JobEnd["status"], seconds: number): void;
  /** A daily puzzle's generation failed, timed out or was lost; the next check retries it. */
  dailyFailure(size: number): void;
}
````

**Edit `apps/server/src/adapters/db/job-queue.ts`**: 3 replacements, in order.

1. Find:
````ts
  readonly #insert;
  readonly #get;
  readonly #countQueued;
  readonly #claim;
  readonly #progress;
  readonly #heartbeat;
````
   Replace with:
````ts
  readonly #insert;
  readonly #get;
  readonly #countQueued;
  readonly #countActive;
  readonly #listFailed;
  readonly #claim;
  readonly #progress;
  readonly #heartbeat;
````

2. Find:
````ts
    this.#get = db.query<JobRow, { id: string }>("SELECT * FROM jobs WHERE id = $id");
    this.#countQueued = db.query<{ n: number }, []>(
      "SELECT count(*) AS n FROM jobs WHERE status = 'queued'",
    );
    this.#claim = db.query<JobRow, { worker: string; now: number }>(
      `UPDATE jobs
````
   Replace with:
````ts
    this.#get = db.query<JobRow, { id: string }>("SELECT * FROM jobs WHERE id = $id");
    this.#countQueued = db.query<{ n: number }, []>(
      "SELECT count(*) AS n FROM jobs WHERE status = 'queued'",
    );
    this.#countActive = db.query<{ status: JobStatus; n: number; oldest: number }, []>(
      "SELECT status, count(*) AS n, min(created_at) AS oldest FROM jobs WHERE status IN ('queued', 'running') GROUP BY status",
    );
    this.#listFailed = db.query<JobRow, { limit: number }>(
      "SELECT * FROM jobs WHERE status IN ('failed', 'timeout') ORDER BY finished_at DESC, rowid DESC LIMIT $limit",
    );
    this.#claim = db.query<JobRow, { worker: string; now: number }>(
      `UPDATE jobs
````

3. Find:
````ts
    return this.#countQueued.get()?.n ?? 0;
  }

  claimNext(workerId: string, now: number): Job | null {
    const row = this.#claim.get({ worker: workerId, now });
    return row === null ? null : fromRow(row);
````
   Replace with:
````ts
    return this.#countQueued.get()?.n ?? 0;
  }

  countActive(): { queued: number; running: number; oldestQueuedAt: number | null } {
    const counts = { queued: 0, running: 0, oldestQueuedAt: null as number | null };
    for (const row of this.#countActive.all()) {
      if (row.status === "queued") {
        counts.queued = row.n;
        counts.oldestQueuedAt = row.oldest;
      } else {
        counts.running = row.n;
      }
    }
    return counts;
  }

  listFailed(limit: number): Job[] {
    return this.#listFailed.all({ limit }).map(fromRow);
  }

  claimNext(workerId: string, now: number): Job | null {
    const row = this.#claim.get({ worker: workerId, now });
    return row === null ? null : fromRow(row);
````

**Edit `apps/server/src/adapters/db/job-queue.test.ts`**: 1 replacement, in order.

1. Find:
````ts
    expect(queue.get("a")?.error).toContain("stopped responding");
    expect(queue.get("b")?.status).toBe("queued");
  });
});
````
   Replace with:
````ts
    expect(queue.get("a")?.error).toContain("stopped responding");
    expect(queue.get("b")?.status).toBe("queued");
  });

  test("countActive counts waiting and running jobs; listFailed is newest first", () => {
    const queue = queueWith("a", "b", "c", "d");
    expect(queue.countActive()).toEqual({ queued: 4, running: 0, oldestQueuedAt: 100 });
    queue.claimNext("w", 1);
    queue.claimNext("w", 1);
    queue.claimNext("w", 1);
    expect(queue.countActive()).toEqual({ queued: 1, running: 3, oldestQueuedAt: 103 });
    queue.finish("a", "w", { status: "failed", error: "boom" }, 5);
    queue.finish("b", "w", { status: "timeout", error: "too slow" }, 6);
    queue.finish("c", "w", { status: "done", result: { kind: "generate", puzzleId: "c" } }, 7);
    expect(queue.countActive()).toEqual({ queued: 1, running: 0, oldestQueuedAt: 103 });
    expect(queue.listFailed(10).map((j) => j.id)).toEqual(["b", "a"]);
    expect(queue.listFailed(1).map((j) => j.id)).toEqual(["b"]);
    queue.claimNext("w", 8);
    expect(queue.countActive()).toEqual({ queued: 0, running: 1, oldestQueuedAt: null });
  });
});
````

**Edit `apps/server/src/adapters/db/submission-repository.ts`**: 3 replacements, in order.

1. Find:
````ts
  readonly #get;
  readonly #listForUser;
  readonly #decide;

  constructor(db: Database) {
    this.#insert = db.query<void, SubmissionRow>(
````
   Replace with:
````ts
  readonly #get;
  readonly #listForUser;
  readonly #decide;
  readonly #countByVerdict;

  constructor(db: Database) {
    this.#insert = db.query<void, SubmissionRow>(
````

2. Find:
````ts
    >(
      `UPDATE submissions SET status = $status, verdict = $verdict, puzzle_id = $puzzle, decided_at = $at
       WHERE id = $id AND status = 'pending'`,
    );
  }

````
   Replace with:
````ts
    >(
      `UPDATE submissions SET status = $status, verdict = $verdict, puzzle_id = $puzzle, decided_at = $at
       WHERE id = $id AND status = 'pending'`,
    );
    this.#countByVerdict = db.query<{ verdict: SubmissionVerdict; n: number }, []>(
      "SELECT verdict, count(*) AS n FROM submissions WHERE status <> 'pending' GROUP BY verdict",
    );
  }

````

3. Find:
````ts
      at: d.decidedAt,
    });
    return result.changes === 1;
  }
}

````
   Replace with:
````ts
      at: d.decidedAt,
    });
    return result.changes === 1;
  }

  countByVerdict(): Partial<Record<SubmissionVerdict, number>> {
    return Object.fromEntries(this.#countByVerdict.all().map((r) => [r.verdict, r.n]));
  }
}

````

**Edit `apps/server/src/adapters/db/submission-repository.test.ts`**: 1 replacement, in order.

1. Find:
````ts
    expect(repo.get("a")?.verdict).toBe("multiple");
  });

  test("deleting the account deletes its submissions", () => {
    const { db, repo } = setup();
    repo.insert(record("a", "u1", 1));
````
   Replace with:
````ts
    expect(repo.get("a")?.verdict).toBe("multiple");
  });

  test("countByVerdict counts decided submissions only", () => {
    const { repo } = setup();
    for (const id of ["a", "b", "c", "d"]) repo.insert(record(id, "u1", 1));
    const rejected = { status: "rejected", puzzleId: null, decidedAt: 9 } as const;
    repo.decide("a", { ...rejected, verdict: "unknown" });
    repo.decide("b", { ...rejected, verdict: "unknown" });
    repo.decide("c", { ...rejected, verdict: "multiple" });
    expect(repo.countByVerdict()).toEqual({ unknown: 2, multiple: 1 });
  });

  test("deleting the account deletes its submissions", () => {
    const { db, repo } = setup();
    repo.insert(record("a", "u1", 1));
````

**Edit `apps/server/src/test-support/fakes.ts`**: 3 replacements, in order.

1. Find:
````ts
  ReportRecord,
  SessionRecord,
  SubmissionRecord,
  Task,
  TaskOutcome,
  UserRecord,
````
   Replace with:
````ts
  ReportRecord,
  SessionRecord,
  SubmissionRecord,
  SubmissionVerdict,
  Task,
  TaskOutcome,
  UserRecord,
````

2. Find:
````ts
    this.records.set(id, { ...record, ...decision });
    return true;
  }
}

/** Reports in an array. `published` says which puzzles count as published for the list. */
````
   Replace with:
````ts
    this.records.set(id, { ...record, ...decision });
    return true;
  }

  countByVerdict(): Partial<Record<SubmissionVerdict, number>> {
    const counts: Partial<Record<SubmissionVerdict, number>> = {};
    for (const r of this.records.values()) {
      if (r.verdict !== null) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
    }
    return counts;
  }
}

/** Reports in an array. `published` says which puzzles count as published for the list. */
````

3. Find:
````ts

  countQueued(): number {
    return [...this.jobs.values()].filter((j) => j.status === "queued").length;
  }

  claimNext(workerId: string, now: number): Job | null {
````
   Replace with:
````ts

  countQueued(): number {
    return [...this.jobs.values()].filter((j) => j.status === "queued").length;
  }

  countActive(): { queued: number; running: number; oldestQueuedAt: number | null } {
    const all = [...this.jobs.values()];
    const queued = all.filter((j) => j.status === "queued");
    return {
      queued: queued.length,
      running: all.filter((j) => j.status === "running").length,
      oldestQueuedAt: queued.length === 0 ? null : Math.min(...queued.map((j) => j.createdAt)),
    };
  }

  listFailed(limit: number): Job[] {
    return [...this.jobs.values()]
      .filter((j) => j.status === "failed" || j.status === "timeout")
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
      .slice(0, limit);
  }

  claimNext(workerId: string, now: number): Job | null {
````

**Create `apps/server/src/adapters/metrics/prometheus.ts`**:

````ts
import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from "prom-client";
import type { JobKind, SubmissionVerdict } from "../../domain.ts";
import type { ApiMetrics, AuthFailure, JobEnd, WorkerMetrics } from "../../ports.ts";

/**
 * A registry with the process's standard metrics (CPU, memory, event loop) and
 * `loophole_build_info`, whose labels say which version is running.
 */
export function createRegistry(version: string): Registry {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  new Gauge({
    name: "loophole_build_info",
    help: "Always 1; the labels say which build is running.",
    labelNames: ["version", "runtime"],
    registers: [registry],
  }).set({ version, runtime: `bun ${Bun.version}` }, 1);
  return registry;
}

/** The API's counters. Mail failures and rate-limiter evictions come from adapter callbacks. */
export class PrometheusApiMetrics implements ApiMetrics {
  readonly #requests: Counter<"method" | "route" | "status">;
  readonly #duration: Histogram<"method" | "route">;
  readonly #authFailures: Counter<"reason">;
  readonly #mailFailures: Counter;
  readonly #evictions: Counter;

  constructor(registry: Registry) {
    const registers = [registry];
    this.#requests = new Counter({
      name: "loophole_http_requests_total",
      help: "HTTP requests answered, by method, route template and status.",
      labelNames: ["method", "route", "status"],
      registers,
    });
    this.#duration = new Histogram({
      name: "loophole_http_request_duration_seconds",
      help: "Time to answer an HTTP request, by method and route template.",
      labelNames: ["method", "route"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers,
    });
    this.#authFailures = new Counter({
      name: "loophole_auth_failures_total",
      help: "Refused logins, CAPTCHA checks, mailed links and cross-site requests, by reason.",
      labelNames: ["reason"],
      registers,
    });
    this.#mailFailures = new Counter({
      name: "loophole_mail_failures_total",
      help: "Mails (verification, password reset) that could not be sent.",
      registers,
    });
    this.#evictions = new Counter({
      name: "loophole_rate_limit_evictions_total",
      help: "Rate-limit counters dropped because too many clients were being counted (a flood).",
      registers,
    });
  }

  request(method: string, route: string, status: number, seconds: number): void {
    this.#requests.inc({ method, route, status: String(status) });
    this.#duration.observe({ method, route }, seconds);
  }

  authFailure(reason: AuthFailure): void {
    this.#authFailures.inc({ reason });
  }

  mailFailure(): void {
    this.#mailFailures.inc();
  }

  rateLimitEviction(): void {
    this.#evictions.inc();
  }
}

/** Values the worker's gauges read from the database whenever Prometheus scrapes. */
export interface WorkerGaugeSources {
  /** Jobs waiting and running now. */
  activeJobs(): { queued: number; running: number };
  /** For each daily size class, how many days in a row from today on are generated. */
  dailiesStocked(): readonly { size: number; days: number }[];
  /** Decided submissions by verdict. */
  submissionVerdicts(): Partial<Record<SubmissionVerdict, number>>;
}

/** The worker's counters and gauges. */
export class PrometheusWorkerMetrics implements WorkerMetrics {
  readonly #jobs: Counter<"kind" | "status">;
  readonly #jobDuration: Histogram<"kind" | "status">;
  readonly #dailyFailures: Counter<"size">;

  constructor(registry: Registry, sources: WorkerGaugeSources) {
    const registers = [registry];
    this.#jobs = new Counter({
      name: "loophole_jobs_finished_total",
      help: "Jobs this worker ended, by kind and status (done, failed, timeout).",
      labelNames: ["kind", "status"],
      registers,
    });
    this.#jobDuration = new Histogram({
      name: "loophole_job_duration_seconds",
      help: "Time from claiming a job to ending it, by kind and status.",
      labelNames: ["kind", "status"],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 45, 60],
      registers,
    });
    this.#dailyFailures = new Counter({
      name: "loophole_daily_generation_failures_total",
      help: "Daily puzzle generations that failed, timed out or were lost, by size class.",
      labelNames: ["size"],
      registers,
    });
    new Gauge({
      name: "loophole_jobs",
      help: "Jobs in the queue right now, by status (queued, running).",
      labelNames: ["status"],
      registers,
      collect() {
        const { queued, running } = sources.activeJobs();
        this.set({ status: "queued" }, queued);
        this.set({ status: "running" }, running);
      },
    });
    new Gauge({
      name: "loophole_daily_days_stocked",
      help: "Days in a row, from today on, whose daily puzzle of this size is generated.",
      labelNames: ["size"],
      registers,
      collect() {
        for (const { size, days } of sources.dailiesStocked())
          this.set({ size: String(size) }, days);
      },
    });
    new Gauge({
      name: "loophole_submissions",
      help: "Decided player submissions by verdict (PRD §10: the share rejected as unknown).",
      labelNames: ["verdict"],
      registers,
      collect() {
        for (const [verdict, n] of Object.entries(sources.submissionVerdicts())) {
          this.set({ verdict }, n ?? 0);
        }
      },
    });
  }

  jobFinished(kind: JobKind, status: JobEnd["status"], seconds: number): void {
    this.#jobs.inc({ kind, status });
    this.#jobDuration.observe({ kind, status }, seconds);
  }

  dailyFailure(size: number): void {
    this.#dailyFailures.inc({ size: String(size) });
  }
}

/**
 * Serves `registry` in Prometheus' text format at `GET /metrics`, and `GET /health` (200) for
 * container health checks, on its own port so neither is reachable through the public site.
 */
export function serveMetrics(registry: Registry, hostname: string, port: number) {
  return Bun.serve({
    hostname,
    port,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (request.method === "GET" && pathname === "/metrics") {
        return new Response(await registry.metrics(), {
          headers: { "Content-Type": registry.contentType },
        });
      }
      if (request.method === "GET" && pathname === "/health") return new Response("ok\n");
      return new Response("Not found\n", { status: 404 });
    },
  });
}
````

**Create `apps/server/src/adapters/metrics/prometheus.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import {
  createRegistry,
  PrometheusApiMetrics,
  PrometheusWorkerMetrics,
  serveMetrics,
} from "./prometheus.ts";

describe("Prometheus metrics", () => {
  test("the API's counters come out under their route templates", async () => {
    const registry = createRegistry("test-1");
    const metrics = new PrometheusApiMetrics(registry);
    metrics.request("GET", "/api/puzzles/:id", 200, 0.012);
    metrics.request("GET", "/api/puzzles/:id", 404, 0.002);
    metrics.authFailure("login");
    metrics.mailFailure();
    metrics.rateLimitEviction();
    const text = await registry.metrics();
    expect(text).toContain(
      'loophole_http_requests_total{method="GET",route="/api/puzzles/:id",status="200"} 1',
    );
    expect(text).toContain(
      'loophole_http_request_duration_seconds_count{method="GET",route="/api/puzzles/:id"} 2',
    );
    expect(text).toContain('loophole_auth_failures_total{reason="login"} 1');
    expect(text).toContain("loophole_mail_failures_total 1");
    expect(text).toContain("loophole_rate_limit_evictions_total 1");
    expect(text).toMatch(/loophole_build_info\{version="test-1",runtime="bun [^"]+"\} 1/);
    expect(text).toContain("process_cpu_seconds_total");
  });

  test("the worker's gauges read their sources at every scrape", async () => {
    const registry = createRegistry("test-1");
    let queued = 3;
    const metrics = new PrometheusWorkerMetrics(registry, {
      activeJobs: () => ({ queued, running: 1 }),
      dailiesStocked: () => [
        { size: 7, days: 3 },
        { size: 40, days: 0 },
      ],
      submissionVerdicts: () => ({ unique: 5, unknown: 1 }),
    });
    metrics.jobFinished("generate", "timeout", 60);
    metrics.dailyFailure(40);
    let text = await registry.metrics();
    expect(text).toContain('loophole_jobs{status="queued"} 3');
    expect(text).toContain('loophole_jobs{status="running"} 1');
    expect(text).toContain('loophole_daily_days_stocked{size="7"} 3');
    expect(text).toContain('loophole_daily_days_stocked{size="40"} 0');
    expect(text).toContain('loophole_jobs_finished_total{kind="generate",status="timeout"} 1');
    expect(text).toContain('loophole_daily_generation_failures_total{size="40"} 1');
    expect(text).toContain('loophole_submissions{verdict="unknown"} 1');
    queued = 0;
    text = await registry.metrics();
    expect(text).toContain('loophole_jobs{status="queued"} 0');
  });

  test("serveMetrics answers /metrics and /health on its own port", async () => {
    const registry = createRegistry("test-1");
    const server = serveMetrics(registry, "127.0.0.1", 0);
    try {
      const metrics = await fetch(new URL("/metrics", server.url));
      expect(metrics.status).toBe(200);
      expect(metrics.headers.get("content-type")).toContain("text/plain");
      expect(await metrics.text()).toContain("loophole_build_info");
      expect((await fetch(new URL("/health", server.url))).status).toBe(200);
      expect((await fetch(new URL("/other", server.url))).status).toBe(404);
    } finally {
      server.stop(true);
    }
  });
});
````

**Create `apps/server/src/request-context.ts`**:

````ts
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The request an API log line belongs to. The API's request middleware runs each request inside
 * `requestContext.run`, and the JSON log writer adds the id to every line logged meanwhile.
 */
export const requestContext = new AsyncLocalStorage<{ readonly requestId: string }>();
````

**Create `apps/server/src/adapters/logging.ts`**:

````ts
/**
 * Structured logs: after `installJsonLogging`, every `console.*` call in the process writes one
 * JSON object per line (`time`, `level`, `process`, `msg`, the request id when there is one, and
 * any fields passed as a plain object). Emails, tokens and secrets are masked first, so a log line
 * never holds one (NFR-4, NFR-6).
 */

type Level = "debug" | "info" | "warn" | "error";

export interface JsonLoggingOptions {
  /** `api` or `worker`. */
  readonly process: string;
  /** Fields of the request being handled, if any (the request id). */
  readonly context?: () => Record<string, string> | undefined;
  /** Where a finished line goes; standard output and standard error by default. */
  readonly write?: (level: Level, line: string) => void;
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** `token=…`, `password: …`, `secret=…` and the like, in URLs, fragments and messages. */
const NAMED_SECRET =
  /\b(token|password|secret|authorization|cookie)\b(["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi;
const BEARER = /\bBearer\s+[^\s"']+/gi;
/**
 * Runs of 40 or more base64url characters: session and mailed tokens (43, and they may hold `-` or
 * `_`), keys and secrets. UUIDs (36) and ordinary words stay.
 */
const LONG_TOKEN = /(?<![\w-])[A-Za-z0-9_-]{40,}(?![\w-])/g;
/** Fields whose values are dropped whatever they hold. */
const SECRET_KEY = /pass|secret|token|authorization|cookie|email/i;

/** `text` with emails, tokens and secrets masked. */
export function redact(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(BEARER, "Bearer [redacted]")
    .replace(NAMED_SECRET, "$1$2[redacted]")
    .replace(LONG_TOKEN, "[redacted]");
}

function clean(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") return redact(value);
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message), stack: redact(value.stack ?? "") };
  }
  if (Array.isArray(value)) return value.map((v) => clean(v));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v, k)]));
  }
  return value;
}

/** One log line from a `console.*` call's arguments. */
export function formatLine(
  level: Level,
  args: readonly unknown[],
  process: string,
  context: Record<string, string> | undefined,
  now = new Date(),
): string {
  const words: string[] = [];
  const fields: Record<string, unknown> = {};
  for (const arg of args) {
    if (arg instanceof Error) fields.err = clean(arg);
    else if (arg !== null && typeof arg === "object" && !Array.isArray(arg)) {
      Object.assign(fields, clean(arg));
    } else words.push(redact(typeof arg === "string" ? arg : String(arg)));
  }
  return JSON.stringify({
    time: now.toISOString(),
    level,
    process,
    msg: words.join(" "),
    ...context,
    ...fields,
  });
}

/** Replaces `console.debug/log/info/warn/error` with JSON line writers. */
export function installJsonLogging(options: JsonLoggingOptions): void {
  const write =
    options.write ??
    ((level: Level, line: string) => {
      if (level === "warn" || level === "error") process.stderr.write(`${line}\n`);
      else process.stdout.write(`${line}\n`);
    });
  const log =
    (level: Level) =>
    (...args: unknown[]) =>
      write(level, formatLine(level, args, options.process, options.context?.()));
  console.debug = log("debug");
  console.log = log("info");
  console.info = log("info");
  console.warn = log("warn");
  console.error = log("error");
}
````

**Create `apps/server/src/adapters/logging.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import { formatLine, installJsonLogging, redact } from "./logging.ts";

describe("redact", () => {
  test("masks emails, tokens, secrets and bearer credentials", () => {
    expect(redact("No account with the email Ann.Lee+x@example.co.uk.")).toBe(
      "No account with the email [email].",
    );
    expect(redact("GET /verify-email#token=abc123 and ?token=xyz")).toBe(
      "GET /verify-email#token=[redacted] and ?token=[redacted]",
    );
    expect(redact('{"password":"hunter22","secret": "s3"}')).toBe(
      '{"password":"[redacted]","secret": "[redacted]"}',
    );
    expect(redact("Authorization: Bearer loophole-dev-metrics-token")).toBe(
      "Authorization: [redacted] [redacted]",
    );
    expect(
      redact("cookie __Host-loophole_session=k3Jd9_aZq0vLmN8xYtR2sW4uB6cE1fG7hI5jK0lM9nO"),
    ).toBe("cookie __Host-loophole_session=[redacted]");
  });

  test("masks tokens that hold dashes, bare or as a cookie value", () => {
    const token = "k3Jd9_aZq0vLm-8xYtR2sW4uB6cE1fG7hI5jK0lM9nO";
    expect(token).toHaveLength(43);
    expect(redact(`session ${token} ended`)).toBe("session [redacted] ended");
    expect(redact(`cookie __Host-loophole_session=${token}`)).toBe(
      "cookie __Host-loophole_session=[redacted]",
    );
  });

  test("keeps job ids, puzzle ids and ordinary words", () => {
    const text =
      "Job 6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b was taken back; result not recorded (apps/server/src/managers/job-run-manager.ts)";
    expect(redact(text)).toBe(text);
  });
});

describe("formatLine", () => {
  test("writes one JSON object with the request id, fields and a cleaned error", () => {
    const err = new Error("SMTP refused ann@example.com");
    const line = JSON.parse(
      formatLine(
        "error",
        [
          "Sending mail failed:",
          err,
          { to: "ann@example.com", password: "hunter22", route: "/api/auth/signup" },
        ],
        "api",
        { requestId: "r1" },
        new Date(0),
      ),
    );
    expect(line).toMatchObject({
      time: "1970-01-01T00:00:00.000Z",
      level: "error",
      process: "api",
      msg: "Sending mail failed:",
      requestId: "r1",
      to: "[email]",
      password: "[redacted]",
      route: "/api/auth/signup",
      err: { name: "Error", message: "SMTP refused [email]" },
    });
    expect(JSON.stringify(line)).not.toContain("ann@example.com");
  });
});

test("installJsonLogging sends every console call through the writer", () => {
  const saved = { ...console };
  const lines: string[] = [];
  try {
    installJsonLogging({
      process: "worker",
      context: () => ({ requestId: "r9" }),
      write: (level, line) => lines.push(`${level} ${line}`),
    });
    console.log("Queued", 4, "daily puzzle generation(s)");
    console.warn("password=hunter22");
  } finally {
    Object.assign(console, saved);
  }
  expect(lines).toHaveLength(2);
  expect(lines[0]).toStartWith("info ");
  expect(JSON.parse(lines[0].slice(5))).toMatchObject({
    msg: "Queued 4 daily puzzle generation(s)",
    process: "worker",
    requestId: "r9",
  });
  expect(JSON.parse(lines[1].slice(5)).msg).toBe("password=[redacted]");
});
````

**Replace the whole of `apps/server/src/adapters/mail/background-mailer.ts`**:

````ts
import type { Mailer, MailMessage } from "../../ports.ts";

/**
 * Hands mail to `inner` without waiting for it: `send` resolves at once, and a failure is only
 * logged. The API then answers before the SMTP round trip, so neither its timing nor an SMTP error
 * shows whether an email has an account. The log line leaves out the message, which holds a token.
 * `onFailure` is called for each failure too, so a mail outage shows up in the metrics.
 */
export class BackgroundMailer implements Mailer {
  readonly #inner: Mailer;
  readonly #onFailure: () => void;

  constructor(inner: Mailer, onFailure: () => void = () => {}) {
    this.#inner = inner;
    this.#onFailure = onFailure;
  }

  async send(message: MailMessage): Promise<void> {
    this.#inner.send(message).catch((err: unknown) => {
      this.#onFailure();
      console.error(`Sending mail failed: ${reason(err)}`);
    });
  }
}

/** A short reason. A refused connection is an AggregateError with an empty message but a code. */
function reason(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err as { code?: unknown }).code;
  return err.message || (typeof code === "string" ? code : err.name);
}
````

**Edit `apps/server/src/adapters/mail/background-mailer.test.ts`**: 1 replacement, in order.

1. Find:
````ts
      throw new Error("connect ECONNREFUSED 127.0.0.1:1025");
    },
  };
  await new BackgroundMailer(inner).send(MESSAGE);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(log).toHaveBeenCalledTimes(1);
  const line = String(log.mock.calls[0][0]);
  expect(line).toBe("Sending mail failed: connect ECONNREFUSED 127.0.0.1:1025");
````
   Replace with:
````ts
      throw new Error("connect ECONNREFUSED 127.0.0.1:1025");
    },
  };
  let failures = 0;
  await new BackgroundMailer(inner, () => failures++).send(MESSAGE);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(failures).toBe(1);
  expect(log).toHaveBeenCalledTimes(1);
  const line = String(log.mock.calls[0][0]);
  expect(line).toBe("Sending mail failed: connect ECONNREFUSED 127.0.0.1:1025");
````

**Edit `apps/server/src/adapters/rate-limiter.ts`**: 2 replacements, in order.

1. Find:
````ts

/**
 * Fixed-window counters in memory. Enough for the single API process; the counts reset when it
 * restarts.
 */
export class MemoryRateLimiter implements RateLimiter {
  readonly #clock: Clock;
  readonly #windows = new Map<string, { start: number; windowMs: number; count: number }>();
  #lastPruneAt = Number.NEGATIVE_INFINITY;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  /** How many keys are being counted. */
````
   Replace with:
````ts

/**
 * Fixed-window counters in memory. Enough for the single API process; the counts reset when it
 * restarts. `onEvict` is called whenever a key is dropped to make room: a sign of a flood.
 */
export class MemoryRateLimiter implements RateLimiter {
  readonly #clock: Clock;
  readonly #onEvict: () => void;
  readonly #windows = new Map<string, { start: number; windowMs: number; count: number }>();
  #lastPruneAt = Number.NEGATIVE_INFINITY;

  constructor(clock: Clock, onEvict: () => void = () => {}) {
    this.#clock = clock;
    this.#onEvict = onEvict;
  }

  /** How many keys are being counted. */
````

2. Find:
````ts
    if (w === undefined && this.#windows.size >= MAX_KEYS) {
      // Map iterates in insertion order, so the first key is the oldest one held.
      const oldest = this.#windows.keys().next();
      if (!oldest.done) this.#windows.delete(oldest.value);
    }
    if (w === undefined || now >= w.start + w.windowMs) {
      w = { start: now, windowMs: rule.windowMs, count: 0 };
````
   Replace with:
````ts
    if (w === undefined && this.#windows.size >= MAX_KEYS) {
      // Map iterates in insertion order, so the first key is the oldest one held.
      const oldest = this.#windows.keys().next();
      if (!oldest.done) {
        this.#windows.delete(oldest.value);
        this.#onEvict();
      }
    }
    if (w === undefined || now >= w.start + w.windowMs) {
      w = { start: now, windowMs: rule.windowMs, count: 0 };
````

**Edit `apps/server/src/adapters/rate-limiter.test.ts`**: 1 replacement, in order.

1. Find:
````ts
});

test("at 100,000 keys, a new key evicts the oldest one instead of being refused", () => {
  const limiter = new MemoryRateLimiter(new FakeClock(0));
  for (let i = 0; i < 100_000; i++) limiter.hit(`k${i}`, RULE);
  limiter.hit("k0", RULE);
  limiter.hit("k0", RULE); // k0 is now at its limit of 3
  expect(limiter.hit("k0", RULE).allowed).toBe(false);
  expect(limiter.hit("new", RULE)).toEqual({ allowed: true });
  expect(limiter.size).toBe(100_000);
  expect(limiter.hit("k0", RULE)).toEqual({ allowed: true }); // k0 was the oldest, so it's gone
});
````
   Replace with:
````ts
});

test("at 100,000 keys, a new key evicts the oldest one instead of being refused", () => {
  let evictions = 0;
  const limiter = new MemoryRateLimiter(new FakeClock(0), () => evictions++);
  for (let i = 0; i < 100_000; i++) limiter.hit(`k${i}`, RULE);
  expect(evictions).toBe(0);
  limiter.hit("k0", RULE);
  limiter.hit("k0", RULE); // k0 is now at its limit of 3
  expect(limiter.hit("k0", RULE).allowed).toBe(false);
  expect(limiter.hit("new", RULE)).toEqual({ allowed: true });
  expect(evictions).toBe(1);
  expect(limiter.size).toBe(100_000);
  expect(limiter.hit("k0", RULE)).toEqual({ allowed: true }); // k0 was the oldest, so it's gone
});
````

**Edit `apps/server/src/managers/job-run-manager.ts`**: 3 replacements, in order.

1. Find:
````ts
import type { Job, JobResult, Task, TaskOutput } from "../domain.ts";
import type { Clock, JobEnd, JobQueue, TaskRunner } from "../ports.ts";
import type { DailyStockManager } from "./daily-stock-manager.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";
import type { SubmissionManager } from "./submission-manager.ts";
````
   Replace with:
````ts
import type { Job, JobResult, Task, TaskOutput } from "../domain.ts";
import type { Clock, JobEnd, JobQueue, TaskRunner, WorkerMetrics } from "../ports.ts";
import type { DailyStockManager } from "./daily-stock-manager.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";
import type { SubmissionManager } from "./submission-manager.ts";
````

2. Find:
````ts
  readonly dailies: Pick<DailyStockManager, "complete">;
  readonly clock: Clock;
  readonly settings: JobRunSettings;
}

/** Runs queued jobs, one at a time per worker: claim, run off-thread, store the outcome. */
````
   Replace with:
````ts
  readonly dailies: Pick<DailyStockManager, "complete">;
  readonly clock: Clock;
  readonly settings: JobRunSettings;
  /** Counts each job's end and running time; tests may leave it out. */
  readonly metrics?: Pick<WorkerMetrics, "jobFinished">;
}

/** Runs queued jobs, one at a time per worker: claim, run off-thread, store the outcome. */
````

3. Find:
````ts
    } finally {
      clearInterval(heartbeat);
    }
    if (!jobs.finish(job.id, workerId, end, clock.now())) {
      console.warn(`Job ${job.id} was taken back; result not recorded`);
    }
    return true;
  }

````
   Replace with:
````ts
    } finally {
      clearInterval(heartbeat);
    }
    const finishedAt = clock.now();
    if (!jobs.finish(job.id, workerId, end, finishedAt)) {
      console.warn(`Job ${job.id} was taken back; result not recorded`);
    }
    this.#deps.metrics?.jobFinished(
      job.kind,
      end.status,
      (finishedAt - (job.startedAt ?? finishedAt)) / 1000,
    );
    return true;
  }

````

**Edit `apps/server/src/managers/job-run-manager.test.ts`**: 4 replacements, in order.

1. Find:
````ts
  });
  /** Daily generations handed to the scheduler, as `job:day`. */
  const dailies: string[] = [];
  const manager = new JobRunManager({
    jobs,
    tasks: runner,
````
   Replace with:
````ts
  });
  /** Daily generations handed to the scheduler, as `job:day`. */
  const dailies: string[] = [];
  /** Jobs counted as ended, as `kind:status:seconds`. */
  const finished: string[] = [];
  const manager = new JobRunManager({
    jobs,
    tasks: runner,
````

2. Find:
````ts
    },
    clock,
    settings,
  });
  const enqueue = (id: string) =>
    jobs.enqueue({
````
   Replace with:
````ts
    },
    clock,
    settings,
    metrics: {
      jobFinished: (kind, status, seconds) => finished.push(`${kind}:${status}:${seconds}`),
    },
  });
  const enqueue = (id: string) =>
    jobs.enqueue({
````

3. Find:
````ts
      job: { kind: "generate", input: { width: 2, height: 2, seed: "s" } },
      createdAt: clock.now(),
    });
  return { clock, jobs, puzzleRepo, blobs, manager, enqueue, dailies };
}

describe("JobRunManager.runNext", () => {
````
   Replace with:
````ts
      job: { kind: "generate", input: { width: 2, height: 2, seed: "s" } },
      createdAt: clock.now(),
    });
  return { clock, jobs, puzzleRepo, blobs, manager, enqueue, dailies, finished };
}

describe("JobRunManager.runNext", () => {
````

4. Find:
````ts
    await manager.runNext("w");
    expect(jobs.get("j1")).toMatchObject({ status: "timeout", result: null });
    expect(jobs.get("j1")?.error).toContain("60 s");
  });

  test("a task error, or a failure storing the result, ends the job as failed", async () => {
````
   Replace with:
````ts
    await manager.runNext("w");
    expect(jobs.get("j1")).toMatchObject({ status: "timeout", result: null });
    expect(jobs.get("j1")?.error).toContain("60 s");
  });

  test("counts each job's end with its kind, status and running time", async () => {
    let during = () => {};
    const runner = new FakeTaskRunner(async () => {
      during();
      return { status: "timeout" };
    });
    const { manager, enqueue, clock, finished } = setup(runner);
    during = () => clock.advance(2500);
    enqueue("j1");
    await manager.runNext("w");
    expect(finished).toEqual(["generate:timeout:2.5"]);
  });

  test("a task error, or a failure storing the result, ends the job as failed", async () => {
````

**Edit `apps/server/src/managers/daily-stock-manager.ts`**: 5 replacements, in order.

1. Find:
````ts
import type { DailyRecord, GeneratedPuzzle } from "../domain.ts";
import type { Clock, DailyRepository, DailySeeder } from "../ports.ts";
import { DAILY_SIZES } from "./daily-manager.ts";
import { addDays, dayStart, utcDay } from "./days.ts";
import type { JobManager } from "./job-manager.ts";
````
   Replace with:
````ts
import type { DailyRecord, GeneratedPuzzle } from "../domain.ts";
import type { Clock, DailyRepository, DailySeeder, WorkerMetrics } from "../ports.ts";
import { DAILY_SIZES } from "./daily-manager.ts";
import { addDays, dayStart, utcDay } from "./days.ts";
import type { JobManager } from "./job-manager.ts";
````

2. Find:
````ts
  readonly clock: Clock;
  readonly newId: () => string;
  readonly settings: DailyStockSettings;
}

/**
````
   Replace with:
````ts
  readonly clock: Clock;
  readonly newId: () => string;
  readonly settings: DailyStockSettings;
  /** Counts failed generations; tests may leave it out. */
  readonly metrics?: Pick<WorkerMetrics, "dailyFailure">;
}

/**
````

3. Find:
````ts
        if (row !== null) {
          const status = jobs.get(row.jobId)?.status ?? "lost";
          if (status === "queued" || status === "running" || status === "done") continue;
          console.warn(
            `Daily ${day} ${size}×${size}: generation attempt ${row.attempt} ${status}; trying the next seed`,
          );
````
   Replace with:
````ts
        if (row !== null) {
          const status = jobs.get(row.jobId)?.status ?? "lost";
          if (status === "queued" || status === "running" || status === "done") continue;
          this.#deps.metrics?.dailyFailure(size);
          console.warn(
            `Daily ${day} ${size}×${size}: generation attempt ${row.attempt} ${status}; trying the next seed`,
          );
````

4. Find:
````ts
      }
    }
    return { queued, missingToday };
  }

  /**
````
   Replace with:
````ts
      }
    }
    return { queued, missingToday };
  }

  /** For each size class, how many days in a row from today on have their puzzle generated. */
  stocked(): { size: number; days: number }[] {
    const { dailies, clock, settings } = this.#deps;
    return stockedDays(dailies, utcDay(clock.now()), settings.daysAhead);
  }

  /**
````

5. Find:
````ts
    });
  }
}
````
   Replace with:
````ts
    });
  }
}

/**
 * For each daily size class, how many days in a row, from `today` up to `daysAhead` days, have
 * their puzzle generated. 0 means today's is missing: players can't play it.
 */
export function stockedDays(
  dailies: DailyRepository,
  today: string,
  daysAhead: number,
): { size: number; days: number }[] {
  return DAILY_SIZES.map((size) => {
    let days = 0;
    while (days < daysAhead && dailies.get(addDays(today, days), size)?.puzzleId) days++;
    return { size, days };
  });
}
````

**Edit `apps/server/src/managers/daily-stock-manager.test.ts`**: 4 replacements, in order.

1. Find:
````ts
  const puzzles = new PuzzleManager({ puzzles: puzzleRepo, blobs: new MemoryBlobStore(), clock });
  // A tiny queue: the scheduler's jobs must get in even when players have filled it.
  const jobs = new JobManager({ jobs: queue, clock, newId: sequentialIds("x"), maxQueued: 1 });
  const stock = new DailyStockManager({
    dailies: repo,
    jobs,
````
   Replace with:
````ts
  const puzzles = new PuzzleManager({ puzzles: puzzleRepo, blobs: new MemoryBlobStore(), clock });
  // A tiny queue: the scheduler's jobs must get in even when players have filled it.
  const jobs = new JobManager({ jobs: queue, clock, newId: sequentialIds("x"), maxQueued: 1 });
  /** Size classes counted as failed generations. */
  const failures: number[] = [];
  const stock = new DailyStockManager({
    dailies: repo,
    jobs,
````

2. Find:
````ts
    clock,
    newId: sequentialIds("j"),
    settings: { daysAhead },
  });
  const dailies = new DailyManager({ dailies: repo, puzzles, clock });
  return { clock, repo, queue, puzzles, puzzleRepo, stock, dailies };
}

/** What a generation job for size `size` makes: a puzzle of that width. */
````
   Replace with:
````ts
    clock,
    newId: sequentialIds("j"),
    settings: { daysAhead },
    metrics: { dailyFailure: (size) => failures.push(size) },
  });
  const dailies = new DailyManager({ dailies: repo, puzzles, clock });
  return { clock, repo, queue, puzzles, puzzleRepo, stock, dailies, failures };
}

/** What a generation job for size `size` makes: a puzzle of that width. */
````

3. Find:
````ts
    expect(puzzles.get("j-5")?.id).toBe("j-5");
  });

  test("retries a failed, timed-out or lost generation with the next seed", () => {
    const { repo, queue, stock } = setup(1);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    stock.stock();
    end(queue, "j-1", "failed");
````
   Replace with:
````ts
    expect(puzzles.get("j-5")?.id).toBe("j-5");
  });

  test("stocked counts, per size, the days in a row from today that are generated", async () => {
    const { stock } = setup(2);
    stock.stock();
    expect(stock.stocked()).toEqual([
      { size: 7, days: 0 },
      { size: 10, days: 0 },
      { size: 20, days: 0 },
      { size: 40, days: 0 },
    ]);
    await stock.complete("j-1", "2026-10-25", generated(7));
    await stock.complete("j-5", "2026-10-26", generated(7));
    // Tomorrow's 10×10 without today's doesn't count: players can't play today's.
    await stock.complete("j-6", "2026-10-26", generated(10));
    expect(stock.stocked().slice(0, 2)).toEqual([
      { size: 7, days: 2 },
      { size: 10, days: 0 },
    ]);
  });

  test("retries a failed, timed-out or lost generation with the next seed", () => {
    const { repo, queue, stock, failures } = setup(1);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    stock.stock();
    end(queue, "j-1", "failed");
````

4. Find:
````ts
    expect(repo.get("2026-10-25", 20)).toMatchObject({ attempt: 1, jobId: "j-7" });
    expect(repo.get("2026-10-25", 40)).toMatchObject({ attempt: 0, jobId: "j-4" });
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

````
   Replace with:
````ts
    expect(repo.get("2026-10-25", 20)).toMatchObject({ attempt: 1, jobId: "j-7" });
    expect(repo.get("2026-10-25", 40)).toMatchObject({ attempt: 0, jobId: "j-4" });
    expect(warn).toHaveBeenCalledTimes(3);
    expect(failures).toEqual([7, 10, 20]);
    warn.mockRestore();
  });

````

**Create `apps/server/src/managers/health-manager.ts`**:

````ts
import { GENERATOR_VERSION } from "@loophole/core";
import type { Job } from "../domain.ts";
import type { BlobStore, Clock, DailyRepository, JobQueue } from "../ports.ts";
import { stockedDays } from "./daily-stock-manager.ts";
import { utcDay } from "./days.ts";

/** One dependency's check. */
export interface Check {
  readonly ok: boolean;
  /** How long the check took, in milliseconds. */
  readonly ms: number;
  /** Why it failed; null when it passed. Only admins see it. */
  readonly error: string | null;
}

/** Whether the API can serve requests: its database and blob store answer. */
export interface Readiness {
  readonly ok: boolean;
  readonly database: Check;
  readonly blobs: Check;
}

/** Which build is running. */
export interface Versions {
  /** The app's version (the git commit in a production image), or "dev". */
  readonly app: string;
  readonly generator: string;
  readonly runtime: string;
}

/** What the admin health page shows (PRD §5: admins view system health). */
export interface HealthReport {
  readonly readiness: Readiness;
  readonly jobs: { queued: number; running: number; oldestQueuedAt: number | null };
  /** For each daily size class, how many days in a row from today on are generated. */
  readonly dailies: readonly { size: number; days: number }[];
  /** The latest failed and timed-out jobs, newest first. */
  readonly failures: readonly Job[];
  readonly versions: Versions;
  readonly startedAt: number;
}

export interface HealthManagerDeps {
  readonly jobs: JobQueue;
  readonly dailies: DailyRepository;
  readonly blobs: BlobStore;
  readonly clock: Clock;
  /** The worker's `DAILY_DAYS_AHEAD`: how many days, today included, it keeps generated. */
  readonly daysAhead: number;
  readonly versions: Omit<Versions, "generator">;
  /** A check that takes longer than this fails. */
  readonly checkTimeoutMs: number;
}

/** A blob key nobody writes: reading it proves the store answers without changing anything. */
const PROBE_KEY = "health/probe";
const FAILURES_SHOWN = 10;

/** Health checks for container orchestration and the admins' health page. */
export class HealthManager {
  readonly #deps: HealthManagerDeps;
  readonly #startedAt: number;

  constructor(deps: HealthManagerDeps) {
    this.#deps = deps;
    this.#startedAt = deps.clock.now();
  }

  /** Checks the database and the blob store. */
  async readiness(): Promise<Readiness> {
    const { jobs, blobs } = this.#deps;
    const [database, blobCheck] = await Promise.all([
      this.#check(async () => {
        jobs.countActive();
      }),
      this.#check(async () => {
        await blobs.get(PROBE_KEY);
      }),
    ]);
    return { ok: database.ok && blobCheck.ok, database, blobs: blobCheck };
  }

  /** Readiness plus the queue, the daily stock, recent failures and versions. */
  async report(): Promise<HealthReport> {
    const { jobs, dailies, clock, daysAhead, versions } = this.#deps;
    const readiness = await this.readiness();
    const safe = <T>(read: () => T, fallback: T): T => {
      try {
        return read();
      } catch {
        return fallback;
      }
    };
    return {
      readiness,
      jobs: safe(() => jobs.countActive(), { queued: 0, running: 0, oldestQueuedAt: null }),
      dailies: safe(() => stockedDays(dailies, utcDay(clock.now()), daysAhead), []),
      failures: safe(() => jobs.listFailed(FAILURES_SHOWN), []),
      versions: { ...versions, generator: GENERATOR_VERSION },
      startedAt: this.#startedAt,
    };
  }

  async #check(run: () => Promise<void>): Promise<Check> {
    const { clock, checkTimeoutMs } = this.#deps;
    const started = clock.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`No answer within ${checkTimeoutMs} ms`)),
        checkTimeoutMs,
      );
    });
    try {
      await Promise.race([run(), timeout]);
      return { ok: true, ms: clock.now() - started, error: null };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, ms: clock.now() - started, error };
    } finally {
      clearTimeout(timer);
    }
  }
}
````

**Create `apps/server/src/managers/health-manager.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import { GENERATOR_VERSION } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import type { BlobStore } from "../ports.ts";
import { FakeClock, FakeDailyRepository, FakeJobQueue } from "../test-support/fakes.ts";
import { HealthManager } from "./health-manager.ts";

const NOW = Date.UTC(2026, 9, 25, 12);

function setup(blobs: BlobStore = new MemoryBlobStore()) {
  const jobs = new FakeJobQueue();
  const dailies = new FakeDailyRepository();
  const health = new HealthManager({
    jobs,
    dailies,
    blobs,
    clock: new FakeClock(NOW),
    daysAhead: 3,
    versions: { app: "abc123", runtime: "bun 1.3.13" },
    checkTimeoutMs: 20,
  });
  return { health, jobs, dailies };
}

function stock(dailies: FakeDailyRepository, day: string, size: number) {
  dailies.insert({
    day,
    size,
    attempt: 0,
    jobId: `${day}-${size}`,
    puzzleId: `${day}-${size}`,
    generatorVersion: "1",
    createdAt: 0,
  });
}

describe("HealthManager", () => {
  test("is ready when the database and the blob store answer", async () => {
    const r = await setup().health.readiness();
    expect(r.ok).toBe(true);
    expect(r.database).toMatchObject({ ok: true, error: null });
    expect(r.blobs).toMatchObject({ ok: true, error: null });
  });

  test("is not ready when the blob store fails or doesn't answer in time", async () => {
    const failing: BlobStore = {
      put: async () => {},
      get: async () => {
        throw new Error("connection refused");
      },
      delete: async () => {},
    };
    let r = await setup(failing).health.readiness();
    expect(r.ok).toBe(false);
    expect(r.blobs).toMatchObject({ ok: false, error: "connection refused" });
    const silent: BlobStore = { ...failing, get: () => new Promise(() => {}) };
    r = await setup(silent).health.readiness();
    expect(r.ok).toBe(false);
    expect(r.blobs.error).toBe("No answer within 20 ms");
    expect(r.database.ok).toBe(true);
  });

  test("is not ready when the database throws", async () => {
    const { health, jobs } = setup();
    jobs.countActive = () => {
      throw new Error("database is locked");
    };
    const r = await health.readiness();
    expect(r.ok).toBe(false);
    expect(r.database).toMatchObject({ ok: false, error: "database is locked" });
  });

  test("reports the queue, the daily stock, recent failures and versions", async () => {
    const { health, jobs, dailies } = setup();
    jobs.enqueue({
      id: "f",
      job: { kind: "verify", input: { puzzle: { v: 1, width: 1, height: 1, clues: "." } } },
      createdAt: 1,
    });
    jobs.enqueue({
      id: "q",
      job: { kind: "generate", input: { width: 5, height: 5, seed: "s" } },
      createdAt: 7,
    });
    jobs.claimNext("w", 2);
    jobs.finish("f", "w", { status: "timeout", error: "Stopped after the 45 s time limit." }, 3);
    stock(dailies, "2026-10-25", 7);
    stock(dailies, "2026-10-26", 7);
    stock(dailies, "2026-10-26", 10);
    const report = await health.report();
    expect(report.readiness.ok).toBe(true);
    expect(report.jobs).toEqual({ queued: 1, running: 0, oldestQueuedAt: 7 });
    expect(report.dailies).toEqual([
      { size: 7, days: 2 },
      { size: 10, days: 0 },
      { size: 20, days: 0 },
      { size: 40, days: 0 },
    ]);
    expect(report.failures.map((j) => [j.id, j.status, j.error])).toEqual([
      ["f", "timeout", "Stopped after the 45 s time limit."],
    ]);
    expect(report.versions).toEqual({
      app: "abc123",
      generator: GENERATOR_VERSION,
      runtime: "bun 1.3.13",
    });
    expect(report.startedAt).toBe(NOW);
  });
});
````

**Verify:** `bun run check`; `bun test apps/server/src/adapters apps/server/src/managers` passes, including the new `prometheus.test.ts`, `logging.test.ts` (redaction) and `health-manager.test.ts`.

**Commit:** `feat(server): metrics, JSON logs and health checks behind ports`

### A4 Wire it in: metrics listeners, request ids, readiness and the admin report

The API gets a first middleware (`api/observe.ts`) that gives each request an id (`X-Request-Id`, kept from a proxy when well-formed), runs it in the request context, counts it under its **route template** (`routePath` from `hono/route`, so `/api/puzzles/:id`, never a raw path) and logs one line per answer (method, route, status, ms; route tests leave the access log off). Refused logins, CAPTCHA checks, mailed links and cross-site requests count as auth failures. New routes: `GET /api/health/ready` (200 or 503, no error text) and `GET /api/admin/health` (admins only). Every `createApp` call now passes `health`; route tests get it from `test-support/health.ts`. The composition roots install the JSON logger, build the Prometheus registry and serve `/metrics` (and `/health`) on their own port when one is set. The auth end-to-end config turns those listeners off, since a developer's `.env` may turn them on for the dev servers.

**Create `apps/server/src/api/observe.ts`**:

````ts
import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import type { ApiMetrics } from "../ports.ts";
import { requestContext } from "../request-context.ts";

/** A request id from the proxy is kept if it looks like one; otherwise the API makes its own. */
const REQUEST_ID = /^[\w.:-]{1,64}$/;

/**
 * Gives every request an id (`X-Request-Id`, passed on from a proxy or made here), runs it in the
 * request context so log lines carry the id, counts it by route template and logs one line when
 * it is answered (with `accessLog`). The line has the method, route template, status and time: no
 * path, query, address or body, so no ids from the URL, tokens or emails reach the log. Health
 * checks that pass aren't logged.
 */
export function observe(metrics: ApiMetrics, accessLog: boolean): MiddlewareHandler {
  return async (c, next) => {
    const given = c.req.header("X-Request-Id");
    const requestId = given !== undefined && REQUEST_ID.test(given) ? given : crypto.randomUUID();
    const started = performance.now();
    await requestContext.run({ requestId }, async () => {
      await next();
      c.header("X-Request-Id", requestId);
      const route = routePath(c) || "unmatched";
      const status = c.res.status;
      const seconds = (performance.now() - started) / 1000;
      metrics.request(c.req.method, route, status, seconds);
      if (!accessLog || (route.startsWith("/api/health") && status < 400)) return;
      const level = status >= 500 ? "error" : "info";
      console[level]("request", {
        method: c.req.method,
        route,
        status,
        ms: Math.round(seconds * 1000),
      });
    });
  };
}
````

**Replace the whole of `apps/server/src/api/csrf.ts`**:

````ts
import type { MiddlewareHandler } from "hono";
import type { ApiMetrics } from "../ports.ts";
import { problem } from "./problem.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a request comes from this site's own pages (or from no browser at all). Browsers send
 * Sec-Fetch-Site on every request; older ones send at least Origin on a cross-origin POST.
 * Without either header the request isn't from a browser, so it carries no victim's cookies.
 */
function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site !== null) return site === "same-origin" || site === "none";
  const origin = request.headers.get("Origin");
  if (origin === null) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false; // "null" and other opaque origins
  }
}

/**
 * CSRF protection (NFR-4): refuses state-changing requests made from other sites. It backs up the
 * session cookie's SameSite=Lax and the JSON-only request bodies. See DECISIONS, "CSRF".
 */
export function sameOriginOnly(metrics: Pick<ApiMetrics, "authFailure">): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method) || isSameOrigin(c.req.raw)) return next();
    metrics.authFailure("csrf");
    return problem(c, 403, "Cross-site request refused", {
      detail: "State-changing requests must come from this site's own pages.",
    });
  };
}
````

**Create `apps/server/src/api/health-schemas.ts`**:

````ts
import { z } from "@hono/zod-openapi";

// Bodies of the readiness check and the admins' health report.

const Timestamp = z.iso.datetime().openapi({ example: "2026-10-25T12:00:00.000Z" });

export const ReadinessSchema = z
  .object({
    status: z.enum(["ok", "unavailable"]),
    database: z.boolean(),
    blobs: z.boolean(),
  })
  .openapi("Readiness", {
    description: "Whether the API's database and blob store answer. No error details.",
  });

const CheckSchema = z.object({
  ok: z.boolean(),
  ms: z.number().min(0),
  error: z.string().nullable(),
});

export const AdminHealthSchema = z
  .object({
    database: CheckSchema,
    blobs: CheckSchema,
    jobs: z.object({
      queued: z.int().min(0),
      running: z.int().min(0),
      oldestQueuedAt: Timestamp.nullable(),
    }),
    dailies: z
      .array(z.object({ size: z.int(), days: z.int().min(0) }))
      .openapi({ description: "Days in a row, from today on, whose daily puzzle is generated." }),
    failures: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(["generate", "verify"]),
        status: z.enum(["failed", "timeout"]),
        error: z.string().nullable(),
        finishedAt: Timestamp.nullable(),
      }),
    ),
    versions: z.object({ app: z.string(), generator: z.string(), runtime: z.string() }),
    startedAt: Timestamp,
  })
  .openapi("AdminHealth", { description: "System health for the admin page (PRD §5)." });
````

**Create `apps/server/src/api/health.ts`**:

````ts
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { HealthManager, HealthReport } from "../managers/health-manager.ts";
import type { SessionManager } from "../managers/session-manager.ts";
import { AdminHealthSchema, ReadinessSchema } from "./health-schemas.ts";
import { problem, problemResponse } from "./problem.ts";
import { currentUser } from "./session-cookie.ts";

export interface HealthRouteDeps {
  readonly health: HealthManager;
  readonly sessions: SessionManager;
}

const readyRoute = createRoute({
  method: "get",
  path: "/api/health/ready",
  summary: "Readiness check: the database and the blob store answer",
  description:
    "For container health checks and load balancers. `/api/health` only says the process is up.",
  responses: {
    200: { description: "Ready.", content: { "application/json": { schema: ReadinessSchema } } },
    503: {
      description: "The database or the blob store isn't answering.",
      content: { "application/json": { schema: ReadinessSchema } },
    },
  },
});

const adminHealthRoute = createRoute({
  method: "get",
  path: "/api/admin/health",
  summary: "System health: checks, job queue, daily stock, recent failures, versions (admins only)",
  security: [{ session: [] }],
  responses: {
    200: {
      description: "The health report.",
      content: { "application/json": { schema: AdminHealthSchema } },
    },
    401: problemResponse("Not logged in."),
    403: problemResponse("Not an admin."),
  },
});

/** Readiness for orchestration, and the admins' health report. */
export function registerHealthRoutes(app: OpenAPIHono, deps: HealthRouteDeps): void {
  const { health, sessions } = deps;

  app.openapi(readyRoute, async (c) => {
    const r = await health.readiness();
    const body = {
      status: r.ok ? ("ok" as const) : ("unavailable" as const),
      database: r.database.ok,
      blobs: r.blobs.ok,
    };
    return r.ok ? c.json(body, 200) : c.json(body, 503);
  });

  app.openapi(adminHealthRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    if (!user.isAdmin) return problem(c, 403, "Admins only");
    return c.json(toAdminHealthDto(await health.report()), 200);
  });
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function toAdminHealthDto(r: HealthReport) {
  return {
    database: r.readiness.database,
    blobs: r.readiness.blobs,
    jobs: {
      queued: r.jobs.queued,
      running: r.jobs.running,
      oldestQueuedAt: r.jobs.oldestQueuedAt === null ? null : iso(r.jobs.oldestQueuedAt),
    },
    dailies: r.dailies.map((d) => ({ size: d.size, days: d.days })),
    failures: r.failures.map((j) => ({
      id: j.id,
      kind: j.kind,
      status: j.status === "timeout" ? ("timeout" as const) : ("failed" as const),
      error: j.error,
      finishedAt: j.finishedAt === null ? null : iso(j.finishedAt),
    })),
    versions: r.versions,
    startedAt: iso(r.startedAt),
  };
}
````

**Edit `apps/server/src/api/app.ts`**: 6 replacements, in order.

1. Find:
````ts
import type { JobManager } from "../managers/job-manager.ts";
import type { ProgressManager } from "../managers/progress-manager.ts";
import type { PuzzleManager } from "../managers/puzzle-manager.ts";
import { type AccountRouteDeps, registerAccountRoutes, tooManyRequests } from "./accounts.ts";
import { sameOriginOnly } from "./csrf.ts";
import { type DailyRouteDeps, registerDailyRoutes } from "./daily.ts";
import { problem, problemResponse } from "./problem.ts";
import { registerProgressRoutes } from "./progress.ts";
import { type ReportRouteDeps, registerReportRoutes } from "./reports.ts";
````
   Replace with:
````ts
import type { JobManager } from "../managers/job-manager.ts";
import type { ProgressManager } from "../managers/progress-manager.ts";
import type { PuzzleManager } from "../managers/puzzle-manager.ts";
import type { ApiMetrics } from "../ports.ts";
import { type AccountRouteDeps, registerAccountRoutes, tooManyRequests } from "./accounts.ts";
import { sameOriginOnly } from "./csrf.ts";
import { type DailyRouteDeps, registerDailyRoutes } from "./daily.ts";
import { type HealthRouteDeps, registerHealthRoutes } from "./health.ts";
import { observe } from "./observe.ts";
import { problem, problemResponse } from "./problem.ts";
import { registerProgressRoutes } from "./progress.ts";
import { type ReportRouteDeps, registerReportRoutes } from "./reports.ts";
````

2. Find:
````ts
  extends AccountRouteDeps,
    SubmissionRouteDeps,
    ReportRouteDeps,
    DailyRouteDeps {
  readonly puzzles: PuzzleManager;
  readonly jobs: JobManager;
  readonly hints: HintManager;
  readonly progress: ProgressManager;
  /** Folder of the built web app to serve at `/`, with `index.html` for unknown paths. */
  readonly webDir?: string;
}

/** Largest request body the API reads. Leaves room for a 100×100 puzzle (about 10 KB). */
const MAX_BODY_BYTES = 64 * 1024;
````
   Replace with:
````ts
  extends AccountRouteDeps,
    SubmissionRouteDeps,
    ReportRouteDeps,
    DailyRouteDeps,
    HealthRouteDeps {
  readonly puzzles: PuzzleManager;
  readonly jobs: JobManager;
  readonly hints: HintManager;
  readonly progress: ProgressManager;
  /** Folder of the built web app to serve at `/`, with `index.html` for unknown paths. */
  readonly webDir?: string;
  /** Request counts and auth failures for monitoring; route tests leave it out. */
  readonly metrics?: ApiMetrics;
  /** Log a line for every answered request (the API process turns it on). */
  readonly accessLog?: boolean;
}

const NO_METRICS: ApiMetrics = { request() {}, authFailure() {} };

/** Largest request body the API reads. Leaves room for a 100×100 puzzle (about 10 KB). */
const MAX_BODY_BYTES = 64 * 1024;
````

3. Find:
````ts
/** The HTTP API: routes translate between wire shapes and domain types; managers do the work. */
export function createApp(deps: AppDeps): OpenAPIHono {
  const { puzzles, jobs, hints } = deps;
  const app = new OpenAPIHono({ defaultHook: validationHook });

  app.use(
    "/api/*",
    bodyLimit({
````
   Replace with:
````ts
/** The HTTP API: routes translate between wire shapes and domain types; managers do the work. */
export function createApp(deps: AppDeps): OpenAPIHono {
  const { puzzles, jobs, hints } = deps;
  const metrics = deps.metrics ?? NO_METRICS;
  const app = new OpenAPIHono({ defaultHook: validationHook });

  app.use("*", observe(metrics, deps.accessLog ?? false));
  app.use(
    "/api/*",
    bodyLimit({
````

4. Find:
````ts
      onError: (c) => problem(c, 413, "Request body too large"),
    }),
  );
  app.use("/api/*", sameOriginOnly);

  app.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));

````
   Replace with:
````ts
      onError: (c) => problem(c, 413, "Request body too large"),
    }),
  );
  app.use("/api/*", sameOriginOnly(metrics));

  app.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));

````

5. Find:
````ts
  registerSubmissionRoutes(app, deps);
  registerReportRoutes(app, deps);
  registerDailyRoutes(app, deps);

  app.all("/api/*", (c) => problem(c, 404, "Not found"));

````
   Replace with:
````ts
  registerSubmissionRoutes(app, deps);
  registerReportRoutes(app, deps);
  registerDailyRoutes(app, deps);
  registerHealthRoutes(app, deps);

  app.all("/api/*", (c) => problem(c, 404, "Not found"));

````

6. Find:
````ts
      return problem(c, 400, "Invalid board", { detail: err.message });
    if (err instanceof PuzzleNotFoundError)
      return problem(c, 404, "Puzzle not found", { detail: err.message });
    if (err instanceof InvalidCredentialsError)
      return problem(c, 401, "Wrong email or password", { detail: err.message });
    if (err instanceof CaptchaFailedError)
      return problem(c, 400, "CAPTCHA check failed", { detail: err.message });
    if (err instanceof InvalidTokenError)
      return problem(c, 400, "Invalid or expired link", { detail: err.message });
    if (err instanceof DailyNotFoundError)
      return problem(c, 404, "Daily puzzle not found", { detail: err.message });
    if (err instanceof DailyEndedError)
````
   Replace with:
````ts
      return problem(c, 400, "Invalid board", { detail: err.message });
    if (err instanceof PuzzleNotFoundError)
      return problem(c, 404, "Puzzle not found", { detail: err.message });
    if (err instanceof InvalidCredentialsError) {
      metrics.authFailure("login");
      return problem(c, 401, "Wrong email or password", { detail: err.message });
    }
    if (err instanceof CaptchaFailedError) {
      metrics.authFailure("captcha");
      return problem(c, 400, "CAPTCHA check failed", { detail: err.message });
    }
    if (err instanceof InvalidTokenError) {
      metrics.authFailure("link");
      return problem(c, 400, "Invalid or expired link", { detail: err.message });
    }
    if (err instanceof DailyNotFoundError)
      return problem(c, 404, "Daily puzzle not found", { detail: err.message });
    if (err instanceof DailyEndedError)
````

**Create `apps/server/src/test-support/health.ts`**:

````ts
import type { Database } from "bun:sqlite";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { SqliteDailyRepository } from "../adapters/db/daily-repository.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { HealthManager } from "../managers/health-manager.ts";
import type { BlobStore, Clock } from "../ports.ts";

/** The health manager for route tests, over the SQLite tables on `db` and an in-memory blob store. */
export function healthManager(
  db: Database,
  clock: Clock,
  blobs: BlobStore = new MemoryBlobStore(),
) {
  return new HealthManager({
    jobs: new SqliteJobQueue(db),
    dailies: new SqliteDailyRepository(db),
    blobs,
    clock,
    daysAhead: 3,
    versions: { app: "test", runtime: "bun test" },
    checkTimeoutMs: 1000,
  });
}
````

**Edit `apps/server/src/api/accounts.test.ts`**: 2 replacements, in order.

1. Find:
````ts
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
````
   Replace with:
````ts
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { healthManager } from "../test-support/health.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
````

2. Find:
````ts
    puzzles,
    ...dailyDeps(db, clock, puzzles),
    progress: sqliteProgress(db, puzzles, clock),
    jobs,
    ...submissionDeps(db, clock, puzzles, jobs),
    ...deps,
````
   Replace with:
````ts
    puzzles,
    ...dailyDeps(db, clock, puzzles),
    progress: sqliteProgress(db, puzzles, clock),
    health: healthManager(db, clock),
    jobs,
    ...submissionDeps(db, clock, puzzles, jobs),
    ...deps,
````

**Edit `apps/server/src/api/app.test.ts`**: 2 replacements, in order.

1. Find:
````ts
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
````
   Replace with:
````ts
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { healthManager } from "../test-support/health.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
````

2. Find:
````ts
    ...accountDeps(db, clock),
    ...dailyDeps(db, clock, puzzles),
    progress: sqliteProgress(db, puzzles, clock),
    ...submissionDeps(db, clock, puzzles, jobs),
    webDir: options.webDir,
  });
````
   Replace with:
````ts
    ...accountDeps(db, clock),
    ...dailyDeps(db, clock, puzzles),
    progress: sqliteProgress(db, puzzles, clock),
    health: healthManager(db, clock),
    ...submissionDeps(db, clock, puzzles, jobs),
    webDir: options.webDir,
  });
````

**Edit `apps/server/src/api/daily.test.ts`**: 2 replacements, in order.

1. Find:
````ts
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps, SMALL_DAILY, storeDaily } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
````
   Replace with:
````ts
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps, SMALL_DAILY, storeDaily } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { healthManager } from "../test-support/health.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
````

2. Find:
````ts
    puzzles,
    jobs,
    progress: sqliteProgress(db, puzzles, clock),
    ...submissionDeps(db, clock, puzzles, jobs),
    ...daily,
    ...deps,
````
   Replace with:
````ts
    puzzles,
    jobs,
    progress: sqliteProgress(db, puzzles, clock),
    health: healthManager(db, clock),
    ...submissionDeps(db, clock, puzzles, jobs),
    ...daily,
    ...deps,
````

**Edit `apps/server/src/api/progress.test.ts`**: 2 replacements, in order.

1. Find:
````ts
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
````
   Replace with:
````ts
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { healthManager } from "../test-support/health.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
````

2. Find:
````ts
    puzzles,
    ...dailyDeps(db, clock, puzzles),
    progress: sqliteProgress(db, puzzles, clock),
    jobs,
    ...submissionDeps(db, clock, puzzles, jobs),
    ...deps,
````
   Replace with:
````ts
    puzzles,
    ...dailyDeps(db, clock, puzzles),
    progress: sqliteProgress(db, puzzles, clock),
    health: healthManager(db, clock),
    jobs,
    ...submissionDeps(db, clock, puzzles, jobs),
    ...deps,
````

**Edit `apps/server/src/api/submissions.test.ts`**: 2 replacements, in order.

1. Find:
````ts
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
````
   Replace with:
````ts
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { healthManager } from "../test-support/health.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
````

2. Find:
````ts
    jobs,
    ...dailyDeps(db, clock, puzzles),
    progress: sqliteProgress(db, puzzles, clock),
    ...submissionDeps(db, clock, puzzles, jobs),
    ...deps,
  });
````
   Replace with:
````ts
    jobs,
    ...dailyDeps(db, clock, puzzles),
    progress: sqliteProgress(db, puzzles, clock),
    health: healthManager(db, clock),
    ...submissionDeps(db, clock, puzzles, jobs),
    ...deps,
  });
````

**Edit `apps/server/src/worker/flow.test.ts`**: 2 replacements, in order.

1. Find:
````ts
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { noDailies } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";

````
   Replace with:
````ts
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { noDailies } from "../test-support/fakes.ts";
import { healthManager } from "../test-support/health.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";

````

2. Find:
````ts
      jobs,
      ...dailyDeps(db, systemClock, puzzles),
      progress: sqliteProgress(db, puzzles, systemClock),
      submissions,
      reports,
      ...accounts,
````
   Replace with:
````ts
      jobs,
      ...dailyDeps(db, systemClock, puzzles),
      progress: sqliteProgress(db, puzzles, systemClock),
      health: healthManager(db, systemClock),
      submissions,
      reports,
      ...accounts,
````

**Create `apps/server/src/api/health.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import type { ApiMetrics, AuthFailure, BlobStore } from "../ports.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { healthManager } from "../test-support/health.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
import { SESSION_COOKIE } from "./session-cookie.ts";

/** Records what the app counts. */
class RecordingMetrics implements ApiMetrics {
  readonly requests: string[] = [];
  readonly authFailures: AuthFailure[] = [];
  request(method: string, route: string, status: number): void {
    this.requests.push(`${method} ${route} ${status}`);
  }
  authFailure(reason: AuthFailure): void {
    this.authFailures.push(reason);
  }
}

function setup(blobs: BlobStore = new MemoryBlobStore()) {
  const db = openDatabase(":memory:");
  const clock = new FakeClock(Date.UTC(2026, 9, 25, 12));
  const deps = accountDeps(db, clock);
  const puzzles = new PuzzleManager({ puzzles: new SqlitePuzzleRepository(db), blobs, clock });
  const queue = new SqliteJobQueue(db);
  const jobs = new JobManager({ jobs: queue, clock, newId: sequentialIds("j"), maxQueued: 10 });
  const metrics = new RecordingMetrics();
  const app = createApp({
    puzzles,
    jobs,
    ...dailyDeps(db, clock, puzzles),
    progress: sqliteProgress(db, puzzles, clock),
    health: healthManager(db, clock, blobs),
    ...submissionDeps(db, clock, puzzles, jobs),
    ...deps,
    metrics,
  });
  const send = (method: string, path: string, body?: unknown, cookie?: string) => {
    const headers: Record<string, string> = { "Sec-Fetch-Site": "same-origin" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (cookie !== undefined) headers.Cookie = `${SESSION_COOKIE}=${cookie}`;
    return app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  /** Signs up, confirms and logs in; returns the session cookie. */
  const logIn = async (email: string, admin: boolean) => {
    await send("POST", "/api/auth/signup", { email, password: "hunter22", captchaToken: "c" });
    const token = deps.mailer.sent.at(-1)?.text.match(/#token=(\S+)/)?.[1];
    await send("POST", "/api/auth/verify-email", { token });
    if (admin) deps.users.setAdmin(email, true);
    const res = await send("POST", "/api/auth/login", { email, password: "hunter22" });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    return cookie?.split(";")[0].slice(SESSION_COOKIE.length + 1) ?? "";
  };
  return { app, send, logIn, queue, metrics };
}

const downBlobs: BlobStore = {
  put: async () => {},
  get: async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:3900");
  },
  delete: async () => {},
};

describe("GET /api/health/ready", () => {
  test("answers 200 when the database and blob store answer", async () => {
    const res = await setup().app.request("/api/health/ready");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: true, blobs: true });
  });

  test("answers 503 without error details when the blob store is down", async () => {
    const res = await setup(downBlobs).app.request("/api/health/ready");
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "unavailable", database: true, blobs: false });
    expect(text).not.toContain("ECONNREFUSED");
  });
});

describe("GET /api/admin/health", () => {
  test("is for admins only", async () => {
    const { send, logIn } = setup();
    expect((await send("GET", "/api/admin/health")).status).toBe(401);
    const player = await logIn("ann@example.com", false);
    expect((await send("GET", "/api/admin/health", undefined, player)).status).toBe(403);
  });

  test("shows checks with their errors, the queue, the daily stock, failures and versions", async () => {
    const { send, logIn, queue } = setup(downBlobs);
    queue.enqueue({
      id: "j1",
      job: { kind: "generate", input: { width: 5, height: 5, seed: "s" } },
      createdAt: Date.UTC(2026, 9, 25, 11),
    });
    queue.enqueue({
      id: "j2",
      job: { kind: "generate", input: { width: 5, height: 5, seed: "t" } },
      createdAt: Date.UTC(2026, 9, 25, 11, 30),
    });
    queue.claimNext("w", 1);
    queue.finish("j1", "w", { status: "timeout", error: "Stopped after the 60 s time limit." }, 2);
    const admin = await logIn("root@example.com", true);
    const res = await send("GET", "/api/admin/health", undefined, admin);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      database: { ok: true, error: null },
      blobs: { ok: false, error: "connect ECONNREFUSED 127.0.0.1:3900" },
      jobs: { queued: 1, running: 0, oldestQueuedAt: "2026-10-25T11:30:00.000Z" },
      dailies: [
        { size: 7, days: 0 },
        { size: 10, days: 0 },
        { size: 20, days: 0 },
        { size: 40, days: 0 },
      ],
      failures: [
        {
          id: "j1",
          kind: "generate",
          status: "timeout",
          error: "Stopped after the 60 s time limit.",
          finishedAt: "1970-01-01T00:00:00.002Z",
        },
      ],
      versions: { app: "test", runtime: "bun test" },
      startedAt: "2026-10-25T12:00:00.000Z",
    });
  });
});

describe("request observation", () => {
  test("counts requests under their route template and gives each an id", async () => {
    const { app, metrics } = setup();
    const res = await app.request("/api/puzzles/nope-123");
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    await app.request("/api/no-such-route");
    expect(metrics.requests).toEqual(["GET /api/puzzles/:id 404", "GET /api/* 404"]);
  });

  test("keeps a proxy's request id that looks like one, and replaces one that doesn't", async () => {
    const { app } = setup();
    let res = await app.request("/api/health", { headers: { "X-Request-Id": "abc-123" } });
    expect(res.headers.get("X-Request-Id")).toBe("abc-123");
    res = await app.request("/api/health", { headers: { "X-Request-Id": "bad id\n" } });
    expect(res.headers.get("X-Request-Id")).not.toBe("bad id\n");
  });

  test("counts refused logins, mailed links and cross-site requests as auth failures", async () => {
    const { app, send, metrics } = setup();
    await send("POST", "/api/auth/login", { email: "nobody@example.com", password: "hunter22" });
    await send("POST", "/api/auth/verify-email", { token: "wrong" });
    await app.request("/api/auth/logout", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(metrics.authFailures).toEqual(["login", "link", "csrf"]);
  });
});
````

**Edit `apps/server/src/api/spec.ts`**: 4 replacements, in order.

1. Find:
````ts
import { AttemptManager } from "../managers/attempt-manager.ts";
import { DailyManager } from "../managers/daily-manager.ts";
import { DisplayNameManager } from "../managers/display-name-manager.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { LeaderboardManager } from "../managers/leaderboard-manager.ts";
````
   Replace with:
````ts
import { AttemptManager } from "../managers/attempt-manager.ts";
import { DailyManager } from "../managers/daily-manager.ts";
import { DisplayNameManager } from "../managers/display-name-manager.ts";
import { HealthManager } from "../managers/health-manager.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { LeaderboardManager } from "../managers/leaderboard-manager.ts";
````

2. Find:
````ts
    ttlMs: 1,
  });
  const limiter = new MemoryRateLimiter(systemClock);
  const puzzles = new PuzzleManager({
    puzzles: new SqlitePuzzleRepository(db),
    blobs: new MemoryBlobStore(),
    clock: systemClock,
  });
  const jobs = new JobManager({
    jobs: new SqliteJobQueue(db),
    clock: systemClock,
    newId: () => crypto.randomUUID(),
    maxQueued: 1,
  });
  const dailies = new DailyManager({
    dailies: new SqliteDailyRepository(db),
    puzzles,
    clock: systemClock,
  });
````
   Replace with:
````ts
    ttlMs: 1,
  });
  const limiter = new MemoryRateLimiter(systemClock);
  const blobs = new MemoryBlobStore();
  const puzzles = new PuzzleManager({
    puzzles: new SqlitePuzzleRepository(db),
    blobs,
    clock: systemClock,
  });
  const jobQueue = new SqliteJobQueue(db);
  const jobs = new JobManager({
    jobs: jobQueue,
    clock: systemClock,
    newId: () => crypto.randomUUID(),
    maxQueued: 1,
  });
  const dailyRepo = new SqliteDailyRepository(db);
  const dailies = new DailyManager({
    dailies: dailyRepo,
    puzzles,
    clock: systemClock,
  });
````

3. Find:
````ts
      limiter,
      clock: systemClock,
    }),
  });
  const doc = app.getOpenAPI31Document({
    openapi: "3.1.0",
````
   Replace with:
````ts
      limiter,
      clock: systemClock,
    }),
    health: new HealthManager({
      jobs: jobQueue,
      dailies: dailyRepo,
      blobs,
      clock: systemClock,
      daysAhead: 1,
      versions: { app: "spec", runtime: "spec" },
      checkTimeoutMs: 1,
    }),
  });
  const doc = app.getOpenAPI31Document({
    openapi: "3.1.0",
````

4. Find:
````ts
      title: "Loophole API",
      version: "0.1.0",
      description:
        "Puzzles, background jobs, accounts, saved progress, submitted puzzles and reports, daily puzzles, ranked attempts and leaderboards. Errors are RFC 9457 problem details. State-changing requests from other sites are refused (403).",
    },
  });
  db.close();
````
   Replace with:
````ts
      title: "Loophole API",
      version: "0.1.0",
      description:
        "Puzzles, background jobs, accounts, saved progress, submitted puzzles and reports, daily puzzles, ranked attempts, leaderboards and health checks. Errors are RFC 9457 problem details. State-changing requests from other sites are refused (403).",
    },
  });
  db.close();
````

**Replace the whole of `apps/server/src/api/main.ts`**:

````ts
// Composition root of the HTTP API process: reads the settings, builds the adapters and managers,
// and serves the app.
import { S3BlobStore } from "../adapters/blob/s3-blob-store.ts";
import { TURNSTILE_TEST_SECRET_KEY, TurnstileVerifier } from "../adapters/captcha/turnstile.ts";
import { systemClock } from "../adapters/clock.ts";
import { SqliteAccountTokenRepository } from "../adapters/db/account-token-repository.ts";
import { SqliteAttemptRepository } from "../adapters/db/attempt-repository.ts";
import { SqliteDailyRepository } from "../adapters/db/daily-repository.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteDisplayNameRepository } from "../adapters/db/display-name-repository.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqliteProgressRepository } from "../adapters/db/progress-repository.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { SqliteReportRepository } from "../adapters/db/report-repository.ts";
import { SqliteSessionRepository } from "../adapters/db/session-repository.ts";
import { SqliteSubmissionRepository } from "../adapters/db/submission-repository.ts";
import { SqliteUserRepository } from "../adapters/db/user-repository.ts";
import { installJsonLogging } from "../adapters/logging.ts";
import { BackgroundMailer } from "../adapters/mail/background-mailer.ts";
import { SmtpMailer } from "../adapters/mail/smtp-mailer.ts";
import {
  createRegistry,
  PrometheusApiMetrics,
  serveMetrics,
} from "../adapters/metrics/prometheus.ts";
import { argon2idHasher } from "../adapters/password-hasher.ts";
import { randomToken } from "../adapters/random-token.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { loadConfig } from "../config.ts";
import { AccountManager } from "../managers/account-manager.ts";
import { AttemptManager } from "../managers/attempt-manager.ts";
import { DailyManager } from "../managers/daily-manager.ts";
import { DisplayNameManager } from "../managers/display-name-manager.ts";
import { HealthManager } from "../managers/health-manager.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { LeaderboardManager } from "../managers/leaderboard-manager.ts";
import { ProgressManager } from "../managers/progress-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { ReportManager } from "../managers/report-manager.ts";
import { SessionManager } from "../managers/session-manager.ts";
import { SubmissionManager } from "../managers/submission-manager.ts";
import { requestContext } from "../request-context.ts";
import { createApp } from "./app.ts";

installJsonLogging({ process: "api", context: () => requestContext.getStore() });
const config = loadConfig(process.env);
const db = openDatabase(config.databasePath);
// loadConfig refuses the test secret unless PUBLIC_URL is on localhost.
const testCaptcha = config.turnstile.secretKey === TURNSTILE_TEST_SECRET_KEY;
const registry = createRegistry(config.version);
const metrics = new PrometheusApiMetrics(registry);

const blobs = new S3BlobStore(config.s3);
const puzzles = new PuzzleManager({
  puzzles: new SqlitePuzzleRepository(db),
  blobs,
  clock: systemClock,
});
const jobQueue = new SqliteJobQueue(db);
const jobs = new JobManager({
  jobs: jobQueue,
  clock: systemClock,
  newId: () => crypto.randomUUID(),
  maxQueued: config.maxQueuedJobs,
});
const users = new SqliteUserRepository(db);
const sessions = new SessionManager({
  sessions: new SqliteSessionRepository(db),
  users,
  clock: systemClock,
  newToken: randomToken,
  ttlMs: config.sessionTtlMs,
});
const limiter = new MemoryRateLimiter(systemClock, () => metrics.rateLimitEviction());
const accounts = new AccountManager({
  users,
  tokens: new SqliteAccountTokenRepository(db),
  sessions,
  passwords: argon2idHasher,
  captcha: new TurnstileVerifier({
    secretKey: config.turnstile.secretKey,
    // The test secret answers for "example.com", so the hostname check is for real keys only.
    expectedHostname: testCaptcha ? undefined : new URL(config.publicUrl).hostname,
  }),
  // Mail goes out after the answer, so its timing and errors don't show who has an account.
  mailer: new BackgroundMailer(new SmtpMailer(config.smtp), () => metrics.mailFailure()),
  limiter,
  clock: systemClock,
  newId: () => crypto.randomUUID(),
  newToken: randomToken,
  publicUrl: config.publicUrl,
});
const dailyRepo = new SqliteDailyRepository(db);
const dailies = new DailyManager({
  dailies: dailyRepo,
  puzzles,
  clock: systemClock,
});
const attemptRepo = new SqliteAttemptRepository(db);
const attempts = new AttemptManager({
  attempts: attemptRepo,
  dailies,
  puzzles,
  clock: systemClock,
});
const leaderboards = new LeaderboardManager({ attempts: attemptRepo, dailies, puzzles });
const displayNames = new DisplayNameManager({
  names: new SqliteDisplayNameRepository(db),
  limiter,
  clock: systemClock,
});
const hints = new HintManager({ puzzles, attempts });
const progress = new ProgressManager({
  progress: new SqliteProgressRepository(db),
  puzzles,
  clock: systemClock,
});
const submissions = new SubmissionManager({
  submissions: new SqliteSubmissionRepository(db),
  puzzles,
  jobs,
  limiter,
  clock: systemClock,
  newId: () => crypto.randomUUID(),
});
const reports = new ReportManager({
  reports: new SqliteReportRepository(db),
  puzzles,
  limiter,
  clock: systemClock,
});
const health = new HealthManager({
  jobs: jobQueue,
  dailies: dailyRepo,
  blobs,
  clock: systemClock,
  daysAhead: config.dailies.daysAhead,
  versions: { app: config.version, runtime: `bun ${Bun.version}` },
  checkTimeoutMs: 2_000,
});
const app = createApp({
  puzzles,
  jobs,
  hints,
  progress,
  submissions,
  reports,
  dailies,
  attempts,
  leaderboards,
  displayNames,
  accounts,
  sessions,
  limiter,
  trustProxy: config.trustProxy,
  turnstileSiteKey: config.turnstile.siteKey,
  webDir: config.webDir,
  health,
  metrics,
  accessLog: true,
});
if (testCaptcha) {
  console.warn(
    "Using Turnstile's test keys: the sign-up CAPTCHA always passes. Not for production.",
  );
}

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  // Outer cap; the app itself refuses API bodies over 64 KiB.
  maxRequestBodySize: 1024 * 1024,
  fetch: app.fetch,
});
console.log(`API listening on ${server.url}`);
if (config.metrics.apiPort !== 0) {
  const metricsServer = serveMetrics(registry, config.metrics.host, config.metrics.apiPort);
  console.log(`API metrics on ${metricsServer.url}metrics`);
}
````

**Replace the whole of `apps/server/src/worker/main.ts`**:

````ts
// Composition root of the job worker process: reads the settings, builds the adapters and
// managers, and runs jobs until SIGINT or SIGTERM. The job in progress finishes first.
import { S3BlobStore } from "../adapters/blob/s3-blob-store.ts";
import { systemClock } from "../adapters/clock.ts";
import { hmacDailySeeder } from "../adapters/daily-seeds.ts";
import { SqliteDailyRepository } from "../adapters/db/daily-repository.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { SqliteSubmissionRepository } from "../adapters/db/submission-repository.ts";
import { installJsonLogging } from "../adapters/logging.ts";
import {
  createRegistry,
  PrometheusWorkerMetrics,
  serveMetrics,
} from "../adapters/metrics/prometheus.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { ThreadTaskRunner } from "../adapters/tasks/thread-task-runner.ts";
import { loadConfig } from "../config.ts";
import { DailyStockManager } from "../managers/daily-stock-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { JobRunManager } from "../managers/job-run-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { SubmissionManager } from "../managers/submission-manager.ts";
import { runWorkerLoop } from "./loop.ts";

installJsonLogging({ process: "worker" });
const config = loadConfig(process.env);
const db = openDatabase(config.databasePath);
const registry = createRegistry(config.version);

const puzzles = new PuzzleManager({
  puzzles: new SqlitePuzzleRepository(db),
  blobs: new S3BlobStore(config.s3),
  clock: systemClock,
});
const queue = new SqliteJobQueue(db);
const jobs = new JobManager({
  jobs: queue,
  clock: systemClock,
  newId: () => crypto.randomUUID(),
  maxQueued: config.maxQueuedJobs,
});
// The worker only decides submissions; queueing them and the per-account limit are the API's.
const submissionRepo = new SqliteSubmissionRepository(db);
const submissions = new SubmissionManager({
  submissions: submissionRepo,
  puzzles,
  jobs,
  limiter: new MemoryRateLimiter(systemClock),
  clock: systemClock,
  newId: () => crypto.randomUUID(),
});
// Reads the queue and the daily stock whenever Prometheus scrapes; `dailies` is set just below.
const metrics: PrometheusWorkerMetrics = new PrometheusWorkerMetrics(registry, {
  activeJobs: () => queue.countActive(),
  dailiesStocked: () => dailies.stocked(),
  submissionVerdicts: () => submissionRepo.countByVerdict(),
});
// Keeps the coming days' daily puzzles generated (PRD FR-22).
const dailies: DailyStockManager = new DailyStockManager({
  dailies: new SqliteDailyRepository(db),
  jobs,
  puzzles,
  seeds: hmacDailySeeder(config.dailies.seedSecret),
  clock: systemClock,
  newId: () => crypto.randomUUID(),
  settings: { daysAhead: config.dailies.daysAhead },
  metrics,
});
const runs = new JobRunManager({
  jobs: queue,
  tasks: new ThreadTaskRunner(),
  puzzles,
  submissions,
  dailies,
  clock: systemClock,
  settings: config.jobs,
  metrics,
});

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => controller.abort());
}

const metricsServer =
  config.metrics.workerPort === 0
    ? null
    : serveMetrics(registry, config.metrics.host, config.metrics.workerPort);
if (metricsServer !== null) console.log(`Worker metrics on ${metricsServer.url}metrics`);
console.log(`Worker ${config.workerId} polling for jobs`);
await runWorkerLoop({
  runs,
  dailies,
  workerId: config.workerId,
  pollMs: config.pollMs,
  sweepMs: config.jobs.staleMs / 2,
  stockMs: config.dailies.stockMs,
  signal: controller.signal,
});
metricsServer?.stop();
db.close();
console.log(`Worker ${config.workerId} stopped`);
````

**Edit `apps/web/playwright.auth.config.ts`**: 1 replacement, in order.

1. Find:
````ts
  S3_SECRET_ACCESS_KEY: "8b339f8231fe89196b07eb8766bf6f079805f64a9be09934697b94e0b1aa0a0b",
  // Today's and tomorrow's daily puzzles only, so the worker is soon free for the tests' own jobs.
  DAILY_DAYS_AHEAD: "2",
};

export default defineConfig({
````
   Replace with:
````ts
  S3_SECRET_ACCESS_KEY: "8b339f8231fe89196b07eb8766bf6f079805f64a9be09934697b94e0b1aa0a0b",
  // Today's and tomorrow's daily puzzles only, so the worker is soon free for the tests' own jobs.
  DAILY_DAYS_AHEAD: "2",
  // No metrics listeners: a developer's .env may turn them on for the dev servers' ports.
  API_METRICS_PORT: "0",
  WORKER_METRICS_PORT: "0",
};

export default defineConfig({
````

**Run** (regenerate openapi.yaml and the API client; never edit them by hand):

```sh
bun run gen:api
```

**Verify:** `bun run check`; `bun test apps/server/src/api/health.test.ts` shows 7 pass. Then a live run against the dev services (start them with `docker compose up -d` and `./scripts/garage-init.sh` if they aren't running; stop them afterwards with `docker compose stop` only if you started them):

```sh
export DATABASE_PATH=$(mktemp -d)/db.sqlite PORT=4390 PUBLIC_URL=http://localhost:4390 API_METRICS_PORT=9564 WORKER_METRICS_PORT=9565 DAILY_DAYS_AHEAD=2
export S3_ENDPOINT=http://localhost:3900 S3_REGION=garage S3_BUCKET=loophole-dev S3_ACCESS_KEY_ID=GK1a2b3c4d5e6f708192a3b4c5 S3_SECRET_ACCESS_KEY=8b339f8231fe89196b07eb8766bf6f079805f64a9be09934697b94e0b1aa0a0b
bun apps/server/src/api/main.ts & bun apps/server/src/worker/main.ts &
sleep 5
curl -s localhost:4390/api/health/ready      # {"status":"ok","database":true,"blobs":true}
curl -s -X POST localhost:4390/api/jobs/generate -H 'content-type: application/json' -H 'X-Request-Id: check-1' -d '{"width":10,"height":10}' -D - -o /dev/null | grep -i x-request-id   # X-Request-Id: check-1
sleep 3
curl -s localhost:9564/metrics | grep '^loophole_http_requests_total'   # routes as templates, e.g. route="/api/jobs/generate"
curl -s localhost:9565/metrics | grep -E '^loophole_(jobs|daily_days_stocked|jobs_finished_total)'
kill %1 %2
```

The API and worker print one JSON object per line, for example `{"time":"…","level":"info","process":"api","msg":"request","requestId":"check-1","method":"POST","route":"/api/jobs/generate","status":202,"ms":2}`. The S3 values are Garage's public development ones from `.env.example`.

**Commit:** `feat(server): metrics listeners, request ids, readiness and the admin health report`

### A5 Production image and Compose file

One image, two commands: the API (default; it also serves the built web app) and the worker. `compose.prod.yml` runs both next to Garage with named volumes, health checks and only 127.0.0.1 ports. The API and the worker read `.env.production`; Garage reads only `.env.garage` (its RPC secret, admin token and metrics token), so neither side holds the other's secrets, and `garage.prod.toml` holds none. The SMTP login lines are commented out in the example, because an empty value is refused and a relay without login needs them unset. `scripts/garage-init.sh` now takes the bucket and key from `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` when set, with the development values as defaults.

**Create `Dockerfile`**:

````text
# Production image of Loophole: the HTTP API, which also serves the built web app, and the job
# worker, chosen by the command (compose.prod.yml). Build from the repo root:
#   docker build --build-arg APP_VERSION=$(git rev-parse --short HEAD) -t loophole .

# All dependencies, for building the web app.
FROM oven/bun:1.3.13-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/api-client/package.json packages/api-client/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

# The static web app (apps/web/build).
FROM deps AS web
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
RUN bun run --cwd apps/web build

# What runs: production dependencies, the server and core sources, and the built web app.
FROM oven/bun:1.3.13-slim
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/api-client/package.json packages/api-client/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile --production
COPY tsconfig.base.json ./
COPY packages/core/src packages/core/src
COPY apps/server/tsconfig.json apps/server/
COPY apps/server/src apps/server/src
COPY apps/server/scripts apps/server/scripts
COPY --from=web /app/apps/web/build apps/web/build
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=$APP_VERSION \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/loophole.sqlite \
    WEB_DIR=apps/web/build
RUN mkdir -p /data && chown bun:bun /data
USER bun
EXPOSE 3000
CMD ["bun", "apps/server/src/api/main.ts"]
````

**Create `.dockerignore`**:

````dockerignore
# Keep the build context small and free of local state and secrets.
.git
**/node_modules
**/.svelte-kit
**/build
**/test-results
**/playwright-report
data
backups
.env
.env.*
docs
````

**Create `compose.prod.yml`**:

````yaml
# Production: the API (serving the web app), the worker and Garage, on one host. The API's and the
# worker's settings come from .env.production, Garage's secrets from .env.garage (copy the two
# .example files). README, "Production", has the steps.
#
# Only the API is published, and only on 127.0.0.1:3000: put a TLS reverse proxy (Caddy, nginx)
# in front of it and keep TRUST_PROXY=true. If the proxy runs on another machine, publish the API
# on the private interface the proxy reaches, never on 0.0.0.0. The metrics ports and Garage's
# admin API are published on 127.0.0.1 only, for a Prometheus on this host (ops/prometheus.yml).
name: loophole-prod

x-app: &app
  build:
    context: .
    args:
      APP_VERSION: ${APP_VERSION:-dev}
  image: loophole:${APP_VERSION:-dev}
  init: true
  restart: unless-stopped
  env_file: .env.production
  volumes:
    - loophole-data:/data
  depends_on:
    garage:
      condition: service_healthy

services:
  api:
    <<: *app
    environment:
      HOST: 0.0.0.0
      PORT: "3000"
      TRUST_PROXY: "true"
      S3_ENDPOINT: http://garage:3900
      METRICS_HOST: 0.0.0.0
      API_METRICS_PORT: "9470"
    ports:
      - "127.0.0.1:3000:3000"
      - "127.0.0.1:9470:9470"
    healthcheck:
      test:
        - CMD
        - bun
        - -e
        - "const r = await fetch('http://127.0.0.1:3000/api/health/ready'); process.exit(r.ok ? 0 : 1)"
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

  worker:
    <<: *app
    command: ["bun", "apps/server/src/worker/main.ts"]
    environment:
      S3_ENDPOINT: http://garage:3900
      METRICS_HOST: 0.0.0.0
      WORKER_METRICS_PORT: "9471"
    ports:
      - "127.0.0.1:9471:9471"
    healthcheck:
      test:
        - CMD
        - bun
        - -e
        - "const r = await fetch('http://127.0.0.1:9471/health'); process.exit(r.ok ? 0 : 1)"
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

  garage:
    image: dxflrs/garage:v2.5.0
    restart: unless-stopped
    # Garage's secrets only; the app's settings stay out of this container, and these out of theirs.
    env_file: .env.garage
    volumes:
      - ./infra/garage/garage.prod.toml:/etc/garage.toml:ro
      - garage-meta:/var/lib/garage/meta
      - garage-data:/var/lib/garage/data
    ports:
      - "127.0.0.1:3903:3903" # admin API: /health, /metrics (Bearer GARAGE_METRICS_TOKEN)
    healthcheck:
      test: ["CMD", "/garage", "status"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  loophole-data:
  garage-meta:
  garage-data:
````

**Create `infra/garage/garage.prod.toml`**:

````toml
# Garage single-node config for production (compose.prod.yml). The secrets are not here: Garage
# reads GARAGE_RPC_SECRET, GARAGE_ADMIN_TOKEN and GARAGE_METRICS_TOKEN from .env.garage.
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
# A consistent copy of the metadata database every 6 hours, under metadata_dir/snapshots, for
# backups (README, "Backups").
metadata_auto_snapshot_interval = "6h"

replication_factor = 1

rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"

[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.localhost"

[admin]
api_bind_addr = "[::]:3903"
````

**Create `.env.production.example`**:

````example
# Production settings for the API and the worker (compose.prod.yml). Copy to .env.production
# (git-ignored), fill in every value, and keep it private. The API refuses to start with development
# values (Turnstile's test keys, the development daily secret, Garage's development key, an http
# PUBLIC_URL). Garage's own secrets go in .env.garage (.env.garage.example), not here.

# The site's address, https, without a trailing slash. Links in mail point here.
PUBLIC_URL=https://loophole.example.com

# Cloudflare Turnstile widget keys (https://dash.cloudflare.com, Turnstile; the free plan is enough).
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=

# Daily puzzle seeds come from this: openssl rand -base64 32
DAILY_SEED_SECRET=

# Mail over SMTP. Port 465 with SMTP_SECURE=true, or 587 with STARTTLS (required unless the host is
# loopback). For a relay inside the Docker network that doesn't offer STARTTLS, set
# SMTP_REQUIRE_TLS=false. Leave SMTP_USER and SMTP_PASSWORD commented out for a relay without a
# login: an empty value is refused.
SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=true
# SMTP_USER=
# SMTP_PASSWORD=
# SMTP_REQUIRE_TLS=false
MAIL_FROM="Loophole <no-reply@loophole.example.com>"

# Garage: the app's bucket and key. Make the key with
#   echo "GK$(openssl rand -hex 12)"   (S3_ACCESS_KEY_ID)
#   openssl rand -hex 32               (S3_SECRET_ACCESS_KEY)
# and create both in Garage with scripts/garage-init.sh (README, "Production").
S3_REGION=garage
S3_BUCKET=loophole
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
````

**Create `.env.garage.example`**:

````example
# Garage's secrets for compose.prod.yml. Copy to .env.garage (git-ignored) and keep it private. Only
# the garage service reads this file; the API and the worker never see these values.
# Make each with: openssl rand -hex 32
GARAGE_RPC_SECRET=
GARAGE_ADMIN_TOKEN=
GARAGE_METRICS_TOKEN=
````

**Edit `.gitignore`**: 1 replacement, in order.

1. Find:
````gitignore
.env
.env.*
!.env.example
.svelte-kit/
build/
test-results/
playwright-report/
/data/
````
   Replace with:
````gitignore
.env
.env.*
!.env.example
!.env.production.example
!.env.garage.example
.svelte-kit/
build/
test-results/
playwright-report/
/data/
/backups/
ops/garage-metrics-token
````

**Replace the whole of `scripts/garage-init.sh`**:

````bash
#!/usr/bin/env bash
# Idempotent bootstrap of a single Garage node: layout, access key, bucket.
# Development: docker compose up -d && ./scripts/garage-init.sh
# Production (README, "Production"): with COMPOSE_FILE=compose.prod.yml and S3_BUCKET,
# S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY set to the values in .env.production.
set -euo pipefail

cd "$(dirname "$0")/.."

# The development values are public (DECISIONS, "Fixed dev credentials for Garage").
KEY_ID="${S3_ACCESS_KEY_ID:-GK1a2b3c4d5e6f708192a3b4c5}"
SECRET="${S3_SECRET_ACCESS_KEY:-8b339f8231fe89196b07eb8766bf6f079805f64a9be09934697b94e0b1aa0a0b}"
BUCKET="${S3_BUCKET:-loophole-dev}"

garage() {
  docker compose exec -T -e RUST_LOG=warn garage /garage "$@"
}

echo "Waiting for Garage..."
for _ in $(seq 1 30); do
  if garage status >/dev/null 2>&1; then break; fi
  sleep 1
done
garage status >/dev/null

if garage layout show 2>/dev/null | grep -q "No nodes currently have a role"; then
  node_id="$(garage node id -q 2>/dev/null | cut -d@ -f1)"
  echo "Assigning layout to node ${node_id:0:16}"
  garage layout assign -z dc1 -c 1G "$node_id" >/dev/null
  current="$(garage layout show 2>/dev/null | sed -n 's/^Current cluster layout version: //p')"
  garage layout apply --version "$((current + 1))" >/dev/null
else
  echo "Layout already applied"
fi

if garage key info "$KEY_ID" >/dev/null 2>&1; then
  echo "Key $KEY_ID already exists"
else
  echo "Importing key $KEY_ID"
  garage key import --yes -n loophole-dev "$KEY_ID" "$SECRET" >/dev/null
fi

if garage bucket info "$BUCKET" >/dev/null 2>&1; then
  echo "Bucket $BUCKET already exists"
else
  echo "Creating bucket $BUCKET"
  garage bucket create "$BUCKET" >/dev/null
fi

garage bucket allow --read --write --owner "$BUCKET" --key "$KEY_ID" >/dev/null
echo "Garage ready: bucket=$BUCKET key=$KEY_ID region=garage"
````

**Verify:** `bun run check`; `docker compose -f compose.prod.yml config -q` fails only with "env file … .env.production not found" (that file is never committed). The full build-and-run check is step A10.

**Commit:** `build: production Docker image and Compose file`

### A6 Sample Prometheus scrape config and alert rules

**Create `ops/prometheus.yml`**:

````yaml
# Sample Prometheus scrape config for a production host running compose.prod.yml, with Prometheus
# on the same host (the metrics ports are published on 127.0.0.1 only). Dashboards are left to you.
# Copy ops/alerts.yml next to this file, and put Garage's GARAGE_METRICS_TOKEN in the file named
# under credentials_file.
global:
  scrape_interval: 30s
  evaluation_interval: 30s

rule_files:
  - alerts.yml

scrape_configs:
  # HTTP requests by route and status, auth failures, mail failures, rate-limit evictions.
  - job_name: loophole-api
    static_configs:
      - targets: ["127.0.0.1:9470"]

  # Jobs by kind and status, job durations, queue depth, daily puzzles stocked ahead.
  - job_name: loophole-worker
    static_configs:
      - targets: ["127.0.0.1:9471"]

  # Garage's own metrics (S3 requests, errors, disk use).
  - job_name: garage
    authorization:
      type: Bearer
      credentials_file: garage-metrics-token
    static_configs:
      - targets: ["127.0.0.1:3903"]
````

**Create `ops/alerts.yml`**:

````yaml
# Example alert rules for ops/prometheus.yml. Tune the thresholds to your traffic.
groups:
  - name: loophole
    rules:
      - alert: LoopholeDown
        expr: up{job=~"loophole-api|loophole-worker|garage"} == 0
        for: 5m
        labels: { severity: critical }
        annotations:
          summary: "{{ $labels.job }} has not answered a scrape for 5 minutes."

      - alert: DailyPuzzleMissing
        expr: min by (size) (loophole_daily_days_stocked) == 0
        for: 5m
        labels: { severity: critical }
        annotations:
          summary: "Today's {{ $labels.size }}×{{ $labels.size }} daily puzzle is not generated."

      - alert: DailyStockLow
        expr: min by (size) (loophole_daily_days_stocked) < 2
        for: 2h
        labels: { severity: warning }
        annotations:
          summary: "Only today's {{ $labels.size }}×{{ $labels.size }} daily is generated; tomorrow's is missing."

      - alert: DailyGenerationFailing
        expr: increase(loophole_daily_generation_failures_total[1h]) > 3
        labels: { severity: warning }
        annotations:
          summary: "{{ $labels.size }}×{{ $labels.size }} daily generations keep failing."

      - alert: MailFailing
        expr: increase(loophole_mail_failures_total[15m]) > 0
        labels: { severity: warning }
        annotations:
          summary: "Mail (verification, password reset) is failing to send; check the SMTP settings."

      - alert: JobTimeouts
        expr: sum(increase(loophole_jobs_finished_total{status="timeout"}[1h])) > 5
        labels: { severity: warning }
        annotations:
          summary: "More than 5 jobs hit their time limit in the last hour."

      - alert: JobQueueBacklog
        expr: loophole_jobs{status="queued"} > 50
        for: 10m
        labels: { severity: warning }
        annotations:
          summary: "{{ $value }} jobs waiting for 10 minutes; the worker may be stuck or overloaded."

      - alert: ApiErrors
        expr: sum(rate(loophole_http_requests_total{status=~"5.."}[5m])) > 0.1
        for: 10m
        labels: { severity: warning }
        annotations:
          summary: "The API is answering with server errors."

      - alert: RateLimitFlood
        expr: increase(loophole_rate_limit_evictions_total[10m]) > 0
        labels: { severity: info }
        annotations:
          summary: "The rate limiter is evicting counters: a flood of distinct clients or emails."

      - alert: AuthFailuresHigh
        expr: sum(rate(loophole_auth_failures_total[5m])) > 1
        for: 10m
        labels: { severity: info }
        annotations:
          summary: "Many refused logins, links or cross-site requests: possible credential stuffing."
````

**Verify:** `bun run check`, then validate both files with promtool (the token file is a throwaway):

```sh
printf 'x' > ops/garage-metrics-token
docker run --rm -v "$PWD/ops:/etc/prometheus:ro" --entrypoint promtool prom/prometheus:v3.10.0 check config /etc/prometheus/prometheus.yml
rm ops/garage-metrics-token
```

Expect `SUCCESS: … valid prometheus config file syntax` and `SUCCESS: 10 rules found`.

**Commit:** `feat(ops): sample Prometheus scrape config and alert rules`

### A7 SQLite backup and restore

**Create `apps/server/scripts/backup-db.ts`**:

````ts
// Writes a consistent copy of the SQLite database to the path given, while the API and the worker
// keep using it (VACUUM INTO), then checks the copy. scripts/backup-sqlite.sh runs it. Reads
// DATABASE_PATH like the server (default data/loophole.sqlite, from the repo root).
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

const target = process.argv[2];
if (target === undefined || existsSync(target)) {
  console.error("Usage: bun apps/server/scripts/backup-db.ts <new file>");
  process.exit(2);
}
const source = process.env.DATABASE_PATH ?? "data/loophole.sqlite";
if (!existsSync(source)) {
  console.error(`No database at ${source}.`);
  process.exit(1);
}

const db = new Database(source, { readonly: true });
db.run("PRAGMA busy_timeout = 5000");
db.query("VACUUM INTO ?").run(target);
db.close();

const copy = new Database(target, { readonly: true });
const check = copy.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get();
const migrations = copy
  .query<{ n: number }, []>("SELECT count(*) AS n FROM schema_migrations")
  .get();
copy.close();
if (check?.integrity_check !== "ok") {
  console.error(`The copy failed its integrity check: ${check?.integrity_check}`);
  process.exit(1);
}
console.error(`Copied ${source} to ${target} (${migrations?.n ?? 0} migrations applied).`);
````

**Create `apps/server/scripts/restore-db.ts`**:

````ts
// Replaces the SQLite database with a backup made by scripts/backup-sqlite.sh (README, "Backups").
// Stop the API and the worker first. Reads DATABASE_PATH like the server.
//   bun apps/server/scripts/restore-db.ts <backup.sqlite.gz>
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

const backup = process.argv[2];
if (backup === undefined || !existsSync(backup)) {
  console.error("Usage: bun apps/server/scripts/restore-db.ts <backup.sqlite.gz>");
  process.exit(2);
}
const target = process.env.DATABASE_PATH ?? "data/loophole.sqlite";
const bytes = readFileSync(backup);
const temp = `${target}.restoring`;
writeFileSync(temp, backup.endsWith(".gz") ? Bun.gunzipSync(bytes) : bytes);

const copy = new Database(temp, { readonly: true });
const check = copy.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get();
copy.close();
if (check?.integrity_check !== "ok") {
  rmSync(temp, { force: true });
  console.error(`The backup failed its integrity check: ${check?.integrity_check}`);
  process.exit(1);
}
// The old database's write-ahead log would be replayed onto the restored file: remove it first.
rmSync(`${target}-wal`, { force: true });
rmSync(`${target}-shm`, { force: true });
renameSync(temp, target);
console.error(`Restored ${target} from ${backup}. Start the API and the worker again.`);
````

**Create `apps/server/scripts/backup-restore.test.ts`**:

````ts
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/adapters/db/database.ts";

// The backup and restore scripts, run as the backup script runs them: as separate processes, on a
// database another connection holds open.

const BACKUP = new URL("./backup-db.ts", import.meta.url).pathname;
const RESTORE = new URL("./restore-db.ts", import.meta.url).pathname;

async function run(script: string, args: string[], databasePath: string): Promise<number> {
  const child = Bun.spawn([process.execPath, script, ...args], {
    env: { ...process.env, DATABASE_PATH: databasePath },
    stdout: "ignore",
    stderr: "ignore",
  });
  return await child.exited;
}

test("a backup of an open database keeps rows still in its WAL, and restores over a stale WAL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loophole-backup-"));
  try {
    const live = join(dir, "live.sqlite");
    const db = openDatabase(live);
    // No checkpoints: the new rows stay in the write-ahead log, as between a server's checkpoints.
    db.run("PRAGMA wal_autocheckpoint = 0");
    const insert = db.query(
      "INSERT INTO jobs (id, kind, payload, status, created_at) VALUES ($id, 'generate', '{}', 'queued', 0)",
    );
    for (let i = 0; i < 50; i++) insert.run({ id: `j${i}` });
    expect(statSync(`${live}-wal`).size).toBeGreaterThan(0);

    const copy = join(dir, "copy.sqlite");
    expect(await run(BACKUP, [copy], live)).toBe(0);
    // It never overwrites a file.
    expect(await run(BACKUP, [copy], live)).toBe(2);

    // Another database, with a write-ahead log left beside it, gets the gzipped backup.
    const target = join(dir, "target.sqlite");
    openDatabase(target).close();
    writeFileSync(`${target}-wal`, "stale");
    writeFileSync(`${copy}.gz`, Bun.gzipSync(readFileSync(copy)));
    expect(await run(RESTORE, [`${copy}.gz`], target)).toBe(0);
    expect(existsSync(`${target}-wal`)).toBe(false);

    const restored = new Database(target, { readonly: true });
    expect(restored.query("SELECT count(*) AS n FROM jobs").get()).toEqual({ n: 50 });
    expect(restored.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    restored.close();
    db.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
}, 30_000);
````

**Create `scripts/backup-sqlite.sh`**:

````bash
#!/usr/bin/env bash
# Online backup of Loophole's SQLite database: a consistent copy made with VACUUM INTO while the
# API and the worker keep running, gzipped into a backup folder. Keeps the newest KEEP (default 14).
#   ./scripts/backup-sqlite.sh [folder, default backups]
# Development: copies DATABASE_PATH (from .env; default data/loophole.sqlite) with the local Bun.
# Production: run with COMPOSE_FILE=compose.prod.yml; the copy is made inside the api container
# and streamed out. README, "Backups", has the restore steps and the Garage notes.
set -euo pipefail

cd "$(dirname "$0")/.."

DEST="${1:-backups}"
KEEP="${KEEP:-14}"
NAME="loophole-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
mkdir -p "$DEST"

if [ -n "${COMPOSE_FILE:-}" ]; then
  docker compose exec -T api sh -c \
    "bun apps/server/scripts/backup-db.ts /tmp/$NAME && gzip -c /tmp/$NAME; status=\$?; rm -f /tmp/$NAME; exit \$status" \
    >"$DEST/$NAME.gz.part"
  mv "$DEST/$NAME.gz.part" "$DEST/$NAME.gz"
else
  bun apps/server/scripts/backup-db.ts "$DEST/$NAME"
  gzip "$DEST/$NAME"
fi

# Oldest first out: keep the newest $KEEP backups.
ls -1t "$DEST"/loophole-*.sqlite.gz | tail -n +"$((KEEP + 1))" | xargs -r rm --
echo "Backed up to $DEST/$NAME.gz"
````

**Run** (make the script executable):

```sh
chmod +x scripts/backup-sqlite.sh
```

**Verify:** `bun run check`; `bun test apps/server/scripts` passes (`backup-restore.test.ts` backs up a database another connection holds open, with rows still in its write-ahead log, and restores it over a stale log); then, with any database file (for example the one from A4's live run, or `data/loophole.sqlite` after `bun run dev:api` has started once):

```sh
DATABASE_PATH=<that file> ./scripts/backup-sqlite.sh /tmp/loophole-backup-check   # "Backed up to …sqlite.gz"
gunzip -t /tmp/loophole-backup-check/*.gz && echo ok
```

Restoring in the containers is checked in A10.

**Commit:** `feat(ops): SQLite backup and restore scripts`

### A8 Server-side performance check (NFR-1)

**Create `apps/server/scripts/bench-jobs.ts`**:

````ts
// Server-side performance check (PRD NFR-1), not part of `bun run check`: runs generations and
// verifications the way the worker does, each in a fresh thread under the worker's time limits,
// and fails if a budget is missed. Timings depend on the machine and its load: run it on an idle
// host (it prints the load average first).
//   bun run bench:jobs            all sizes, about a minute
//   bun run bench:jobs --quick    up to 30×30 and one 100×100 verification
import { availableParallelism, loadavg } from "node:os";
import { generate, serializePuzzle } from "@loophole/core";
import { ThreadTaskRunner } from "../src/adapters/tasks/thread-task-runner.ts";
import type { Task } from "../src/domain.ts";

/** NFR-1: generation up to 30×30 has a p95 under 5 s. */
const GENERATE_P95_MS = 5_000;
/** The worker's limits (GENERATE_TIMEOUT_MS, VERIFY_TIMEOUT_MS defaults). */
const GENERATE_TIMEOUT_MS = 60_000;
const VERIFY_TIMEOUT_MS = 45_000;
/** NFR-1: a verification ends (with a verdict or `unknown`) within core's 30 s budget. */
const VERIFY_BUDGET_MS = 30_000;

const quick = process.argv.includes("--quick");
const runner = new ThreadTaskRunner();
const failures: string[] = [];

const [load1] = loadavg();
const cores = availableParallelism();
console.log(`load average ${load1.toFixed(2)} on ${cores} cores`);
if (load1 > cores / 2) console.log("warning: the host is busy; timings will be slow");

async function timed(task: Task, timeoutMs: number) {
  const started = performance.now();
  const outcome = await runner.run(task, { timeoutMs, onProgress: () => {} });
  return { outcome, ms: performance.now() - started };
}

function p95(sorted: number[]): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
}

const sizes: [number, number][] = [
  [7, 20],
  [10, 20],
  [20, 20],
  [30, 20],
  ...(quick
    ? []
    : ([
        [40, 5],
        [100, 2],
      ] as [number, number][])),
];
for (const [size, count] of sizes) {
  const times: number[] = [];
  for (let n = 0; n < count; n++) {
    const task: Task = {
      kind: "generate",
      input: { width: size, height: size, seed: `bench-jobs-${n}` },
    };
    const { outcome, ms } = await timed(task, GENERATE_TIMEOUT_MS);
    if (outcome.status !== "done")
      failures.push(`generate ${size}×${size} #${n}: ${outcome.status}`);
    times.push(ms);
  }
  times.sort((a, b) => a - b);
  const p = p95(times);
  console.log(
    `generate ${size}×${size}: n=${count} p95=${p.toFixed(0)}ms max=${times.at(-1)?.toFixed(0)}ms`,
  );
  if (size <= 30 && p >= GENERATE_P95_MS) {
    failures.push(`generate ${size}×${size}: p95 ${p.toFixed(0)} ms is over ${GENERATE_P95_MS} ms`);
  }
}

// A generated 100×100 (the rules solve it) and an empty 100×100 grid (many solutions: the search
// must find two and stop) as submissions.
const puzzles = [
  [
    "generated 100×100",
    serializePuzzle(generate({ width: 100, height: 100, seed: "bench-v" }).puzzle),
  ],
  ["empty 100×100", { v: 1 as const, width: 100, height: 100, clues: ".".repeat(10_000) }],
] as const;
for (const [label, puzzle] of quick ? puzzles.slice(1) : puzzles) {
  const { outcome, ms } = await timed({ kind: "verify", input: { puzzle } }, VERIFY_TIMEOUT_MS);
  const verdict =
    outcome.status === "done" && outcome.output.kind === "verify"
      ? outcome.output.verified.status
      : outcome.status;
  console.log(`verify ${label}: ${verdict} in ${ms.toFixed(0)}ms`);
  if (outcome.status !== "done" || ms > VERIFY_BUDGET_MS + 5_000) {
    failures.push(
      `verify ${label}: ${verdict} after ${ms.toFixed(0)} ms (budget ${VERIFY_BUDGET_MS} ms)`,
    );
  }
}

if (failures.length > 0) {
  console.error(`FAILED:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("All within NFR-1's budgets.");
````

**Edit `package.json`**: 1 replacement, in order.

1. Find:
````json
    "dev:worker": "bun --watch apps/server/src/worker/main.ts",
    "gen:api": "bun apps/server/scripts/gen-api.ts",
    "check:api": "bun apps/server/scripts/gen-api.ts --check",
    "admin": "bun apps/server/scripts/set-admin.ts"
  },
  "devDependencies": {
    "@biomejs/biome": "2.6.3",
````
   Replace with:
````json
    "dev:worker": "bun --watch apps/server/src/worker/main.ts",
    "gen:api": "bun apps/server/scripts/gen-api.ts",
    "check:api": "bun apps/server/scripts/gen-api.ts --check",
    "admin": "bun apps/server/scripts/set-admin.ts",
    "bench:jobs": "bun apps/server/scripts/bench-jobs.ts"
  },
  "devDependencies": {
    "@biomejs/biome": "2.6.3",
````

**Verify:** `bun run check`; `uptime` (run on a quiet host), then `bun run bench:jobs --quick` ends with `All within NFR-1's budgets.` (the full run takes about a minute). Measured in the prototype at load 1.5 on 16 cores: p95 28 ms at 7×7, 205 ms at 30×30, 11.6 s at 100×100; a generated 100×100 verifies `unique` in 0.7 s and an empty one `multiple` in 1.4 s.

**Commit:** `test(server): bench:jobs checks generation and verification against NFR-1`

### A9 Docs

**Edit `README.md`**: 4 replacements, in order.

1. Find:
````markdown
The leaderboard page (Ranks) shows each size's board for today and of all time. Each phase's plan is in
````
   Replace with:
````markdown
The leaderboard page (Ranks) shows each size's board for today and of all time. For launch, the API and the worker export Prometheus metrics and write JSON logs, the API has a readiness check, and there is a production Docker image with a Compose file and a database backup script. Each phase's plan is in
````

2. Find:
````markdown
## Scripts
````
   Replace with:
````markdown
## Production

Loophole runs as one Docker image with two commands, the API (which also serves the built web app) and the worker, next to Garage, all on one host with `compose.prod.yml`. Hosting is up to you (PRD §14); the host needs Docker with Compose and a TLS reverse proxy such as Caddy or nginx.

1. Copy `.env.production.example` to `.env.production` and `.env.garage.example` to `.env.garage`, and fill in every value: in the first, the https `PUBLIC_URL`, real Turnstile keys, a random `DAILY_SEED_SECRET`, your SMTP server and a Garage key of your own for the app; in the second, Garage's own secrets (each file says how to make its values). Only the API and the worker read `.env.production`, and only Garage reads `.env.garage`. The API and the worker refuse to start with development values (Turnstile's test keys, the development daily secret, Garage's development key, an http `PUBLIC_URL`, no `SMTP_HOST`, the development `MAIL_FROM`). For a mail relay inside the Docker network that doesn't offer STARTTLS (such as a `mailpit` service), set `SMTP_REQUIRE_TLS=false`.
2. Build the image and start Garage, then create its layout, the app's key and bucket:

   ```sh
   export COMPOSE_FILE=compose.prod.yml APP_VERSION=$(git rev-parse --short HEAD)
   docker compose build
   docker compose up -d garage
   set -a; . ./.env.production; set +a
   ./scripts/garage-init.sh
   ```

3. Start everything and check it:

   ```sh
   docker compose up -d
   curl -s localhost:3000/api/health/ready   # {"status":"ok","database":true,"blobs":true}
   docker compose exec api bun run admin you@example.com
   ```

4. Point the reverse proxy at `127.0.0.1:3000` with TLS and compression on (for Caddy: `reverse_proxy 127.0.0.1:3000` and `encode zstd gzip`). The API trusts the last `X-Forwarded-For` entry (`TRUST_PROXY=true` in the Compose file), so nothing but the proxy may reach port 3000: Compose publishes it on 127.0.0.1 only. If the proxy runs on another machine, publish it on the private interface the proxy uses, never on 0.0.0.0.

The database lives in the `loophole-data` volume (`/data/loophole.sqlite`), blobs in `garage-data` and `garage-meta`. To update, pull the code, run `docker compose build` and `docker compose up -d`; migrations run when the API and the worker start. `GET /api/health` says the process is up; `GET /api/health/ready` also checks the database and Garage and answers 503 when either fails, which the Compose health checks use. Logs are one JSON object per line (`docker compose logs api`), with a request id that the API also sends back as `X-Request-Id`; they never hold emails, tokens or passwords.

## Monitoring

The API and the worker each serve Prometheus metrics on a port of their own, off the public site: in `compose.prod.yml` the API's on `127.0.0.1:9470/metrics` and the worker's on `127.0.0.1:9471/metrics` (the worker's also answers `/health`). In development they are off; set `API_METRICS_PORT` and `WORKER_METRICS_PORT` in `.env` to turn them on. Garage's own metrics are on its admin port, `127.0.0.1:3903/metrics`, with `Authorization: Bearer <GARAGE_METRICS_TOKEN>`.

| Metric | From | What it counts |
|---|---|---|
| `loophole_http_requests_total{method,route,status}` | API | Answered requests by route template (`/api/puzzles/:id`), so 429s show rate limiting |
| `loophole_http_request_duration_seconds{method,route}` | API | Time to answer |
| `loophole_auth_failures_total{reason}` | API | Refused logins, CAPTCHA checks, mailed links and cross-site requests |
| `loophole_mail_failures_total` | API | Mails that could not be sent |
| `loophole_rate_limit_evictions_total` | API | Rate-limit counters dropped during a flood of new clients |
| `loophole_jobs_finished_total{kind,status}`, `loophole_job_duration_seconds{kind,status}` | worker | Jobs ended (done, failed, timeout) and how long they ran |
| `loophole_jobs{status}` | worker | Jobs queued and running now |
| `loophole_daily_days_stocked{size}` | worker | Days in a row, from today, whose daily puzzle is generated (0: today's is missing) |
| `loophole_daily_generation_failures_total{size}` | worker | Daily generations that failed and will be retried |
| `loophole_submissions{verdict}` | worker | Decided player submissions by verdict (PRD §10: the share rejected as `unknown`) |
| `loophole_build_info{version,runtime}` | both | Which build is running |

Both also export the standard process metrics (CPU, memory, event loop). `ops/prometheus.yml` is a sample scrape config for a Prometheus on the same host and `ops/alerts.yml` has example alerts (a target down, today's daily missing or the stock low, daily generations failing, mail failing, job timeouts, a queue backlog, server errors, rate-limit floods, many auth failures). Dashboards are left to you. Admins can also read `GET /api/admin/health`: the database and Garage checks with their errors, the job queue, the daily stock, recent failed jobs and the versions.

## Backups

`./scripts/backup-sqlite.sh [folder]` copies the database while the API and the worker keep running (SQLite's `VACUUM INTO`), checks the copy and gzips it into the folder (`backups/` by default), keeping the newest 14 (`KEEP` to change). Run it with `COMPOSE_FILE=compose.prod.yml` in production, for example daily from cron:

```sh
15 3 * * * cd /srv/loophole && COMPOSE_FILE=compose.prod.yml ./scripts/backup-sqlite.sh /srv/backups/loophole
```

To restore, stop the API and the worker, put the backup in place and start them again:

```sh
export COMPOSE_FILE=compose.prod.yml
docker compose stop api worker
docker compose run --rm --no-deps -v /srv/backups/loophole:/backups:ro api \
  bun apps/server/scripts/restore-db.ts /backups/loophole-<time>.sqlite.gz
docker compose start api worker
```

In development, `bun apps/server/scripts/restore-db.ts backups/loophole-<time>.sqlite.gz` does the same for `DATABASE_PATH`, with the dev servers stopped.

Garage holds each puzzle's solution and solver steps, which the database points at. Blobs are written before the row that points at them and never change, so back the database up first and the bucket second: every puzzle in that database backup then has its blobs in the bucket backup. Copy the bucket with rclone over the Compose network, with a read-only key made once:

```sh
docker compose exec garage /garage key create loophole-backup          # note its Key ID and Secret key
docker compose exec garage /garage bucket allow --read loophole --key <key id>
docker run --rm --network loophole-prod_default -v /srv/backups/loophole-blobs:/data rclone/rclone:1.75.1 \
  sync :s3:loophole /data --s3-provider Other --s3-endpoint http://garage:3900 --s3-region garage \
  --s3-access-key-id <key id> --s3-secret-access-key <secret key>
```

Or stop Garage and archive the `garage-data` and `garage-meta` volumes. `infra/garage/garage.prod.toml` also has Garage snapshot its metadata every 6 hours under `/var/lib/garage/meta/snapshots`. A puzzle whose blobs are lost still plays, but its hints and ranked checks fail.

## Scripts
````

3. Find:
````markdown
| `bun run admin <email>` | Make an account an admin; `--revoke` takes it away |
````
   Replace with:
````markdown
| `bun run admin <email>` | Make an account an admin; `--revoke` takes it away |
| `bun run bench:jobs` | Time generations and verifications as the worker runs them and fail if NFR-1's budgets are missed (`--quick` for a shorter run; not part of the check) |
| `./scripts/test-under-load.sh [copies] [rounds]` | Run `bun test` several times at once to shake out timing-sensitive tests |
| `./scripts/backup-sqlite.sh [folder]` | Back up the SQLite database (see Backups) |
````

4. Find:
````markdown
openapi.yaml         The API contract, generated from the server's routes
infra/garage/        Garage config for local development
scripts/             Dev helper scripts
````
   Replace with:
````markdown
openapi.yaml         The API contract, generated from the server's routes
Dockerfile           Production image (API and worker)
compose.prod.yml     Production services: API, worker, Garage
infra/garage/        Garage config for development and production
ops/                 Sample Prometheus scrape config and alert rules
scripts/             Helper scripts (Garage setup, backups, tests under load)
````

**Edit `docs/TESTING.md`**: 3 replacements, in order.

1. Find:
````markdown
GitHub Actions runs `bun install --frozen-lockfile` and then `bun run check` on every push to `main` and on every pull request.
````
   Replace with:
````markdown
GitHub Actions runs `bun install --frozen-lockfile` and then `bun run check` on every push to `main` and on every pull request.

### Timing-sensitive tests

`./scripts/test-under-load.sh [copies] [rounds] [bun test arguments]` runs `bun test` several times at once (6 copies, 5 rounds by default), which slows each run down the way a busy machine or CI does, and lists every test that failed and how often. Run it after adding a test that waits on threads, timers or other processes, for example `./scripts/test-under-load.sh 16 6 apps/server`. Bun 1.3.13 itself crashes now and then under this load ("panic: Segmentation fault", about 1 run in 50 at 16 copies, while worker threads are torn down); that is a Bun bug, not a failing test (`docs/DECISIONS.md`, "Concurrent-open tests use processes").
````

2. Find:
````markdown
The claim race test uses a database file shared by several threads.
````
   Replace with:
````markdown
The claim race test and the concurrent-open test use a database file shared by several child processes (`Bun.spawn`), as the API and the worker share one; threads would not do (`docs/DECISIONS.md`, "Concurrent-open tests use processes").
````

3. Find:
````markdown
Route tests build the daily side with `dailyDeps` and store daily puzzles with `storeDaily`, both from the server's test support.
````
   Replace with:
````markdown
Route tests build the daily side with `dailyDeps` and store daily puzzles with `storeDaily`, both from the server's test support.
- Every route test passes `health: healthManager(db, clock)` (server test support) to `createApp`. Request counts and auth failures are checked with a recording `ApiMetrics` in `api/health.test.ts`; the Prometheus adapter is tested on its own registry, and its metrics server on a free port. The JSON log writer's tests check that emails, tokens and passwords are masked.
- `bun run bench:jobs` is the server-side performance check (NFR-1): generations up to 30×30 and two 100×100 verifications through the real thread runner, failing when a budget is missed. It is not part of the check, since its timings depend on the machine.
````

**Append to the end of `docs/DECISIONS.md`** (after its last line, keeping one blank line between entries):

````markdown
## 2026-10-25 · WT12 `launch-hardening` · Concurrent-open tests use processes
- **Question:** The test "several connections opening a new file at once…" failed about once in 25 runs ("no such savepoint", "cannot start a transaction within a transaction"). Is the migration runner racing?
- **Decision:** No. bun:sqlite (1.3.13) keeps open databases in one table per process, indexed by the handle number, and adds to it without a lock: two worker threads opening a database at the same moment can get the same handle, and so share one SQLite connection, whose transactions then collide. A script opening four files from four threads got a duplicate handle in about 1 of 300 rounds. The API and the worker are separate processes that each open the database once on their main thread, so production never hits it. The concurrent-open test and the claim race test now start child processes (`Bun.spawn`) instead of threads, which is also what they stand for; with `openDatabase`'s WAL retry removed, the new open test fails 16 times in 20, so it still guards that fix. Don't open databases from several threads of one process at once. `scripts/test-under-load.sh` runs `bun test` several times at once to shake out timing-sensitive tests: about 300 full runs at up to 16 copies found no other failing test, only Bun itself crashing about once in 50 runs under that load (a segfault while worker threads are torn down; 6,000 generations in a row through the worker's thread runner never crashed it).
- **Reason:** The fault is in Bun, not in the migrations, and a test that models two processes should use two processes. Bun 1.4 may fix both problems; upgrading is left to a later change.

## 2026-10-25 · WT12 `launch-hardening` · Metrics
- **Question:** How do the API and the worker expose metrics (PRD M8), and how is that kept off the public site?
- **Decision:** `prom-client` 15.1.3, only in `adapters/metrics`. Managers and routes report through two ports, `ApiMetrics` (requests by method, route template and status, with their duration; auth failures by reason) and `WorkerMetrics` (jobs ended by kind and status, with their running time; failed daily generations by size); mail failures and rate-limiter evictions come from callbacks on those adapters. The worker's gauges (jobs queued and running, daily puzzles stocked ahead per size, decided submissions by verdict for PRD §10's share rejected as `unknown`) are read from the database at each scrape. A submission whose job timed out is settled to `unknown` only when it is next read (WT10), so that gauge can lag until then. Each process serves `/metrics` on a listener of its own, `METRICS_HOST` with `API_METRICS_PORT` or `WORKER_METRICS_PORT`, off by default (0) and set to 9470 and 9471 in `compose.prod.yml`, published on 127.0.0.1 only; there is no token. Rate limiting shows as `status="429"` in the request counter rather than a counter of its own. Garage's own metrics need its `metrics_token`. `ops/prometheus.yml` and `ops/alerts.yml` are samples; dashboards are out of scope.
Biome's import rules refuse `prom-client` in managers and routes, like `nodemailer`.
- **Reason:** A separate port can't be reached through the reverse proxy at all, so no secret has to be managed or leaked, and both processes work the same way. Route templates and fixed label values keep the number of series bounded whatever paths clients send. Reading gauges at scrape time needs no timer and is always current.

## 2026-10-25 · WT12 `launch-hardening` · Health checks
- **Question:** What do health checks report, and to whom?
- **Decision:** `GET /api/health` stays a liveness check (the process answers). `GET /api/health/ready` reads the jobs table and a blob key nobody writes, each within 2 s, and answers 200 or 503 with `{status, database, blobs}` and no error text; Compose's health check uses it. `GET /api/admin/health` (admins only) adds the error messages, the job queue with the age of the oldest waiting job, the days of daily puzzles stocked per size, the ten latest failed or timed-out jobs, and the app, generator and runtime versions with the start time. The admin page shows it in words. The worker's metrics listener also answers `/health` for its own container check.
- **Reason:** Readiness without details is safe to leave public; the details go to admins. The API can see the worker's work through the shared database, so the admin page needs no call to the worker: a growing oldest-waiting age or a falling stock shows a stuck worker.

## 2026-10-25 · WT12 `launch-hardening` · Structured logs
- **Question:** How are logs structured and kept free of personal data and secrets?
- **Decision:** The composition roots call `installJsonLogging`, which replaces `console.*` with writers of one JSON object per line (`time`, `level`, `process`, `msg`, plain-object fields, and `err` with name, message and stack). Every string is masked first: emails, `token=`/`password:`-style values, `Bearer` credentials and runs of 40 or more letters, digits, `_` or `-` (session and mailed tokens are 43 base64url characters and may hold dashes; UUIDs, 36, stay), and fields named like passwords, secrets, tokens, cookies or emails are dropped. The API runs each request in an `AsyncLocalStorage` context with its request id (a well-formed `X-Request-Id` from the proxy, or a new UUID, sent back in the answer), so every line logged during a request carries it, and logs one line per answered request with method, route template, status and time: no path, query string, address or body. Passing health checks aren't logged. Code keeps calling `console.*`, so managers need no logger port.
- **Reason:** One line per event is what log tools ingest; masking in the writer catches what a call site forgets (NFR-4, NFR-6). Route templates instead of paths keep ids out of the access log too.

## 2026-10-25 · WT12 `launch-hardening` · Production settings
- **Question:** Which settings must a production deployment set, and how is that enforced?
- **Decision:** As WT7 and WT11 did for Turnstile's test secret and the daily seed secret, a `PUBLIC_URL` that isn't on localhost means production, and `loadConfig` then refuses, listing every problem at once: Turnstile's test secret or test site key, the development daily seed secret, Garage's development access key, a `PUBLIC_URL` that isn't https, no `SMTP_HOST` (mail would go to localhost:1025) and the development `MAIL_FROM`. No separate production flag.
- **Reason:** One rule that already exists, extended to every development default that would make a public site unsafe or quietly broken. Listing them all saves a deploy-fix-deploy loop per setting.

## 2026-10-25 · WT12 `launch-hardening` · Production image and Compose file
- **Question:** How is Loophole packaged and run in production (PRD M8; hosting itself is deferred, §14)?
- **Decision:** One multi-stage `Dockerfile` on `oven/bun:1.3.13-slim`: a stage builds the web app, and the final image holds production dependencies, the server and core sources and the built app (about 330 MB), runs as the `bun` user with `/data` for the database, and starts the API by default; the worker is the same image with another command. `compose.prod.yml` (project `loophole-prod`, apart from the dev project) runs the API, the worker and Garage with named volumes, `init: true`, `restart: unless-stopped`, the app's settings from `.env.production`, and health checks done with `bun -e` (the image has no curl). Only 127.0.0.1 ports are published: the API's 3000 for a reverse proxy, the two metrics ports and Garage's admin port. Garage's secrets (`GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`, `GARAGE_METRICS_TOKEN`) are in a file of their own, `.env.garage`, which only the garage service reads, so a compromised API can't administer Garage and Garage never holds the app's secrets; `infra/garage/garage.prod.toml` holds the rest; `scripts/garage-init.sh` takes the bucket and key from `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` when they are set. The image was built and run once with this file: readiness, the web app, a generated puzzle, today's dailies, the three metrics endpoints, backup and restore.
- **Reason:** The server runs TypeScript directly under Bun, so the image needs no compile step, and one image for both processes keeps them on the same build. Publishing on loopback only means the reverse proxy, which terminates TLS and compresses, is the one way in, which `TRUST_PROXY=true` relies on.

## 2026-10-25 · WT12 `launch-hardening` · Backups
- **Question:** How are the database and the blobs backed up and restored?
- **Decision:** `scripts/backup-sqlite.sh` runs `apps/server/scripts/backup-db.ts`, which copies the live database with `VACUUM INTO` (a consistent snapshot while the API and the worker write) and checks the copy with `PRAGMA integrity_check`; the script gzips it into a folder and keeps the newest 14. With `COMPOSE_FILE` set it runs inside the API container and streams the gzip out, so file ownership on the host doesn't matter. `apps/server/scripts/restore-db.ts` checks a backup, removes the old write-ahead log and moves the backup into place; the README has the steps. `apps/server/scripts/backup-restore.test.ts` runs both scripts as processes on a database another connection holds open, with rows still in its write-ahead log, and restores over a stale log. For Garage: back the database up first and the bucket second (blobs are written before their rows and never change), with rclone on the Compose network and a read-only key, or by archiving its volumes; its metadata is also snapshotted every 6 hours.
- **Reason:** `VACUUM INTO` needs nothing but SQLite and doesn't stop the services. Removing the old WAL on restore keeps SQLite from replaying it onto the restored file. The order makes every backed-up puzzle's blobs present in the bucket copy.

## 2026-10-25 · WT12 `launch-hardening` · Auth mail stays in the API process
- **Question:** Should verification and reset mail go through the jobs table, so a slow SMTP server doesn't slow sign-up (the WT7 follow-up)?
- **Decision:** Not now. `BackgroundMailer` already sends after the answer, so SMTP latency never reaches the request. Failures are now counted (`loophole_mail_failures_total`) and alerted on. A mail lost when the API stops mid-send stays the accepted cost, as in WT7; "Send a new link" recovers it.
- **Reason:** A durable mail queue would add a job kind, retries and a worker dependency on SMTP for a loss that is rare and recoverable. The metric makes an outage visible, which was the real gap.

## 2026-10-25 · WT12 `launch-hardening` · Server performance check
- **Question:** How is NFR-1 checked on the server side, where jobs run in threads under time limits?
- **Decision:** `bun run bench:jobs` runs generations at 7×7 to 30×30 (20 each), 40×40 and 100×100 through the real `ThreadTaskRunner` with the worker's time limits, then verifies a generated 100×100 and an empty 100×100, and fails when generation p95 up to 30×30 reaches 5 s or a verification ends without a verdict or takes over 35 s. It prints the load average first. Measured on the dev host (load 1.5 of 16 cores): p95 28 ms at 7×7, 205 ms at 30×30, 11.6 s at 100×100; verifications 0.7 s (unique) and 1.4 s (multiple). It is not part of the check.
- **Reason:** core's benchmarks time the algorithms; this one also times what the worker adds (a fresh thread and its module loading per job) and the budgets the PRD states. Timings depend on the host, so it is a script to run, not a gate.
````

**Edit `AGENTS.md`**: 1 replacement, in order.

1. Find:
````markdown
Local dev services (Garage, Mailpit) run with Docker Compose; the README has the commands.
````
   Replace with:
````markdown
Local dev services (Garage, Mailpit) run with Docker Compose; the README has the commands. Production runs from the `Dockerfile` and `compose.prod.yml`; the README covers deployment, monitoring and backups.
````

**Edit `apps/server/AGENTS.md`**: 1 replacement, in order.

1. Find:
````markdown
- Tests: managers with fakes,
````
   Replace with:
````markdown
- Counts for monitoring go through the `ApiMetrics` and `WorkerMetrics` ports (optional deps, so tests can leave them out); only `adapters/metrics` imports `prom-client`. Label metrics by route template or a small fixed set of values, never by ids or raw paths.
- Log with `console.*`: the composition roots turn every call into a JSON line with the request id and mask emails, tokens and secrets. Still keep emails, tokens and message bodies out of log calls.
- Tests: managers with fakes,
````

**Verify:** `bun run check`.

**Commit:** `docs: production, monitoring, backups and the concurrent-open fix`

### A10 Build and run the production stack once (no commit)

This checks the image, the Compose file, the metrics endpoints, a generated puzzle, and backup and restore, under a throwaway project name with bind mounts, so nothing touches the dev or a real production project. All paths below are under a scratch folder; set it first.

1. Scratch folder, data folders and the image:

   ```sh
   export W=/tmp/loophole-wt12-check && mkdir -p $W/data $W/meta $W/gdata $W/backups && chmod 777 $W/data
   docker build -q --build-arg APP_VERSION=$(git rev-parse --short HEAD) -t loophole-wt12-test .
   ```

2. Write `.env.production` and `.env.garage` (Write tool; both git-ignored; delete them at the end) with test values that pass the production checks. `.env.production`:

   ````text
   PUBLIC_URL=https://loophole.test
   TURNSTILE_SITE_KEY=prod-test-site-key
   TURNSTILE_SECRET_KEY=prod-test-secret-key
   DAILY_SEED_SECRET=wt12-check-daily-secret-not-real
   SMTP_HOST=smtp.invalid
   SMTP_PORT=465
   SMTP_SECURE=true
   MAIL_FROM="Loophole <no-reply@loophole.test>"
   S3_REGION=garage
   S3_BUCKET=loophole
   S3_ACCESS_KEY_ID=GK0123456789abcdef01234567
   S3_SECRET_ACCESS_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
   DAILY_DAYS_AHEAD=2
   ````

   `.env.garage`:

   ````text
   GARAGE_RPC_SECRET=fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210
   GARAGE_ADMIN_TOKEN=wt12-admin-token
   GARAGE_METRICS_TOKEN=wt12-metrics-token
   ````

3. Write `compose.check.yml` (Write tool; don't commit it) so the check uses other host ports and the scratch folders. Replace `<W>` with the value of `$W`:

   ````yaml
   services:
     api:
       image: loophole-wt12-test
       ports: !override
         - "127.0.0.1:4900:3000"
         - "127.0.0.1:4970:9470"
       volumes: !override
         - <W>/data:/data
     worker:
       image: loophole-wt12-test
       ports: !override
         - "127.0.0.1:4971:9471"
       volumes: !override
         - <W>/data:/data
     garage:
       ports: !override
         - "127.0.0.1:4903:3903"
       volumes: !override
         - ./infra/garage/garage.prod.toml:/etc/garage.toml:ro
         - <W>/meta:/var/lib/garage/meta
         - <W>/gdata:/var/lib/garage/data
   ````

4. Start Garage, initialize it, start the rest and check (expected answers in comments):

   ```sh
   export COMPOSE_FILE=compose.prod.yml:compose.check.yml COMPOSE_PROJECT_NAME=loophole-wt12
   docker compose up -d garage && sleep 6
   S3_BUCKET=loophole S3_ACCESS_KEY_ID=GK0123456789abcdef01234567 S3_SECRET_ACCESS_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef ./scripts/garage-init.sh
   docker compose up -d --no-build && sleep 25
   docker compose ps --format '{{.Service}} {{.Status}}'      # api, garage, worker: Up … (healthy)
   curl -s localhost:4900/api/health/ready                     # {"status":"ok","database":true,"blobs":true}
   curl -s -o /dev/null -w '%{http_code}\n' localhost:4900/    # 200 (the web app)
   J=$(curl -s -X POST localhost:4900/api/jobs/generate -H 'content-type: application/json' -d '{"width":10,"height":10}' | sed 's/.*"id":"\([^"]*\)".*/\1/'); sleep 4
   curl -s localhost:4900/api/jobs/$J | grep -o '"status":"done"'
   curl -s localhost:4900/api/daily | grep -o '"puzzleId":"[^"]*"' | head -4   # four ids
   curl -s localhost:4970/metrics | grep -E '^loophole_(build_info|http_requests_total)'
   curl -s localhost:4971/metrics | grep -E '^loophole_(jobs|daily_days_stocked)'   # stocked = 2 per size
   curl -s -H 'Authorization: Bearer wt12-metrics-token' localhost:4903/metrics | grep -c '^api_s3'   # above 0
   curl -s -o /dev/null -w '%{http_code}\n' localhost:4903/metrics   # 403 without the token
   docker compose logs api --no-log-prefix | head -3           # JSON lines
   docker compose exec -T api sh -c 'env | grep -c GARAGE_'    # 0: the app never sees Garage's secrets
   docker inspect loophole-wt12-garage-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -cE 'DAILY_SEED|TURNSTILE|S3_SECRET'   # 0
   ```

5. Backup and restore: a job made after the backup is gone after the restore.

   ```sh
   ./scripts/backup-sqlite.sh $W/backups
   J2=$(curl -s -X POST localhost:4900/api/jobs/generate -H 'content-type: application/json' -d '{"width":5,"height":5}' | sed 's/.*"id":"\([^"]*\)".*/\1/'); sleep 3
   docker compose stop api worker
   docker compose run --rm --no-deps -v $W/backups:/backups:ro api bun apps/server/scripts/restore-db.ts /backups/$(ls $W/backups | head -1)
   docker compose start api worker && sleep 15
   curl -s localhost:4900/api/health/ready                     # ok again
   curl -s -o /dev/null -w '%{http_code}\n' localhost:4900/api/jobs/$J2   # 404
   ```

6. The README's bucket copy, with a read-only key (`<key id>` and `<secret key>` from the first command's output):

   ```sh
   docker compose exec -T garage /garage key create loophole-backup
   docker compose exec -T garage /garage bucket allow --read loophole --key <key id>
   mkdir -p $W/blobs && chmod 777 $W/blobs
   docker run --rm --network loophole-wt12_default -v $W/blobs:/data rclone/rclone:1.75.1 sync :s3:loophole /data --s3-provider Other --s3-endpoint http://garage:3900 --s3-region garage --s3-access-key-id <key id> --s3-secret-access-key <secret key>
   find $W/blobs -name solution.txt | head -2                  # puzzles/<id>/solution.txt
   ```

7. Optional: point a Prometheus at it to see the targets up and the rules load (copy `ops/` to `$W/prom`, change the three target ports to 4970, 4971 and 4903, put `wt12-metrics-token` in `$W/prom/garage-metrics-token`, then `docker run -d --name loophole-wt12-prom --network host -v $W/prom:/etc/prometheus:ro prom/prometheus:v3.10.0 --config.file=/etc/prometheus/prometheus.yml --web.listen-address=127.0.0.1:4990` and read `localhost:4990/api/v1/targets`; remove it with `docker rm -f loophole-wt12-prom`).

8. Clean up what this step made, and nothing else:

   ```sh
   docker compose stop && docker compose rm -f
   docker network rm loophole-wt12_default
   docker image rm loophole-wt12-test rclone/rclone:1.75.1
   rm compose.check.yml .env.production .env.garage
   unset COMPOSE_FILE COMPOSE_PROJECT_NAME
   git status --short   # clean
   ```

   The scratch folder's Garage files belong to root inside the container; leave `$W` if it can't be removed.

## Acceptance criteria

- **Flaky test (follow-up)**: the concurrent-open and claim race tests use child processes; `./scripts/test-under-load.sh 16 6 apps/server` reports no failing test (a Bun segfault line, if any, is the recorded Bun bug); the open test still fails without `openDatabase`'s WAL retry (A1).
- **M8 metrics**: `curl` on the API's and the worker's metrics ports returns Prometheus text with `loophole_http_requests_total` (route templates), `loophole_auth_failures_total`, `loophole_mail_failures_total`, `loophole_rate_limit_evictions_total`, `loophole_jobs_finished_total`, `loophole_job_duration_seconds`, `loophole_jobs`, `loophole_daily_days_stocked`, `loophole_daily_generation_failures_total` and `loophole_build_info` (adapter tests; A4 and A10 live). Garage's metrics answer with its token and 403 without. Biome refuses `prom-client` in managers and routes (`biome.json`). PRD §10's share of submissions rejected as `unknown` is `loophole_submissions{verdict}`.
- **§10 / §12 visibility**: alert rules for today's daily missing, stock low, generation failing, mail failing, job timeouts, backlog, 5xx, floods and auth failures load in Prometheus (A6).
- **Health (§5)**: `/api/health/ready` answers 200 or 503 without details; `/api/admin/health` is 401/403 for non-admins and reports checks with errors, queue, daily stock, failures and versions (route and manager tests).
- **NFR-4, NFR-6 (logs)**: every log line is JSON with a request id during requests; emails, tokens (with or without dashes), passwords, keys and cookies are masked (`logging.test.ts`); the access log has no path, query, address or body.
- **NFR-4 (production settings)**: with a non-localhost `PUBLIC_URL`, the API and worker refuse Turnstile's test keys, the development daily secret, Garage's development key, an http URL, an unset `SMTP_HOST` and the development `MAIL_FROM`, all listed at once (`config.test.ts`).
- **Deployment (M8)**: the image builds; `compose.prod.yml` starts API, worker and Garage healthy, serves the web app and a generated puzzle, publishes only 127.0.0.1 ports (A10).
- **Backups**: `scripts/backup-sqlite.sh` makes a checked, gzipped online copy in development and production that keeps rows still in the WAL, and `restore-db.ts` brings it back over a stale WAL (`backup-restore.test.ts`; A10 steps 5 and 6, the bucket copy included).
- **Secrets separation**: the API and worker containers hold no Garage secret and the Garage container no app secret (A10 step 4).
- **NFR-1**: `bun run bench:jobs` passes on a quiet host (generation p95 under 5 s up to 30×30; 100×100 verifications end within the 30 s budget).
- `bun run check` passes after every step; `E2E_AUTH_PORT=4304 bun run test:e2e:auth` still passes with the dev services.

## DECISIONS entries (added in step A9)

Concurrent-open tests use processes · Metrics · Health checks · Structured logs · Production settings · Production image and Compose file · Backups · Auth mail stays in the API process · Server performance check. The full text is in step A9.

## Merge notes

- WT11b is merged (main `781a247`); this plan was written and checked against that tree. If main has moved on, merge it first; the Find blocks are against `781a247`.
- 12a and 12b touch different files except `README.md`, `docs/TESTING.md`, `docs/DECISIONS.md` and the root `package.json`; 12b's Find blocks for those assume 12a is done.
- `bun run gen:api` (A4) rewrites `openapi.yaml` and the client; if a merge conflicts there, take either side and run it again.

## Review responses (plan review 1)

- **12a-1 (Garage and the app share one env file):** accepted. `.env.garage.example` holds Garage's three secrets and the garage service reads only `.env.garage`; `.env.production.example` no longer lists them; `.gitignore`, the README, DECISIONS and A10 follow. Checked live: the API container has no `GARAGE_` variable and the Garage container none of the app's secrets.
- **12a-2 (dashed tokens not masked):** accepted. `LONG_TOKEN` is now `/(?<![\w-])[A-Za-z0-9_-]{40,}(?![\w-])/g`; tests cover a 43-character token with a dash, bare and as the session cookie value, and a UUID with a file path that must stay.
- **12a-3 (no lint rule for `prom-client`):** accepted. `biome.json` refuses it in managers and in the non-root entrypoints; checked that an import there fails lint.
- **12a-4 (orphan children, tight timeout):** accepted. The claim test kills its children in `finally`; both process tests take 30 s.
- **12a-5 (§10 unknown share not exported):** accepted. `SubmissionRepository.countByVerdict()` (SQL and fake, tested) feeds the scrape-time gauge `loophole_submissions{verdict}`; README row added. DECISIONS notes that a timed-out submission counts as `unknown` only once it has been read, as WT10 settles it on read.
- **12a-6 (empty SMTP login refused):** accepted. The example comments out `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_REQUIRE_TLS` and says to leave them unset for a relay without login.
- **12a-7 (bucket copy as written couldn't work):** accepted. The README makes a read-only key with `garage key create` and `bucket allow --read`, and runs rclone 1.75.1 on the Compose network against `http://garage:3900`; the same commands ran against the checked stack (A10 step 6).
- **12a-8 (backups untested):** accepted. `apps/server/scripts/backup-restore.test.ts` runs both scripts as processes: rows still in the WAL of an open database are in the backup, a second backup doesn't overwrite, and the restore removes a stale WAL and passes the integrity check.

## Unresolved questions

- **Bun upgrade.** The handle race and the occasional test-runner segfault are Bun 1.3.13 bugs. Default: stay on 1.3.13 for launch and try 1.4.x in its own change.
- **Metrics ports.** 9470/9471 were picked because 9464 is in use on the dev host. Default: keep them; change both the Compose file and `ops/prometheus.yml` if the production host differs.
- **Alert thresholds** in `ops/alerts.yml` are guesses without traffic data. Default: keep and tune after launch.
