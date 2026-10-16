import { describe, expect, it, vi } from "vitest";

import { hourlyFromLine, hourlyWording, settledFrequency } from "@/lib/fee-frequency";

import {
  HOURLY_CHECK_BATCH,
  HOURLY_FREQUENCY_LIVE,
  findHourlyFees,
  hourlyCountSql,
  hourlyDetail,
  hourlySamplesSql,
  hourlyVerdict,
  recheckHourlyFrequencies,
} from "./hourly-frequency-check";

describe("hourlyWording (#1456)", () => {
  it.each([
    "Research Fee $25/hour",
    "Account reconciliation per hour",
    "Research: Labor Per Hour",
    "Subpoena Fee - Per Hour (Minimum One Hour Charge)",
    "Safe Deposit Box Inventory (per hour)",
    "Coin Counting (per hour)",
    "Account Research (hour)",
    "Research $20/hr",
    "Account Balancing - per hr.",
    "Hourly research fee",
    "Research $30 an hour, one hour minimum",
    "Legal Process / Hr",
    "Research (per hour, 1/2 hour minimum)",
    "Statement reconcilement, each hour",
  ])("reads %j as hourly", (name) => {
    expect(hourlyWording(name)).toBe(true);
  });

  it.each([
    "24 Hour Banking",
    "24-hour ATM access",
    "Rush request (within 48 hours)",
    "After Hours Deposit Bag",
    "Hours of operation",
    "1 Hour Photo",
    "Research per 15 minutes",
    "Research $10 per half hour",
    "Research per 1/2 hour",
    "Telephone transfer per minute",
    "Wire Transfer - Outgoing Domestic",
    "Shredding service per bag",
    "Overnight delivery",
    "HRA account fee",
    "",
  ])("does not read %j as hourly", (name) => {
    expect(hourlyWording(name)).toBe(false);
  });
});

describe("hourly frequency on a schedule line", () => {
  it("reads the fee's own name or the words after its price", () => {
    expect(hourlyFromLine("Research (per hour) | $25.00 Each", 25)).toBe(true);
    expect(hourlyFromLine("Account Research | $25.00/hr", 25)).toBe(true);
    expect(hourlyFromLine("Research | $40.00 | per hour", 40)).toBe(true);
    expect(hourlyFromLine("Account Research $20.00 per 15 minutes", 20)).toBe(false);
    // Another fee's per-hour price on the same line is not this fee's.
    expect(hourlyFromLine("Stop Payment | $30.00 | Research (per hour) | $25.00", 30)).toBe(false);
    // The line must print the fee's price.
    expect(hourlyFromLine("Research (per hour) | $25.00", 40)).toBe(false);
  });

  it("settles a per-hour fee as hourly only when asked, and never on a category never charged by the hour", () => {
    expect(settledFrequency("Research (per hour) | $25.00 Each", 25, null, "account_research", { hourly: true })).toBe("hourly");
    expect(settledFrequency("Research (per hour) | $25.00 Each", 25, "per_item", "account_research", { hourly: true })).toBe("hourly");
    // By default (Knox at v70, the fill, Darwin's verify) it is not derived (v8: no flat frequency).
    expect(settledFrequency("Research (per hour) | $25.00 Each", 25, null, "account_research")).toBeNull();
    expect(settledFrequency("Research (per hour) | $25.00 Each", 25, null, "account_research", { hourly: false })).toBeNull();
    // "Monthly Fee: (per hour)" filed as monthly maintenance is left for a person.
    expect(settledFrequency("Monthly Fee: (per hour) | $25.00", 25, null, "monthly_maintenance", { hourly: true })).toBeNull();
    // A stated hourly frequency is never replaced by a flat reading.
    expect(settledFrequency("Research | $25.00 each", 25, "hourly", "account_research", { hourly: false })).toBe("hourly");
  });
});

