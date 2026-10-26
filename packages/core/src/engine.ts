/**
 * The deduction engine shared by `solve` and `verify`. Not part of the public API.
 *
 * State is one `EdgeState` per edge plus, for every dot at the end of a line path, the dot at the
 * path's other end (`mate`) and the path's length in edges (`plen`). Every change is pushed on a
 * trail so lookahead probes and the verifier's search can undo back to a mark.
 *
 * Rules come in tiers, cheapest first:
 * 1. local rules on a worklist of cells and dots: clue rules, corner rules, dot degree,
 *    premature loop, loop complete
 * 2. the 3s patterns, which depend only on the clues and are applied once
 * 3. inside/outside parity, a union-find over cells (global), then a connectivity check that
 *    only detects contradictions (global)
 * 4. lookahead: assume an edge, run tier 1, and take the opposite on a contradiction
 * After any change the engine goes back to tier 1, so steps come out roughly easiest first.
 */
import { EdgeState, type Grid, NONE } from "./grid.ts";
import { NO_CLUE, type Puzzle } from "./puzzle.ts";
import type { EdgeChange, RuleId, Step } from "./rules.ts";

const { Unknown, Line, Cross } = EdgeState;

/** Thrown to stop the engine early: out of time or search nodes, or `maxSteps` reached. */
export class SolverStop extends Error {
  constructor(readonly reason: "budget" | "steps") {
    super(`solver stopped: ${reason}`);
    this.name = "SolverStop";
  }
}

/** Time and node limits. `tick` is called once per lookahead probe, `node` once per search node. */
export class Budget {
  nodes = 0;

  constructor(
    private readonly now: () => number,
    private readonly deadline: number,
    private readonly maxNodes: number,
  ) {}

  tick(): void {
    if (this.now() > this.deadline) throw new SolverStop("budget");
  }

  node(): void {
    this.nodes++;
    if (this.nodes > this.maxNodes) throw new SolverStop("budget");
    this.tick();
  }
}

export interface Mark {
  readonly edges: number;
  readonly ends: number;
  readonly closed: boolean;
}

interface Pattern {
  readonly rule: RuleId;
  readonly cells: readonly number[];
  readonly lines: readonly number[];
  readonly crosses: readonly number[];
}

/** 4 entries per dot: the cells up-left, up-right, down-right, down-left of it, `NONE` off the board. */
function dotCells(grid: Grid): Int32Array {
  const W = grid.width;
  const H = grid.height;
  const t = new Int32Array(grid.dotCount * 4).fill(NONE);
  for (let r = 0; r <= H; r++) {
    for (let c = 0; c <= W; c++) {
      const k = (r * (W + 1) + c) * 4;
      if (r > 0 && c > 0) t[k] = (r - 1) * W + c - 1;
      if (r > 0 && c < W) t[k + 1] = (r - 1) * W + c;
      if (r < H && c < W) t[k + 2] = r * W + c;
      if (r < H && c > 0) t[k + 3] = r * W + c - 1;
    }
  }
  return t;
}

export class Engine {
  readonly grid: Grid;
  readonly clues: Int8Array;
  readonly edges: Uint8Array;
  /** Set when a loop has closed; it was checked to be a full solution. */
  closed = false;
  /** Lookahead probes run so far. */
  probes = 0;
  /** Recorded steps, or null when not recording. */
  steps: Step[] | null = null;
  maxSteps = Number.POSITIVE_INFINITY;

  private readonly dotCells: Int32Array;
  private readonly mate: Int32Array;
  private readonly plen: Int32Array;
  private lineCount = 0;
  private readonly edgeTrail: number[] = [];
  private readonly endTrail: number[] = [];
  private readonly queue: Int32Array;
  private readonly inQueue: Uint8Array;
  private qHead = 0;
  private qLen = 0;
  /** Worklist item (cell, or cellCount + dot) where the last contradiction was found, or NONE. */
  private conflict = NONE;
  private pending: EdgeChange[] | null = null;
  private pendingRule: RuleId = "clue-zero";
  private pendingCells: readonly number[] = [];
  private pendingDots: readonly number[] = [];
  private readonly patterns: Pattern[];
  private readonly ufParent: Int32Array;
  private readonly ufParity: Uint8Array;
  private ufFound = 0;
  private readonly seen: Uint8Array;
  private readonly order: Int32Array;
  private readonly stack: Int32Array;
  private lookCursor = 0;

