import { expect, type Route, test } from "@playwright/test";
import { FIXTURES } from "../src/lib/puzzles/fixtures.ts";
import { scrollsSideways } from "./board.ts";

// A new practice puzzle from Home's Practice section (PRD FR-7, FR-11), against a stand-in for the
// job and puzzle routes: `bun run test:e2e` runs with no server.

const medium10 = FIXTURES.find((f) => f.id === "medium-10");
if (medium10 === undefined) throw new Error("medium-10 fixture missing");

const JOB = {
  id: "j1",
  kind: "generate",
  status: "queued",
  progress: 0,
  result: null,
  error: null,
  createdAt: "2026-10-26T12:00:00.000Z",
  startedAt: null,
  finishedAt: null,
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: status < 400 ? "application/json" : "application/problem+json",
    body: JSON.stringify(body),
  });

test.describe("a new practice puzzle on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("pick a size and a level, wait for the worker, then play it with its level shown", async ({
    page,
  }) => {
    let polls = 0;
    await page.route("**/api/jobs/generate", (route) => json(route, JOB, 202));
    await page.route("**/api/jobs/j1", (route) =>
      json(
        route,
        ++polls < 2
          ? { ...JOB, status: "running", progress: 0.5 }
          : { ...JOB, status: "done", progress: 1, result: { puzzleId: "p-easy" } },
      ),
    );
    await page.route("**/api/puzzles/p-easy", (route) =>
      json(route, {
        id: "p-easy",
        puzzle: { ...medium10.wire, meta: { generator: "6", level: "easy" } },
        origin: "generated",
        level: "easy",
        createdAt: "2026-10-26T12:00:01.000Z",
      }),
    );
    await page.goto("/");
    const sizes = page.getByRole("group", { name: "Size" });
    const levels = page.getByRole("group", { name: "Level" });
    await expect(levels.getByRole("button", { name: "Hard" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await sizes.getByRole("button", { name: "10×10" }).click();
    await levels.getByRole("button", { name: "Easy" }).click();
    expect(await scrollsSideways(page)).toBe(false);
    const sent = page.waitForRequest("**/api/jobs/generate");
    await page.getByRole("button", { name: "New easy 10×10 puzzle" }).click();
    expect((await sent).postDataJSON()).toEqual({ width: 10, height: 10, level: "easy" });
    await page.waitForURL("**/play/p-easy");
    await expect(page.getByRole("heading", { name: "Generated · 10×10" })).toBeVisible();
    await expect(page.getByText("Practice · 練習 · Easy")).toBeVisible();
  });

  test("a refusal is shown in the server's words", async ({ page }) => {
    const detail =
      "You already have 3 puzzles being generated. Wait for one to finish, then try again.";
    await page.route("**/api/jobs/generate", (route) =>
      json(route, { title: "Too many generations in progress", status: 429, detail }, 429),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "New hard 7×7 puzzle" }).click();
    await expect(page.getByRole("alert")).toHaveText(detail);
    await expect(page.getByRole("button", { name: "New hard 7×7 puzzle" })).toBeEnabled();
  });
});
