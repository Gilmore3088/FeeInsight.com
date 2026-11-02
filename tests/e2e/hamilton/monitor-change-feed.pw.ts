/**
 * Institution change feed (#1898): a Pro subscriber opens Monitor and sees a local competitor's
 * fee change measured against the price we had on file, with each price's schedule edition and
 * the day it reached our records. An alert withdrawn because its "new" price came from an older
 * schedule found late is not shown.
 *
 * Seeds two synthetic competitor change signals on the fixture home, in the shape the competitor
 * alert pass writes (src/lib/hamilton/competitor-alerts.ts), and removes them afterwards.
 *
 * Alerts and watches dashboard (Nov 2026): also seeds like-for-like fee changes at seven peers, each
 * a superseded old price on an older copy of the peer's schedule and its live new price on the
 * current copy, so the shared check (loadConfirmedFeeChanges) confirms them, and a watchlist with
 * one changed peer. The journey checks the summary, the watch list's on/off and delete, the New
 * watch builder and the feed's filters and weekly chart.
 * HAMILTON_SCREENS_DIR=<dir> also saves desktop and phone screenshots.
 */
import path from "node:path";
import { expect, test, type Page } from "playwright/test";
import { FIXTURE_ID_MIN, FIXTURE_USERS, HOME, connectFixtureDb, type FixtureDb } from "./fixtures";
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

/** Like-for-like changes at fixture peers: the live price is the new one; `delta` gives the old one. */
const CHANGES = [
  { institutionId: 9_701_002, key: "overdraft", delta: -3, daysAgo: 3 },
  { institutionId: 9_701_003, key: "stop_payment", delta: 4, daysAgo: 12 },
  { institutionId: 9_701_013, key: "stop_payment", delta: -3, daysAgo: 9 },
  { institutionId: 9_701_009, key: "monthly_maintenance", delta: -2, daysAgo: 20 },
  { institutionId: 9_701_010, key: "overdraft", delta: 3, daysAgo: 40 },
  { institutionId: 9_701_012, key: "nsf", delta: -5, daysAgo: 55 },
  { institutionId: 9_701_006, key: "monthly_maintenance", delta: 2, daysAgo: 75 },
];
const CHANGE_IDS = CHANGES.map((c) => c.institutionId);
const WATCHED_PEER = { id: 9_701_002, name: "Indian River Test CU" };
const CHANGE_RAW_BASE = FIXTURE_ID_MIN + 7000;
/** The fixtures' own agent event id (fixtures.ts EVENT). */
const FIXTURE_EVENT = "00000000-0000-4000-8000-000009701000";

async function removeChanges(db: FixtureDb): Promise<void> {
  await db`DELETE FROM fee_change_records WHERE institution_id = ANY(${CHANGE_IDS}::bigint[])`;
  await db`DELETE FROM published_fee_records WHERE institution_id = ANY(${CHANGE_IDS}::bigint[]) AND batch_id = 'hamilton-e2e-alerts'`;
  await db`DELETE FROM verified_fee_observations WHERE fee_raw_id BETWEEN ${CHANGE_RAW_BASE} AND ${CHANGE_RAW_BASE + 99}`;
  await db`DELETE FROM raw_fee_observations WHERE fee_raw_id BETWEEN ${CHANGE_RAW_BASE} AND ${CHANGE_RAW_BASE + 99}`;
  await db`DELETE FROM agent_source_texts WHERE institution_id = ANY(${CHANGE_IDS}::bigint[])`;
  await db`DELETE FROM source_documents WHERE id = ANY(${CHANGE_IDS.map((id) => id + 400)}::bigint[])`;
  await db`DELETE FROM hamilton_watchlists WHERE user_id = ${FIXTURE_USERS.pro.id}`;
}

function scheduleText(name: string, feeName: string, amount: number): string {
  return [`${name.toUpperCase()} FEE SCHEDULE (SYNTHETIC)`, "OTHER SERVICES", `${feeName} | $${amount.toFixed(2)} per item`].join("\n");
}

