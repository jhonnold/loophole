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
