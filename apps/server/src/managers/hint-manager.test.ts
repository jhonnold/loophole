import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { FakeClock, FakePuzzleRepository } from "../test-support/fakes.ts";
import { InvalidBoardError } from "./errors.ts";
import { HintManager } from "./hint-manager.ts";
import { PuzzleManager } from "./puzzle-manager.ts";

// 2×2 all 2s; its only loop runs around the outside.
const SOLUTION = "112211121121";

async function setup() {
  const blobs = new MemoryBlobStore();
  const puzzles = new PuzzleManager({
    puzzles: new FakePuzzleRepository(),
    blobs,
    clock: new FakeClock(5000),
  });
  await puzzles.saveGenerated("p-1", {
    puzzle: serializePuzzle(createPuzzle(2, 2, [2, 2, 2, 2])),
    solution: SOLUTION,
    steps: [],
  });
  return { blobs, hints: new HintManager({ puzzles }) };
}

describe("HintManager", () => {
  test("gives the next step from the player's board", async () => {
    const { hints } = await setup();
    const hint = await hints.hint("p-1", "000000000000");
    expect(hint?.kind).toBe("step");
    if (hint?.kind !== "step") return;
    for (const { edge, state } of hint.step.changes) expect(Number(SOLUTION[edge])).toBe(state);
  });

  test("points out a wrong mark using the stored solution", async () => {
    const { hints } = await setup();
    expect(await hints.hint("p-1", "200000000000")).toEqual({ kind: "mistake", edge: 0, count: 1 });
  });

  test("says when the board is solved", async () => {
    const { hints } = await setup();
    expect(await hints.hint("p-1", SOLUTION)).toEqual({ kind: "solved" });
  });

  test("is null for an unknown puzzle", async () => {
    const { hints } = await setup();
    expect(await hints.hint("nope", SOLUTION)).toBeNull();
  });

  test("rejects a board that does not fit the puzzle", async () => {
    const { hints } = await setup();
    await expect(hints.hint("p-1", "000")).rejects.toBeInstanceOf(InvalidBoardError);
    await expect(hints.hint("p-1", "00000000000x")).rejects.toThrow("invalid character");
  });

  test("fails loudly when the solution blob is missing", async () => {
    const { blobs, hints } = await setup();
    blobs.blobs.delete("puzzles/p-1/solution.txt");
    await expect(hints.hint("p-1", "000000000000")).rejects.toThrow("no stored solution");
  });
});
