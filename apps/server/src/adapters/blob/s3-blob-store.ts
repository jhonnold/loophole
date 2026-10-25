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
