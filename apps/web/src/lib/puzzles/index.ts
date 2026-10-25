import { fixtureSource } from "./fixtures.ts";
import type { PuzzleSource } from "./source.ts";

export { type PuzzleEntry, type PuzzleSource, type PuzzleSummary, puzzleTitle } from "./source.ts";

/** The puzzle source the screens use. Swap this for an API-backed source when the server exists. */
export const puzzleSource: PuzzleSource = fixtureSource;
