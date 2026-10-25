# WT5 `web-large-grids` — implementation plan

Branch `feat/web-large-grids` (based on main `0144139`, which includes WT2's solver and verifier), worktree `/home/jhonnold/projects/loophole-wt/web-large-grids`. PRD: FR-13 (44 px touch targets, pinch-zoom and pan for large grids), NFR-2 (360 px with no sideways scroll, 60 fps drawing up to 30×30, canvas and viewport culling for large grids), NFR-5 (keyboard play), FR-15/FR-16/FR-17 (errors, themes and the solved look must survive on the new renderer).

## Goal

Boards whose cells would come out smaller than the minimum (44 px on touch screens, 24 px with a mouse) stop shrinking and zoom instead, as on the Night artboard (`docs/design/Night.dc.html`):

- The board's viewport takes the height left on the screen (never its own size) and opens at the minimum cell size. Two fingers pinch to zoom and pan; one finger still taps and draws. Ctrl/⌘ + wheel (and trackpad pinch) zooms around the pointer; the wheel and two-finger trackpad scroll pan. `−` / `%` / `+` buttons sit at the board's bottom right; `+`, `=` and `-` zoom from the keyboard. The keyboard cursor pans the board to keep its edge in view and out from under the overlays. The board can be pulled a little past its corners, so no edge stays hidden under the overview map or the zoom controls.
- An 88 px overview map at the board's top left shows the drawn lines and a dashed ai box for the part on screen; tapping or dragging on it moves the view there.
- Boards wider or taller than 30 draw on a `<canvas>` (device-pixel-ratio aware, culled to the viewport) with the SVG board's look in both themes: lines, dashed shu premature loop, crosses, dots, clues, error rings, solved wash; the 完 seal is the same HTML element as before. Boards up to 30×30 keep the SVG renderer.
- Both renderers sit under one input surface that uses the existing geometry (`edgeAt`, `dotAt`, `PointerGesture`) on the zoomed layout, so taps, drags and the keyboard behave identically on both.
- Four large practice fixtures (20×20, 30×30, 40×40, 100×100) for layout and performance work; the fixture test proves every fixture unique with core's `verify`.
- Unit tests for the viewport math, culling, zoom clamping, pointer sorting and the canvas painter; Playwright tests at 360×560 and on a desktop for pinch, two-finger pan, drawing on zoomed SVG and canvas boards, the overview map, the zoom buttons, wheel zoom and the keyboard cursor; a frame-time check (`bun run test:perf`) outside the gate.

Follow-ups from earlier reviews handled here:

- **[WT5] boards wider than 7 on phones get cells under 44 px** (web-board plan review #3): a 10×10 on a 360 px phone now opens at 44 px cells in a zoomable viewport instead of 30 px cells (Step 5, e2e "a 10×10 opens zoomed to 44px cells").
- **[WT5] board keys during a pointer gesture** (web-board code review 2 #1): `BoardView` ignores Space/Enter/X/Backspace/Delete/arrows/zoom keys while a pointer stroke is held, so a keyboard edit never merges with the stroke's undo step (Step 5, e2e "board keys wait while a mouse stroke is held").

Out of scope: hint highlighting on the board (WT8), the editor (WT10), saving the zoom across reloads, rotating or non-square special cases beyond what the math already handles, a generator (WT3).

## How later worktrees use this

- **WT6 API client**: nothing changes for the board; `PuzzleSource` is untouched. The large fixtures stay in the fixture source until the API replaces it; keep `giant-100` reachable (for example as a dev-only fixture) so `bun run test:perf` keeps a 100×100 board.
- **WT8 hints**: draw hint washes and ghost edges in both renderers: in `BoardSvg.svelte` inside the transformed `<g>` (under the lines, using the `geo` layout), and in `paint.ts` as an extra pass before the lines (add a `hint` field to `Scene`). To bring a hint into view on a zoomed board, call `revealRect` with the hint's bounding box and pass the result to `onview`, as `BoardView.reveal` does for the cursor.
- **WT10 editor**: reuse `BoardView` as is. It needs `layout`, `view`, `port` and `zoom`; copy the `frame` computation and the `zoom` stage CSS from `PlayScreen` (fit, or zoom when `fitted.cell < minCell`, with a port sized from the screen, not the board). For clue editing, add a cell hit-test next to `edgeAt` in `geometry.ts` and feed it the same board coordinates (`local point + view offset`).
- **WT11 daily sizes 7/10/20/40**: 7×7 fits on every phone; 10×10 and 20×20 zoom on phones with SVG; 40×40 zooms with the canvas everywhere. Nothing to add.

## Design

### When a board zooms

`PlayScreen` still computes `fitted = fitLayout(...)` exactly as before. If `fitted.cell >= minCell` the board is fixed: nothing changes from WT4 (same size, same margins, view at (0, 0)). Otherwise it is zoomable:

- Whether a board zooms depends only on the width (`fitLayout` drops below `minCell` only when the width forces it), so switching the stage's CSS for zoomable boards can't feed back into the decision.
- `port` (the visible box) must not depend on the board's own size, or it could only ever grow. For zoomable boards the stage gets class `zoom`: on phones it is `flex: 1 1 0` (it takes the space between the status line and the notes and tray; the spacer is hidden) with a floor of `5·minCell` px, and the frame is absolutely positioned inside it so it never sizes the stage; on desktops (≥ 900 px) the stage's height is the window's height minus the header metrics (`--screen-top`, `--bar-height`, `--screen-gap`, `--screen-bottom`, custom properties that the header and screen rules themselves now use, so a header change can't silently break it). On phones `.notes` keeps a 68 px minimum on zoomable boards (one error card), so the board's height doesn't change when the first error appears or clears. `port = (stageWidth − 4) × (stageHeight − 4)`. When a second kind of error shows, or the window is resized, the port shrinks or grows; the view keeps its offset (re-clamped), so the board doesn't move under a finger.
- `zoomLimits(grid, port)`: smallest cell = the whole board fits in `port`; largest = 88 px (twice the touch minimum).
- Overscroll: `clampView` lets the board be pulled past its top-left corner by up to 104 px (`OVERSCROLL_START`) and past its bottom-right corner by up to 68 px (`OVERSCROLL_END`), the space the overview map and the zoom controls cover, but never by more than the board overflows the viewport on that axis. So every edge can be panned into the open and tapped once the board overflows by the band (zoom in a step if it doesn't), the overscroll fades out as the board approaches fitting, and at the smallest zoom the whole board is on screen; a board that fits is centred.
- The view opens at `cell = minCell`, top-left corner (`x = y = 0`), clamped. The player's last view is kept in `PlayScreen` state, so it survives pausing (the board unmounts while paused) and is re-clamped when the stage changes size.
- Zooming out below 44 px is allowed (to look at the whole board); taps and drags still work there, using the same nearest-edge diamonds. Below 8 px cells the canvas leaves out clue digits, which would be under 5 px tall.

### Coordinates: one model for both renderers

`View = { cell, x, y }`: the cell size, and the viewport's top-left corner in **board pixels at that cell size**. `viewLayout(grid, cell)` gives the whole board's `Layout` at that size with margin `max(10, 0.34·cell)`. For every pointer event, board point = viewport point + `(view.x, view.y)`, which goes to the unchanged `PointerGesture`/`edgeAt`/`dotAt` with `viewLayout(grid, view.cell)`. A fixed board uses its `fitLayout` layout and `view = { cell, x: 0, y: 0 }`, so the same code serves both.

All zoom and pan moves are `anchorView`: zoom to a cell size and move the board so the point that was under one viewport point lands under another. `zoomAround` (wheel, buttons, keys), `panBy` (wheel) and `pinchView` (two fingers: scale by the finger distance, follow the midpoint) are thin wrappers. `clampView` keeps the cell in range and the board covering the viewport (or centred when smaller).

### Renderers

- **SVG (≤ 30×30)**: `BoardSvg` lays out its marks with margin 0 at `drawn`, the cell size the zoom last settled on, inside one `<g transform="translate(margin − x, margin − y) scale(cell / drawn)">`. While a pinch or wheel zoom runs only that attribute changes; 150 ms after the zoom stops, `drawn` catches up and the marks are laid out again at the kit's sizes for the new cell. This keeps pinch-zoom of a 30×30 SVG cheap (one attribute per frame instead of thousands). Panning never re-lays out. On a fixed board the transform is `translate(margin, margin) scale(1)`, so the output matches WT4.
- **Canvas (> 30 wide or tall)**: `BoardCanvas` paints with `paintBoard` in `requestAnimationFrame`, at most once per frame, at `devicePixelRatio`. `paintBoard` draws only `visibleCells(...)` (the cells overlapping the viewport plus a one-cell border) and batches each kind of mark into one path. Colours come from the stylesheet's custom properties, read when painting; a `MutationObserver` on `data-theme`, a `prefers-color-scheme` listener and the clue font's load trigger a repaint.
- Mark sizes for both come from one function, `markSizes(cell)` (design kit, Board), which caps dots and lines at 0.4 of a cell so a far-zoomed board isn't a blob (no effect from 10 px cells up).
- The keyboard cursor capsule is an overlay `<svg>` in viewport coordinates over either renderer; its label stays an HTML tip as before.

### Input

- `BoardView` owns one focusable `role="application"` surface (a `div`) holding the renderer. It exposes `data-cell`, `data-margin`, `data-x`, `data-y` (current geometry) for tests, since a canvas has no DOM marks.
- `BoardPointers` sorts pointers: the first pointer draws (`PointerGesture`, as in WT4). On a zoomable board a second **touch** pointer turns the gesture into a pinch: the stroke is cancelled (a tap never fires; edges a stroke already drew stay drawn, since a pinch normally starts before the first finger has moved past the slop), and both fingers zoom and pan until every finger is up. Third fingers are ignored. Mouse pointers never pinch.
- Locked (solved) boards still pinch, wheel and pan; only drawing is locked. They leave the Tab order (as in WT4), so they take no keys, and the `+ / −` row of the keyboard help is hidden once solved. Paused boards are hidden, as before.
- Wheel: added with `{ passive: false }` (Svelte makes `onwheel` passive). It always calls `preventDefault()` over a zoomable board (so the page never scrolls or zooms under it) and does nothing else while a stroke is held.
- Keys: `+`/`=` zoom in, `-` zooms out, around the cursor's edge. Arrows move the cursor and pan to keep the edge plus half a cell around it on screen and out from under the overview map (moved right or down, whichever is shorter) and the zoom controls (moved up) (`revealRect`). Keyboard focus (Tab) does the same for the cursor's starting edge. Board keys are ignored while a stroke is held.

### Overview map

`MiniMap` (88 px box, 4 px padding, Night artboard): a small canvas with the drawn lines only, a dashed ai rectangle from `miniRect`, `role="img"` with the artboard's label. Pointer down/move on it calls `miniJump` (centre the view on that board point). It is a sibling of the input surface, so its taps never draw. Keyboard players don't need it: the cursor pans the board.

### Fixtures

`apps/web/scripts/large-fixtures.ts` grows a random cell region from the centre with core's seeded `createRng` (only adding a cell when the region's boundary stays one simple loop: its region neighbours form one run around it and none touches it only at a corner) to 50% of the board, takes the boundary as the loop and shows every clue. It writes `src/lib/puzzles/large-fixtures.ts` (clues) and `src/lib/test-support/large-solutions.ts` (solutions, tests only). The output is deterministic; the plan gives checksums (unchanged on the new main). `fixtures.test.ts` checks that each known solution solves its puzzle and, with core's `verify` (node budget, no time limit), that every fixture has exactly one solution; the rules alone solve the large ones with no search.

### Performance check

`tests/perf.e2e.ts` (tagged `@perf`) slows the CPU 4× through CDP and records `requestAnimationFrame` intervals while (1) drawing a stroke back and forth on the zoomed 30×30 SVG board at 390×664 and (2) pinching and panning the 100×100 canvas board. It asserts p95 < 20 ms and worst < 50 ms, checks the stroke really drew lines, and prints the numbers. `bun run test:e2e` skips it (`--grep-invert @perf`); `bun run test:perf` runs it. It is outside the gate because frame timing depends on the machine.

## Environment notes for the implementer

- Run `export PATH="$HOME/.bun/bin:$PATH"` in every shell. Work in `/home/jhonnold/projects/loophole-wt/web-large-grids`.
- Chromium for `@playwright/test` 1.62.1 is installed. Port 4173 must be free for the e2e tests (`ss -ltnp | grep 4173`; kill a leftover `vite preview`).
- Another worktree (`core-solver`) is editing `packages/core`. **Do not touch `packages/core`.** No new dependencies.
- `.svelte` files are linted by Biome (including import sorting) but not formatted. Copy component code exactly as given. `bun run format` rewrites `.ts`/`.json` only.
- Create every file with exactly the content shown. "Replace" means replace the whole file.
- Run `bun run check` after every step; it must pass before the commit. The e2e steps also need `bun run test:e2e`.

## Steps

### Step 1 — large layout and performance fixtures

1. Create `apps/web/scripts/large-fixtures.ts`:

```ts
/**
 * Writes the large layout and performance fixtures (docs/DECISIONS.md, WT5): for each size, grows and
 * reshapes a random cell region with a seeded generator, takes its boundary as the loop and shows
 * every clue. Output is deterministic. Run from the repo root:
 *
 *   bun apps/web/scripts/large-fixtures.ts && bun run format
 */
import {
  createGrid,
  createRng,
  deriveClues,
  EdgeState,
  encodeEdges,
  type Grid,
} from "@loophole/core";

interface Spec {
  readonly id: string;
  readonly name: string;
  readonly size: number;
}

const SPECS: readonly Spec[] = [
  { id: "large-20", name: "Large", size: 20 },
  { id: "big-30", name: "Big", size: 30 },
  { id: "huge-40", name: "Huge", size: 40 },
  { id: "giant-100", name: "Giant", size: 100 },
];

/**
 * True when moving cell (r, c) into or out of the region keeps the region's boundary one simple
 * loop. Moving it joins the cell to the other side, so among its eight neighbours the other side's
 * cells (off the board counts as outside) must form exactly one run that includes a side
 * neighbour, and none may touch it only at a corner.
 */
function canFlip(inside: Uint8Array, W: number, H: number, r: number, c: number): boolean {
  const other = 1 - inside[r * W + c];
  const at = (rr: number, cc: number) =>
    rr >= 0 && rr < H && cc >= 0 && cc < W ? inside[rr * W + cc] === other : other === 0;
  // Clockwise from the top: N, NE, E, SE, S, SW, W, NW.
  const ring = [
    at(r - 1, c),
    at(r - 1, c + 1),
    at(r, c + 1),
    at(r + 1, c + 1),
    at(r + 1, c),
    at(r + 1, c - 1),
    at(r, c - 1),
    at(r - 1, c - 1),
  ];
  for (let i = 1; i < 8; i += 2) {
    if (ring[i] && !ring[i - 1] && !ring[(i + 1) % 8]) return false;
  }
  if (!ring[0] && !ring[2] && !ring[4] && !ring[6]) return false;
  let runs = 0;
  for (let i = 0; i < 8; i++) if (ring[i] && !ring[(i + 7) % 8]) runs++;
  return runs === 1;
}

function loopEdges(grid: Grid, inside: Uint8Array): Uint8Array {
  const edges = new Uint8Array(grid.edgeCount).fill(EdgeState.Cross);
  for (let e = 0; e < grid.edgeCount; e++) {
    const a = grid.edgeCells[e * 2];
    const b = grid.edgeCells[e * 2 + 1];
    const ia = a >= 0 ? inside[a] : 0;
    const ib = b >= 0 ? inside[b] : 0;
    if (ia !== ib) edges[e] = EdgeState.Line;
  }
  return edges;
}

function make(spec: Spec) {
  const W = spec.size;
  const H = spec.size;
  const grid = createGrid(W, H);
  const rng = createRng(`loophole-fixture-${spec.id}`);
  const inside = new Uint8Array(W * H);
  inside[Math.floor(H / 2) * W + Math.floor(W / 2)] = 1;
  let count = 1;
  // Grow to half the board, then keep adding and removing random boundary cells while between 40%
  // and 60% of the board is inside, so the loop wanders over the whole board.
  for (let step = 0; step < W * H * 60; step++) {
    const cell = rng.int(W * H);
    const adding = inside[cell] === 0;
    const grown = step >= W * H * 20;
    if (adding ? count >= W * H * (grown ? 0.6 : 0.5) : !grown || count <= W * H * 0.4) continue;
    if (!canFlip(inside, W, H, Math.floor(cell / W), cell % W)) continue;
    inside[cell] = adding ? 1 : 0;
    count += adding ? 1 : -1;
  }
  const edges = loopEdges(grid, inside);
  const clues = Array.from(deriveClues(grid, edges), (n) => String(n)).join("");
  return { spec, clues, solution: encodeEdges(edges) };
}

const made = SPECS.map(make);

const fixtures = `import type { FixtureRecord } from "./fixtures.ts";

/**
 * Large layout and performance fixtures, written by \`apps/web/scripts/large-fixtures.ts\`: each is
 * the boundary of a random region with every clue shown. Do not edit by hand.
 */
export const LARGE_FIXTURES: readonly FixtureRecord[] = [
${made
  .map(
    (m) => `  {
    id: "${m.spec.id}",
    name: "${m.spec.name}",
    subtitle: "Practice · 練習",
    wire: {
      v: 1,
      width: ${m.spec.size},
      height: ${m.spec.size},
      clues:
        "${m.clues}",
    },
  },`,
  )
  .join("\n")}
];
`;

const solutions = `/**
 * Solutions of the large fixtures, written by \`apps/web/scripts/large-fixtures.ts\`. Tests only.
 */
export const LARGE_SOLUTIONS: Readonly<Record<string, string>> = {
${made.map((m) => `  "${m.spec.id}":\n    "${m.solution}",`).join("\n")}
};
`;

await Bun.write("apps/web/src/lib/puzzles/large-fixtures.ts", fixtures);
await Bun.write("apps/web/src/lib/test-support/large-solutions.ts", solutions);
console.log(made.map((m) => `${m.spec.id}: ${m.clues.length} clues`).join("\n"));
```

2. In `apps/web/tsconfig.test.json`, add `"scripts"` to `include` so the script is type-checked with Bun's types. Replace

```json
  "include": ["src/**/*.ts", "tests", "playwright.config.ts"],
```

with

```json
  "include": ["src/**/*.ts", "tests", "scripts", "playwright.config.ts"],
```

3. In `apps/web/src/lib/puzzles/fixtures.ts`:
   - Replace

```ts
import type { PuzzleEntry, PuzzleSource, PuzzleSummary } from "./source.ts";

interface FixtureRecord {
```

   with

```ts
import { LARGE_FIXTURES } from "./large-fixtures.ts";
import type { PuzzleEntry, PuzzleSource, PuzzleSummary } from "./source.ts";

export interface FixtureRecord {
```

   - Replace

```ts
 * one on the Play artboard and the 10×10 the one on the Night and Desktop artboards.
 */
```

   with

```ts
 * one on the Play artboard and the 10×10 the one on the Night and Desktop artboards. The large
 * ones (20×20 to 100×100) are for layout and performance work and show every clue.
 */
```

   - At the end of the `FIXTURES` array, after the `medium-10` entry's closing `},` and before `];`, add the line `  ...LARGE_FIXTURES,`.

4. In `apps/web/src/lib/test-support/solutions.ts`: add `import { LARGE_SOLUTIONS } from "./large-solutions.ts";` plus a blank line as the first lines of the file, and add the line `  ...LARGE_SOLUTIONS,` as the last entry of `FIXTURE_SOLUTIONS` (after the `medium-10` entry, before `};`).

5. Generate the fixtures from the repo root and check the output:

```sh
bun apps/web/scripts/large-fixtures.ts
sha256sum apps/web/src/lib/puzzles/large-fixtures.ts apps/web/src/lib/test-support/large-solutions.ts
```

It prints `large-20: 400 clues`, `big-30: 900 clues`, `huge-40: 1600 clues`, `giant-100: 10000 clues`, and the checksums must be:

```
c2b79fe401548e04eae8a9cf5fa3bdbd040b0fadb9d1338e7ccb500dd7eed766  apps/web/src/lib/puzzles/large-fixtures.ts
d249417bcf0301f37f3bd736e5343dce20db9273b8e97cf40e1c12d6708f8a6e  apps/web/src/lib/test-support/large-solutions.ts
```

If they differ, the script was not copied exactly (or `packages/core`'s `createRng`/`deriveClues`/`encodeEdges` changed); fix the script, do not edit the generated files. The existing fixture test (`fixtures.test.ts`) now also checks that each large solution solves its puzzle.

6. In `apps/web/src/lib/puzzles/fixtures.test.ts`, check that every fixture (old and new) has exactly one solution with core's `verify` (on main since WT2). Replace

```ts
import { analyzeBoard, decodeEdges } from "@loophole/core";
```

with

```ts
import { analyzeBoard, decodeEdges, verify } from "@loophole/core";
```

and insert this test directly above `  test("list matches the fixtures and get returns null for unknown ids", …`:

```ts
  test("every fixture has exactly one solution", async () => {
    for (const f of FIXTURES) {
      const entry = await fixtureSource.get(f.id);
      if (entry === null) throw new Error(`missing ${f.id}`);
      expect([f.id, verify(entry.puzzle, { maxNodes: 100_000 }).status]).toEqual([f.id, "unique"]);
    }
  });

```

(A node budget, not a time limit, keeps the result the same on every machine; the whole test takes about 50 ms.)

Verify: `bun test apps/web/src/lib/puzzles` passes (4 tests); `bun run check` passes; `bun run format` changes nothing.

Commit: `feat(web): add large layout and performance fixtures`

### Step 2 — mark sizes and viewport math

1. In `apps/web/src/lib/game/geometry.ts`:
   - Replace

```ts
 * puzzle on a narrow screen gets smaller cells than `minCell`; pinch-zoom for those comes later.
```

   with

```ts
 * puzzle on a narrow screen gets smaller cells than `minCell`; the play screen zooms those instead
 * (`viewport.ts`).
```

   - Insert this block directly above the doc comment of `minBoardHeight` (the line starting `/** The height a board needs`):

```ts
/** Sizes of the board's marks at cell size S (design kit, Board), shared by both renderers. */
export interface MarkSizes {
  /** Line thickness. */
  readonly line: number;
  readonly dotRadius: number;
  /** Half the width of a cross. */
  readonly crossArm: number;
  readonly crossWidth: number;
  /** Clue font size. */
  readonly clue: number;
  /** Radius of the error ring around a clue. */
  readonly clueRing: number;
  /** Radius of the error ring around a dot. */
  readonly dotRing: number;
}

/**
 * Mark sizes for cell size `cell`. Dots and lines never take more than 0.4 of a cell, so a board
 * zoomed far out stays readable; from 10px cells up that cap never applies.
 */
export function markSizes(cell: number): MarkSizes {
  return {
    line: Math.min(Math.max(2, Math.round(cell * 0.11)), cell * 0.4),
    dotRadius: Math.min(Math.max(4, Math.round(cell * 0.11)), cell * 0.4) / 2,
    crossArm: cell * 0.1,
    crossWidth: Math.max(1.5, cell * 0.05),
    clue: cell * 0.56,
    clueRing: cell * 0.34 - 1,
    dotRing: cell * 0.26 - 1,
  };
}
```

2. In `apps/web/src/lib/game/geometry.test.ts`, add `markSizes,` to the import list from `./geometry.ts` (between `type Layout,` and `minBoardHeight,`), and append at the end of the file:

```ts
describe("markSizes", () => {
  test("follow the design kit at 46px cells", () => {
    const s = markSizes(46);
    expect(s.line).toBe(5);
    expect(s.dotRadius).toBe(2.5);
    expect(s.clue).toBeCloseTo(25.76, 9);
  });

  test("dots and lines stay within 0.4 of a tiny cell", () => {
    const s = markSizes(4);
    expect(s.line).toBeCloseTo(1.6, 9);
    expect(s.dotRadius).toBeCloseTo(0.8, 9);
  });
});
```

3. Create `apps/web/src/lib/game/viewport.ts`:

```ts
import type { Grid } from "@loophole/core";
import { type Layout, MIN_MARGIN, type Point } from "./geometry.ts";

/**
 * The part of a zoomable board on screen: the cell size, and where the viewport's top-left corner
 * sits on the board, in board pixels at that cell size. A negative offset means the board is
 * narrower than the viewport and is centred in it.
 */
export interface View {
  readonly cell: number;
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Smallest and largest cell size while zooming. */
export interface ZoomLimits {
  readonly min: number;
  readonly max: number;
}

/** Largest cell when zoomed in: twice the touch minimum. */
export const ZOOM_MAX_CELL = 88;
/** Zoom factor of one press of the +/− buttons or keys. */
export const ZOOM_STEP = 1.25;
/** Boards wider or taller than this draw on a canvas instead of SVG (NFR-2). */
export const SVG_MAX_SIZE = 30;
/** Outer size of the overview map (Night artboard). */
export const MINI_BOX = 88;
/**
 * How far the board may be pulled past its top-left and bottom-right corners, so the edges under
 * the overview map (top left: 8px inset, 88px box, borders) and the zoom controls (bottom right:
 * 44px buttons, padding, borders, 8px inset) can be brought into the open and tapped.
 */
export const OVERSCROLL_START = MINI_BOX + 16;
export const OVERSCROLL_END = 68;
/** Width of the corner the zoom controls cover, from the viewport's right edge. */
export const ZOOM_CONTROLS_WIDTH = 168;

/** Paper border around the dots of a zoomable board. */
export function viewMargin(cell: number): number {
  return Math.max(MIN_MARGIN, cell * 0.34);
}

/** The whole board's pixel layout at cell size `cell`. */
export function viewLayout(grid: Grid, cell: number): Layout {
  const margin = viewMargin(cell);
  return {
    cell,
    margin,
    width: grid.width * cell + 2 * margin,
    height: grid.height * cell + 2 * margin,
  };
}

/** The largest cell for `n` cells plus margins in `length` pixels. */
function fitAlong(n: number, length: number): number {
  return Math.min((length - 2 * MIN_MARGIN) / n, length / (n + 0.68));
}

/** Zooming goes from the whole board in `port` up to `ZOOM_MAX_CELL`. */
export function zoomLimits(grid: Grid, port: Size): ZoomLimits {
  const min = Math.max(
    1,
    Math.min(fitAlong(grid.width, port.width), fitAlong(grid.height, port.height)),
  );
  return { min, max: Math.max(min, ZOOM_MAX_CELL) };
}

function clampAxis(offset: number, content: number, port: number): number {
  const over = content - port;
  if (over <= 0) return over / 2;
  // The overscroll grows with the overflow, so a board that only just overflows (such as one
  // zoomed nearly all the way out) still shows whole.
  const lo = -Math.min(OVERSCROLL_START, over);
  const hi = over + Math.min(OVERSCROLL_END, over);
  return Math.min(Math.max(offset, lo), hi);
}

/**
 * Keeps the cell size within `limits` and the board over the viewport, give or take the overscroll
 * at each end. A board that fits the viewport is centred in it.
 */
export function clampView(grid: Grid, view: View, port: Size, limits: ZoomLimits): View {
  const cell = Math.min(Math.max(view.cell, limits.min), limits.max);
  const l = viewLayout(grid, cell);
  return {
    cell,
    x: clampAxis(view.x, l.width, port.width),
    y: clampAxis(view.y, l.height, port.height),
  };
}

/**
 * Zooms to `cell` and moves the board so that the board point under `from` (viewport pixels) ends
 * up under `to`. Zoom, pan and pinch are all this one move.
 */
export function anchorView(
  grid: Grid,
  view: View,
  cell: number,
  from: Point,
  to: Point,
  port: Size,
  limits: ZoomLimits,
): View {
  const target = Math.min(Math.max(cell, limits.min), limits.max);
  const before = viewMargin(view.cell);
  const after = viewMargin(target);
  // The point under `from`, in cells from the top-left dot.
  const u = (from.x + view.x - before) / view.cell;
  const v = (from.y + view.y - before) / view.cell;
  return clampView(
    grid,
    { cell: target, x: after + u * target - to.x, y: after + v * target - to.y },
    port,
    limits,
  );
}

/** Zooms to `cell`, keeping the board point under `at` where it is. */
export function zoomAround(
  grid: Grid,
  view: View,
  cell: number,
  at: Point,
  port: Size,
  limits: ZoomLimits,
): View {
  return anchorView(grid, view, cell, at, at, port, limits);
}

/** Moves the board by (dx, dy) viewport pixels, as when dragging it. */
export function panBy(
  grid: Grid,
  view: View,
  dx: number,
  dy: number,
  port: Size,
  limits: ZoomLimits,
): View {
  return anchorView(grid, view, view.cell, { x: 0, y: 0 }, { x: dx, y: dy }, port, limits);
}

/**
 * Two-finger pinch: from the view when the second finger landed (`start`, fingers at `a0` and
 * `b0`) to the fingers now at `a1` and `b1`. The cell size follows the distance between the fingers
 * and the board follows their midpoint.
 */
export function pinchView(
  grid: Grid,
  start: View,
  a0: Point,
  b0: Point,
  a1: Point,
  b1: Point,
  port: Size,
  limits: ZoomLimits,
): View {
  const d0 = Math.max(1, Math.hypot(b0.x - a0.x, b0.y - a0.y));
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  return anchorView(grid, start, (start.cell * d1) / d0, m0, m1, port, limits);
}

function revealAxis(offset: number, start: number, length: number, port: number): number {
  if (start < offset || length > port) return start;
  if (start + length > offset + port) return start + length - port;
  return offset;
}

/**
 * The smallest pan that brings `rect` (board pixels) fully into the viewport and out from under
 * the overview map (top-left `OVERSCROLL_START` square: moved right or down, whichever is shorter)
 * and the zoom controls (bottom-right `ZOOM_CONTROLS_WIDTH` × `OVERSCROLL_END`: moved up).
 */
export function revealRect(
  grid: Grid,
  view: View,
  rect: Rect,
  port: Size,
  limits: ZoomLimits,
): View {
  let x = revealAxis(view.x, rect.x, rect.width, port.width);
  let y = revealAxis(view.y, rect.y, rect.height, port.height);
  const left = rect.x - x;
  const top = rect.y - y;
  if (left < OVERSCROLL_START && top < OVERSCROLL_START) {
    const dx = OVERSCROLL_START - left;
    const dy = OVERSCROLL_START - top;
    if (dx <= dy) x -= dx;
    else y -= dy;
  }
  const below = top + rect.height - (port.height - OVERSCROLL_END);
  if (left + rect.width > port.width - ZOOM_CONTROLS_WIDTH && below > 0) y += below;
  return clampView(grid, { cell: view.cell, x, y }, port, limits);
}

/** Cells to draw, inclusive. Empty when `r1 < r0` or `c1 < c0`. */
export interface CellRange {
  readonly r0: number;
  readonly r1: number;
  readonly c0: number;
  readonly c1: number;
}

/**
 * The cells that touch the viewport, plus one more on each side so that lines, dots and rings
 * reaching over a cell border are drawn too (viewport culling).
 */
export function visibleCells(grid: Grid, layout: Layout, view: View, port: Size): CellRange {
  const from = (offset: number) => Math.floor((offset - layout.margin) / layout.cell) - 1;
  return {
    r0: Math.max(0, from(view.y)),
    r1: Math.min(grid.height - 1, from(view.y + port.height) + 2),
    c0: Math.max(0, from(view.x)),
    c1: Math.min(grid.width - 1, from(view.x + port.width) + 2),
  };
}

const MINI_PAD = 4;

/** The board's layout on the overview map. */
export function miniLayout(grid: Grid): Layout {
  const cell = Math.min(
    (MINI_BOX - 2 * MINI_PAD) / grid.width,
    (MINI_BOX - 2 * MINI_PAD) / grid.height,
  );
  return {
    cell,
    margin: MINI_PAD,
    width: grid.width * cell + 2 * MINI_PAD,
    height: grid.height * cell + 2 * MINI_PAD,
  };
}

/** The part of the board on screen, as a rectangle on the overview map, clipped to the map. */
export function miniRect(view: View, port: Size, mini: Layout): Rect {
  const s = mini.cell / view.cell;
  const margin = viewMargin(view.cell);
  const x0 = Math.max(0, mini.margin + (view.x - margin) * s);
  const y0 = Math.max(0, mini.margin + (view.y - margin) * s);
  const x1 = Math.min(mini.width, mini.margin + (view.x + port.width - margin) * s);
  const y1 = Math.min(mini.height, mini.margin + (view.y + port.height - margin) * s);
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

/** The view centred on the board point under (x, y) on the overview map. */
export function miniJump(
  grid: Grid,
  view: View,
  x: number,
  y: number,
  mini: Layout,
  port: Size,
  limits: ZoomLimits,
): View {
  const u = (x - mini.margin) / mini.cell;
  const v = (y - mini.margin) / mini.cell;
  const margin = viewMargin(view.cell);
  return clampView(
    grid,
    {
      cell: view.cell,
      x: margin + u * view.cell - port.width / 2,
      y: margin + v * view.cell - port.height / 2,
    },
    port,
    limits,
  );
}
```

4. Create `apps/web/src/lib/game/viewport.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createGrid, dotIndex } from "@loophole/core";
import fc from "fast-check";
import { dotPoint } from "./geometry.ts";
import {
  anchorView,
  clampView,
  MINI_BOX,
  miniJump,
  miniLayout,
  miniRect,
  OVERSCROLL_END,
  OVERSCROLL_START,
  panBy,
  pinchView,
  revealRect,
  type View,
  viewLayout,
  viewMargin,
  visibleCells,
  ZOOM_MAX_CELL,
  zoomAround,
  zoomLimits,
} from "./viewport.ts";

const grid = createGrid(20, 20);
// A phone stage, 354 wide as on the Night artboard.
const port = { width: 354, height: 400 };
const limits = zoomLimits(grid, port);

/** Viewport position of dot (row, col). */
function onScreen(view: View, row: number, col: number) {
  const p = dotPoint(grid, viewLayout(grid, view.cell), dotIndex(grid, row, col));
  return { x: p.x - view.x, y: p.y - view.y };
}

describe("zoomLimits", () => {
  test("the smallest zoom shows the whole board", () => {
    const l = viewLayout(grid, limits.min);
    expect(l.width).toBeLessThanOrEqual(port.width + 1e-9);
    expect(l.height).toBeLessThanOrEqual(port.height + 1e-9);
    expect(Math.max(l.width / port.width, l.height / port.height)).toBeCloseTo(1, 9);
    expect(limits.max).toBe(ZOOM_MAX_CELL);
  });

  test("the whole board fits at the smallest zoom for any size", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 200, max: 2000 }),
        fc.integer({ min: 200, max: 2000 }),
        (w, h, pw, ph) => {
          const g = createGrid(w, h);
          const z = zoomLimits(g, { width: pw, height: ph });
          const l = viewLayout(g, z.min);
          if (z.min > 1) {
            expect(l.width).toBeLessThanOrEqual(pw + 1e-6);
            expect(l.height).toBeLessThanOrEqual(ph + 1e-6);
          }
          expect(z.max).toBeGreaterThanOrEqual(z.min);
        },
      ),
    );
  });
});

describe("viewMargin", () => {
  test("is at least 10px and a third of a cell", () => {
    expect(viewMargin(5)).toBe(10);
    expect(viewMargin(44)).toBeCloseTo(14.96, 9);
  });
});

describe("clampView", () => {
  test("keeps the cell size within the limits", () => {
    expect(clampView(grid, { cell: 500, x: 0, y: 0 }, port, limits).cell).toBe(ZOOM_MAX_CELL);
    expect(clampView(grid, { cell: 1, x: 0, y: 0 }, port, limits).cell).toBe(limits.min);
  });

  test("keeps the board over the viewport, give or take the overscroll", () => {
    const l = viewLayout(grid, 44);
    expect(clampView(grid, { cell: 44, x: -50, y: 30 }, port, limits)).toEqual({
      cell: 44,
      x: -50,
      y: 30,
    });
    expect(clampView(grid, { cell: 44, x: -9999, y: -9999 }, port, limits)).toEqual({
      cell: 44,
      x: -OVERSCROLL_START,
      y: -OVERSCROLL_START,
    });
    expect(clampView(grid, { cell: 44, x: 9999, y: 9999 }, port, limits)).toEqual({
      cell: 44,
      x: l.width - port.width + OVERSCROLL_END,
      y: l.height - port.height + OVERSCROLL_END,
    });
  });

  test("the overscroll pulls the corners clear of the overview map and zoom controls", () => {
    // Top left: the map covers 8…99px; bottom right: the controls reach 63px up from the bottom.
    expect(OVERSCROLL_START).toBeGreaterThanOrEqual(8 + MINI_BOX + 3);
    expect(OVERSCROLL_END).toBeGreaterThanOrEqual(8 + 44 + 2 * 4 + 3);
  });

  test("centres a board that fits the viewport", () => {
    const small = { min: 5, max: ZOOM_MAX_CELL };
    const v = clampView(grid, { cell: 5, x: 123, y: 456 }, port, small);
    const l = viewLayout(grid, 5);
    expect(v.x).toBeCloseTo((l.width - port.width) / 2, 9);
    expect(v.y).toBeCloseTo((l.height - port.height) / 2, 9);
  });

  test("the whole board is on screen at the smallest zoom, from any view", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        (w, h, x, y) => {
          const g = createGrid(w, h);
          const z = zoomLimits(g, port);
          const v = clampView(g, { cell: z.min, x, y }, port, z);
          const l = viewLayout(g, v.cell);
          if (z.min === 1) return; // the board can't fit at all
          expect(Math.min(-v.x, port.width - (l.width - v.x))).toBeGreaterThanOrEqual(-1e-6);
          expect(Math.min(-v.y, port.height - (l.height - v.y))).toBeGreaterThanOrEqual(-1e-6);
        },
      ),
    );
  });

  test("the overscroll shrinks with the overflow", () => {
    // 20 cells of 18px plus margins overflow the 354px viewport by 26px: the board may be pulled
    // only 26px past either corner, not the full overscroll.
    const l = viewLayout(grid, 18);
    const over = l.width - port.width;
    expect(over).toBeGreaterThan(0);
    expect(over).toBeLessThan(OVERSCROLL_END);
    expect(clampView(grid, { cell: 18, x: -999, y: 0 }, port, limits).x).toBeCloseTo(-over, 9);
    expect(clampView(grid, { cell: 18, x: 999, y: 0 }, port, limits).x).toBeCloseTo(2 * over, 9);
  });

  test("zooming out step by step ends with the whole board on screen", () => {
    let v = clampView(grid, { cell: 44, x: 0, y: 0 }, port, limits);
    while (v.cell > limits.min) {
      v = zoomAround(
        grid,
        v,
        v.cell / 1.25,
        { x: port.width / 2, y: port.height / 2 },
        port,
        limits,
      );
      // The corner is never pulled further than the board overflows the viewport (or, once it
      // fits, than centring it takes).
      const l = viewLayout(grid, v.cell);
      const most = (over: number) => (over > 0 ? over : -over / 2) + 1e-6;
      expect(-v.x).toBeLessThanOrEqual(most(l.width - port.width));
      expect(-v.y).toBeLessThanOrEqual(most(l.height - port.height));
    }
    const l = viewLayout(grid, v.cell);
    expect(v.x).toBeLessThanOrEqual(1e-6);
    expect(v.x + port.width).toBeGreaterThanOrEqual(l.width - 1e-6);
  });
});

describe("anchorView", () => {
  test("zoomAround keeps the point under the focus fixed", () => {
    const start = clampView(grid, { cell: 44, x: 100, y: 80 }, port, limits);
    const before = onScreen(start, 5, 5);
    const after = zoomAround(grid, start, 60, before, port, limits);
    expect(after.cell).toBe(60);
    const moved = onScreen(after, 5, 5);
    expect(moved.x).toBeCloseTo(before.x, 9);
    expect(moved.y).toBeCloseTo(before.y, 9);
  });

  test("panBy moves the board with the finger", () => {
    const start = clampView(grid, { cell: 44, x: 100, y: 80 }, port, limits);
    expect(panBy(grid, start, -30, 20, port, limits)).toEqual({ cell: 44, x: 130, y: 60 });
  });

  test("never leaves the view out of bounds", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 200, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        (cell, fx, tx) => {
          const start = clampView(grid, { cell: 44, x: 50, y: 50 }, port, limits);
          const v = anchorView(grid, start, cell, { x: fx, y: 0 }, { x: tx, y: 0 }, port, limits);
          expect(clampView(grid, v, port, limits)).toEqual(v);
        },
      ),
    );
  });
});

describe("pinchView", () => {
  test("spreading two fingers zooms around their midpoint", () => {
    const start = clampView(grid, { cell: 44, x: 100, y: 100 }, port, limits);
    const mid = { x: 150, y: 200 };
    const v = pinchView(
      grid,
      start,
      { x: 130, y: 200 },
      { x: 170, y: 200 },
      { x: 120, y: 200 },
      { x: 180, y: 200 },
      port,
      limits,
    );
    expect(v.cell).toBeCloseTo(66, 9);
    // The board point under the midpoint stays under it.
    const u = (mid.x + start.x - viewMargin(44)) / 44;
    expect(viewMargin(66) + u * 66 - v.x).toBeCloseTo(mid.x, 9);
  });

  test("moving two fingers together pans", () => {
    const start = clampView(grid, { cell: 44, x: 100, y: 100 }, port, limits);
    const v = pinchView(
      grid,
      start,
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 80, y: 90 },
      { x: 180, y: 90 },
      port,
      limits,
    );
    expect(v).toEqual({ cell: 44, x: 120, y: 110 });
  });
});

describe("revealRect", () => {
  test("pans just enough to show the rectangle", () => {
    const start = clampView(grid, { cell: 44, x: 0, y: 0 }, port, limits);
    const v = revealRect(grid, start, { x: 380, y: 10, width: 60, height: 20 }, port, limits);
    expect(v).toEqual({ cell: 44, x: 440 - port.width, y: 0 });
    // Back to the left: in view, but under the overview map, so it moves out to the right.
    expect(revealRect(grid, v, { x: 100, y: 10, width: 60, height: 20 }, port, limits).x).toBe(
      100 - OVERSCROLL_START,
    );
  });

  test("moves the rectangle out from under the overview map by the shorter way", () => {
    const start = clampView(grid, { cell: 44, x: 0, y: 0 }, port, limits);
    // 44px down clears it, 84px right would too: down it goes.
    expect(revealRect(grid, start, { x: 20, y: 60, width: 40, height: 20 }, port, limits)).toEqual({
      cell: 44,
      x: 0,
      y: 60 - OVERSCROLL_START,
    });
    expect(revealRect(grid, start, { x: 60, y: 20, width: 20, height: 40 }, port, limits)).toEqual({
      cell: 44,
      x: 60 - OVERSCROLL_START,
      y: 0,
    });
  });

  test("moves the rectangle up from under the zoom controls", () => {
    const start = clampView(grid, { cell: 44, x: 0, y: 0 }, port, limits);
    const v = revealRect(grid, start, { x: 300, y: 350, width: 40, height: 40 }, port, limits);
    expect(v).toEqual({ cell: 44, x: 0, y: 390 - (port.height - OVERSCROLL_END) });
  });

  test("leaves the view alone when the rectangle is on screen", () => {
    const start = clampView(grid, { cell: 44, x: 40, y: 40 }, port, limits);
    // On screen and clear of both overlays.
    expect(
      revealRect(grid, start, { x: 150, y: 150, width: 40, height: 40 }, port, limits),
    ).toEqual(start);
  });
});

describe("visibleCells", () => {
  test("covers the viewport plus one cell on each side, clamped to the board", () => {
    const g = createGrid(100, 100);
    const l = viewLayout(g, 44);
    // Margin 14.96: cells 4–12 touch x = 200…554 and rows 0–8 touch y = 0…400; one more each side.
    expect(visibleCells(g, l, { cell: 44, x: 200, y: 0 }, port)).toEqual({
      r0: 0,
      r1: 9,
      c0: 3,
      c1: 13,
    });
    expect(visibleCells(g, l, { cell: 44, x: 0, y: 0 }, { width: 99999, height: 99999 })).toEqual({
      r0: 0,
      r1: 99,
      c0: 0,
      c1: 99,
    });
  });

  test("every cell overlapping the viewport is in the range", () => {
    const g = createGrid(100, 100);
    fc.assert(
      fc.property(
        fc.double({ min: 5, max: 88, noNaN: true }),
        fc.double({ min: 0, max: 8000, noNaN: true }),
        fc.double({ min: 0, max: 8000, noNaN: true }),
        (cell, x, y) => {
          const l = viewLayout(g, cell);
          const r = visibleCells(g, l, { cell, x, y }, port);
          for (let c = 0; c < g.width; c++) {
            const left = l.margin + c * cell - x;
            const overlaps = left < port.width && left + cell > 0;
            if (overlaps) expect(c >= r.c0 && c <= r.c1).toBe(true);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("overview map", () => {
  test("fits the board in 88px", () => {
    const mini = miniLayout(createGrid(100, 100));
    expect(mini.width).toBeCloseTo(88, 9);
    expect(mini.cell).toBeCloseTo(0.8, 9);
  });

  test("shows the viewport as a rectangle and jumps to a tapped point", () => {
    const mini = miniLayout(grid);
    const view = clampView(grid, { cell: 44, x: 0, y: 0 }, port, limits);
    const rect = miniRect(view, port, mini);
    // Map pixels per board pixel.
    const s = mini.cell / 44;
    expect(rect.x).toBeCloseTo(mini.margin - viewMargin(44) * s, 9);
    expect(rect.y).toBeCloseTo(rect.x, 9);
    expect(rect.width).toBeCloseTo(port.width * s, 9);
    expect(rect.height).toBeCloseTo(port.height * s, 9);
    // Tapping the centre of the map centres the board.
    const v = miniJump(grid, view, mini.width / 2, mini.height / 2, mini, port, limits);
    const l = viewLayout(grid, 44);
    expect(v.x).toBeCloseTo((l.width - port.width) / 2, 9);
    expect(v.y).toBeCloseTo((l.height - port.height) / 2, 9);
  });
});
```

Verify: `bun test apps/web/src/lib/game` passes; `bun run check` passes.

Commit: `feat(web): add zoom and pan viewport math`

### Step 3 — sort pointers into drawing and pinching

1. Create `apps/web/src/lib/game/pointers.ts`:

```ts
import type { Grid } from "@loophole/core";
import type { Point } from "./geometry.ts";
import { pinchView, type Size, type View, type ZoomLimits } from "./viewport.ts";

/**
 * Sorts the pointers on the board into drawing and zooming (FR-13). The first finger draws. A
 * second finger, on a zoomable board, turns the gesture into a two-finger pinch that zooms and pans
 * until every finger is up; the caller then cancels the drawing gesture. Further fingers are
 * ignored. Points are in viewport pixels.
 */
export class BoardPointers {
  private readonly points = new Map<number, Point>();
  private mode: "idle" | "draw" | "zoom" | "rest" = "idle";
  private start: { view: View; a: Point; b: Point } | null = null;

  /** True while one finger (or the mouse) is drawing. */
  get drawing(): boolean {
    return this.mode === "draw";
  }

  /**
   * A pointer went down. Returns "draw" when it starts a drawing gesture, "zoom" when it turns the
   * gesture into a pinch, or null when it is ignored.
   */
  down(id: number, p: Point, view: View, canZoom: boolean): "draw" | "zoom" | null {
    if (this.mode === "idle") {
      this.points.set(id, p);
      this.mode = "draw";
      return "draw";
    }
    if (this.mode === "draw" && canZoom) {
      const [a] = this.points.values();
      this.points.set(id, p);
      this.start = { view, a, b: p };
      this.mode = "zoom";
      return "zoom";
    }
    return null;
  }

  /** A tracked pointer moved. While pinching, returns the new view; otherwise null. */
  move(id: number, p: Point, grid: Grid, port: Size, limits: ZoomLimits): View | null {
    if (!this.points.has(id)) return null;
    this.points.set(id, p);
    if (this.mode !== "zoom" || this.start === null) return null;
    const [a, b] = this.points.values();
    const { view, a: a0, b: b0 } = this.start;
    return pinchView(grid, view, a0, b0, a, b, port, limits);
  }

  /** A pointer went up or was cancelled. Returns true when it ends a drawing gesture. */
  up(id: number): boolean {
    if (!this.points.delete(id)) return false;
    const ended = this.mode === "draw";
    if (this.points.size === 0) {
      this.mode = "idle";
      this.start = null;
    } else if (this.mode === "zoom") {
      this.mode = "rest";
    }
    return ended;
  }

  /** True when `id` is a pointer this tracker follows. */
  has(id: number): boolean {
    return this.points.has(id);
  }
}
```

2. Create `apps/web/src/lib/game/pointers.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createGrid } from "@loophole/core";
import { BoardPointers } from "./pointers.ts";
import { clampView, zoomLimits } from "./viewport.ts";

const grid = createGrid(20, 20);
const port = { width: 354, height: 400 };
const limits = zoomLimits(grid, port);
const view = clampView(grid, { cell: 44, x: 100, y: 100 }, port, limits);

describe("BoardPointers", () => {
  test("one pointer draws", () => {
    const p = new BoardPointers();
    expect(p.down(1, { x: 10, y: 10 }, view, true)).toBe("draw");
    expect(p.drawing).toBe(true);
    expect(p.move(1, { x: 20, y: 10 }, grid, port, limits)).toBeNull();
    expect(p.up(1)).toBe(true);
    expect(p.drawing).toBe(false);
  });

  test("a second finger turns the gesture into a pinch until every finger is up", () => {
    const p = new BoardPointers();
    p.down(1, { x: 100, y: 100 }, view, true);
    expect(p.down(2, { x: 200, y: 100 }, view, true)).toBe("zoom");
    expect(p.drawing).toBe(false);
    // Both fingers move left by 20: the board pans with them.
    p.move(1, { x: 80, y: 100 }, grid, port, limits);
    expect(p.move(2, { x: 180, y: 100 }, grid, port, limits)).toEqual({ ...view, x: 120 });
    expect(p.up(1)).toBe(false);
    // The finger left behind neither draws nor zooms.
    expect(p.move(2, { x: 100, y: 100 }, grid, port, limits)).toBeNull();
    expect(p.down(3, { x: 50, y: 50 }, view, true)).toBeNull();
    expect(p.up(2)).toBe(false);
    expect(p.down(4, { x: 50, y: 50 }, view, true)).toBe("draw");
  });

  test("a second pointer is ignored when the board cannot zoom", () => {
    const p = new BoardPointers();
    p.down(1, { x: 100, y: 100 }, view, false);
    expect(p.down(2, { x: 200, y: 100 }, view, false)).toBeNull();
    expect(p.has(2)).toBe(false);
    expect(p.drawing).toBe(true);
    expect(p.up(2)).toBe(false);
    expect(p.up(1)).toBe(true);
  });

  test("a third finger is ignored", () => {
    const p = new BoardPointers();
    p.down(1, { x: 100, y: 100 }, view, true);
    p.down(2, { x: 200, y: 100 }, view, true);
    expect(p.down(3, { x: 300, y: 100 }, view, true)).toBeNull();
    expect(p.move(3, { x: 0, y: 0 }, grid, port, limits)).toBeNull();
  });
});
```

Verify: `bun test apps/web/src/lib/game/pointers.test.ts` passes; `bun run check` passes.

Commit: `feat(web): tell drawing from two-finger pinches`

### Step 4 — canvas painter with viewport culling

1. Create `apps/web/src/lib/game/paint.ts`:

```ts
import {
  type BoardAnalysis,
  cellIndex,
  dotIndex,
  EdgeState,
  hEdgeIndex,
  NO_CLUE,
  type Puzzle,
  vEdgeIndex,
} from "@loophole/core";
import {
  cellPoint,
  dotPoint,
  edgeMidpoint,
  edgeSegment,
  type Layout,
  markSizes,
} from "./geometry.ts";
import { insideCells } from "./inside.ts";
import { type Size, type View, visibleCells } from "./viewport.ts";

/** Theme colours for the canvas, read from the app stylesheet's custom properties. */
export interface Palette {
  readonly ink: string;
  readonly pencil: string;
  readonly shu: string;
  readonly wash: string;
}

/** The part of the canvas 2D context the painter uses, so tests can pass a recorder. */
export type Painter = Pick<
  CanvasRenderingContext2D,
  | "setTransform"
  | "clearRect"
  | "fillRect"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "arc"
  | "fill"
  | "stroke"
  | "fillText"
  | "setLineDash"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "lineCap"
  | "font"
  | "textAlign"
  | "textBaseline"
>;

export interface Scene {
  readonly puzzle: Puzzle;
  readonly edges: Uint8Array;
  readonly analysis: BoardAnalysis;
  /** The whole board at the current cell size. */
  readonly layout: Layout;
  readonly view: View;
  /** Viewport size in CSS pixels; the canvas holds `port × ratio` device pixels. */
  readonly port: Size;
  readonly ratio: number;
  readonly palette: Palette;
}

/** Clues are not drawn below this cell size; they would be under 5px tall. */
export const MIN_CLUE_CELL = 8;

/**
 * Draws the board on a canvas with the SVG board's look (design kit, Board): solved wash, lines
 * (dashed shu for a premature loop), crosses, dots, clues and error rings. Only the cells in the
 * viewport, plus a one-cell border, are drawn (viewport culling).
 */
export function paintBoard(ctx: Painter, scene: Scene): void {
  const { puzzle, edges, analysis, layout, view, port, ratio, palette } = scene;
  const grid = puzzle.grid;
  const S = layout.cell;
  const size = markSizes(S);
  const { r0, r1, c0, c1 } = visibleCells(grid, layout, view, port);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, Math.round(port.width * ratio), Math.round(port.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, -view.x * ratio, -view.y * ratio);
  if (r1 < r0 || c1 < c0) return;

  const v = analysis.violations;
  const loop = new Uint8Array(grid.edgeCount);
  for (const e of v.loopEdges) loop[e] = 1;
  const bad = new Uint8Array(grid.cellCount);
  for (const c of v.overfullCells) bad[c] = 1;
  for (const c of v.starvedCells) bad[c] = 1;

  // Edges touching the visible cells: horizontal ones on dot rows r0..r1+1, vertical ones on dot
  // columns c0..c1+1.
  const visible: number[] = [];
  for (let r = r0; r <= r1 + 1; r++) {
    for (let c = c0; c <= c1; c++) visible.push(hEdgeIndex(grid, r, c));
  }
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1 + 1; c++) visible.push(vEdgeIndex(grid, r, c));
  }

  if (analysis.solved) {
    const inside = insideCells(grid, edges);
    ctx.fillStyle = palette.wash;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = cellIndex(grid, r, c);
        if (inside[i] === 0) continue;
        const p = cellPoint(grid, layout, i);
        ctx.fillRect(p.x - S / 2, p.y - S / 2, S, S);
      }
    }
  }

  const strokeLines = (dashed: boolean) => {
    ctx.beginPath();
    for (const e of visible) {
      if (edges[e] !== EdgeState.Line || (loop[e] === 1) !== dashed) continue;
      const s = edgeSegment(grid, layout, e);
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.lineWidth = size.line;
    ctx.lineCap = dashed ? "butt" : "round";
    ctx.strokeStyle = dashed ? palette.shu : palette.ink;
    ctx.setLineDash(dashed ? [6, 5] : []);
    ctx.stroke();
  };
  strokeLines(false);
  if (v.loopEdges.length > 0) strokeLines(true);
  ctx.setLineDash([]);

  ctx.beginPath();
  const arm = size.crossArm;
  for (const e of visible) {
    if (edges[e] !== EdgeState.Cross) continue;
    const { x, y } = edgeMidpoint(grid, layout, e);
    ctx.moveTo(x - arm, y - arm);
    ctx.lineTo(x + arm, y + arm);
    ctx.moveTo(x + arm, y - arm);
    ctx.lineTo(x - arm, y + arm);
  }
  ctx.lineWidth = size.crossWidth;
  ctx.lineCap = "round";
  ctx.strokeStyle = palette.pencil;
  ctx.stroke();

  ctx.beginPath();
  for (let r = r0; r <= r1 + 1; r++) {
    for (let c = c0; c <= c1 + 1; c++) {
      const p = dotPoint(grid, layout, dotIndex(grid, r, c));
      ctx.moveTo(p.x + size.dotRadius, p.y);
      ctx.arc(p.x, p.y, size.dotRadius, 0, 2 * Math.PI);
    }
  }
  ctx.fillStyle = palette.ink;
  ctx.fill();

  ctx.beginPath();
  if (S >= MIN_CLUE_CELL) {
    ctx.font = `500 ${size.clue}px "Zen Kaku Gothic New", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = cellIndex(grid, r, c);
      const clue = puzzle.clues[i];
      if (clue === NO_CLUE) continue;
      const p = cellPoint(grid, layout, i);
      if (S >= MIN_CLUE_CELL) {
        ctx.fillStyle = bad[i] === 1 ? palette.shu : palette.ink;
        ctx.fillText(String(clue), p.x, p.y);
      }
      if (bad[i] === 1) {
        ctx.moveTo(p.x + size.clueRing, p.y);
        ctx.arc(p.x, p.y, size.clueRing, 0, 2 * Math.PI);
      }
    }
  }
  for (const d of v.dots) {
    const p = dotPoint(grid, layout, d);
    ctx.moveTo(p.x + size.dotRing, p.y);
    ctx.arc(p.x, p.y, size.dotRing, 0, 2 * Math.PI);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = palette.shu;
  ctx.stroke();
}
```

2. Create `apps/web/src/lib/game/paint.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { analyzeBoard, createGrid, createPuzzle, EdgeState, hEdgeIndex } from "@loophole/core";
import { MIN_CLUE_CELL, type Painter, paintBoard, type Scene } from "./paint.ts";
import { viewLayout } from "./viewport.ts";

/** A stand-in canvas context that counts the calls the painter makes. */
function recorder() {
  const calls: Record<string, number> = {};
  const count =
    (name: string) =>
    (..._args: unknown[]) => {
      calls[name] = (calls[name] ?? 0) + 1;
    };
  const ctx = {
    setTransform: count("setTransform"),
    clearRect: count("clearRect"),
    fillRect: count("fillRect"),
    beginPath: count("beginPath"),
    moveTo: count("moveTo"),
    lineTo: count("lineTo"),
    arc: count("arc"),
    fill: count("fill"),
    stroke: count("stroke"),
    fillText: count("fillText"),
    setLineDash: count("setLineDash"),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
  };
  return { ctx: ctx as unknown as Painter, calls };
}

const palette = { ink: "#000", pencil: "#888", shu: "#c00", wash: "#fee" };

function scene(width: number, cell: number, x: number, y: number, edges?: Uint8Array): Scene {
  const puzzle = createPuzzle(width, width, new Array(width * width).fill(2));
  const grid = puzzle.grid;
  const e = edges ?? new Uint8Array(grid.edgeCount);
  return {
    puzzle,
    edges: e,
    analysis: analyzeBoard(puzzle, e),
    layout: viewLayout(grid, cell),
    view: { cell, x, y },
    port: { width: 360, height: 400 },
    ratio: 2,
    palette,
  };
}

describe("paintBoard", () => {
  test("draws only the cells in view (viewport culling)", () => {
    const { ctx, calls } = recorder();
    // 44px cells, viewport 360×400 at (1000, 1000): columns 22–30 and rows 22–31 are on screen,
    // so columns 21–31 and rows 21–32 are drawn: 11×12 clues and 12×13 dots.
    paintBoard(ctx, scene(100, 44, 1000, 1000));
    expect(calls.fillText).toBe(11 * 12);
    // One arc per dot in range; no rings without errors.
    expect(calls.arc).toBe(12 * 13);
  });

  test("draws the whole of a board that fits", () => {
    const { ctx, calls } = recorder();
    paintBoard(ctx, scene(5, 44, 0, 0));
    expect(calls.fillText).toBe(25);
    expect(calls.arc).toBe(36);
  });

  test("leaves out clues on tiny cells", () => {
    const { ctx, calls } = recorder();
    paintBoard(ctx, scene(100, MIN_CLUE_CELL - 1, 0, 0));
    expect(calls.fillText ?? 0).toBe(0);
  });

  test("rings broken clues and dots", () => {
    const grid = createGrid(5, 5);
    const edges = new Uint8Array(grid.edgeCount);
    // Three lines at the dot between cells (0,0), (0,1), (1,0) and (1,1).
    for (const e of [hEdgeIndex(grid, 1, 0), hEdgeIndex(grid, 1, 1), grid.hEdgeCount + 1]) {
      edges[e] = EdgeState.Line;
    }
    const s = scene(5, 44, 0, 0, edges);
    const { ctx, calls } = recorder();
    paintBoard(ctx, s);
    const v = s.analysis.violations;
    const rings = v.dots.length + v.overfullCells.length + v.starvedCells.length;
    expect(v.dots.length).toBe(1);
    expect(calls.arc).toBe(36 + rings);
  });
});
```

Verify: `bun test apps/web/src/lib/game/paint.test.ts` passes; `bun run check` passes.

Commit: `feat(web): paint large boards on a canvas with viewport culling`

### Step 5 — renderers, zoomable board and play screen

1. Create `apps/web/src/lib/components/BoardSvg.svelte` (the SVG drawing moved out of `BoardView`, laid out at the settled cell size inside one transformed group):

```svelte
<script lang="ts">
  import { type BoardAnalysis, EdgeState, NO_CLUE, type Puzzle } from "@loophole/core";
  import { cellPoint, dotPoint, edgeMidpoint, edgeSegment, type Layout, markSizes } from "../game/geometry.ts";
  import { insideCells } from "../game/inside.ts";
  import type { Size, View } from "../game/viewport.ts";

  interface Props {
    puzzle: Puzzle;
    edges: Uint8Array;
    analysis: BoardAnalysis;
    /** The whole board at the current cell size. */
    layout: Layout;
    view: View;
    port: Size;
  }

  let { puzzle, edges, analysis, layout, view, port }: Props = $props();

  const grid = $derived(puzzle.grid);

  // The marks are laid out at `drawn`, the cell size the zoom last settled on, with no margin. While
  // the zoom changes, a transform scales them to the live size; 150ms after it stops they are laid
  // out again at the new size, so line and dot sizes match the design kit and the SVG is not
  // rebuilt on every frame of a pinch.
  // svelte-ignore state_referenced_locally
  let drawn = $state(layout.cell);
  $effect(() => {
    const cell = layout.cell;
    if (cell === drawn) return;
    const t = setTimeout(() => {
      drawn = cell;
    }, 150);
    return () => clearTimeout(t);
  });

  const geo: Layout = $derived({
    cell: drawn,
    margin: 0,
    width: grid.width * drawn,
    height: grid.height * drawn,
  });
  const S = $derived(drawn);
  const size = $derived(markSizes(drawn));
  const transform = $derived(
    `translate(${layout.margin - view.x} ${layout.margin - view.y}) scale(${layout.cell / drawn})`,
  );

  const dots = $derived(Array.from({ length: grid.dotCount }, (_, d) => dotPoint(grid, geo, d)));
  const clues = $derived.by(() => {
    const out: { cell: number; x: number; y: number; text: string }[] = [];
    for (let i = 0; i < grid.cellCount; i++) {
      if (puzzle.clues[i] === NO_CLUE) continue;
      const p = cellPoint(grid, geo, i);
      out.push({ cell: i, x: p.x, y: p.y, text: String(puzzle.clues[i]) });
    }
    return out;
  });

  const v = $derived(analysis.violations);
  const badCells = $derived(new Set([...v.overfullCells, ...v.starvedCells]));
  const loopEdges = $derived(new Set(v.loopEdges));
  const lines = $derived(Array.from(edges.keys()).filter((e) => edges[e] === EdgeState.Line));
  const crosses = $derived(Array.from(edges.keys()).filter((e) => edges[e] === EdgeState.Cross));
  const inside = $derived(analysis.solved ? insideCells(grid, edges) : null);
</script>

<svg class="board-svg" width={port.width} height={port.height} aria-hidden="true">
  <g {transform}>
    {#if inside}
      {#each inside as isIn, i (i)}
        {#if isIn}
          {@const p = cellPoint(grid, geo, i)}
          <rect class="wash" x={p.x - S / 2} y={p.y - S / 2} width={S} height={S} />
        {/if}
      {/each}
    {/if}

    {#each lines as e (e)}
      {@const s = edgeSegment(grid, geo, e)}
      <line
        class="line"
        class:loop={loopEdges.has(e)}
        x1={s.x1}
        y1={s.y1}
        x2={s.x2}
        y2={s.y2}
        stroke-width={size.line}
      />
    {/each}

    {#each crosses as e (e)}
      {@const { x, y } = edgeMidpoint(grid, geo, e)}
      {@const a = size.crossArm}
      <path
        class="cross"
        d="M{x - a} {y - a}L{x + a} {y + a}M{x + a} {y - a}L{x - a} {y + a}"
        stroke-width={size.crossWidth}
      />
    {/each}

    {#each dots as p, d (d)}
      <circle class="dot" cx={p.x} cy={p.y} r={size.dotRadius} />
    {/each}

    {#each clues as q (q.cell)}
      <text
        class="clue"
        class:bad={badCells.has(q.cell)}
        x={q.x}
        y={q.y}
        font-size={size.clue}>{q.text}</text
      >
      {#if badCells.has(q.cell)}
        <circle class="ring" cx={q.x} cy={q.y} r={size.clueRing} />
      {/if}
    {/each}

    {#each v.dots as d (d)}
      {@const p = dotPoint(grid, geo, d)}
      <circle class="ring" cx={p.x} cy={p.y} r={size.dotRing} />
    {/each}
  </g>
</svg>

<style>
  svg {
    display: block;
  }

  .wash {
    fill: var(--solved-wash);
  }

  .line {
    stroke: var(--ink);
    stroke-linecap: round;
  }

  .line.loop {
    stroke: var(--shu);
    stroke-linecap: butt;
    stroke-dasharray: 6 5;
  }

  .cross {
    stroke: var(--pencil);
    stroke-linecap: round;
    fill: none;
  }

  .dot {
    fill: var(--ink);
  }

  .clue {
    fill: var(--ink);
    font-family: var(--font-ui);
    font-weight: 500;
    text-anchor: middle;
    dominant-baseline: central;
  }

  .clue.bad {
    fill: var(--shu);
  }

  .ring {
    fill: none;
    stroke: var(--shu);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
</style>
```

2. Create `apps/web/src/lib/components/BoardCanvas.svelte`:

```svelte
<script lang="ts">
  import type { BoardAnalysis, Puzzle } from "@loophole/core";
  import { onMount } from "svelte";
  import type { Layout } from "../game/geometry.ts";
  import { type Palette, paintBoard } from "../game/paint.ts";
  import type { Size, View } from "../game/viewport.ts";

  interface Props {
    puzzle: Puzzle;
    edges: Uint8Array;
    analysis: BoardAnalysis;
    /** The whole board at the current cell size. */
    layout: Layout;
    view: View;
    port: Size;
  }

  let { puzzle, edges, analysis, layout, view, port }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let ratio = $state(1);
  // Bumped when the theme or the clue font changes, so the board is painted again.
  let restyle = $state(0);

  function palette(el: Element): Palette {
    const css = getComputedStyle(el);
    const get = (name: string) => css.getPropertyValue(name).trim();
    return { ink: get("--ink"), pencil: get("--pencil"), shu: get("--shu"), wash: get("--solved-wash") };
  }

  // Paint at most once per frame, with the latest props.
  $effect(() => {
    const el = canvas;
    if (el === undefined) return;
    void restyle;
    const scene = { puzzle, edges, analysis, layout, view, port, ratio, palette: palette(el) };
    const frame = requestAnimationFrame(() => {
      const ctx = el.getContext("2d");
      if (ctx !== null) paintBoard(ctx, scene);
    });
    return () => cancelAnimationFrame(frame);
  });

  onMount(() => {
    ratio = window.devicePixelRatio || 1;
    const onresize = () => {
      ratio = window.devicePixelRatio || 1;
    };
    const bump = () => {
      restyle++;
    };
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const dark = matchMedia("(prefers-color-scheme: dark)");
    dark.addEventListener("change", bump);
    window.addEventListener("resize", onresize);
    document.fonts.load('500 16px "Zen Kaku Gothic New"', "0123").then(bump, () => {});
    return () => {
      observer.disconnect();
      dark.removeEventListener("change", bump);
      window.removeEventListener("resize", onresize);
    };
  });
</script>

<canvas
  bind:this={canvas}
  width={Math.round(port.width * ratio)}
  height={Math.round(port.height * ratio)}
  style:width="{port.width}px"
  style:height="{port.height}px"
  aria-hidden="true"
></canvas>

<style>
  canvas {
    display: block;
  }
</style>
```

3. Create `apps/web/src/lib/components/MiniMap.svelte`:

```svelte
<script lang="ts">
  import { EdgeState, type Grid } from "@loophole/core";
  import { onMount } from "svelte";
  import { edgeSegment } from "../game/geometry.ts";
  import { miniLayout, miniRect, type Size, type View } from "../game/viewport.ts";

  interface Props {
    grid: Grid;
    edges: Uint8Array;
    view: View;
    port: Size;
    /** Centres the view on the board point under (x, y), in map pixels. */
    onjump: (x: number, y: number) => void;
  }

  let { grid, edges, view, port, onjump }: Props = $props();

  const mini = $derived(miniLayout(grid));
  const rect = $derived(miniRect(view, port, mini));

  let canvas: HTMLCanvasElement | undefined = $state();
  let ratio = $state(1);
  let restyle = $state(0);

  // The map shows the lines only (Night artboard), redrawn when they change.
  $effect(() => {
    const el = canvas;
    const ctx = el?.getContext("2d");
    if (el === undefined || ctx === null || ctx === undefined) return;
    void restyle;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, mini.width, mini.height);
    ctx.beginPath();
    for (let e = 0; e < grid.edgeCount; e++) {
      if (edges[e] !== EdgeState.Line) continue;
      const s = edgeSegment(grid, mini, e);
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.lineWidth = Math.max(0.5, mini.cell * 0.2);
    ctx.lineCap = "round";
    ctx.strokeStyle = getComputedStyle(el).getPropertyValue("--ink").trim();
    ctx.stroke();
  });

  let pressed = -1;

  function jump(e: PointerEvent) {
    const r = (canvas as HTMLCanvasElement).getBoundingClientRect();
    onjump(e.clientX - r.left, e.clientY - r.top);
  }

  function onpointerdown(e: PointerEvent) {
    if (pressed !== -1 || (e.pointerType === "mouse" && e.button !== 0)) return;
    pressed = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    jump(e);
  }

  function onpointermove(e: PointerEvent) {
    if (e.pointerId === pressed) jump(e);
  }

  function onpointerend(e: PointerEvent) {
    if (e.pointerId === pressed) pressed = -1;
  }

  onMount(() => {
    ratio = window.devicePixelRatio || 1;
    const bump = () => {
      restyle++;
    };
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const dark = matchMedia("(prefers-color-scheme: dark)");
    dark.addEventListener("change", bump);
    return () => {
      observer.disconnect();
      dark.removeEventListener("change", bump);
    };
  });
</script>

<!-- Pointer-only shortcut: keyboard players move the view with the edge cursor instead. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="mini"
  role="img"
  aria-label="Overview: the dashed box shows the part of the board on screen"
  style:width="{mini.width}px"
  style:height="{mini.height}px"
  {onpointerdown}
  {onpointermove}
  onpointerup={onpointerend}
  onpointercancel={onpointerend}
>
  <canvas
    bind:this={canvas}
    width={Math.round(mini.width * ratio)}
    height={Math.round(mini.height * ratio)}
    style:width="{mini.width}px"
    style:height="{mini.height}px"
  ></canvas>
  <div
    class="rect"
    style:left="{rect.x}px"
    style:top="{rect.y}px"
    style:width="{rect.width}px"
    style:height="{rect.height}px"
  ></div>
</div>

<style>
  .mini {
    position: absolute;
    left: 8px;
    top: 8px;
    box-sizing: content-box;
    background: color-mix(in srgb, var(--ground) 92%, transparent);
    border: 1.5px solid var(--hairline);
    border-radius: 4px;
    touch-action: none;
    cursor: pointer;
    z-index: 1;
  }

  canvas {
    display: block;
  }

  .rect {
    position: absolute;
    border: 1.5px dashed var(--ai);
    border-radius: 2px;
    pointer-events: none;
  }
</style>
```

4. Replace `apps/web/src/lib/components/BoardView.svelte`:

```svelte
<script lang="ts">
  import { type BoardAnalysis, EdgeState, NONE, type Puzzle } from "@loophole/core";
  import { type EdgeChange, nextState } from "../game/board.ts";
  import { edgeSegment, type Layout, type Point } from "../game/geometry.ts";
  import { PointerGesture } from "../game/gesture.ts";
  import { boardCommand, edgeLabel, moveCursor } from "../game/keyboard.ts";
  import { BoardPointers } from "../game/pointers.ts";
  import {
    miniJump,
    miniLayout,
    panBy,
    revealRect,
    type Size,
    SVG_MAX_SIZE,
    type View,
    ZOOM_STEP,
    type ZoomLimits,
    zoomAround,
  } from "../game/viewport.ts";
  import BoardCanvas from "./BoardCanvas.svelte";
  import BoardSvg from "./BoardSvg.svelte";
  import MiniMap from "./MiniMap.svelte";

  interface Props {
    puzzle: Puzzle;
    edges: Uint8Array;
    analysis: BoardAnalysis;
    /** The whole board at the current cell size. */
    layout: Layout;
    /** Where the viewport sits on the board; always at (0, 0) for a board that does not zoom. */
    view: View;
    /** The visible box: the board's own size, or the stage for a zoomable board. */
    port: Size;
    /** Zoom range, or null when the board fits and does not zoom. */
    zoom: ZoomLimits | null;
    /** No drawing: paused or solved. Zoom and pan still work. */
    locked: boolean;
    /** Applies edits; `merge` joins them to the previous undo step (drag strokes). */
    onedit: (changes: EdgeChange[], merge: boolean) => void;
    /** Moves or zooms the view of a zoomable board. */
    onview: (view: View) => void;
  }

  let { puzzle, edges, analysis, layout, view, port, zoom, locked, onedit, onview }: Props = $props();

  const grid = $derived(puzzle.grid);
  const S = $derived(layout.cell);
  const canvas = $derived(grid.width > SVG_MAX_SIZE || grid.height > SVG_MAX_SIZE);

  // Keyboard cursor (NFR-5): shown while the board has focus and the keyboard was used last.
  let surface: HTMLDivElement | undefined = $state();
  let cursor = $state(0);
  let focused = $state(false);
  let keyboardMode = $state(false);
  const showCursor = $derived(focused && keyboardMode && !locked);
  const cursorLabel = $derived(edgeLabel(grid, cursor, edges[cursor] as EdgeState));
  const cursorBox = $derived.by(() => {
    const s = edgeSegment(grid, layout, cursor);
    const thick = Math.max(20, Math.round(S * 0.48));
    const horizontal = s.y1 === s.y2;
    const len = S + 12;
    const x = horizontal ? s.x1 - 6 : s.x1 - thick / 2;
    const y = horizontal ? s.y1 - thick / 2 : s.y1 - 6;
    return {
      x: x - view.x,
      y: y - view.y,
      width: horizontal ? len : thick,
      height: horizontal ? thick : len,
      radius: thick / 2,
      labelX: Math.min(Math.max((s.x1 + s.x2) / 2 - view.x, 130), port.width - 130),
      labelY: Math.max(s.y1, s.y2) - view.y + (horizontal ? thick / 2 : 6) + 8,
    };
  });

  const pointers = new BoardPointers();
  let gesture: PointerGesture | null = null;

  function local(e: { clientX: number; clientY: number }): Point {
    const r = (surface as HTMLDivElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onpointerdown(e: PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = local(e);
    const started = pointers.down(e.pointerId, p, view, zoom !== null && e.pointerType !== "mouse");
    if (started === null) return;
    surface?.setPointerCapture(e.pointerId);
    if (started === "zoom") {
      // A second finger: this is a pinch, not a stroke. Marks a stroke already made stay.
      gesture?.cancel();
      gesture = null;
      return;
    }
    keyboardMode = false;
    if (locked) return;
    gesture = new PointerGesture(grid, layout);
    gesture.down(p.x + view.x, p.y + view.y);
  }

  function onpointermove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    if (zoom !== null) {
      const next = pointers.move(e.pointerId, p, grid, port, zoom);
      if (next !== null) {
        onview(next);
        return;
      }
    }
    if (gesture === null || !pointers.drawing) return;
    const step = gesture.move(p.x + view.x, p.y + view.y, edges);
    if (step !== null) onedit(step.changes, step.merge);
  }

  function onpointerup(e: PointerEvent) {
    if (!pointers.up(e.pointerId) || gesture === null) return;
    const tapped = gesture.up();
    gesture = null;
    if (tapped !== NONE && !locked) {
      cursor = tapped;
      onedit([[tapped, nextState(edges[tapped] as EdgeState)]], false);
    }
  }

  function onpointercancel(e: PointerEvent) {
    if (!pointers.up(e.pointerId)) return;
    gesture?.cancel();
    gesture = null;
  }

  // Wheel and trackpad: Ctrl/⌘ + wheel (and trackpad pinch, which the browser reports the same
  // way) zooms around the pointer; plain wheel and two-finger scroll pan. Svelte adds wheel
  // listeners as passive, so this one is added by hand to be able to stop page zoom and scroll.
  $effect(() => {
    const el = surface;
    if (el === undefined || zoom === null) return;
    const limits = zoom;
    const onwheel = (e: WheelEvent) => {
      // Never let the page scroll or zoom under the board, even while a stroke is held.
      e.preventDefault();
      if (gesture !== null) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? port.height : 1;
      let dx = e.deltaX * unit;
      let dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        onview(zoomAround(grid, view, view.cell * Math.exp(-dy * 0.01), local(e), port, limits));
        return;
      }
      if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
      onview(panBy(grid, view, -dx, -dy, port, limits));
    };
    el.addEventListener("wheel", onwheel, { passive: false });
    return () => el.removeEventListener("wheel", onwheel);
  });

  function zoomBy(factor: number, at: Point) {
    if (zoom !== null) onview(zoomAround(grid, view, view.cell * factor, at, port, zoom));
  }

  function centre(): Point {
    return { x: port.width / 2, y: port.height / 2 };
  }

  /** Pans so the cursor's edge, with half a cell around it, is on screen and clear of the overlays. */
  function reveal(edge: number) {
    if (zoom === null) return;
    const s = edgeSegment(grid, layout, edge);
    const rect = {
      x: s.x1 - S / 2,
      y: s.y1 - S / 2,
      width: s.x2 - s.x1 + S,
      height: s.y2 - s.y1 + S,
    };
    onview(revealRect(grid, view, rect, port, zoom));
  }

  /** Moves keyboard focus to the board; the parent calls this after the board remounts. */
  export function focus(): void {
    surface?.focus();
  }

  function onkeydown(e: KeyboardEvent) {
    if (locked || e.ctrlKey || e.metaKey || e.altKey) return;
    // Keys wait until a stroke ends, so a keyboard edit never joins the stroke's undo step.
    if (gesture !== null) return;
    if (zoom !== null && (e.key === "+" || e.key === "=" || e.key === "-")) {
      e.preventDefault();
      const s = edgeSegment(grid, layout, cursor);
      const at = { x: (s.x1 + s.x2) / 2 - view.x, y: (s.y1 + s.y2) / 2 - view.y };
      zoomBy(e.key === "-" ? 1 / ZOOM_STEP : ZOOM_STEP, at);
      return;
    }
    const cmd = boardCommand(e.key);
    if (cmd === null) return;
    e.preventDefault();
    keyboardMode = true;
    if (cmd.type === "move") {
      cursor = moveCursor(grid, cursor, cmd.direction);
      reveal(cursor);
    } else if (cmd.type === "cycle") onedit([[cursor, nextState(edges[cursor] as EdgeState)]], false);
    else if (cmd.type === "cross") onedit([[cursor, EdgeState.Cross]], false);
    else if (cmd.type === "erase") onedit([[cursor, EdgeState.Unknown]], false);
  }

  const percent = $derived(zoom === null ? 100 : Math.round((view.cell / zoom.min) * 100));
</script>

<div class="board" style:width="{port.width}px" style:height="{port.height}px">
  <!-- The board is one focusable widget: pointer input is hit-tested by geometry and keyboard input
       moves an edge cursor, so its edges need no DOM elements of their own. The data attributes
       give tests the board's geometry, which a canvas cannot show. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={surface}
    class="surface"
    role="application"
    aria-label="Puzzle board, {grid.width} by {grid.height}. Arrow keys move the edge cursor; Space cycles line, cross, empty."
    aria-describedby="board-cursor"
    tabindex={locked ? -1 : 0}
    data-cell={layout.cell}
    data-margin={layout.margin}
    data-x={view.x}
    data-y={view.y}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    {onpointercancel}
    {onkeydown}
    onfocus={() => {
      focused = true;
      // Tab and other keyboard focus show the cursor at once, in view; a click does not.
      keyboardMode = surface?.matches(":focus-visible") ?? false;
      if (keyboardMode) reveal(cursor);
    }}
    onblur={() => (focused = false)}
  >
    {#if canvas}
      <BoardCanvas {puzzle} {edges} {analysis} {layout} {view} {port} />
    {:else}
      <BoardSvg {puzzle} {edges} {analysis} {layout} {view} {port} />
    {/if}
    {#if showCursor}
      <svg class="overlay" width={port.width} height={port.height} aria-hidden="true">
        <rect
          class="cursor"
          x={cursorBox.x}
          y={cursorBox.y}
          width={cursorBox.width}
          height={cursorBox.height}
          rx={cursorBox.radius}
        />
      </svg>
    {/if}
  </div>
  {#if showCursor}
    <div class="tip" style:left="{cursorBox.labelX}px" style:top="{cursorBox.labelY}px" aria-hidden="true">
      {cursorLabel}
    </div>
  {/if}
  {#if zoom !== null}
    {@const limits = zoom}
    <MiniMap
      {grid}
      {edges}
      {view}
      {port}
      onjump={(x, y) => onview(miniJump(grid, view, x, y, miniLayout(grid), port, limits))}
    />
    <div class="zoom">
      <button
        type="button"
        aria-label="Zoom out"
        disabled={view.cell <= limits.min}
        onclick={() => zoomBy(1 / ZOOM_STEP, centre())}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
      <span class="percent">{percent}%</span>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={view.cell >= limits.max}
        onclick={() => zoomBy(ZOOM_STEP, centre())}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>
      </button>
    </div>
  {/if}
  <p id="board-cursor" class="visually-hidden" aria-live="polite">{showCursor ? cursorLabel : ""}</p>
</div>

<style>
  .board {
    position: relative;
  }

  .surface {
    position: relative;
    width: 100%;
    height: 100%;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    cursor: pointer;
    outline: none;
  }

  .overlay {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
  }

  .cursor {
    fill: none;
    stroke: var(--ai);
    stroke-width: 3;
  }

  .tip {
    position: absolute;
    transform: translateX(-50%);
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--ai);
    color: var(--on-ink);
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
    pointer-events: none;
    z-index: 2;
  }

  /* Zoom controls (Night artboard): bottom right of the board. */
  .zoom {
    position: absolute;
    right: 8px;
    bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px;
    background: color-mix(in srgb, var(--ground) 92%, transparent);
    border: 1.5px solid var(--hairline);
    border-radius: 999px;
    z-index: 1;
  }

  .zoom button {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 0;
    background: transparent;
    color: var(--ink);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
  }

  .zoom button:disabled {
    color: var(--disabled);
    cursor: default;
  }

  .percent {
    min-width: 40px;
    font-size: 13px;
    font-weight: 700;
    color: var(--ink-soft);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
```

5. In `apps/web/src/lib/components/PlayScreen.svelte` make these edits (each "old" text appears exactly once):

Edit 5.1: replace

```svelte
  import { type PuzzleEntry, puzzleTitle } from "../puzzles/index.ts";
```

with

```svelte
  import { clampView, type View, viewLayout, zoomLimits } from "../game/viewport.ts";
  import { type PuzzleEntry, puzzleTitle } from "../puzzles/index.ts";
```

Edit 5.2: replace

```svelte
  const layout = $derived(
    stageWidth > 0
```

with

```svelte
  const fitted = $derived(
    stageWidth > 0
```

Edit 5.3: replace

```svelte
    stageWidth > 0 ? minBoardHeight(grid.width, grid.height, roomWidth, minCell) + FRAME : 0,
  );
```

with

```svelte
    stageWidth > 0 ? minBoardHeight(grid.width, grid.height, roomWidth, minCell) + FRAME : 0,
  );

  // A board whose cells would come out smaller than the minimum zooms instead (FR-13). Whether it
  // does depends only on the width (`fitLayout` gives up the minimum only for width). Its stage then
  // takes the height left over on the screen, at least five cells, and the board's frame fills the
  // stage without sizing it, so the viewport follows the screen and never feeds its own size. It
  // opens at the minimum cell size. `zoomed` is the last view the player chose; it survives
  // pausing, and is clamped again whenever the stage changes size.
  const zoomable = $derived(fitted !== null && fitted.cell < minCell);
  let zoomed: View | null = $state.raw(null);
  const frame = $derived.by(() => {
    if (fitted === null) return null;
    if (!zoomable) {
      return {
        layout: fitted,
        view: { cell: fitted.cell, x: 0, y: 0 },
        port: { width: fitted.width, height: fitted.height },
        zoom: null,
      };
    }
    const port = { width: roomWidth, height: stageHeight - FRAME };
    const zoom = zoomLimits(grid, port);
    const view = clampView(grid, zoomed ?? { cell: minCell, x: 0, y: 0 }, port, zoom);
    return { layout: viewLayout(grid, view.cell), view, port, zoom };
  });
```

Edit 5.4: replace

```svelte
    <b>{analysis.satisfiedClues}</b> of {analysis.clueCount} clues satisfied
  </p>

  <main class="play">
    <div
      class="stage"
      bind:clientWidth={stageWidth}
      bind:clientHeight={stageHeight}
      style:min-height="{stageMinHeight}px"
    >
      {#if layout}
        <div class="frame" style:width="{layout.width + FRAME}px" style:height="{layout.height + FRAME}px">
```

with

```svelte
    <span><b>{analysis.satisfiedClues}</b> of {analysis.clueCount} clues satisfied</span>
    {#if zoomable}<span>Pinch or use +/− to zoom</span>{/if}
  </p>

  <main class="play" class:zoom={zoomable}>
    <div
      class="stage"
      bind:clientWidth={stageWidth}
      bind:clientHeight={stageHeight}
      style:min-height="{zoomable ? 5 * minCell + FRAME : stageMinHeight}px"
    >
      {#if frame}
        <div class="frame" style:width="{frame.port.width + FRAME}px" style:height="{frame.port.height + FRAME}px">
```

Edit 5.5: replace

```svelte
              {analysis}
              {layout}
              {locked}
              onedit={edit}
            />
```

with

```svelte
              {analysis}
              layout={frame.layout}
              view={frame.view}
              port={frame.port}
              zoom={frame.zoom}
              {locked}
              onedit={edit}
              onview={(v) => (zoomed = v)}
            />
```

Edit 5.6: replace

```svelte
          <dt>P</dt><dd>pause</dd>
```

with

```svelte
          <dt>P</dt><dd>pause</dd>
          {#if zoomable && !solved}<dt>+ / −</dt><dd>zoom in / out</dd>{/if}
```

Edit 5.7: replace

```svelte
  .status {
    margin: 0;
    flex: 0 0 auto;
```

with

```svelte
  .status {
    margin: 0;
    flex: 0 0 auto;
    display: flex;
    justify-content: space-between;
    gap: 8px;
```

Edit 5.8: replace

```svelte
    box-shadow: 4px 4px 0 var(--frame-shadow);
  }

  .paused {
```

with

```svelte
    box-shadow: 4px 4px 0 var(--frame-shadow);
  }

  /* A zoomable board's stage takes the free height and its frame fills it without sizing it. */
  .zoom .stage {
    flex: 1 1 0;
    position: relative;
  }

  .zoom .frame {
    position: absolute;
    top: 0;
    left: 0;
  }

  .zoom .spacer {
    display: none;
  }

  /* On phones, room for a one-message error card, so a zoomable board keeps its height when the
     first rule error appears or clears. */
  @media (max-width: 899px) {
    .zoom .notes {
      min-height: 68px;
    }
  }

  .paused {
```

Edit 5.9: replace

```svelte
    .stage {
      min-height: 0;
    }
```

with

```svelte
    .stage {
      min-height: 0;
    }

    /* The left column's height comes from the window, not from the side column: everything
       below the header and above the bottom padding. */
    .zoom .stage {
      height: calc(
        100dvh - var(--screen-top) - var(--bar-height) - var(--screen-gap) - var(--screen-bottom)
      );
      align-self: start;
    }
```

Edit 5.10: replace

```svelte
  .screen {
    min-height: 100dvh;
    max-width: 1280px;
    margin: 0 auto;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 10px;
```

with

```svelte
  .screen {
    /* Header metrics, also used to size a zoomable board's stage on wide screens. */
    --bar-height: 52px;
    --screen-top: 12px;
    --screen-bottom: 12px;
    --screen-gap: 10px;
    min-height: 100dvh;
    max-width: 1280px;
    margin: 0 auto;
    padding: var(--screen-top) 16px calc(var(--screen-bottom) + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: var(--screen-gap);
```

Edit 5.11: replace

```svelte
  .bar {
    height: 52px;
```

with

```svelte
  .bar {
    height: var(--bar-height);
```

Edit 5.12: replace

```svelte
    .screen {
      padding-block: 8px calc(8px + env(safe-area-inset-bottom));
      gap: 8px;
    }

    .bar {
      height: 48px;
    }
```

with

```svelte
    .screen {
      --bar-height: 48px;
      --screen-top: 8px;
      --screen-bottom: 8px;
      --screen-gap: 8px;
    }
```

Edit 5.13: replace

```svelte
    .screen {
      padding: 20px 24px 32px;
      gap: 14px;
    }
```

with

```svelte
    .screen {
      --screen-top: 20px;
      --screen-bottom: 32px;
      --screen-gap: 14px;
      padding: var(--screen-top) 24px var(--screen-bottom);
    }
```

6. The board's focusable element is now a `div`, and dots sit inside a transformed group. Replace `apps/web/tests/board.ts`:

```ts
import type { Grid } from "@loophole/core";
import type { Locator, Page } from "@playwright/test";

/** The board: the focusable widget that takes pointer and keyboard input. */
export function board(page: Page): Locator {
  return page.locator("[role=application]");
}

/** Page coordinates of every dot of an SVG board, from where the dots render (index order). */
export async function dotPoints(page: Page): Promise<{ x: number; y: number }[]> {
  return page.locator("[role=application] circle.dot").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }),
  );
}

export async function edgePoint(page: Page, grid: Grid, edge: number) {
  const dots = await dotPoints(page);
  const a = dots[grid.edgeDots[edge * 2]];
  const b = dots[grid.edgeDots[edge * 2 + 1]];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** The board's geometry from its data attributes: cell size, margin and scroll offset. */
export async function boardView(page: Page) {
  const el = board(page);
  const box = await el.boundingBox();
  if (box === null) throw new Error("board not visible");
  const num = async (name: string) => Number(await el.getAttribute(`data-${name}`));
  return {
    box,
    cell: await num("cell"),
    margin: await num("margin"),
    x: await num("x"),
    y: await num("y"),
  };
}

/** Page coordinates of dot (row, col) on any board, SVG or canvas, zoomed or not. */
export async function dotAt(page: Page, row: number, col: number) {
  const v = await boardView(page);
  return {
    x: v.box.x + v.margin + col * v.cell - v.x,
    y: v.box.y + v.margin + row * v.cell - v.y,
  };
}

/** Page coordinates of the middle of the horizontal edge nearest the centre of the viewport. */
export async function centreEdge(page: Page) {
  const v = await boardView(page);
  const col = Math.floor((v.x + v.box.width / 2 - v.margin) / v.cell);
  const row = Math.round((v.y + v.box.height / 2 - v.margin) / v.cell);
  const p = await dotAt(page, row, col);
  return { x: p.x + v.cell / 2, y: p.y };
}

/** Drawn lines. Use with `expect(...).toHaveCount(n)`, which retries until the DOM settles. */
export function lines(page: Page): Locator {
  return page.locator("[role=application] line.line");
}

/** Drawn crosses. Use with `expect(...).toHaveCount(n)`, which retries until the DOM settles. */
export function crosses(page: Page): Locator {
  return page.locator("[role=application] path.cross");
}

/** Number of lines in the saved progress of puzzle `id`; works for canvas boards too. */
export async function savedLines(page: Page, id: string): Promise<number> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (raw === null) return 0;
    const edges: string = JSON.parse(raw).edges;
    return edges.split("").filter((ch) => ch === "1").length;
  }, `loophole:progress:${id}`);
}

type TouchPoint = { x: number; y: number };

/** A real touch drag through Chromium's input pipeline (Playwright's touchscreen only taps). */
export async function touchDrag(page: Page, points: TouchPoint[]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const [first, ...rest] = points;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first] });
  for (const p of rest) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/**
 * A two-finger gesture: the fingers move in `steps` steps from `from` to `to` (each a pair of
 * points), then lift.
 */
export async function twoFingers(
  page: Page,
  from: [TouchPoint, TouchPoint],
  to: [TouchPoint, TouchPoint],
  steps = 8,
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const at = (t: number) =>
    from.map((p, i) => ({
      x: p.x + (to[i].x - p.x) * t,
      y: p.y + (to[i].y - p.y) * t,
      id: i,
    }));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(i / steps) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** True when the page can scroll sideways (NFR-2 forbids it). */
export async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}
```

7. In `apps/web/tests/play.e2e.ts`, replace every `svg[role=application]` with `[role=application]` (8 places):

```sh
sed -i 's/svg\[role=application\]/[role=application]/g' apps/web/tests/play.e2e.ts
grep -c "svg\[role=application\]" apps/web/tests/play.e2e.ts   # prints 0
```

Verify: `bun run check` passes (svelte-check reports 0 errors and 0 warnings); `bun run test:e2e` passes all existing tests (21). Then look at it: `bun run dev:web`, open http://localhost:5173/play/medium-10 with Chrome devtools device mode at 360×560 (10×10 opens at 44 px cells with the overview map and zoom buttons), `/play/giant-100` (canvas board), `/play/small-7` (unchanged from before).

Commit: `feat(web): zoom, pan and canvas rendering for large boards`

### Step 6 — end-to-end and frame-time tests

1. Create `apps/web/tests/zoom.e2e.ts`:

```ts
import { createGrid, hEdgeIndex } from "@loophole/core";
import { expect, type Page, test } from "@playwright/test";
import {
  board,
  boardView,
  centreEdge,
  dotAt,
  dotPoints,
  edgePoint,
  lines,
  savedLines,
  scrollsSideways,
  touchDrag,
  twoFingers,
} from "./board.ts";

/** Page coordinates of the middle of the board's viewport. */
async function centre(page: Page) {
  const v = await boardView(page);
  return { x: v.box.x + v.box.width / 2, y: v.box.y + v.box.height / 2 };
}

/** True when the page is no taller than the window (the tool tray is on screen). */
function fitsTheWindow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight);
}

test.describe("phone 360×560, zoomable boards (FR-13, NFR-2)", () => {
  test.use({ viewport: { width: 360, height: 560 }, hasTouch: true, isMobile: true });

  test("a 10×10 opens zoomed to 44px cells with the overview map", async ({ page }) => {
    await page.goto("/play/medium-10");
    await expect(board(page)).toBeVisible();
    expect((await boardView(page)).cell).toBe(44);
    const dots = await dotPoints(page);
    expect(dots[1].x - dots[0].x).toBeCloseTo(44, 2);
    expect(await scrollsSideways(page)).toBe(false);
    expect(await fitsTheWindow(page)).toBe(true);
    await expect(page.getByRole("img", { name: /Overview/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
  });

  test("taps and drags draw on the zoomed board", async ({ page }) => {
    await page.goto("/play/medium-10");
    const grid = createGrid(10, 10);
    const p = await edgePoint(page, grid, hEdgeIndex(grid, 2, 2));
    await page.touchscreen.tap(p.x, p.y);
    await expect(lines(page)).toHaveCount(1);
    await touchDrag(page, [
      await dotAt(page, 4, 1),
      await dotAt(page, 4, 2),
      await dotAt(page, 4, 3),
    ]);
    await expect(lines(page)).toHaveCount(3);
  });

  test("the board pans past its corner so edges under the overview map can be tapped", async ({
    page,
  }) => {
    await page.goto("/play/medium-10");
    const c = await centre(page);
    // Drag two fingers far right and down: the board stops with its corner clear of the map.
    await twoFingers(
      page,
      [
        { x: c.x - 30, y: c.y - 60 },
        { x: c.x + 30, y: c.y - 60 },
      ],
      [
        { x: c.x + 170, y: c.y + 140 },
        { x: c.x + 230, y: c.y + 140 },
      ],
    );
    await expect.poll(async () => (await boardView(page)).x).toBe(-104);
    expect((await boardView(page)).y).toBe(-104);
    const a = await dotAt(page, 0, 0);
    const cell = (await boardView(page)).cell;
    await page.touchscreen.tap(a.x + cell / 2, a.y);
    await expect(lines(page)).toHaveCount(1);
  });

  test("two fingers pinch to zoom and pan without drawing; then taps draw where they land", async ({
    page,
  }) => {
    await page.goto("/play/giant-100");
    await expect(board(page)).toBeVisible();
    const before = await boardView(page);
    const { x: cx, y: cy } = await centre(page);
    // Bring the fingers together to a third of their distance: zooms out to a third.
    await twoFingers(
      page,
      [
        { x: cx - 90, y: cy },
        { x: cx + 90, y: cy },
      ],
      [
        { x: cx - 30, y: cy },
        { x: cx + 30, y: cy },
      ],
    );
    await expect.poll(async () => (await boardView(page)).cell).toBeCloseTo(before.cell / 3, 1);
    // Move both fingers left and up: the board follows.
    const zoomed = await boardView(page);
    await twoFingers(
      page,
      [
        { x: cx, y: cy },
        { x: cx + 60, y: cy },
      ],
      [
        { x: cx - 100, y: cy - 50 },
        { x: cx - 40, y: cy - 50 },
      ],
    );
    await expect.poll(async () => (await boardView(page)).x).toBeCloseTo(zoomed.x + 100, 0);
    expect((await boardView(page)).y).toBeCloseTo(zoomed.y + 50, 0);
    expect(await savedLines(page, "giant-100")).toBe(0);
    // On the zoomed and panned board a tap still lands on the edge under the finger.
    const p = await centreEdge(page);
    await page.touchscreen.tap(p.x, p.y);
    await expect.poll(() => savedLines(page, "giant-100")).toBe(1);
  });

  test("draws on a zoomed canvas board", async ({ page }) => {
    await page.goto("/play/giant-100");
    await expect(board(page)).toBeVisible();
    // Row 5 is below the overview map in the top-left corner.
    await touchDrag(page, [
      await dotAt(page, 5, 1),
      await dotAt(page, 5, 2),
      await dotAt(page, 5, 3),
    ]);
    await expect.poll(() => savedLines(page, "giant-100")).toBe(2);
    const tap = await dotAt(page, 6, 1);
    await page.touchscreen.tap(tap.x, tap.y + (await boardView(page)).cell / 2);
    await expect.poll(() => savedLines(page, "giant-100")).toBe(3);
  });

  test("tapping the overview map moves the view there", async ({ page }) => {
    await page.goto("/play/huge-40");
    const map = page.getByRole("img", { name: /Overview/ });
    const box = await map.boundingBox();
    if (box === null) throw new Error("no map");
    expect((await boardView(page)).x).toBe(0);
    await page.touchscreen.tap(box.x + box.width - 4, box.y + box.height - 4);
    await expect.poll(async () => (await boardView(page)).x).toBeGreaterThan(500);
    expect((await boardView(page)).y).toBeGreaterThan(500);
  });

  test("zoomed all the way out, the whole board is on screen", async ({ page }) => {
    await page.goto("/play/giant-100");
    const out = page.getByRole("button", { name: "Zoom out" });
    while (await out.isEnabled()) await out.click();
    const v = await boardView(page);
    const size = 100 * v.cell + 2 * v.margin;
    // The board's left and top edges are on screen, and so are its right and bottom edges.
    expect(v.x).toBeLessThanOrEqual(0.5);
    expect(v.y).toBeLessThanOrEqual(0.5);
    expect(size - v.x).toBeLessThanOrEqual(v.box.width + 0.5);
    expect(size - v.y).toBeLessThanOrEqual(v.box.height + 0.5);
  });

  test("zoom buttons zoom in and out; the SVG marks are laid out again at the new size", async ({
    page,
  }) => {
    await page.goto("/play/large-20");
    const start = (await boardView(page)).cell;
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(async () => (await boardView(page)).cell).toBeCloseTo(start * 1.25, 3);
    // 150ms after the zoom stops the marks are redrawn at 55px cells: no scaling left, and the
    // kit's dot size for 55px cells (6px across).
    const group = page.locator("[role=application] svg.board-svg g").first();
    await expect.poll(() => group.getAttribute("transform")).toMatch(/scale\(1\)$/);
    await expect(page.locator("[role=application] circle.dot").first()).toHaveAttribute("r", "3");
    const dots = await dotPoints(page);
    expect(dots[1].x - dots[0].x).toBeCloseTo(start * 1.25, 2);
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect.poll(async () => (await boardView(page)).cell).toBeCloseTo(start / 1.25, 3);
  });

  test("one error keeps the board's height and the tool tray on screen", async ({ page }) => {
    await page.goto("/play/medium-10");
    const before = (await boardView(page)).box.height;
    // Three lines at dot (4, 4).
    const a = await dotAt(page, 4, 4);
    const cell = (await boardView(page)).cell;
    for (const p of [
      { x: a.x - cell / 2, y: a.y },
      { x: a.x + cell / 2, y: a.y },
      { x: a.x, y: a.y + cell / 2 },
    ]) {
      await page.touchscreen.tap(p.x, p.y);
    }
    await expect(page.getByText("Three lines meet at a dot.")).toBeVisible();
    expect((await boardView(page)).box.height).toBe(before);
    expect(await fitsTheWindow(page)).toBe(true);
    const undo = await page.getByRole("button", { name: "Undo" }).boundingBox();
    expect(undo !== null && undo.y + undo.height <= 560).toBe(true);
  });
});

test.describe("phone, resizing (NFR-2)", () => {
  test.use({ viewport: { width: 360, height: 700 }, hasTouch: true, isMobile: true });

  test("a zoomable board shrinks with the window", async ({ page }) => {
    await page.goto("/play/medium-10");
    const tall = (await boardView(page)).box.height;
    await page.setViewportSize({ width: 360, height: 560 });
    await expect.poll(async () => (await boardView(page)).box.height).toBeLessThan(tall);
    await expect.poll(() => fitsTheWindow(page)).toBe(true);
  });
});

test.describe("phone at 2× pixel density (FR-16)", () => {
  test.use({
    viewport: { width: 360, height: 560 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });

  test("the canvas board follows a theme change", async ({ page }) => {
    await page.goto("/play/giant-100");
    const v = await boardView(page);
    // The centre of dot (5, 5), in CSS pixels on the canvas.
    const at = {
      x: v.margin + 5 * v.cell - v.x,
      y: v.margin + 5 * v.cell - v.y,
    };
    const dotColour = () =>
      page.evaluate(({ x, y }) => {
        const canvas = document.querySelector("[role=application] canvas") as HTMLCanvasElement;
        const r = devicePixelRatio;
        const d = canvas
          .getContext("2d")
          ?.getImageData(Math.round(x * r), Math.round(y * r), 1, 1).data;
        return d ? [d[0], d[1], d[2]] : [];
      }, at);
    await expect.poll(dotColour).toEqual([30, 28, 25]);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(dotColour).toEqual([236, 228, 211]);
    expect(await page.evaluate(() => devicePixelRatio)).toBe(2);
    const canvas = page.locator("[role=application] canvas");
    expect(Number(await canvas.getAttribute("width"))).toBe(Math.round(v.box.width * 2));
  });
});

test.describe("desktop, zoomable boards (FR-13, NFR-5)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Ctrl + wheel zooms around the pointer; the wheel pans; clicks still land", async ({
    page,
  }) => {
    await page.goto("/play/giant-100");
    const before = await boardView(page);
    await page.mouse.move(before.box.x + 200, before.box.y + 200);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -200);
    await page.keyboard.up("Control");
    await expect.poll(async () => (await boardView(page)).cell).toBeGreaterThan(before.cell);
    const zoomed = await boardView(page);
    await page.mouse.wheel(0, 300);
    await expect.poll(async () => (await boardView(page)).y).toBeGreaterThan(zoomed.y);
    const p = await centreEdge(page);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => savedLines(page, "giant-100")).toBe(1);
  });

  test("the keyboard cursor keeps its edge in view", async ({ page }) => {
    await page.goto("/play/giant-100");
    await board(page).focus();
    for (let i = 0; i < 60; i++) await page.keyboard.press("ArrowRight");
    await expect(page.getByText("Row 1 · between columns 61 and 62 · empty").first()).toBeVisible();
    const v = await boardView(page);
    const cursor = await page.locator("rect.cursor").boundingBox();
    if (cursor === null) throw new Error("no cursor");
    expect(v.x).toBeGreaterThan(0);
    expect(cursor.x + cursor.width).toBeLessThanOrEqual(v.box.x + v.box.width);
  });

  test("tabbing to the board brings the cursor out from under the overview map", async ({
    page,
  }) => {
    await page.goto("/play/giant-100");
    for (
      let i = 0;
      i < 6 && !(await board(page).evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(page.locator("rect.cursor")).toBeVisible();
    const cursor = await page.locator("rect.cursor").boundingBox();
    const map = await page.getByRole("img", { name: /Overview/ }).boundingBox();
    if (cursor === null || map === null) throw new Error("missing box");
    const apart =
      cursor.x >= map.x + map.width ||
      cursor.y >= map.y + map.height ||
      cursor.x + cursor.width <= map.x ||
      cursor.y + cursor.height <= map.y;
    expect(apart).toBe(true);
  });

  test("board keys wait while a mouse stroke is held", async ({ page }) => {
    await page.goto("/play/small-7");
    const grid = createGrid(7, 7);
    const p = await edgePoint(page, grid, hEdgeIndex(grid, 0, 0));
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.keyboard.press("x");
    await page.mouse.up();
    await expect(lines(page)).toHaveCount(1);
    await expect(page.locator("[role=application] path.cross")).toHaveCount(0);
  });
});

test.describe("short desktop window (NFR-2)", () => {
  test.use({ viewport: { width: 1280, height: 600 } });

  test("a zoomable board fits the window's height", async ({ page }) => {
    await page.goto("/play/giant-100");
    const v = await boardView(page);
    expect(v.box.y + v.box.height).toBeLessThanOrEqual(600);
  });
});
```

2. Create `apps/web/tests/perf.e2e.ts`:

```ts
import { expect, type Page, test } from "@playwright/test";
import { board, boardView, dotAt, savedLines } from "./board.ts";

// Frame-time checks for NFR-2, run with `bun run test:perf`; `bun run test:e2e` skips them. The CPU
// is slowed 4× to stand in for a mid-range phone. Headless Chromium paces frames at 60 Hz, so a
// frame interval near 16.7 ms means the page kept up.

/** Starts recording the time between animation frames. */
async function startFrames(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { frames_: number[]; stop_: boolean };
    w.frames_ = [];
    w.stop_ = false;
    let last = performance.now();
    const loop = (t: number) => {
      w.frames_.push(t - last);
      last = t;
      if (!w.stop_) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

/** Stops recording; returns the median, 95th percentile and worst frame interval in ms. */
async function stopFrames(page: Page) {
  const frames = await page.evaluate(() => {
    const w = window as unknown as { frames_: number[]; stop_: boolean };
    w.stop_ = true;
    return w.frames_.slice(1);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { count: frames.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
}

async function slowCpu(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return cdp;
}

test.describe("@perf frame times", () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

  test("drawing on a 30×30 SVG board keeps 60 fps", async ({ page }) => {
    await page.goto("/play/big-30");
    await expect(board(page)).toBeVisible();
    const cdp = await slowCpu(page);
    // A stroke back and forth along row 3, one touch move per frame's worth of finger travel.
    const path: { x: number; y: number }[] = [];
    for (let k = 0; k < 4; k++) {
      for (let c = 0; c <= 6; c++) path.push(await dotAt(page, 3, k % 2 === 0 ? c : 6 - c));
    }
    const moves: { x: number; y: number }[] = [];
    for (let i = 1; i < path.length; i++) {
      for (let s = 1; s <= 4; s++) {
        moves.push({
          x: path[i - 1].x + ((path[i].x - path[i - 1].x) * s) / 4,
          y: path[i - 1].y + ((path[i].y - path[i - 1].y) * s) / 4,
        });
      }
    }
    await startFrames(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [path[0]] });
    for (const p of moves) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const f = await stopFrames(page);
    console.log(`30×30 SVG drawing: ${JSON.stringify(f)}`);
    // The stroke must really have drawn, or the frame times mean nothing.
    expect(await savedLines(page, "big-30")).toBeGreaterThan(0);
    expect(f.p95).toBeLessThan(20);
    expect(f.max).toBeLessThan(50);
  });

  test("pinch and pan on a 100×100 canvas board stay smooth", async ({ page }) => {
    await page.goto("/play/giant-100");
    await expect(board(page)).toBeVisible();
    const cdp = await slowCpu(page);
    const v = await boardView(page);
    const cx = v.box.x + v.box.width / 2;
    const cy = v.box.y + v.box.height / 2;
    await startFrames(page);
    // Pinch out to the whole board, back in, then pan around.
    const fingers = (spread: number, dx: number, dy: number) => [
      { x: cx - spread + dx, y: cy + dy, id: 0 },
      { x: cx + spread + dx, y: cy + dy, id: 1 },
    ];
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: fingers(120, 0, 0),
    });
    for (let i = 0; i <= 30; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: fingers(120 - i * 3.5, 0, 0),
      });
    }
    for (let i = 0; i <= 30; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: fingers(15 + i * 3.5, 0, 0),
      });
    }
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * 2 * Math.PI;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: fingers(120, Math.cos(a) * 80 - 80, Math.sin(a) * 80),
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const f = await stopFrames(page);
    console.log(`100×100 canvas pinch and pan: ${JSON.stringify(f)}`);
    expect(f.p95).toBeLessThan(20);
    expect(f.max).toBeLessThan(50);
  });
});
```

3. In `apps/web/package.json`, replace

```json
    "test:e2e": "playwright test"
```

with

```json
    "test:e2e": "playwright test --grep-invert @perf",
    "test:perf": "playwright test --grep @perf"
```

4. In the root `package.json`, replace

```json
    "test:e2e": "bun run --cwd apps/web test:e2e"
```

with

```json
    "test:e2e": "bun run --cwd apps/web test:e2e",
    "test:perf": "bun run --cwd apps/web test:perf"
```

Verify: `bun run check` passes; `bun run test:e2e` gives 37 passed; `bun run test:perf` gives 2 passed and prints two lines like `30×30 SVG drawing: {"count":108,"p50":16.7,"p95":16.7,"max":16.8}`. Run `bun run test:e2e` a second time to make sure nothing is flaky.

Commit: `test(web): cover zoom, pan, the overview map and canvas drawing`

### Step 7 — docs

1. `README.md`:
   - In the Status paragraph, replace `error highlighting, solve detection, light and dark themes, and progress saved in the browser.` with `error highlighting, solve detection, light and dark themes, and progress saved in the browser. Boards too big for the screen zoom and pan (pinch, wheel or the zoom buttons) with an overview map, and boards over 30×30 draw on a canvas.`
   - Directly after the code block containing `bun run test:e2e` (in "Web app"), add a blank line and this paragraph:

```
`bun run test:perf` runs the frame-time checks for drawing and zooming large boards, with the CPU slowed to stand in for a mid-range phone. They are kept apart because their timings depend on the machine.
```

   - In the Scripts table, directly after the `bun run test:e2e` row (before the `bun run --cwd packages/core bench` row), add the row `` | `bun run test:perf` | Build the web app and run its frame-time checks | ``.

2. Replace `apps/web/AGENTS.md`:

```markdown
# web

The Loophole player app: a SvelteKit single-page app (Svelte 5 runes, static adapter with an `index.html` fallback, no server-side rendering). Small boards render as SVG and large ones on a canvas, under one input surface that takes touch, mouse and keyboard input. Boards too big to fit at a tappable size zoom and pan instead of shrinking.

- Game logic (edge history, stopwatch, hit-testing, drag strokes, keyboard cursor, saved progress, theme choice) lives in plain TypeScript modules with `bun:test` tests beside them. Keep those modules free of runes, `$lib`/`$app` imports and DOM access so the root `bun test` runs them. Components stay thin; the Playwright end-to-end tests cover them.
- One set of board geometry and zoom math serves both renderers and all input: a board point is the viewport point plus the view offset, in pixels at the current cell size. A new kind of mark has to be drawn in both the SVG and the canvas renderer.
- Rule checks and completion come from the core package (`analyzeBoard`), not from code here.
- Screens get puzzles through the puzzle source interface, so the built-in fixtures can be replaced by the API without touching the screens.
- Theme colours come from the CSS custom properties in the app stylesheet, which follow the design kit (`docs/design/README.md`). Book-cover tints are the one exception: they are the same in both themes.
- App code type-checks without Bun's types; tests and test helpers use a second config that adds them.
- End-to-end tests end in `.e2e.ts` and run with `bun run test:e2e`. They need a local Chromium and are not part of `bun run check`. Frame-time checks are tagged `@perf` and run with `bun run test:perf` instead.
- The large fixtures are generated by a script; change the script and regenerate them rather than editing them by hand.
- Biome lints `.svelte` files but does not format them, because its Svelte formatter is still experimental. Follow the style of the existing components.
```

3. `docs/TESTING.md`: append this paragraph at the end of the file (after a blank line):

```
Frame-time checks (`tests/perf.e2e.ts`, tagged `@perf`) slow the CPU down and measure animation frames while drawing and zooming large boards. `bun run test:e2e` skips them; run them with `bun run test:perf`. They stay out of the gate because their timings depend on the machine.
```

4. `docs/DECISIONS.md`: append these entries at the end of the file:

```markdown
## 2026-10-25 · WT5 `web-large-grids` · Large boards zoom instead of shrinking
- **Question:** WT4 let wide boards shrink below 44 px cells on phones. How do they reach 44 px (FR-13), and what does zooming cover?
- **Decision:** A board zooms when the WT4 fit gives cells under the minimum (44 px on touch, 24 px with a mouse), which depends only on the screen's width. Its viewport then takes the height left on the screen (on phones the space between the status line and the notes and tray, at least five cells; on desktops the window's height below the header), never the board's own size, so it follows rotation and browser bars. On phones the notes keep room for a one-message error card, so the board's height only changes when a second kind of error shows; when it does change, the view keeps its offset, so the board doesn't move under a finger. The board opens at the minimum cell size at the top-left corner and zooms from "whole board on screen" up to 88 px cells. It may be pulled past its top-left corner by up to 104 px and past its bottom-right corner by up to 68 px, but never further than it overflows the viewport, so edges under the overview map and the zoom controls can be brought out and tapped, the keyboard cursor pans out from under them, and zoomed all the way out the whole board is still on screen. Zooming out below 44 px is allowed for looking around, and taps still work there with the same nearest-edge diamonds. The view is kept while paused but not saved across reloads. Boards that fit are drawn exactly as in WT4.
- **Reason:** It keeps every board readable and tappable at the kit's 44 px while the whole board is still one pinch away, and leaves small boards untouched.

## 2026-10-25 · WT5 `web-large-grids` · Telling drawing from panning
- **Question:** On a zoomable board, how does a finger draw, and how does the player pan and zoom (FR-13)?
- **Decision:** One finger (or the mouse) always taps and draws, as before. A second finger turns the gesture into a pinch: the stroke stops (a tap never fires, and lines a stroke already drew stay), and the two fingers zoom with their distance and pan with their midpoint until both are up. On desktops Ctrl/⌘ + wheel and trackpad pinch zoom around the pointer, the wheel and two-finger trackpad scroll pan, `+`/`=` and `-` zoom around the edge cursor, and arrow keys pan to keep the cursor's edge in view. The `−`/`+` buttons and an overview map (tap or drag to move the view) sit on the board as on the Night artboard. Board keys are ignored while a pointer stroke is held. A solved board still pinches, wheels and pans, but takes no keys (it leaves the Tab order, as in WT4), so the `+ / −` row of the keyboard help is hidden then.
- **Reason:** Drawing is the main action and stays one finger with no mode switch; two fingers for pan and zoom is what phone maps do. A pinch almost always lands before the first finger passes the drag slop, so undoing stray strokes isn't worth the extra state.

## 2026-10-25 · WT5 `web-large-grids` · Canvas above 30×30, SVG zoom by transform
- **Question:** How are large boards drawn, and how does the SVG board stay smooth while zooming (NFR-2)?
- **Decision:** Boards wider or taller than 30 draw on a canvas at the device pixel ratio, painting only the cells in the viewport plus a one-cell border, at most once per animation frame, with colours read from the theme's CSS properties (repainted when the theme or the clue font changes). Below 8 px cells clue digits are left out, and dots and lines never take more than 0.4 of a cell; neither rule changes anything from 10 px cells up. The SVG board scales one `<g>` with a transform while the zoom changes and lays its marks out again at the kit's sizes 150 ms after it stops. The 4× CPU-throttled frame check measured p95 16.7 ms for drawing on a zoomed 30×30 SVG board and for pinching and panning a 100×100 canvas board.
- **Reason:** A 100×100 board has 30 000 marks, too many DOM nodes to move every frame; culling keeps a frame to a few hundred. One transform per frame keeps SVG pinch-zoom cheap without giving up crisp marks at rest.

## 2026-10-25 · WT5 `web-large-grids` · Large practice fixtures with every clue shown
- **Question:** The generator doesn't exist yet. Where do 20×20 to 100×100 boards for layout and performance work come from?
- **Decision:** `apps/web/scripts/large-fixtures.ts` grows and reshapes a random region with core's seeded generator (each step keeps the boundary one simple loop), takes the boundary as the solution and shows every clue. It writes four fixtures (20×20, 30×30, 40×40, 100×100) and their solutions; the output is deterministic. The fixture test checks with core's `verify` (node budget, no time limit) that every fixture has exactly one solution; the rules alone solve the large ones, with no search.
- **Reason:** Real loops give realistic line density for rendering and timing, and full clues make uniqueness easy to prove. They are easy puzzles; generated ones replace them when the server serves puzzles.

## 2026-10-25 · WT5 `web-large-grids` · Frame-time check outside the gate
- **Question:** How is "60 fps drawing up to 30×30, smooth large boards" (NFR-2) checked?
- **Decision:** `tests/perf.e2e.ts`, tagged `@perf`, slows the CPU 4× through the Chrome DevTools Protocol and records animation-frame intervals while drawing on a zoomed 30×30 SVG board and while pinching and panning the 100×100 canvas board. It fails if the 95th percentile reaches 20 ms or any frame reaches 50 ms. `bun run test:perf` runs it; `bun run test:e2e` skips it.
- **Reason:** Frame timing depends on the machine, so it can't be a reliable gate, but a scripted check catches large regressions and prints numbers to compare.
```

Verify: `bun run check` passes; `git diff --stat main` shows no file under `packages/`.

Commit: `docs: describe zoomable and canvas boards and the frame-time check`

### Step 8 — final check

```sh
bun run check
bun run test:e2e
bun run test:perf
git status --short          # clean
git diff --stat main -- packages   # empty
```

All must pass. Do not merge; the orchestrator reviews the branch.

## Acceptance criteria

| Id | Criterion | Checked by |
|---|---|---|
| FR-13 | Touch cells are ≥ 44 px: a board whose fit would be smaller opens zoomed at 44 px (10×10 at 360 px wide) | e2e "a 10×10 opens zoomed to 44px cells…" |
| FR-13 | Pinch-zoom and pan: two fingers zoom with their distance and pan with their midpoint, without drawing; zoom stays within whole-board…88 px | `viewport.test.ts` (`pinchView`, `clampView`, `zoomLimits`), `pointers.test.ts`; e2e "two fingers pinch to zoom and pan without drawing" |
| FR-13 | One finger still taps and drags on zoomed SVG and canvas boards, with the same diamond hit-testing | e2e "taps and drags draw on the zoomed board", "draws on a zoomed canvas board"; existing `geometry.test.ts`/`gesture.test.ts` unchanged |
| FR-13 | Desktop: Ctrl/⌘ + wheel zooms around the pointer, wheel pans; ± buttons zoom | e2e "Ctrl + wheel zooms…", "zoom buttons zoom in and out" |
| FR-13 | Overview map shows the viewport and jumps on tap | `viewport.test.ts` (`miniRect`, `miniJump`); e2e "tapping the overview map moves the view there" |
| FR-13 | No edge stays under the overview map or zoom controls: the board overscrolls past its corners, by no more than it overflows | `viewport.test.ts` (`clampView` overscroll and "shrinks with the overflow", `revealRect` overlays); e2e "the board pans past its corner so edges under the overview map can be tapped" |
| FR-13 | Zoomed all the way out, the whole board is on screen | `viewport.test.ts` property "the whole board is on screen at the smallest zoom, from any view", "zooming out step by step…"; e2e "zoomed all the way out, the whole board is on screen" |
| FR-13 | Taps land correctly on a zoomed and panned board (view offset sign) | e2e "two fingers pinch … then taps draw where they land", "Ctrl + wheel … clicks still land" |
| NFR-2 | A zoomable board's viewport follows the screen: it shrinks on resize, keeps its height when one error appears with the tray still on screen, and fits a short desktop window | e2e "a zoomable board shrinks with the window", "one error keeps the board's height and the tool tray on screen", "a zoomable board fits the window's height" |
| NFR-2 | Canvas with viewport culling above 30×30; devicePixelRatio-aware | `paint.test.ts` "draws only the cells in view"; code review of `BoardCanvas.svelte` |
| NFR-2 | 60 fps drawing on 30×30 SVG; smooth pinch/pan on 100×100 canvas (4× CPU throttle) | `bun run test:perf` (p95 < 20 ms, max < 50 ms, stroke must draw; prototype: p95 16.8 ms both) |
| NFR-2 | No horizontal scroll at 360 px with zoomable boards | e2e "a 10×10 opens zoomed…" (`scrollsSideways`), existing phone tests |
| NFR-5 | Keyboard cursor keeps its edge in view and out from under the overview map; `+`/`−` zoom; board keys ignored mid-stroke | `viewport.test.ts` (`revealRect`); e2e "the keyboard cursor keeps its edge in view", "tabbing to the board brings the cursor out from under the overview map", "board keys wait while a mouse stroke is held" |
| NFR-2 | SVG marks are laid out again at the kit's sizes after a zoom | e2e "zoom buttons zoom in and out; the SVG marks are laid out again at the new size" |
| FR-15, FR-16, FR-17 | Canvas board draws error rings, dashed loop, crosses, solved wash in both themes and repaints on theme change at 2× pixel density; seal unchanged | `paint.test.ts` "rings broken clues and dots"; e2e "the canvas board follows a theme change" (`deviceScaleFactor: 2`); prototype screenshots |
| FR-5 (fixtures) | Every fixture has exactly one solution | `fixtures.test.ts` with core's `verify` |
| Gate | `bun run check` green after every step; no new dependency; `packages/core` untouched | Steps 1–8 |
| Follow-ups | [WT5] 44 px via zoom; [WT5] keys ignored during a gesture | Step 5; e2e as above |

## Prototype

The whole plan was built in a scratch clone (`/tmp/claude-1000/-home-jhonnold-projects-loophole/a34715f6-7810-5a69-ba81-edd46bda034d/scratchpad/web-large-grids/proto`, branch `proto`, one commit per step, rebased on main `0144139`, revised for plan reviews 1 and 2). A fresh clone passed `bun install --frozen-lockfile` and `bun run check` at every step commit; `bun run test:e2e` gave 21 passed at Step 5 and 37 passed at the end, and 148 passed with `--repeat-each 4`. `bun run test:perf` printed `30×30 SVG drawing: p50 16.7, p95 16.7, max 16.8` and `100×100 canvas pinch and pan: p50 16.7, p95 16.8, max 16.8` (ms, 4× CPU throttle). The fixture checksums are unchanged on the new main, and `verify` from main reports all fixtures `unique`.

Screenshots are in `/tmp/claude-1000/-home-jhonnold-projects-loophole/a34715f6-7810-5a69-ba81-edd46bda034d/scratchpad/web-large-grids/shots/`: `night-10-390.png` (Night artboard's marks: 44 px cells, overview map, 133% zoom pill, error rings), `huge-40-night-390.png` (canvas in Night with errors), `giant-100-390.png` and `giant-100-390-fit.png` (canvas at 44 px and zoomed out), `large-20-360.png` (Small phone), `giant-100-desktop.png` (keyboard cursor scrolled into view), `big-30-desktop-solved.png` (SVG, fits on desktop) and `giant-100-desktop-solved.png` (canvas solved wash and seal).

Known differences from the Night artboard, by design: the view opens at the top-left corner rather than panned to the middle; once the board is pulled past a corner (by the player, by the keyboard cursor reaching an edge under the overview map, or by zooming out around a point while it still overflows), an empty strip of sheet, at most the board's overflow wide, shows there until they pan back; the "Pinch or use +/− to zoom" hint sits on the status line, which phones under 620 px tall hide (the zoom buttons stay); the overview map draws lines only, as in the artboard, so on a 100×100 board it is a dense texture.

## Unresolved questions

- Should zooming out below 44 px on touch be allowed? Default: yes, for looking at the whole board; input still works there (logged in DECISIONS).
- Should the view be saved with progress across reloads? Default: no; kept only while the page is open.

## Review responses (plan review 1)

1. **major, overlays hide edges** — fixed: `clampView` overscrolls 104 px past the top-left and 68 px past the bottom-right corner; `revealRect` moves the cursor's edge out from under the map (shorter way) and the zoom controls (up); Tab focus reveals the starting edge. Unit tests for the overscroll and both overlays; e2e "the board pans past its corner…" (taps h-edge (0,0)) and "tabbing to the board brings the cursor out from under the overview map".
2. **major, viewport only grows** — fixed: zoomable boards get a stage that flexes (phones, floor 5 cells, frame absolutely positioned, spacer hidden) or takes `100dvh − 118px` (desktop); the port no longer reads its own size or `stageMinHeight`. DECISIONS states that the port follows the notes and the window and the view keeps its offset. e2e for resize 700→560, tray on screen with errors at 360×560, and board bottom within a 1280×600 window.
3. **minor, no drawing on a panned board** — added taps after the two-finger pan (phone) and a click after the wheel pan (desktop), placed with the data-attribute geometry.
4. **minor, perf stroke may miss** — `perf.e2e.ts` now asserts `savedLines(page, "big-30") > 0`.
5. **minor, wheel leaks during a stroke** — `preventDefault()` now comes before the stroke check.
6. **minor, SVG re-layout and DPR untested** — the zoom-buttons test waits for the transform to end in `scale(1)` and checks the kit dot radius and spacing at 55 px; the canvas theme test runs at `deviceScaleFactor: 2` and checks the canvas's device-pixel width.
7. **minor, zoom keys on a solved board** — the `+ / −` legend row is hidden once solved; DECISIONS says solved boards take no keys.
8. **minor, AGENTS.md paths and numbers** — reworded without file paths or thresholds; those stay in DECISIONS and this plan.

## Review responses (plan review 2)

1. **major, board doesn't fit at the smallest zoom** — fixed as proposed: `clampAxis` allows `[−min(104, over), over + min(68, over)]` with `over = content − port`, and centres the board when `over ≤ 0`. Unit tests: a property that the whole board is on screen at `limits.min` from any view, "the overscroll shrinks with the overflow", and a zoom-out sequence that ends with the whole board on screen; e2e "zoomed all the way out, the whole board is on screen". One part of the suggested tests was not adopted: "zooming out around the centre from (0, 0) keeps x, y ≥ 0 while the overflow is ≥ 104" can't hold with this fix, because a zoom-out around the centre moves the corner inward by design. Instead, the test checks that the corner is never pulled further than the board overflows (or than centring takes), which is exactly the side effect the review accepts.
2. **minor, height jumps with the notes** — on phones `.zoom .notes { min-height: 68px }` (one error card, measured at 67.5 px at 360 and 390 wide) keeps the board's height when the first error appears or clears. e2e "one error keeps the board's height and the tool tray on screen" asserts equal heights. DECISIONS is updated.
3. **minor, hard-coded header metrics** — the header rules now read `--bar-height`, `--screen-top`, `--screen-gap` and `--screen-bottom` (set on `.screen` and its media queries), and the desktop stage height is computed from the same variables. This also fixes the 4 px error at desktop heights ≤ 620 px, where the bar is 48 px.

