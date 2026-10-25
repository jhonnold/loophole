# WT4 `web-board` — implementation plan

Branch `feat/web-board`, worktree `/home/jhonnold/projects/loophole-wt/web-board`. PRD: FR-13 (input), FR-14 (undo/redo, timer, pause, clear), FR-15 (error highlighting), FR-16 (themes), FR-17 (client-side completion), FR-21 (guest part: local progress), NFR-2 (360 px, no horizontal scroll), NFR-5 (keyboard play, contrast, not colour alone).

## Goal

A SvelteKit single-page app in `apps/web` that plays puzzles up to 30×30 as an SVG board on phones and desktops, matching the design kit (`docs/design/`, especially Play, Small, Night, Desktop, Main and Solved):

- Paper (light) and Night (dark) themes from the kit's tokens; follows the system, with a stored override.
- SVG board: dots, lines, crosses, clues, error rings, dashed premature loop, solved wash and the 完 seal.
- Input: tap/click cycles line → cross → empty using diamond hit areas that tile the board; drag draws a run of lines; keyboard edge cursor (ai capsule) with the Desktop artboard's keys.
- Undo/redo, timer, pause (hides the board), clear; error highlighting and solve detection from core's `analyzeBoard`.
- Guest progress in `localStorage`, keyed by puzzle id, restored on reload.
- Mobile web rules: `100dvh` + safe-area padding, no fixed bottom bar, tool tray under the board, no overscroll, usable at 360 px with no horizontal scroll and 44 px cells for a 7×7.
- Puzzles from three built-in fixtures behind a `PuzzleSource` interface.
- The web app wired into `bun run check` (Biome lint for `.ts`/`.svelte`, `svelte-check`, unit tests in the root `bun test`), plus Playwright end-to-end tests run separately.

Follow-ups from earlier reviews handled here:

- **[WT4] root `bun test` vs SvelteKit tests**: web unit tests cover plain TypeScript modules only (no `.svelte`, `$lib` or `$app` imports), so the root `bun test` runs them; components are covered by Playwright `*.e2e.ts` tests, outside the gate. Documented in `docs/TESTING.md`, `apps/web/AGENTS.md` and `docs/DECISIONS.md`.
- **[WT4] `dotCoords` / `cellCoords` in core**: added to `packages/core/src/grid.ts` with a round-trip property test next to the `edgeCoords` one (Step 1). The web app uses them instead of inline index math.

Out of scope: canvas renderer, culling, pinch-zoom/pan, overview map (WT5); API client and server puzzles (WT6); hints and the hint card (WT8); progress sync and guest→account migration (WT9); real Home, daily and Solved screens (WT11).

## How later worktrees use this

- **WT5 large grids**: the renderer is one component (`BoardView`) fed by `Layout` from `fitLayout`; input is in `PointerGesture` (single pointer, board pixel coordinates). A canvas renderer can reuse `geometry.ts` (`edgeAt`, `dotAt`, `edgeSegment`) and `gesture.ts` unchanged and add a zoom/pan transform before them. `fitLayout` already never exceeds the screen width; WT5 lifts cells back to 44 px with zoom.
- **WT6 server**: replace `fixtureSource` with an API-backed `PuzzleSource` in `src/lib/puzzles/index.ts` (one line). `get(id)` returns a parsed core `Puzzle`, so the generated client's wire JSON goes through `parsePuzzle`. Add the Vite dev proxy to `vite.config.ts` then.
- **WT8 hints**: the tool tray (`ToolBar`) sits in the play screen's notes column; the hint card replaces it there. `BoardView` would take extra overlay props (hint cells/dots, ghost edges).
- **WT9 sync**: `ProgressStore` (`load`/`save`/`clear` by puzzle id) is the seam; the stored JSON is versioned (`v: 1`).
- **WT11 Home/Solved**: the `/` page is a simple fixture list styled like the Home artboard's covers; WT11 replaces it.

## Design

### Packages and versions (verified with `npm view` on 2026-10-25)

| Package | Version | Why this one |
|---|---|---|
| `@sveltejs/kit` | 2.70.3 | Kit 3.x needs Node ≥ 22.17; host has Node 20.19. 2.70 supports Vite 8, vps 7, TS 6. |
| `@sveltejs/adapter-static` | 3.0.10 | Peer `@sveltejs/kit ^2.0.0` (4.x needs Kit 3). |
| `@sveltejs/vite-plugin-svelte` | 7.3.1 | Kit 2.70 accepts `^7.0.0`; needs Vite 8, Node ^20.19. |
| `vite` | 8.3.4 | Latest that is 2+ weeks old (8.3.5 is 4 days old). |
| `svelte` | 5.57.2 | Runes. |
| `svelte-check` | 4.7.7 | Peer TS ^6. |
| `@playwright/test` | 1.62.1 | Uses Chromium revision 1234, already in `~/.cache/ms-playwright` (1.64.x wants 1248, not installed). |
| `@fontsource/zen-kaku-gothic-new` | 5.3.1 | Self-hosted fonts. |
| `@fontsource/zen-maru-gothic` | 5.3.1 | Self-hosted fonts. |

All are devDependencies except the workspace dependency `@loophole/core`. Fast-check, TypeScript, Biome and `@types/bun` come from the root.

### Architecture

- **Plain TS game modules** (`src/lib/game/*.ts`, tested with `bun:test`): `board.ts` (immutable edge array + undo/redo of multi-edge moves, drag-stroke merging, clear), `timer.ts` (pausable stopwatch as data, `formatClock`), `geometry.ts` (`fitLayout`, dot/edge/cell pixel positions, diamond hit-test `edgeAt`, `dotAt`, `dotPath`), `gesture.ts` (`PointerGesture`: tap vs drag stroke), `keyboard.ts` (`moveCursor`, key → command, edge labels), `inside.ts` (cells inside the loop for the solved wash), `messages.ts` (violation texts), `progress.ts` (`ProgressStore` over a `Storage`-like object). `src/lib/theme.ts` holds the theme choice. These import only `@loophole/core` and relative paths.
- **Puzzle seam** (`src/lib/puzzles/`): `PuzzleSource { list(); get(id) }`, `fixtureSource`, and `puzzleSource` exported from `index.ts`.
- **Components** (`src/lib/components/`): `BoardView` (SVG + pointer + keyboard → `onedit(changes, merge)`), `PlayScreen` (state, history, timer, persistence, layout), `ToolBar`, `PauseButton`, `SolvedSeal`, `ThemeSwitch`.
- **Routes**: `/` (fixture list + theme switch), `/play/[id]` (play screen), `+error.svelte`. Root `+layout.ts` sets `ssr = false`; adapter-static writes `build/` with an `index.html` fallback; `paths.relative = false` so assets resolve at any depth.

### Board drawing (cell size S, from the design kit)

Dots: circles of diameter `max(4, round(0.11·S))`. Lines: SVG `<line>` with `stroke-width = max(2, round(0.11·S))` and round caps (the cap gives the half-thickness overrun at dots). Crosses: two pencil strokes, arms `0.1·S`, width `max(1.5, 0.05·S)`. Clues: Zen Kaku Gothic New 500 at `0.56·S`, centred. Errors: 2 px shu ring, radius `0.34·S − 1` around clues and `0.26·S − 1` around dots; premature-loop lines dashed shu `6 5`. Solved: sakura wash on inside cells, then the 完 seal (92 px, rotated −8°) at the frame's top right. Keyboard focus: ai capsule `S + 12` long and `max(20, round(0.48·S))` thick, plus a label like "Row 8 · between columns 4 and 5 · empty". The frame is sheet-coloured with a 2 px ink border and a 4 px (6 px on desktop) offset ink shadow; Night has no shadow.

### Layout

- Phones: header (back, title + subtitle, timer pill), status line ("n of m clues satisfied"), board, notes (idle tip, error list or solved card), spacer, tool tray. `min-height: 100dvh`, safe-area bottom padding. The board's room is the stage plus the spacer (both measured with `bind:clientHeight`), so the board's size doesn't change as notes come and go. Below 380 px wide the side gutter is 14 px (Small artboard: a 7×7 at 44 px cells is 328 px). Below 620 px tall the status line moves into the header subtitle and gaps tighten.
- ≥ 900 px: two columns. Board on the left (stage fills the column), and on the right a Time card (big clock, Pause `P`), the notes, the tools as a 2×2 grid with key hints, and a Keyboard card (Desktop artboard).
- `fitLayout(cols, rows, w, h, minCell, maxCell)`: largest cell that fits, ≤ 58; ≥ 44 on `(pointer: coarse)`, ≥ 24 otherwise, but never wider than `w`. Margin `max(10, min(round(0.34·S), slack))` — reproduces Small (44/10 → 328), Play (46/16 → 354) and Desktop (58/20 → 620).

### Input

- Tap: a press that moves less than `max(8 px, S/4)`; on release, the edge whose diamond (the two cell-diagonal triangles touching it) holds the press point cycles line → cross → empty.
- Drag: beyond the slop, the stroke follows the nearest dots (sampled every ¼ cell so fast swipes don't skip) and marks the edge between consecutive dots. First edge a line → the stroke erases lines; otherwise it draws lines, over crosses too. One undo step per stroke (`applyChanges(…, merge)`).
- One pointer at a time; mouse button 0 only. `touch-action: none`, no text selection or callout on the board; buttons have `touch-action: manipulation`; `overscroll-behavior: none` on the page.
- Keyboard (board focused): arrows move the cursor (rows alternate horizontal/vertical edges; up/down keep to the left side of the column), Space/Enter cycle, X cross, Backspace/Delete empty. Anywhere on the play screen: Z/Y (and Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl+Y) undo/redo, P pause/resume. The capsule shows only while the board has focus and the keyboard was used last.

### State and persistence

`PlayScreen` holds `board` (`$state.raw` of an immutable `Board`), `watch` (stopwatch), `paused`, `now` (ticks every 250 ms). `analysis = analyzeBoard(puzzle, board.edges)` drives rings, the clue counter, messages and `solved`. Solving stops the clock, saves `solved: true` and locks input; the solved card offers "Start over". The clock pauses (board hidden) when the tab is hidden. Progress is saved after every move, pause, solve, tab hide, `pagehide` and on leaving the screen, as `loophole:progress:<id>` → `{"v":1,"edges":"…","elapsedMs":…,"solved":…}` (edge string per `docs/FORMAT.md`). Undo history is not saved. Theme: `loophole:theme` = `light` | `dark` (absent = system), applied before first paint by an inline script in `app.html`.

## Environment notes for the implementer

- Run `export PATH="$HOME/.bun/bin:$PATH"` in every shell. Work in `/home/jhonnold/projects/loophole-wt/web-board`.
- Node 20.19 is on the host; SvelteKit's CLI and Playwright run on it.
- Chromium revision 1234 is in `~/.cache/ms-playwright`, which matches `@playwright/test` 1.62.1. If `bun run test:e2e` says a browser is missing, run `cd apps/web && bunx playwright install chromium` once.
- Port 4173 must be free for the e2e tests (`ss -ltnp | grep 4173`); a leftover `vite preview` makes Playwright fail fast.
- Another worktree (`core-solver`) is editing the core package's solver files at the same time. In core, only append to `grid.ts` and `grid.test.ts` exactly as in Step 1; touch nothing else in `packages/core`.
- `.svelte` files are linted by Biome but not formatted by it. Copy the component code exactly as given (2-space indent inside `<script>` and `<style>`). `bun run format` only rewrites `.ts`/`.js`/`.json`.
- Create every file with exactly the content shown. Where a step says "replace", replace the whole file.

## Steps

### Step 1 — core: `cellCoords` and `dotCoords`

1. Append to the end of `packages/core/src/grid.ts`:

```ts
export interface Coords {
  readonly row: number;
  readonly col: number;
}

/** Row and column of a cell; inverts `cellIndex`. */
export function cellCoords(grid: Grid, cell: number): Coords {
  return { row: Math.floor(cell / grid.width), col: cell % grid.width };
}

/** Row and column of a dot; inverts `dotIndex`. */
export function dotCoords(grid: Grid, dot: number): Coords {
  return { row: Math.floor(dot / (grid.width + 1)), col: dot % (grid.width + 1) };
}
```

2. In `packages/core/src/grid.test.ts`, add `cellCoords` and `dotCoords` to the import from `./grid.ts` (keep the list sorted: `cellCoords, cellIndex, createGrid, dotCoords, dotIndex, edgeCoords, hEdgeIndex, NONE, vEdgeIndex`), then add this test as the last test inside `describe("index helpers", …)` (just before that block's closing `});`):

```ts
  test("cellCoords and dotCoords invert cellIndex and dotIndex", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 20 }), (w, h) => {
        const g = createGrid(w, h);
        for (let i = 0; i < g.cellCount; i++) {
          const { row, col } = cellCoords(g, i);
          expect(row >= 0 && row < h && col >= 0 && col < w).toBe(true);
          expect(cellIndex(g, row, col)).toBe(i);
        }
        for (let d = 0; d < g.dotCount; d++) {
          const { row, col } = dotCoords(g, d);
          expect(row >= 0 && row <= h && col >= 0 && col <= w).toBe(true);
          expect(dotIndex(g, row, col)).toBe(d);
        }
      }),
      { numRuns: 30 },
    );
  });
```

Verify: `bun test packages/core/src/grid.test.ts` passes; `bun run check` passes.

Commit: `feat(core): add cellCoords and dotCoords`

### Step 2 — scaffold the SvelteKit app and wire it into the gate

1. Replace the root `.gitignore`:

```
node_modules/
dist/
coverage/
*.log
.DS_Store
.env
.env.*
!.env.example
.svelte-kit/
build/
test-results/
playwright-report/
```

2. Replace the root `biome.json` (adds `html.experimentalFullSupportEnabled` so Biome lints `.svelte` files with the template in view):

```json
{
  "$schema": "https://biomejs.dev/schemas/2.6.3/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": true,
    "includes": ["**", "!docs/design", "!**/*.md"]
  },
  "formatter": {
    "indentStyle": "space",
    "lineWidth": 100
  },
  "html": {
    "experimentalFullSupportEnabled": true
  }
}
```

3. Replace the root `package.json` (adds `dev:web` and `test:e2e`):

```json
{
  "name": "loophole",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.3.13",
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "lint": "biome check .",
    "format": "biome check --write .",
    "typecheck": "bun run --filter '*' typecheck",
    "test": "bun test",
    "check": "bun run lint && bun run typecheck && bun run test",
    "dev:web": "bun run --cwd apps/web dev",
    "test:e2e": "bun run --cwd apps/web test:e2e"
  },
  "devDependencies": {
    "@biomejs/biome": "2.6.3",
    "@types/bun": "1.3.13",
    "fast-check": "4.10.2",
    "typescript": "6.0.3"
  }
}
```

4. Create `apps/web/package.json`:

```json
{
  "name": "@loophole/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --fail-on-warnings && tsc -p tsconfig.test.json",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@loophole/core": "workspace:*"
  },
  "devDependencies": {
    "@fontsource/zen-kaku-gothic-new": "5.3.1",
    "@fontsource/zen-maru-gothic": "5.3.1",
    "@playwright/test": "1.62.1",
    "@sveltejs/adapter-static": "3.0.10",
    "@sveltejs/kit": "2.70.3",
    "@sveltejs/vite-plugin-svelte": "7.3.1",
    "svelte": "5.57.2",
    "svelte-check": "4.7.7",
    "vite": "8.3.4"
  }
}
```

5. Create `apps/web/svelte.config.js`:

```js
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Single-page app: every route is rendered in the browser from this fallback page.
    adapter: adapter({ fallback: "index.html" }),
    // The fallback page is served at every depth, so asset URLs must be absolute.
    paths: { relative: false },
  },
};

export default config;
```

6. Create `apps/web/vite.config.ts`:

```ts
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
});
```

7. Create `apps/web/tsconfig.json` (app code: no Bun types; tests excluded):

```json
{
  "extends": ["../../tsconfig.base.json", "./.svelte-kit/tsconfig.json"],
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "types": []
  },
  "exclude": ["src/**/*.test.ts", "src/lib/test-support", "tests"]
}
```

8. Create `apps/web/tsconfig.test.json` (tests and helpers, with Bun types):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["bun"]
  },
  "include": ["src/**/*.ts", "tests", "playwright.config.ts"],
  "exclude": []
}
```

9. Create `apps/web/src/app.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <link rel="icon" href="%sveltekit.assets%/favicon.svg" type="image/svg+xml" />
    <title>Loophole</title>
    <script>
      // Apply a saved theme before the first paint, so a dark-mode user never sees a light flash.
      try {
        const theme = localStorage.getItem("loophole:theme");
        if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
      } catch {
        // Storage blocked: follow the system theme.
      }
    </script>
    %sveltekit.head%
  </head>
  <body>
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

