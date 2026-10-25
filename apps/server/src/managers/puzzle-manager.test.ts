import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import type { GeneratedPuzzle } from "../domain.ts";
import { FakeClock, FakePuzzleRepository, sequentialIds } from "../test-support/fakes.ts";
import { PuzzleManager } from "./puzzle-manager.ts";

const GENERATED: GeneratedPuzzle = {
  puzzle: serializePuzzle(
    createPuzzle(2, 2, [2, 2, 2, 2], { seed: "s", meta: { generator: "1" } }),
  ),
  solution: "112211121121",
  steps: [{ rule: "clue-satisfied", changes: [{ edge: 0, state: 1 }], cells: [0], dots: [] }],
};

function setup() {
  const puzzles = new FakePuzzleRepository();
  const blobs = new MemoryBlobStore();
  const clock = new FakeClock(5000);
  const manager = new PuzzleManager({ puzzles, blobs, clock });
  const ids = sequentialIds("p");
  const save = () => manager.saveGenerated(ids(), GENERATED);
  return { puzzles, blobs, clock, manager, save };
}

describe("PuzzleManager", () => {
  test("saveGenerated stores the solution and trace as blobs and the clues as a published row", async () => {
    const { puzzles, blobs, save } = setup();
    const id = await save();
    expect(id).toBe("p-1");
    const record = puzzles.get(id);
    expect(record).toMatchObject({
      origin: "generated",
      status: "published",
      level: 1,
      createdAt: 5000,
      solutionKey: "puzzles/p-1/solution.txt",
      traceKey: "puzzles/p-1/trace.json",
    });
    expect(record && serializePuzzle(record.puzzle)).toEqual(GENERATED.puzzle);
    expect(blobs.blobs.get("puzzles/p-1/solution.txt")).toEqual({
      body: "112211121121",
      contentType: "text/plain",
    });
    expect(JSON.parse((await blobs.get("puzzles/p-1/trace.json")) ?? "")).toEqual({
      v: 1,
      steps: GENERATED.steps,
    });
  });

  test("saving the same id again keeps one puzzle", async () => {
    const { puzzles, clock, manager } = setup();
    await manager.saveGenerated("j-1", GENERATED);
    clock.advance(10);
    expect(await manager.saveGenerated("j-1", GENERATED)).toBe("j-1");
    expect(puzzles.records.size).toBe(1);
    expect(puzzles.get("j-1")?.createdAt).toBe(5000);
  });

  test("a failed blob write stores no row", async () => {
    const { puzzles, blobs, manager } = setup();
    blobs.put = async () => {
      throw new Error("bucket unavailable");
    };
    await expect(manager.saveGenerated("p-1", GENERATED)).rejects.toThrow("bucket unavailable");
    expect(puzzles.records.size).toBe(0);
  });

  test("get and listRecent serve published puzzles only", async () => {
    const { puzzles, clock, manager, save } = setup();
    const a = await save();
    clock.advance(10);
    const b = await save();
    const hidden = puzzles.get(b);
    if (hidden === null) throw new Error("missing");
    puzzles.records.set("hidden", { ...hidden, id: "hidden", status: "unpublished" });
    expect(manager.get(a)?.id).toBe(a);
    expect(manager.get("hidden")).toBeNull();
    expect(manager.get("nope")).toBeNull();
    expect(manager.listRecent(10).map((r) => r.id)).toEqual([b, a]);
  });

  test("getSolution reads the solution blob back as edge states", async () => {
    const { manager, save } = setup();
    const id = await save();
    expect(Array.from((await manager.getSolution(id)) ?? [])).toEqual(
      Array.from("112211121121", Number),
    );
    expect(await manager.getSolution("nope")).toBeNull();
  });
});
