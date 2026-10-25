import { error } from "@sveltejs/kit";
import { puzzleSource } from "$lib/puzzles/index.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params }) => {
  const entry = await puzzleSource.get(params.id);
  if (entry === null) error(404, "Puzzle not found");
  return { entry };
};
