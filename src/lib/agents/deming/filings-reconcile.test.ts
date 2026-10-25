import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => {
  const mockSql = vi.fn();
  return { getSql: () => mockSql, sql: mockSql };
});

import {
  NOT_COVERED,
  RECONCILE_QUARTERS,
  RECONCILE_TIMEOUT_MS,
  buildFilingsReconcileReport,
  compareBanks,
  compareCreditUnions,
  filingsReconcileDetail,
  previousQuarterEnd,
  shownBankDates,
  quarterEnds,
  runFilingsReconcile,
  sameFigure,
  summarizeFilingsReconcile,
  type FiledItemRow,
  type ShownRecordRow,
} from "./filings-reconcile";

function record(institution_id: number, report_date: string, fields: Partial<ShownRecordRow> = {}): ShownRecordRow {
  return {
    institution_id, report_date, total_assets: null, total_deposits: null, service_charge_income: null, total_revenue: null,
    net_income: 1, overdraft_revenue: null, nsf_revenue: null, ...fields,
  };
}

const ffiec = (institution_id: number, report_date: string, item_key: string, item_code: string, value: number): FiledItemRow =>
  ({ institution_id, report_date, item_key, item_code, value, unit: "thousands" });
const ncua = (institution_id: number, report_date: string, item_key: string, value: number): FiledItemRow =>
  ({ institution_id, report_date, item_key, item_code: item_key.toUpperCase(), value, unit: "dollars" });

describe("quarter ends and tolerance", () => {
  it("steps back one quarter end at a time, across a year end", () => {
    expect(previousQuarterEnd("2026-03-31")).toBe("2025-12-31");
    expect(previousQuarterEnd("2026-06-30")).toBe("2026-03-31");
    expect(previousQuarterEnd("2026-12-31")).toBe("2026-09-30");
    expect(quarterEnds("2026-06-30", 4)).toEqual(["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"]);
    expect(quarterEnds("2026-06-30", RECONCILE_QUARTERS)[0]).toBe("2023-09-30");
  });

  it("matches within $1K or 0.05% of the filed figure", () => {
    expect(sameFigure(1_000_500, 1_000_000)).toBe(true);
    expect(sameFigure(1_002_000, 1_000_000)).toBe(false);
    expect(sameFigure(1_000_400_000, 1_000_000_000)).toBe(true);
    expect(sameFigure(1_000_600_000, 1_000_000_000)).toBe(false);
  });
});