10. Create `apps/web/src/app.d.ts`:

```ts
// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {}
}

export {};
```

11. Create `apps/web/src/app.css` (design tokens; Paper default, Night by override or system):

```css
/* Design tokens from docs/design/README.md. Paper (light) is the default; Night (dark) applies when
   the user picks it, or when they follow the system and the system is dark. */
:root {
  color-scheme: light;
  --ground: #f4efe3;
  --sheet: #fffdf8;
  --ink: #1e1c19;
  --ink-soft: #5b554b;
  --pencil: #8c8476;
  --hairline: #ddd3c0;
  --shu: #c23b22;
  --ai: #2e4c8a;
  --ai-wash: rgb(46 76 138 / 0.12);
  --solved-wash: #f8e1e6;
  --disabled: #a69e90;
  --on-ink: #fffdf8;
  --frame-shadow: var(--ink);
  --font-ui: "Zen Kaku Gothic New", system-ui, sans-serif;
  --font-display: "Zen Maru Gothic", "Zen Kaku Gothic New", system-ui, sans-serif;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --ground: #111827;
  --sheet: #1a2438;
  --ink: #ece4d3;
  --ink-soft: #a7afbf;
  --pencil: #6f7a8f;
  --hairline: #2c3850;
  --shu: #f2785e;
  --ai: #8fb1f0;
  --ai-wash: rgb(143 177 240 / 0.16);
  --solved-wash: rgb(242 120 94 / 0.16);
  --disabled: #5e6880;
  --on-ink: #111827;
  --frame-shadow: transparent;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --ground: #111827;
    --sheet: #1a2438;
    --ink: #ece4d3;
    --ink-soft: #a7afbf;
    --pencil: #6f7a8f;
    --hairline: #2c3850;
    --shu: #f2785e;
    --ai: #8fb1f0;
    --ai-wash: rgb(143 177 240 / 0.16);
    --solved-wash: rgb(242 120 94 / 0.16);
    --disabled: #5e6880;
    --on-ink: #111827;
    --frame-shadow: transparent;
  }
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  /* No pull-to-refresh or scroll chaining while drawing on a phone. */
  overscroll-behavior: none;
}

body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: 16px;
  line-height: 1.4;
  -webkit-tap-highlight-color: transparent;
}

a {
  color: inherit;
  text-decoration: none;
}

a:hover {
  color: var(--ai);
}

button {
  font: inherit;
  color: inherit;
  touch-action: manipulation;
}

:focus-visible {
  outline: 3px solid var(--ai);
  outline-offset: 2px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
```

12. Create `apps/web/static/favicon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 216 272"><title>Loophole</title><polyline points="14,14 182,14 182,126 126,126 126,238 70,238 70,126 14,126" fill="none" stroke="#1E1C19" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/><line x1="14" y1="126" x2="14" y2="14" stroke="#C23B22" stroke-width="28" stroke-linecap="round"/></svg>
```

13. Create `apps/web/src/routes/+layout.ts`:

```ts
// Single-page app: render everything in the browser (adapter-static serves index.html for every path).
export const ssr = false;
export const prerender = false;
```

14. Create `apps/web/src/routes/+layout.svelte`:

```svelte
<script lang="ts">
  import "@fontsource/zen-kaku-gothic-new/400.css";
  import "@fontsource/zen-kaku-gothic-new/500.css";
  import "@fontsource/zen-kaku-gothic-new/700.css";
  import "@fontsource/zen-maru-gothic/700.css";
  import "@fontsource/zen-maru-gothic/900.css";
  import "../app.css";

  let { children } = $props();
</script>

{@render children()}
```

15. Create a temporary `apps/web/src/routes/+page.svelte` (Step 7 replaces it):

```svelte
<h1>Loophole</h1>
```

16. Run `bun install` at the repo root (updates `bun.lock`).

Verify:
- `bun run check` passes (the web `typecheck` runs `svelte-kit sync`, `svelte-check` and `tsc`).
- `bun run --cwd apps/web build` ends with `Wrote site to "build"` and creates `apps/web/build/index.html`.
- `git status` shows no `.svelte-kit/` or `build/` files.

Commit: `build(web): scaffold SvelteKit app in the workspace`

### Step 3 — board history and stopwatch

Create `apps/web/src/lib/game/board.ts`:

```ts
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
```

Create `apps/web/src/lib/game/board.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { EdgeState } from "@loophole/core";
import fc from "fast-check";
import { applyChanges, clearAll, createBoard, hasMarks, nextState, redo, undo } from "./board.ts";

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
    expect(b1.past).toEqual([{ edges: [1, 2], before: [0, 0], after: [1, 2] }]);
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
    expect(b.past[1]).toEqual({ edges: [1, 0], before: [0, 2], after: [1, 0] });
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
```

Create `apps/web/src/lib/game/timer.ts`:

```ts
/**
 * A pausable stopwatch as plain data. `now` is passed in (milliseconds, e.g. `performance.now()` or
 * `Date.now()`), so the functions are pure and easy to test.
 */
export interface Stopwatch {
  /** Time banked from earlier running spans. */
  readonly bankedMs: number;
  /** When the current running span started, or null while stopped. */
  readonly since: number | null;
}

export function createStopwatch(bankedMs = 0): Stopwatch {
  return { bankedMs: Math.max(0, bankedMs), since: null };
}

export function isRunning(w: Stopwatch): boolean {
  return w.since !== null;
}

export function start(w: Stopwatch, now: number): Stopwatch {
  return w.since === null ? { bankedMs: w.bankedMs, since: now } : w;
}

export function stop(w: Stopwatch, now: number): Stopwatch {
  return w.since === null ? w : { bankedMs: elapsed(w, now), since: null };
}

export function elapsed(w: Stopwatch, now: number): number {
  return w.since === null ? w.bankedMs : w.bankedMs + Math.max(0, now - w.since);
}

/** `mm:ss` below an hour, `h:mm:ss` from an hour up. Rounds down to whole seconds. */
export function formatClock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
```

Create `apps/web/src/lib/game/timer.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createStopwatch, elapsed, formatClock, isRunning, start, stop } from "./timer.ts";

describe("stopwatch", () => {
  test("counts only running spans", () => {
    let w = createStopwatch();
    expect(elapsed(w, 1000)).toBe(0);
    w = start(w, 1000);
    expect(isRunning(w)).toBe(true);
    expect(elapsed(w, 4000)).toBe(3000);
    w = stop(w, 4000);
    expect(elapsed(w, 99_000)).toBe(3000);
    w = start(w, 100_000);
    expect(elapsed(w, 100_500)).toBe(3500);
  });

  test("start and stop are idempotent", () => {
    const running = start(createStopwatch(), 10);
    expect(start(running, 50)).toBe(running);
    const stopped = createStopwatch(20);
    expect(stop(stopped, 50)).toBe(stopped);
  });

  test("resumes from banked time and never goes negative", () => {
    expect(elapsed(createStopwatch(5000), 0)).toBe(5000);
    expect(createStopwatch(-1).bankedMs).toBe(0);
    expect(elapsed(start(createStopwatch(), 100), 50)).toBe(0);
  });
});

describe("formatClock", () => {
  test("pads minutes and seconds", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(252_000)).toBe("04:12");
    expect(formatClock(59_999)).toBe("00:59");
    expect(formatClock(3_599_000)).toBe("59:59");
  });

  test("adds hours from one hour up", () => {
    expect(formatClock(3_600_000)).toBe("1:00:00");
    expect(formatClock(43_495_000)).toBe("12:04:55");
  });
});
```

Verify: `bun test apps/web` passes (board: cycle, single step per move, merge, undo/redo property, clear; timer: spans, idempotence, formatting). `bun run check` passes.

Commit: `feat(web): add board history and stopwatch`

### Step 4 — geometry, drag strokes, keyboard cursor, inside cells, messages

Create `apps/web/src/lib/game/geometry.ts`:

```ts
import { cellCoords, dotCoords, type Grid, NONE } from "@loophole/core";

/**
 * Pixel layout of a board: `cell` is the cell size S from the design kit, `margin` the paper
 * border around the dots. Dot (row, col) sits at (margin + col·cell, margin + row·cell).
 */
export interface Layout {
  readonly cell: number;
  readonly margin: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** Narrowest paper border around the dots. */
export const MIN_MARGIN = 10;
/** Cells are never smaller than this on touch screens (FR-13). */
export const TOUCH_MIN_CELL = 44;
/** Smallest cell for mouse and keyboard play. */
export const POINTER_MIN_CELL = 24;
/** Largest cell, as on the desktop artboard. */
export const MAX_CELL = 58;

/**
 * The largest layout that fits `availWidth` × `availHeight`, with cells between `minCell` and
 * `maxCell`. Width always wins: the board never gets wider than `availWidth` (NFR-2), so a wide
 * puzzle on a narrow screen gets smaller cells than `minCell`; pinch-zoom for those comes later.
 * Height gives way to `minCell`, and the page scrolls vertically instead.
 */
export function fitLayout(
  cols: number,
  rows: number,
  availWidth: number,
  availHeight: number,
  minCell: number,
  maxCell: number,
): Layout {
  const byWidth = Math.floor((availWidth - 2 * MIN_MARGIN) / cols);
  const byHeight = Math.floor((availHeight - 2 * MIN_MARGIN) / rows);
  let cell = Math.min(byWidth, byHeight, maxCell);
  cell = Math.max(cell, Math.min(minCell, byWidth), 1);
  const room = Math.min(availWidth - cols * cell, availHeight - rows * cell) / 2;
  const margin = Math.max(MIN_MARGIN, Math.min(Math.round(cell * 0.34), Math.floor(room)));
  return { cell, margin, width: cols * cell + 2 * margin, height: rows * cell + 2 * margin };
}

/** The height a board needs at its smallest allowed cell size for `availWidth`. */
export function minBoardHeight(
  cols: number,
  rows: number,
  availWidth: number,
  minCell: number,
): number {
  const byWidth = Math.floor((availWidth - 2 * MIN_MARGIN) / cols);
  return rows * Math.max(1, Math.min(minCell, byWidth)) + 2 * MIN_MARGIN;
}

export function dotPoint(grid: Grid, layout: Layout, dot: number): Point {
  const { row, col } = dotCoords(grid, dot);
  return { x: layout.margin + col * layout.cell, y: layout.margin + row * layout.cell };
}

export function cellPoint(grid: Grid, layout: Layout, cell: number): Point {
  const { row, col } = cellCoords(grid, cell);
  return {
    x: layout.margin + (col + 0.5) * layout.cell,
    y: layout.margin + (row + 0.5) * layout.cell,
  };
}

/** The edge's two dot centres, top/left first. */
export function edgeSegment(grid: Grid, layout: Layout, edge: number): Segment {
  const a = dotPoint(grid, layout, grid.edgeDots[edge * 2]);
  const b = dotPoint(grid, layout, grid.edgeDots[edge * 2 + 1]);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

export function edgeMidpoint(grid: Grid, layout: Layout, edge: number): Point {
  const s = edgeSegment(grid, layout, edge);
  return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
}

/**
 * The edge whose diamond hit area contains (x, y), in board pixels. Each cell's diagonals cut it
 * into four triangles, one per side; an edge's diamond is the two triangles touching it, so the
 * diamonds tile the board with no gaps and every point picks the nearest edge (design kit, touch
 * targets). Points in the margin belong to the outer edges. Returns `NONE` more than half a cell
 * outside the dots.
 */
export function edgeAt(grid: Grid, layout: Layout, x: number, y: number): number {
  const u = (x - layout.margin) / layout.cell;
  const v = (y - layout.margin) / layout.cell;
  const W = grid.width;
  const H = grid.height;
  if (u < -0.5 || v < -0.5 || u > W + 0.5 || v > H + 0.5) return NONE;
  const c = Math.min(W - 1, Math.max(0, Math.floor(u)));
  const r = Math.min(H - 1, Math.max(0, Math.floor(v)));
  const fu = u - c;
  const fv = v - r;
  const k = (r * W + c) * 4; // cellEdges order: top, right, bottom, left
  if (fv <= fu && fv <= 1 - fu) return grid.cellEdges[k];
  if (fv >= fu && fv >= 1 - fu) return grid.cellEdges[k + 2];
  return fu < 0.5 ? grid.cellEdges[k + 3] : grid.cellEdges[k + 1];
}

/** The dot nearest to (x, y), clamped to the board. */
export function dotAt(grid: Grid, layout: Layout, x: number, y: number): number {
  const col = Math.min(grid.width, Math.max(0, Math.round((x - layout.margin) / layout.cell)));
  const row = Math.min(grid.height, Math.max(0, Math.round((y - layout.margin) / layout.cell)));
  return row * (grid.width + 1) + col;
}

/**
 * The edges on a path from dot `from` to dot `to`: along the row first, then along the column.
 * Adjacent dots give their one shared edge; the same dot gives none.
 */
export function dotPath(grid: Grid, from: number, to: number): number[] {
  const a = dotCoords(grid, from);
  const b = dotCoords(grid, to);
  const W = grid.width;
  const out: number[] = [];
  let { row, col } = a;
  while (col !== b.col) {
    const next = col < b.col ? col + 1 : col - 1;
    out.push(row * W + Math.min(col, next));
    col = next;
  }
  while (row !== b.row) {
    const next = row < b.row ? row + 1 : row - 1;
    out.push(grid.hEdgeCount + Math.min(row, next) * (W + 1) + col);
    row = next;
  }
  return out;
}
```

