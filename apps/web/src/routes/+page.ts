import { puzzleSource } from "$lib/puzzles/index.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async () => ({ puzzles: await puzzleSource.list() });
