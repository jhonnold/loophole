/** A deterministic pseudo-random number generator (sfc32 seeded by cyrb128). */
export interface Rng {
  /** A uniform unsigned 32-bit integer. */
  next(): number;
  /** A uniform float in [0, 1). */
  float(): number;
  /** A uniform integer in [0, n). `n` must be a whole number from 1 to 2^32. */
  int(n: number): number;
}

const TWO_POW_32 = 2 ** 32;

/** Hashes a string (by UTF-16 code units) to four unsigned 32-bit words with cyrb128. */
export function hashSeed(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * Creates a generator for a seed string. The same seed always gives the same sequence, on every
 * JavaScript engine. Changing this algorithm changes every seeded result, so treat it as frozen.
 */
export function createRng(seed: string): Rng {
  let [a, b, c, d] = hashSeed(seed);

  function next(): number {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  }

  // Discard the first outputs so similar seeds diverge.
  for (let i = 0; i < 15; i++) next();

  return {
    next,
    float: () => next() / TWO_POW_32,
    int(n: number): number {
      if (!Number.isInteger(n) || n < 1 || n > TWO_POW_32) {
        throw new RangeError(`n must be a whole number from 1 to 2^32, got ${n}`);
      }
      // Reject the top partial block so every result is equally likely.
      const limit = TWO_POW_32 - (TWO_POW_32 % n);
      let x = next();
      while (x >= limit) x = next();
      return x % n;
    },
  };
}