Create `apps/web/src/lib/game/geometry.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createGrid, hEdgeIndex, NONE, vEdgeIndex } from "@loophole/core";
import fc from "fast-check";
import {
  dotAt,
  dotPath,
  edgeAt,
  edgeMidpoint,
  edgeSegment,
  fitLayout,
  type Layout,
  minBoardHeight,
} from "./geometry.ts";

describe("fitLayout", () => {
  test("matches the design kit artboards", () => {
    // Small (360 wide): 7×7 at 44px cells with a 10px border, 328px across.
    expect(fitLayout(7, 7, 328, 400, 44, 46)).toEqual({
      cell: 44,
      margin: 10,
      width: 328,
      height: 328,
    });
    // Play (390 wide): 7×7 at 46px with a 16px border, 354px across.
    expect(fitLayout(7, 7, 354, 500, 44, 46)).toEqual({
      cell: 46,
      margin: 16,
      width: 354,
      height: 354,
    });
    // Desktop: 10×10 at 58px with a 20px border, 620px across.
    expect(fitLayout(10, 10, 620, 900, 24, 58).width).toBe(620);
  });

  test("never exceeds the available width, even below the minimum cell", () => {
    const l = fitLayout(10, 10, 328, 1000, 44, 58);
    expect(l.width).toBeLessThanOrEqual(328);
    expect(l.cell).toBe(30);
  });

  test("keeps the minimum cell when only the height is short", () => {
    const l = fitLayout(7, 7, 328, 200, 44, 58);
    expect(l.cell).toBe(44);
    expect(l.height).toBe(minBoardHeight(7, 7, 328, 44));
  });

  test("fits inside the box for any size", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 200, max: 2000 }),
        fc.integer({ min: 200, max: 2000 }),
        (cols, rows, w, h) => {
          const l = fitLayout(cols, rows, w, h, 44, 58);
          expect(l.width).toBeLessThanOrEqual(w);
          expect(l.cell).toBeLessThanOrEqual(58);
          expect(l.margin).toBeGreaterThanOrEqual(10);
          if (l.height > h) expect(l.height).toBe(minBoardHeight(cols, rows, w, 44));
        },
      ),
    );
  });
});

const grid = createGrid(3, 2);
const layout: Layout = { cell: 40, margin: 10, width: 140, height: 100 };

describe("edgeSegment", () => {
  test("joins the edge's two dots", () => {
    expect(edgeSegment(grid, layout, hEdgeIndex(grid, 1, 2))).toEqual({
      x1: 90,
      y1: 50,
      x2: 130,
      y2: 50,
    });
    expect(edgeSegment(grid, layout, vEdgeIndex(grid, 0, 3))).toEqual({
      x1: 130,
      y1: 10,
      x2: 130,
      y2: 50,
    });
  });
});

describe("edgeAt", () => {
  test("picks the edge at its own midpoint", () => {
    for (let e = 0; e < grid.edgeCount; e++) {
      const m = edgeMidpoint(grid, layout, e);
      expect(edgeAt(grid, layout, m.x, m.y)).toBe(e);
    }
  });

  test("splits a cell along its diagonals", () => {
    // Cell (0, 0) spans x 10–50, y 10–50.
    expect(edgeAt(grid, layout, 30, 15)).toBe(hEdgeIndex(grid, 0, 0));
    expect(edgeAt(grid, layout, 30, 45)).toBe(hEdgeIndex(grid, 1, 0));
    expect(edgeAt(grid, layout, 15, 30)).toBe(vEdgeIndex(grid, 0, 0));
    expect(edgeAt(grid, layout, 45, 30)).toBe(vEdgeIndex(grid, 0, 1));
  });

  test("maps the margin to outer edges and ignores points far outside", () => {
    expect(edgeAt(grid, layout, 30, 2)).toBe(hEdgeIndex(grid, 0, 0));
    expect(edgeAt(grid, layout, 138, 70)).toBe(vEdgeIndex(grid, 1, 3));
    expect(edgeAt(grid, layout, -20, 30)).toBe(NONE);
  });

  test("always returns an edge with the nearest midpoint (diamonds tile the board)", () => {
    const g = createGrid(5, 4);
    const l: Layout = { cell: 44, margin: 14, width: 248, height: 204 };
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 248, noNaN: true }),
        fc.double({ min: 0, max: 204, noNaN: true }),
        (x, y) => {
          const e = edgeAt(g, l, x, y);
          expect(e).not.toBe(NONE);
          const dist = (k: number) => {
            const m = edgeMidpoint(g, l, k);
            return Math.abs(m.x - x) + Math.abs(m.y - y);
          };
          let best = Number.POSITIVE_INFINITY;
          for (let k = 0; k < g.edgeCount; k++) best = Math.min(best, dist(k));
          expect(dist(e)).toBeCloseTo(best, 6);
        },
      ),
    );
  });
});

describe("dotAt", () => {
  test("rounds to the nearest dot and clamps to the board", () => {
    expect(dotAt(grid, layout, 12, 8)).toBe(0);
    expect(dotAt(grid, layout, 72, 48)).toBe(1 * 4 + 2);
    expect(dotAt(grid, layout, 500, 500)).toBe(grid.dotCount - 1);
  });
});

describe("dotPath", () => {
  test("gives the shared edge of adjacent dots and nothing for the same dot", () => {
    expect(dotPath(grid, 0, 1)).toEqual([hEdgeIndex(grid, 0, 0)]);
    expect(dotPath(grid, 1, 0)).toEqual([hEdgeIndex(grid, 0, 0)]);
    expect(dotPath(grid, 0, 4)).toEqual([vEdgeIndex(grid, 0, 0)]);
    expect(dotPath(grid, 5, 5)).toEqual([]);
  });

  test("walks along the row, then the column", () => {
    // Dot (0, 0) to dot (2, 2): two horizontal edges on row 0, then two vertical on column 2.
    expect(dotPath(grid, 0, 2 * 4 + 2)).toEqual([
      hEdgeIndex(grid, 0, 0),
      hEdgeIndex(grid, 0, 1),
      vEdgeIndex(grid, 0, 2),
      vEdgeIndex(grid, 1, 2),
    ]);
  });

  test("each edge joins consecutive dots of the path", () => {
    const g = createGrid(6, 5);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: g.dotCount - 1 }),
        fc.integer({ min: 0, max: g.dotCount - 1 }),
        (a, b) => {
          const path = dotPath(g, a, b);
          let at = a;
          for (const e of path) {
            const [d0, d1] = [g.edgeDots[e * 2], g.edgeDots[e * 2 + 1]];
            expect([d0, d1]).toContain(at);
            at = d0 === at ? d1 : d0;
          }
          expect(at).toBe(b);
        },
      ),
    );
  });
});
```

Create `apps/web/src/lib/game/gesture.ts`:

```ts
import { EdgeState, type Grid, NONE } from "@loophole/core";
import type { EdgeChange } from "./board.ts";
import { dotAt, dotPath, edgeAt, type Layout } from "./geometry.ts";

/** What a pointer movement did to the board. */
export interface StrokeStep {
  readonly changes: EdgeChange[];
  /** False for the first step of a stroke (a new undo step), true for the rest. */
  readonly merge: boolean;
}

/**
 * Turns one pointer's down/move/up into board input (FR-13), in board pixel coordinates.
 *
 * - A press that stays put is a tap: on release, the edge whose diamond holds the press point
 *   cycles line → cross → empty (the caller applies `nextState`).
 * - Moving farther than the slop starts a drag stroke that follows the dots under the pointer;
 *   each pair of consecutive dots marks the edge between them. If the first edge of the stroke was
 *   a line the stroke erases lines; otherwise it draws lines, over crosses too.
 */
export class PointerGesture {
  private active = false;
  private dragging = false;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private dot = 0;
  private mode: EdgeState | null = null;

  constructor(
    private readonly grid: Grid,
    private readonly layout: Layout,
  ) {}

  /** Distance the pointer must travel before a press becomes a drag. */
  get slop(): number {
    return Math.max(8, this.layout.cell * 0.25);
  }

  down(x: number, y: number): void {
    this.active = true;
    this.dragging = false;
    this.mode = null;
    this.startX = this.lastX = x;
    this.startY = this.lastY = y;
    this.dot = dotAt(this.grid, this.layout, x, y);
  }

  /** Feeds a pointer position; returns the edges to change, or null if none. */
  move(x: number, y: number, edges: Uint8Array): StrokeStep | null {
    if (!this.active) return null;
    if (!this.dragging) {
      if (Math.hypot(x - this.startX, y - this.startY) < this.slop) return null;
      this.dragging = true;
    }
    // Walk from the last position in steps of at most a quarter cell, so a fast swipe still
    // passes through every dot on its way.
    const dist = Math.hypot(x - this.lastX, y - this.lastY);
    const steps = Math.max(1, Math.ceil(dist / (this.layout.cell / 4)));
    const changes: EdgeChange[] = [];
    const merge = this.mode !== null;
    for (let i = 1; i <= steps; i++) {
      const px = this.lastX + ((x - this.lastX) * i) / steps;
      const py = this.lastY + ((y - this.lastY) * i) / steps;
      const next = dotAt(this.grid, this.layout, px, py);
      if (next === this.dot) continue;
      for (const edge of dotPath(this.grid, this.dot, next)) {
        if (this.mode === null) {
          this.mode = edges[edge] === EdgeState.Line ? EdgeState.Unknown : EdgeState.Line;
        }
        if (this.mode === EdgeState.Line) changes.push([edge, EdgeState.Line]);
        else if (edges[edge] === EdgeState.Line) changes.push([edge, EdgeState.Unknown]);
      }
      this.dot = next;
    }
    this.lastX = x;
    this.lastY = y;
    return changes.length > 0 ? { changes, merge } : null;
  }

  /** Ends the gesture. Returns the tapped edge, or `NONE` if it was a drag or missed the board. */
  up(): number {
    const tapped =
      this.active && !this.dragging
        ? edgeAt(this.grid, this.layout, this.startX, this.startY)
        : NONE;
    this.active = false;
    this.dragging = false;
    return tapped;
  }

  cancel(): void {
    this.active = false;
    this.dragging = false;
  }
}
```

Create `apps/web/src/lib/game/gesture.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createGrid, EdgeState, hEdgeIndex, NONE, vEdgeIndex } from "@loophole/core";
import { applyChanges, createBoard } from "./board.ts";
import type { Layout } from "./geometry.ts";
import { PointerGesture } from "./gesture.ts";

const grid = createGrid(4, 4);
// Dot (r, c) is at (10 + 40c, 10 + 40r).
const layout: Layout = { cell: 40, margin: 10, width: 180, height: 180 };
const at = (r: number, c: number) => [10 + 40 * c, 10 + 40 * r] as const;

describe("PointerGesture", () => {
  test("a press without movement taps the edge under it", () => {
    const g = new PointerGesture(grid, layout);
    g.down(30, 12);
    expect(g.move(33, 14, new Uint8Array(grid.edgeCount))).toBeNull();
    expect(g.up()).toBe(hEdgeIndex(grid, 0, 0));
  });

  test("a press outside the board taps nothing", () => {
    const g = new PointerGesture(grid, layout);
    g.down(-50, -50);
    expect(g.up()).toBe(NONE);
  });

  test("dragging along a row draws a run of lines as one stroke", () => {
    const g = new PointerGesture(grid, layout);
    const edges = new Uint8Array(grid.edgeCount);
    g.down(...at(1, 0));
    const first = g.move(...at(1, 1), edges);
    expect(first).toEqual({ changes: [[hEdgeIndex(grid, 1, 0), EdgeState.Line]], merge: false });
    const rest = g.move(...at(1, 3), edges);
    expect(rest).toEqual({
      changes: [
        [hEdgeIndex(grid, 1, 1), EdgeState.Line],
        [hEdgeIndex(grid, 1, 2), EdgeState.Line],
      ],
      merge: true,
    });
    expect(g.up()).toBe(NONE);
  });

  test("a fast diagonal swipe still marks connected edges", () => {
    const g = new PointerGesture(grid, layout);
    g.down(...at(0, 0));
    const step = g.move(...at(2, 2), new Uint8Array(grid.edgeCount));
    const marked = step?.changes.map(([e]) => e) ?? [];
    expect(marked.length).toBe(4);
  });

  test("a stroke that starts on a line erases lines and leaves crosses", () => {
    let board = createBoard(grid.edgeCount);
    board = applyChanges(board, [
      [vEdgeIndex(grid, 0, 2), EdgeState.Line],
      [vEdgeIndex(grid, 1, 2), EdgeState.Cross],
      [vEdgeIndex(grid, 2, 2), EdgeState.Line],
    ]);
    const g = new PointerGesture(grid, layout);
    g.down(...at(0, 2));
    const step = g.move(...at(3, 2), board.edges);
    expect(step?.changes).toEqual([
      [vEdgeIndex(grid, 0, 2), EdgeState.Unknown],
      [vEdgeIndex(grid, 2, 2), EdgeState.Unknown],
    ]);
  });

  test("a drawing stroke draws over crosses", () => {
    const board = applyChanges(createBoard(grid.edgeCount), [
      [hEdgeIndex(grid, 0, 1), EdgeState.Cross],
    ]);
    const g = new PointerGesture(grid, layout);
    g.down(...at(0, 0));
    const step = g.move(...at(0, 2), board.edges);
    expect(step?.changes).toEqual([
      [hEdgeIndex(grid, 0, 0), EdgeState.Line],
      [hEdgeIndex(grid, 0, 1), EdgeState.Line],
    ]);
  });

  test("moves after cancel do nothing", () => {
    const g = new PointerGesture(grid, layout);
    g.down(...at(0, 0));
    g.cancel();
    expect(g.move(...at(0, 3), new Uint8Array(grid.edgeCount))).toBeNull();
    expect(g.up()).toBe(NONE);
  });
});
```

Create `apps/web/src/lib/game/keyboard.ts`:

```ts
import { type EdgeState, edgeCoords, type Grid, hEdgeIndex, vEdgeIndex } from "@loophole/core";

export type Direction = "up" | "down" | "left" | "right";

export type Command =
  | { readonly type: "move"; readonly direction: Direction }
  | { readonly type: "cycle" | "cross" | "erase" | "undo" | "redo" | "pause" };

/**
 * Moves the keyboard edge cursor. Think of the edges as rows that alternate between horizontal and
 * vertical: left and right move along the current row; up and down step to the next row, keeping to
 * the left side of the column. From the top edge of a cell, down goes to the cell's left side, then
 * to its bottom edge. The cursor stops at the board's sides.
 */
export function moveCursor(grid: Grid, edge: number, direction: Direction): number {
  const W = grid.width;
  const H = grid.height;
  const { horizontal, row, col } = edgeCoords(grid, edge);
  if (horizontal) {
    switch (direction) {
      case "left":
        return col > 0 ? hEdgeIndex(grid, row, col - 1) : edge;
      case "right":
        return col < W - 1 ? hEdgeIndex(grid, row, col + 1) : edge;
      case "up":
        return row > 0 ? vEdgeIndex(grid, row - 1, col) : edge;
      case "down":
        return row < H ? vEdgeIndex(grid, row, col) : edge;
    }
  }
  switch (direction) {
    case "left":
      return col > 0 ? vEdgeIndex(grid, row, col - 1) : edge;
    case "right":
      return col < W ? vEdgeIndex(grid, row, col + 1) : edge;
    case "up":
      return hEdgeIndex(grid, row, Math.min(col, W - 1));
    case "down":
      return hEdgeIndex(grid, row + 1, Math.min(col, W - 1));
  }
}

const ARROWS: Readonly<Record<string, Direction>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** Keys that act on the edge under the cursor, while the board has focus (Desktop artboard). */
export function boardCommand(key: string): Command | null {
  const direction = ARROWS[key];
  if (direction !== undefined) return { type: "move", direction };
  if (key === " " || key === "Enter") return { type: "cycle" };
  if (key === "x" || key === "X") return { type: "cross" };
  if (key === "Backspace" || key === "Delete") return { type: "erase" };
  return null;
}

export interface KeyInput {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** Shortcuts that work anywhere on the play screen: Z undo, Y redo, P pause, plus Ctrl/⌘ forms. */
export function screenCommand(e: KeyInput): Command | null {
  if (e.altKey) return null;
  const key = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (key === "z") return { type: e.shiftKey ? "redo" : "undo" };
    if (key === "y") return { type: "redo" };
    return null;
  }
  if (key === "z") return { type: "undo" };
  if (key === "y") return { type: "redo" };
  if (key === "p") return { type: "pause" };
  return null;
}

const STATE_WORDS = ["empty", "line", "cross"] as const;

/** Spoken and shown name of an edge, e.g. "Row 8 · between columns 4 and 5 · empty". 1-based. */
export function edgeLabel(grid: Grid, edge: number, state: EdgeState): string {
  const { horizontal, row, col } = edgeCoords(grid, edge);
  const where = horizontal
    ? `Row ${row + 1} · between columns ${col + 1} and ${col + 2}`
    : `Column ${col + 1} · between rows ${row + 1} and ${row + 2}`;
  return `${where} · ${STATE_WORDS[state]}`;
}
```