describe("hourlyVerdict", () => {
  it.each([
    ["Research: Labor Per Hour", "account_research", "per_occurrence", { action: "set" }],
    ["Subpoena Fee - Per Hour (Minimum One Hour Charge)", "legal_process", null, { action: "set" }],
    ["Coin Counting (per hour)", "coin_counting", "per_item", { action: "set" }],
    ["Safe Deposit Box Inventory (per hour)", "safe_deposit_box", null, { action: "set" }],
    ["Research per 15 min", "account_research", null, { action: "exempt", exemptReason: "partial_hour" }],
    ["Monthly Fee: (per hour)", "monthly_maintenance", null, { action: "exempt", exemptReason: "category" }],
    ["Overdraft (per hour)", "overdraft", null, { action: "exempt", exemptReason: "category" }],
    ["Monthly research per hour", "account_research", null, { action: "exempt", exemptReason: "period_word" }],
    ["Research per hour", "account_research", "monthly", { action: "exempt", exemptReason: "stated_period" }],
  ])("%j (%s, %s)", (name, key, frequency, verdict) => {
    expect(hourlyVerdict(name, key, frequency)).toEqual(verdict);
  });

  it("leaves names with no hourly basis and fees already hourly", () => {
    expect(hourlyVerdict("24 Hour Banking", "account_research", null)).toBeNull();
    expect(hourlyVerdict("Research per hour", "account_research", "hourly")).toBeNull();
  });
});

const ROWS = [
  { fee_published_id: "101", fee_verified_id: "9001", institution_id: "5", fee_name: "Research Fee $25/hour", amount: "25", canonical_fee_key: "account_research", frequency: null },
  { fee_published_id: "102", fee_verified_id: "9002", institution_id: "5", fee_name: "Research: Labor Per Hour", amount: "40", canonical_fee_key: "account_research", frequency: "per_occurrence" },
  { fee_published_id: "103", fee_verified_id: null, institution_id: "6", fee_name: "Monthly Fee: (per hour)", amount: "25", canonical_fee_key: "monthly_maintenance", frequency: null },
  { fee_published_id: "104", fee_verified_id: "9004", institution_id: "6", fee_name: "Wire Transfer", amount: "25", canonical_fee_key: "wire_domestic_outgoing", frequency: "per_item" },
  { fee_published_id: "105", fee_verified_id: "9005", institution_id: "6", fee_name: "24 Hour Banking", amount: "0", canonical_fee_key: "account_research", frequency: null },
];

type DbMock = ReturnType<typeof vi.fn>;
function dbFor(rows: Array<Record<string, unknown>>, cursor: string | null = null): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("FROM agent_run_events")) return Promise.resolve(cursor == null ? [] : [{ next_after_id: cursor }]);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: "101" }, { fee_published_id: "102" }]);
    if (text.includes("FROM published_fee_records")) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
}
const asDb = (db: DbMock) => db as unknown as Parameters<typeof recheckHourlyFrequencies>[0];
const texts = (db: DbMock) => db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?"));

