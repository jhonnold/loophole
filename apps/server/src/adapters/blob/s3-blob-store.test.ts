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
