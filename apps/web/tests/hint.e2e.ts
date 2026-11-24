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
import { board, boardView, crosses, edgePoint, lines, savedLines, twoFingers } from "./board.ts";

const wire = FIXTURES.find((f) => f.id === "small-7")?.wire;
if (wire === undefined) throw new Error("small-7 fixture missing");
const puzzle = parsePuzzle(wire);
const grid = puzzle.grid;
const solution = decodeEdges(grid, FIXTURE_SOLUTIONS["small-7"]);
const empty = new Uint8Array(grid.edgeCount);

/** The hint on `edges`, worked out here the same way the app does: a line and the steps before it. */
function expectedHint(edges: Uint8Array): { step: Step; before: readonly Step[] } {
  const hint = findHint(puzzle, solution, edges);
  if (hint.kind !== "step") throw new Error(`expected a step, got ${hint.kind}`);
  return hint;
}

/** Every edge a hint's move sets: the crosses before its line, then the line's step. */
function hintChanges(edges: Uint8Array) {
  const { step, before } = expectedHint(edges);
  return [...before, step].flatMap((s) => s.changes);
}

/**
 * A board on which the next hint uses `rule`, for its line or a step before it: small-7's solver
 * steps replayed from an empty board up to the first point where that happens.
 */
function boardBefore(rule: RuleId): Uint8Array {
  const edges = new Uint8Array(grid.edgeCount);
  for (const step of solve(puzzle).steps) {
    const hint = findHint(puzzle, solution, edges);
    if (hint.kind === "step" && [...hint.before, hint.step].some((s) => s.rule === rule)) {
      return edges;
    }
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

// Every rule small-7's hints use, so the long texts (corners, colouring, connectivity) are among
// them. The first ones draw a hint's line and title its card; the rest only cross edges, so they
// show in the card's "First:" list.
const LINE_RULES: RuleId[] = [
  "clue-needs-all",
  "dot-continue",
  "corner-3",
  "line-into-1",
  "line-into-3",
  "two-passes-on",
  "colour-2",
  "colour-chain",
  "two-exits",
];
const CROSS_RULES: RuleId[] = [
  "clue-zero",
  "clue-satisfied",
  "dot-full",
  "dot-dead-end",
  "corner-1",
  "premature-loop",
  "cut-off",
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
      const { step, before: first } = expectedHint(empty);
      const changes = hintChanges(empty);
      await expect(page.getByRole("heading", { name: RULE_TITLE[step.rule] })).toBeVisible();
      await expect(page.getByText(`First: ${RULE_TITLE[first[0].rule]}`)).toBeVisible();
      await expect(ghosts(page)).toHaveCount(changes.length);
      // The card takes the tray's place without moving the board.
      await expect(page.getByRole("navigation", { name: "Puzzle tools" })).toHaveCount(0);
      expect(await board(page).boundingBox()).toEqual(before);
      await page.getByRole("button", { name: "Apply move" }).click();
      const crossed = changes.filter((c) => c.state === EdgeState.Cross).length;
      await expect(crosses(page)).toHaveCount(crossed);
      await expect(lines(page)).toHaveCount(changes.length - crossed);
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
      // [title, a rule the "First:" list names or null, board]
      const ruleCase = (rule: RuleId, listed: boolean): [string, string | null, Uint8Array] => {
        const edges = boardBefore(rule);
        return [RULE_TITLE[expectedHint(edges).step.rule], listed ? RULE_TITLE[rule] : null, edges];
      };
      const cases: [string, string | null, Uint8Array][] = [
        ...LINE_RULES.map((rule) => ruleCase(rule, false)),
        ...CROSS_RULES.map((rule) => ruleCase(rule, true)),
        ["This × doesn't fit", null, threeWrongCrosses()],
      ];
      for (const [title, listed, edges] of cases) {
        await openWith(page, edges);
        const before = await board(page).boundingBox();
        await page.getByRole("button", { name: "Hint" }).click();
        await expect(page.getByRole("heading", { name: title })).toBeVisible();
        if (listed !== null) await expect(page.locator(".hint .first")).toContainText(listed);
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
    // medium-10's first hint is the 3 at the 0 in the top row (four crosses, two lines), out of view now.
    await page.getByRole("button", { name: "Hint" }).click();
    await expect(ghosts(page)).toHaveCount(6);
    const frame = await board(page).boundingBox();
    if (frame === null) throw new Error("board not visible");
    for (const g of await ghosts(page).all()) {
      const b = await g.boundingBox();
      if (b === null) throw new Error("ghost not drawn");
      expect(b.x).toBeGreaterThanOrEqual(frame.x);
      expect(b.y).toBeGreaterThanOrEqual(frame.y);
      expect(b.x + b.width).toBeLessThanOrEqual(frame.x + frame.width);
      expect(b.y + b.height).toBeLessThanOrEqual(frame.y + frame.height);
    }
  });

  test("resuming after a pause does not pan a zoomed board back to the hint", async ({ page }) => {
    await page.goto("/play/medium-10");
    await expect(board(page)).toBeVisible();
    const box = (await boardView(page)).box;
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // Two fingers up and to the left move the view to the board's bottom-right corner.
    const panToCorner = () =>
      twoFingers(
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
    await panToCorner();
    await expect.poll(async () => (await boardView(page)).y).toBeGreaterThan(100);
    await page.getByRole("button", { name: "Hint" }).click();
    await expect(ghosts(page)).toHaveCount(6);
    // Pan away from the hint, then pause and resume: the board remounts and must stay where it is.
    await panToCorner();
    await expect.poll(async () => (await boardView(page)).y).toBeGreaterThan(100);
    const before = await boardView(page);
    // Pointer pause and resume: a keyboard resume would bring the cursor into view, which is a different pan.
    await page.getByRole("button", { name: "Pause" }).click();
    await page.locator(".paused").getByRole("button", { name: "Resume" }).click();
    await expect(board(page)).toBeVisible();
    const after = await boardView(page);
    expect([after.x, after.y]).toEqual([before.x, before.y]);
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("H opens the hint, Escape leaves it on the board, Enter applies it (NFR-5)", async ({
    page,
  }) => {
    await openWith(page, empty);
    const changes = hintChanges(empty);
    await board(page).focus();
    await page.keyboard.press("h");
    await expect(page.getByRole("button", { name: "Apply move" })).toBeFocused();
    await expect(page.getByText("the pattern")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Apply move" })).toHaveCount(0);
    await expect(board(page)).toBeFocused();
    // The move stays drawn as a ghost until it is made.
    await expect(ghosts(page)).toHaveCount(changes.length);
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

  test("Escape with no hint open is left for other UI", async ({ page }) => {
    await openWith(page, empty);
    await page.evaluate(() => {
      window.addEventListener("keydown", (e) => {
        (window as unknown as { escapePrevented: boolean }).escapePrevented = e.defaultPrevented;
      });
    });
    await page.keyboard.press("Escape");
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { escapePrevented?: boolean }).escapePrevented),
      )
      .toBe(false);
  });

  test("a hint that ends while its card has focus gives focus back to the board", async ({
    page,
  }) => {
    await openWith(page, empty);
    const wrong = solution.indexOf(EdgeState.Cross);
    const p = await edgePoint(page, grid, wrong);
    await page.mouse.click(p.x, p.y);
    await expect(lines(page)).toHaveCount(1);
    await board(page).focus();
    await page.keyboard.press("h");
    await expect(page.getByRole("heading", { name: "This line doesn't fit" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Erase it" })).toBeFocused();
    // Undoing the wrong line makes the hint's move, so the card goes and the board takes focus.
    await page.keyboard.press("z");
    await expect(page.getByRole("button", { name: "Erase it" })).toHaveCount(0);
    await expect(board(page)).toBeFocused();
  });

  test("Clear keeps the assisted flag, and a reload keeps it (FR-12)", async ({ page }) => {
    await openWith(page, empty);
    const right = solution.indexOf(EdgeState.Line);
    const p = await edgePoint(page, grid, right);
    await page.mouse.click(p.x, p.y);
    await page.getByRole("button", { name: "Hint" }).click();
    await page.getByRole("button", { name: "I'll draw it" }).click();
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(lines(page)).toHaveCount(0);
    await expect(page.locator(".timecard").getByText("Hint used")).toBeVisible();
    await page.reload();
    await expect(page.locator(".timecard").getByText("Hint used")).toBeVisible();
  });

  test("Start over clears the assisted flag (FR-12)", async ({ page }) => {
    await openWith(page, oneLineShort().edges);
    await page.getByRole("button", { name: "Hint" }).click();
    await page.getByRole("button", { name: "Apply move" }).click();
    await expect(page.getByRole("img", { name: "Solved" })).toBeVisible();
    await expect(page.locator(".solved-card")).toContainText("Hint used");
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.locator(".solved-card")).toHaveCount(0);
    await expect(page.getByText("Hint used")).toHaveCount(0);
    const raw = await page.evaluate(() => localStorage.getItem("loophole:progress:small-7"));
    expect(raw === null || JSON.parse(raw).assisted !== true).toBe(true);
  });

  test("a hint that comes back after the screen was left does not overwrite newer progress", async ({
    page,
  }) => {
    const id = "srv-1";
    const stamp = "2026-10-25T12:00:00.000Z";
    await page.route(/\/api\/puzzles\/srv-1$/, (route) =>
      route.fulfill({
        json: {
          id,
          puzzle: { ...wire, seed: "s", meta: { generator: "1" } },
          origin: "generated",
          createdAt: stamp,
        },
      }),
    );
    await page.route(/\/api\/puzzles(\?.*)?$/, (route) =>
      route.fulfill({
        json: { items: [{ id, width: 7, height: 7, origin: "generated", createdAt: stamp }] },
      }),
    );
    // Hold the hint answer until the screen has been left and the player has drawn a line.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let answered = false;
    await page.route(/\/api\/puzzles\/srv-1\/hint$/, async (route) => {
      await gate;
      await route.fulfill({ json: { kind: "reveal", edge: solution.indexOf(EdgeState.Line) } });
      answered = true;
    });
    await page.goto(`/play/${id}`);
    await expect(board(page)).toBeVisible();
    await page.getByRole("button", { name: "Hint" }).click();
    await page.getByRole("link", { name: "Back to puzzles" }).click();
    await page.locator(`a[href="/play/${id}"]`).click();
    await expect(board(page)).toBeVisible();
    const p = await edgePoint(page, grid, solution.indexOf(EdgeState.Line));
    await page.mouse.click(p.x, p.y);
    await expect(lines(page)).toHaveCount(1);
    release();
    await expect.poll(() => answered).toBe(true);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(await savedLines(page, id)).toBe(1);
    const raw = await page.evaluate((key) => localStorage.getItem(key), `loophole:progress:${id}`);
    expect(JSON.parse(raw ?? "{}").assisted).not.toBe(true);
  });
});