  constructor(
    puzzle: Puzzle,
    private readonly budget: Budget,
  ) {
    const grid = puzzle.grid;
    this.grid = grid;
    this.clues = puzzle.clues;
    this.edges = new Uint8Array(grid.edgeCount);
    this.dotCells = dotCells(grid);
    this.mate = new Int32Array(grid.dotCount);
    this.plen = new Int32Array(grid.dotCount);
    const items = grid.cellCount + grid.dotCount;
    this.queue = new Int32Array(items);
    this.inQueue = new Uint8Array(items);
    for (let x = 0; x < items; x++) this.enqueue(x);
    this.patterns = buildPatterns(grid, puzzle.clues);
    this.ufParent = new Int32Array(grid.cellCount + 1);
    this.ufParity = new Uint8Array(grid.cellCount + 1);
    this.seen = new Uint8Array(grid.dotCount);
    this.stack = new Int32Array(grid.dotCount);
    this.order = readingOrder(grid);
  }

  /** Applies a starting board (for example a player's progress). False if it breaks a rule. */
  load(initial: Uint8Array): boolean {
    if (initial.length !== this.grid.edgeCount) {
      throw new RangeError(`expected ${this.grid.edgeCount} edge states, got ${initial.length}`);
    }
    for (let e = 0; e < initial.length; e++) {
      const s = initial[e];
      if (s === Line || s === Cross) {
        if (!this.set(e, s)) return false;
      } else if (s !== Unknown) {
        throw new RangeError(`edge ${e} has invalid state ${s}`);
      }
    }
    return true;
  }

  /** Runs every rule tier to a fixpoint. False on a contradiction. */
  solveRoot(lookahead: boolean): boolean {
    return this.local() && this.applyPatterns() && this.propagate(lookahead);
  }

  /**
   * Tiers 1, 3 and (optionally) 4 until nothing changes. False on a contradiction. Checks the time
   * budget on every pass, since each parity pass costs O(edges).
   */
  propagate(lookahead: boolean): boolean {
    for (;;) {
      this.budget.tick();
      if (!this.local()) return false;
      if (this.closed) return true;
      const p = this.parity();
      if (p < 0) return false;
      if (p > 0) continue;
      if (!this.connected()) return false;
      if (!lookahead) return true;
      const q = this.lookahead();
      if (q < 0) return false;
      if (q > 0) continue;
      return true;
    }
  }

  mark(): Mark {
    return { edges: this.edgeTrail.length, ends: this.endTrail.length, closed: this.closed };
  }

  undo(m: Mark): void {
    const { edges, mate, plen, edgeTrail, endTrail } = this;
    while (endTrail.length > m.ends) {
      const len = endTrail.pop() as number;
      const old = endTrail.pop() as number;
      const d = endTrail.pop() as number;
      mate[d] = old;
      plen[d] = len;
    }
    while (edgeTrail.length > m.edges) {
      const e = edgeTrail.pop() as number;
      if (edges[e] === Line) this.lineCount--;
      edges[e] = Unknown;
    }
    this.closed = m.closed;
    this.clearQueue();
    this.conflict = NONE;
  }

