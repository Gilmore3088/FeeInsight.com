import { describe, expect, it, vi } from "vitest";
import { W43_HOURLY_LINE_ROWS } from "./hourly-frequency-check.fixtures";

import { hourlyFromLine, hourlyWording, settledFrequency } from "@/lib/fee-frequency";

import {
  HOURLY_CHECK_BATCH,
  HOURLY_CHECK_VERSION,
  HOURLY_FREQUENCY_LIVE,
  HOURLY_LINE_LIVE,
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
    ["Research: Labor Per Hour", "account_research", "per_occurrence", { action: "set", basis: "name" }],
    ["Subpoena Fee - Per Hour (Minimum One Hour Charge)", "legal_process", null, { action: "set", basis: "name" }],
    ["Coin Counting (per hour)", "coin_counting", "per_item", { action: "set", basis: "name" }],
    ["Safe Deposit Box Inventory (per hour)", "safe_deposit_box", null, { action: "set", basis: "name" }],
    ["Research per 15 min", "account_research", null, { action: "exempt", exemptReason: "partial_hour", basis: "name" }],
    ["Monthly Fee: (per hour)", "monthly_maintenance", null, { action: "exempt", exemptReason: "category", basis: "name" }],
    ["Overdraft (per hour)", "overdraft", null, { action: "exempt", exemptReason: "category", basis: "name" }],
    ["Monthly research per hour", "account_research", null, { action: "exempt", exemptReason: "period_word", basis: "name" }],
    ["Research per hour", "account_research", "monthly", { action: "exempt", exemptReason: "stated_period", basis: "name" }],
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
    const detail = hourlyDetail({ ...findHourlyFees(ROWS), live: false, lineLive: false, dryRun: false, afterId: 0, nextAfterId: 0, set: [] });
    expect(detail).toMatchObject({ check: "darwin.hourly_frequency_check", switch_live: false, would_set: 2, set: 0 });
    expect(detail.samples_set[0]).toMatchObject({ fee_published_id: 101, from: null, action: "set" });
  });
});

describe("v2: a fee priced by the hour only on its own line (#1456)", () => {
  // 1st Source Bank's name is silent; its line prices it by the hour.
  const LINE_ROWS = [
    { fee_published_id: "201", fee_verified_id: "9201", institution_id: "7", fee_name: "Account Research Fee", amount: "20", canonical_fee_key: "account_research", frequency: null, source_line: "Account Research Fee $20 per hour" },
    { fee_published_id: "202", fee_verified_id: "9202", institution_id: "7", fee_name: "Research", amount: "25", canonical_fee_key: "account_research", frequency: "per_item", source_line: "Research | $25.00/hr" },
    // Another fee's per-hour price on the line is not this fee's.
    { fee_published_id: "203", fee_verified_id: "9203", institution_id: "7", fee_name: "Stop Payment", amount: "30", canonical_fee_key: "stop_payment", frequency: "per_item", source_line: "Stop Payment | $30.00 | Research (per hour) | $25.00" },
    // A category never charged by the hour is exempt, as on the name.
    { fee_published_id: "204", fee_verified_id: "9204", institution_id: "7", fee_name: "Monthly Fee", amount: "25", canonical_fee_key: "monthly_maintenance", frequency: null, source_line: "Monthly Fee: (per hour) | $25.00" },
    // A line that does not print the fee's price says nothing of it.
    { fee_published_id: "205", fee_verified_id: "9205", institution_id: "7", fee_name: "Research", amount: "40", canonical_fee_key: "account_research", frequency: null, source_line: "Research (per hour) | $25.00" },
  ];

  it("is version 3 (v2 line rule, v3 unit-wording fix), with the line switch on after James's yes", () => {
    expect(HOURLY_CHECK_VERSION).toBe(3);
    expect(HOURLY_LINE_LIVE).toBe(true);
  });

  it("reads a silent name on its own line, with the same exemptions", () => {
    expect(hourlyVerdict("Account Research Fee", "account_research", null, "Account Research Fee $20 per hour", 20)).toEqual({ action: "set", basis: "line" });
    expect(hourlyVerdict("Monthly Fee", "monthly_maintenance", null, "Monthly Fee: (per hour) | $25.00", 25)).toEqual({ action: "exempt", exemptReason: "category", basis: "line" });
    expect(hourlyVerdict("Research", "account_research", "monthly", "Research | $25.00/hr", 25)).toEqual({ action: "exempt", exemptReason: "stated_period", basis: "line" });
    expect(hourlyVerdict("Research", "account_research", null, "Research (per hour) | $25.00", 40)).toBeNull();
    expect(hourlyVerdict("Research", "account_research", null, null, 25)).toBeNull();
    // The name still decides first.
    expect(hourlyVerdict("Research per hour", "account_research", null, "Research | $25.00 each", 25)).toEqual({ action: "set", basis: "name" });
  });

  it("counts line-only fees apart", () => {
    const found = findHourlyFees([...ROWS, ...LINE_ROWS]);
    expect(found).toMatchObject({ wouldSet: 4, wouldSetFromLine: 2, exempt: 2 });
    expect(found.matches.filter((fee) => fee.basis === "line").map((fee) => fee.feePublishedId)).toEqual([201, 202, 204]);
  });

  it("with the line switch off, writes only fees named by the hour", async () => {
    const db = dbFor([...ROWS, ...LINE_ROWS]);
    await recheckHourlyFrequencies(asDb(db), { runId: 7, stepId: 70, dryRun: false, lineLive: false });
    const update = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("UPDATE published_fee_records"));
    expect(update?.[2]).toEqual([101, 102]);
    // No feedback row or set event names a line-only fee.
    const writes = db.mock.calls
      .filter(([strings]) => /pipeline_feedback|hourly_frequency_set/.test((strings as TemplateStringsArray).join("?")))
      .map((call) => JSON.stringify(call.slice(1)));
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.some((text) => /\b20[12]\b/.test(text))).toBe(false);
  });

  it("exempts a line-only fee whose line names a period", () => {
    expect(hourlyVerdict("Research", "account_research", null, "Research | $25.00 per hour, billed monthly", 25)).toEqual({ action: "exempt", exemptReason: "period_word", basis: "line" });
    // A partial hour on the line is no hourly basis at all.
    expect(hourlyVerdict("Research", "account_research", null, "Research | $10.00 per 15 minutes", 10)).toBeNull();
  });

  it("with the line switch on, writes line-only fees too", async () => {
    const db = dbFor([...ROWS, ...LINE_ROWS]);
    const result = await recheckHourlyFrequencies(asDb(db), { runId: 7, stepId: 70, dryRun: false, lineLive: true });
    expect(result.lineLive).toBe(true);
    const update = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("UPDATE published_fee_records"));
    expect(update?.[2]).toEqual([101, 102, 201, 202]);
    expect(hourlyDetail(result)).toMatchObject({ line_switch_live: true, would_set_from_line: 2 });
  });

  it("reads each fee's stored line with it", async () => {
    const db = dbFor(ROWS);
    await recheckHourlyFrequencies(asDb(db), { runId: 7, dryRun: true });
    const read = texts(db).find((text) => text.includes("FROM published_fee_records"));
    expect(read).toContain("LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id");
    expect(read).toContain("from 'excerpt=\"(.*)\"\\s*$') AS source_line");
  });
});

