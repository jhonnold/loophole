import { describe, expect, test } from "bun:test";
import { MAX_SEED_LENGTH } from "@loophole/core";
import { hmacDailySeeder } from "./daily-seeds.ts";

describe("hmacDailySeeder", () => {
  test("is the same for the same day, size, attempt and secret, and differs otherwise", () => {
    const seeds = hmacDailySeeder("secret-one-for-tests");
    const seed = seeds.seed("2026-10-25", 7, 0);
    expect(seeds.seed("2026-10-25", 7, 0)).toBe(seed);
    expect(seed.length).toBeLessThanOrEqual(MAX_SEED_LENGTH);
    const others = [
      seeds.seed("2026-10-26", 7, 0),
      seeds.seed("2026-10-25", 10, 0),
      seeds.seed("2026-10-25", 7, 1),
      hmacDailySeeder("secret-two-for-tests").seed("2026-10-25", 7, 0),
    ];
    expect(new Set([seed, ...others]).size).toBe(5);
  });
});
