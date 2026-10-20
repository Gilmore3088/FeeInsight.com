/**
 * H07-T04 (#982): the admin correction journey in a real browser on the local fixture database.
 *
 * Hold a wrong fee, release it, correct it from the stored schedule, see Hamilton use the new
 * value, reverse the correction, and check the audit rows each step leaves. A stale second editor
 * and a non-admin are refused. Unrelated fixture fees must not change. A pass here is synthetic
 * evidence for H03-AC1, AC2, AC4 and H07-AC3, never their live pass.
 */
import { expect, test, type Page } from "playwright/test";
import { FIXTURE_ID_MAX, FIXTURE_ID_MIN, FIXTURE_USERS, HOME, NAMED_FEES, connectFixtureDb, type FixtureDb } from "./fixtures";
import { signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

let db: FixtureDb;
test.beforeAll(() => { db = connectFixtureDb(); });
test.afterAll(async () => { await db?.end(); });

const adminPage = `/admin/institution/${HOME.id}`;
const fee = NAMED_FEES.homeStopPayment;

/** Live amount(s) of the home's stop payment fee in the catalog every customer read uses. */
async function liveStopPayment(): Promise<number[]> {
  const rows = await db`SELECT amount FROM published_fee_catalog WHERE institution_id = ${HOME.id} AND fee_category = ${fee.key} ORDER BY id`;
  return rows.map((r) => Number(r.amount));
}

/** Every other fixture fee, so a correction cannot touch a row it was not aimed at. */
async function unrelatedFees(): Promise<string> {
  const rows = await db`SELECT fee_published_id, amount, quarantined_at IS NULL AS live FROM published_fee_records
                         WHERE institution_id BETWEEN ${FIXTURE_ID_MIN} AND ${FIXTURE_ID_MAX}
                           AND NOT (institution_id = ${HOME.id} AND canonical_fee_key = ${fee.key}) ORDER BY 1`;
  return JSON.stringify(rows);
}

/** What a Pro user's Hamilton answer says the fee is (the deterministic Ask route). */
async function hamiltonAnswer(page: Page): Promise<string> {
  const response = await page.request.post("/api/hamilton/ask", { data: { question: `What is the stop payment fee at ${HOME.name}?`, institutionId: String(HOME.id) } });
  expect(response.ok()).toBe(true);
  return String((await response.json()).shortAnswer);
}

async function openCorrect(page: Page) {
  await page.getByRole("button", { name: `Correct ${fee.name}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount ($)").fill("30.00");
  await dialog.getByLabel("Excerpt from the document").fill("Stop Payment Fee | $30.00");
  await dialog.getByLabel("Where it sits").fill("Other Services table, row 3");
  await dialog.getByLabel("Reason").fill("The published amount was read from the wrong row; the schedule says $30.00");
  await dialog.getByRole("button", { name: "Review change" }).click();
  return dialog;
}

let before = "";

test("H03-AC4: a Pro subscriber cannot reach the correction screen", async ({ page }) => {
  await signIn(page, FIXTURE_USERS.pro.email, adminPage);
  await page.goto(adminPage);
  await expect(page.getByRole("button", { name: `Correct ${fee.name}` })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Hold ${fee.name}` })).toHaveCount(0);
  expect(new URL(page.url()).pathname).not.toBe(adminPage);
});