describe("own-price hourly attribution (#1456, production source witnesses)", () => {
  it.each([
    // Citizens Bank, published 19296, artifact 712: two distinct fees at the same price.
    ["Stop Payment Order (ACH, Debit Card, Check)", "stop_payment", 30,
      "Stop Payment Order (ACH, Debit Card, Check) $30.00 Research per hour (one hour minimum) $30.00"],
    // First Service FCU, published 32264, artifact 6275: the previous price's unit.
    ["Counter Check", "counter_check", 2,
      "Account Research/Reconcillation $25 per hour Counter Check $2 each"],
    // Mound City Bank, published 36105, artifact 6676: another equal-price fee.
    ["3x5", "safe_deposit_box", 25,
      "Subpoena Response (per hour) | $25.00 3x5 $25.00"],
  ])("does not borrow an hour from another fee for %s", (name, category, amount, line) => {
    expect(hourlyVerdict(name, category, null, line, amount)).toBeNull();
  });

  it("keeps every reviewed W43 whole-hour positive without activating the switch", () => {
    const found = findHourlyFees(W43_HOURLY_LINE_ROWS);
    expect(found.wouldSetFromLine).toBe(27);
    expect(found.matches.map((fee) => fee.feePublishedId)).toEqual(
      W43_HOURLY_LINE_ROWS.map((row) => Number(row.fee_published_id)).sort((a, b) => a - b),
    );
    expect(found.matches.every((fee) => fee.action === "set" && fee.basis === "line")).toBe(true);
    expect(HOURLY_LINE_LIVE).toBe(true);
  });

  it("binds equal-price and previous-price units to their named fee", () => {
    expect(hourlyFromLine("Account Research | $30 per hour", 30, "Stop Payment")).toBe(false);
    expect(hourlyVerdict("Stop Payment", "stop_payment", null, "Account Research | $30 per hour", 30)).toBeNull();
    const samePrice = "Stop Payment $30 Research (per hour) $30";
    expect(hourlyFromLine(samePrice, 30, "Stop Payment")).toBe(false);
    expect(hourlyFromLine(samePrice, 30, "Research")).toBe(true);
    // With no named owner, incompatible readings of the same price stay unknown.
    expect(hourlyFromLine(samePrice, 30)).toBe(false);
    const previousPrice = "Research $25 per hour Counter Check $2 each";
    expect(hourlyFromLine(previousPrice, 2)).toBe(false);
    expect(hourlyFromLine(previousPrice, 25, "Research")).toBe(true);
  });

  it("reads a unit-only next cell but never a next fee's label", () => {
    expect(hourlyFromLine("Research | $40 | per hour", 40, "Research")).toBe(true);
    expect(hourlyFromLine("Research | $40 | Research per hour | $25", 40, "Research")).toBe(false);
    expect(hourlyFromLine("Research | $40 | per hour | Stop Payment | $40", 40, "Stop Payment")).toBe(false);
  });

  it("keeps minimum prices separate and refuses an explicit partial-hour price", () => {
    expect(hourlyFromLine("Research $25 per hour, $25 minimum", 25, "Research")).toBe(true);
    expect(hourlyFromLine("Research (min. $10) | $25 per hour", 25, "Research (min. $10)")).toBe(true);
    expect(hourlyFromLine("Reconciliation ($15 per Minimum) | $25 per Hour", 25, "Reconciliation ($15 per Minimum)")).toBe(true);
    expect(hourlyFromLine("Research (per hour) | $25 minimum | $50 each", 25, "Research")).toBe(false);
    expect(hourlyFromLine("Research (per hour) | $10 per 15 minutes", 10, "Research")).toBe(false);
    expect(hourlyFromLine("Research (per hour) | $10 | per half hour", 10, "Research")).toBe(false);
    expect(hourlyFromLine("Research fee (1/2-hour minimum charge) | $50 per 1/2 hour", 50, "Research fee")).toBe(false);
  });
});

