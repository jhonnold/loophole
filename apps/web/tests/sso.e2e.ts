import { expect, test } from "@playwright/test";
import { mockSsoApi, SSO_USER } from "./sso-mocks.ts";

// Single sign-on in the web app (PRD FR-30): the button, the failure messages and deleting an
// account without a password. The API's side is covered by its route tests.

test("without single sign-on, the login page has no provider button", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("link", { name: /Continue with/ })).toHaveCount(0);
});

test("the login and sign-up pages link to the provider", async ({ page }) => {
  await mockSsoApi(page);
  for (const path of ["/login", "/signup"]) {
    await page.goto(path);
    const link = page.getByRole("link", { name: "Continue with Authelia" });
    await expect(link).toHaveAttribute("href", "/api/auth/oidc/start");
  }
});

test("the link is a full page load to the API, not an app route", async ({ page }) => {
  await mockSsoApi(page);
  let started = false;
  await page.route("**/api/auth/oidc/start", (route) => {
    started = true;
    return route.fulfill({ status: 302, headers: { Location: "/login#oidc_error=failed" } });
  });
  await page.goto("/login");
  await page.getByRole("link", { name: "Continue with Authelia" }).click();
  await expect(page.getByRole("alert")).toContainText("didn't work");
  expect(started).toBe(true);
});

test("a failed single sign-on explains why on the login page", async ({ page }) => {
  await mockSsoApi(page);
  await page.goto("/login#oidc_error=email-unverified");
  await expect(page.getByRole("alert")).toContainText("Log in with your password instead");
});

test("an account without a password is deleted by typing its email", async ({ page }) => {
  await mockSsoApi(page, SSO_USER);
  await page.route("**/api/users/u1/**", (route) => route.fulfill({ json: { name: null } }));
  await page.route("**/api/submissions*", (route) => route.fulfill({ json: { items: [] } }));
  let body: unknown = null;
  await page.route("**/api/account", (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({ status: 204 });
  });
  await page.goto("/account");
  await expect(page.getByLabel("Password")).toHaveCount(0);
  await page.getByLabel("Type your email to confirm").fill("ann@example.com");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page).toHaveURL("/");
  expect(body).toEqual({ email: "ann@example.com" });
});
