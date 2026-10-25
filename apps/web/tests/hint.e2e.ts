import {
  decodeEdges,
  EdgeState,
  encodeEdges,
  findHint,
  parsePuzzle,
  RULE_TITLE,
  type RuleId,
  type Step,
  solve,
} from "@loophole/core";
import { expect, type Page, test } from "@playwright/test";
import { FIXTURES } from "../src/lib/puzzles/fixtures.ts";
import { FIXTURE_SOLUTIONS } from "../src/lib/test-support/solutions.ts";
import { board, boardView, crosses, edgePoint, lines, twoFingers } from "./board.ts";

const wire = FIXTURES.find((f) => f.id === "small-7")?.wire;
if (wire === undefined) throw new Error("small-7 fixture missing");
const puzzle = parsePuzzle(wire);
const grid = puzzle.grid;
const solution = decodeEdges(grid, FIXTURE_SOLUTIONS["small-7"]);
const empty = new Uint8Array(grid.edgeCount);

/** The step a hint on `edges` shows, worked out here the same way the app does. */
function expectedStep(edges: Uint8Array): Step {
  const hint = findHint(puzzle, solution, edges);
  if (hint.kind !== "step") throw new Error(`expected a step, got ${hint.kind}`);
  return hint.step;
}

/**
 * A board on which the next hint is `rule`: small-7's solver steps replayed from an empty board up
 * to the first point where that rule comes next.
 */
function boardBefore(rule: RuleId): Uint8Array {
  const edges = new Uint8Array(grid.edgeCount);
  for (const step of solve(puzzle).steps) {
    const hint = findHint(puzzle, solution, edges);
    if (hint.kind === "step" && hint.step.rule === rule) return edges;
    for (const c of step.changes) edges[c.edge] = c.state;
  }
  throw new Error(`small-7 never needs ${rule}`);
}

/** Crosses on the first three lines of the solution: a "× doesn't fit" hint with a count. */
function threeWrongCrosses(): Uint8Array {
  const edges = new Uint8Array(grid.edgeCount);
  let n = 0;
  for (let e = 0; e < edges.length && n < 3; e++) {
    if (solution[e] !== EdgeState.Line) continue;
    edges[e] = EdgeState.Cross;
    n++;
  }
  return edges;
}

// Every rule small-7 uses, so the longest texts (parity, the 3s) are among them.
const RULES: RuleId[] = [
  "clue-zero",
  "clue-satisfied",
  "clue-needs-all",
  "dot-full",
  "dot-continue",
  "dot-dead-end",
  "corner-1",
  "corner-3",
  "premature-loop",
  "parity",
  "lookahead",
];

/** True when the page is no taller than the window. */
function fitsTheWindow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight);
}

/** The whole solution but one line, with every cross: one move from solved. */
function oneLineShort(): { edges: Uint8Array; missing: number } {
  const edges = solution.slice();
  const missing = edges.indexOf(EdgeState.Line);
  edges[missing] = EdgeState.Unknown;
  return { edges, missing };
}

/** Opens small-7 with `edges` saved as the guest's progress. */
async function openWith(page: Page, edges: Uint8Array) {
  await page.goto("/");
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [
      "loophole:progress:small-7",
      JSON.stringify({ v: 1, edges: encodeEdges(edges), elapsedMs: 0, solved: false }),
    ],
  );
  await page.goto("/play/small-7");
  await expect(board(page)).toBeVisible();
}

const ghosts = (page: Page) =>
  page.locator("[role=application] .ghost, [role=application] .ghost-cross");

