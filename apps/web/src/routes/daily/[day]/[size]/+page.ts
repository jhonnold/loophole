import { error } from "@sveltejs/kit";
import { dailySubtitle, sizeName } from "$lib/daily/days.ts";
import { daily } from "$lib/daily/index.ts";
import { type PuzzleEntry, puzzleSource } from "$lib/puzzles/index.ts";
import type { PageLoad } from "./$types";

/** A daily puzzle's page: the day's puzzle of one size class, or why there is none. */
export const load: PageLoad = async ({ params }) => {
  const size = Number(params.size);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.day) || !Number.isInteger(size)) {
    error(404, "No such daily puzzle");
  }
  const result = await daily.dayResult(params.day);
  // A day to come (404) or a day that doesn't exist (400) has no daily puzzle.
  if (!result.ok && result.status === 0) {
    error(503, "Daily puzzles need the server, which can't be reached right now.");
  }
  if (!result.ok) error(404, "No such daily puzzle");
  const set = result.value;
  const puzzleId = set.puzzles.find((p) => p.size === size)?.puzzleId;
  if (puzzleId === undefined) error(404, "No such daily puzzle");
  let entry: PuzzleEntry | null = null;
  if (puzzleId !== null) {
    const found = await puzzleSource.get(puzzleId);
    if (found === null) error(404, "No such daily puzzle");
    // Named for its size class, not as a practice puzzle (Solved artboard header).
    entry = { ...found, name: sizeName(size), subtitle: dailySubtitle(set.day, set.live) };
  }
  return { day: set.day, size, live: set.live, entry };
};
