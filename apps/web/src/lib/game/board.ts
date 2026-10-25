import { EdgeState } from "@loophole/core";

/** One undoable step: the edges it touched, with their states before and after. */
export interface Move {
  readonly edges: readonly number[];
  readonly before: readonly EdgeState[];
  readonly after: readonly EdgeState[];
}

/**
 * The player's marks plus undo/redo history. Every operation returns a new `Board` and leaves the
 * old one untouched, so a Svelte `$state.raw` can hold it and re-render on assignment.
 */
export interface Board {
  readonly edges: Uint8Array;
  readonly past: readonly Move[];
  readonly future: readonly Move[];
}

export type EdgeChange = readonly [edge: number, state: EdgeState];

export function createBoard(edgeCount: number, edges?: Uint8Array): Board {
  if (edges !== undefined && edges.length !== edgeCount) {
    throw new RangeError(`expected ${edgeCount} edge states, got ${edges.length}`);
  }
  return { edges: edges ? edges.slice() : new Uint8Array(edgeCount), past: [], future: [] };
}

/** Line → cross → empty → line, the tap cycle from FR-13. */
export function nextState(state: EdgeState): EdgeState {
  if (state === EdgeState.Unknown) return EdgeState.Line;
  if (state === EdgeState.Line) return EdgeState.Cross;
  return EdgeState.Unknown;
}

/**
 * Applies `changes` as one undo step and clears the redo stack. Changes that leave an edge as it
 * was are dropped; if nothing changes, the same board is returned. With `merge`, the changes join
 * the previous step instead (used while a drag stroke is in progress), so one undo removes the
 * whole stroke.
 */
export function applyChanges(board: Board, changes: readonly EdgeChange[], merge = false): Board {
  const edges = board.edges.slice();
  const touched: number[] = [];
  const before: EdgeState[] = [];
  const after: EdgeState[] = [];
  for (const [edge, state] of changes) {
    const old = edges[edge] as EdgeState;
    if (old === state) continue;
    const seen = touched.indexOf(edge);
    if (seen >= 0) {
      after[seen] = state;
    } else {
      touched.push(edge);
      before.push(old);
      after.push(state);
    }
    edges[edge] = state;
  }
  if (touched.length === 0) return board;

  const last = board.past[board.past.length - 1];
  if (merge && last !== undefined) {
    const merged = { edges: [...last.edges], before: [...last.before], after: [...last.after] };
    for (let i = 0; i < touched.length; i++) {
      const at = merged.edges.indexOf(touched[i]);
      if (at >= 0) {
        merged.after[at] = after[i];
      } else {
        merged.edges.push(touched[i]);
        merged.before.push(before[i]);
        merged.after.push(after[i]);
      }
    }
    return { edges, past: [...board.past.slice(0, -1), merged], future: [] };
  }
  return { edges, past: [...board.past, { edges: touched, before, after }], future: [] };
}

export function undo(board: Board): Board {
  const move = board.past[board.past.length - 1];
  if (move === undefined) return board;
  const edges = board.edges.slice();
  move.edges.forEach((e, i) => {
    edges[e] = move.before[i];
  });
  return { edges, past: board.past.slice(0, -1), future: [move, ...board.future] };
}

export function redo(board: Board): Board {
  const move = board.future[0];
  if (move === undefined) return board;
  const edges = board.edges.slice();
  move.edges.forEach((e, i) => {
    edges[e] = move.after[i];
  });
  return { edges, past: [...board.past, move], future: board.future.slice(1) };
}

/** Empties every marked edge as one undo step (FR-14 clear). */
export function clearAll(board: Board): Board {
  const changes: EdgeChange[] = [];
  board.edges.forEach((s, e) => {
    if (s !== EdgeState.Unknown) changes.push([e, EdgeState.Unknown]);
  });
  return applyChanges(board, changes);
}

export function hasMarks(board: Board): boolean {
  return board.edges.some((s) => s !== EdgeState.Unknown);
}