async function seedChanges(db: FixtureDb): Promise<void> {
  await removeChanges(db);
  for (const [i, change] of CHANGES.entries()) {
    const [inst] = await db`SELECT institution_name FROM institution_sources WHERE id = ${change.institutionId}`;
    const [live] = await db`
      SELECT fee_published_id, amount::float8 AS amount, fee_name, source_url
        FROM published_fee_records
       WHERE institution_id = ${change.institutionId} AND canonical_fee_key = ${change.key} AND rolled_back_at IS NULL
       LIMIT 1`;
    const newAmount = Number(live.amount);
    const oldAmount = newAmount + change.delta;
    const changedAt = new Date(Date.now() - change.daysAgo * 86_400_000).toISOString();
    const currentDoc = change.institutionId + 200;
    const olderDoc = change.institutionId + 400;
    await db`INSERT INTO agent_source_texts (source_document_id, institution_id, status, normalized_text)
             VALUES (${currentDoc}, ${change.institutionId}, 'completed', ${scheduleText(inst.institution_name, live.fee_name, newAmount)})`;
    await db`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
             VALUES (${olderDoc}, ${change.institutionId}, 'success', ${live.source_url}, ${`fixture-old-${change.institutionId}`}, '2026-06-01T00:00:00Z')`;
    await db`INSERT INTO agent_source_texts (source_document_id, institution_id, status, normalized_text)
             VALUES (${olderDoc}, ${change.institutionId}, 'completed', ${scheduleText(inst.institution_name, live.fee_name, oldAmount)})`;
    const rawId = CHANGE_RAW_BASE + i;
    await db`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source, source_url,
                     amount_kind, fee_audience, audience_evidence, fee_treatment)
             VALUES (${rawId}, ${change.institutionId}, ${olderDoc}, ${FIXTURE_EVENT}, ${live.fee_name}, ${oldAmount}, 'per_item', 'knox', ${live.source_url},
                     'flat', 'consumer', 'Synthetic consumer schedule', 'charged')`;
    const [verified] = await db`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount,
                     frequency, review_status, source_url, amount_kind)
             VALUES (${rawId}, ${change.institutionId}, ${change.key}, ${FIXTURE_EVENT}, ${live.fee_name}, ${oldAmount}, 'per_item', 'verified', ${live.source_url}, 'flat')
             RETURNING fee_verified_id`;
    const [old] = await db`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount,
                     frequency, batch_id, source_url, published_at, amount_kind, fee_audience, audience_evidence, fee_treatment, rolled_back_at, rolled_back_reason)
             VALUES (${verified.fee_verified_id}, ${change.institutionId}, ${change.key}, ${FIXTURE_EVENT}, ${live.fee_name}, ${oldAmount}, 'per_item',
                     'hamilton-e2e-alerts', ${live.source_url}, '2026-06-02T00:00:00Z', 'flat', 'consumer', 'Synthetic consumer schedule', 'charged',
                     ${changedAt}, 'superseded by a newer schedule')
             RETURNING fee_published_id`;
    await db`INSERT INTO fee_change_records (institution_id, fee_category, canonical_fee_key, previous_amount, old_amount, new_amount, change_type,
                     detected_at, changed_at, previous_fee_published_id, new_fee_published_id, like_for_like)
             VALUES (${change.institutionId}, ${change.key}, ${change.key}, ${oldAmount}, ${oldAmount}, ${newAmount},
                     ${newAmount > oldAmount ? "increase" : "decrease"}, ${changedAt}, ${changedAt}, ${old.fee_published_id}, ${live.fee_published_id}, true)`;
  }
  await db`INSERT INTO hamilton_watchlists (user_id, institution_ids, fee_categories, regions, peer_set_ids, selected_source, selected_source_label)
           VALUES (${FIXTURE_USERS.pro.id}, ${db.json([String(WATCHED_PEER.id)])}, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'watchlist', 'Watchlist')`;
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
      await seedChanges(db);
    } finally {
      await db.end();
    }
  });

  test.afterAll(async () => {
    const db = connectFixtureDb();
    try {
      await db`DELETE FROM hamilton_signals WHERE id = ANY(${SIGNAL_IDS}::uuid[])`;
      await removeChanges(db);
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
      // Not as a card, not in any other text on the page, and not by its schedule link.
      await expect(page.getByText("lowered its overdraft fee from $35.00 to $25.00")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(`${COMPETITOR.name} lowered its overdraft fee`);
      await expect(page.locator('a[href$="fee-schedule-2024.pdf"]')).toHaveCount(0);
      await expect(page.locator("section.rd-exhibit")).toHaveCount(1);
      await expect(page.locator("body")).not.toContainText("—");

      // The dashboard: summary counts, the watch list, the builder and the national feed.
      await expect(page.getByText("Watches active")).toBeVisible();
      await expect(page.getByText("Fees changed, US, 30 days")).toBeVisible();
      await expect(page.getByText("Florida changes, 180 days")).toBeVisible();
      const watches = page.getByRole("table", { name: "Institutions you watch" });
      await expect(watches).toContainText(WATCHED_PEER.name);
      await expect(page.getByRole("switch", { name: `Watch ${WATCHED_PEER.name}` })).toHaveAttribute("aria-checked", "true");
      const feed = page.getByRole("table", { name: "Like-for-like fee changes, newest first" });
      await expect(feed.locator("tbody tr")).toHaveCount(CHANGES.length);
      await expect(feed).toContainText("You watch");
      await page.getByRole("group", { name: "Show changes" }).getByRole("button", { name: "▲ Increases" }).click();
      await expect(feed.locator("tbody tr")).toHaveCount(CHANGES.filter((c) => c.delta < 0).length);
      await page.getByRole("group", { name: "Show changes" }).getByRole("button", { name: "All" }).click();
      await page.getByLabel("State").selectOption("GA");
      await expect(feed.locator("tbody tr")).toHaveCount(2);
      await page.getByLabel("State").selectOption("all");
      await expect(page.getByRole("img", { name: /Like-for-like fee changes per week, nationwide/ })).toHaveCount(1);
      // No horizontal page scroll at phone width: tables scroll inside their own box.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shoot(page, `monitor-${width}`);
      if (width === 1440) {
        // A week's bar lists only that week; choosing it again shows every week.
        const lastWeek = page.getByRole("button", { name: /^Week of .*: \d+ change/ }).last();
        await lastWeek.click();
        await expect(lastWeek).toHaveAttribute("aria-pressed", "true");
        await page.getByRole("button", { name: "Show all weeks" }).click();
        await expect(feed.locator("tbody tr")).toHaveCount(CHANGES.length);

        // New watch: the institution in context is offered; add it, turn it off and on, delete it.
        const homeName = process.env.HAMILTON_SCREENS_DIR ? BANK_NAME : HOME.name;
        await page.getByRole("group", { name: "2. Pick one" }).getByRole("button", { name: homeName }).click();
        await page.getByRole("button", { name: "Add watch" }).click();
        await expect(page.getByText(`Added: ${homeName}.`)).toBeVisible();
        const homeSwitch = page.getByRole("switch", { name: `Watch ${homeName}` });
        await expect(homeSwitch).toHaveAttribute("aria-checked", "true");
        await homeSwitch.click();
        await expect(homeSwitch).toHaveAttribute("aria-checked", "false");
        await expect(homeSwitch).toBeEnabled();
        await homeSwitch.click();
        await expect(homeSwitch).toHaveAttribute("aria-checked", "true");
        await expect(homeSwitch).toBeEnabled();
        await page.getByRole("button", { name: `Delete watch: ${homeName}` }).click();
        await expect(page.getByRole("switch", { name: `Watch ${homeName}` })).toHaveCount(0);
        await page.reload();
        await expect(page.getByRole("switch", { name: `Watch ${homeName}` })).toHaveCount(0);
        await expect(page.getByRole("switch", { name: `Watch ${WATCHED_PEER.name}` })).toHaveAttribute("aria-checked", "true");
      }
      const dir = process.env.HAMILTON_SCREENS_DIR;
      if (dir) {
        const exhibit = page.locator("section.rd-exhibit").first();
        await exhibit.scrollIntoViewIfNeeded();
        await exhibit.screenshot({ path: path.join(dir, `monitor-exhibit-${width}.png`) });
      }
    });
  }
});
