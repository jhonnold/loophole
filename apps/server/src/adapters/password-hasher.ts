import type { PasswordHasher } from "../ports.ts";

/**
 * argon2id through `Bun.password` (PRD FR-18), with OWASP's minimum settings: 19 MiB of memory,
 * two passes. The hash string records its settings, so they can be raised later.
 */
export const argon2idHasher: PasswordHasher = {
  hash: (password) =>
    Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 }),
  verify: (password, hash) => Bun.password.verify(password, hash),
};
