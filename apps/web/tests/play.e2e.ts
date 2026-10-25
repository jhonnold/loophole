import { createGrid, dotIndex, hEdgeIndex, vEdgeIndex } from "@loophole/core";
import { expect, type Page, test } from "@playwright/test";
import { FIXTURE_SOLUTIONS } from "../src/lib/test-support/solutions.ts";
import {
  board,
  crosses,
  dotPoints,
  edgePoint,
  lines,
  scrollsSideways,
  touchDrag,
} from "./board.ts";

const grid7 = createGrid(7, 7);

/** Taps every edge of the 7×7 solution, which solves the puzzle on a phone. */
async function solveSmall7(page: Page) {
  const solution = FIXTURE_SOLUTIONS["small-7"];
  for (let e = 0; e < solution.length; e++) {
    if (solution[e] !== "1") continue;
    const p = await edgePoint(page, grid7, e);
    await page.touchscreen.tap(p.x, p.y);
  }
  await expect(page.getByRole("img", { name: "Solved" })).toBeVisible();
}

// The two phone sizes from the design kit: Small (360×560) and Play (390×664).
for (const [width, height] of [
  [360, 560],
  [390, 664],
] as const) {
  test.describe(`phone ${width}×${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: true });

    test.beforeEach(async ({ page }) => {
      await page.goto("/play/small-7");
      await expect(board(page)).toBeVisible();
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
      await expect(lines(page)).toHaveCount(1);
      await page.touchscreen.tap(p.x, p.y);
      await expect(lines(page)).toHaveCount(0);
      await expect(crosses(page)).toHaveCount(1);
      await page.touchscreen.tap(p.x, p.y);
      await expect(lines(page)).toHaveCount(0);
      await expect(crosses(page)).toHaveCount(0);
    });

    test("drag draws a run of lines; one undo removes it (FR-13, FR-14)", async ({ page }) => {
      const dots = await dotPoints(page);
      const row = [0, 1, 2, 3].map((c) => dots[3 * 8 + c]);
      await touchDrag(page, [row[0], row[1], row[2], row[3]]);
      await expect(lines(page)).toHaveCount(3);
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(lines(page)).toHaveCount(0);
      await page.getByRole("button", { name: "Redo" }).click();
      await expect(lines(page)).toHaveCount(3);
      await page.getByRole("button", { name: "Clear" }).click();
      await expect(lines(page)).toHaveCount(0);
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
      await expect(board(page)).toHaveCount(0);
      await page.getByRole("button", { name: "Resume" }).first().click();
      await expect(board(page)).toBeVisible();
    });

    test("detects the solve and keeps it after a reload (FR-17, FR-21)", async ({ page }) => {
      await solveSmall7(page);
      await expect(page.getByText(/Solved in \d\d:\d\d/)).toBeVisible();
      expect(await scrollsSideways(page)).toBe(false);
      await page.reload();
      await expect(page.getByRole("img", { name: "Solved" })).toBeVisible();
    });

    test("start over returns focus to the board (NFR-5)", async ({ page }) => {
      await solveSmall7(page);
      await page.getByRole("button", { name: "Start over" }).click();
      await expect(board(page)).toBeFocused();
    });
  });
}

test.describe("progress", () => {
  test("survives a reload (FR-21, guest)", async ({ page }) => {
    await page.goto("/play/tiny-5");
    const grid5 = createGrid(5, 5);
    const p = await edgePoint(page, grid5, vEdgeIndex(grid5, 2, 2));
    await page.mouse.click(p.x, p.y);
    await page.reload();
    await expect(lines(page)).toHaveCount(1);
  });
});

test.describe("blocked browser storage (FR-21)", () => {
  test("plays and browses with site data blocked", async ({ page }) => {
    // Chromium throws when script reads localStorage while site data is blocked.
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    });
    const errors: Error[] = [];
    page.on("pageerror", (e) => errors.push(e));
    await page.goto("/play/small-7");
    await expect(board(page)).toHaveAttribute("tabindex", "0");
    await page.goto("/");
    await expect(page.getByRole("button", { name: "夜 Night" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("desktop keyboard (NFR-5)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("arrows move the cursor; Space, X and Backspace mark; Z and Y undo and redo", async ({
    page,
  }) => {
    await page.goto("/play/small-7");
    const surface = board(page);
    await surface.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText("Row 1 · between columns 2 and 3 · empty").first()).toBeVisible();
    await page.keyboard.press("Space");
    await expect(lines(page)).toHaveCount(1);
    await page.keyboard.press("x");
    await expect(lines(page)).toHaveCount(0);
    await expect(crosses(page)).toHaveCount(1);
    await page.keyboard.press("Backspace");
    await expect(crosses(page)).toHaveCount(0);
    await page.keyboard.press("z");
    await expect(crosses(page)).toHaveCount(1);
    await page.keyboard.press("y");
    await expect(crosses(page)).toHaveCount(0);
    await page.keyboard.press("p");
    await expect(page.getByText("一時停止")).toBeVisible();
  });

  test("undo in the middle of a drag keeps the stroke apart from earlier moves (FR-13, FR-14)", async ({
    page,
  }) => {
    await page.goto("/play/small-7");
    const dots = await dotPoints(page);
    const dot = (row: number, col: number) => dots[dotIndex(grid7, row, col)];
    const tap = await edgePoint(page, grid7, hEdgeIndex(grid7, 6, 0));
    await page.mouse.click(tap.x, tap.y);
    await expect(lines(page)).toHaveCount(1);
    await page.mouse.move(dot(0, 0).x, dot(0, 0).y);
    await page.mouse.down();
    await page.mouse.move(dot(0, 1).x, dot(0, 1).y);
    await page.mouse.move(dot(0, 2).x, dot(0, 2).y);
    await expect(lines(page)).toHaveCount(3);
    // Undo while the button is still held: removes the stroke so far.
    await page.keyboard.press("z");
    await expect(lines(page)).toHaveCount(1);
    await page.mouse.move(dot(0, 3).x, dot(0, 3).y);
    await page.mouse.up();
    await expect(lines(page)).toHaveCount(2);
    // The last step of the stroke is its own undo step, so one undo leaves the tapped line.
    await page.keyboard.press("z");
    await expect(lines(page)).toHaveCount(1);
  });

  test("resuming with P returns focus to the board (NFR-5)", async ({ page }) => {
    await page.goto("/play/small-7");
    const surface = board(page);
    await surface.focus();
    await page.keyboard.press("p");
    await expect(page.getByText("一時停止")).toBeVisible();
    await page.keyboard.press("p");
    await expect(surface).toBeFocused();
  });

  test("tabbing to the board shows the edge cursor (NFR-5)", async ({ page }) => {
    await page.goto("/play/small-7");
    const surface = board(page);
    // The header's back link and pause button come before the board in Tab order.
    for (
      let i = 0;
      i < 6 && !(await surface.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(surface).toBeFocused();
    await expect(page.locator("rect.cursor")).toBeVisible();
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
