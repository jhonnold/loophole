import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { Budget, Engine, type Mark } from "./engine.ts";
import { parsePuzzle } from "./format.ts";
import { createGrid, EdgeState } from "./grid.ts";
import { generateLoop } from "./loop.ts";
import { createPuzzle, deriveClues, NO_CLUE } from "./puzzle.ts";
import { createRng } from "./rng.ts";
import { verify } from "./verify.ts";

function puzzle(width: number, height: number, clues: string) {
  return parsePuzzle({ v: 1, width, height, clues });
}

describe("Engine", () => {
  test("undoing past the first corner pass makes the next one scan every corner dot again", () => {
    // A 3 beside a 1 in a strip: the corner rules, scanning the 3's and the 1's corner dots, decide
    // an edge (corner-chain) that tier 1 and parity do not (colouring would, so it is off).
    const budget = new Budget(Date.now, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const options = { colouring: false };
    const engine = new Engine(puzzle(1, 4, ".31."), budget, options);
    expect(engine.local()).toBe(true);
    const before = engine.edges.slice();
    const m = engine.mark();
    expect(engine.propagate(false)).toBe(true);
    const first = engine.edges.slice();
    expect(first).not.toEqual(before);
    engine.undo(m);
    expect(engine.edges).toEqual(before);
    expect(engine.propagate(false)).toBe(true);
    expect(engine.edges).toEqual(first);
  });

  test("probes run the corner rules only when probeCorners is on (the verifier after deepen)", () => {
    // A 2 in a one-wide strip with colouring off: only a probe that runs the corner rules settles it.
    const p = puzzle(1, 3, ".2.");
    const budget = new Budget(Date.now, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const shallow = new Engine(p, budget, { colouring: false });
    expect(shallow.solveRoot(true)).toBe(true);
    expect(shallow.closed).toBe(false);
    const deep = new Engine(p, budget, { colouring: false, probeCorners: true });
    expect(deep.solveRoot(true)).toBe(true);
    expect(deep.closed).toBe(true);
    const deepened = new Engine(p, budget, { colouring: false });
    deepened.deepen();
    expect(deepened.solveRoot(true)).toBe(true);
    expect(deepened.closed).toBe(true);
  });

  test("without steps, undoing to a mark taken before colouring's first pass makes it look at every clue again", () => {
    // A 2 in a one-wide strip: only colouring settles it (see the corner-probe test). The mark is
    // taken before colouring has looked at any clue, so after `undo` it has to look at all of them.
    const budget = new Budget(Date.now, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const engine = new Engine(puzzle(1, 3, ".2."), budget);
    expect(engine.local()).toBe(true);
    const m = engine.mark();
    expect(engine.propagate(false)).toBe(true);
    expect(engine.closed).toBe(true);
    const first = engine.edges.slice();
    engine.undo(m);
    expect(engine.propagate(false)).toBe(true);
    expect(engine.edges).toEqual(first);
  });

  test("without steps it keeps parity's union-find through sets and undos, as rebuilding finds", () => {
    // An engine that records no steps keeps parity's union-find (and colouring's relations in it)
    // between passes and undoes it with the edges, as the verifier's search does; one that records
    // steps rebuilds it on every pass. Given the same sets and undos, they agree after every one.
    // With connectivity on too, as after `deepen`. Few clues and 15–60 moves a run, so most boards
    // are open at the root and about half the undos split unions.
    const budget = () => new Budget(Date.now, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.double({ min: 0.05, max: 0.5, noNaN: true }),
        fc.boolean(),
        fc.array(fc.tuple(fc.nat({ max: 3 }), fc.nat(), fc.boolean()), {
          minLength: 15,
          maxLength: 60,
        }),
        (w, h, seed, keep, connectivity, moves) => {
          const grid = createGrid(w, h);
          const rng = createRng(seed);
          const clues = Array.from(deriveClues(grid, generateLoop(grid, rng)), (k) =>
            k < 4 && rng.float() < keep ? k : NO_CLUE,
          );
          const p = createPuzzle(w, h, clues);
          const trailed = new Engine(p, budget(), { connectivity });
          const rebuilt = new Engine(p, budget(), { connectivity });
          rebuilt.steps = [];
          expect(trailed.solveRoot(false)).toBe(true);
          expect(rebuilt.solveRoot(false)).toBe(true);
          expect(trailed.edges).toEqual(rebuilt.edges);
          const marks: [Mark, Mark][] = [];
          const back = () => {
            const [a, b] = marks.pop() as [Mark, Mark];
            trailed.undo(a);
            rebuilt.undo(b);
            expect(trailed.edges).toEqual(rebuilt.edges);
          };
          for (const [undo, pick, line] of moves) {
            if (undo === 0 || trailed.closed) {
              if (marks.length > 0) back();
              continue;
            }
            const open = [...trailed.edges.keys()].filter(
              (e) => trailed.edges[e] === EdgeState.Unknown,
            );
            if (open.length === 0) break;
            const e = open[pick % open.length];
            const state = line ? EdgeState.Line : EdgeState.Cross;
            marks.push([trailed.mark(), rebuilt.mark()]);
            const ok = trailed.set(e, state) && trailed.propagate(false);
            expect(rebuilt.set(e, state) && rebuilt.propagate(false)).toBe(ok);
            if (ok) expect(trailed.edges).toEqual(rebuilt.edges);
            else back();
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  test("without steps or the connectivity group the root's disconnected board is still found, after lookahead", () => {
    // A ring of 0s walls the middle off from a 1 outside it; tier 1 does not see that. The detect-only
    // check waits until lookahead has found nothing (DECISIONS, WT19), but still rejects the root,
    // so the verifier stops before searching.
    const rows = [
      "....1....",
      ".0000000.",
      ".0.....0.",
      ".0.....0.",
      ".0..2..0.",
      ".0.....0.",
      ".0.....0.",
      ".0000000.",
      ".........",
    ];
    const p = puzzle(9, 9, rows.join(""));
    const budget = new Budget(Date.now, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const engine = new Engine(p, budget, { connectivity: false });
    expect(engine.local()).toBe(true);
    expect(engine.solveRoot(true)).toBe(false);
    expect(engine.probes).toBeGreaterThan(0);
    const v = verify(p);
    expect(v.status).toBe("none");
    expect(v.stats.nodes).toBe(0);
  });
});