test("H03-AC1: hold a wrong fee, it leaves every customer read and is audited; release brings it back", async ({ page }) => {
  before = await unrelatedFees();
  expect(await liveStopPayment()).toEqual([fee.amount]);
  await signIn(page, FIXTURE_USERS.admin.email, adminPage);
  await page.goto(adminPage);
  await page.getByRole("button", { name: `Hold ${fee.name}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason").fill("Amount read from the wrong row of the schedule");
  await dialog.getByRole("button", { name: "Hold fee" }).click();
  await expect(dialog).toHaveCount(0);

  expect(await liveStopPayment()).toEqual([]);
  const holds = await db`SELECT kind FROM pipeline_feedback WHERE institution_id = ${HOME.id} AND kind IN ('admin_hold', 'admin_release') ORDER BY id`;
  expect(holds.map((r) => r.kind)).toEqual(["admin_hold"]);
  // Held, never shown as $0 or free.
  const pro = await page.context().browser()!.newPage();
  await signIn(pro, FIXTURE_USERS.pro.email, `/pro/analyze?instId=${HOME.id}`);
  const answer = await hamiltonAnswer(pro);
  expect(answer).not.toContain("$25");
  expect(answer).not.toMatch(/\$0\b|\bfree\b/i);
  await pro.close();

  await page.reload();
  await page.getByRole("button", { name: /^Release/ }).first().click();
  await expect.poll(liveStopPayment).toEqual([fee.amount]);
  const audit = await db`SELECT kind FROM pipeline_feedback WHERE institution_id = ${HOME.id} AND kind IN ('admin_hold', 'admin_release') ORDER BY id`;
  expect(audit.map((r) => r.kind)).toEqual(["admin_hold", "admin_release"]);
  await page.screenshot({ path: test.info().outputPath("01-hold-released.png"), fullPage: true });
});

test("H03-AC2 H07-AC3: correct from the stored schedule; Hamilton agrees; the audit row, run and events are written", async ({ page }) => {
  await signIn(page, FIXTURE_USERS.admin.email, adminPage);
  await page.goto(adminPage);
  const dialog = await openCorrect(page);
  await dialog.getByRole("button", { name: "Publish correction" }).click();
  await expect(dialog).toHaveCount(0);

  await expect.poll(liveStopPayment).toEqual([30]);
  const [version] = await db`SELECT id, version, action, status, actor_name, amount, before_amount, agent_run_id, source_document_id
                               FROM published_fee_corrections WHERE institution_id = ${HOME.id} ORDER BY id`;
  expect(version).toMatchObject({ version: 1, action: "correct", status: "current", actor_name: FIXTURE_USERS.admin.name });
  expect(Number(version.amount)).toBe(30);
  expect(Number(version.before_amount)).toBe(fee.amount);
  const events = await db`SELECT event_type, status FROM agent_run_events WHERE agent_run_id = ${version.agent_run_id} ORDER BY id`;
  expect(events.map((e) => e.event_type).slice(0, 2)).toEqual(["fee.correct", "index.refresh"]);
  expect(events.every((e) => e.status !== "failed")).toBe(true);
  const [run] = await db`SELECT run_kind, status, trigger_source FROM agent_runs WHERE id = ${version.agent_run_id}`;
  expect(run).toMatchObject({ run_kind: "manual_repair", status: "completed", trigger_source: "admin" });

  // The old value is kept as superseded, not deleted.
  const [old] = await db`SELECT amount, quarantine_reason FROM published_fee_records WHERE institution_id = ${HOME.id} AND canonical_fee_key = ${fee.key} AND amount = ${fee.amount}`;
  expect(String(old.quarantine_reason)).toMatch(/^admin_correction/);

  const pro = await page.context().browser()!.newPage();
  await signIn(pro, FIXTURE_USERS.pro.email, `/pro/analyze?instId=${HOME.id}`);
  expect(await hamiltonAnswer(pro)).toContain("$30");
  await pro.close();

  await page.reload();
  await expect(page.getByText("v1 · correction · current")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("02-corrected.png"), fullPage: true });
});

test("H03-AC4: reverse as a new version while a second editor's form goes stale; history keeps every row; unrelated fees unchanged", async ({ page }) => {
  await signIn(page, FIXTURE_USERS.admin.email, adminPage);
  await page.goto(adminPage);
  const versionsBefore = (await db`SELECT COUNT(*)::int AS n FROM published_fee_corrections WHERE institution_id = ${HOME.id}`)[0].n;
  // A second tab opens the correction form on the current version, then waits.
  const second = await page.context().newPage();
  await second.goto(adminPage);
  const stale = await openCorrect(second);

  await page.getByRole("button", { name: `Reverse correction of ${fee.name}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason").fill("Reversal rehearsal for the release runbook");
  await dialog.getByRole("button", { name: "Reverse correction" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(liveStopPayment).toEqual([fee.amount]);

  // The second tab's version is gone: its save is refused and writes nothing.
  await stale.getByRole("button", { name: "Publish correction" }).click();
  await expect(stale.getByRole("alert")).toBeVisible();
  await second.screenshot({ path: test.info().outputPath("03-stale-refused.png"), fullPage: true });
  await second.close();
  expect(await liveStopPayment()).toEqual([fee.amount]);

  const rows = await db`SELECT action, status FROM published_fee_corrections WHERE institution_id = ${HOME.id} ORDER BY id`;
  expect(rows).toHaveLength(versionsBefore + 1);
  expect(rows.at(-1)).toMatchObject({ action: "reverse", status: "current" });
  expect(rows.slice(0, -1).every((r) => r.status === "superseded")).toBe(true);
  expect(await unrelatedFees()).toBe(before);

  await page.reload();
  await expect(page.getByText(/reversal · current/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("04-reversed.png"), fullPage: true });
});
