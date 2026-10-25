import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  decodeEdges,
  encodeEdges,
  FormatError,
  parsePuzzle,
  parsePuzzleJson,
  serializePuzzle,
  serializePuzzleJson,
} from "./format.ts";
import { createGrid } from "./grid.ts";
import { NO_CLUE } from "./puzzle.ts";
import { arbPuzzleWire } from "./test-support/arbitraries.ts";

const PLAY_PUZZLE = {
  v: 1,
  width: 7,
  height: 7,
  clues: ".11..0..23.2......2.21.0....1....01.1..3..0..1..1",
} as const;

function formatError(fn: () => unknown): FormatError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(FormatError);
    return err as FormatError;
  }
  throw new Error("expected a FormatError");
}

describe("parsePuzzle", () => {
  test("reads the design kit's 7×7 puzzle", () => {
    const p = parsePuzzle(PLAY_PUZZLE);
    expect(p.grid.width).toBe(7);
    expect(p.grid.height).toBe(7);
    expect(Array.from(p.clues.slice(0, 6))).toEqual([NO_CLUE, 1, 1, NO_CLUE, NO_CLUE, 0]);
    expect(serializePuzzle(p)).toEqual(PLAY_PUZZLE);
  });

  test("maps clue characters to clue values", () => {
    const p = parsePuzzle({ v: 1, width: 5, height: 1, clues: ".0123" });
    expect(Array.from(p.clues)).toEqual([NO_CLUE, 0, 1, 2, 3]);
  });

  test("keeps seed and meta", () => {
    const p = parsePuzzle({ v: 1, width: 1, height: 1, clues: ".", seed: "abc", meta: { a: "1" } });
    expect(p.seed).toBe("abc");
    expect(p.meta).toEqual({ a: "1" });
  });

  const ok = { v: 1, width: 2, height: 2, clues: "...." };
  const cases: [string, unknown, string, string][] = [
    ["null", null, "", "expected a JSON object"],
    ["an array", [], "", "expected a JSON object"],
    ["a string", "2x2", "", "expected a JSON object"],
    ["an unknown field", { ...ok, extra: 1 }, "extra", "extra: unknown field"],
    ["a missing version", { width: 2, height: 2, clues: "...." }, "v", "v: missing; expected 1"],
    ["version 2", { ...ok, v: 2 }, "v", "v: unsupported version 2; expected 1"],
    [
      "version 2 with a new field",
      { ...ok, v: 2, extra: 1 },
      "v",
      "v: unsupported version 2; expected 1",
    ],
    [
      "width 0",
      { ...ok, width: 0 },
      "width",
      "width: expected a whole number from 1 to 100, got 0",
    ],
    [
      "width 101",
      { ...ok, width: 101 },
      "width",
      "width: expected a whole number from 1 to 100, got 101",
    ],
    [
      "width 1.5",
      { ...ok, width: 1.5 },
      "width",
      "width: expected a whole number from 1 to 100, got 1.5",
    ],
    [
      "width as a string",
      { ...ok, width: "2" },
      "width",
      'width: expected a whole number from 1 to 100, got "2"',
    ],
    [
      "a missing height",
      { v: 1, width: 2, clues: ".." },
      "height",
      "height: expected a whole number from 1 to 100, got undefined",
    ],
    ["clues as a number", { ...ok, clues: 1234 }, "clues", "clues: expected a string"],
    [
      "too few clues",
      { ...ok, clues: "..." },
      "clues",
      "clues: expected 4 characters (2×2), got 3",
    ],
    [
      "a bad clue",
      { ...ok, clues: "..4." },
      "clues",
      'clues: invalid character "4" at index 2 (row 1, col 0); use 0-3 or "."',
    ],
    ["an empty seed", { ...ok, seed: "" }, "seed", "seed: expected 1 to 128 characters, got 0"],
    [
      "a long seed",
      { ...ok, seed: "s".repeat(129) },
      "seed",
      "seed: expected 1 to 128 characters, got 129",
    ],
    ["a numeric seed", { ...ok, seed: 5 }, "seed", "seed: expected a string"],
    ["meta as an array", { ...ok, meta: [] }, "meta", "meta: expected an object"],
    ["a numeric meta value", { ...ok, meta: { a: 1 } }, "meta.a", "meta.a: expected a string"],
    [
      "an empty meta key",
      { ...ok, meta: { "": "x" } },
      "meta",
      "meta: keys must be 1 to 64 characters",
    ],
    [
      "a long meta value",
      { ...ok, meta: { k: "x".repeat(1025) } },
      "meta.k",
      "meta.k: expected at most 1024 characters, got 1025",
    ],
    [
      "too many meta entries",
      { ...ok, meta: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, ""])) },
      "meta",
      "meta: expected at most 32 entries, got 33",
    ],
  ];
  for (const [name, input, path, message] of cases) {
    test(`rejects ${name}`, () => {
      const err = formatError(() => parsePuzzle(input));
      expect(err.path).toBe(path);
      expect(err.message).toBe(message);
      expect(err.name).toBe("FormatError");
    });
  }
});

