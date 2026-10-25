import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { FIXTURE_SOLUTIONS } from "../src/lib/test-support/solutions.ts";
import { mockAdminApi } from "./admin-mocks.ts";
import { board } from "./board.ts";
import { attempt, mockDailyApi, TODAY } from "./daily-mocks.ts";

// Automated accessibility checks (PRD NFR-5): axe-core's WCAG 2.2 A and AA rules, contrast
// included, on the main screens in both themes, on a phone and a desktop. Screens that need the
// API get the daily and admin stand-ins.

interface Screen {
  readonly name: string;
  readonly path: string;
  /** Before the page loads: API stand-ins. */
  readonly mock?: (page: Page) => Promise<void>;
  /** After it loads: get the screen into the state to check. */
  readonly act?: (page: Page) => Promise<void>;
}

const FINISHED = attempt({ status: "finished", elapsedMs: 198_000, ranked: true, rank: 214 });

const SCREENS: Screen[] = [
  { name: "home, guest", path: "/", mock: (p) => mockDailyApi(p) },
  { name: "home, player", path: "/", mock: (p) => mockDailyApi(p, { user: true }) },
  { name: "play", path: "/play/small-7" },
  {
    name: "play, hint card",
    path: "/play/small-7",
    act: async (p) => {
      await board(p).focus();
      await p.keyboard.press("h");
      await expect(p.getByRole("button", { name: "Apply" })).toBeVisible();
    },
  },
  {
    name: "play, paused",
    path: "/play/small-7",
    act: async (p) => {
      await p.getByRole("button", { name: "Pause" }).first().click();
      await expect(p.getByText("一時停止")).toBeVisible();
    },
  },
  { name: "create", path: "/create" },
  { name: "log in", path: "/login" },
  { name: "sign up", path: "/signup" },
  { name: "forgot password", path: "/forgot-password" },
  {
    name: "daily, ranked start",
    path: `/daily/${TODAY}/7`,
    mock: (p) => mockDailyApi(p, { user: true }),
  },
  {
    name: "daily, solved",
    path: `/daily/${TODAY}/7`,
    mock: (p) =>
      mockDailyApi(p, { user: true, attempt: FINISHED, progress: FIXTURE_SOLUTIONS["small-7"] }),
  },
  { name: "leaderboard", path: "/leaderboard", mock: (p) => mockDailyApi(p, { user: true }) },
  { name: "account", path: "/account", mock: (p) => mockDailyApi(p, { user: true }) },
  { name: "admin", path: "/admin", mock: mockAdminApi },
];

for (const theme of ["light", "dark"] as const) {
  for (const viewport of [
    { width: 390, height: 664 },
    { width: 1280, height: 800 },
  ]) {
    test.describe(`${theme} theme, ${viewport.width}×${viewport.height}`, () => {
      test.use({ viewport });

      for (const screen of SCREENS) {
        test(`${screen.name} has no WCAG A or AA violations (NFR-5)`, async ({ page }) => {
          await page.addInitScript((t) => localStorage.setItem("loophole:theme", t), theme);
          await screen.mock?.(page);
          await page.goto(screen.path);
          await page.waitForLoadState("networkidle");
          await screen.act?.(page);
          const { violations } = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze();
          const found = violations.flatMap((v) =>
            v.nodes.map((n) => `${v.id}: ${n.target.join(" ")} — ${n.failureSummary ?? ""}`),
          );
          expect(found).toEqual([]);
        });
      }
    });
  }
}
