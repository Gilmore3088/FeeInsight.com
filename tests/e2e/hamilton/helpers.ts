/** Shared steps for the Hamilton browser journeys. */
import { expect, type Page } from "playwright/test";
import { FIXTURE_PASSWORD, connectFixtureDb } from "./fixtures";

/**
 * Signs in through the real login form, as a person would. The suite signs the same accounts in
 * more often than the login limit allows in its window (10 per account per 15 minutes), so the
 * local fixture database's earlier attempts are cleared first (#2170).
 */
export async function signIn(page: Page, email: string, next = "/pro/analyze"): Promise<void> {
  const db = connectFixtureDb();
  try {
    await db`DELETE FROM api_route_audit_events WHERE route_id = 'action.login'`;
  } finally {
    await db.end();
  }
  await page.goto(`/login?from=${encodeURIComponent(next)}`);
  // The form signs in from script; typing before it hydrates would submit a plain GET.
  await page.waitForLoadState("networkidle");
  await page.getByLabel(/email|username/i).first().fill(email);
  await page.getByLabel(/^password/i).first().fill(FIXTURE_PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
}

/** Types a question into the one Ask box and sends it. */
export async function ask(page: Page, question: string): Promise<void> {
  const box = page.getByRole("form", { name: "Ask Hamilton" }).getByRole("textbox");
  await expect(box).toBeVisible();
  await box.fill(question);
  await box.press("Enter");
}
