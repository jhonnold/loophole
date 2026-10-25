import { expect, test } from "@playwright/test";
import { canSignUp, mailedLink } from "./mailpit.ts";

/** A stand-in for Cloudflare's widget script: passes at once with Turnstile's dummy test token. */
const TURNSTILE_STUB = `window.turnstile = {
  render(el, options) { setTimeout(() => options.callback("XXXX.DUMMY.TOKEN.XXXX"), 0); return "stub"; },
  reset() {},
  remove() {},
};`;

test.beforeAll(async () => {
  // The API mails through Mailpit and checks the CAPTCHA token with Cloudflare (test keys).
  test.skip(
    !(await canSignUp()),
    "needs Mailpit (docker compose up -d) and access to challenges.cloudflare.com",
  );
});

test("sign up, confirm the email, log in and log out", async ({ page }) => {
  await page.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: TURNSTILE_STUB }),
  );
  const email = `e2e-${crypto.randomUUID()}@loophole.test`;

  await page.goto("/");
  await page.getByRole("link", { name: "Log in" }).click();
  await page.getByRole("link", { name: "Sign up" }).click();
  // The login page has the same fields; wait for the sign-up page before typing.
  await expect(page.getByRole("heading", { name: "Sign up" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("hunter22-e2e");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText(`Check your inbox at ${email}`);

  await page.goto(await mailedLink(email));
  await expect(page.getByRole("button", { name: "Confirm my email" })).toBeVisible();
  expect(new URL(page.url()).hash).toBe(""); // the token is gone from the address bar
  await page.getByRole("button", { name: "Confirm my email" }).click();
  await expect(page.getByRole("status")).toHaveText("Your email is confirmed.");

  await page.getByRole("link", { name: "Log in" }).last().click();
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("hunter22-e2e");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
  await page.getByRole("link", { name: "Account" }).click();
  await expect(page.getByText(`Logged in as ${email}.`)).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
});