  /**
   * Sets an unknown edge. Keeps path ends up to date and returns false when the change breaks a
   * rule on the spot: a third line at a dot, a line after the loop closed, or a loop that closes
   * without being a full solution. Other checks happen when the worklist runs.
   */
  set(e: number, state: EdgeState): boolean {
    const { grid, edges, mate, plen } = this;
    edges[e] = state;
    this.edgeTrail.push(e);
    const a = grid.edgeDots[e * 2];
    const b = grid.edgeDots[e * 2 + 1];
    this.touch(a);
    this.touch(b);
    if (state !== Line) return true;
    this.lineCount++;
    const da = this.degree(a) - 1;
    const db = this.degree(b) - 1;
    if (da >= 2 || db >= 2 || this.closed) return false;
    if (da === 1 && db === 1 && mate[a] === b) {
      // This line closes a path into a loop: fine only if the loop is everything.
      if (plen[a] + 1 !== this.lineCount || !this.cluesSatisfied(NONE)) return false;
      this.closed = true;
      return true;
    }
    const ea = da === 0 ? a : mate[a];
    const eb = db === 0 ? b : mate[b];
    const len = (da === 0 ? 0 : plen[a]) + (db === 0 ? 0 : plen[b]) + 1;
    this.saveEnd(ea);
    this.saveEnd(eb);
    mate[ea] = eb;
    mate[eb] = ea;
    plen[ea] = len;
    plen[eb] = len;
    // The path's ends may be dots no change touched. If they are next to each other, the edge
    // between them would close the path early: queue them for the premature-loop check.
    const gap = Math.abs(ea - eb);
    const W1 = grid.width + 1;
    if (gap === W1 || (gap === 1 && Math.floor(ea / W1) === Math.floor(eb / W1))) {
      this.enqueue(grid.cellCount + ea);
      this.enqueue(grid.cellCount + eb);
    }
    return true;
  }

  /**
   * The verifier's search branches on edges in reading order: each row's horizontal edges, then the
   * vertical edges below them. Returns the first position at or after `from` in that order whose
   * edge is open, or -1.
   */
  nextOpen(from: number): number {
    const { order, edges } = this;
    for (let p = from; p < order.length; p++) if (edges[order[p]] === Unknown) return p;
    return NONE;
  }

  /** The edge at position `p` of the reading order. */
  edgeAt(p: number): number {
    return this.order[p];
  }

  // --- tier 1: worklist rules ---------------------------------------------------------------

  /** Runs the worklist dry. False on a contradiction. */
  local(): boolean {
    const C = this.grid.cellCount;
    for (;;) {
      while (this.qLen > 0) {
        const x = this.dequeue();
        const ok = x < C ? this.cellRule(x) : this.dotRule(x - C);
        if (!ok) {
          this.conflict = x;
          this.clearQueue();
          return false;
        }
      }
      if (this.closed) {
        if (this.edgeTrail.length === this.grid.edgeCount) return true;
        this.begin("loop-complete", [], []);
        for (let e = 0; e < this.grid.edgeCount; e++) {
          if (this.edges[e] === Unknown) this.assign(e, Cross);
        }
        this.commit();
        continue;
      }
      // Every edge decided and no loop: the board has no lines at all.
      if (this.edgeTrail.length === this.grid.edgeCount) {
        this.conflict = NONE;
        return false;
      }
      return true;
    }
  }

  private cellRule(i: number): boolean {
    const k = this.clues[i];
    if (k === NO_CLUE) return true;
    const { cellEdges } = this.grid;
    let lines = 0;
    let unknown = 0;
    for (let j = 0; j < 4; j++) {
      const s = this.edges[cellEdges[i * 4 + j]];
      if (s === Line) lines++;
      else if (s === Unknown) unknown++;
    }
    if (lines > k || lines + unknown < k) return false;
    if (unknown === 0) return true;
    if (lines === k) return this.fillCell(i, Cross, k === 0 ? "clue-zero" : "clue-satisfied");
    if (lines + unknown === k) return this.fillCell(i, Line, "clue-needs-all");
    if (k === 1 || k === 3) {
      const { edgeDots } = this.grid;
      const t = cellEdges[i * 4];
      const r = cellEdges[i * 4 + 1];
      const b = cellEdges[i * 4 + 2];
      const l = cellEdges[i * 4 + 3];
      return (
        this.corner(i, k, t, l, edgeDots[t * 2], 0, 3) &&
        this.corner(i, k, t, r, edgeDots[t * 2 + 1], 0, 1) &&
        this.corner(i, k, b, r, edgeDots[b * 2 + 1], 2, 1) &&
        this.corner(i, k, b, l, edgeDots[b * 2], 2, 3)
      );
    }
    return true;
  }