Create `apps/web/src/lib/game/keyboard.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createGrid, EdgeState, hEdgeIndex, vEdgeIndex } from "@loophole/core";
import fc from "fast-check";
import {
  boardCommand,
  type Direction,
  edgeLabel,
  type KeyInput,
  moveCursor,
  screenCommand,
} from "./keyboard.ts";

const grid = createGrid(3, 2);
const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];

describe("moveCursor", () => {
  test("left and right move along the row", () => {
    expect(moveCursor(grid, hEdgeIndex(grid, 1, 0), "right")).toBe(hEdgeIndex(grid, 1, 1));
    expect(moveCursor(grid, vEdgeIndex(grid, 0, 3), "left")).toBe(vEdgeIndex(grid, 0, 2));
  });

  test("down alternates between horizontal and vertical edges in one column", () => {
    let e = hEdgeIndex(grid, 0, 1);
    const seen = [e];
    for (let i = 0; i < 4; i++) {
      e = moveCursor(grid, e, "down");
      seen.push(e);
    }
    expect(seen).toEqual([
      hEdgeIndex(grid, 0, 1),
      vEdgeIndex(grid, 0, 1),
      hEdgeIndex(grid, 1, 1),
      vEdgeIndex(grid, 1, 1),
      hEdgeIndex(grid, 2, 1),
    ]);
  });

  test("the rightmost vertical edge steps to the last horizontal edge", () => {
    expect(moveCursor(grid, vEdgeIndex(grid, 0, 3), "down")).toBe(hEdgeIndex(grid, 1, 2));
    expect(moveCursor(grid, vEdgeIndex(grid, 0, 3), "up")).toBe(hEdgeIndex(grid, 0, 2));
  });

  test("stops at the sides", () => {
    expect(moveCursor(grid, hEdgeIndex(grid, 0, 0), "up")).toBe(hEdgeIndex(grid, 0, 0));
    expect(moveCursor(grid, hEdgeIndex(grid, 0, 0), "left")).toBe(hEdgeIndex(grid, 0, 0));
    expect(moveCursor(grid, hEdgeIndex(grid, 2, 2), "down")).toBe(hEdgeIndex(grid, 2, 2));
    expect(moveCursor(grid, vEdgeIndex(grid, 1, 3), "right")).toBe(vEdgeIndex(grid, 1, 3));
  });

  test("reaches every edge from the first one", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 }), (w, h) => {
        const g = createGrid(w, h);
        const seen = new Set([0]);
        const queue = [0];
        while (queue.length > 0) {
          const e = queue.pop() as number;
          for (const d of DIRECTIONS) {
            const next = moveCursor(g, e, d);
            expect(next >= 0 && next < g.edgeCount).toBe(true);
            if (!seen.has(next)) {
              seen.add(next);
              queue.push(next);
            }
          }
        }
        expect(seen.size).toBe(g.edgeCount);
      }),
      { numRuns: 30 },
    );
  });
});

describe("boardCommand", () => {
  test("maps the Desktop artboard keys", () => {
    expect(boardCommand("ArrowLeft")).toEqual({ type: "move", direction: "left" });
    expect(boardCommand(" ")).toEqual({ type: "cycle" });
    expect(boardCommand("Enter")).toEqual({ type: "cycle" });
    expect(boardCommand("x")).toEqual({ type: "cross" });
    expect(boardCommand("Backspace")).toEqual({ type: "erase" });
    expect(boardCommand("q")).toBeNull();
  });
});

describe("screenCommand", () => {
  const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  test("maps Z, Y and P with and without modifiers", () => {
    expect(screenCommand(key("z"))).toEqual({ type: "undo" });
    expect(screenCommand(key("Y"))).toEqual({ type: "redo" });
    expect(screenCommand(key("p"))).toEqual({ type: "pause" });
    expect(screenCommand(key("z", { ctrlKey: true }))).toEqual({ type: "undo" });
    expect(screenCommand(key("z", { metaKey: true, shiftKey: true }))).toEqual({ type: "redo" });
    expect(screenCommand(key("y", { ctrlKey: true }))).toEqual({ type: "redo" });
  });

  test("ignores other keys and Alt combinations", () => {
    expect(screenCommand(key("p", { ctrlKey: true }))).toBeNull();
    expect(screenCommand(key("z", { altKey: true }))).toBeNull();
    expect(screenCommand(key("a"))).toBeNull();
  });
});

describe("edgeLabel", () => {
  test("names edges by 1-based dot rows and columns", () => {
    const g = createGrid(10, 10);
    expect(edgeLabel(g, hEdgeIndex(g, 7, 3), EdgeState.Unknown)).toBe(
      "Row 8 · between columns 4 and 5 · empty",
    );
    expect(edgeLabel(g, vEdgeIndex(g, 1, 3), EdgeState.Cross)).toBe(
      "Column 4 · between rows 2 and 3 · cross",
    );
  });
});
```

Create `apps/web/src/lib/game/inside.ts`:

```ts
import { EdgeState, type Grid, vEdgeIndex } from "@loophole/core";

/**
 * Marks the cells inside the loop (1) and outside (0), for the solved wash. Scans each row from
 * the left and flips at every vertical line, so it assumes the lines form closed loops.
 */
export function insideCells(grid: Grid, edges: Uint8Array): Uint8Array {
  const out = new Uint8Array(grid.cellCount);
  for (let r = 0; r < grid.height; r++) {
    let inside = 0;
    for (let c = 0; c < grid.width; c++) {
      if (edges[vEdgeIndex(grid, r, c)] === EdgeState.Line) inside ^= 1;
      out[r * grid.width + c] = inside;
    }
  }
  return out;
}
```

Create `apps/web/src/lib/game/inside.test.ts`:

```ts
import { expect, test } from "bun:test";
import { createGrid, decodeEdges } from "@loophole/core";
import { insideCells } from "./inside.ts";

test("the outer square of a 2×2 has every cell inside", () => {
  const g = createGrid(2, 2);
  expect(Array.from(insideCells(g, decodeEdges(g, "112211121121")))).toEqual([1, 1, 1, 1]);
});

test("a loop around one cell of a 3×3 has only that cell inside", () => {
  const g = createGrid(3, 3);
  // The 3×3 "corner zeros" solution: a loop around the centre cell.
  const inside = insideCells(g, decodeEdges(g, "222212212222222221122222"));
  expect(Array.from(inside)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
});

test("an empty board has nothing inside", () => {
  const g = createGrid(3, 2);
  expect(insideCells(g, new Uint8Array(g.edgeCount)).every((x) => x === 0)).toBe(true);
});
```

Create `apps/web/src/lib/game/messages.ts`:

```ts
import type { Violations } from "@loophole/core";

export interface RuleMessage {
  readonly title: string;
  readonly detail: string;
}

/** One message per kind of definite rule break on the board (FR-15), worded as on the artboards. */
export function violationMessages(v: Violations): RuleMessage[] {
  const out: RuleMessage[] = [];
  if (v.dots.length > 0) {
    out.push({
      title: "Three lines meet at a dot.",
      detail: "A loop passes through a dot at most once.",
    });
  }
  if (v.overfullCells.length > 0) {
    out.push({
      title: "Too many lines.",
      detail: "A circled clue has more lines around it than its number.",
    });
  }
  if (v.starvedCells.length > 0) {
    out.push({
      title: "Too many crosses.",
      detail: "A circled clue can no longer get enough lines.",
    });
  }
  if (v.loopEdges.length > 0) {
    out.push({
      title: "Closed too early.",
      detail: "That loop is closed, but the puzzle is not solved yet.",
    });
  }
  return out;
}
```

Create `apps/web/src/lib/game/messages.test.ts`:

```ts
import { expect, test } from "bun:test";
import { violationMessages } from "./messages.ts";

const none = { dots: [], overfullCells: [], starvedCells: [], loopEdges: [] };

test("no violations, no messages", () => {
  expect(violationMessages(none)).toEqual([]);
});

test("one message per kind, in a fixed order", () => {
  const titles = violationMessages({
    dots: [3],
    overfullCells: [],
    starvedCells: [1, 2],
    loopEdges: [0, 1, 2, 3],
  }).map((m) => m.title);
  expect(titles).toEqual(["Three lines meet at a dot.", "Too many crosses.", "Closed too early."]);
});
```

Verify: `bun test apps/web` passes, including the properties "always returns an edge with the nearest midpoint (diamonds tile the board)" and "reaches every edge from the first one". `bun run check` passes.

Commit: `feat(web): add hit-testing, drag strokes and keyboard cursor`

### Step 5 — guest progress and theme choice

Create `apps/web/src/lib/test-support/memory-storage.ts`:

```ts
import type { KeyValueStorage } from "../game/progress.ts";

/** An in-memory stand-in for `localStorage` in tests. */
export function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}
```

Create `apps/web/src/lib/game/progress.ts`:

```ts
import { decodeEdges, encodeEdges, type Grid } from "@loophole/core";

/** The parts of the Web Storage API the progress store uses; `localStorage` fits. */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A guest's in-progress or finished attempt at one puzzle (FR-21, guest part). */
export interface Progress {
  readonly edges: Uint8Array;
  readonly elapsedMs: number;
  readonly solved: boolean;
}

interface StoredProgressV1 {
  v: 1;
  edges: string;
  elapsedMs: number;
  solved: boolean;
}

const PREFIX = "loophole:progress:";

export function progressKey(puzzleId: string): string {
  return PREFIX + puzzleId;
}

/**
 * Saves and restores progress per puzzle id in browser storage. Storage errors (private mode, quota)
 * are swallowed: losing a save must never break play. Anything unreadable loads as null.
 */
export interface ProgressStore {
  load(puzzleId: string, grid: Grid): Progress | null;
  save(puzzleId: string, progress: Progress): void;
  clear(puzzleId: string): void;
}

export function createProgressStore(storage: KeyValueStorage | null): ProgressStore {
  return {
    load(puzzleId, grid) {
      try {
        const text = storage?.getItem(progressKey(puzzleId));
        if (!text) return null;
        const data = JSON.parse(text) as Partial<StoredProgressV1>;
        if (data.v !== 1 || typeof data.edges !== "string") return null;
        const elapsedMs =
          typeof data.elapsedMs === "number" && data.elapsedMs > 0 ? data.elapsedMs : 0;
        return { edges: decodeEdges(grid, data.edges), elapsedMs, solved: data.solved === true };
      } catch {
        return null;
      }
    },
    save(puzzleId, progress) {
      const data: StoredProgressV1 = {
        v: 1,
        edges: encodeEdges(progress.edges),
        elapsedMs: Math.round(progress.elapsedMs),
        solved: progress.solved,
      };
      try {
        storage?.setItem(progressKey(puzzleId), JSON.stringify(data));
      } catch {
        // Quota or private mode: keep playing without saving.
      }
    },
    clear(puzzleId) {
      try {
        storage?.removeItem(progressKey(puzzleId));
      } catch {
        // Nothing to do.
      }
    },
  };
}
```

Create `apps/web/src/lib/game/progress.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createGrid } from "@loophole/core";
import { memoryStorage } from "../test-support/memory-storage.ts";
import { createProgressStore, type KeyValueStorage, progressKey } from "./progress.ts";

const grid = createGrid(2, 2);

describe("progress store", () => {
  test("round-trips edges, time and solved flag per puzzle", () => {
    const storage = memoryStorage();
    const store = createProgressStore(storage);
    const edges = new Uint8Array([1, 1, 2, 2, 1, 1, 1, 2, 1, 1, 2, 1]);
    store.save("a", { edges, elapsedMs: 4200.4, solved: true });
    expect(store.load("a", grid)).toEqual({ edges, elapsedMs: 4200, solved: true });
    expect(store.load("b", grid)).toBeNull();
    expect(JSON.parse(storage.data.get(progressKey("a")) ?? "")).toEqual({
      v: 1,
      edges: "112211121121",
      elapsedMs: 4200,
      solved: true,
    });
  });

  test("clear forgets a puzzle", () => {
    const store = createProgressStore(memoryStorage());
    store.save("a", { edges: new Uint8Array(12), elapsedMs: 0, solved: false });
    store.clear("a");
    expect(store.load("a", grid)).toBeNull();
  });

  test("ignores broken, foreign or wrong-sized data", () => {
    const storage = memoryStorage();
    const store = createProgressStore(storage);
    for (const text of [
      "not json",
      "{}",
      JSON.stringify({ v: 2, edges: "000000000000" }),
      JSON.stringify({ v: 1, edges: "000" }),
      JSON.stringify({ v: 1, edges: "00000000000x" }),
    ]) {
      storage.data.set(progressKey("a"), text);
      expect(store.load("a", grid)).toBeNull();
    }
    storage.data.set(progressKey("a"), JSON.stringify({ v: 1, edges: "000000000000" }));
    expect(store.load("a", grid)).toEqual({
      edges: new Uint8Array(12),
      elapsedMs: 0,
      solved: false,
    });
  });

  test("keeps working when storage throws or is missing", () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    for (const store of [createProgressStore(throwing), createProgressStore(null)]) {
      expect(() =>
        store.save("a", { edges: new Uint8Array(12), elapsedMs: 1, solved: false }),
      ).not.toThrow();
      expect(store.load("a", grid)).toBeNull();
      expect(() => store.clear("a")).not.toThrow();
    }
  });
});
```

Create `apps/web/src/lib/theme.ts`:

```ts
import type { KeyValueStorage } from "./game/progress.ts";

/** The user's theme override (FR-16). "system" follows `prefers-color-scheme`. */
export type ThemeChoice = "light" | "dark" | "system";

/** Also read by the inline script in app.html, which applies the theme before first paint. */
export const THEME_KEY = "loophole:theme";

export function readThemeChoice(storage: KeyValueStorage | null): ThemeChoice {
  try {
    const value = storage?.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function saveThemeChoice(storage: KeyValueStorage | null, choice: ThemeChoice): void {
  try {
    if (choice === "system") storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, choice);
  } catch {
    // The choice still applies for this visit.
  }
}

/** Sets `data-theme` on the root element; "system" removes it so the media query decides. */
export function applyThemeChoice(root: HTMLElement, choice: ThemeChoice): void {
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
}
```

Create `apps/web/src/lib/theme.test.ts`:

```ts
import { expect, test } from "bun:test";
import { memoryStorage } from "./test-support/memory-storage.ts";
import { readThemeChoice, saveThemeChoice, THEME_KEY } from "./theme.ts";

test("defaults to following the system", () => {
  expect(readThemeChoice(memoryStorage())).toBe("system");
  expect(readThemeChoice(null)).toBe("system");
});

test("remembers light and dark; system clears the override", () => {
  const s = memoryStorage();
  saveThemeChoice(s, "dark");
  expect(s.data.get(THEME_KEY)).toBe("dark");
  expect(readThemeChoice(s)).toBe("dark");
  saveThemeChoice(s, "system");
  expect(s.data.has(THEME_KEY)).toBe(false);
  expect(readThemeChoice(s)).toBe("system");
});

test("treats unknown stored values as system", () => {
  const s = memoryStorage();
  s.data.set(THEME_KEY, "sepia");
  expect(readThemeChoice(s)).toBe("system");
});
```

