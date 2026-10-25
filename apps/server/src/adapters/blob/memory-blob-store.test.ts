import { describe } from "bun:test";
import { blobStoreContract } from "./blob-store-contract.ts";
import { MemoryBlobStore } from "./memory-blob-store.ts";

describe("MemoryBlobStore", () => {
  blobStoreContract(() => new MemoryBlobStore(), "test");
});