  private fillCell(i: number, state: EdgeState, rule: RuleId): boolean {
    this.begin(rule, [i], []);
    for (let j = 0; j < 4; j++) {
      const e = this.grid.cellEdges[i * 4 + j];
      if (this.edges[e] === Unknown && !this.assign(e, state)) return false;
    }
    this.commit();
    return true;
  }

  /**
   * Corner rule for a 1 or a 3. `e1` and `e2` are the cell's sides at corner dot `d`; `o1` and `o2`
   * are the `dotEdges` slots of the dot's two edges outside the cell. When both outside edges are
   * crossed or off the board, the loop cannot turn into the corner from outside, so `e1` and `e2`
   * are both lines or both crosses: both lines for a 3, both crosses for a 1.
   */
  private corner(
    i: number,
    k: number,
    e1: number,
    e2: number,
    d: number,
    o1: number,
    o2: number,
  ): boolean {
    const { edges } = this;
    if (edges[e1] !== Unknown && edges[e2] !== Unknown) return true;
    const x = this.grid.dotEdges[d * 4 + o1];
    const y = this.grid.dotEdges[d * 4 + o2];
    if ((x !== NONE && edges[x] !== Cross) || (y !== NONE && edges[y] !== Cross)) return true;
    const state = k === 3 ? Line : Cross;
    this.begin(k === 3 ? "corner-3" : "corner-1", [i], [d]);
    if (!this.assign(e1, state) || !this.assign(e2, state)) return false;
    this.commit();
    return true;
  }

  private dotRule(d: number): boolean {
    const { grid, edges } = this;
    let lines = 0;
    let unknown = 0;
    for (let j = 0; j < 4; j++) {
      const e = grid.dotEdges[d * 4 + j];
      if (e === NONE) continue;
      if (edges[e] === Line) lines++;
      else if (edges[e] === Unknown) unknown++;
    }
    if (lines > 2) return false;
    if (unknown === 0) return lines !== 1;
    if (lines === 2) return this.fillDot(d, Cross, "dot-full");
    if (lines === 0) return unknown === 1 ? this.fillDot(d, Cross, "dot-dead-end") : true;
    if (unknown === 1) return this.fillDot(d, Line, "dot-continue");
    // One line ends here. An open edge to the other end of its path would close a loop.
    const m = this.mate[d];
    for (let j = 0; j < 4; j++) {
      const e = grid.dotEdges[d * 4 + j];
      if (e === NONE || edges[e] !== Unknown) continue;
      const other = grid.edgeDots[e * 2] === d ? grid.edgeDots[e * 2 + 1] : grid.edgeDots[e * 2];
      if (other !== m) continue;
      if (this.plen[d] === this.lineCount && this.cluesSatisfied(e)) return true;
      this.begin("premature-loop", [], [d, m]);
      if (!this.assign(e, Cross)) return false;
      this.commit();
      return true;
    }
    return true;
  }

  private fillDot(d: number, state: EdgeState, rule: RuleId): boolean {
    this.begin(rule, [], [d]);
    for (let j = 0; j < 4; j++) {
      const e = this.grid.dotEdges[d * 4 + j];
      if (e !== NONE && this.edges[e] === Unknown && !this.assign(e, state)) return false;
    }
    this.commit();
    return true;
  }

  // --- tier 2: 3s patterns ------------------------------------------------------------------

