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
  GENERATE_TIMEOUT_MS: Ms.default(1_800_000),
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
