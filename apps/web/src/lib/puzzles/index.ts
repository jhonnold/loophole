import { createApiClient } from "@loophole/api-client";
import { apiSource } from "./api.ts";
import { withServer } from "./combined.ts";
import { fixtureSource } from "./fixtures.ts";
import type { PuzzleSource } from "./source.ts";

export { type PuzzleEntry, type PuzzleSource, type PuzzleSummary, puzzleTitle } from "./source.ts";

/** The puzzle source the screens use: the built-in fixtures, then puzzles from the API. */
export const puzzleSource: PuzzleSource = withServer(fixtureSource, apiSource(createApiClient()));