  private applyPatterns(): boolean {
    for (const p of this.patterns) {
      this.begin(p.rule, p.cells, []);
      for (const e of p.lines) if (!this.assign(e, Line)) return false;
      for (const e of p.crosses) if (!this.assign(e, Cross)) return false;
      this.commit();
    }
    return true;
  }

  // --- tier 3: inside/outside parity --------------------------------------------------------

  /**
   * Every cell is inside or outside the loop, and everything beyond the border is outside. A line
   * separates cells of different sides, a cross joins cells of the same side. Union-find with
   * parity over the cells plus one "outside" node (index cellCount) links cells whose relative
   * side is known; an open edge between two linked cells is then decided. Returns the number of
   * edges set, or -1 on a contradiction.
   */
  private parity(): number {
    const { grid, edges, ufParent, ufParity } = this;
    const C = grid.cellCount;
    for (let i = 0; i <= C; i++) {
      ufParent[i] = i;
      ufParity[i] = 0;
    }
    for (let e = 0; e < grid.edgeCount; e++) {
      const s = edges[e];
      if (s === Unknown) continue;
      const a = this.ufFind(sideNode(grid, e, 0));
      const pa = this.ufFound;
      const b = this.ufFind(sideNode(grid, e, 1));
      const pb = this.ufFound;
      const differ = s === Line ? 1 : 0;
      if (a === b) {
        if ((pa ^ pb) !== differ) return -1;
      } else {
        ufParent[a] = b;
        ufParity[a] = pa ^ pb ^ differ;
      }
    }
    let count = 0;
    for (let e = 0; e < grid.edgeCount; e++) {
      if (edges[e] !== Unknown) continue;
      const na = sideNode(grid, e, 0);
      const nb = sideNode(grid, e, 1);
      const a = this.ufFind(na);
      const pa = this.ufFound;
      const b = this.ufFind(nb);
      const pb = this.ufFound;
      if (a !== b) continue;
      const cells = [na, nb].filter((n) => n !== C);
      this.begin("parity", cells, []);
      if (!this.assign(e, pa !== pb ? Line : Cross)) return -1;
      this.commit();
      count++;
    }
    return count;
  }

  /** Root of `x`'s set; leaves the parity of `x` relative to the root in `ufFound`. */
  private ufFind(x: number): number {
    const { ufParent, ufParity } = this;
    let root = x;
    let p = 0;
    while (ufParent[root] !== root) {
      p ^= ufParity[root];
      root = ufParent[root];
    }
    // Path compression: point every node on the way straight at the root.
    let cur = x;
    let cp = p;
    while (ufParent[cur] !== cur) {
      const next = ufParent[cur];
      const np = cp ^ ufParity[cur];
      ufParent[cur] = root;
      ufParity[cur] = cp;
      cur = next;
      cp = np;
    }
    this.ufFound = p;
    return root;
  }

  /**
   * False when the loop cannot be one piece: walking from a line along edges that are not crossed
   * must reach every other line and an open side of every clue above 0. Does nothing before the
   * first line is drawn (a clue's sides can then lie in different regions).
   */
  private connected(): boolean {
    const { grid, edges, clues, seen, stack } = this;
    const first = edges.indexOf(Line);
    if (first < 0) return true;
    const seed = grid.edgeDots[first * 2];
    seen.fill(0);
    seen[seed] = 1;
    stack[0] = seed;
    let top = 1;
    while (top > 0) {
      const d = stack[--top];
      for (let j = 0; j < 4; j++) {
        const e = grid.dotEdges[d * 4 + j];
        if (e === NONE || edges[e] === Cross) continue;
        const o = grid.edgeDots[e * 2] === d ? grid.edgeDots[e * 2 + 1] : grid.edgeDots[e * 2];
        if (!seen[o]) {
          seen[o] = 1;
          stack[top++] = o;
        }
      }
    }
    for (let e = 0; e < grid.edgeCount; e++) {
      if (edges[e] === Line && !seen[grid.edgeDots[e * 2]]) return false;
    }
    for (let i = 0; i < grid.cellCount; i++) {
      if (clues[i] <= 0) continue;
      let reached = false;
      for (let j = 0; j < 4 && !reached; j++) {
        const e = grid.cellEdges[i * 4 + j];
        reached = edges[e] !== Cross && seen[grid.edgeDots[e * 2]] === 1;
      }
      if (!reached) return false;
    }
    return true;
  }

