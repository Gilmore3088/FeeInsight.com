import { describe, expect, it, vi } from "vitest";

import {
  CUT_EXCERPT_CHARS,
  excerptOf,
  fillBlankFrequencies,
  fillFrequenciesInPublish,
  FREQUENCY_FILL_VERSION,
  fullStoredLine,
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

describe("v15: a stored line cut before its price is read on its full line (#1901)", () => {
  const cut = "Dormant Checking fee: Assessed to the checking account if the member has a combined savings and checking balance with less than $50, no activity in 12 months and no other Navy Fede";
  const navy = { ...row(80997, "3.00", cut), canonical_fee_key: "dormant_account", source_document_id: 15428, fee_name: "Dormant Checking fee", before_v15: false };
  const fullText = [
    "Fee | Amount",
    "Dormant Checking fee: Assessed to the checking account if the member has a combined savings and checking balance with less than $50, no activity in 12 months and no other Navy Federal products. This is not applicable to a member under the age of 24. | $3.00 per quarter",
    "Account Number Reassignment (more than once in the same calendar year) | $25.00",
  ].join("\n\n");
  const dbWith = (text: string) => {
    const db = createDbMock([]);
    db.unsafe = vi.fn((sql: string) => {
      // The SQL read returns the lines of a document with line breaks; the fill keeps those holding the key.
      if (sql.includes("v15 full lines")) return Promise.resolve(text.includes("\n") ? [{ fee_published_id: 80997, lines: text.split("\n") }] : []);
      if (sql.includes("fp.fee_name ~*")) return Promise.resolve([]);
      return Promise.resolve([navy]);
    });
    return db;
  };

  it("fills Navy Federal's $3 dormant fee quarterly from its document's full line and logs the basis", async () => {
    expect(FREQUENCY_FILL_VERSION).toBeGreaterThanOrEqual(15);
    const db = dbWith(fullText);
    const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: false });
    expect(result.filled.map((fee) => [fee.feePublishedId, fee.frequency, fee.basis])).toEqual([[80997, "quarterly", "full_stored_line"]]);
    expect(result.filled[0].sourceLine).toContain("$3.00 per quarter");
    const sqlText = String(db.unsafe.mock.calls[0][0]);
    expect(sqlText).toContain("AS before_v15");
    expect(sqlText).toContain(`>= ${CUT_EXCERPT_CHARS}`);
  });

  it("reads nothing when no line, two lines or a flattened document holds the cut line", async () => {
    for (const text of ["Fee | Amount\nAccount Number Reassignment | $25.00", `${fullText}\n${fullText.replace("$3.00", "$4.00")}`, fullText.replace(/\n/g, " ")]) {
      const result = await fillBlankFrequencies(asDb(dbWith(text)), { runId: 5, dryRun: true });
      expect(result.filled, text.slice(0, 40)).toEqual([]);
    }
  });

  it("never reads a v15-only row on its excerpt, when the read says false or NULL", async () => {
    // Postgres gives NULL, not false, when a blank row fails every pre-v15 arm (#1929 review).
    const oneTime = (before: boolean | null) => ({
      ...row(5, "5.00", `${"Account research and reconciliation services requested by the member for any reason, billed at the rate shown here and ".repeat(2).slice(0, 170)} | $5.00 one-time`),
      canonical_fee_key: "account_research",
      before_v15: before,
    });
    for (const before of [false, null]) {
      const db = createDbMock([oneTime(before)]);
      const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: true });
      expect(result.filled, String(before)).toEqual([]);
    }
  });

  it("reads only the matching lines in SQL, never whole documents", async () => {
    const db = dbWith(fullText);
    await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: true });
    const read = db.unsafe.mock.calls.map((call) => String(call[0])).find((sql) => sql.includes("v15 full lines"))!;
    expect(read).toContain("regexp_split_to_table(t.normalized_text, E'\\r?\\n')");
    expect(read).toContain("strpos(l.line, w.key) > 0");
    expect(read).not.toMatch(/SELECT w\.fee_published_id, [^\n]*normalized_text/);
  });

  it("finds the one full line that prints the price", () => {
    expect(fullStoredLine(fullText, cut, 3)).toContain("| $3.00 per quarter");
    expect(fullStoredLine(fullText, cut, 5)).toBeNull();
    expect(fullStoredLine(fullText, "too short", 3)).toBeNull();
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

describe("v16: the fill leaves per-item maintenance fees to Darwin and keeps its own full-line fills (Oct 31)", () => {
  const knox = (excerpt: string) => `Knox deterministic extraction from Rosetta artifact #1. excerpt="${excerpt}"`;
  const fee = (id: number, key: string, name: string, amount: string, frequency: string | null, excerpt: string, beforeV15 = true) => ({
    fee_published_id: id,
    fee_verified_id: id + 1000,
    fee_raw_id: id + 2000,
    institution_id: 7,
    source_document_id: id + 3000,
    canonical_fee_key: key,
    fee_name: name,
    amount,
    frequency,
    conditions: knox(excerpt),
    before_v15: beforeV15,
  });
  /** The fill's reads: `rows` from the main read, nothing from the box read, `lines` from the v15 full-line read. */
  const dbWith = (rows: Array<Record<string, unknown>>, lines: Record<number, string> = {}) => {
    const db = createDbMock([]);
    db.unsafe = vi.fn((sql: string, params?: unknown[]) => {
      if (sql.includes("v15 full lines")) {
        const ids = (params?.[0] as number[]) ?? [];
        return Promise.resolve(ids.filter((id) => lines[id]).map((id) => ({ fee_published_id: id, lines: [lines[id]] })));
      }
      if (sql.includes("fp.fee_name ~*")) return Promise.resolve([]);
      return Promise.resolve(rows);
    });
    return db;
  };

  // The 10 monthly-maintenance fees the 01:30 UTC pass blanked on Oct 31 (run 16584), as they were stored.
  const perItemMaintenance = [
    fee(69927, "monthly_maintenance", "maintenance fee | Non-Account owner", "16.00", "per_item", "maintenance fee | • Non-Account owner | $16 each"),
    fee(152158, "monthly_maintenance", "Minimum opening balance, and a maintenance fee", "1.00", "per_transaction", "There is a $1.00 minimum opening balance, and a maintenance fee of $1.00 per withdrawal after 6 per statement cycle"),
    fee(106618, "monthly_maintenance", "Service charge", "15.00", "per_item", "Minimum Balance Requirements: To open this account, you must make a minimum deposit of $100. There is a $15 service charge each fee period. Avoid the service charge by having a com"),
    fee(113636, "monthly_maintenance", "Service charge", "5.00", "per_item", "There is a $5.00 service charge if the balance goes below $2,500.00"),
    fee(127148, "monthly_maintenance", "low balance service charge plus cents per check", "10.00", "per_item", "$10.00 low balance service charge plus $0.10 cents per check"),
    fee(130957, "monthly_maintenance", "NOW Account Checking Maintenance fee", "8.00", "per_item", "A maintenance fee of $8.00 plus .50¢ per check will be imposed every statement cycle unless you maintain either a minimum daily balance of $750.00 or an average daily balance of $1"),
    fee(140755, "monthly_maintenance", "Service charge fee", "7.50", "per_item", "Minimum balance to avoid imposition of fees - A service charge fee of $7.50 will | A per item fee of $10.00 will be charged for each debit transaction (withdrawal, check"),
    fee(143161, "monthly_maintenance", "Service charge", "30.00", "per_item", "Minimum Balance Requirements: To open this account, you must make a minimum deposit of $100. There is a $30 service charge each fee period. Avoid the service charge by having:"),
    fee(147168, "monthly_maintenance", "If the average falls below the requirement, a service charge of", "10.00", "per_item", "If the average falls below the requirement, a service charge of $10.00 and $.25 per check is assessed.*"),
    fee(149338, "monthly_maintenance", "monthly fee, if balance falls below $300.00", "4.00", "per_item", "(monthly fee, if balance falls below $300.00) ................................. $4.00"),
  ];

  it("never clears or changes a monthly-maintenance fee stored per item (Darwin's switched re-check owns it)", async () => {
    expect(FREQUENCY_FILL_VERSION).toBe(16);
    const result = await fillBlankFrequencies(asDb(dbWith(perItemMaintenance)), { runId: 5, dryRun: true });
    expect(result.filled).toEqual([]);
    expect(result.held).toEqual([]);
  });

  it("still fills a blank monthly-maintenance fee whose own line says month, and leaves a per-item line blank", async () => {
    const result = await fillBlankFrequencies(asDb(dbWith([
      fee(150690, "monthly_maintenance", "☒ A maintenance fee", "10.00", null, "☒ A maintenance fee of $10 will be imposed every statement period if the average daily balance for the account falls below $2,500 ."),
      fee(149338, "monthly_maintenance", "monthly fee, if balance falls below $300.00", "4.00", null, "(monthly fee, if balance falls below $300.00) ................................. $4.00"),
      fee(69927, "monthly_maintenance", "maintenance fee | Non-Account owner", "16.00", null, "maintenance fee | • Non-Account owner | $16 each"),
    ])), { runId: 5, dryRun: true });
    expect(result.filled.map((row) => [row.feePublishedId, row.frequency])).toEqual([[150690, "monthly"], [149338, "monthly"]]);
  });

  // The five fees the hourly sweep rewrote on every pass ("frequencyFill 5"), with their documents' lines.
  const dots = ".".repeat(165);
  const flip = [
    { row: fee(164885, "returned_mail", "Invalid Address Fee", "10.00", null, `Invalid Address Fee ${dots}`.slice(0, 180), false),
      line: `Invalid Address Fee ${dots}${".".repeat(30)}$10.00 per month`, to: "monthly" },
    { row: fee(48831, "ira_administration", "IRA maintenance fee", "20.00", null, `IRA maintenance fee${dots}`.slice(0, 180), false),
      line: `IRA maintenance fee${dots}${".".repeat(30)}$20.00 per year`, to: "annual" },
    { row: fee(54739, "document_reproduction", "Statement Copies", "5.00", null, `• Statement Copies ${dots}`.slice(0, 180), false),
      line: `• Statement Copies ${dots}${".".repeat(20)} $5.00/month`, to: "monthly" },
    { row: fee(71136, "ach_origination", "Additional fees apply to ACH origination, wire transf", "15.00", null,
      "Online Cash Management (with company administrator) Includes balances, transactions, account transfers & check images. Additional fees apply to ACH origination, wire transfers & st", false),
      line: "Online Cash Management (with company administrator) Includes balances, transactions, account transfers & check images. Additional fees apply to ACH origination, wire transfers & stop payments. | $15.00/month", to: "monthly" },
  ];

  it("fills a blank from its full stored line once, and the next pass keeps it instead of clearing it", async () => {
    const lines = Object.fromEntries(flip.map(({ row, line }) => [row.fee_published_id, line]));
    const first = await fillBlankFrequencies(asDb(dbWith(flip.map(({ row }) => row), lines)), { runId: 5, dryRun: true });
    expect(first.filled.map((row) => [row.feePublishedId, row.from, row.frequency, row.basis]))
      .toEqual(flip.map(({ row, to }) => [row.fee_published_id, null, to, "full_stored_line"]));
    // The next pass: the same rows, now stated, read by a pre-v15 arm (a period on a per-event key).
    const stated = flip.map(({ row, to }) => ({ ...row, frequency: to, before_v15: true }));
    const second = await fillBlankFrequencies(asDb(dbWith(stated, lines)), { runId: 5, dryRun: true });
    expect(second.filled).toEqual([]);
    // Without the full line (v15 before this fix), the cut excerpt clears it: the hourly flip.
    const blind = await fillBlankFrequencies(asDb(dbWith(stated, {})), { runId: 5, dryRun: true });
    expect(blind.filled.map((row) => [row.feePublishedId, row.from, row.frequency])).toEqual(stated.map((row) => [row.fee_published_id, row.frequency, null]));
  });

  it("still corrects a stated frequency on a cut line when its full line says otherwise", async () => {
    const row = fee(48831, "ira_administration", "IRA maintenance fee", "20.00", "monthly", `IRA maintenance fee${dots}`.slice(0, 180));
    const result = await fillBlankFrequencies(asDb(dbWith([row], { 48831: `IRA maintenance fee${dots}$20.00 per year` })), { runId: 5, dryRun: true });
    expect(result.filled.map((fee) => [fee.feePublishedId, fee.from, fee.frequency])).toEqual([[48831, "monthly", null]]);
  });
});
