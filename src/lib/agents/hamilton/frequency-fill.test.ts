import { describe, expect, it, vi } from "vitest";

import {
  excerptOf,
  fillBlankFrequencies,
  fillFrequenciesInPublish,
  FREQUENCY_FILL_VERSION,
  OVERDRAFT_PLAN_HOLD_LIVE,
  OVERDRAFT_PLAN_HOLD_REASON,
} from "./frequency-fill";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("UPDATE published_fee_records")) {
      return Promise.resolve((values.find(Array.isArray) as number[]).map((id) => ({ fee_published_id: id })));
    }
    return Promise.resolve([]);
  }) as unknown as DbMock;
  db.unsafe = vi.fn(() => Promise.resolve(rows));
  return db;
}

function asDb(db: DbMock): Parameters<typeof fillBlankFrequencies>[0] {
  return db as unknown as Parameters<typeof fillBlankFrequencies>[0];
}

const row = (id: number, amount: string, excerpt: string, frequency: string | null = null) => ({
  fee_published_id: id,
  fee_verified_id: id + 1000,
  fee_raw_id: id + 2000,
  institution_id: 7,
  source_document_id: 9,
  canonical_fee_key: "check_image",
  amount,
  frequency,
  conditions: `Knox deterministic extraction from Rosetta artifact #1. excerpt="${excerpt}"`,
});

describe("Hamilton frequency fill write failures (#1349)", () => {
  it("fails the step when the live write fails, instead of reporting 0 filled", async () => {
    const db = createDbMock([row(1, "6.00", "Copy of Share Draft (Check) Faxed | $6.00 each")]);
    const ok = db.getMockImplementation()! as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    db.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.join("?").includes("UPDATE published_fee_records")
        ? Promise.reject(new Error("deadlock detected"))
        : ok(strings, ...values));
    await expect(fillBlankFrequencies(asDb(db), { runId: 5, dryRun: false }))
      .rejects.toThrow(/frequency fill write failed: deadlock detected/);
  });

  it("in the publish step, a failed write is a warning and the publish carries on", async () => {
    const db = createDbMock([row(1, "6.00", "Copy of Share Draft (Check) Faxed | $6.00 each")]);
    const ok = db.getMockImplementation()! as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    db.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.join("?").includes("UPDATE published_fee_records")
        ? Promise.reject(new Error("deadlock detected"))
        : ok(strings, ...values));
    const result = await fillFrequenciesInPublish(asDb(db), { runId: 5, stepId: 6, dryRun: false });
    expect(result).toMatchObject({ filled: [], held: [], writeError: "frequency fill write failed: deadlock detected" });
    const warning = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("'step.warning'"));
    expect(warning?.slice(1, 4)).toEqual([5, 6, "Frequency fill skipped: frequency fill write failed: deadlock detected"]);
    expect((await fillFrequenciesInPublish(asDb(createDbMock([row(1, "6.00", "Copy | $6.00 each")])), { runId: 5, dryRun: false })).writeError).toBeNull();
  });

  it("a dry run still writes nothing and reports what it would fill", async () => {
    const db = createDbMock([row(1, "6.00", "Copy of Share Draft (Check) Faxed | $6.00 each")]);
    db.mockImplementation(() => Promise.reject(new Error("no writes on a dry run")));
    const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: true });
    expect(result.filled.map((fee) => fee.feePublishedId)).toEqual([1]);
  });
});