describe("compareBanks", () => {
  // Stored data, read 2026-10-25 (#2025): U.S. Bank (institution 5) absorbed MUFG Union Bank on
  // 2023-05-26. RIAD4080 YTD Q1 240,341, Q2 534,603; BankFind ISERCHGQ Q2 266,655 ($K).
  const quarters = ["2023-06-30"];

  it("counts a merger quarter's income gap as explained, and a match as a match", () => {
    const out = compareBanks(
      [record(5, "2023-06-30", { service_charge_income: 266_655, total_assets: 669_902_786 })],
      [
        ffiec(5, "2023-03-31", "service_charges_deposits_ytd", "RIAD4080", 240_341),
        ffiec(5, "2023-06-30", "service_charges_deposits_ytd", "RIAD4080", 534_603),
        ffiec(5, "2023-06-30", "total_assets", "RCFD2170", 669_902_786),
      ],
      [{ institution_id: 5, effective_date: "2023-05-26" }],
      quarters,
    );
    expect(out.tallies.assets).toMatchObject({ compared: 1, matched: 1 });
    expect(out.tallies.serviceCharges).toMatchObject({ compared: 1, matched: 0, explained: 1, unexplained: 0 });
    expect(out.mismatches).toEqual([
      { charter: "bank", institutionId: 5, reportDate: "2023-06-30", metric: "serviceCharges", shown: 266_655_000, filed: 294_262_000, cls: "merger_quarter", explained: true },
    ]);
  });

  it("without a merger that same gap is unexplained", () => {
    const out = compareBanks(
      [record(5, "2023-06-30", { service_charge_income: 266_655 })],
      [
        ffiec(5, "2023-03-31", "service_charges_deposits_ytd", "RIAD4080", 240_341),
        ffiec(5, "2023-06-30", "service_charges_deposits_ytd", "RIAD4080", 534_603),
      ],
      [{ institution_id: 5, effective_date: "2023-03-01" }],
      quarters,
    );
    expect(out.mismatches[0].cls).toBe("unexplained");
    expect(out.tallies.serviceCharges).toMatchObject({ unexplained: 1 });
  });

  it("explains a negative differenced quarter (a year to date restarted mid-year)", () => {
    // Institution 365, 2024: RIAD4080 YTD Q2 2,036, Q3 728; BankFind Q3 728.
    const out = compareBanks(
      [record(365, "2024-09-30", { service_charge_income: 728 })],
      [ffiec(365, "2024-06-30", "service_charges_deposits_ytd", "RIAD4080", 2_036), ffiec(365, "2024-09-30", "service_charges_deposits_ytd", "RIAD4080", 728)],
      [],
      ["2024-09-30"],
    );
    expect(out.mismatches[0]).toMatchObject({ filed: -1_308_000, cls: "negative_differenced" });
  });

  it("explains every income line of a restarted quarter, not only the negative one", () => {
    // Institution 1548, 2026-Q2 (read 2026-10-25): service charges difference to -8 ($K); revenue
    // differences to 170 against BankFind's 6,088. Year-to-date values here are illustrative.
    const out = compareBanks(
      [record(1548, "2026-06-30", { service_charge_income: 112, total_revenue: 6_088 })],
      [
        ffiec(1548, "2026-03-31", "service_charges_deposits_ytd", "RIAD4080", 100),
        ffiec(1548, "2026-06-30", "service_charges_deposits_ytd", "RIAD4080", 92),
        ffiec(1548, "2026-03-31", "net_interest_income_ytd", "RIAD4074", 5_000),
        ffiec(1548, "2026-06-30", "net_interest_income_ytd", "RIAD4074", 5_150),
        ffiec(1548, "2026-03-31", "noninterest_income_total_ytd", "RIAD4079", 900),
        ffiec(1548, "2026-06-30", "noninterest_income_total_ytd", "RIAD4079", 920),
      ],
      [],
      ["2026-06-30"],
    );
    expect(out.mismatches.map((m) => `${m.metric}:${m.filed}:${m.cls}`)).toEqual([
      "serviceCharges:-8000:negative_differenced",
      "revenue:170000:negative_differenced",
    ]);
  });

  it("explains a foreign-office filer's deposits and flags an identity suspect", () => {
    const out = compareBanks(
      [
        record(5, "2026-06-30", { total_assets: 700_000_000, total_deposits: 540_000_000 }),
        // Institution 2923 (cert 8110), 2024-Q1: BankFind assets 56,438 vs filed 145,235 ($K).
        record(2923, "2026-06-30", { total_assets: 56_438, total_deposits: 50_000, service_charge_income: 6 }),
      ],
      [
        ffiec(5, "2026-06-30", "total_assets", "RCFD2170", 700_000_000),
        ffiec(5, "2026-06-30", "total_deposits", "RCON2200", 500_000_000),
        ffiec(2923, "2026-06-30", "total_assets", "RCON2170", 145_235),
        ffiec(2923, "2026-06-30", "total_deposits", "RCON2200", 120_000),
        ffiec(2923, "2026-03-31", "service_charges_deposits_ytd", "RIAD4080", 47),
        ffiec(2923, "2026-06-30", "service_charges_deposits_ytd", "RIAD4080", 110),
      ],
      [],
      ["2026-06-30"],
    );
    expect(out.tallies.deposits).toMatchObject({ compared: 2, explained: 1, unexplained: 1 });
    const classes = out.mismatches.map((m) => `${m.institutionId}:${m.metric}:${m.cls}`);
    expect(classes).toEqual(["5:deposits:foreign_offices", "2923:assets:identity_suspect", "2923:deposits:identity_suspect", "2923:serviceCharges:identity_suspect"]);
  });

  it("differences revenue from both lines, and leaves a legacy row's income uncompared", () => {
    const out = compareBanks(
      [
        record(7, "2026-06-30", { total_revenue: 56_000 }),
        record(8, "2026-06-30", { total_revenue: 1, service_charge_income: 1, net_income: null }),
      ],
      [
        ffiec(7, "2026-03-31", "net_interest_income_ytd", "RIAD4074", 40_000),
        ffiec(7, "2026-06-30", "net_interest_income_ytd", "RIAD4074", 81_000),
        ffiec(7, "2026-03-31", "noninterest_income_total_ytd", "RIAD4079", 15_000),
        ffiec(7, "2026-06-30", "noninterest_income_total_ytd", "RIAD4079", 30_000),
        ffiec(8, "2026-06-30", "service_charges_deposits_ytd", "RIAD4080", 9),
      ],
      [],
      ["2026-06-30"],
    );
    expect(out.tallies.revenue).toMatchObject({ compared: 1, matched: 1 });
    expect(out.tallies.serviceCharges).toMatchObject({ compared: 0, shownMissing: 1 });
    expect(out.mismatches).toEqual([]);
  });

  it("counts a quarter with no prior year-to-date line as filed missing, never a match", () => {
    const out = compareBanks(
      [record(7, "2026-06-30", { service_charge_income: 5 })],
      [ffiec(7, "2026-06-30", "service_charges_deposits_ytd", "RIAD4080", 10)],
      [],
      ["2026-06-30"],
    );
    expect(out.tallies.serviceCharges).toMatchObject({ compared: 0, filedMissing: 1 });
  });

  it("ignores records outside the window", () => {
    const out = compareBanks([record(7, "2022-12-31", { total_assets: 1 })], [], [], ["2026-06-30"]);
    expect(out.tallies.assets).toMatchObject({ compared: 0, filedMissing: 0 });
  });
});

