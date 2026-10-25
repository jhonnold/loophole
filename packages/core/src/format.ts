import { EdgeState, type Grid, MAX_SIZE, MIN_SIZE } from "./grid.ts";
import { createPuzzle, NO_CLUE, type Puzzle } from "./puzzle.ts";

/** Version 1 of the puzzle wire format. `docs/FORMAT.md` is the specification. */
export interface PuzzleWireV1 {
  v: 1;
  width: number;
  height: number;
  clues: string;
  seed?: string;
  meta?: Record<string, string>;
}

export const MAX_SEED_LENGTH = 128;
export const MAX_META_ENTRIES = 32;
export const MAX_META_KEY_LENGTH = 64;
export const MAX_META_VALUE_LENGTH = 1024;

/** Thrown for input that does not follow `docs/FORMAT.md`. `path` names the offending field. */
export class FormatError extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(path === "" ? detail : `${path}: ${detail}`);
    this.name = "FormatError";
    this.path = path;
  }
}

const PUZZLE_FIELDS = new Set(["v", "width", "height", "clues", "seed", "meta"]);

/** Validates a decoded JSON value against the v1 puzzle format. Throws `FormatError`. */
export function parsePuzzle(input: unknown): Puzzle {
  if (!isPlainObject(input)) throw new FormatError("", "expected a JSON object");
  if (!("v" in input)) throw new FormatError("v", "missing; expected 1");
  if (input.v !== 1) {
    throw new FormatError("v", `unsupported version ${JSON.stringify(input.v)}; expected 1`);
  }
  for (const key of Object.keys(input)) {
    if (!PUZZLE_FIELDS.has(key)) throw new FormatError(key, "unknown field");
  }
  const width = parseSize(input, "width");
  const height = parseSize(input, "height");

  const clueText = input.clues;
  if (typeof clueText !== "string") throw new FormatError("clues", "expected a string");
  const cellCount = width * height;
  if (clueText.length !== cellCount) {
    throw new FormatError(
      "clues",
      `expected ${cellCount} characters (${width}×${height}), got ${clueText.length}`,
    );
  }
  const clues = new Int8Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    const ch = clueText[i];
    if (ch === ".") clues[i] = NO_CLUE;
    else if (ch === "0" || ch === "1" || ch === "2" || ch === "3") clues[i] = Number(ch);
    else {
      const row = Math.floor(i / width);
      const col = i % width;
      throw new FormatError(
        "clues",
        `invalid character ${JSON.stringify(ch)} at index ${i} (row ${row}, col ${col}); use 0-3 or "."`,
      );
    }
  }

  let seed: string | undefined;
  if ("seed" in input) {
    if (typeof input.seed !== "string") throw new FormatError("seed", "expected a string");
    if (input.seed.length < 1 || input.seed.length > MAX_SEED_LENGTH) {
      throw new FormatError(
        "seed",
        `expected 1 to ${MAX_SEED_LENGTH} characters, got ${input.seed.length}`,
      );
    }
    seed = input.seed;
  }

  let meta: Record<string, string> | undefined;
  if ("meta" in input) meta = parseMeta(input.meta);

  return createPuzzle(width, height, clues, { seed, meta });
}

/** Converts a puzzle to its v1 wire object, ready for `JSON.stringify`. Meta keys come out sorted. */
export function serializePuzzle(puzzle: Puzzle): PuzzleWireV1 {
  const { grid, clues } = puzzle;
  let text = "";
  for (let i = 0; i < grid.cellCount; i++) {
    text += clues[i] === NO_CLUE ? "." : String(clues[i]);
  }
  const wire: PuzzleWireV1 = { v: 1, width: grid.width, height: grid.height, clues: text };
  if (puzzle.seed !== undefined) wire.seed = puzzle.seed;
  if (puzzle.meta !== undefined) {
    wire.meta = Object.fromEntries(
      Object.entries(puzzle.meta).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }
  return wire;
}

/** `parsePuzzle` for JSON text. Invalid JSON is a `FormatError` too. */
export function parsePuzzleJson(text: string): Puzzle {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new FormatError("", `invalid JSON: ${(err as Error).message}`);
  }
  return parsePuzzle(value);
}

/** The canonical JSON text of a puzzle: `serializePuzzle` with no whitespace. */
export function serializePuzzleJson(puzzle: Puzzle): string {
  return JSON.stringify(serializePuzzle(puzzle));
}

/** Encodes edge states as one character per edge, in edge index order: `0` unknown, `1` line, `2` cross. */
export function encodeEdges(edges: Uint8Array): string {
  let text = "";
  for (let e = 0; e < edges.length; e++) {
    const s = edges[e];
    if (s !== EdgeState.Unknown && s !== EdgeState.Line && s !== EdgeState.Cross) {
      throw new RangeError(`edge ${e} has invalid state ${s}`);
    }
    text += String(s);
  }
  return text;
}

/** Decodes an edge-state string for the given grid. Throws `FormatError`. */
export function decodeEdges(grid: Grid, text: string): Uint8Array {
  if (typeof text !== "string") throw new FormatError("edges", "expected a string");
  if (text.length !== grid.edgeCount) {
    throw new FormatError(
      "edges",
      `expected ${grid.edgeCount} characters for a ${grid.width}×${grid.height} grid, got ${text.length}`,
    );
  }
  const edges = new Uint8Array(grid.edgeCount);
  for (let e = 0; e < text.length; e++) {
    const ch = text[e];
    if (ch === "0" || ch === "1" || ch === "2") edges[e] = Number(ch);
    else {
      throw new FormatError(
        "edges",
        `invalid character ${JSON.stringify(ch)} at index ${e}; use 0, 1 or 2`,
      );
    }
  }
  return edges;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSize(input: Record<string, unknown>, field: "width" | "height"): number {
  const n = input[field];
  if (typeof n !== "number" || !Number.isInteger(n) || n < MIN_SIZE || n > MAX_SIZE) {
    throw new FormatError(
      field,
      `expected a whole number from ${MIN_SIZE} to ${MAX_SIZE}, got ${JSON.stringify(n)}`,
    );
  }
  return n;
}

function parseMeta(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) throw new FormatError("meta", "expected an object");
  const entries = Object.entries(value);
  if (entries.length > MAX_META_ENTRIES) {
    throw new FormatError(
      "meta",
      `expected at most ${MAX_META_ENTRIES} entries, got ${entries.length}`,
    );
  }
  for (const [key, v] of entries) {
    if (key.length < 1 || key.length > MAX_META_KEY_LENGTH) {
      throw new FormatError("meta", `keys must be 1 to ${MAX_META_KEY_LENGTH} characters`);
    }
    if (typeof v !== "string") throw new FormatError(`meta.${key}`, "expected a string");
    if (v.length > MAX_META_VALUE_LENGTH) {
      throw new FormatError(
        `meta.${key}`,
        `expected at most ${MAX_META_VALUE_LENGTH} characters, got ${v.length}`,
      );
    }
  }
  // fromEntries defines own properties, so a "__proto__" key stays an ordinary key.
  return Object.fromEntries(entries) as Record<string, string>;
}
