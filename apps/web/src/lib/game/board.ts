import { CellShade, EdgeState } from "@loophole/core";

/**
 * One undoable step: the edges it touched, with their states before and after, and the cells whose
 * shade it changed, likewise.
 */
export interface Move {
  readonly edges: readonly number[];
  readonly before: readonly EdgeState[];
  readonly after: readonly EdgeState[];
  readonly cells: readonly number[];
  readonly cellsBefore: readonly CellShade[];
  readonly cellsAfter: readonly CellShade[];
}

/**
 * The player's marks and cell shades plus undo/redo history. Every operation returns a new `Board`
 * and leaves the old one untouched, so a Svelte `$state.raw` can hold it and re-render on
 * assignment.
 */
export interface Board {
  readonly edges: Uint8Array;
  readonly cells: Uint8Array;
  readonly past: readonly Move[];
  readonly future: readonly Move[];
}

export type EdgeChange = readonly [edge: number, state: EdgeState];
export type CellChange = readonly [cell: number, shade: CellShade];

export function createBoard(
  edgeCount: number,
  edges?: Uint8Array,
  cellCount = 0,
  cells?: Uint8Array,
): Board {
  if (edges !== undefined && edges.length !== edgeCount) {
    throw new RangeError(`expected ${edgeCount} edge states, got ${edges.length}`);
  }
  if (cells !== undefined && cells.length !== cellCount) {
    throw new RangeError(`expected ${cellCount} cell shades, got ${cells.length}`);
  }
  return {
    edges: edges ? edges.slice() : new Uint8Array(edgeCount),
    cells: cells ? cells.slice() : new Uint8Array(cellCount),
    past: [],
    future: [],
  };
}

/** Line → cross → empty → line, the tap cycle from FR-13. */
export function nextState(state: EdgeState): EdgeState {
  if (state === EdgeState.Unknown) return EdgeState.Line;
  if (state === EdgeState.Line) return EdgeState.Cross;
  return EdgeState.Unknown;
}

/** None → inside → outside → none, the tap cycle in shade mode. */
export function nextShade(shade: CellShade): CellShade {
  if (shade === CellShade.None) return CellShade.Inside;
  if (shade === CellShade.Inside) return CellShade.Outside;
  return CellShade.None;
}

/** Sets `values` at the indexes in `changes`, noting the first before-state and last after-state of each. */
function record<T extends number>(
  values: Uint8Array,
  changes: readonly (readonly [number, T])[],
): { touched: number[]; before: T[]; after: T[] } {
  const touched: number[] = [];
  const before: T[] = [];
  const after: T[] = [];
  for (const [at, value] of changes) {
    const old = values[at] as T;
    if (old === value) continue;
    const seen = touched.indexOf(at);
    if (seen >= 0) {
      after[seen] = value;
    } else {
      touched.push(at);
      before.push(old);
      after.push(value);
    }
    values[at] = value;
  }
  return { touched, before, after };
}

/** Folds `next`'s changes into `into`, keeping the first before-state of anything touched twice. */
function fold<T>(
  into: { at: number[]; before: T[]; after: T[] },
  next: { touched: readonly number[]; before: readonly T[]; after: readonly T[] },
): void {
  for (let i = 0; i < next.touched.length; i++) {
    const k = into.at.indexOf(next.touched[i]);
    if (k >= 0) {
      into.after[k] = next.after[i];
    } else {
      into.at.push(next.touched[i]);
      into.before.push(next.before[i]);
      into.after.push(next.after[i]);
    }
  }
}

function apply(
  board: Board,
  edgeChanges: readonly EdgeChange[],
  cellChanges: readonly CellChange[],
  merge: boolean,
): Board {
  // An array nothing changes stays the same object, so a hint asked for on these edges still
  // applies after a cell is shaded.
  const edges = edgeChanges.length > 0 ? board.edges.slice() : board.edges;
  const cells = cellChanges.length > 0 ? board.cells.slice() : board.cells;
  const e = record(edges, edgeChanges);
  const c = record(cells, cellChanges);
  if (e.touched.length === 0 && c.touched.length === 0) return board;

  const last = board.past[board.past.length - 1];
  if (merge && last !== undefined) {
    const me = { at: [...last.edges], before: [...last.before], after: [...last.after] };
    const mc = { at: [...last.cells], before: [...last.cellsBefore], after: [...last.cellsAfter] };
    fold(me, e);
    fold(mc, c);
    const merged: Move = {
      edges: me.at,
      before: me.before,
      after: me.after,
      cells: mc.at,
      cellsBefore: mc.before,
      cellsAfter: mc.after,
    };
    return { edges, cells, past: [...board.past.slice(0, -1), merged], future: [] };
  }
  const move: Move = {
    edges: e.touched,
    before: e.before,
    after: e.after,
    cells: c.touched,
    cellsBefore: c.before,
    cellsAfter: c.after,
  };
  return { edges, cells, past: [...board.past, move], future: [] };
}

/**
 * Applies `changes` as one undo step and clears the redo stack. Changes that leave an edge as it
 * was are dropped; if nothing changes, the same board is returned. With `merge`, the changes join
 * the previous step instead (used while a drag stroke is in progress), so one undo removes the
 * whole stroke.
 */
export function applyChanges(board: Board, changes: readonly EdgeChange[], merge = false): Board {
  return apply(board, changes, [], merge);
}

/** Shades cells as one undo step, like `applyChanges` (with `merge`, a drag joins the last step). */
export function applyShades(board: Board, changes: readonly CellChange[], merge = false): Board {
  return apply(board, [], changes, merge);
}

export function undo(board: Board): Board {
  const move = board.past[board.past.length - 1];
  if (move === undefined) return board;
  const edges = board.edges.slice();
  const cells = board.cells.slice();
  move.edges.forEach((e, i) => {
    edges[e] = move.before[i];
  });
  move.cells.forEach((c, i) => {
    cells[c] = move.cellsBefore[i];
  });
  return { edges, cells, past: board.past.slice(0, -1), future: [move, ...board.future] };
}

export function redo(board: Board): Board {
  const move = board.future[0];
  if (move === undefined) return board;
  const edges = board.edges.slice();
  const cells = board.cells.slice();
  move.edges.forEach((e, i) => {
    edges[e] = move.after[i];
  });
  move.cells.forEach((c, i) => {
    cells[c] = move.cellsAfter[i];
  });
  return { edges, cells, past: [...board.past, move], future: board.future.slice(1) };
}

/** Empties every marked edge and shaded cell as one undo step (FR-14 clear). */
export function clearAll(board: Board): Board {
  const changes: EdgeChange[] = [];
  board.edges.forEach((s, e) => {
    if (s !== EdgeState.Unknown) changes.push([e, EdgeState.Unknown]);
  });
  const shades: CellChange[] = [];
  board.cells.forEach((s, c) => {
    if (s !== CellShade.None) shades.push([c, CellShade.None]);
  });
  return apply(board, changes, shades, false);
}

export function hasMarks(board: Board): boolean {
  return (
    board.edges.some((s) => s !== EdgeState.Unknown) ||
    board.cells.some((s) => s !== CellShade.None)
  );
}