describe("serializePuzzle", () => {
  test("writes canonical JSON with sorted meta keys", () => {
    const p = parsePuzzle({
      v: 1,
      width: 2,
      height: 1,
      clues: "3.",
      seed: "s",
      meta: { b: "2", a: "1" },
    });
    expect(serializePuzzleJson(p)).toBe(
      '{"v":1,"width":2,"height":1,"clues":"3.","seed":"s","meta":{"a":"1","b":"2"}}',
    );
  });

  test("keeps a __proto__ meta key as plain data", () => {
    const p = parsePuzzleJson('{"v":1,"width":1,"height":1,"clues":".","meta":{"__proto__":"x"}}');
    const meta = serializePuzzle(p).meta as Record<string, string>;
    expect(Object.getPrototypeOf(meta)).toBe(Object.prototype);
    expect(Object.keys(meta)).toEqual(["__proto__"]);
    expect(serializePuzzleJson(p)).toContain('"meta":{"__proto__":"x"}');
  });

  test("round-trips any valid wire object", () => {
    fc.assert(
      fc.property(arbPuzzleWire(), (wire) => {
        expect(serializePuzzle(parsePuzzle(wire))).toEqual(wire);
        const p = parsePuzzle(wire);
        expect(serializePuzzleJson(parsePuzzleJson(serializePuzzleJson(p)))).toBe(
          serializePuzzleJson(p),
        );
      }),
    );
  });
});

describe("parsePuzzleJson", () => {
  test("reports invalid JSON as a FormatError", () => {
    const err = formatError(() => parsePuzzleJson("{nope"));
    expect(err.path).toBe("");
    expect(err.message.startsWith("invalid JSON: ")).toBe(true);
  });
});

describe("edge encoding", () => {
  test("writes one digit per edge", () => {
    expect(encodeEdges(new Uint8Array([0, 1, 2, 1]))).toBe("0121");
    expect(Array.from(decodeEdges(createGrid(1, 1), "1112"))).toEqual([1, 1, 1, 2]);
  });

  test("rejects bad input", () => {
    const g = createGrid(1, 1);
    expect(formatError(() => decodeEdges(g, "111")).message).toBe(
      "edges: expected 4 characters for a 1×1 grid, got 3",
    );
    expect(formatError(() => decodeEdges(g, "1131")).message).toBe(
      'edges: invalid character "3" at index 2; use 0, 1 or 2',
    );
    expect(() => encodeEdges(new Uint8Array([3]))).toThrow(RangeError);
  });

  test("round-trips any edge states", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        fc.infiniteStream(fc.constantFrom(0, 1, 2)),
        (w, h, states) => {
          const g = createGrid(w, h);
          const edges = Uint8Array.from(states.take(g.edgeCount));
          expect(decodeEdges(g, encodeEdges(edges))).toEqual(edges);
        },
      ),
    );
  });
});