Verify: `bun test apps/web` passes; `bun run check` passes.

Commit: `feat(web): save guest progress and theme choice`

### Step 6 — puzzle source and fixtures

The three fixtures each have exactly one solution: the 7×7 (Play artboard) and 10×10 (Night/Desktop artboards) per the design kit, the 5×5 generated for this phase; all three were confirmed unique with a propagate-and-search counter during planning. Their solutions are in the test helpers only.

Create `apps/web/src/lib/puzzles/source.ts`:

```ts
import type { Puzzle } from "@loophole/core";

export interface PuzzleSummary {
  /** Stable id; also the key for saved progress. */
  readonly id: string;
  /** Short display name, e.g. "Small". */
  readonly name: string;
  /** Second header line, e.g. "Practice". */
  readonly subtitle: string;
  readonly width: number;
  readonly height: number;
}

/** The header title, e.g. "Small · 7×7". */
export function puzzleTitle(p: PuzzleSummary): string {
  return `${p.name} · ${p.width}×${p.height}`;
}

export interface PuzzleEntry extends PuzzleSummary {
  readonly puzzle: Puzzle;
}

/**
 * Where the web app gets puzzles. The fixture source serves a few built-in puzzles; an API-backed
 * source replaces it once the server exists, without the screens changing.
 */
export interface PuzzleSource {
  list(): Promise<PuzzleSummary[]>;
  /** Resolves to null when there is no puzzle with this id. */
  get(id: string): Promise<PuzzleEntry | null>;
}
```

Create `apps/web/src/lib/puzzles/fixtures.ts`:

```ts
import { type PuzzleWireV1, parsePuzzle } from "@loophole/core";
import type { PuzzleEntry, PuzzleSource, PuzzleSummary } from "./source.ts";

interface FixtureRecord {
  readonly id: string;
  readonly name: string;
  readonly subtitle: string;
  readonly wire: PuzzleWireV1;
}

/**
 * Built-in puzzles in wire format (docs/FORMAT.md), each with exactly one solution. The 7×7 is the
 * one on the Play artboard and the 10×10 the one on the Night and Desktop artboards.
 */
export const FIXTURES: readonly FixtureRecord[] = [
  {
    id: "tiny-5",
    name: "Tiny",
    subtitle: "Practice · 練習",
    wire: { v: 1, width: 5, height: 5, clues: "..0.......3.1.0.3.1......" },
  },
  {
    id: "small-7",
    name: "Small",
    subtitle: "Practice · 練習",
    wire: { v: 1, width: 7, height: 7, clues: ".11..0..23.2......2.21.0....1....01.1..3..0..1..1" },
  },
  {
    id: "medium-10",
    name: "Medium",
    subtitle: "Practice · 練習",
    wire: {
      v: 1,
      width: 10,
      height: 10,
      clues:
        ".0.0..0.1.....1..2..3.0.21.1.1..0.3....22......3..2.1...01.121.32.....2...013.1...20....3..2....0...",
    },
  },
];

function summary(f: FixtureRecord): PuzzleSummary {
  return {
    id: f.id,
    name: f.name,
    subtitle: f.subtitle,
    width: f.wire.width,
    height: f.wire.height,
  };
}

export const fixtureSource: PuzzleSource = {
  async list() {
    return FIXTURES.map(summary);
  },
  async get(id) {
    const f = FIXTURES.find((x) => x.id === id);
    if (f === undefined) return null;
    const entry: PuzzleEntry = { ...summary(f), puzzle: parsePuzzle(f.wire) };
    return entry;
  },
};
```

Create `apps/web/src/lib/puzzles/index.ts`:

```ts
import { fixtureSource } from "./fixtures.ts";
import type { PuzzleSource } from "./source.ts";

export { type PuzzleEntry, type PuzzleSource, type PuzzleSummary, puzzleTitle } from "./source.ts";

/** The puzzle source the screens use. Swap this for an API-backed source when the server exists. */
export const puzzleSource: PuzzleSource = fixtureSource;
```

Create `apps/web/src/lib/test-support/solutions.ts`:

```ts
/**
 * Solutions of the fixture puzzles as edge strings (docs/FORMAT.md), for tests only: the app never
 * ships a solution. Each was checked to be the only one.
 */
export const FIXTURE_SOLUTIONS: Readonly<Record<string, string>> = {
  "tiny-5": "222222222212222221222122211122222222222222112222111122122122",
  "small-7":
    "2221222112222112121222222212222222221121222221211222222222211222121112112122211121222221212222212221112122222222",
  "medium-10":
    "2222222222221221221111212211221222222222222212211112222221122212112222122122212122222212212212222212211222222222222222222221121121211222112222121221122221212222212221222222221212111212212211222111212112222211221212222222",
};
```

Create `apps/web/src/lib/puzzles/fixtures.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { analyzeBoard, decodeEdges } from "@loophole/core";
import { FIXTURE_SOLUTIONS } from "../test-support/solutions.ts";
import { FIXTURES, fixtureSource } from "./fixtures.ts";

describe("fixture puzzles", () => {
  test("ids are unique", () => {
    expect(new Set(FIXTURES.map((f) => f.id)).size).toBe(FIXTURES.length);
  });

  test("every fixture parses and its known solution solves it", async () => {
    for (const f of FIXTURES) {
      const entry = await fixtureSource.get(f.id);
      if (entry === null) throw new Error(`missing ${f.id}`);
      const solution = FIXTURE_SOLUTIONS[f.id];
      if (solution === undefined) throw new Error(`no solution for ${f.id}`);
      const analysis = analyzeBoard(entry.puzzle, decodeEdges(entry.puzzle.grid, solution));
      expect(analysis.solved).toBe(true);
    }
  });

  test("list matches the fixtures and get returns null for unknown ids", async () => {
    expect((await fixtureSource.list()).map((s) => s.id)).toEqual(FIXTURES.map((f) => f.id));
    expect(await fixtureSource.get("nope")).toBeNull();
  });
});
```

Verify: `bun test apps/web` passes (each fixture parses and its solution gives `solved: true`). `bun run check` passes.

Commit: `feat(web): add puzzle source with built-in fixtures`

### Step 7 — play screen, SVG board and routes

Create `apps/web/src/lib/components/BoardView.svelte`:

```svelte
<script lang="ts">
  import { type BoardAnalysis, EdgeState, NO_CLUE, NONE, type Puzzle } from "@loophole/core";
  import { type EdgeChange, nextState } from "../game/board.ts";
  import { cellPoint, dotPoint, edgeSegment, type Layout } from "../game/geometry.ts";
  import { PointerGesture } from "../game/gesture.ts";
  import { insideCells } from "../game/inside.ts";
  import { boardCommand, edgeLabel, moveCursor } from "../game/keyboard.ts";

  interface Props {
    puzzle: Puzzle;
    edges: Uint8Array;
    analysis: BoardAnalysis;
    layout: Layout;
    /** No input: paused or solved. */
    locked: boolean;
    /** Applies edits; `merge` joins them to the previous undo step (drag strokes). */
    onedit: (changes: EdgeChange[], merge: boolean) => void;
  }

  let { puzzle, edges, analysis, layout, locked, onedit }: Props = $props();

  const grid = $derived(puzzle.grid);
  const S = $derived(layout.cell);
  const lineWidth = $derived(Math.max(2, Math.round(S * 0.11)));
  const dotRadius = $derived(Math.max(4, Math.round(S * 0.11)) / 2);
  const crossArm = $derived(S * 0.1);

  const dots = $derived(Array.from({ length: grid.dotCount }, (_, d) => dotPoint(grid, layout, d)));
  const clues = $derived.by(() => {
    const out: { cell: number; x: number; y: number; text: string }[] = [];
    for (let i = 0; i < grid.cellCount; i++) {
      if (puzzle.clues[i] === NO_CLUE) continue;
      const p = cellPoint(grid, layout, i);
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

  // Keyboard cursor (NFR-5): shown while the board has focus and the keyboard was used last.
  let svg: SVGSVGElement | undefined = $state();
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
    return {
      x: horizontal ? s.x1 - 6 : s.x1 - thick / 2,
      y: horizontal ? s.y1 - thick / 2 : s.y1 - 6,
      width: horizontal ? len : thick,
      height: horizontal ? thick : len,
      radius: thick / 2,
      labelX: Math.min(Math.max((s.x1 + s.x2) / 2, 130), layout.width - 130),
      labelY: Math.max(s.y1, s.y2) + (horizontal ? thick / 2 : 6) + 8,
    };
  });

  let gesture: PointerGesture | null = null;
  let pointerId = -1;

  function local(e: PointerEvent): [number, number] {
    const r = (svg as SVGSVGElement).getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function onpointerdown(e: PointerEvent) {
    if (locked || gesture !== null || !e.isPrimary || e.button !== 0) return;
    keyboardMode = false;
    gesture = new PointerGesture(grid, layout);
    pointerId = e.pointerId;
    svg?.setPointerCapture(e.pointerId);
    gesture.down(...local(e));
  }

  function onpointermove(e: PointerEvent) {
    if (gesture === null || e.pointerId !== pointerId) return;
    const step = gesture.move(...local(e), edges);
    if (step !== null) onedit(step.changes, step.merge);
  }

  function onpointerup(e: PointerEvent) {
    if (gesture === null || e.pointerId !== pointerId) return;
    const tapped = gesture.up();
    gesture = null;
    if (tapped !== NONE && !locked) {
      cursor = tapped;
      onedit([[tapped, nextState(edges[tapped] as EdgeState)]], false);
    }
  }

  function onpointercancel(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    gesture?.cancel();
    gesture = null;
  }

  function onkeydown(e: KeyboardEvent) {
    if (locked || e.ctrlKey || e.metaKey || e.altKey) return;
    const cmd = boardCommand(e.key);
    if (cmd === null) return;
    e.preventDefault();
    keyboardMode = true;
    if (cmd.type === "move") cursor = moveCursor(grid, cursor, cmd.direction);
    else if (cmd.type === "cycle") onedit([[cursor, nextState(edges[cursor] as EdgeState)]], false);
    else if (cmd.type === "cross") onedit([[cursor, EdgeState.Cross]], false);
    else if (cmd.type === "erase") onedit([[cursor, EdgeState.Unknown]], false);
  }
</script>

<div class="board" style:width="{layout.width}px" style:height="{layout.height}px">
  <!-- The board is one focusable widget: pointer input is hit-tested by geometry and keyboard input
       moves an edge cursor, so its edges need no DOM elements of their own. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <svg
    bind:this={svg}
    width={layout.width}
    height={layout.height}
    viewBox="0 0 {layout.width} {layout.height}"
    role="application"
    aria-label="Puzzle board, {grid.width} by {grid.height}. Arrow keys move the edge cursor; Space cycles line, cross, empty."
    aria-describedby="board-cursor"
    tabindex={locked ? -1 : 0}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    {onpointercancel}
    {onkeydown}
    onfocus={() => (focused = true)}
    onblur={() => (focused = false)}
  >
    {#if inside}
      {#each inside as isIn, i (i)}
        {#if isIn}
          {@const p = cellPoint(grid, layout, i)}
          <rect class="wash" x={p.x - S / 2} y={p.y - S / 2} width={S} height={S} />
        {/if}
      {/each}
    {/if}

    {#each lines as e (e)}
      {@const s = edgeSegment(grid, layout, e)}
      <line
        class="line"
        class:loop={loopEdges.has(e)}
        x1={s.x1}
        y1={s.y1}
        x2={s.x2}
        y2={s.y2}
        stroke-width={lineWidth}
      />
    {/each}

    {#each crosses as e (e)}
      {@const s = edgeSegment(grid, layout, e)}
      {@const mx = (s.x1 + s.x2) / 2}
      {@const my = (s.y1 + s.y2) / 2}
      <path
        class="cross"
        d="M{mx - crossArm} {my - crossArm}L{mx + crossArm} {my + crossArm}M{mx + crossArm} {my - crossArm}L{mx - crossArm} {my + crossArm}"
        stroke-width={Math.max(1.5, S * 0.05)}
      />
    {/each}

    {#each dots as p, d (d)}
      <circle class="dot" cx={p.x} cy={p.y} r={dotRadius} />
    {/each}

    {#each clues as q (q.cell)}
      <text
        class="clue"
        class:bad={badCells.has(q.cell)}
        x={q.x}
        y={q.y}
        font-size={S * 0.56}>{q.text}</text
      >
      {#if badCells.has(q.cell)}
        <circle class="ring" cx={q.x} cy={q.y} r={S * 0.34 - 1} />
      {/if}
    {/each}

    {#each v.dots as d (d)}
      {@const p = dotPoint(grid, layout, d)}
      <circle class="ring" cx={p.x} cy={p.y} r={S * 0.26 - 1} />
    {/each}

    {#if showCursor}
      <rect
        class="cursor"
        x={cursorBox.x}
        y={cursorBox.y}
        width={cursorBox.width}
        height={cursorBox.height}
        rx={cursorBox.radius}
      />
    {/if}
  </svg>
  {#if showCursor}
    <div class="tip" style:left="{cursorBox.labelX}px" style:top="{cursorBox.labelY}px" aria-hidden="true">
      {cursorLabel}
    </div>
  {/if}
  <p id="board-cursor" class="visually-hidden" aria-live="polite">{showCursor ? cursorLabel : ""}</p>
</div>

<style>
  .board {
    position: relative;
  }

  svg {
    display: block;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    cursor: pointer;
    outline: none;
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
    pointer-events: none;
  }

  .clue.bad {
    fill: var(--shu);
  }

  .ring {
    fill: none;
    stroke: var(--shu);
    stroke-width: 2;
    pointer-events: none;
  }

  .cursor {
    fill: none;
    stroke: var(--ai);
    stroke-width: 3;
    pointer-events: none;
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
    z-index: 1;
  }
</style>
```

Create `apps/web/src/lib/components/PauseButton.svelte`:

```svelte
<script lang="ts">
  interface Props {
    paused: boolean;
    disabled?: boolean;
    ontoggle: () => void;
  }

  let { paused, disabled = false, ontoggle }: Props = $props();
</script>

<button
  type="button"
  class="pause"
  aria-label={paused ? "Resume" : "Pause"}
  {disabled}
  onclick={ontoggle}
>
  {#if paused}
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"
      ><path d="M4 2.5v9l7.5-4.5z" fill="currentColor" /></svg
    >
  {:else}
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"
      ><path d="M4 2v10M10 2v10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></svg
    >
  {/if}
</button>

<style>
  .pause {
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
    border-radius: 50%;
    border: 0;
    padding: 0;
    background: var(--ink);
    color: var(--on-ink);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .pause:disabled {
    background: var(--disabled);
    cursor: default;
  }
</style>
```

Create `apps/web/src/lib/components/ToolBar.svelte`:

