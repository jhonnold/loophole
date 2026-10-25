import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config.ts";

const S3 = {
  S3_ENDPOINT: "http://localhost:3900",
  S3_REGION: "garage",
  S3_BUCKET: "loophole-dev",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
  PUBLIC_URL: "http://localhost:5173",
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
      publicUrl: "http://localhost:5173",
      trustProxy: false,
      turnstile: {
        siteKey: "1x00000000000000000000AA",
        secretKey: "1x0000000000000000000000000000000AA",
      },
      smtp: {
        host: "localhost",
        port: 1025,
        secure: false,
        user: undefined,
        password: undefined,
        from: "Loophole <no-reply@loophole.localhost>",
      },
      sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
      dailies: { seedSecret: "loophole-dev-daily-seed-secret", daysAhead: 3, stockMs: 60_000 },
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
      workerId: `w1-${process.pid}`,
      jobs: { generateTimeoutMs: 1000 },
    });
  });

  test("reads the account and mail settings", () => {
    const config = loadConfig({
      ...S3,
      PUBLIC_URL: "https://loophole.example/",
      TRUST_PROXY: "true",
      TURNSTILE_SITE_KEY: "site",
      TURNSTILE_SECRET_KEY: "secret",
      SMTP_HOST: "smtp.example",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_USER: "user",
      SMTP_PASSWORD: "pass",
      MAIL_FROM: "Loophole <hi@loophole.example>",
      DAILY_SEED_SECRET: "a-long-random-production-secret",
      DAILY_DAYS_AHEAD: "5",
    });
    expect(config).toMatchObject({
      publicUrl: "https://loophole.example",
      trustProxy: true,
      turnstile: { siteKey: "site", secretKey: "secret" },
      smtp: {
        host: "smtp.example",
        port: 465,
        secure: true,
        user: "user",
        password: "pass",
        from: "Loophole <hi@loophole.example>",
      },
      dailies: { seedSecret: "a-long-random-production-secret", daysAhead: 5 },
    });
  });

  test("SMTP_REQUIRE_TLS is optional and reads as a boolean", () => {
    expect(loadConfig(S3).smtp.requireTls).toBeUndefined();
    expect(loadConfig({ ...S3, SMTP_REQUIRE_TLS: "false" }).smtp.requireTls).toBe(false);
    expect(loadConfig({ ...S3, SMTP_REQUIRE_TLS: "true" }).smtp.requireTls).toBe(true);
  });

  test("refuses Turnstile's test secret for a site that isn't on localhost", () => {
    expect(() => loadConfig({ ...S3, PUBLIC_URL: "https://loophole.example" })).toThrow(
      /TURNSTILE_SECRET_KEY is Cloudflare's always-pass test key/,
    );
    expect(loadConfig({ ...S3, PUBLIC_URL: "http://127.0.0.1:4174" }).turnstile.secretKey).toBe(
      "1x0000000000000000000000000000000AA",
    );
  });

  test("refuses the development daily seed secret for a site that isn't on localhost", () => {
    const site = {
      ...S3,
      PUBLIC_URL: "https://loophole.example",
      TURNSTILE_SITE_KEY: "site",
      TURNSTILE_SECRET_KEY: "secret",
    };
    expect(() => loadConfig(site)).toThrow(/DAILY_SEED_SECRET is the development value/);
    expect(() => loadConfig({ ...site, DAILY_SEED_SECRET: "short" })).toThrow(/DAILY_SEED_SECRET/);
  });

  test("requires PUBLIC_URL: there is no default", () => {
    expect(() => loadConfig({ ...S3, PUBLIC_URL: undefined })).toThrow(/PUBLIC_URL/);
  });

  test("names every missing or bad setting", () => {
    expect(() => loadConfig({ PORT: "nope" })).toThrow(/PORT[\s\S]*S3_ENDPOINT/);
  });
});
