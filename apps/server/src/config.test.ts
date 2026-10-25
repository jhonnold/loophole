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
