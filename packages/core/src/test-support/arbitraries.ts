import fc from "fast-check";
import type { PuzzleWireV1 } from "../format.ts";

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
          seed: fc.string({ minLength: 1, maxLength: 128 }),
          meta: fc.dictionary(
            fc.string({ minLength: 1, maxLength: 64 }),
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