// The smallest phone (Small artboard), where the card has to fit under a 7×7, and the Play size.
for (const [width, height] of [
  [360, 560],
  [390, 664],
] as const) {
  test.describe(`phone ${width}×${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: true });

    test("a hint names the next rule, ghosts its move and applies it (FR-12)", async ({ page }) => {
      await openWith(page, empty);
      const before = await board(page).boundingBox();
      await page.getByRole("button", { name: "Hint" }).click();
      const step = expectedStep(empty);
      await expect(page.getByRole("heading", { name: RULE_TITLE[step.rule] })).toBeVisible();
      await expect(ghosts(page)).toHaveCount(step.changes.length);
      // The card takes the tray's place without moving the board.
      await expect(page.getByRole("navigation", { name: "Puzzle tools" })).toHaveCount(0);
      expect(await board(page).boundingBox()).toEqual(before);
      await page.getByRole("button", { name: "Apply move" }).click();
      const crossed = step.changes.filter((c) => c.state === EdgeState.Cross).length;
      await expect(crosses(page)).toHaveCount(crossed);
      await expect(ghosts(page)).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Puzzle tools" })).toBeVisible();
    });

    test("finishing with a hint marks the solve as assisted (FR-12)", async ({ page }) => {
      await openWith(page, oneLineShort().edges);
      await page.getByRole("button", { name: "Hint" }).click();
      await page.getByRole("button", { name: "Apply move" }).click();
      await expect(page.getByRole("img", { name: "Solved" })).toBeVisible();
      await expect(page.locator(".solved-card")).toContainText("Hint used");
      await page.reload();
      await expect(page.locator(".solved-card")).toContainText("Hint used");
    });

    test("every hint card fits under the board without moving it (NFR-2)", async ({ page }) => {
      const cases: [string, Uint8Array][] = [
        ...RULES.map((rule): [string, Uint8Array] => [RULE_TITLE[rule], boardBefore(rule)]),
        ["This × doesn't fit", threeWrongCrosses()],
      ];
      for (const [title, edges] of cases) {
        await openWith(page, edges);
        const before = await board(page).boundingBox();
        await page.getByRole("button", { name: "Hint" }).click();
        await expect(page.getByRole("heading", { name: title })).toBeVisible();
        expect([title, await fitsTheWindow(page)]).toEqual([title, true]);
        expect([title, await board(page).boundingBox()]).toEqual([title, before]);
      }
    });

    test("a wrong mark is pointed out first and can be erased", async ({ page }) => {
      await openWith(page, empty);
      const wrong = solution.indexOf(EdgeState.Cross);
      const p = await edgePoint(page, grid, wrong);
      await page.touchscreen.tap(p.x, p.y);
      await expect(lines(page)).toHaveCount(1);
      await page.getByRole("button", { name: "Hint" }).click();
      await expect(page.getByRole("heading", { name: "This line doesn't fit" })).toBeVisible();
      await page.getByRole("button", { name: "Erase it" }).click();
      await expect(lines(page)).toHaveCount(0);
    });
  });
}

test.describe("phone 390×664, zoomed board", () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

  test("a hint pans a zoomed board to show its move", async ({ page }) => {
    await page.goto("/play/medium-10");
    await expect(board(page)).toBeVisible();
    // Two fingers up and to the left move the view to the board's bottom-right corner.
    const box = (await boardView(page)).box;
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await twoFingers(
      page,
      [
        { x: c.x + 60, y: c.y + 80 },
        { x: c.x + 120, y: c.y + 80 },
      ],
      [
        { x: c.x - 160, y: c.y - 140 },
        { x: c.x - 100, y: c.y - 140 },
      ],
    );
    await expect.poll(async () => (await boardView(page)).y).toBeGreaterThan(100);
    // medium-10's first hint is the 0 in the top row, out of view now.
    await page.getByRole("button", { name: "Hint" }).click();
    await expect(page.locator("[role=application] .ghost-cross")).toHaveCount(4);
    const frame = await board(page).boundingBox();
    if (frame === null) throw new Error("board not visible");
    for (const g of await page.locator("[role=application] .ghost-cross").all()) {
      const b = await g.boundingBox();
      if (b === null) throw new Error("ghost not drawn");
      expect(b.x).toBeGreaterThanOrEqual(frame.x);
      expect(b.y).toBeGreaterThanOrEqual(frame.y);
      expect(b.x + b.width).toBeLessThanOrEqual(frame.x + frame.width);
      expect(b.y + b.height).toBeLessThanOrEqual(frame.y + frame.height);
    }
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("H opens the hint, Escape leaves it on the board, Enter applies it (NFR-5)", async ({
    page,
  }) => {
    await openWith(page, empty);
    const step = expectedStep(empty);
    await board(page).focus();
    await page.keyboard.press("h");
    await expect(page.getByRole("button", { name: "Apply move" })).toBeFocused();
    await expect(page.getByText("the pattern")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Apply move" })).toHaveCount(0);
    await expect(board(page)).toBeFocused();
    // The move stays drawn as a ghost until it is made.
    await expect(ghosts(page)).toHaveCount(step.changes.length);
    await expect(page.locator(".timecard").getByText("Hint used")).toBeVisible();
    await page.keyboard.press("h");
    await page.keyboard.press("Enter");
    await expect(ghosts(page)).toHaveCount(0);
    await expect(board(page)).toBeFocused();
  });

  test("hints work on a canvas board", async ({ page }) => {
    await page.goto("/play/huge-40");
    await expect(board(page)).toBeVisible();
    await page.getByRole("button", { name: "Hint" }).click();
    await expect(page.getByText("ヒント · next forced move")).toBeVisible();
    await page.getByRole("button", { name: "Apply move" }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem("loophole:progress:huge-40");
          return raw === null ? 0 : (JSON.parse(raw).edges as string).replace(/0/g, "").length;
        }),
      )
      .toBeGreaterThan(0);
  });
});
