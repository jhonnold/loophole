import { expect, test } from "bun:test";
import { argon2idHasher } from "./password-hasher.ts";
import { randomToken } from "./random-token.ts";

test("hashes with argon2id and verifies only the right password", async () => {
  const hash = await argon2idHasher.hash("correct horse");
  expect(hash).toStartWith("$argon2id$v=19$m=19456,t=2,");
  expect(await argon2idHasher.verify("correct horse", hash)).toBe(true);
  expect(await argon2idHasher.verify("wrong horse", hash)).toBe(false);
  expect(await argon2idHasher.hash("correct horse")).not.toBe(hash); // salted
});

test("random tokens are 32 bytes of base64url and don't repeat", () => {
  const tokens = new Set(Array.from({ length: 100 }, randomToken));
  expect(tokens.size).toBe(100);
  for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
});