describe("compareCreditUnions", () => {
  // Institution 4956, stored 2026-10-25: 2024-06-30 ACCT_131 $421,416,130, record 421,416 ($K);
  // 2026-06-30 ACCT_IS0048 and IS0049 filed as 0, records null (not reported).
  it("matches dollars filed against thousands shown, and counts NCUA's zeros as not reported", () => {
    const out = compareCreditUnions(
      [
        record(4956, "2024-06-30", { service_charge_income: 421_416, overdraft_revenue: 162_535, nsf_revenue: 183_988 }),
        record(4956, "2026-06-30", { service_charge_income: 297_363, overdraft_revenue: null, nsf_revenue: null }),
      ],
      [
        ncua(4956, "2024-06-30", "acct_131", 421_416_130),
        ncua(4956, "2024-06-30", "acct_is0048", 162_535_357),
        ncua(4956, "2024-06-30", "acct_is0049", 183_988_041),
        ncua(4956, "2026-06-30", "acct_131", 297_362_500),
        ncua(4956, "2026-06-30", "acct_is0048", 0),
        ncua(4956, "2026-06-30", "acct_is0049", 0),
      ],
      ["2024-06-30", "2026-06-30"],
    );
    expect(out.tallies.feeIncomeYtd).toMatchObject({ compared: 2, matched: 2 });
    expect(out.tallies.overdraftYtd).toMatchObject({ compared: 1, matched: 1, notReported: 1 });
    expect(out.tallies.nsfYtd).toMatchObject({ compared: 1, matched: 1, notReported: 1 });
    expect(out.mismatches).toEqual([]);
  });

  it("calls a fee-income difference unexplained and a missing shown figure missing", () => {
    const out = compareCreditUnions(
      [record(9, "2026-06-30", { service_charge_income: 500 }), record(10, "2026-06-30")],
      [ncua(9, "2026-06-30", "acct_131", 400_000), ncua(10, "2026-06-30", "acct_is0048", 1_000)],
      ["2026-06-30"],
    );
    expect(out.mismatches).toEqual([
      { charter: "credit_union", institutionId: 9, reportDate: "2026-06-30", metric: "feeIncomeYtd", shown: 500_000, filed: 400_000, cls: "unexplained", explained: false },
    ]);
    expect(out.tallies.overdraftYtd).toMatchObject({ shownMissing: 1, notReported: 0 });
  });
});

