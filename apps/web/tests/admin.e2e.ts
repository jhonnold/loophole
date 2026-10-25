import { expect, test } from "@playwright/test";
import { mockAdminApi } from "./admin-mocks.ts";
import { scrollsSideways } from "./board.ts";

// The admin page's health view (PRD §5), against the stand-in in admin-mocks.ts.

test.use({ viewport: { width: 360, height: 560 }, hasTouch: true, isMobile: true });

test("shows system health in words: checks, queue, daily stock, failures, versions", async ({
  page,
}) => {
  await mockAdminApi(page);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "System health" })).toBeVisible();
  const health = page.locator("dl.health");
  await expect(health).toContainText("Database");
  await expect(health).toContainText("OK");
  await expect(health).toContainText("Down: No answer within 2000 ms");
  await expect(health).toContainText(/2 waiting \(oldest 2m \d\ds\), 1 running/);
  await expect(health).toContainText("Small 7×7: 3 days ahead");
  await expect(health).toContainText("Large 20×20: today only");
  await expect(health).toContainText("Giant 40×40: today's is missing");
  await expect(health).toContainText("app 4f8cb61, generator 1, bun 1.3.13");
  await expect(page.getByText(/generate · timeout · 10m \d\ds ago/)).toBeVisible();
  await expect(page.getByText("Stopped after the 60 s time limit.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reported puzzles" })).toBeVisible();
  await expect(page.getByText("No open reports.")).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
});

test("a player who isn't an admin sees nothing of it", async ({ page }) => {
  await page.route("**/api/session", (route) => route.fulfill({ json: { user: null } }));
  await page.goto("/admin");
  await expect(page.getByText("Admins only.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "System health" })).toHaveCount(0);
});
