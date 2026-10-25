import { EdgeState, NONE } from "./grid.ts";
import { NO_CLUE, type Puzzle } from "./puzzle.ts";

/** Definite rule breaks (PRD FR-15). Each list is sorted ascending. */
export interface Violations {
  /** Dots with 3 or 4 lines. */
  readonly dots: number[];
  /** Clue cells with more lines than their clue. */
  readonly overfullCells: number[];
  /** Clue cells whose lines plus unknown sides are fewer than their clue (too many crosses). */
  readonly starvedCells: number[];
  /** Every edge of every closed loop, when the board is not solved. Empty when solved. */
  readonly loopEdges: number[];
}

export interface BoardAnalysis {
  readonly violations: Violations;
  /** True when the lines form exactly one closed loop and every clue has exactly its number of lines. */
  readonly solved: boolean;
  /** Clue cells with exactly their number of lines. */
  readonly satisfiedClues: number;
  readonly clueCount: number;
}

/**
 * Checks a board for definite rule breaks and completion. `edges` holds one `EdgeState` per edge.
 * Crosses only matter for `starvedCells`; completion looks at lines alone.
 */
export function analyzeBoard(puzzle: Puzzle, edges: Uint8Array): BoardAnalysis {
  const { grid, clues } = puzzle;
  if (edges.length !== grid.edgeCount) {
    throw new RangeError(`expected ${grid.edgeCount} edge states, got ${edges.length}`);
  }

  const overfullCells: number[] = [];
  const starvedCells: number[] = [];
  let clueCount = 0;
  let satisfiedClues = 0;
  for (let i = 0; i < grid.cellCount; i++) {
    const clue = clues[i];
    if (clue === NO_CLUE) continue;
    clueCount++;
    let lines = 0;
    let unknown = 0;
    for (let j = 0; j < 4; j++) {
      const s = edges[grid.cellEdges[i * 4 + j]];
      if (s === EdgeState.Line) lines++;
      else if (s === EdgeState.Unknown) unknown++;
    }
    if (lines > clue) overfullCells.push(i);
    if (lines + unknown < clue) starvedCells.push(i);
    if (lines === clue) satisfiedClues++;
  }

  const degree = new Uint8Array(grid.dotCount);
  for (let e = 0; e < grid.edgeCount; e++) {
    if (edges[e] === EdgeState.Line) {
      degree[grid.edgeDots[e * 2]]++;
      degree[grid.edgeDots[e * 2 + 1]]++;
    }
  }
  const dots: number[] = [];
  for (let d = 0; d < grid.dotCount; d++) {
    if (degree[d] >= 3) dots.push(d);
  }

  // Split the lines into connected components. A component is a closed loop when every dot on it
  // has exactly two lines.
  const seen = new Uint8Array(grid.edgeCount);
  const stack: number[] = [];
  const closedLoops: number[][] = [];
  let componentCount = 0;
  for (let start = 0; start < grid.edgeCount; start++) {
    if (edges[start] !== EdgeState.Line || seen[start]) continue;
    componentCount++;
    const component: number[] = [];
    let closed = true;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const e = stack.pop() as number;
      component.push(e);
      for (let k = 0; k < 2; k++) {
        const d = grid.edgeDots[e * 2 + k];
        if (degree[d] !== 2) closed = false;
        for (let j = 0; j < 4; j++) {
          const next = grid.dotEdges[d * 4 + j];
          if (next !== NONE && edges[next] === EdgeState.Line && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    if (closed) closedLoops.push(component);
  }

  const solved = componentCount === 1 && closedLoops.length === 1 && satisfiedClues === clueCount;
  const loopEdges = solved ? [] : closedLoops.flat().sort((a, b) => a - b);

  return {
    violations: { dots, overfullCells, starvedCells, loopEdges },
    solved,
    satisfiedClues,
    clueCount,
  };
}

/** True when at least one of the violation lists is non-empty. */
export function hasViolations(violations: Violations): boolean {
  return (
    violations.dots.length > 0 ||
    violations.overfullCells.length > 0 ||
    violations.starvedCells.length > 0 ||
    violations.loopEdges.length > 0
  );
}
