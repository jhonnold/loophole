import { describe, expect, test } from "bun:test";
import { NO_CLUE, serializePuzzle } from "@loophole/core";
import { memoryStorage } from "../test-support/memory-storage.ts";
import {
  brushEdit,
  clearClues,
  clueCount,
  createDraft,
  cycleClue,
  DRAFT_KEY,
  draftPuzzle,
  editCell,
  loadDraft,
  parseSize,
  resizeDraft,
  saveDraft,
  setClue,
} from "./draft.ts";

describe("editor draft", () => {
  test("a new draft is 7×7 with no clues", () => {
    const d = createDraft();
    expect([d.width, d.height, clueCount(d)]).toEqual([7, 7, 0]);
    expect(d.clues.every((c) => c === NO_CLUE)).toBe(true);
  });

  test("a tap cycles empty → 0 → 1 → 2 → 3 → empty", () => {
    let d = createDraft(2, 1);
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      d = cycleClue(d, 1);
      seen.push(d.clues[1]);
    }
    expect(seen).toEqual([0, 1, 2, 3, NO_CLUE]);
    expect(d.clues[0]).toBe(NO_CLUE);
  });

  test("setClue places and erases, and returns the same draft when nothing changes", () => {
    const d = setClue(createDraft(2, 2), 3, 2);
    expect(serializePuzzle(draftPuzzle(d)).clues).toBe("...2");
    expect(setClue(d, 3, 2)).toBe(d);
    expect(clueCount(setClue(d, 3, NO_CLUE))).toBe(0);
  });

  test("resizing keeps the clues both sizes share, top left", () => {
    let d = createDraft(3, 2);
    d = setClue(setClue(setClue(d, 0, 1), 2, 3), 5, 0); // "1.3" / "..0"
    expect(serializePuzzle(draftPuzzle(resizeDraft(d, 2, 3))).clues).toBe("1.....");
    expect(serializePuzzle(draftPuzzle(resizeDraft(d, 4, 2))).clues).toBe("1.3...0.");
    expect(resizeDraft(d, 3, 2)).toBe(d);
  });

  test("clear removes every clue and keeps the size", () => {
    const d = clearClues(setClue(createDraft(4, 3), 5, 1));
    expect([d.width, d.height, clueCount(d)]).toEqual([4, 3, 0]);
  });

  test("parseSize takes whole numbers from 1 to 100", () => {
    expect(["1", " 100 ", "7"].map(parseSize)).toEqual([1, 100, 7]);
    expect(["0", "101", "", "7.5", "-3", "abc"].map(parseSize)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  test("a saved draft loads back; a missing or broken one loads as null", () => {
    const storage = memoryStorage();
    expect(loadDraft(storage)).toBeNull();
    const d = setClue(createDraft(3, 2), 4, 3);
    saveDraft(storage, d);
    expect(storage.getItem(DRAFT_KEY)).toBe('{"v":1,"width":3,"height":2,"clues":"....3."}');
    expect(loadDraft(storage)).toEqual(d);
    storage.setItem(DRAFT_KEY, '{"v":1,"width":3,"height":2,"clues":"x"}');
    expect(loadDraft(storage)).toBeNull();
    expect(loadDraft(null)).toBeNull();
    saveDraft(null, d); // no storage: nothing happens
  });
});

describe("editing cells", () => {
  test("a brush turns a tap into placing, erasing or (no brush) cycling", () => {
    expect(brushEdit(2)).toEqual({ type: "set", clue: 2 });
    expect(brushEdit("erase")).toEqual({ type: "erase" });
    expect(brushEdit(null)).toEqual({ type: "cycle" });
  });

  test("editCell applies set, erase and cycle", () => {
    let d = createDraft(2, 1);
    d = editCell(d, 0, { type: "set", clue: 3 });
    d = editCell(d, 1, { type: "cycle" });
    expect(serializePuzzle(draftPuzzle(d)).clues).toBe("30");
    d = editCell(d, 0, { type: "erase" });
    expect(serializePuzzle(draftPuzzle(d)).clues).toBe(".0");
  });
});