describe("filing versions (#1925: the feeds hold different versions of a refiled report)", () => {
  const epoch = (iso: string) => Date.parse(iso) / 1000;
  const por = (institution_id: number, report_date: string, iso: string): FiledItemRow =>
    ({ institution_id, report_date, item_key: "filing_last_updated", item_code: "POR_LAST_UPDATED", value: epoch(iso), unit: "count" });
  const NOW = new Date("2026-10-25T06:00:00Z");
  const verdicts = (out: ReturnType<typeof compareBanks>) =>
    out.mismatches.map((m) => `${m.reportDate}:${m.metric}:${m.cls}:${m.filingVersion ?? "-"}:${m.explained ? "explained" : "unexplained"}`);

  // Institution 3541 (read 2026-10-25): 2025-Q3 assets BankFind 125,950 vs FFIEC 125,418 ($K), and
  // its year-to-date income differs; the 2025-Q4 year to date agrees in both feeds, so Q4's gap is
  // Q3's carried into the subtraction. Both feeds were fetched in October 2026. Income figures
  // and the POR time here are illustrative.
  const fetched3541 = epoch("2026-10-10T08:00:00Z");
  const records3541 = [
    record(3541, "2025-03-31", { total_assets: 120_000, service_charge_income: 100, fetched_epoch: fetched3541 }),
    record(3541, "2025-06-30", { total_assets: 122_000, service_charge_income: 110, fetched_epoch: fetched3541 }),
    record(3541, "2025-09-30", { total_assets: 125_950, service_charge_income: 120, fetched_epoch: fetched3541 }),
    record(3541, "2025-12-31", { total_assets: 126_500, service_charge_income: 130, fetched_epoch: fetched3541 }),
  ];
  const items3541 = [
    ffiec(3541, "2025-03-31", "total_assets", "RCON2170", 120_000),
    ffiec(3541, "2025-06-30", "total_assets", "RCON2170", 122_000),
    ffiec(3541, "2025-09-30", "total_assets", "RCON2170", 125_418),
    ffiec(3541, "2025-12-31", "total_assets", "RCON2170", 126_500),
    ffiec(3541, "2025-03-31", "service_charges_deposits_ytd", "RIAD4080", 100),
    ffiec(3541, "2025-06-30", "service_charges_deposits_ytd", "RIAD4080", 210),
    ffiec(3541, "2025-09-30", "service_charges_deposits_ytd", "RIAD4080", 345),
    ffiec(3541, "2025-12-31", "service_charges_deposits_ytd", "RIAD4080", 460),
    por(3541, "2025-09-30", "2026-01-20T15:00:00Z"),
  ];

  it("tags 3541's 2025-Q4 as a knock-on of 2025-Q3, and says BankFind was fetched after the refiling", () => {
    const out = compareBanks(records3541, items3541, [], ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"], NOW);
    expect(verdicts(out)).toEqual([
      "2025-09-30:assets:filing_version_skew:bankfind_fetched_after_refiling:unexplained",
      "2025-09-30:serviceCharges:filing_version_skew:bankfind_fetched_after_refiling:unexplained",
      "2025-12-31:serviceCharges:prior_quarter_knock_on:-:explained",
    ]);
    expect(out.mismatches[2]).toMatchObject({ shown: 130_000, filed: 115_000, priorQuarterDiffers: true });
    expect(out.tallies.serviceCharges).toMatchObject({ compared: 4, matched: 2, explained: 1, unexplained: 1 });
  });

  it("leaves a knock-on unexplained when its prior quarter is not itself reported", () => {
    const out = compareBanks(records3541, items3541, [], ["2025-12-31"], NOW);
    expect(verdicts(out)).toEqual(["2025-12-31:serviceCharges:prior_quarter_knock_on:-:unexplained"]);
  });

  it("keeps 3519's 2026-Q2 negative difference unexplained, because 2026-Q1 differs between the feeds", () => {
    // Institution 3519 (read 2026-10-25): 2026-Q1 service charges BankFind 15 vs FFIEC 45 ($K);
    // BankFind Q1 + Q2 equals FFIEC's Q2 year to date. The Q2 figures here are illustrative.
    const out = compareBanks(
      [
        record(3519, "2026-03-31", { service_charge_income: 15, fetched_epoch: epoch("2026-10-01T00:00:00Z") }),
        record(3519, "2026-06-30", { service_charge_income: 25, fetched_epoch: epoch("2026-10-01T00:00:00Z") }),
      ],
      [
        ffiec(3519, "2026-03-31", "service_charges_deposits_ytd", "RIAD4080", 45),
        ffiec(3519, "2026-06-30", "service_charges_deposits_ytd", "RIAD4080", 40),
      ],
      [],
      ["2026-03-31", "2026-06-30"],
      NOW,
    );
    expect(verdicts(out)).toEqual([
      "2026-03-31:serviceCharges:filing_version_skew:unknown:unexplained",
      "2026-06-30:serviceCharges:negative_differenced:-:unexplained",
    ]);
    expect(out.mismatches[1]).toMatchObject({ filed: -5_000, priorQuarterDiffers: true });
    expect(out.tallies.serviceCharges).toMatchObject({ explained: 0, unexplained: 2 });
  });

  // Institution 744 (read 2026-10-25): 2026-Q2 non-interest income and assets both differ by exactly
  // 1,436 ($K). The other figures and the times are illustrative.
  const case744 = (porTime: string | null, fetchedIso: string) => compareBanks(
    [
      record(744, "2026-03-31", { total_assets: 1_000_000, total_revenue: 10_000, fetched_epoch: epoch(fetchedIso) }),
      record(744, "2026-06-30", { total_assets: 998_564, total_revenue: 10_500, fetched_epoch: epoch(fetchedIso) }),
    ],
    [
      ffiec(744, "2026-03-31", "total_assets", "RCON2170", 1_000_000),
      ffiec(744, "2026-06-30", "total_assets", "RCON2170", 1_000_000),
      ffiec(744, "2026-03-31", "net_interest_income_ytd", "RIAD4074", 8_000),
      ffiec(744, "2026-06-30", "net_interest_income_ytd", "RIAD4074", 16_500),
      ffiec(744, "2026-03-31", "noninterest_income_total_ytd", "RIAD4079", 2_000),
      ffiec(744, "2026-06-30", "noninterest_income_total_ytd", "RIAD4079", 5_436),
      ...(porTime ? [por(744, "2026-06-30", porTime)] : []),
    ],
    [],
    ["2026-03-31", "2026-06-30"],
    NOW,
  );

  it("counts 744's 2026-Q2 as explained only while FFIEC's refiling is newer and under 14 days old", () => {
    expect(verdicts(case744("2026-10-20T14:00:00Z", "2026-10-01T00:00:00Z"))).toEqual([
      "2026-06-30:assets:filing_version_skew:ffiec_newer:explained",
      "2026-06-30:revenue:filing_version_skew:ffiec_newer:explained",
    ]);
    // FFIEC newer but refiled 54 days ago: BankFind's lag no longer explains it.
    expect(verdicts(case744("2026-09-01T14:00:00Z", "2026-08-15T00:00:00Z"))).toEqual([
      "2026-06-30:assets:filing_version_skew:ffiec_newer:unexplained",
      "2026-06-30:revenue:filing_version_skew:ffiec_newer:unexplained",
    ]);
    // No POR time stored for the quarter: which feed is newer is unknown.
    expect(verdicts(case744(null, "2026-10-01T00:00:00Z"))).toEqual([
      "2026-06-30:assets:filing_version_skew:unknown:unexplained",
      "2026-06-30:revenue:filing_version_skew:unknown:unexplained",
    ]);
  });

  it("names the version skew in the summary and the detail", () => {
    const bank = { quarters: ["2026-03-31", "2026-06-30"], institutions: 1, error: null, ...case744(null, "2026-10-01T00:00:00Z") };
    const creditUnion = { quarters: [], institutions: 0, tallies: {}, mismatches: [], error: null };
    const report = buildFilingsReconcileReport("2026-10-25", 150, bank, creditUnion);
    expect(report.versionSkew).toEqual({ figures: 2, unexplained: 2, ffiecNewer: 0, bankfindFetchedAfterRefiling: 0, unknown: 2, knockOn: 0 });
    expect(summarizeFilingsReconcile(report)).toContain("ALARM: 2 unexplained (2 where BankFind and FFIEC hold different versions of the filing)");
    const detail = filingsReconcileDetail(report);
    expect(detail.version_skew).toMatchObject({ figures: 2, unexplained: 2, unknown: 2, bankfind_lag_days: 14 });
    expect((detail.mismatches as Record<string, unknown>[])[0]).toMatchObject({ class: "filing_version_skew", filing_version: "unknown", explained: false });
  });

  it("reads shown rows back to the first quarter of the year so a year to date can be summed", () => {
    expect(shownBankDates(["2025-09-30", "2025-12-31"])).toEqual(["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"]);
    expect(shownBankDates(["2026-03-31"])).toEqual(["2026-03-31"]);
  });
});

/** A tagged-template stand-in for the SQL client that answers by query text. */
function fakeDb(answers: [RegExp, (values: unknown[]) => unknown[] | Error][]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    for (const [pattern, answer] of answers) {
      if (pattern.test(text)) {
        const out = answer(values);
        return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
      }
    }
    return Promise.resolve([]);
  };
  return { db: tag as never, calls };
}