  // --- tier 4: lookahead --------------------------------------------------------------------

  /**
   * Tries each open edge both ways, running only the worklist rules after each assumption. If
   * one way leads to a contradiction the edge takes the other state. Scans round-robin from where
   * the last scan stopped. Returns 1 after a deduction, 0 when a full scan finds none, -1 when the
   * deduction itself contradicts.
   */
  private lookahead(): number {
    const E = this.grid.edgeCount;
    const recording = this.steps;
    for (let k = 0; k < E; k++) {
      const e = (this.lookCursor + k) % E;
      if (this.edges[e] !== Unknown) continue;
      for (const assumed of [Line, Cross]) {
        this.budget.tick();
        this.probes++;
        const m = this.mark();
        this.steps = null;
        const ok = this.set(e, assumed) && this.local();
        const site = this.conflict;
        this.steps = recording;
        this.undo(m);
        if (ok) continue;
        this.lookCursor = (e + 1) % E;
        const C = this.grid.cellCount;
        const a = this.grid.edgeDots[e * 2];
        const b = this.grid.edgeDots[e * 2 + 1];
        const cells = site !== NONE && site < C ? [site] : [];
        const dots = site !== NONE && site >= C ? [a, b, site - C] : [a, b];
        this.begin("lookahead", cells, dots);
        if (!this.assign(e, assumed === Line ? Cross : Line)) return -1;
        this.commit();
        return 1;
      }
    }
    return 0;
  }

  // --- helpers ------------------------------------------------------------------------------

  /** Sets an edge on behalf of a rule, recording it in the current step. */
  private assign(e: number, state: EdgeState): boolean {
    const cur = this.edges[e];
    if (cur === state) return true;
    if (cur !== Unknown) return false;
    this.pending?.push({ edge: e, state: state as EdgeChange["state"] });
    return this.set(e, state);
  }

  private begin(rule: RuleId, cells: readonly number[], dots: readonly number[]): void {
    if (this.steps === null) {
      this.pending = null;
      return;
    }
    this.pending = [];
    this.pendingRule = rule;
    this.pendingCells = cells;
    this.pendingDots = dots;
  }

  private commit(): void {
    const steps = this.steps;
    const changes = this.pending;
    this.pending = null;
    if (steps === null || changes === null || changes.length === 0) return;
    steps.push({
      rule: this.pendingRule,
      changes,
      cells: this.pendingCells,
      dots: this.pendingDots,
    });
    if (steps.length >= this.maxSteps) throw new SolverStop("steps");
  }

  /** True when every clue has exactly its number of lines, counting `extra` (or NONE) as a line too. */
  private cluesSatisfied(extra: number): boolean {
    const { grid, clues, edges } = this;
    for (let i = 0; i < grid.cellCount; i++) {
      const k = clues[i];
      if (k === NO_CLUE) continue;
      let lines = 0;
      for (let j = 0; j < 4; j++) {
        const e = grid.cellEdges[i * 4 + j];
        if (edges[e] === Line || e === extra) lines++;
      }
      if (lines !== k) return false;
    }
    return true;
  }

