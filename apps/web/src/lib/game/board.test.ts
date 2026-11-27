import { describe, expect, test } from "bun:test";
import { CellShade, EdgeState } from "@loophole/core";
import fc from "fast-check";
import {
  applyChanges,
  applyShades,
  clearAll,
  createBoard,
  hasMarks,
  nextShade,
  nextState,
  redo,
  undo,
} from "./board.ts";

const { Unknown, Line, Cross } = EdgeState;

describe("nextState", () => {
  test("cycles line, cross, empty", () => {
    expect(nextState(Unknown)).toBe(Line);
    expect(nextState(Line)).toBe(Cross);
    expect(nextState(Cross)).toBe(Unknown);
  });
});

describe("applyChanges", () => {
  test("records one undo step and leaves the old board untouched", () => {
    const b0 = createBoard(4);
    const b1 = applyChanges(b0, [
      [1, Line],
      [2, Cross],
    ]);
    expect(Array.from(b1.edges)).toEqual([0, 1, 2, 0]);
    expect(Array.from(b0.edges)).toEqual([0, 0, 0, 0]);
    expect(b1.past).toEqual([
      { edges: [1, 2], before: [0, 0], after: [1, 2], cells: [], cellsBefore: [], cellsAfter: [] },
    ]);
  });

  test("returns the same board when nothing changes", () => {
    const b = applyChanges(createBoard(3), [[0, Line]]);
    expect(applyChanges(b, [[0, Line]])).toBe(b);
  });

  test("merge folds a drag stroke into one step", () => {
    let b = applyChanges(createBoard(5), [[0, Line]]);
    b = applyChanges(b, [[1, Line]], true);
    b = applyChanges(b, [[2, Line]], true);
    expect(b.past.length).toBe(1);
    expect(Array.from(undo(b).edges)).toEqual([0, 0, 0, 0, 0]);
  });

  test("merge keeps the first before-state of an edge touched twice", () => {
    let b = applyChanges(createBoard(2), [[0, Cross]]);
    b = applyChanges(b, [[1, Line]]);
    b = applyChanges(b, [[0, Line]], true);
    b = applyChanges(b, [[0, Unknown]], true);
    expect(b.past[1]).toMatchObject({ edges: [1, 0], before: [0, 2], after: [1, 0] });
    expect(Array.from(undo(b).edges)).toEqual([2, 0]);
  });

  test("a new move clears the redo stack", () => {
    let b = applyChanges(createBoard(2), [[0, Line]]);
    b = undo(b);
    expect(b.future.length).toBe(1);
    b = applyChanges(b, [[1, Line]]);
    expect(b.future.length).toBe(0);
  });
});

describe("undo and redo", () => {
  test("do nothing at the ends of the history", () => {
    const b = createBoard(2);
    expect(undo(b)).toBe(b);
    expect(redo(b)).toBe(b);
  });

  test("undoing everything returns to the start; redoing everything returns to the end", () => {
    const change = fc.tuple(fc.integer({ min: 0, max: 7 }), fc.constantFrom(Unknown, Line, Cross));
    fc.assert(
      fc.property(fc.array(fc.array(change, { maxLength: 4 }), { maxLength: 12 }), (moves) => {
        const start = createBoard(8);
        let b = start;
        for (const m of moves) b = applyChanges(b, m);
        const end = b;
        while (b.past.length > 0) b = undo(b);
        expect(Array.from(b.edges)).toEqual(Array.from(start.edges));
        while (b.future.length > 0) b = redo(b);
        expect(Array.from(b.edges)).toEqual(Array.from(end.edges));
      }),
    );
  });
});

describe("clearAll", () => {
  test("empties the board in one undoable step", () => {
    let b = applyChanges(createBoard(3), [
      [0, Line],
      [2, Cross],
    ]);
    b = clearAll(b);
    expect(hasMarks(b)).toBe(false);
    expect(Array.from(undo(b).edges)).toEqual([1, 0, 2]);
  });

  test("does nothing on an empty board", () => {
    const b = createBoard(3);
    expect(clearAll(b)).toBe(b);
  });
});

test("createBoard rejects a wrong-length edge array", () => {
  expect(() => createBoard(3, new Uint8Array(2))).toThrow(RangeError);
});

describe("cell shades", () => {
  const { None, Inside, Outside } = CellShade;

  test("a tap cycles none, inside, outside", () => {
    expect(nextShade(None)).toBe(Inside);
    expect(nextShade(Inside)).toBe(Outside);
    expect(nextShade(Outside)).toBe(None);
  });

  test("shading is one undo step, and a drag joins it; undo and redo restore them", () => {
    let b = createBoard(4, undefined, 3);
    b = applyShades(b, [[0, Inside]]);
    b = applyShades(b, [[1, Inside]], true);
    expect(Array.from(b.cells)).toEqual([1, 1, 0]);
    expect(b.past.length).toBe(1);
    b = applyChanges(b, [[2, Line]]);
    expect(Array.from(undo(b).cells)).toEqual([1, 1, 0]);
    expect(Array.from(undo(undo(b)).cells)).toEqual([0, 0, 0]);
    expect(Array.from(redo(undo(undo(b))).cells)).toEqual([1, 1, 0]);
  });

  test("count as marks, and clear empties them with the edges in one step", () => {
    let b = applyShades(createBoard(4, undefined, 3), [[2, Outside]]);
    expect(hasMarks(b)).toBe(true);
    b = applyChanges(b, [[0, Cross]]);
    const cleared = clearAll(b);
    expect(hasMarks(cleared)).toBe(false);
    expect(Array.from(undo(cleared).cells)).toEqual([0, 0, 2]);
    expect(Array.from(undo(cleared).edges)).toEqual([2, 0, 0, 0]);
  });

  test("shading keeps the same edge array, so a hint asked for on it still applies", () => {
    const b = createBoard(4, undefined, 3);
    expect(applyShades(b, [[0, Inside]]).edges).toBe(b.edges);
    expect(applyChanges(b, [[0, Line]]).cells).toBe(b.cells);
  });

  test("createBoard takes saved shades and rejects a wrong length", () => {
    expect(Array.from(createBoard(4, undefined, 2, new Uint8Array([2, 1])).cells)).toEqual([2, 1]);
    expect(() => createBoard(4, undefined, 2, new Uint8Array(3))).toThrow(RangeError);
  });
});
