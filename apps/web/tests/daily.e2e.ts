import { createGrid } from "@loophole/core";
import { expect, test } from "@playwright/test";
import { FIXTURE_SOLUTIONS } from "../src/lib/test-support/solutions.ts";
import { board, edgePoint, lines, scrollsSideways } from "./board.ts";
import { attempt, DAILY_ID, mockDailyApi, TODAY } from "./daily-mocks.ts";

// Daily puzzles, ranked play and leaderboards against a stand-in for the API (daily-mocks.ts):
// `bun run test:e2e` runs with no server. The real API is covered by daily.auth-e2e.ts.

const grid7 = createGrid(7, 7);
const SOLUTION = FIXTURE_SOLUTIONS["small-7"];

test.describe("home on a phone (Home artboard, FR-22, FR-24)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("today's puzzles as covers, the countdown and practice; a guest is offered a login", async ({
    page,
  }) => {
    await mockDailyApi(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Today's puzzles" })).toBeVisible();
    await expect(page.getByRole("timer")).toContainText("New puzzles in");
    const covers = page.getByRole("list", { name: "Today's daily puzzles" });
    const small = covers.getByRole("link", { name: /Small.*New · not started/ });
    await expect(small).toHaveAttribute("href", `/daily/${TODAY}/7`);
    await expect(small).toHaveCSS("background-color", "rgb(242, 196, 206)");
    await expect(covers.getByText("Not ready yet")).toHaveCount(3);
    await expect(page.getByText("With an account, your daily solves are ranked")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Practice 練習" })).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);
  });

  test("a logged-in player sees their streak and their solved daily", async ({ page }) => {
    await mockDailyApi(page, {
      user: true,
      attempt: attempt({ status: "finished", elapsedMs: 198_000, ranked: true, rank: 214 }),
    });
    await page.goto("/");
    await expect(page.getByLabel("Streak")).toContainText("12 day streak");
    const covers = page.getByRole("list", { name: "Today's daily puzzles" });
    await expect(covers.getByRole("link", { name: /Small.*Solved · 03:18/ })).toBeVisible();
  });

  test("without the server, practice still works", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Daily puzzles need the server")).toBeVisible();
    await expect(page.getByRole("link", { name: /Small/ }).first()).toHaveAttribute(
      "href",
      "/play/small-7",
    );
  });
});

test.describe("daily play", () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

  test("a guest plays today's daily unranked", async ({ page }) => {
    await mockDailyApi(page);
    await page.goto(`/daily/${TODAY}/7`);
    await expect(page.getByRole("heading", { name: "Small · 7×7" })).toBeVisible();
    await expect(page.getByText("Daily ·").first()).toBeVisible();
    await expect(board(page)).toBeVisible();
    await expect(page.getByText("Playing unranked.")).toBeVisible();
  });

  test("a ranked solve: start, solve, the server's rank on the Solved screen (FR-17, FR-25)", async ({
    page,
  }) => {
    await mockDailyApi(page, {
      user: true,
      // Solved earlier, unranked: a ranked attempt still starts from an empty board.
      progress: SOLUTION,
      finished: attempt({
        status: "finished",
        elapsedMs: 198_000,
        ranked: true,
        rank: 214,
        finishedAt: new Date().toISOString(),
      }),
    });
    await page.goto(`/daily/${TODAY}/7`);
    await expect(page.getByRole("heading", { name: "Ranked solve" })).toBeVisible();
    await expect(board(page)).toHaveCount(0);
    await expect(page.getByText("Starting clears any unranked progress")).toBeVisible();
    await page.getByRole("button", { name: "Start" }).click();
    await expect(board(page)).toBeVisible();
    await expect(lines(page)).toHaveCount(0);
    // A ranked clock never pauses.
    await expect(page.getByRole("button", { name: /Pause/ }).first()).toBeDisabled();
    const finish = page.waitForRequest((r) => r.url().endsWith(`/attempts/${DAILY_ID}/finish`));
    for (let e = 0; e < SOLUTION.length; e++) {
      if (SOLUTION[e] !== "1") continue;
      const p = await edgePoint(page, grid7, e);
      await page.touchscreen.tap(p.x, p.y);
    }
    const sent = (await finish).postDataJSON() as { edges: string; elapsedMs: number };
    expect(sent.edges.replaceAll("2", "0")).toBe(SOLUTION.replaceAll("2", "0"));
    await expect(page.getByRole("img", { name: "Solved", exact: true })).toBeVisible();
    await expect(page.getByText("Rank today")).toBeVisible();
    await expect(page.getByText("#214")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "You" })).toContainText("03:18");
  });
});

test.describe("Solved screen (Solved artboard, FR-23, FR-24)", () => {
  test.use({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true });

  test("stamp, time, rank, best and the leaderboard around the player", async ({ page }) => {
    await mockDailyApi(page, {
      user: true,
      attempt: attempt({ status: "finished", elapsedMs: 198_000, ranked: true, rank: 214 }),
      progress: SOLUTION,
    });
    await page.goto(`/daily/${TODAY}/7`);
    await expect(page.getByRole("img", { name: "Solved", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Your solved board" })).toBeVisible();
    await expect(page.getByText("03:18").first()).toBeVisible();
    await expect(page.getByText("#214")).toBeVisible();
    await expect(page.getByText("02:51")).toBeVisible();
    await expect(page.getByRole("heading", { name: "番付 Leaderboard" })).toBeVisible();
    await expect(page.getByText("49 cells · today")).toBeVisible();
    const rows = page.getByRole("listitem");
    await expect(rows.filter({ hasText: "kuroneko" })).toContainText("01:12");
    await expect(rows.filter({ hasText: "You" })).toContainText("214");
    await expect(rows.filter({ hasText: "Anonymous" })).toContainText("213");
    await expect(page.getByRole("link", { name: /Next: Medium 10×10/ })).toHaveAttribute(
      "href",
      `/daily/${TODAY}/10`,
    );
    expect(await scrollsSideways(page)).toBe(false);

    await page.getByRole("button", { name: "Play again, unranked" }).click();
    await expect(page.getByText("Playing again for practice")).toBeVisible();
  });
});

test.describe("leaderboard page (FR-23)", () => {
  test.use({ viewport: { width: 360, height: 560 }, hasTouch: true, isMobile: true });

  test("shows today's board and switches to all time", async ({ page }) => {
    await mockDailyApi(page);
    await page.goto("/leaderboard");
    await expect(page.getByRole("heading", { name: "Leaderboards" })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "tsuru" })).toBeVisible();
    await page.getByRole("button", { name: "All time" }).click();
    await expect(page).toHaveURL(/scope=all/);
    await expect(page.getByText("49 cells · all time")).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);
  });
});
