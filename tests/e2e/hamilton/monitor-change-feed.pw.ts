/**
 * Institution change feed (#1898): a Pro subscriber opens Monitor and sees a local competitor's
 * fee change measured against the price we had on file, with each price's schedule edition and
 * the day it reached our records. An alert withdrawn because its "new" price came from an older
 * schedule found late is not shown.
 *
 * Seeds two synthetic competitor change signals on the fixture home, in the shape the competitor
 * alert pass writes (src/lib/hamilton/competitor-alerts.ts), and removes them afterwards.
 * HAMILTON_SCREENS_DIR=<dir> also saves desktop and phone screenshots.
 */
import path from "node:path";
import { expect, test, type Page } from "playwright/test";
import { FIXTURE_USERS, HOME, connectFixtureDb, type FixtureDb } from "./fixtures";
import { signIn } from "./helpers";

const COMPETITOR = { id: 9_701_002, name: "Indian River Test CU" };
const LIVE_SIGNAL = "00000000-0000-4000-8000-000000189801";
const WITHDRAWN_SIGNAL = "00000000-0000-4000-8000-000000189802";
const SIGNAL_IDS = [LIVE_SIGNAL, WITHDRAWN_SIGNAL];
const BANK_NAME = "Lakeshore Test Credit Union";

function sourceJson(input: {
  changeId: number;
  previous: number;
  next: number;
  before: { url: string; edition: string | null; readOn: string };
  after: { url: string; edition: string | null; readOn: string };
  withdrawn?: string;
}) {
  return {
    source: "competitor_change_alerts",
    dedupe_key: `competitor_change:${HOME.id}:${input.changeId}`,
    competitor_institution_id: COMPETITOR.id,
    competitor_name: COMPETITOR.name,
    bank_name: BANK_NAME,
    changed_at: input.after.readOn,
    fee_change_record_id: input.changeId,
    canonical_fee_key: "overdraft",
    previous_amount: input.previous,
    new_amount: input.next,
    own_amount: 27,
    schedule_url: input.after.url,
    baseline: {
      before: { amount: input.previous, schedule_url: input.before.url, edition: input.before.edition, read_on: input.before.readOn },
      after: { amount: input.next, schedule_url: input.after.url, edition: input.after.edition, read_on: input.after.readOn },
    },
    evidence_policy: "verified-only",
    provider_call_queued: false,
    ...(input.withdrawn ? { withdrawn_at: "2026-10-24T06:00:00Z", withdrawn_reason: input.withdrawn } : {}),
  };
}

async function seedSignals(db: FixtureDb): Promise<void> {
  await db`DELETE FROM hamilton_signals WHERE id = ANY(${SIGNAL_IDS}::uuid[])`;
  if (process.env.HAMILTON_SCREENS_DIR) {
    // Screenshots for review never show the shared fixture home's name; teardown restores it.
    await db`UPDATE institution_sources SET institution_name = ${BANK_NAME} WHERE id = ${HOME.id}`;
    await db`UPDATE users SET institution_name = ${BANK_NAME} WHERE id = ${FIXTURE_USERS.pro.id}`;
  }
  const live = sourceJson({
    changeId: 9_189_801,
    previous: 30,
    next: 35,
    before: { url: "https://indianriver-test.example/fee-schedule-2025.pdf", edition: "2025-01-01", readOn: "2026-10-02" },
    after: { url: "https://indianriver-test.example/fee-schedule-2026.pdf", edition: "2026-10-01", readOn: "2026-10-20" },
  });
  // The 2024 copy read after the 2026 one: once a "cut" to $25, now withdrawn by the rule.
  const late = sourceJson({
    changeId: 9_189_802,
    previous: 35,
    next: 25,
    before: { url: "https://indianriver-test.example/fee-schedule-2026.pdf", edition: "2026-10-01", readOn: "2026-10-20" },
    after: { url: "https://indianriver-test.example/fee-schedule-2024.pdf", edition: "2024-01-01", readOn: "2026-10-22" },
    withdrawn: "an older schedule found late",
  });
  await db`
    INSERT INTO hamilton_signals (id, institution_id, signal_type, severity, title, body, source_json, created_at)
    VALUES
      (${LIVE_SIGNAL}, ${String(HOME.id)}, 'hamilton_competitor_fee_change', 'medium',
       ${`${COMPETITOR.name} raised its overdraft fee from $30.00 to $35.00`},
       ${`${BANK_NAME} charges $27.00, $8.00 lower. The new price was on ${COMPETITOR.name}'s fee schedule on 2026-10-20, verified, and held for a 12-hour second look before this alert.`},
       ${db.json(live)}, NOW() - INTERVAL '2 hours'),
      (${WITHDRAWN_SIGNAL}, ${String(HOME.id)}, 'hamilton_competitor_fee_change', 'medium',
       ${`${COMPETITOR.name} lowered its overdraft fee from $35.00 to $25.00`},
       'Withdrawn.', ${db.json(late)}, NOW() - INTERVAL '1 hour')
  `;
}

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.HAMILTON_SCREENS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test.describe("institution change feed (#1898)", () => {
  test.beforeAll(async () => {
    const db = connectFixtureDb();
    try {
      await seedSignals(db);
    } finally {
      await db.end();
    }
  });

  test.afterAll(async () => {
    const db = connectFixtureDb();
    try {
      await db`DELETE FROM hamilton_signals WHERE id = ANY(${SIGNAL_IDS}::uuid[])`;
    } finally {
      await db.end();
    }
  });

  for (const width of [1440, 390]) {
    test(`monitor at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      await signIn(page, FIXTURE_USERS.pro.email, `/pro/monitor?instId=${HOME.id}`);
      await page.goto(`/pro/monitor?instId=${HOME.id}`);
      await expect(page.getByRole("heading", { name: "Alerts and watches", level: 1 })).toBeVisible();
      const baseline = page.getByRole("table", { name: `What we knew and when: ${COMPETITOR.name}` });
      await expect(baseline).toBeVisible();
      await expect(baseline).toContainText("Jan 1, 2025");
      await expect(baseline).toContainText("Oct 1, 2026");
      await expect(baseline).toContainText("Oct 2, 2026");
      await expect(baseline).toContainText("Oct 20, 2026");
      await expect(page.getByText(`${COMPETITOR.name} raised its overdraft fee from $30.00 to $35.00`)).toBeVisible();
      // The withdrawn "cut" from an older schedule found late never shows.
      await expect(page.getByText("lowered its overdraft fee from $35.00 to $25.00")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("—");
      // No horizontal page scroll at phone width: tables scroll inside their own box.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shoot(page, `monitor-${width}`);
      const dir = process.env.HAMILTON_SCREENS_DIR;
      if (dir) {
        const exhibit = page.locator("section.rd-exhibit").first();
        await exhibit.scrollIntoViewIfNeeded();
        await exhibit.screenshot({ path: path.join(dir, `monitor-exhibit-${width}.png`) });
      }
    });
  }
});