describe("v3: a bare or next-cell hour unit after the fee's own price (#1456)", () => {
  // Live blank-frequency account_research fees read on 2026-10-21 (published id, stored line).
  it.each([
    [20683, "Account Research", 25, "Account Research $25.00 an hour"],
    [23392, "Account Research (one hour minimum)", 30, "Account Research (one hour minimum) | $30 hour | ATM Deposit Adjustment | $25"],
    [45629, "Account balancing assistance", 20, "Account balancing assistance......................$20.00 hr."],
    [89175, "Account research", 25, "Account research | $25.00 hr; $10.00 min"],
    [109596, "Account Research", 25, "Account Research $ 25.00 | hour"],
    [72586, "Account Research", 20, "Account Research | $20 | Per hour with 1 hour minimum"],
    [154057, "Account Research", 15, "Account Research | $15.00 | Per hour (minimum 1 hour)"],
    [131794, "Research fee", 25, "Research fee $25.00 per-hour"],
    [32401, "Account Research", 30, "(Created by check, in-person withdrawal, or other electronic means) | Account Research | $30.00 (per-hour)"],
    [15677, "Research Fee", 25, "Research Fee $25.00 per hourCheck Copy Fees Footnote10"],
    [86657, "Account Research", 15, "Account Research2 | $15.00 per hour"],
    [143913, "Research (any account)", 20, "Research6 (any account) | $20.00/hour"],
  ])("sets %i (%s) hourly from its line", (_id, name, amount, line) => {
    expect(hourlyFromLine(line, amount, name)).toBe(true);
    expect(hourlyVerdict(name, "account_research", null, line, amount)).toEqual({ action: "set", basis: "line" });
  });

  it.each([
    // A minimum, a first-hour tier or a part of an hour is not a per-hour price.
    ["Account research", 10, "Account research | $10.00 1 hr minimum"],
    ["Account Research", 25, "Account Research | $25.00 hour minimum"],
    ["Account Research", 20, "Account Research $20.00/First Hour"],
    ["Account research", 10, "Account research | $10.00 first hour, $25.00 per hour thereafter"],
    ["Account Reconciliation", 10, "Account Reconciliation | $10.00/Half-hour"],
    ["Checkbook balancing (repeated)", 5, "Checkbook balancing (repeated) | $5.00 (per ½ hour)"],
    ["Account Reconciliation", 15, "Account Reconciliation | $15/ 1/2 hour"],
    ["Research Fee (One hour minimum)", 30, "Research Fee (One hour minimum) | $30.00"],
    // Hours of service, or a later cell that is not only the unit's start, are not a basis.
    ["Night Drop", 25, "Night Drop | $25.00 | Hours of operation apply"],
    ["Account Research", 25, "Account Research | $25.00 | Per Account Per Hour"],
    // Another fee's footnoted label is still another fee's.
    ["Stop Payment", 30, "Stop Payment2 | $30.00 | Research (per hour) | $25.00"],
  ])("leaves %s at %d on %j unknown", (name, amount, line) => {
    expect(hourlyFromLine(line, amount, name)).toBe(false);
  });

  it("does not take a neighbour's bare hour unit", () => {
    expect(hourlyFromLine("Stop Payment | $30.00 | Research | $30 hour", 30, "Stop Payment")).toBe(false);
    expect(hourlyFromLine("Stop Payment | $30.00 | Research | $30 hour", 30, "Research")).toBe(true);
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
