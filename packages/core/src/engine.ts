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
 * 3. corners (optional): for every corner of a 1, 2 or 3, which pairs of states its two sides
 *    there can still take, narrowed at the clue and at the dot in turn (a worklist)
 * 4. inside/outside parity, a union-find over cells (global); when it decides nothing,
 *    colouring (optional): the relations each 1, 2 or 3 forces among its neighbours' sides, added
 *    to the same union-find (global); then a connectivity check that only detects contradictions
 * 5. lookahead: assume an edge, run tier 1, and take the opposite on a contradiction
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
  readonly corners: number;
  readonly closed: boolean;
}

/*
 * Corners (tier 3). A corner of a clue cell is the pair of its sides that meet at one dot: the
 * horizontal side h and the vertical side v. Its mask has bit `h * 2 + v` set while that pair of
 * states (1 = line, 0 = not) is still possible. "The loop passes through the corner" means
 * exactly one of the two is a line (mask within ODD). Corners are numbered 0 top-left,
 * 1 top-right, 2 bottom-right, 3 bottom-left; corner j of a cell is in quadrant (j + 2) % 4 of its
 * dot, where quadrants are numbered like `dotCells`.
 */
/** Every pair of states still possible. */
const ANY_PAIR = 0b1111;
/** A 1 never has both sides at a corner, a 3 never has neither. */
const ONE_PAIRS = 0b0111;
const THREE_PAIRS = 0b1110;
/** Exactly one of the two is a line. */
const ODD = 0b0110;
/** Line sets of a clue cell's sides (bit 0 top, 1 right, 2 bottom, 3 left), by size. */
const CELL_CONFIGS: number[][] = [[], [], [], [], []];
for (let m = 0; m < 16; m++)
  CELL_CONFIGS[(m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + (m >> 3)].push(m);
/** Line sets at a dot (bit j = `dotEdges` slot j: up, right, down, left): no line or two. */
const DOT_CONFIGS = [0b0000, 0b0011, 0b0101, 0b0110, 0b1001, 0b1010, 0b1100];

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

export interface EngineOptions {
  /** Run the corner rules (rule group "corners"). Default true. */
  readonly corners?: boolean;
  /** Run the colouring rule (rule group "colouring"). Default true. */
  readonly colouring?: boolean;
  /**
   * Run colouring only once lookahead finds nothing, instead of right after parity. Default false.
   * The fixpoint is the same and only the order of steps changes (hints would prefer lookahead to
   * colouring); the verifier, which reads no steps, saves a colouring pass before each lookahead
   * deduction.
   */
  readonly colourLast?: boolean;
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
  /**
   * Colouring. These arrays are allocated on the first colouring pass (`initColour`), so a puzzle
   * the earlier tiers finish pays nothing. Once a pass adds its first relation, each union-find
   * set's nodes form a ring (`ufNext`) with the set's size at its root (`ufSize`), so a new
   * relation can find the clue cells and edges beside the smaller of the two sets it joins.
   */
  private ufNext = new Int32Array(0);
  private ufSize = new Int32Array(0);
  /** Cells with a 1, 2 or 3, in index order: the cells the colouring rule looks at. */
  private colourCells = new Int32Array(0);
  /** Of those, the ones on the board's edge: the cells beside the outside node. */
  private borderColourCells = new Int32Array(0);
  /** The edges on the board's border: the outside node's edges. */
  private borderEdges = new Int32Array(0);
  private colourQueue = new Int32Array(0);
  private inColourQueue = new Uint8Array(0);
  private colourHead = 0;
  private colourLen = 0;
  /** `colourCell`'s scratch: its five nodes, their roots and parities, each one's set's first. */
  private readonly cNode = new Int32Array(5);
  private readonly cRoot = new Int32Array(5);
  private readonly cPar = new Uint8Array(5);
  private readonly cRep = new Int8Array(5);
  /** `colourCell`'s scratch: the fitting candidates (at most 6, for a 2). */
  private readonly cFit = new Int32Array(6);
  /**
   * While steps are recorded: each relation the colouring rule added in the current pass (its two
   * nodes, its clue cell, and the node pairs whose relations it used), for the steps' reasons.
   */
  private readonly colourRecs: ColourRec[] = [];
  /** While steps are recorded: the links behind the union-find (`colourForest`), once needed. */
  private forest: Forest | null = null;
  /** Edges the current colouring pass has set. */
  private colourSet = 0;
  /** While steps are recorded: in the pass's first round, which adds one deciding relation. */
  private single = false;
  /** Whether `ufNext` and `ufSize` describe the current union-find (see `buildRings`). */
  private rings = false;
  private readonly seen: Uint8Array;
  private readonly order: Int32Array;
  private readonly stack: Int32Array;
  private lookCursor = 0;
  /**
   * Corner masks, 4 per cell; 0 for cells without a 1, 2 or 3. These and the other corner arrays
   * are allocated on the first corner pass, so a puzzle the first tier finishes pays nothing.
   */
  private corners = new Uint8Array(0);
  /** Pairs (corner, old mask), so undo can restore masks. */
  private readonly cornerTrail: number[] = [];
  /** Dots at a corner of a 1, 2 or 3: the only ones the corner rules look at. */
  private cornerDots = new Uint8Array(0);
  private cornerQueue = new Int32Array(0);
  private inCornerQueue = new Uint8Array(0);
  private cqHead = 0;
  private cqLen = 0;
  /** The first corner pass visits every corner dot: the next one, or -1 before the pass starts. */
  private cornerScan = -1;
  /** Edges on the trail before this position have had their dots and cells queued for corners. */
  private cornerSeen = 0;
  /**
   * While steps are recorded: for each narrowed corner, the clue cells and dots (cellCount + dot)
   * whose rules narrowed it, directly or through other corners. A hint highlights them.
   */
  private readonly cornerWhy: (readonly number[] | undefined)[] = [];

  private readonly cornersOn: boolean;
  private readonly colourOn: boolean;
  private readonly colourLast: boolean;

  constructor(
    puzzle: Puzzle,
    private readonly budget: Budget,
    options: EngineOptions = {},
  ) {
    this.cornersOn = options.corners ?? true;
    this.colourOn = options.colouring ?? true;
    this.colourLast = options.colourLast ?? false;
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
   * Tiers 1, 3 (when the corners group is on), 4 (colouring when that group is on) and (optionally)
   * 5 until nothing changes. False on a contradiction. Checks the time budget on every pass, since
   * each parity pass costs O(edges).
   */
  propagate(lookahead: boolean): boolean {
    for (;;) {
      this.budget.tick();
      if (!this.local()) return false;
      if (this.closed) return true;
      if (this.cornersOn) {
        const c = this.cornerPass();
        if (c < 0) return false;
        if (c > 0) continue;
      }
      const p = this.parity();
      if (p < 0) return false;
      if (p > 0) continue;
      // Colouring works on the union-find parity just built; nothing below changes it.
      const last = this.colourLast && lookahead;
      if (this.colourOn && !last) {
        const c = this.colour();
        if (c < 0) return false;
        if (c > 0) continue;
      }
      if (!this.connected()) return false;
      if (!lookahead) return true;
      const q = this.lookahead();
      if (q < 0) return false;
      if (q > 0) continue;
      if (this.colourOn && last) {
        const c = this.colour();
        if (c < 0) return false;
        if (c > 0) continue;
      }
      return true;
    }
  }

  mark(): Mark {
    return {
      edges: this.edgeTrail.length,
      ends: this.endTrail.length,
      corners: this.cornerTrail.length,
      closed: this.closed,
    };
  }

  undo(m: Mark): void {
    const { edges, mate, plen, edgeTrail, endTrail, corners, cornerTrail } = this;
    while (cornerTrail.length > m.corners) {
      const old = cornerTrail.pop() as number;
      corners[cornerTrail.pop() as number] = old;
    }
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
    while (this.cqLen > 0) this.dequeueCorner();
    if (this.cornerSeen > m.edges) this.cornerSeen = m.edges;
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
        if (this.recording()) this.begin("loop-complete", [], []);
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
    if (this.recording()) this.begin(rule, [i], []);
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
    if (this.recording()) this.begin(k === 3 ? "corner-3" : "corner-1", [i], [d]);
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
      if (this.recording()) this.begin("premature-loop", [], [d, m]);
      if (!this.assign(e, Cross)) return false;
      this.commit();
      return true;
    }
    return true;
  }

  private fillDot(d: number, state: EdgeState, rule: RuleId): boolean {
    if (this.recording()) this.begin(rule, [], [d]);
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

  // --- tier 3: corners ----------------------------------------------------------------------

  /**
   * Runs the corner rules: first at every dot at a corner of a 1, 2 or 3, then at the clue cells
   * and dots whose edges or corner masks changed since. Narrowing a mask is silent; a rule that
   * sets edges records one step and returns 1, so the cheaper rules run again before the next one.
   * Returns 0 when nothing is left to do, -1 on a contradiction.
   */
  private cornerPass(): number {
    // Hazard: the first pass scans every corner dot once (`cornerScan`) and that is never redone.
    // A mark taken before this first pass and undone past it would restore the default masks but
    // leave the scan finished, so those dots would never be visited again. Nothing does this today
    // (the verifier's first pass is at its root, probes run tier 1 only); WT18, if it runs corners
    // in probes or marks before the first pass, must reset `cornerScan` in `undo`.
    if (this.cornerScan < 0) this.initCorners();
    const { grid, edgeTrail } = this;
    const C = grid.cellCount;
    for (let p = this.cornerSeen; p < edgeTrail.length; p++) {
      const e = edgeTrail[p];
      this.queueCornerDot(grid.edgeDots[e * 2]);
      this.queueCornerDot(grid.edgeDots[e * 2 + 1]);
      this.queueCornerCell(grid.edgeCells[e * 2]);
      this.queueCornerCell(grid.edgeCells[e * 2 + 1]);
    }
    this.cornerSeen = edgeTrail.length;
    while (this.cornerScan < grid.dotCount) {
      const d = this.cornerScan++;
      if (!this.cornerDots[d]) continue;
      const r = this.cornerDot(d);
      if (r !== 0) return r;
    }
    while (this.cqLen > 0) {
      const x = this.dequeueCorner();
      const r = x < C ? this.cornerCell(x) : this.cornerDot(x - C);
      if (r < 0) while (this.cqLen > 0) this.dequeueCorner();
      if (r !== 0) return r;
    }
    return 0;
  }

  private initCorners(): void {
    const { grid, clues } = this;
    const items = grid.cellCount + grid.dotCount;
    this.corners = new Uint8Array(grid.cellCount * 4);
    this.cornerDots = new Uint8Array(grid.dotCount);
    this.cornerQueue = new Int32Array(items);
    this.inCornerQueue = new Uint8Array(items);
    for (let i = 0; i < grid.cellCount; i++) {
      const k = clues[i];
      if (k < 1 || k > 3) continue;
      const mask = k === 1 ? ONE_PAIRS : k === 3 ? THREE_PAIRS : ANY_PAIR;
      for (let j = 0; j < 4; j++) {
        this.corners[i * 4 + j] = mask;
        this.cornerDots[cornerDotOf(grid, i, j)] = 1;
      }
    }
    this.cornerScan = 0;
  }

  /**
   * Corner rule at a clue cell: of the side sets with exactly the clue's number of lines, keeps
   * those that fit the known edges and all four corner masks. Masks narrow to what those sets
   * allow; a side that is a line in all of them, or in none, is decided.
   */
  private cornerCell(i: number): number {
    const k = this.clues[i];
    const { edges, corners } = this;
    const { cellEdges } = this.grid;
    const base = i * 4;
    let lines = 0;
    let crosses = 0;
    for (let s = 0; s < 4; s++) {
      const st = edges[cellEdges[base + s]];
      if (st === Line) lines |= 1 << s;
      else if (st === Cross) crosses |= 1 << s;
    }
    if ((lines | crosses) === 0b1111) return 0;
    const c0 = corners[base];
    const c1 = corners[base + 1];
    const c2 = corners[base + 2];
    const c3 = corners[base + 3];
    let any = 0;
    let all = 0b1111;
    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    let n3 = 0;
    let used = 0;
    for (const m of CELL_CONFIGS[k]) {
      if ((m & lines) !== lines || (m & crosses) !== 0) continue;
      const t = m & 1;
      const r = (m >> 1) & 1;
      const b = (m >> 2) & 1;
      const l = m >> 3;
      const b0 = 1 << (t * 2 + l);
      const b1 = 1 << (t * 2 + r);
      const b2 = 1 << (b * 2 + r);
      const b3 = 1 << (b * 2 + l);
      // `used` notes the first mask that rules a set out, for the hint.
      if (!(c0 & b0)) used |= 1;
      else if (!(c1 & b1)) used |= 2;
      else if (!(c2 & b2)) used |= 4;
      else if (!(c3 & b3)) used |= 8;
      else {
        any |= m;
        all &= m;
        n0 |= b0;
        n1 |= b1;
        n2 |= b2;
        n3 |= b3;
      }
    }
    if (any === 0) return -1;
    const setLines = all & ~lines;
    const setCrosses = 0b1111 & ~any & ~crosses;
    const narrow = (c0 & n0) !== c0 || (c1 & n1) !== c1 || (c2 & n2) !== c2 || (c3 & n3) !== c3;
    if (!narrow && setLines === 0 && setCrosses === 0) return 0;
    const why =
      this.steps === null ? undefined : this.gather(i, used, [base, base + 1, base + 2, base + 3]);
    const nm = [c0 & n0, c1 & n1, c2 & n2, c3 & n3];
    for (let j = 0; j < 4; j++) {
      if (nm[j] === corners[base + j]) continue;
      this.narrow(base + j, nm[j], why);
      this.queueCornerDot(cornerDotOf(this.grid, i, j));
    }
    const changes: EdgeChange[] = [];
    for (let s = 0; s < 4; s++) {
      const e = cellEdges[base + s];
      if (setLines & (1 << s)) changes.push({ edge: e, state: Line });
      else if (setCrosses & (1 << s)) changes.push({ edge: e, state: Cross });
    }
    return this.cornerStep(changes, why);
  }

  /**
   * Corner rule at a dot: of the line sets a dot can have (none, or two of its edges), keeps those
   * that fit the known edges and the corner masks of the clue cells around it. Masks narrow to what
   * those sets allow; an edge that is a line in all of them, or in none, is decided.
   */
  private cornerDot(d: number): number {
    const { grid, edges, corners } = this;
    const db = d * 4;
    let present = 0;
    let lines = 0;
    let crosses = 0;
    for (let s = 0; s < 4; s++) {
      const e = grid.dotEdges[db + s];
      if (e === NONE) continue;
      present |= 1 << s;
      if (edges[e] === Line) lines |= 1 << s;
      else if (edges[e] === Cross) crosses |= 1 << s;
    }
    if ((lines | crosses) === present) return 0;
    const q0 = this.quadCorner(db, 0);
    const q1 = this.quadCorner(db, 1);
    const q2 = this.quadCorner(db, 2);
    const q3 = this.quadCorner(db, 3);
    const m0 = q0 < 0 ? ANY_PAIR : corners[q0];
    const m1 = q1 < 0 ? ANY_PAIR : corners[q1];
    const m2 = q2 < 0 ? ANY_PAIR : corners[q2];
    const m3 = q3 < 0 ? ANY_PAIR : corners[q3];
    let any = 0;
    let all = 0b1111;
    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    let n3 = 0;
    let used = 0;
    let count = 0;
    for (const m of DOT_CONFIGS) {
      if ((m & present) !== m || (m & lines) !== lines || (m & crosses) !== 0) continue;
      const up = m & 1;
      const right = (m >> 1) & 1;
      const down = (m >> 2) & 1;
      const left = m >> 3;
      // Quadrant q's corner as (h, v): 0 (left, up), 1 (right, up), 2 (right, down),
      // 3 (left, down).
      const b0 = 1 << (left * 2 + up);
      const b1 = 1 << (right * 2 + up);
      const b2 = 1 << (right * 2 + down);
      const b3 = 1 << (left * 2 + down);
      if (!(m0 & b0)) used |= 1;
      else if (!(m1 & b1)) used |= 2;
      else if (!(m2 & b2)) used |= 4;
      else if (!(m3 & b3)) used |= 8;
      else {
        count++;
        any |= m;
        all &= m;
        n0 |= b0;
        n1 |= b1;
        n2 |= b2;
        n3 |= b3;
      }
    }
    if (count === 0) return -1;
    const setLines = all & ~lines;
    const setCrosses = present & ~any & ~crosses;
    const qs = [q0, q1, q2, q3];
    const nm = [m0 & n0, m1 & n1, m2 & n2, m3 & n3];
    let narrow = false;
    for (let q = 0; q < 4; q++) if (qs[q] >= 0 && nm[q] !== corners[qs[q]]) narrow = true;
    if (!narrow && setLines === 0 && setCrosses === 0) return 0;
    const why = this.steps === null ? undefined : this.gather(grid.cellCount + d, used, qs);
    for (let q = 0; q < 4; q++) {
      const c = qs[q];
      if (c < 0 || nm[q] === corners[c]) continue;
      this.narrow(c, nm[q], why);
      this.queueCornerCell(c >> 2);
    }
    const changes: EdgeChange[] = [];
    for (let s = 0; s < 4; s++) {
      const e = grid.dotEdges[db + s];
      if (setLines & (1 << s)) changes.push({ edge: e, state: Line });
      else if (setCrosses & (1 << s)) changes.push({ edge: e, state: Cross });
    }
    return this.cornerStep(changes, why);
  }

  /** Sets `changes` as one step named by `classifyCorners`. 0 when there are none. */
  private cornerStep(changes: EdgeChange[], why: readonly number[] | undefined): number {
    if (changes.length === 0) return 0;
    if (why !== undefined) {
      const C = this.grid.cellCount;
      const cells = why.filter((x) => x < C);
      const dots = why.filter((x) => x >= C).map((x) => x - C);
      this.begin(
        classifyCorners(this.grid, this.clues, this.corners, cells, dots, changes),
        cells,
        dots,
      );
    } else this.pending = null;
    for (const { edge, state } of changes) if (!this.assign(edge, state)) return -1;
    this.commit();
    return 1;
  }

  /**
   * A corner rule's reason: `own` (the clue cell or dot) and, for each corner `corners[q]` whose bit
   * is set in `used`, its clue cell and the reason recorded when it was narrowed. Sorted, no
   * repeats.
   */
  private gather(own: number, used: number, corners: readonly number[]): readonly number[] {
    const sites = new Set<number>([own]);
    for (let q = 0; q < 4; q++) {
      if (!(used & (1 << q))) continue;
      sites.add(corners[q] >> 2);
      for (const x of this.cornerWhy[corners[q]] ?? []) sites.add(x);
    }
    return [...sites].sort((a, b) => a - b);
  }

  private narrow(c: number, mask: number, why: readonly number[] | undefined): void {
    this.cornerTrail.push(c, this.corners[c]);
    this.corners[c] = mask;
    if (why === undefined) return;
    const old = this.cornerWhy[c];
    this.cornerWhy[c] =
      old === undefined ? why : [...new Set([...old, ...why])].sort((a, b) => a - b);
  }

  /** The corner in quadrant `q` of the dot whose `dotCells` entries start at `db`, or -1. */
  private quadCorner(db: number, q: number): number {
    const c = this.dotCells[db + q];
    return c !== NONE && this.corners[c * 4] !== 0 ? c * 4 + ((q + 2) & 3) : -1;
  }

  /** Queues a cell for the corner rules if it has a 1, 2 or 3. */
  private queueCornerCell(i: number): void {
    if (i !== NONE && this.corners[i * 4] !== 0) this.enqueueCorner(i);
  }

  /** Queues a dot for the corner rules if it is a corner of a 1, 2 or 3. */
  private queueCornerDot(d: number): void {
    if (this.cornerDots[d]) this.enqueueCorner(this.grid.cellCount + d);
  }

  private enqueueCorner(x: number): void {
    if (this.inCornerQueue[x]) return;
    this.inCornerQueue[x] = 1;
    this.cornerQueue[(this.cqHead + this.cqLen) % this.cornerQueue.length] = x;
    this.cqLen++;
  }

  private dequeueCorner(): number {
    const x = this.cornerQueue[this.cqHead];
    this.cqHead = (this.cqHead + 1) % this.cornerQueue.length;
    this.cqLen--;
    this.inCornerQueue[x] = 0;
    return x;
  }

  // --- tier 4: inside/outside parity --------------------------------------------------------

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
      if (this.recording()) {
        this.begin(
          "parity",
          [na, nb].filter((n) => n !== C),
          [],
        );
      }
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

  // --- tier 4b: colouring -------------------------------------------------------------------

  /**
   * Colouring, run on parity's union-find when parity decides nothing. Every cell is inside or
   * outside the loop, everything beyond the border is outside, and a clue k has exactly k of its
   * four neighbours on the other side from it. `colourCell` adds every relation a clue forces among
   * its cell and the cell's neighbours, and each new relation decides the open edges between the
   * two sets it joins, one step per edge. A cell is looked at again when a new relation joins two
   * sets it has nodes in. Returns the number of edges set, or -1 on a contradiction.
   */
  private colour(): number {
    if (this.ufNext.length === 0) this.initColour();
    const { colourCells } = this;
    const recording = this.steps !== null;
    this.rings = false;
    this.colourSet = 0;
    this.forest = null;
    if (recording) {
      this.colourRecs.length = 0;
      // A hint names the simplest deduction: first a clue whose own relation decides an edge on
      // the union-find as parity built it, and only then relations that chain through others.
      this.single = true;
      for (let x = 0; x < colourCells.length && this.colourSet === 0; x++) {
        if (!this.colourCell(colourCells[x])) {
          this.single = false;
          return -1;
        }
      }
      this.single = false;
      // Cells its joins queued stay queued: the next pass queues every cell again, and the queue
      // holds none twice (`inColourQueue`), so leaving them costs nothing and changes no step.
      if (this.colourSet > 0) return this.colourSet;
    }
    for (let x = 0; x < colourCells.length; x++) this.queueColour(colourCells[x]);
    while (this.colourLen > 0) {
      const ok = this.colourCell(this.dequeueColour());
      // While steps are recorded, stop at the first cell that decides an edge, so the cheaper
      // rules (parity first) follow it up before the next colouring step.
      if (!ok || (recording && this.colourSet > 0)) {
        while (this.colourLen > 0) this.dequeueColour();
        if (!ok) return -1;
      }
    }
    return this.colourSet;
  }

  /** Allocates the colouring arrays (see `ufNext`). */
  private initColour(): void {
    const { grid, clues } = this;
    const C = grid.cellCount;
    const cells: number[] = [];
    const border: number[] = [];
    for (let i = 0; i < C; i++) {
      if (clues[i] < 1 || clues[i] > 3) continue;
      cells.push(i);
      const r = Math.floor(i / grid.width);
      const c = i % grid.width;
      if (r === 0 || c === 0 || r === grid.height - 1 || c === grid.width - 1) border.push(i);
    }
    const edges: number[] = [];
    for (let e = 0; e < grid.edgeCount; e++) {
      if (grid.edgeCells[e * 2] === NONE || grid.edgeCells[e * 2 + 1] === NONE) edges.push(e);
    }
    this.colourCells = Int32Array.from(cells);
    this.borderColourCells = Int32Array.from(border);
    this.borderEdges = Int32Array.from(edges);
    this.ufNext = new Int32Array(C + 1);
    this.ufSize = new Int32Array(C + 1);
    this.colourQueue = new Int32Array(C);
    this.inColourQueue = new Uint8Array(C);
  }

  /**
   * The colouring rule at clue cell `i`. Node 0 is the cell and node j + 1 the node across its side
   * j (0 top, 1 right, 2 bottom, 3 left). A candidate is a set of k sides, k the clue: neighbour j
   * is on the other side from the cell exactly when side j is in it. Keeps the candidates that fit
   * the relations known among the five nodes and adds each relation between two of them (in
   * different sets) that is the same in all of those. False on a contradiction: no candidate fits,
   * or an edge the new relations decide breaks a rule.
   */
  private colourCell(i: number): boolean {
    const { grid, edges, cNode, cRoot, cPar, cRep, cFit } = this;
    const base = i * 4;
    // All four sides known: the cell is linked to every neighbour already, nothing to add.
    if (
      edges[grid.cellEdges[base]] !== Unknown &&
      edges[grid.cellEdges[base + 1]] !== Unknown &&
      edges[grid.cellEdges[base + 2]] !== Unknown &&
      edges[grid.cellEdges[base + 3]] !== Unknown
    ) {
      return true;
    }
    cNode[0] = i;
    for (let j = 0; j < 4; j++) cNode[j + 1] = across(grid, i, j);
    // Bit t of `known`: node t shares a set with an earlier node, the first of which is cRep[t].
    let known = 0;
    for (let t = 0; t < 5; t++) {
      cRoot[t] = this.ufFind(cNode[t]);
      cPar[t] = this.ufFound;
      cRep[t] = t;
      for (let s = 0; s < t; s++) {
        if (cRoot[s] === cRoot[t]) {
          cRep[t] = s;
          known |= 1 << t;
          break;
        }
      }
    }
    // Nothing known among the five: every candidate fits, and no relation holds in all of them.
    if (known === 0) return true;
    const k = this.clues[i];
    // Each fitting candidate as `col`: bit t set when node t is on the other side from the cell.
    let fits = 0;
    for (const m of CELL_CONFIGS[k]) {
      const col = m << 1;
      if (this.colourFits(col, known)) cFit[fits++] = col;
    }
    if (fits === 0) return false;
    for (let a = 0; a < 5; a++) {
      for (let b = a + 1; b < 5; b++) {
        if (cRoot[a] === cRoot[b]) continue;
        const x = ((cFit[0] >> a) ^ (cFit[0] >> b)) & 1;
        let holds = true;
        for (let q = 1; q < fits && holds; q++) {
          holds = (((cFit[q] >> a) ^ (cFit[q] >> b)) & 1) === x;
        }
        if (!holds) continue;
        // The first pass while recording adds only a relation that decides an edge, and one.
        if (this.single && (this.colourSet > 0 || !this.decidesEdge(a, b))) continue;
        if (!this.colourJoin(i, known, a, b, x)) return false;
      }
    }
    return true;
  }

  /** Whether an open edge joins the sets of nodes a and b of the current cell (which differ). */
  private decidesEdge(a: number, b: number): boolean {
    const { grid, edges, ufNext, ufSize, cNode } = this;
    let small = this.ufFind(cNode[a]);
    let large = this.ufFind(cNode[b]);
    if (small === large) return false;
    if (!this.rings) this.buildRings();
    if (ufSize[small] > ufSize[large]) {
      const t = small;
      small = large;
      large = t;
    }
    const C = grid.cellCount;
    let n = small;
    do {
      const list = n === C ? this.borderEdges : grid.cellEdges;
      const from = n === C ? 0 : n * 4;
      const to = n === C ? list.length : from + 4;
      for (let x = from; x < to; x++) {
        const e = list[x];
        if (edges[e] !== Unknown) continue;
        const s = sideNode(grid, e, 0);
        if (this.ufFind(s === n ? sideNode(grid, e, 1) : s) === large) return true;
      }
      n = ufNext[n];
    } while (n !== small);
    return false;
  }

  /** True when candidate `col` fits the relation of each node in `known` to its set's first. */
  private colourFits(col: number, known: number): boolean {
    const { cRep, cPar } = this;
    for (let t = 1; t < 5; t++) {
      if (!(known & (1 << t))) continue;
      const s = cRep[t];
      if ((((col >> t) ^ (col >> s)) & 1) !== (cPar[t] ^ cPar[s])) return false;
    }
    return true;
  }

  /**
   * Adds "nodes a and b of cell i are on different sides exactly when x is 1" to the union-find
   * (nothing when an earlier relation of the same cell put them in one set). Then, for each node of
   * the smaller of the two sets, decides its open edges to the other set and queues the clue cells
   * at or beside it: every cell with nodes in both sets has one there. False on a contradiction.
   */
  private colourJoin(i: number, known: number, a: number, b: number, x: number): boolean {
    const { ufParent, ufParity, ufSize, ufNext, cNode } = this;
    let small = this.ufFind(cNode[a]);
    const pa = this.ufFound;
    let large = this.ufFind(cNode[b]);
    const pb = this.ufFound;
    if (small === large) return true;
    if (!this.rings) this.buildRings();
    if (ufSize[small] > ufSize[large]) {
      const t = small;
      small = large;
      large = t;
    }
    ufParent[small] = large;
    ufParity[small] = pa ^ pb ^ x;
    if (this.steps !== null) {
      const deps = this.colourDeps(this.clues[i], known, a, b, x);
      this.colourRecs.push({ u: cNode[a], v: cNode[b], cell: i, deps });
      if (this.forest !== null) {
        addLink(this.forest, cNode[a], cNode[b], this.colourRecs.length - 1);
      }
    }
    let n = small;
    do {
      this.queueAround(n);
      if (!this.colourEdges(n, large)) return false;
      n = ufNext[n];
    } while (n !== small);
    this.joinRings(small, large);
    return true;
  }

  /**
   * Decides the open edges between node `n` and the nodes of the set with root `large`, which a
   * colouring relation has just joined to n's set (while steps are recorded, only the pass's first
   * edge: the next parity pass decides the rest, as `parity` steps). False when one breaks a rule.
   */
  private colourEdges(n: number, large: number): boolean {
    const { grid, edges } = this;
    const C = grid.cellCount;
    const list = n === C ? this.borderEdges : grid.cellEdges;
    const from = n === C ? 0 : n * 4;
    const to = n === C ? list.length : from + 4;
    for (let x = from; x < to; x++) {
      if (this.steps !== null && this.colourSet > 0) return true;
      const e = list[x];
      if (edges[e] !== Unknown) continue;
      const a = sideNode(grid, e, 0);
      const other = a === n ? sideNode(grid, e, 1) : a;
      if (this.ufFind(other) !== large) continue;
      const po = this.ufFound;
      this.ufFind(n);
      const state = this.ufFound !== po ? Line : Cross;
      if (this.recording()) {
        this.forest ??= this.colourForest();
        const why = colourReason(this.forest, this.colourRecs, n, other);
        // The edge's cells too, unless they hold a clue the reason does not use.
        const cells = new Set(why);
        if (n !== C && this.clues[n] === NO_CLUE) cells.add(n);
        if (other !== C && this.clues[other] === NO_CLUE) cells.add(other);
        this.begin(
          why.length === 1 ? COLOUR_RULE[this.clues[why[0]]] : "colour-chain",
          [...cells].sort((p, q) => p - q),
          [],
        );
      }
      if (!this.assign(e, state)) return false;
      this.commit();
      this.colourSet++;
    }
    return true;
  }

  /** Puts each union-find set's nodes in a ring, with the set's size at its root. */
  private buildRings(): void {
    const { ufNext, ufSize } = this;
    const n = this.grid.cellCount + 1;
    for (let x = 0; x < n; x++) {
      ufNext[x] = x;
      ufSize[x] = 1;
    }
    for (let x = 0; x < n; x++) {
      const r = this.ufFind(x);
      if (r === x) continue;
      ufNext[x] = ufNext[r];
      ufNext[r] = x;
      ufSize[r]++;
    }
    this.rings = true;
  }

  /** Merges the node rings of roots `a` and `b` into b's. */
  private joinRings(a: number, b: number): void {
    const { ufNext, ufSize } = this;
    ufSize[b] += ufSize[a];
    const t = ufNext[a];
    ufNext[a] = ufNext[b];
    ufNext[b] = t;
  }

  /**
   * For a step's reason: the node pairs whose known relations the relation between nodes a and b
   * rests on. Starts from every known one and drops each that every fitting candidate keeps a and b
   * related by x without.
   */
  private colourDeps(k: number, known: number, a: number, b: number, x: number): number[] {
    let need = known;
    for (let t = 1; t < 5; t++) {
      const fewer = need & ~(1 << t);
      if (fewer !== need && this.colourHolds(k, fewer, a, b, x)) need = fewer;
    }
    const deps: number[] = [];
    for (let t = 1; t < 5; t++) {
      if (need & (1 << t)) deps.push(this.cNode[this.cRep[t]], this.cNode[t]);
    }
    return deps;
  }

  /** True when every candidate for a clue k that fits `known` has nodes a and b related by x. */
  private colourHolds(k: number, known: number, a: number, b: number, x: number): boolean {
    for (const m of CELL_CONFIGS[k]) {
      const col = m << 1;
      if (this.colourFits(col, known) && (((col >> a) ^ (col >> b)) & 1) !== x) return false;
    }
    return true;
  }

  /**
   * The links behind the current union-find, for colouring steps' reasons: a spanning forest of the
   * known edges, then the colouring relations in the order they were added. Each of those joined
   * two sets, so the links still form a forest, and the path between two linked nodes is a chain of
   * relations from one to the other.
   */
  private colourForest(): Forest {
    const { grid, edges } = this;
    const n = grid.cellCount + 1;
    const parent = Int32Array.from({ length: n }, (_, x) => x);
    const root = (x: number): number => {
      let r = x;
      while (parent[r] !== r) r = parent[r];
      parent[x] = r;
      return r;
    };
    const forest: Forest = { head: new Int32Array(n).fill(NONE), next: [], to: [], rec: [] };
    const link = (u: number, v: number, rec: number) => {
      const a = root(u);
      const b = root(v);
      if (a === b) return;
      parent[a] = b;
      addLink(forest, u, v, rec);
    };
    for (let e = 0; e < grid.edgeCount; e++) {
      if (edges[e] !== Unknown) link(sideNode(grid, e, 0), sideNode(grid, e, 1), NONE);
    }
    for (let x = 0; x < this.colourRecs.length; x++) {
      link(this.colourRecs[x].u, this.colourRecs[x].v, x);
    }
    return forest;
  }

  /** Queues the clue cells 1–3 at or beside node `n` (the border cells for the outside node). */
  private queueAround(n: number): void {
    const C = this.grid.cellCount;
    if (n === C) {
      for (let x = 0; x < this.borderColourCells.length; x++) {
        this.queueColour(this.borderColourCells[x]);
      }
      return;
    }
    this.queueColour(n);
    for (let j = 0; j < 4; j++) {
      const m = across(this.grid, n, j);
      if (m !== C) this.queueColour(m);
    }
  }

  private queueColour(i: number): void {
    const k = this.clues[i];
    if (k < 1 || k > 3 || this.inColourQueue[i]) return;
    this.inColourQueue[i] = 1;
    this.colourQueue[(this.colourHead + this.colourLen) % this.colourQueue.length] = i;
    this.colourLen++;
  }

  private dequeueColour(): number {
    const i = this.colourQueue[this.colourHead];
    this.colourHead = (this.colourHead + 1) % this.colourQueue.length;
    this.colourLen--;
    this.inColourQueue[i] = 0;
    return i;
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

  // --- tier 5: lookahead --------------------------------------------------------------------

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

  /**
   * True while steps are recorded. Otherwise clears the pending step, so callers skip building a
   * step's cells and dots when nobody reads them (lookahead probes, the verifier's search).
   */
  private recording(): boolean {
    if (this.steps !== null) return true;
    this.pending = null;
    return false;
  }

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

/** The node across side `j` (0 top, 1 right, 2 bottom, 3 left) of cell `i`: a cell, or outside. */
function across(grid: Grid, i: number, j: number): number {
  return sideNode(grid, grid.cellEdges[i * 4 + j], j === 1 || j === 2 ? 1 : 0);
}

/** The rule a colouring step resting on one clue is named by, indexed by that clue. */
const COLOUR_RULE: readonly RuleId[] = ["colour-chain", "colour-1", "colour-2", "colour-3"];

/** A relation the colouring rule added: its two nodes, its clue cell, the node pairs it used. */
interface ColourRec {
  readonly u: number;
  readonly v: number;
  readonly cell: number;
  readonly deps: readonly number[];
}

/**
 * Links over union-find nodes: for each node a list (`head`, then `next`) of links to `to`, made
 * by colouring relation `rec`, or NONE for a known edge. Link l and l ^ 1 are the two directions.
 */
interface Forest {
  readonly head: Int32Array;
  readonly next: number[];
  readonly to: number[];
  readonly rec: number[];
}

/** Adds a link between nodes `u` and `v`, made by colouring relation `rec` (NONE: a known edge). */
function addLink(f: Forest, u: number, v: number, rec: number): void {
  for (const [p, q] of [
    [u, v],
    [v, u],
  ]) {
    f.next.push(f.head[p]);
    f.to.push(q);
    f.rec.push(rec);
    f.head[p] = f.to.length - 1;
  }
}

/** The colouring relations on the forest path between nodes `a` and `b`, which are linked. */
function forestPath(f: Forest, a: number, b: number): number[] {
  const via = new Map<number, number>([[a, NONE]]);
  const queue = [a];
  for (let h = 0; h < queue.length && !via.has(b); h++) {
    for (let l = f.head[queue[h]]; l !== NONE; l = f.next[l]) {
      const v = f.to[l];
      if (via.has(v)) continue;
      via.set(v, l);
      queue.push(v);
    }
  }
  const recs: number[] = [];
  for (let v = b; v !== a; ) {
    const l = via.get(v) as number;
    if (f.rec[l] !== NONE) recs.push(f.rec[l]);
    v = f.to[l ^ 1];
  }
  return recs;
}

/**
 * The clue cells a colouring step that links nodes `a` and `b` rests on: the cells of the colouring
 * relations on the path between them and, in turn, of the relations each of those used. Sorted.
 */
function colourReason(f: Forest, recs: readonly ColourRec[], a: number, b: number): number[] {
  const cells = new Set<number>();
  const seen = new Set<number>();
  const pairs = [a, b];
  while (pairs.length > 0) {
    const v = pairs.pop() as number;
    const u = pairs.pop() as number;
    for (const r of forestPath(f, u, v)) {
      if (seen.has(r)) continue;
      seen.add(r);
      cells.add(recs[r].cell);
      pairs.push(...recs[r].deps);
    }
  }
  return [...cells].sort((p, q) => p - q);
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

/** The dot at corner `j` (0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left) of cell `i`. */
function cornerDotOf(grid: Grid, i: number, j: number): number {
  const side = grid.cellEdges[i * 4 + (j < 2 ? 0 : 2)];
  return grid.edgeDots[side * 2 + (j === 1 || j === 2 ? 1 : 0)];
}

/**
 * Names a corner step for its hint from the clue cells and dots it rests on (its reason) and the
 * edges it sets, checked in this order:
 * - a 2 among the clues: "two-in-corner" when the 2 is the only clue, sits in a corner cell of the
 *   board, and the reason holds that corner's dot and only dots on the board's edge; otherwise
 *   "two-passes-on"
 * - one clue, a 1 or a 3: "line-into-1" or "line-into-3"
 * - two 1s sharing a side, and the step only crosses that side: "ones-side-by-side"
 * - a 1 and a 3 touching at a corner the loop passes through: "three-diagonal-one"
 * - anything else: "corner-chain"
 */
function classifyCorners(
  grid: Grid,
  clues: Int8Array,
  corners: Uint8Array,
  cells: readonly number[],
  dots: readonly number[],
  changes: readonly EdgeChange[],
): RuleId {
  const W = grid.width;
  const H = grid.height;
  const count = (k: number) => cells.filter((c) => clues[c] === k).length;
  if (count(2) > 0) {
    if (cells.length !== 1) return "two-passes-on";
    const row = (d: number) => Math.floor(d / (W + 1));
    const col = (d: number) => d % (W + 1);
    const onBorder = (d: number) => row(d) % H === 0 || col(d) % W === 0;
    for (let j = 0; j < 4; j++) {
      const d = cornerDotOf(grid, cells[0], j);
      const boardCorner = row(d) % H === 0 && col(d) % W === 0;
      if (boardCorner && dots.includes(d) && dots.every(onBorder)) return "two-in-corner";
    }
    return "two-passes-on";
  }
  if (cells.length === 1) return clues[cells[0]] === 1 ? "line-into-1" : "line-into-3";
  if (cells.length === 2 && count(1) === 2 && changes.length === 1) {
    const [a, b] = cells;
    for (let j = 0; j < 4; j++) {
      const e = grid.cellEdges[a * 4 + j];
      if (
        e === changes[0].edge &&
        changes[0].state === Cross &&
        grid.cellEdges[b * 4 + ((j + 2) & 3)] === e
      ) {
        return "ones-side-by-side";
      }
    }
  }
  if (cells.length === 2 && count(1) === 1 && count(3) === 1) {
    const three = clues[cells[0]] === 3 ? cells[0] : cells[1];
    const one = three === cells[0] ? cells[1] : cells[0];
    const dr = Math.floor(one / W) - Math.floor(three / W);
    const dc = (one % W) - (three % W);
    if (Math.abs(dr) === 1 && Math.abs(dc) === 1) {
      // The 3's corner towards the 1.
      const j = dr < 0 ? (dc < 0 ? 0 : 1) : dc < 0 ? 3 : 2;
      if ((corners[three * 4 + j] & ~ODD) === 0) return "three-diagonal-one";
    }
  }
  return "corner-chain";
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
