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
  /** Unique per process: the name (WORKER_ID, or the host) plus the pid, so a reclaimed job's old worker can't match the new one. */
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
  };
}
