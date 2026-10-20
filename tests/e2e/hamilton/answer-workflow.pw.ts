/**
 * #2045: after an answer, the reader carries it into ongoing work in a real browser, against the
 * local production build and fixture database (tests/e2e/hamilton/fixtures.ts). Five steps:
 * understand (ask), keep (saved), decide (filed in the decision on its fee), monitor (watch the
 * institution) and report (add to report, then build the board brief from the saved answer).
 * No provider is called: serve.mjs blanks every key and the fixtures switch the provider stop on.
 */
import { expect, test } from "playwright/test";
import { FIXTURE_USERS, HOME, connectFixtureDb, type FixtureDb } from "./fixtures";
import { ask, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

let db: FixtureDb;
test.beforeAll(() => { db = connectFixtureDb(); });
test.afterAll(async () => { await db?.end(); });

test("#2045: ask, keep, add to a decision, watch, and add to a report, each pointing at the saved answer", async ({ page }) => {
  await signIn(page, FIXTURE_USERS.pro.email, `/pro/analyze?instId=${HOME.id}`);
  await page.goto(`/pro/analyze?instId=${HOME.id}`);

  // 1. Understand: the answer.
  const question = `What is the NSF fee at ${HOME.name}?`;
  await ask(page, question);
  await expect(page.getByText(`${HOME.name}'s $27 NSF / returned item fee`).first()).toBeVisible();
  const row = page.getByRole("region", { name: "Use this answer" }).first();
  await expect(row).toBeVisible();

  // 2. Keep: answers save on their own; the row says so and opens the list.
  await expect(row.getByText("Saved", { exact: false }).first()).toBeVisible();
  await expect(row.getByRole("link", { name: "Open saved analyses" })).toHaveAttribute("href", new RegExp(`^/pro/saved\\?instId=${HOME.id}`));
  const brief = page.getByRole("link", { name: "Build board brief" }).first();
  const analysisId = new URL((await brief.getAttribute("href"))!, "http://x").searchParams.get("from_analysis");
  expect(analysisId).toMatch(/^[0-9a-f-]{36}$/);

  // 3. Decide: a question about one fee is filed in the decision on that fee, and the row says so.
  // When the engine has not filed it, the row offers "Add to a decision" (answer-actions.test.ts).
  await expect(row.getByText("In your decision on the NSF / returned item fee")).toBeVisible();
  const events = await db`
    SELECT e.id FROM hamilton_decision_events e
      JOIN hamilton_decisions d ON d.id = e.decision_id
      JOIN users u ON u.id = d.user_id
     WHERE u.email = ${FIXTURE_USERS.pro.email} AND d.institution_id = ${HOME.id}
       AND e.kind = 'question_asked' AND e.detail->>'question' = ${question}
  `;
  expect(events).toHaveLength(1);

  // 4. Monitor: the institution is watched, and its fee changes reach Alerts and watches.
  await row.getByRole("button", { name: `Watch ${HOME.name}` }).click();
  await expect(row.getByRole("status").filter({ hasText: "Watching" })).toContainText(`Watching ${HOME.name}`);
  const [watch] = await db<{ institution_ids: unknown }[]>`
    SELECT w.institution_ids FROM hamilton_watchlists w JOIN users u ON u.id::text = w.user_id WHERE u.email = ${FIXTURE_USERS.pro.email}
  `;
  expect(JSON.stringify(watch?.institution_ids ?? [])).toContain(String(HOME.id));

  // 5. Report: into the report basket, and the board brief opens from the saved answer.
  await row.getByRole("button", { name: "+ Add to report" }).click();
  await expect(row.getByText("In your report")).toBeVisible();
  await brief.click();
  await expect(page).toHaveURL(new RegExp(`from_analysis=${analysisId}`));
});
