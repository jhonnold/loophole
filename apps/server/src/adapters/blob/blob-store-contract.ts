import { expect, test } from "bun:test";
import type { BlobStore } from "../../ports.ts";

/** The behaviour every `BlobStore` shares. Each implementation's test file calls this. */
export function blobStoreContract(makeStore: () => BlobStore, prefix: string): void {
  test("get returns what put stored, and null for a missing key", async () => {
    const store = makeStore();
    const key = `${prefix}/a.txt`;
    await store.put(key, "112211121121", "text/plain");
    expect(await store.get(key)).toBe("112211121121");
    expect(await store.get(`${prefix}/missing.txt`)).toBeNull();
    await store.delete(key);
  });

  test("put replaces and delete removes", async () => {
    const store = makeStore();
    const key = `${prefix}/b.json`;
    await store.put(key, "[1]", "application/json");
    await store.put(key, "[2]", "application/json");
    expect(await store.get(key)).toBe("[2]");
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
  });
}