describe("runFilingsReconcile", () => {
  it("reads each charter under the timeout, restores it, and reports a failed read as an error", async () => {
    const { db, calls } = fakeDb([
      [/current_setting\('statement_timeout'\)/, () => [{ value: "2min" }]],
      [/max\(report_date\)/, (v) => (v[0] === "ffiec" ? [{ newest: "2023-06-30" }] : new Error("boom"))],
      [/ORDER BY md5/, () => [{ id: 5 }]],
      [/FROM institution_financial_records/, () => [record(5, "2023-06-30", { service_charge_income: 266_655 })]],
      [/FROM institution_call_report_items/, () => [
        ffiec(5, "2023-03-31", "service_charges_deposits_ytd", "RIAD4080", 240_341),
        ffiec(5, "2023-06-30", "service_charges_deposits_ytd", "RIAD4080", 534_603),
      ]],
      [/institution_structure_events/, () => [{ institution_id: 5, effective_date: "2023-05-26" }]],
    ]);
    const report = await runFilingsReconcile({ db, now: new Date("2026-10-25T06:00:00Z"), sampleSize: 3 });
    expect(report.seed).toBe("2026-10-25");
    expect(report.bank).toMatchObject({ institutions: 1, error: null });
    expect(report.bank.quarters).toHaveLength(RECONCILE_QUARTERS);
    expect(report.creditUnion.error).toBe("boom");
    expect(report.totals).toEqual({ compared: 1, matched: 0, explained: 1, unexplained: 0 });
    const settings = calls.filter((c) => /set_config/.test(c.text)).map((c) => c.values[0]);
    expect(settings).toEqual([String(RECONCILE_TIMEOUT_MS), "2min"]);
    // The bank read takes the quarter before the window so its first quarter can be differenced.
    const itemRead = calls.find((c) => /item_key = ANY/.test(c.text) && c.values[0] === "ffiec")!;
    expect((itemRead.values[2] as string[])[0]).toBe("2020-06-30");
    expect(summarizeFilingsReconcile(report)).toBe(
      "Deming reconciled 1 banks and 0 credit unions over 12 quarters: 0 of 1 figures match the stored filings, 1 differ for a known reason, none unexplained; could not read credit unions.",
    );
  });
});