```svelte
<script lang="ts">
  interface Props {
    canUndo: boolean;
    canRedo: boolean;
    canClear: boolean;
    onundo: () => void;
    onredo: () => void;
    onclear: () => void;
  }

  let { canUndo, canRedo, canClear, onundo, onredo, onclear }: Props = $props();
</script>

<!-- Phones: the tray under the board from the Play artboard. Wide screens: the button grid from the
     Desktop artboard, with keyboard shortcuts shown. -->
<nav class="tools" aria-label="Puzzle tools">
  <button type="button" disabled={!canUndo} onclick={onundo}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg
    >Undo <kbd>Z</kbd>
  </button>
  <button type="button" disabled={!canRedo} onclick={onredo}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg
    >Redo <kbd>Y</kbd>
  </button>
  <button type="button" disabled={!canClear} onclick={onclear}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg
    >Clear
  </button>
</nav>

<style>
  .tools {
    height: 68px;
    background: var(--sheet);
    border: 2px solid var(--ink);
    border-radius: 12px;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding: 4px;
  }

  button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 56px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--ink);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  button:disabled {
    color: var(--disabled);
    cursor: default;
  }

  kbd {
    display: none;
    font-family: inherit;
    font-size: 12px;
    padding: 1px 6px;
    border: 1.5px solid var(--hairline);
    border-radius: 4px;
    color: var(--ink-soft);
  }

  @media (min-width: 900px) {
    .tools {
      height: auto;
      padding: 0;
      border: 0;
      background: none;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    button {
      flex-direction: row;
      gap: 8px;
      height: 52px;
      border: 2px solid var(--ink);
      background: var(--sheet);
      font-size: 15px;
    }

    button:disabled {
      border-color: var(--hairline);
    }

    svg {
      display: none;
    }

    kbd {
      display: inline;
    }
  }
</style>
```

Create `apps/web/src/lib/components/SolvedSeal.svelte`:

```svelte
<!-- The 完 seal stamped on the board when the puzzle is solved (Play and Solved artboards). -->
<div class="seal" role="img" aria-label="Solved">
  <span class="kanji" aria-hidden="true">完</span><span class="word" aria-hidden="true">SOLVED</span>
</div>

<style>
  .seal {
    position: absolute;
    right: -6px;
    top: -14px;
    width: 92px;
    height: 92px;
    border: 4px solid var(--shu);
    border-radius: 14px;
    background: color-mix(in srgb, var(--sheet) 85%, transparent);
    color: var(--shu);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    transform: rotate(-8deg);
    font-family: var(--font-display);
    line-height: 1;
    pointer-events: none;
    animation: stamp 300ms ease-out both;
  }

  .kanji {
    font-size: 44px;
    font-weight: 900;
  }

  .word {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    margin-top: 2px;
  }

  @keyframes stamp {
    from {
      opacity: 0;
      transform: translateY(-12px) rotate(-8deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .seal {
      animation: none;
    }
  }
</style>
```

Create `apps/web/src/lib/components/ThemeSwitch.svelte`:

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { applyThemeChoice, readThemeChoice, saveThemeChoice, type ThemeChoice } from "../theme.ts";

  const OPTIONS: { value: ThemeChoice; label: string }[] = [
    { value: "light", label: "紙 Paper" },
    { value: "dark", label: "夜 Night" },
    { value: "system", label: "System" },
  ];

  let choice: ThemeChoice = $state("system");

  onMount(() => {
    choice = readThemeChoice(localStorage);
  });

  function pick(value: ThemeChoice) {
    choice = value;
    saveThemeChoice(localStorage, value);
    applyThemeChoice(document.documentElement, value);
  }
</script>

<fieldset class="switch">
  <legend class="visually-hidden">Theme</legend>
  {#each OPTIONS as o (o.value)}
    <button type="button" aria-pressed={choice === o.value} onclick={() => pick(o.value)}>
      {o.label}
    </button>
  {/each}
</fieldset>

<style>
  .switch {
    display: inline-flex;
    margin: 0;
    min-width: 0;
    padding: 3px;
    gap: 2px;
    border: 2px solid var(--ink);
    border-radius: 999px;
  }

  button {
    height: 34px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--ink);
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
  }

  button[aria-pressed="true"] {
    background: var(--ink);
    color: var(--on-ink);
  }
</style>
```

Create `apps/web/src/lib/components/PlayScreen.svelte`:

```svelte
<script lang="ts">
  import { analyzeBoard } from "@loophole/core";
  import { onMount } from "svelte";
  import {
    applyChanges,
    type Board,
    clearAll,
    createBoard,
    type EdgeChange,
    hasMarks,
    redo,
    undo,
  } from "../game/board.ts";
  import {
    fitLayout,
    MAX_CELL,
    minBoardHeight,
    POINTER_MIN_CELL,
    TOUCH_MIN_CELL,
  } from "../game/geometry.ts";
  import { type Command, screenCommand } from "../game/keyboard.ts";
  import { violationMessages } from "../game/messages.ts";
  import { createProgressStore, type ProgressStore } from "../game/progress.ts";
  import {
    createStopwatch,
    elapsed,
    formatClock,
    type Stopwatch,
    start,
    stop,
  } from "../game/timer.ts";
  import { type PuzzleEntry, puzzleTitle } from "../puzzles/index.ts";
  import BoardView from "./BoardView.svelte";
  import PauseButton from "./PauseButton.svelte";
  import SolvedSeal from "./SolvedSeal.svelte";
  import ToolBar from "./ToolBar.svelte";

  interface Props {
    entry: PuzzleEntry;
  }

  let { entry }: Props = $props();

  const puzzle = $derived(entry.puzzle);
  const grid = $derived(puzzle.grid);

  // The page re-creates this component for each puzzle, so reading `entry` once here is fine.
  // svelte-ignore state_referenced_locally
  let board: Board = $state.raw(createBoard(entry.puzzle.grid.edgeCount));
  let watch: Stopwatch = $state.raw(createStopwatch());
  let now = $state(0);
  let paused = $state(false);
  let ready = $state(false);
  let store: ProgressStore | null = null;

  const analysis = $derived(analyzeBoard(puzzle, board.edges));
  const solved = $derived(analysis.solved);
  const messages = $derived(solved ? [] : violationMessages(analysis.violations));
  const clock = $derived(formatClock(elapsed(watch, now)));
  const locked = $derived(paused || solved || !ready);

  // Board sizing. On phones the stage holds just the board, and an empty spacer under the notes
  // takes the rest of the height, so stage + spacer is the room the board may use; that sum does not
  // change when the board grows, so the fit is stable. On wide screens the stage fills its column.
  let stageWidth = $state(0);
  let stageHeight = $state(0);
  let spacerHeight = $state(0);
  let coarse = $state(false);
  let wide = $state(false);
  const FRAME = 4; // the frame's 2px border on each side; the offset shadow is outside the layout
  const minCell = $derived(coarse ? TOUCH_MIN_CELL : POINTER_MIN_CELL);
  const roomWidth = $derived(stageWidth - FRAME);
  const roomHeight = $derived((wide ? stageHeight : stageHeight + spacerHeight) - FRAME);
  const layout = $derived(
    stageWidth > 0
      ? fitLayout(grid.width, grid.height, roomWidth, roomHeight, minCell, MAX_CELL)
      : null,
  );
  const stageMinHeight = $derived(
    stageWidth > 0 ? minBoardHeight(grid.width, grid.height, roomWidth, minCell) + FRAME : 0,
  );

  function save() {
    store?.save(entry.id, {
      edges: board.edges,
      elapsedMs: elapsed(watch, performance.now()),
      solved,
    });
  }

  function update(next: Board) {
    if (next === board) return;
    board = next;
    save();
  }

  function edit(changes: EdgeChange[], merge: boolean) {
    if (!locked) update(applyChanges(board, changes, merge));
  }

  function setPaused(value: boolean) {
    if (!ready || solved || value === paused) return;
    paused = value;
    const t = performance.now();
    watch = value ? stop(watch, t) : start(watch, t);
    now = t;
    save();
  }

  function run(cmd: Command) {
    if (cmd.type === "pause") setPaused(!paused);
    else if (locked) return;
    else if (cmd.type === "undo") update(undo(board));
    else if (cmd.type === "redo") update(redo(board));
  }

  function onwindowkeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
    const cmd = screenCommand(e);
    if (cmd === null) return;
    e.preventDefault();
    run(cmd);
  }

  function clear() {
    if (!locked) update(clearAll(board));
  }

  function startOver() {
    store?.clear(entry.id);
    board = createBoard(grid.edgeCount);
    now = performance.now();
    watch = start(createStopwatch(), now);
    paused = false;
  }

  // Solving stops the clock and records the result (FR-17, client side).
  $effect(() => {
    if (solved && watch.since !== null) {
      watch = stop(watch, performance.now());
      save();
    }
  });

  onMount(() => {
    coarse = matchMedia("(pointer: coarse)").matches;
    const wideQuery = matchMedia("(min-width: 900px)");
    wide = wideQuery.matches;
    const onwide = () => {
      wide = wideQuery.matches;
    };
    wideQuery.addEventListener("change", onwide);
    store = createProgressStore(localStorage);
    const saved = store.load(entry.id, grid);
    if (saved !== null) {
      board = createBoard(grid.edgeCount, saved.edges);
      watch = createStopwatch(saved.elapsedMs);
    }
    now = performance.now();
    if (!analyzeBoard(puzzle, board.edges).solved) watch = start(watch, now);
    ready = true;

    const tick = setInterval(() => {
      now = performance.now();
    }, 250);
    // Leaving the tab pauses the clock (and hides the board) and saves, since a phone may never
    // come back to this page.
    const onvisibility = () => {
      if (document.visibilityState === "hidden") {
        setPaused(true);
        save();
      }
    };
    document.addEventListener("visibilitychange", onvisibility);
    window.addEventListener("pagehide", save);
    return () => {
      clearInterval(tick);
      wideQuery.removeEventListener("change", onwide);
      document.removeEventListener("visibilitychange", onvisibility);
      window.removeEventListener("pagehide", save);
      save();
    };
  });
</script>

<svelte:window onkeydown={onwindowkeydown} />