describe("Hamilton frequency fill", () => {
  it("reads the excerpt at the end of a row's conditions", () => {
    expect(excerptOf('canonical_hint=x; excerpt="Check Copy | $2.00 each"')).toBe("Check Copy | $2.00 each");
    expect(excerptOf("no excerpt")).toBeNull();
  });

  it("fills a blank frequency the line states and leaves the rest", async () => {
    const db = createDbMock([
      row(1, "6.00", "Copy of Share Draft (Check) Faxed | $6.00 each"),
      row(2, "30.00", "Checkbook Reconciliation (per hour) | $30.00"),
      row(3, "2.00", "Paper Statement | $2.00"),
    ]);
    const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: false });
    expect(result.scanned).toBe(3);
    expect(result.filled.map((fee) => [fee.feePublishedId, fee.frequency])).toEqual([[1, "per_item"]]);
    const sqlText = db.mock.calls.map((call) => (call[0] as TemplateStringsArray).join("?")).join("\n");
    expect(sqlText).toContain("UPDATE published_fee_records");
    expect(sqlText).toContain("AND fp.frequency IS NOT DISTINCT FROM v.from_frequency");
    expect(sqlText).toContain("INSERT INTO pipeline_feedback");
  });

  it("never writes or undoes an hourly frequency (#1456: that is Darwin's switched live re-check)", async () => {
    const db = createDbMock([
      row(1, "30.00", "Checkbook Reconciliation (per hour) | $30.00 | Stop Payment | $25.00 each"),
      row(2, "25.00", "Research | $25.00/hr | Copies | $1.00 each", "hourly"),
      row(3, "40.00", "Research (per hour) | $40.00 | Stop Payment | $25.00", "per_item"),
    ]);
    const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: true });
    expect(result.filled.some((fee) => fee.frequency === "hourly")).toBe(false);
    expect(result.filled.some((fee) => fee.from === "hourly")).toBe(false);
    // v8 as before: a flat frequency on a per-hour fee is cleared, not made hourly.
    expect(result.filled.map((fee) => [fee.feePublishedId, fee.from, fee.frequency])).toEqual([[3, "per_item", null]]);
  });

  it("corrects or clears a frequency read from another fee's row (v2)", async () => {
    const db = createDbMock([
      row(1, "5.00", "(Per month some exclusions apply) | Cashier’s Check (Per item) .......... $5.00", "monthly"),
      row(2, "20.00", "Missing/Bad Address - per year........ $10.00 | Reverse Stop Payment Request ........ $20.00", "annual"),
      row(3, "5.00", "Monthly Service Fees | Checking | $5.00", "monthly"),
    ]);
    const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: false });
    expect(result.filled.map((fee) => [fee.feePublishedId, fee.from, fee.frequency])).toEqual([
      [1, "monthly", "per_item"],
      [2, "annual", null],
    ]);
  });

  it("holds an NSF fee its own price states monthly and clears a neighbour's period (v11, #1196)", async () => {
    const nsf = (id: number, amount: string, excerpt: string, frequency: string, name: string) =>
      ({ ...row(id, amount, excerpt, frequency), canonical_fee_key: "nsf", fee_name: name });
    const overdraft = (id: number, amount: string, excerpt: string, name: string) =>
      ({ ...row(id, amount, excerpt, "monthly"), canonical_fee_key: "overdraft", fee_name: name });
    const db = createDbMock([
      nsf(1, "23.00", "NSF | $23.00/Month", "monthly", "NSF"),
      nsf(2, "5.00", "Undeliverable Mail | $5.00 per month | Returned ACH | $5.00 each", "monthly", "Returned ACH"),
      overdraft(3, "5.00", "Enhanced Overdraft Privilege Fee (per month) | $5.00", "Enhanced Overdraft Privilege Fee (per month)"),
    ]);
    const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: false });
    expect(result.held.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([
      [1, "frequency_hold: an NSF fee whose own line prices it monthly"],
    ]);
    expect(result.filled.map((fee) => [fee.feePublishedId, fee.from, fee.frequency])).toEqual([[2, "monthly", null]]);
    const sqlText = db.mock.calls.map((call) => (call[0] as TemplateStringsArray).join("?")).join("\n");
    expect(sqlText).toContain("rolled_back_reason = v.reason");
    expect(sqlText).not.toContain("DELETE");
    const feedback = db.mock.calls.find((call) => (call[0] as TemplateStringsArray).join("?").includes("INSERT INTO pipeline_feedback"));
    expect(JSON.stringify(feedback)).toContain("frequency_held");
  });

  it("never fills a blank NSF fee with a period, so v11 does not clear it again (#1196)", async () => {
    const nsf = (id: number, amount: string, excerpt: string, frequency: string | null, name: string) =>
      ({ ...row(id, amount, excerpt, frequency), canonical_fee_key: "nsf", fee_name: name });
    const db = createDbMock([
      // Addition Financial 24188: filled monthly at 15:23 UTC on Oct 14 and cleared at 15:27, every pass.
      nsf(1, "35.00", "Dormant accounts | $15 00 per month Nonsufficient funds | $35 00", null, "00 per month Nonsufficient funds"),
      // Its own line's per-item wording still fills a blank.
      nsf(2, "28.00", "NSF Item Returned | $28.00 per item", null, "NSF Item Returned"),
      // v12 (#1301): a daily price with no daily cap on its line is held for a person.
      nsf(3, "30.00", "NSF/UCF Fee $30 Per Day", "daily", "NSF/UCF Fee"),
    ]);
    const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: true });
    expect(result.filled.map((fee) => [fee.feePublishedId, fee.from, fee.frequency])).toEqual([[2, null, "per_item"]]);
    expect(result.held.map((fee) => fee.feePublishedId)).toEqual([3]);
  });

  it("writes nothing on a dry run", async () => {
    const db = createDbMock([row(1, "6.00", "Copy of Share Draft (Check) Faxed | $6.00 each")]);
    const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: true });
    expect(result.filled).toHaveLength(1);
    expect(db).not.toHaveBeenCalled();
  });

  it("never fills a blank overdraft fee with a period its own check clears, and reads the v13 keys (#1339)", async () => {
    // Regression: 130684 went blank -> monthly -> blank on every publish step (fill, then v11 check).
    const db = createDbMock([
      { ...row(130684, "5.00", "Overdraft Trans. (After 3rd trans. per mo.) | $5.00"), canonical_fee_key: "overdraft", fee_name: "Overdraft Trans. (After 3rd trans. per mo.)" },
      { ...row(92746, "30.00", "Overdraft Boost .........................................$30.00 per month"), canonical_fee_key: "overdraft", fee_name: "Overdraft Boost" },
      { ...row(87587, "3.00", "Daily overdraft fee……$3.00 | Online Cash Management & Bill Pay……$19.95/month", "monthly"), canonical_fee_key: "continuous_od", fee_name: "Daily overdraft fee" },
      { ...row(102189, "10.00", "Monthly1 account service charge is $10 if below minimum balance requirement."), canonical_fee_key: "monthly_maintenance", fee_name: "Monthly1 account service charge" },
      { ...row(36109, "29.00", "Overdraft Fee (Max 5 items per day) | $29.00 International Outgoing $40.00", "daily"), canonical_fee_key: "overdraft", fee_name: "Overdraft Fee (Max 5 items per day)" },
    ]);
    const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: true });
    expect(result.filled.map((fee) => [fee.feePublishedId, fee.from, fee.frequency])).toEqual([
      [92746, null, "monthly"],
      [87587, "monthly", "daily"],
      [102189, null, "monthly"],
      [36109, "daily", null],
    ]);
    expect(result.held).toEqual([]);
    const readSql = db.unsafe.mock.calls[0][0] as string;
    expect(readSql).toContain("fp.canonical_fee_key = 'continuous_od' AND fp.frequency IN ('monthly', 'annual', 'quarterly')");
    expect(readSql).toContain("fp.canonical_fee_key = 'monthly_maintenance'");
  });

  it("keeps a v13 correction on the next pass, and logs a later write under its own version (v14)", async () => {
    // Regression: on Oct 15 these were corrected at 01:30 UTC and written back at 01:32 by the next
    // pass's `settledFrequency`, which read the old period off the same line (124039's write-back
    // left no feedback row: its key `fix:124039:daily` already existed from v10).
    const live = [
      { ...row(53797, "10.00", "Cashier's Check per check $7.00 Check cashing (non-customer) $5.00 Collection Item $15.00 Deposited Item Returned (per item) $10.00 Dormant Account Fee (per month) $5.00 A dormant ", "monthly"), canonical_fee_key: "deposited_item_return", fee_name: "Deposited Item Returned (per item)" },
      { ...row(65200, "1.00", "DAILY NEGATIVE BALANCE FEE | $1.00/day or Cap Monthly", "monthly"), canonical_fee_key: "continuous_od", fee_name: "DAILY NEGATIVE BALANCE FEE" },
      { ...row(76864, "30.00", "Overdraft Item/s Fee Per Item | $30.00 | Annual Rent – 4 x 10 | $85.00", "annual"), canonical_fee_key: "overdraft", fee_name: "Overdraft Item/s Fee Per Item" },
      { ...row(103686, "5.00", "annual addition to the $5.00 Daily Overdraft Fee.", "annual"), canonical_fee_key: "continuous_od", fee_name: "Daily Overdraft Fee" },
      { ...row(128934, "23.00", "Check Overdraft (ea. debit/draft paid) -$5.01 and up (negative balance) 6 per day: $23.00", "daily"), canonical_fee_key: "overdraft", fee_name: "Check Overdraft (ea. debit/draft paid) - and up (negative balance) 6 per day" },
      { ...row(124039, "24.00", "Overdraft Protection – ODP*(per item presentment) | $24.00 (Not to exceed 5 charges per day)", "daily"), canonical_fee_key: "overdraft", fee_name: "Overdraft Protection – ODP (per item presentment)" },
      { ...row(87587, "3.00", "Daily overdraft fee………………$3.00 | Online Cash Management & Bill Pay……...……$19.95/month", "monthly"), canonical_fee_key: "continuous_od", fee_name: "Daily overdraft fee" },
    ];
    const first = await fillBlankFrequencies(asDb(createDbMock(live)), { runId: 1, dryRun: true });
    expect(first.filled.map((fee) => [fee.feePublishedId, fee.from, fee.frequency])).toEqual([
      [53797, "monthly", "per_item"],
      [65200, "monthly", "daily"],
      [76864, "annual", "per_item"],
      [103686, "annual", "daily"],
      [128934, "daily", "per_item"],
      [124039, "daily", "per_item"],
      [87587, "monthly", "daily"],
    ]);
    // The next pass reads the corrected rows (live and verified agree) and writes nothing.
    const corrected = live.map((fee) => ({ ...fee, frequency: first.filled.find((fill) => fill.feePublishedId === fee.fee_published_id)!.frequency }));
    const second = await fillBlankFrequencies(asDb(createDbMock(corrected)), { runId: 2, dryRun: true });
    expect(second.filled).toEqual([]);
    expect(second.held).toEqual([]);

    const db = createDbMock(live.slice(5, 6));
    await fillBlankFrequencies(asDb(db), { runId: 3, dryRun: false });
    // Feedback rows upsert on their key: an unversioned key overwrote 124039's v10 row instead of adding one.
    const values = db.mock.calls.flatMap((call) => call.slice(1)).map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join("\n");
    expect(values).toContain(`hamilton.frequency_fill:v${FREQUENCY_FILL_VERSION}:fix:124039:daily:per_item`);
    expect(db.unsafe.mock.calls[0][0]).toContain("COALESCE(fr.extraction_note, fr.conditions) AS conditions");
  });

  it("fills a blank box rent from its table's annual header and logs the basis (v10)", async () => {
    const box = { ...row(4, "25.00", "3 x 5 x 21 | $25"), canonical_fee_key: "safe_deposit_box" };
    const plain = { ...row(5, "20.00", "3 x 5 | $20"), canonical_fee_key: "safe_deposit_box", source_document_id: 10 };
    const db = createDbMock([]);
    db.unsafe = vi.fn((sql: string) => {
      if (sql.includes("agent_source_texts")) {
        return Promise.resolve([
          { source_document_id: 9, normalized_text: "Box Size: | Annual Rental:\n3 x 5 x 21 | $25" },
          { source_document_id: 10, normalized_text: "Safe Deposit Boxes:\n3 x 5 | $20" },
        ]);
      }
      if (sql.includes("fp.fee_name ~*")) return Promise.resolve([box, plain]);
      return Promise.resolve([]);
    });
    const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: false });
    expect(result.filled.map((fee) => [fee.feePublishedId, fee.frequency, fee.basis])).toEqual([[4, "annual", "box_table_header"]]);
    const sqlText = db.mock.calls.map((call) => (call[0] as TemplateStringsArray).join("?")).join("\n");
    expect(sqlText).toContain("INSERT INTO pipeline_feedback");
  });
});

