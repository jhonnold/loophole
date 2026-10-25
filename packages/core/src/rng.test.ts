import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { createRng, hashSeed } from "./rng.ts";

// Golden values. If one of these changes, every seeded puzzle changes (FR-10): don't update them,
// fix the code.
describe("hashSeed", () => {
  test("matches cyrb128", () => {
    expect(hashSeed("")).toEqual([41608494, 3485963809, 1435736333, 1262568316]);
    expect(hashSeed("a")).toEqual([1589175524, 148824423, 2405369273, 1476957317]);
    expect(hashSeed("loophole")).toEqual([2238043155, 186262874, 2921728731, 3017925730]);
  });
});

describe("createRng", () => {
  const take = (seed: string, n: number) => {
    const rng = createRng(seed);
    return Array.from({ length: n }, () => rng.next());
  };

  test("produces the frozen sequence for a seed", () => {
    expect(take("loophole", 5)).toEqual([677394555, 4278237813, 640741612, 2639088317, 2615015132]);
    expect(take("", 5)).toEqual([2420727049, 3315390910, 31621017, 4095259433, 4180064351]);
    expect(take("日本", 5)).toEqual([647600776, 487772127, 3857602401, 239966375, 873164811]);
  });

  test("float divides next by 2^32", () => {
    const rng = createRng("loophole");
    expect([rng.float(), rng.float(), rng.float()]).toEqual([
      0.1577182102482766, 0.9961048637051135, 0.149184281937778,
    ]);
  });

  test("int gives the frozen sequence", () => {
    const rng = createRng("loophole");
    expect(Array.from({ length: 10 }, () => rng.int(10))).toEqual([5, 3, 2, 7, 2, 6, 9, 2, 3, 5]);
    const full = createRng("loophole");
    expect(full.int(2 ** 32)).toBe(677394555);
    expect(createRng("x").int(1)).toBe(0);
  });

  test("int rejects n outside 1 to 2^32", () => {
    const rng = createRng("x");
    for (const n of [0, -1, 1.5, 2 ** 32 + 1, Number.NaN])
      expect(() => rng.int(n)).toThrow(RangeError);
  });

  test("the same seed repeats and different seeds differ", () => {
    expect(take("a", 20)).toEqual(take("a", 20));
    expect(take("a", 5)).not.toEqual(take("b", 5));
  });

  test("int and float stay in range", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 1000 }), (seed, n) => {
        const rng = createRng(seed);
        for (let i = 0; i < 50; i++) {
          const k = rng.int(n);
          expect(Number.isInteger(k) && k >= 0 && k < n).toBe(true);
          const f = rng.float();
          expect(f >= 0 && f < 1).toBe(true);
        }
      }),
    );
  });
});