  private degree(d: number): number {
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const e = this.grid.dotEdges[d * 4 + j];
      if (e !== NONE && this.edges[e] === Line) n++;
    }
    return n;
  }

  private saveEnd(d: number): void {
    this.endTrail.push(d, this.mate[d], this.plen[d]);
  }

  /** Queues a dot and the cells around it after one of its edges changed. */
  private touch(d: number): void {
    this.enqueue(this.grid.cellCount + d);
    for (let j = 0; j < 4; j++) {
      const c = this.dotCells[d * 4 + j];
      if (c !== NONE) this.enqueue(c);
    }
  }

  private enqueue(x: number): void {
    if (this.inQueue[x]) return;
    this.inQueue[x] = 1;
    this.queue[(this.qHead + this.qLen) % this.queue.length] = x;
    this.qLen++;
  }

  private dequeue(): number {
    const x = this.queue[this.qHead];
    this.qHead = (this.qHead + 1) % this.queue.length;
    this.qLen--;
    this.inQueue[x] = 0;
    return x;
  }

  private clearQueue(): void {
    while (this.qLen > 0) this.dequeue();
  }
}

/** Edges row by row: horizontal edges of row r left to right, then the vertical edges below them. */
function readingOrder(grid: Grid): Int32Array {
  const W = grid.width;
  const order = new Int32Array(grid.edgeCount);
  let p = 0;
  for (let r = 0; r <= grid.height; r++) {
    for (let c = 0; c < W; c++) order[p++] = r * W + c;
    if (r < grid.height)
      for (let c = 0; c <= W; c++) order[p++] = grid.hEdgeCount + r * (W + 1) + c;
  }
  return order;
}

/** The union-find node on side `k` (0 or 1) of edge `e`: a cell, or cellCount for outside. */
function sideNode(grid: Grid, e: number, k: number): number {
  const c = grid.edgeCells[e * 2 + k];
  return c === NONE ? grid.cellCount : c;
}

/**
 * Adjacent 3s (sharing a side): both outer sides parallel to the shared side are lines, and the
 * edges continuing the shared side beyond its ends are crossed. Diagonal 3s (sharing only a dot):
 * the two sides of each cell at the corner away from the other are lines.
 */
function buildPatterns(grid: Grid, clues: Int8Array): Pattern[] {
  const W = grid.width;
  const H = grid.height;
  const { cellEdges, edgeDots, dotEdges } = grid;
  const out: Pattern[] = [];
  const is3 = (r: number, c: number) =>
    r >= 0 && r < H && c >= 0 && c < W && clues[r * W + c] === 3;
  const present = (es: number[]) => es.filter((e) => e !== NONE);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (!is3(r, c)) continue;
      const a = r * W + c;
      if (is3(r, c + 1)) {
        const b = a + 1;
        const shared = cellEdges[a * 4 + 1];
        out.push({
          rule: "adjacent-3s",
          cells: [a, b],
          lines: [cellEdges[a * 4 + 3], cellEdges[b * 4 + 1]],
          crosses: present([
            dotEdges[edgeDots[shared * 2] * 4],
            dotEdges[edgeDots[shared * 2 + 1] * 4 + 2],
          ]),
        });
      }
      if (is3(r + 1, c)) {
        const b = a + W;
        const shared = cellEdges[a * 4 + 2];
        out.push({
          rule: "adjacent-3s",
          cells: [a, b],
          lines: [cellEdges[a * 4], cellEdges[b * 4 + 2]],
          crosses: present([
            dotEdges[edgeDots[shared * 2] * 4 + 3],
            dotEdges[edgeDots[shared * 2 + 1] * 4 + 1],
          ]),
        });
      }
      if (is3(r + 1, c + 1)) {
        const b = a + W + 1;
        out.push({
          rule: "diagonal-3s",
          cells: [a, b],
          lines: [
            cellEdges[a * 4],
            cellEdges[a * 4 + 3],
            cellEdges[b * 4 + 1],
            cellEdges[b * 4 + 2],
          ],
          crosses: [],
        });
      }
      if (is3(r + 1, c - 1)) {
        const b = a + W - 1;
        out.push({
          rule: "diagonal-3s",
          cells: [a, b],
          lines: [
            cellEdges[a * 4],
            cellEdges[a * 4 + 1],
            cellEdges[b * 4 + 2],
            cellEdges[b * 4 + 3],
          ],
          crosses: [],
        });
      }
    }
  }
  return out;
}