describe("Darwin live hourly re-check", () => {
  it("ships switched on (James, 2026-10-16)", () => {
    expect(HOURLY_FREQUENCY_LIVE).toBe(true);
    expect(HOURLY_CHECK_BATCH).toBe(2_000);
  });

  it("counts by action, reason and current frequency", () => {
    const found = findHourlyFees(ROWS);
    expect(found).toMatchObject({
      checked: 5,
      matched: 3,
      wouldSet: 2,
      exempt: 1,
      exemptByReason: { category: 1, partial_hour: 0, period_word: 0, stated_period: 0 },
      wouldSetByFrequency: { none: 1, per_occurrence: 1 },
    });
    expect(found.setSamples.map((fee) => fee.feePublishedId)).toEqual([101, 102]);
  });

  it("in shadow, reports and moves the cursor but writes no fee", async () => {
    const db = dbFor(ROWS, "100");
    const result = await recheckHourlyFrequencies(asDb(db), { runId: 7, stepId: 70, dryRun: false, live: false });
    expect(result).toMatchObject({ live: false, wouldSet: 2, exempt: 1, afterId: 100, nextAfterId: 0, set: [] });
    const sent = texts(db);
    expect(sent.some((text) => text.includes("UPDATE"))).toBe(false);
    expect(sent.some((text) => text.includes("pipeline_feedback"))).toBe(false);
    const report = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("INSERT INTO agent_run_events"));
    expect(report?.[3]).toBe("darwin.hourly_frequency_check");
    expect(String(report?.[4])).toContain("switch off, nothing written");
    expect(JSON.parse(String(report?.[5]))).toMatchObject({ next_after_id: 0, would_set: 2, switch_live: false });
  });

  it("carries the cursor on when the batch is full", async () => {
    const result = await recheckHourlyFrequencies(asDb(dbFor(ROWS.slice(0, 2))), { runId: 7, dryRun: false, limit: 2 });
    expect(result.afterId).toBe(0);
    expect(result.nextAfterId).toBe(102);
  });

  it("a dry run writes nothing at all, even switched on", async () => {
    const db = dbFor(ROWS);
    await recheckHourlyFrequencies(asDb(db), { runId: 7, dryRun: true, live: true });
    expect(texts(db).some((text) => text.includes("UPDATE") || text.includes("INSERT"))).toBe(false);
  });

  it("switched on (the default), sets the live and verified rows guarded on the old value and logs each change", async () => {
    const db = dbFor(ROWS);
    const result = await recheckHourlyFrequencies(asDb(db), { runId: 7, stepId: 70, dryRun: false });
    expect(result.live).toBe(true);
    expect(result.set).toEqual([101, 102]);
    const update = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("UPDATE published_fee_records"));
    expect((update?.[0] as TemplateStringsArray).join("?")).toContain("fp.frequency IS NOT DISTINCT FROM v.from_frequency");
    expect(update?.[1]).toBe("hourly");
    expect(update?.[2]).toEqual([101, 102]);
    expect(update?.[3]).toEqual([null, "per_occurrence"]);
    const sent = texts(db);
    expect(sent.some((text) => text.includes("UPDATE verified_fee_observations"))).toBe(true);
    const feedback = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("INSERT INTO pipeline_feedback"));
    expect(String(feedback?.[1] ?? JSON.stringify(feedback))).toContain("darwin.hourly_frequency_check");
    expect(JSON.stringify(db.mock.calls)).toContain("darwin.hourly_frequency_set");
  });

  it("an institution-scoped run leaves the cursor alone", async () => {
    const db = dbFor(ROWS, "100");
    const result = await recheckHourlyFrequencies(asDb(db), { runId: 7, dryRun: false, institutionId: 5 });
    expect(result.afterId).toBeNull();
    expect(result.nextAfterId).toBeNull();
    expect(texts(db).some((text) => text.includes("FROM agent_run_events"))).toBe(false);
  });

  it("gives step detail with the switch state and samples", () => {
    const detail = hourlyDetail({ ...findHourlyFees(ROWS), live: false, dryRun: false, afterId: 0, nextAfterId: 0, set: [] });
    expect(detail).toMatchObject({ check: "darwin.hourly_frequency_check", switch_live: false, would_set: 2, set: 0 });
    expect(detail.samples_set[0]).toMatchObject({ fee_published_id: 101, from: null, action: "set" });
  });
});

describe("read-only hourly SQL", () => {
  it("counts by action, reason and current frequency with Postgres word boundaries", () => {
    const text = hourlyCountSql();
    expect(text).not.toMatch(/\\b/);
    expect(text).toContain("\\yper\\s+(?:an?\\s+|each\\s+|one\\s+|1\\s+)?(?:hour|hr)s?(?![a-z])");
    expect(text).toContain("btrim(regexp_replace(COALESCE(fee_name, ''), '\\s+', ' ', 'g'))");
    expect(text).toContain("THEN 'partial_hour'");
    expect(text).toContain("canonical_fee_key IN ('monthly_maintenance'");
    expect(text).toContain("THEN 'period_word'");
    expect(text).toContain("THEN 'stated_period'");
    expect(text).toContain("frequency IS NOT DISTINCT FROM 'hourly' THEN NULL");
    expect(text).toContain("COALESCE(frequency, 'none') AS current_frequency");
    expect(text).toContain("GROUPING SETS ((action, reason, current_frequency), (action, reason), (action), ())");
    expect(text).toContain("rolled_back_at IS NULL AND quarantined_at IS NULL AND amount_kind = 'flat'");
    expect(text).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/);
  });

  it("samples random would-set rows with their current frequency", () => {
    const text = hourlySamplesSql();
    expect(text).toContain("WHERE reason = 'set'");
    expect(text).toContain("ORDER BY random()");
    expect(text).toContain("LIMIT 40;");
    expect(text).toContain("COALESCE(frequency, 'none') AS current_frequency");
    expect(text).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/);
  });
});