describe("summary and detail", () => {
  it("names unexplained differences and identity suspects, unexplained listed first", () => {
    const bank = {
      quarters: ["2026-06-30"], institutions: 2, error: null,
      ...compareBanks(
        [record(5, "2026-06-30", { total_assets: 700_000_000, total_deposits: 540_000_000 }), record(2923, "2026-06-30", { total_assets: 56_438 })],
        [
          ffiec(5, "2026-06-30", "total_assets", "RCFD2170", 700_000_000),
          ffiec(5, "2026-06-30", "total_deposits", "RCON2200", 500_000_000),
          ffiec(2923, "2026-06-30", "total_assets", "RCON2170", 145_235),
        ],
        [],
        ["2026-06-30"],
      ),
    };
    const creditUnion = { quarters: [], institutions: 0, tallies: {}, mismatches: [], error: null };
    const report = buildFilingsReconcileReport("2026-10-25", 150, bank, creditUnion);
    expect(summarizeFilingsReconcile(report)).toBe(
      "Deming reconciled 2 banks and 0 credit unions over 12 quarters: 1 of 3 figures match the stored filings, 1 differ for a known reason, ALARM: 1 unexplained, 1 identity suspect(s).",
    );
    const detail = filingsReconcileDetail(report);
    expect((detail.mismatches as { class: string }[]).map((m) => m.class)).toEqual(["identity_suspect", "foreign_offices"]);
    expect(detail.identity_suspects).toEqual([{ institutionId: 2923, reportDate: "2026-06-30", shown: 56_438_000, filed: 145_235_000 }]);
    expect(detail.not_covered).toBe(NOT_COVERED);
  });
});