describe("overdraft plan hold (#1360)", () => {
  const plan = (id: number, name: string, amount: string, excerpt: string, hasPerItem: boolean) => ({
    ...row(id, amount, excerpt, "monthly"),
    canonical_fee_key: "overdraft",
    fee_name: name,
    has_per_item_overdraft: hasPerItem,
  });

  const plans = () => [
    // Selco 143753, Oct 15: back beside its live $25 per-item Courtesy Pay.
    plan(143753, "Elevate Courtesy Pay Service (if selected)", "10.00", "Money Order $1.50 Elevate Courtesy Pay Service (if selected) $10 per month", true),
    // First Community FCU's only live overdraft row: James keeps it.
    plan(92746, "Overdraft Boost", "30.00", "Overdraft Boost .........................................$30.00 per month", false),
  ];

  it("ships on (James, Oct 16) and holds the plan fee beside the bank's per-item fee only, never deleting it", async () => {
    expect(OVERDRAFT_PLAN_HOLD_LIVE).toBe(true);
    const db = createDbMock(plans());
    const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: false });
    expect(result.held.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([
      [143753, `frequency_hold: ${OVERDRAFT_PLAN_HOLD_REASON}`],
    ]);
    expect(result.planWouldHold).toEqual([]);
    expect(result.filled).toEqual([]);
    const sqlText = db.mock.calls.map((call) => (call[0] as TemplateStringsArray).join("?")).join("\n");
    expect(sqlText).toContain("rolled_back_reason = v.reason");
    expect(sqlText).not.toContain("DELETE");
  });

  it("switched off, only lists the plan fees it would hold, beside the bank's per-item fee only", async () => {
    const db = createDbMock(plans());
    const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: false, planHoldLive: false });
    expect(result.planWouldHold.map((fee) => fee.feePublishedId)).toEqual([143753]);
    expect(result.planWouldHold[0].reason).toBe(`frequency_hold: ${OVERDRAFT_PLAN_HOLD_REASON}`);
    expect(result.held).toEqual([]);
    expect(result.filled).toEqual([]);
  });
});