<div class="screen">
  <header class="bar">
    <a class="back" href="/">
      <span class="visually-hidden">Back to puzzles</span>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><path d="M15 5l-7 7 7 7" /></svg
      >
    </a>
    <div class="titles">
      <h1>{puzzleTitle(entry)}</h1>
      <span class="subtitle">{entry.subtitle}</span>
      <span class="subtitle count"><b>{analysis.satisfiedClues}</b> of {analysis.clueCount} clues</span>
    </div>
    <div class="pill">
      <span class="clock" role="timer">{clock}</span>
      <PauseButton {paused} disabled={solved} ontoggle={() => setPaused(!paused)} />
    </div>
  </header>

  <p class="status">
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
          {#if paused}
            <div class="paused">
              <span class="paused-title">一時停止</span>
              <span class="paused-text">Paused — the board is hidden while the clock is stopped.</span>
              <button type="button" class="primary" onclick={() => setPaused(false)}>Resume</button>
            </div>
          {:else}
            <BoardView {puzzle} edges={board.edges} {analysis} {layout} {locked} onedit={edit} />
          {/if}
          {#if solved}
            <SolvedSeal />
          {/if}
        </div>
      {/if}
    </div>

    <div class="side">
      <div class="timecard">
        <div class="timecard-text">
          <span class="label">Time</span>
          <span class="big-clock">{clock}</span>
          <span class="soft"><b>{analysis.satisfiedClues}</b> of {analysis.clueCount} clues satisfied</span>
        </div>
        <button type="button" class="outline" disabled={solved} onclick={() => setPaused(!paused)}>
          {paused ? "Resume" : "Pause"} <kbd>P</kbd>
        </button>
      </div>

      <div class="notes">
        {#if solved}
          <div class="card solved-card">
            <div class="solved-text">
              <span class="solved-title">Solved in {clock}</span>
              <span class="soft">Saved on this device.</span>
            </div>
            <button type="button" class="primary" onclick={startOver}>Start over</button>
          </div>
        {:else if messages.length > 0}
          <div class="card errors" role="status">
            {#each messages as m (m.title)}
              <p class="error"><span class="ring" aria-hidden="true"></span><span><b>{m.title}</b> {m.detail}</span></p>
            {/each}
          </div>
        {:else}
          <p class="idle">
            Tap an edge between two dots: <b>line</b>, then <b>×</b>, then empty. Drag to draw a run of
            lines.
          </p>
        {/if}
      </div>

      <div class="spacer" bind:clientHeight={spacerHeight}></div>

      {#if !solved}
        <ToolBar
          canUndo={!locked && board.past.length > 0}
          canRedo={!locked && board.future.length > 0}
          canClear={!locked && hasMarks(board)}
          onundo={() => run({ type: "undo" })}
          onredo={() => run({ type: "redo" })}
          onclear={clear}
        />
      {/if}

      <section class="card keys" aria-labelledby="keys-h">
        <h2 id="keys-h">Keyboard</h2>
        <dl>
          <dt>← ↑ → ↓</dt><dd>move the edge cursor</dd>
          <dt>Space</dt><dd>line → × → empty</dd>
          <dt>X</dt><dd>cross the edge</dd>
          <dt>Backspace</dt><dd>clear the edge</dd>
          <dt>Z / Y</dt><dd>undo / redo</dd>
          <dt>P</dt><dd>pause</dd>
          <dt>Mouse</dt><dd>click to cycle, drag to draw a run</dd>
        </dl>
      </section>
    </div>
  </main>
</div>

<style>
  .screen {
    min-height: 100dvh;
    max-width: 1280px;
    margin: 0 auto;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 10px;
    overscroll-behavior: none;
  }

  .bar {
    height: 52px;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .back {
    width: 44px;
    height: 44px;
    flex: 0 0 auto;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .titles {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }

  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 20px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .subtitle {
    font-size: 13px;
    font-weight: 500;
    color: var(--ink-soft);
  }

  .pill {
    flex: 0 0 auto;
    height: 44px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 5px 0 14px;
    border-radius: 999px;
    background: var(--sheet);
    border: 2px solid var(--ink);
  }

  .clock {
    font-size: 17px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .status {
    margin: 0;
    flex: 0 0 auto;
    font-size: 14px;
    color: var(--ink-soft);
  }

  .status b,
  .soft b {
    color: var(--ink);
  }

  .play {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .stage {
    flex: 0 0 auto;
    display: flex;
    justify-content: center;
    align-items: flex-start;
  }

  .frame {
    position: relative;
    flex: 0 0 auto;
    background: var(--sheet);
    border: 2px solid var(--ink);
    box-shadow: 4px 4px 0 var(--frame-shadow);
  }

  .paused {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 16px;
    text-align: center;
  }

  .paused-title {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 34px;
  }

  .paused-text {
    font-size: 15px;
    color: var(--ink-soft);
  }

  /* On phones the side column's children sit directly in the screen's column. */
  .side {
    display: contents;
  }

  .count {
    display: none;
  }

  .notes {
    display: flex;
    flex-direction: column;
  }

  .idle {
    margin: 0;
    font-size: 15px;
    line-height: 1.5;
    color: var(--ink-soft);
  }

  .idle b {
    color: var(--ink);
  }

  .spacer {
    flex: 1 1 0;
    min-height: 0;
  }

  .card {
    background: var(--sheet);
    border: 2px solid var(--ink);
    border-radius: 6px;
  }

  .errors {
    border-color: var(--shu);
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .error {
    margin: 0;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 15px;
    line-height: 1.45;
  }

  .error b {
    color: var(--shu);
  }

  .ring {
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    border: 2px solid var(--shu);
    border-radius: 50%;
  }

  .solved-card {
    padding: 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .solved-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .solved-title {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 22px;
  }

  .soft {
    font-size: 14px;
    color: var(--ink-soft);
  }

  .primary {
    flex: 0 0 auto;
    height: 44px;
    padding: 0 18px;
    border: 0;
    border-radius: 999px;
    background: var(--ink);
    color: var(--on-ink);
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }

  .outline {
    height: 48px;
    padding: 0 20px;
    border-radius: 999px;
    border: 2px solid var(--ink);
    background: transparent;
    color: var(--ink);
    font-size: 15px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .outline:disabled {
    color: var(--disabled);
    border-color: var(--hairline);
    cursor: default;
  }

  kbd {
    font-family: inherit;
    font-size: 12px;
    padding: 1px 6px;
    border: 1.5px solid var(--hairline);
    border-radius: 4px;
    color: var(--ink-soft);
  }

  .timecard,
  .keys {
    display: none;
  }

  /* The smallest phones (Small artboard, 360×560): a 14px gutter keeps 7×7 at 44px cells, and the
     clue count moves into the header. */
  @media (max-width: 379px) {
    .screen {
      padding-inline: 14px;
    }
  }

  @media (max-height: 620px) {
    .screen {
      padding-block: 8px calc(8px + env(safe-area-inset-bottom));
      gap: 8px;
    }

    .bar {
      height: 48px;
    }

    .play {
      gap: 8px;
    }

    .status,
    .subtitle {
      display: none;
    }

    .subtitle.count {
      display: block;
    }

    .idle {
      font-size: 14px;
      line-height: 1.45;
    }
  }

  /* Wide screens: board on the left, timer, tools and keyboard help on the right (Desktop artboard). */
  @media (min-width: 900px) {
    .screen {
      padding: 20px 24px 32px;
      gap: 14px;
    }

    h1 {
      font-size: 34px;
    }

    .subtitle {
      font-size: 16px;
    }

    .pill,
    .status,
    .spacer {
      display: none;
    }

    .play {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(300px, 380px);
      grid-template-rows: minmax(0, 1fr);
      gap: 32px;
    }

    .stage {
      min-height: 0;
    }

    .frame {
      box-shadow: 6px 6px 0 var(--frame-shadow);
    }

    .side {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .timecard {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 18px;
      background: var(--sheet);
      border: 2px solid var(--ink);
      border-radius: 6px;
    }

    .timecard-text {
      display: flex;
      flex-direction: column;
    }

    .label {
      font-size: 13px;
      font-weight: 700;
      color: var(--ink-soft);
    }

    .big-clock {
      font-family: var(--font-display);
      font-weight: 900;
      font-size: 44px;
      line-height: 1.05;
      font-variant-numeric: tabular-nums;
    }

    .keys {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 16px 18px;
    }

    .keys h2 {
      margin: 0;
      font-family: var(--font-display);
      font-weight: 900;
      font-size: 18px;
    }

    .keys dl {
      margin: 0;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 8px 14px;
      font-size: 14px;
      align-items: center;
    }

    .keys dt {
      font-weight: 700;
    }

    .keys dd {
      margin: 0;
      color: var(--ink-soft);
    }
  }
</style>
```

Create `apps/web/src/routes/+page.ts`:

```ts
import { puzzleSource } from "$lib/puzzles/index.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async () => ({ puzzles: await puzzleSource.list() });
```

Replace `apps/web/src/routes/+page.svelte`:

```svelte
<script lang="ts">
  import { createGrid } from "@loophole/core";
  import { onMount } from "svelte";
  import ThemeSwitch from "$lib/components/ThemeSwitch.svelte";
  import { createProgressStore } from "$lib/game/progress.ts";
  import { formatClock } from "$lib/game/timer.ts";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  type Status = { kind: "new" } | { kind: "playing" | "solved"; clock: string };
  let statuses: Record<string, Status> = $state({});

  onMount(() => {
    const store = createProgressStore(localStorage);
    for (const p of data.puzzles) {
      const saved = store.load(p.id, createGrid(p.width, p.height));
      statuses[p.id] =
        saved === null
          ? { kind: "new" }
          : { kind: saved.solved ? "solved" : "playing", clock: formatClock(saved.elapsedMs) };
    }
  });

  // Pale cover tints per size class (design kit, Colour). Text on covers is always ink.
  function tint(width: number): string {
    if (width <= 7) return "#F2C4CE";
    if (width <= 10) return "#E8DFC4";
    if (width <= 20) return "#C8DAE6";
    return "#D5E3C2";
  }
</script>

<svelte:head>
  <title>Loophole</title>
</svelte:head>

<header class="top">
  <div class="top-inner">
    <a class="brand" href="/">
      <svg width="24" height="30" viewBox="0 0 196 252" aria-hidden="true">
        <polyline points="14,14 182,14 182,126 126,126 126,238 70,238 70,126 14,126" fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" />
        <line x1="14" y1="126" x2="14" y2="14" stroke="var(--shu)" stroke-width="24" stroke-linecap="round" />
      </svg>
      <span>Loophole</span>
    </a>
    <ThemeSwitch />
  </div>
</header>

<main class="page">
  <h1>Practice puzzles</h1>
  <ul class="covers">
    {#each data.puzzles as p (p.id)}
      {@const status = statuses[p.id] ?? { kind: "new" }}
      <li>
        <a class="cover" href="/play/{p.id}" style:background={tint(p.width)}>
          <span class="badge">{p.width}×{p.height}</span>
          <span class="kana">スリザーリンク</span>
          <span class="name">{p.name}</span>
          <span class="paper" aria-hidden="true"></span>
          <span class="status">
            {#if status.kind === "solved"}
              <span class="stamp" aria-hidden="true">完</span>Solved · {status.clock}
            {:else if status.kind === "playing"}
              <span class="dot" aria-hidden="true"></span>In progress · {status.clock}
            {:else}
              <span class="dot hollow" aria-hidden="true"></span>New · not started
            {/if}
          </span>
        </a>
      </li>
    {/each}
  </ul>
</main>

<style>
  .top {
    background: var(--sheet);
    border-bottom: 2px solid var(--ink);
  }

  .top-inner {
    max-width: 960px;
    margin: 0 auto;
    min-height: 56px;
    padding: 6px 16px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 24px;
    letter-spacing: -0.01em;
  }

  .page {
    max-width: 960px;
    margin: 0 auto;
    padding: 16px 16px calc(24px + env(safe-area-inset-bottom));
  }

  h1 {
    margin: 0 0 14px;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 32px;
    line-height: 1.15;
  }

  .covers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
  }

  .cover {
    position: relative;
    height: 184px;
    padding: 12px;
    border-radius: 6px;
    color: #1e1c19;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .cover:hover {
    color: #1e1c19;
    outline: 2px solid #1e1c19;
  }

  .badge {
    position: absolute;
    top: 0;
    right: 0;
    padding: 5px 9px;
    border-radius: 0 6px 0 6px;
    background: #23355e;
    color: #fffdf8;
    font-size: 13px;
    font-weight: 700;
  }

  .kana {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
  }

  .name {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 24px;
    line-height: 1;
  }

  .paper {
    flex: 1 1 auto;
    border: 2px solid #1e1c19;
    background-color: #fffdf8;
    background-image: radial-gradient(#1e1c19 1.3px, transparent 1.6px);
    background-size: 12px 12px;
    background-position: 4px 4px;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 700;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #2e4c8a;
  }

  .dot.hollow {
    background: none;
    border: 1.5px solid #1e1c19;
  }

  .stamp {
    width: 18px;
    height: 18px;
    border: 2px solid #c23b22;
    border-radius: 4px;
    color: #c23b22;
    font-family: var(--font-display);
    font-size: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
```

Create `apps/web/src/routes/play/[id]/+page.ts`:

```ts
import { error } from "@sveltejs/kit";
import { puzzleSource } from "$lib/puzzles/index.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params }) => {
  const entry = await puzzleSource.get(params.id);
  if (entry === null) error(404, "Puzzle not found");
  return { entry };
};
```

Create `apps/web/src/routes/play/[id]/+page.svelte`:

```svelte
<script lang="ts">
  import PlayScreen from "$lib/components/PlayScreen.svelte";
  import { puzzleTitle } from "$lib/puzzles/index.ts";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{puzzleTitle(data.entry)} · Loophole</title>
</svelte:head>

{#key data.entry.id}
  <PlayScreen entry={data.entry} />
{/key}
```

Create `apps/web/src/routes/+error.svelte`:

```svelte
<script lang="ts">
  import { page } from "$app/state";
</script>

<main class="error">
  <h1>{page.status === 404 ? "Not found" : "Something went wrong"}</h1>
  <p>{page.error?.message}</p>
  <a href="/">Back to puzzles</a>
</main>

<style>
  .error {
    max-width: 560px;
    margin: 0 auto;
    padding: 48px 16px;
  }

  h1 {
    font-family: var(--font-display);
    font-weight: 900;
  }

  a {
    font-weight: 700;
    color: var(--ai);
  }
</style>
```

Verify:
- `bun run check` passes with 0 `svelte-check` warnings (it runs with `--fail-on-warnings`; unused CSS selectors count).
- `bun run dev:web`, open http://localhost:5173/play/small-7: the 7×7 board shows; clicking an edge draws a line, again a ×, again empty; dragging along a row draws a run; Undo removes the run; P pauses and hides the board. Stop the server afterwards.

Commit: `feat(web): add play screen with SVG board`

### Step 8 — Playwright end-to-end tests

Create `apps/web/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

// End-to-end tests against the built app. Not part of `bun run check`: they need a Chromium build
// (`bunx playwright install chromium`). Run with `bun run test:e2e` from this package.
export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run build && bun run preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    // Always serve a fresh build; fails fast if something else already holds the port.
    reuseExistingServer: false,
  },
});
```

Create `apps/web/tests/board.ts`:

```ts
import { createGrid, type Grid } from "@loophole/core";
import type { Page } from "@playwright/test";

/** Page coordinates of every dot, read from the rendered board (dots render in index order). */
export async function dotPoints(page: Page): Promise<{ x: number; y: number }[]> {
  const box = await page.locator("svg[role=application]").boundingBox();
  if (box === null) throw new Error("board not visible");
  const local = await page
    .locator("svg[role=application] circle.dot")
    .evaluateAll((els) =>
      els.map((el) => ({ x: Number(el.getAttribute("cx")), y: Number(el.getAttribute("cy")) })),
    );
  return local.map((p) => ({ x: box.x + p.x, y: box.y + p.y }));
}

export async function edgePoint(page: Page, grid: Grid, edge: number) {
  const dots = await dotPoints(page);
  const a = dots[grid.edgeDots[edge * 2]];
  const b = dots[grid.edgeDots[edge * 2 + 1]];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function gridFor(width: number, height: number): Grid {
  return createGrid(width, height);
}

export async function lineCount(page: Page): Promise<number> {
  return page.locator("svg[role=application] line.line").count();
}

export async function crossCount(page: Page): Promise<number> {
  return page.locator("svg[role=application] path.cross").count();
}

/** A real touch drag through Chromium's input pipeline (Playwright's touchscreen only taps). */
export async function touchDrag(page: Page, points: { x: number; y: number }[]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const [first, ...rest] = points;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first] });
  for (const p of rest) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
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

Create `apps/web/tests/play.e2e.ts`:

```ts
import { hEdgeIndex, vEdgeIndex } from "@loophole/core";
import { expect, test } from "@playwright/test";
import { FIXTURE_SOLUTIONS } from "../src/lib/test-support/solutions.ts";
import {
  crossCount,
  dotPoints,
  edgePoint,
  gridFor,
  lineCount,
  scrollsSideways,
  touchDrag,
} from "./board.ts";

const grid7 = gridFor(7, 7);

// The two phone sizes from the design kit: Small (360×560) and Play (390×664).
for (const [width, height] of [
  [360, 560],
  [390, 664],
] as const) {
  test.describe(`phone ${width}×${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: true });

    test.beforeEach(async ({ page }) => {
      await page.goto("/play/small-7");
      await expect(page.locator("svg[role=application]")).toBeVisible();
    });

    test("fits the width with 44px cells or more (NFR-2, FR-13)", async ({ page }) => {
      expect(await scrollsSideways(page)).toBe(false);
      const dots = await dotPoints(page);
      expect(dots[1].x - dots[0].x).toBeGreaterThanOrEqual(44);
      await page.goto("/");
      expect(await scrollsSideways(page)).toBe(false);
    });

    test("tap cycles line, cross, empty (FR-13)", async ({ page }) => {
      const p = await edgePoint(page, grid7, hEdgeIndex(grid7, 0, 0));
      await page.touchscreen.tap(p.x, p.y);
      expect(await lineCount(page)).toBe(1);
      await page.touchscreen.tap(p.x, p.y);
      expect([await lineCount(page), await crossCount(page)]).toEqual([0, 1]);
      await page.touchscreen.tap(p.x, p.y);
      expect([await lineCount(page), await crossCount(page)]).toEqual([0, 0]);
    });

    test("drag draws a run of lines; one undo removes it (FR-13, FR-14)", async ({ page }) => {
      const dots = await dotPoints(page);
      const row = [0, 1, 2, 3].map((c) => dots[3 * 8 + c]);
      await touchDrag(page, [row[0], row[1], row[2], row[3]]);
      expect(await lineCount(page)).toBe(3);
      await page.getByRole("button", { name: "Undo" }).click();
      expect(await lineCount(page)).toBe(0);
      await page.getByRole("button", { name: "Redo" }).click();
      expect(await lineCount(page)).toBe(3);
      await page.getByRole("button", { name: "Clear" }).click();
      expect(await lineCount(page)).toBe(0);
    });

    test("flags a dot with three lines (FR-15)", async ({ page }) => {
      for (const e of [hEdgeIndex(grid7, 3, 2), hEdgeIndex(grid7, 3, 3), vEdgeIndex(grid7, 3, 3)]) {
        const p = await edgePoint(page, grid7, e);
        await page.touchscreen.tap(p.x, p.y);
      }
      await expect(page.getByText("Three lines meet at a dot.")).toBeVisible();
    });

    test("pause hides the board (FR-14)", async ({ page }) => {
      await page.getByRole("button", { name: "Pause" }).first().click();
      await expect(page.getByText("一時停止")).toBeVisible();
      await expect(page.locator("svg[role=application]")).toHaveCount(0);
      await page.getByRole("button", { name: "Resume" }).first().click();
      await expect(page.locator("svg[role=application]")).toBeVisible();
    });

    test("detects the solve and keeps it after a reload (FR-17, FR-21)", async ({ page }) => {
      const solution = FIXTURE_SOLUTIONS["small-7"];
      for (let e = 0; e < solution.length; e++) {
        if (solution[e] !== "1") continue;
        const p = await edgePoint(page, grid7, e);
        await page.touchscreen.tap(p.x, p.y);
      }
      await expect(page.getByRole("img", { name: "Solved" })).toBeVisible();
      await expect(page.getByText(/Solved in \d\d:\d\d/)).toBeVisible();
      await page.reload();
      await expect(page.getByRole("img", { name: "Solved" })).toBeVisible();
    });
  });
}

test.describe("progress", () => {
  test("survives a reload (FR-21, guest)", async ({ page }) => {
    await page.goto("/play/tiny-5");
    const grid5 = gridFor(5, 5);
    const p = await edgePoint(page, grid5, vEdgeIndex(grid5, 2, 2));
    await page.mouse.click(p.x, p.y);
    await page.reload();
    await expect(page.locator("svg[role=application] line.line")).toHaveCount(1);
  });
});

test.describe("desktop keyboard (NFR-5)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("arrows move the cursor; Space, X and Backspace mark; Z and Y undo and redo", async ({
    page,
  }) => {
    await page.goto("/play/small-7");
    const board = page.locator("svg[role=application]");
    await board.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText("Row 1 · between columns 2 and 3 · empty").first()).toBeVisible();
    await page.keyboard.press("Space");
    expect(await lineCount(page)).toBe(1);
    await page.keyboard.press("x");
    expect([await lineCount(page), await crossCount(page)]).toEqual([0, 1]);
    await page.keyboard.press("Backspace");
    expect(await crossCount(page)).toBe(0);
    await page.keyboard.press("z");
    expect(await crossCount(page)).toBe(1);
    await page.keyboard.press("y");
    expect(await crossCount(page)).toBe(0);
    await page.keyboard.press("p");
    await expect(page.getByText("一時停止")).toBeVisible();
  });
});

test.describe("theme (FR-16)", () => {
  test("follows the system and remembers an override", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    const ground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await ground()).toBe("rgb(17, 24, 39)");
    await page.getByRole("button", { name: "紙 Paper" }).click();
    expect(await ground()).toBe("rgb(244, 239, 227)");
    await page.reload();
    expect(await ground()).toBe("rgb(244, 239, 227)");
  });
});
```

Verify:
- `bun run check` passes (the test config type-checks `tests/`; Biome lints them; `bun test` does not pick up `*.e2e.ts`).
- `bun run test:e2e` → `15 passed`.

Commit: `test(web): add Playwright end-to-end tests`

### Step 9 — docs

1. Create `apps/web/AGENTS.md`:

```markdown
# web

The Loophole player app: a SvelteKit single-page app (Svelte 5 runes, static adapter with an `index.html` fallback, no server-side rendering). Boards up to 30×30 render as SVG and take touch, mouse and keyboard input.

- Game logic (edge history, stopwatch, hit-testing, drag strokes, keyboard cursor, saved progress, theme choice) lives in plain TypeScript modules with `bun:test` tests beside them. Keep those modules free of runes, `$lib`/`$app` imports and DOM access so the root `bun test` runs them. Components stay thin; the Playwright end-to-end tests cover them.
- Rule checks and completion come from the core package (`analyzeBoard`), not from code here.
- Screens get puzzles through the puzzle source interface, so the built-in fixtures can be replaced by the API without touching the screens.
- Theme colours come from the CSS custom properties in the app stylesheet, which follow the design kit (`docs/design/README.md`). Book-cover tints are the one exception: they are the same in both themes.
- App code type-checks without Bun's types; tests and test helpers use a second config that adds them.
- End-to-end tests end in `.e2e.ts` and run with `bun run test:e2e`. They need a local Chromium and are not part of `bun run check`.
- Biome lints `.svelte` files but does not format them, because its Svelte formatter is still experimental. Follow the style of the existing components.
```

2. Create the symlink: `ln -s AGENTS.md apps/web/CLAUDE.md` (run from the repo root; `ls -l apps/web/CLAUDE.md` shows `-> AGENTS.md`).

3. In `README.md`:
   - Replace the Status paragraph with:

```markdown
Early development. The repo has the build tooling, the local dev services, the design kit, the start of the puzzle engine (the grid model, the wire format, rule checks for play, a brute-force solution counter for tests, and a seeded random number generator) and a first web app. The web app plays a few built-in puzzles on phones and desktops: tap or drag to draw, keyboard play, undo and redo, a pausable timer, error highlighting, solve detection, light and dark themes, and progress saved in the browser. The solver, generator and server are being built in phases; each phase's plan is in [`docs/plans/`](docs/plans/).
```

   - Insert this section between the `bun run check` code block of "Quickstart" and `### Local services`:

````markdown
### Web app

```sh
bun run dev:web
```

Then open http://localhost:5173. Puzzles come from a few built-in fixtures until the server exists. `bun run --cwd apps/web build` writes the static site to `apps/web/build/`; `bun run --cwd apps/web preview` serves that build.

The end-to-end tests drive the built app in Chromium at the design kit's phone sizes (360×560 and 390×664) and on a desktop. They are not part of `bun run check`. The first time, install the browser:

```sh
cd apps/web && bunx playwright install chromium
```

Then run them from the repo root:

```sh
bun run test:e2e
```
````

   - Add these rows at the end of the Scripts table:

```markdown
| `bun run dev:web` | Start the web app's dev server on port 5173 |
| `bun run test:e2e` | Build the web app and run its Playwright tests |
```

   - In "Repository layout", replace the line `apps/              Server and web app (coming in later phases)` with:

```
apps/web           Player web app (SvelteKit, single-page)
apps/              The server comes in a later phase
```

4. Append to `docs/TESTING.md`:

```markdown
## Web app

The web app's game logic is plain TypeScript with `*.test.ts` files beside it, so the root `bun test` runs those tests with everything else. Bun can't load `.svelte` files or SvelteKit's `$lib` and `$app` aliases, which only resolve inside Vite, so the tested modules import neither; Svelte components hold as little logic as possible.

The components are covered by Playwright end-to-end tests (`*.e2e.ts` in the web app's `tests` folder). They build the app, serve it and drive it in Chromium at the design kit's phone sizes and on a desktop. Run them with `bun run test:e2e`. They are not part of `bun run check` because they need a local Chromium (`bunx playwright install chromium` in the web app folder).
```

5. Append to `docs/DECISIONS.md` (after the last entry):

```markdown
## 2026-10-25 · WT4 `web-board` · SvelteKit 2, not 3
- **Question:** Which SvelteKit major should the web app use?
- **Decision:** `@sveltejs/kit` 2.70.3 with `@sveltejs/adapter-static` 3.0.10, `@sveltejs/vite-plugin-svelte` 7.3.1, Vite 8.3.4 and Svelte 5.57.2.
- **Reason:** Kit 3.x needs Node 22.17 or later, and the dev host runs Node 20. Kit 2.70 supports Vite 8, Svelte 5 runes and TypeScript 6. Moving to Kit 3 later is a version bump plus its migration notes.

## 2026-10-25 · WT4 `web-board` · Web tests: plain modules under bun, components under Playwright
- **Question:** The root `bun test` collects every `*.test.ts`, but Bun can't load `.svelte` files or `$lib`/`$app` imports. How are web tests run?
- **Decision:** Game logic lives in plain TypeScript modules that import only relative paths and `@loophole/core`; their tests run in the root `bun test`. Components are covered by Playwright tests (`*.e2e.ts`), run with `bun run test:e2e`, outside the gate. `@playwright/test` is pinned to 1.62.1 because that release uses the Chromium build already installed on the dev host.
- **Reason:** One test runner for unit tests, no second config for the gate, and no browser download in CI. The end-to-end tests still cover the 360×560 and 390×664 checks from the design kit.

## 2026-10-25 · WT4 `web-board` · Web app type-checks without Bun types
- **Question:** The base tsconfig loads Bun's types, which would let Bun globals typecheck in browser code.
- **Decision:** The web app's main tsconfig sets `types: []` and leaves out tests and test helpers; `tsconfig.test.json` adds Bun's types for them. The `typecheck` script runs `svelte-check` with the first and `tsc` with the second.
- **Reason:** Same approach as the core package: a stray `Bun.` in app code fails the typecheck.

## 2026-10-25 · WT4 `web-board` · Biome lints Svelte files but doesn't format them
- **Question:** Should Biome cover `.svelte` files?
- **Decision:** `html.experimentalFullSupportEnabled` is on, so Biome lints `.svelte` files with the template in view (no false "unused" reports for variables used in markup). Its HTML formatter stays off, so `.svelte` files are not formatted.
- **Reason:** Biome 2.6's Svelte formatter is experimental and rewrites markup whitespace; linting with full support works without false positives.

## 2026-10-25 · WT4 `web-board` · Self-hosted fonts
- **Question:** Load Zen Maru Gothic and Zen Kaku Gothic New from Google Fonts or self-host them?
- **Decision:** Self-host with the `@fontsource` packages (Kaku 400/500/700, Maru 700/900).
- **Reason:** No request to a third party on every visit, and the end-to-end tests work offline. The build carries about 20 MB of font subsets, but each browser downloads only the `unicode-range` subsets a page uses.

## 2026-10-25 · WT4 `web-board` · Tap, drag and keyboard input
- **Question:** How exactly do tap, drag and the keyboard cursor behave (FR-13, NFR-5)?
- **Decision:** A press that moves less than max(8 px, a quarter cell) is a tap: on release, the edge whose diamond holds the press point cycles line → cross → empty. A longer move is a drag stroke that follows the dots nearest the pointer and marks the edge between each pair of consecutive dots; it erases lines if its first edge was a line and draws lines otherwise (drawing over crosses). A stroke is one undo step. Only one pointer is tracked; pinch-zoom comes with the large-grid work. The keyboard cursor moves along rows that alternate between horizontal and vertical edges: left and right stay in the row, up and down step to the next row on the left side of the column. Space or Enter cycles, X crosses, Backspace or Delete empties; Z and Y (or Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl+Y) undo and redo, P pauses.
- **Reason:** Dot-to-dot strokes ignore finger wobble across neighbouring diamonds, and erasing from a line makes mistakes easy to fix with the same gesture. Every edge is reachable with the arrow keys, and each key does what the Desktop artboard lists.

## 2026-10-25 · WT4 `web-board` · Board size
- **Question:** How big are cells on each screen?
- **Decision:** The board fits the space under the header: cells up to 58 px (the Desktop artboard), at least 44 px on touch screens and 24 px with a mouse. The board never gets wider than the screen (NFR-2): a 10×10 on a 360 px phone gets 30 px cells until pinch-zoom arrives. On phones the board's size depends only on the viewport, not on the notes under it, so it doesn't jump while you play. Phones narrower than 380 px use a 14 px gutter so a 7×7 keeps 44 px cells, as on the Small artboard.
- **Reason:** Follows the design kit's sizes; the 44 px minimum for wide boards on small phones needs zoom and pan, which is the next web phase.

## 2026-10-25 · WT4 `web-board` · Timer, pause and guest progress
- **Question:** When does the clock run, and what is saved for guests (FR-14, FR-21)?
- **Decision:** The clock starts when the puzzle opens, stops on pause and on solve, and pauses (hiding the board) when the tab is hidden. Guest progress is saved in `localStorage` under `loophole:progress:<puzzle id>` as `{v: 1, edges, elapsedMs, solved}`, with edges in the wire format's edge-state encoding, after every move, pause, solve, tab hide and page exit. Undo history is not saved. A solved puzzle opens solved and locked, with a "Start over" button that clears its progress.
- **Reason:** Leaving the tab shouldn't count as solve time, and a phone may discard a hidden tab without warning. The stored object has a version so a later format (or the sync in FR-21) can tell it apart.

## 2026-10-25 · WT4 `web-board` · Theme details the design kit leaves open
- **Question:** The kit gives no dark solved wash, and its Night artboard frame has no shadow. How is the theme chosen and stored?
- **Decision:** In Night the solved wash is shu at 16% opacity and the board frame has no offset shadow. The choice (Paper, Night or System) is stored under `loophole:theme`; no value means follow the system. A small inline script in the page head applies it before first paint.
- **Reason:** A shu tint keeps the "inside is warm" reading of the Paper wash on a dark sheet, and applying the theme before paint avoids a light flash for dark-mode users.

## 2026-10-25 · WT4 `web-board` · Built-in puzzles and no Hint button yet
- **Question:** Which puzzles does the app ship before the server exists, and what goes in the tool tray?
- **Decision:** Three fixtures in wire format: a 5×5 made for this phase, the 7×7 from the Play artboard and the 10×10 from the Night and Desktop artboards. Each has one solution, checked by a search before they were added. Their solutions live only in the test helpers. The tray has Undo, Redo and Clear; the Hint button arrives with hints.
- **Reason:** Real unique puzzles at the kit's sizes exercise the same paths as served ones, and a Hint button that does nothing would mislead.
```

Verify: `bun run check` passes (Markdown is not linted); README renders the new sections in order.

Commit: `docs: document the web app, its tests and WT4 decisions`

### Step 10 — final check

1. `bun run check` → passes (on this branch: 165 tests across 16 files, 105 core and 60 web).
2. `bun run test:e2e` → `15 passed`.
3. Clean-state sanity: `git status` is clean, and `rm -rf apps/web/.svelte-kit apps/web/build && bun run check` still passes.
4. Optional visual check against the artboards: `bun run --cwd apps/web build && bun run --cwd apps/web preview`, then look at http://localhost:4173/play/small-7 at 390×664 and 360×560 (browser device mode) next to `docs/design/Play.dc.html` and `Small.dc.html`, /play/medium-10 in dark mode next to `Night.dc.html`, and at 1440 wide next to `Desktop.dc.html`.

No commit unless a fix was needed (then `fix(web): …`).

## Acceptance criteria

| Id | Criterion | Checked by |
|---|---|---|
| FR-13 | Tap/click cycles line → × → empty; diamond hit areas tile the board (nearest edge for every point) | `geometry.test.ts` property; e2e "tap cycles…" at 360 and 390 |
| FR-13 | Drag draws a run of lines; a stroke starting on a line erases; one undo per stroke | `gesture.test.ts`, `board.test.ts`; e2e touch drag via CDP |
| FR-13 | Cells ≥ 44 px on touch for 7×7 at 360 and 390 wide | `geometry.test.ts` artboard cases; e2e "fits the width with 44px cells" |
| FR-14 | Undo/redo, clear (undoable), timer (`mm:ss`, `h:mm:ss`), pause hides the board and stops the clock | `board.test.ts`, `timer.test.ts`; e2e drag/undo/redo/clear and pause tests |
| FR-15 | Only core's four violations flagged: shu rings on clues and dots, dashed shu loop, one message per kind | `messages.test.ts`; e2e "flags a dot with three lines"; core `analyze.test.ts` |
| FR-16 | Paper/Night tokens; follows system; override stored and applied before paint | `theme.test.ts`; e2e theme test |
| FR-17 | Solve detected client side; seal + solved card; clock stops; input locked | e2e "detects the solve…" |
| FR-21 (guest) | Progress per puzzle id in `localStorage`, restored on reload; bad data ignored | `progress.test.ts`; e2e reload tests |
| NFR-2 | No horizontal scroll at 360×560 and 390×664 (also after solving); `100dvh`, safe area, no fixed bottom bar, tray under board, overscroll none; SVG for ≤ 30×30 | e2e `scrollsSideways` checks; code review |
| NFR-5 | Keyboard play (arrows, Space/Enter, X, Backspace/Delete, Z/Y, P); visible ai capsule and label; states differ by shape (ring, dash, ×), not colour alone | `keyboard.test.ts`; e2e desktop keyboard test |
| Gate | `bun run check` lints `.svelte`, runs `svelte-check` with `--fail-on-warnings`, type-checks tests with Bun types and app code without, and runs web unit tests in the root `bun test` | Step 2, 10 |
| Follow-ups | `cellCoords`/`dotCoords` in core with round-trip property; web test strategy documented | Step 1, 9 |

## Prototype

The whole plan was built in a scratch copy of the repo before writing it: `bun run check` passed after each step, a fresh clone passed `bun install --frozen-lockfile && bun run check`, and `bun run test:e2e` gave 15 passed. Screenshots of the prototype (360×560, 390×664 drag + errors, Night 10×10 with a premature loop, solved Paper and Night, paused, desktop 1440 with the keyboard cursor, Home) are in `/tmp/claude-1000/-home-jhonnold-projects-loophole/a34715f6-7810-5a69-ba81-edd46bda034d/scratchpad/web-board/shots/`.

Known differences from the artboards, by design: no Hint button (WT8); no "Daily · date" subtitle or Ranks link (WT11); the Desktop artboard's site header (nav, account) is not built — the play screen keeps its own header and the theme switch is on `/`; at 390 wide the 7×7 uses 47 px cells (the artboard shows 46) because the board fills the width.

## Unresolved questions

- None blocking. Defaults chosen are logged in the DECISIONS entries above (Kit 2 over 3, self-hosted fonts, input semantics, auto-pause on tab hide, dark solved wash, no Hint button yet).
