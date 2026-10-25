import { createGrid, hEdgeIndex } from "@loophole/core";
import { expect, test } from "@playwright/test";
import { FIXTURE_SOLUTIONS } from "../src/lib/test-support/solutions.ts";
import { board, edgePoint, lines } from "./board.ts";

// The play clock (PRD FR-14, FR-17) under Playwright's fake clock, so seconds pass on demand: it
// runs while playing, stops on pause and on solve, and a solved board takes no more input.

const grid7 = createGrid(7, 7);

test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

test("the clock stops on pause and on solve, and a solved board takes no input", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/play/small-7");
  await expect(board(page)).toHaveAttribute("tabindex", "0");
  const clock = page.getByRole("timer").first();
  await expect(clock).toHaveText("00:00");

  await page.clock.runFor(5_000);
  await expect(clock).toHaveText("00:05");

  // Paused: a minute passes, the clock doesn't move.
  await page.getByRole("button", { name: "Pause" }).first().click();
  await expect(board(page)).toHaveCount(0);
  await page.clock.runFor(60_000);
  await expect(clock).toHaveText("00:05");
  await page.getByRole("button", { name: "Resume" }).first().click();
  await expect(board(page)).toBeVisible();
  await page.clock.runFor(2_000);
  await expect(clock).toHaveText("00:07");

  // Solved: the clock stops at the solve.
  const solution = FIXTURE_SOLUTIONS["small-7"];
  for (let e = 0; e < solution.length; e++) {
    if (solution[e] !== "1") continue;
    const p = await edgePoint(page, grid7, e);
    await page.touchscreen.tap(p.x, p.y);
  }
  await expect(page.getByRole("img", { name: "Solved" })).toBeVisible();
  const solvedText = await clock.textContent();
  await page.clock.runFor(120_000);
  await expect(clock).toHaveText(solvedText ?? "");
  await expect(page.getByText(`Solved in ${solvedText}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause" }).first()).toBeDisabled();

  // Locked: taps and keys change nothing, and the board leaves the Tab order.
  const lineCount = await lines(page).count();
  await expect(board(page)).toHaveAttribute("tabindex", "-1");
  const p = await edgePoint(page, grid7, hEdgeIndex(grid7, 0, 0));
  await page.touchscreen.tap(p.x, p.y);
  await board(page).dispatchEvent("keydown", { key: " " });
  await page.keyboard.press("x");
  await page.keyboard.press("z");
  await expect(lines(page)).toHaveCount(lineCount);
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
});
