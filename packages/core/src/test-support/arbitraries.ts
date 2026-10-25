import fc from "fast-check";
import { bruteForceSolutions } from "../bruteforce.ts";
import type { PuzzleWireV1 } from "../format.ts";
import {
  createPuzzle,
  deriveClues,
  MAX_META_KEY_LENGTH,
  MAX_SEED_LENGTH,
  NO_CLUE,
  type Puzzle,
} from "../puzzle.ts";

/** Valid v1 wire objects, with optional seed and meta. */
export function arbPuzzleWire(maxWidth = 12, maxHeight = 12): fc.Arbitrary<PuzzleWireV1> {
  return fc
    .record({
      width: fc.integer({ min: 1, max: maxWidth }),
      height: fc.integer({ min: 1, max: maxHeight }),
    })
    .chain(({ width, height }) =>
      fc.record(
        {
          v: fc.constant(1 as const),
          width: fc.constant(width),
          height: fc.constant(height),
          clues: fc
            .array(fc.constantFrom(".", "0", "1", "2", "3"), {
              minLength: width * height,
              maxLength: width * height,
            })
            .map((chars) => chars.join("")),
          seed: fc.string({ minLength: 1, maxLength: MAX_SEED_LENGTH }),
          meta: fc.dictionary(
            fc.string({ minLength: 1, maxLength: MAX_META_KEY_LENGTH }),
            fc.string({ maxLength: 50 }),
            {
              maxKeys: 8,
              noNullPrototype: true,
            },
          ),
        },
        { requiredKeys: ["v", "width", "height", "clues"] },
      ),
    );
}

const loopCache = new Map<string, Uint8Array[]>();

/** Every single loop on an empty width×height grid, cached. Keep width×height small. */
export function allLoops(width: number, height: number): Uint8Array[] {
  const key = `${width}x${height}`;
  let loops = loopCache.get(key);
  if (loops === undefined) {
    loops = bruteForceSolutions(createPuzzle(width, height), Number.POSITIVE_INFINITY);
    loopCache.set(key, loops);
  }
  return loops;
}

/**
 * A puzzle together with one of its solutions: a random loop, with each derived clue kept or blanked
 * at random. The puzzle may have other solutions too.
 */
export function arbPuzzleWithSolution(
  maxWidth = 3,
  maxHeight = 3,
): fc.Arbitrary<{ puzzle: Puzzle; solution: Uint8Array }> {
  return fc
    .record({
      width: fc.integer({ min: 1, max: maxWidth }),
      height: fc.integer({ min: 1, max: maxHeight }),
    })
    .chain(({ width, height }) =>
      fc.record({
        width: fc.constant(width),
        height: fc.constant(height),
        loop: fc.nat({ max: allLoops(width, height).length - 1 }),
        keep: fc.array(fc.boolean(), { minLength: width * height, maxLength: width * height }),
      }),
    )
    .map(({ width, height, loop, keep }) => {
      const solution = allLoops(width, height)[loop];
      const full = deriveClues(createPuzzle(width, height).grid, solution);
      const clues = Array.from(full, (k, i) => (keep[i] && k <= 3 ? k : NO_CLUE));
      return { puzzle: createPuzzle(width, height, clues), solution };
    });
}
