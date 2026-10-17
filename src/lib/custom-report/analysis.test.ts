import { describe, expect, it } from "vitest";
import type { CustomReportMarketData, MarketFeeLine } from "@/lib/data-store/custom-report-market";
import { analyzeMarket, buildReportCsv, diffReports, excludedReason, MISSING_EXCLUDED, MISSING_NOT_FOUND, MISSING_TOO_FEW, positionCounts, MIN_COMPARABLE_LINES, NAMED_COMPETITORS, NAMED_WITHOUT_DEPOSITS, pickNamedCompetitors, quantile, type NamedCompetitor } from "./analysis";

const KEYS = ["overdraft", "nsf", "stop_payment", "cashiers_check", "wire_domestic_outgoing", "card_replacement"];

function market(opts: { competitors: number; ownKeys?: string[]; ownAmount?: number }): CustomReportMarketData {
  const lines: MarketFeeLine[] = [];
  for (const key of opts.ownKeys ?? KEYS) {
    lines.push({ institution_id: 1, line: key, amount: opts.ownAmount ?? 20, fee_name: `Own ${key}`, source_url: "https://a", updated_at: "2026-10-01", schedule_read_on: "2026-09-30", source_line: `${key} | $${opts.ownAmount ?? 20}` });
  }
  const competitors = [];
  for (let i = 0; i < opts.competitors; i += 1) {
    const id = 100 + i;
    competitors.push({ institution_id: id, institution_name: `Rival ${i}`, city: "X", state_code: "CA", charter_type: "bank", market_deposits: 1000 - i });
    for (const key of KEYS) lines.push({ institution_id: id, line: key, amount: 10 + i, fee_name: key, source_url: null, updated_at: null, schedule_read_on: null, source_line: `${key} | $${10 + i}` });
  }
  return {
    subject: { institution_id: 1, institution_name: "Subject Bank", city: "X", state_code: "CA", charter_type: "bank", market_deposits: null, asset_size: null },
    market: { basis: "branch_counties", county_fips: ["6037"], places: ["Los Angeles, CA"], sod_year: 2026 },
    competitors,
    lines,
    dropped: {},
  };
}

describe("analyzeMarket", () => {
  it("is ready with enough comparable lines and competitors with data", () => {
    const result = analyzeMarket(market({ competitors: 20 }));
    expect(result.readiness.ready).toBe(true);
    expect(result.readiness.comparableLines).toBe(KEYS.length);
    expect(result.named).toHaveLength(8);
    expect(result.named[0].institution_name).toBe("Rival 0");
  });

  it("holds when too few local competitors have verified fees", () => {
    const result = analyzeMarket(market({ competitors: 10 }));
    expect(result.readiness.ready).toBe(false);
    expect(result.readiness.reason).toContain("10 of 10 local competitors");
  });

  it("holds when the bank publishes too few lines", () => {
    const result = analyzeMarket(market({ competitors: 20, ownKeys: KEYS.slice(0, MIN_COMPARABLE_LINES - 1) }));
    expect(result.readiness.ready).toBe(false);
    expect(result.readiness.reason).toContain("headline fees verified");
  });

  it("holds when no local market was found", () => {
    const data = market({ competitors: 20 });
    const result = analyzeMarket({ ...data, market: null });
    expect(result.readiness.ready).toBe(false);
  });

  it("places the bank against the local quartiles and states it in the findings", () => {
    const result = analyzeMarket(market({ competitors: 20, ownAmount: 40 }));
    const overdraft = result.lines.find((l) => l.key === "overdraft")!;
    expect(overdraft.peers?.median).toBe(19.5);
    expect(overdraft.position).toBe("above_market");
    expect(overdraft.percentile).toBe(100);
    expect(result.findings[0]).toContain("($40) is above the local middle half");
    expect(result.findings.at(-1)).toBe("0 of your 6 comparable fee lines sit inside the middle half of your local market.");
  });

  it("never compares a line with fewer than 8 local peers", () => {
    const data = market({ competitors: 20 });
    data.lines = data.lines.filter((l) => !(l.line === "nsf" && l.institution_id >= 107));
    const nsf = analyzeMarket(data).lines.find((l) => l.key === "nsf")!;
    expect(nsf.peers?.n).toBe(7);
    expect(nsf.comparable).toBe(false);
    expect(nsf.position).toBeNull();
  });
});

describe("quantile", () => {
  it("interpolates like percentile_cont", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
  });
});

describe("tiered fees", () => {
  it("keeps every stated tier on the bank's own line", () => {
    const data = market({ competitors: 20 });
    const own = data.lines.find((l) => l.institution_id === 1 && l.line === "overdraft")!;
    own.tiers = [
      { amount: 35, fee_name: "Negative from $50.01 and more", source_line: "Negative from $50.01 and more | $35" },
      { amount: 5, fee_name: "Negative $25 or less", source_line: "Negative $25 or less | $5" },
    ];
    const line = analyzeMarket(data).lines.find((l) => l.key === "overdraft")!;
    // Lowest first, each with its own quote; overdraft compares at the highest (standard) tier.
    expect(line.own?.tiers?.map((t) => t.amount)).toEqual([5, 35]);
    expect(line.own?.amount).toBe(35);
    expect(line.own?.evidence?.basis).toBe("highest of 2 published prices");
  });
});

describe("rank and sources", () => {
  it("counts competitors charging less and keeps every competitor figure with its source", () => {
    // Rivals charge 10..29; the subject charges 20, so 10 rivals charge less.
    const result = analyzeMarket(market({ competitors: 20 }));
    const overdraft = result.lines.find((l) => l.key === "overdraft")!;
    expect(overdraft.chargingLess).toBe(10);
    expect(overdraft.peerFigures).toHaveLength(20);
    expect(overdraft.peerFigures[0].amount).toBe(10);
    expect(overdraft.own?.schedule_read_on).toBe("2026-09-30");
    expect(result.named[0].sources.overdraft.source_line).toBe("overdraft | $10");
  });

  it("is null on lines that are not comparable", () => {
    const result = analyzeMarket(market({ competitors: 20, ownKeys: KEYS.slice(0, 5) }));
    expect(result.lines.find((l) => l.key === "card_replacement")?.chargingLess ?? null).toBeNull();
  });
});

describe("pickNamedCompetitors", () => {
  const own = new Set(KEYS);
  const fees = Object.fromEntries(KEYS.map((k) => [k, 10]));
  function rival(id: number, deposits: number | null, lineCount = KEYS.length): NamedCompetitor {
    const subset = Object.fromEntries(Object.entries(fees).slice(0, lineCount));
    return { institution_id: id, institution_name: `R${id}`, city: null, state_code: "CA", charter_type: deposits === null ? "credit_union" : "bank", market_deposits: deposits, fees: subset, sources: {} };
  }

  it("keeps slots for credit unions with no deposit figure, best coverage first", () => {
    const banks = Array.from({ length: 12 }, (_, i) => rival(i + 1, 1000 - i));
    const cus = [rival(101, null, 3), rival(102, null, 6), rival(103, null, 5), rival(104, null, 4)];
    const named = pickNamedCompetitors([...banks, ...cus], own);
    expect(named).toHaveLength(NAMED_COMPETITORS);
    expect(named.slice(0, NAMED_COMPETITORS - NAMED_WITHOUT_DEPOSITS).map((c) => c.institution_id)).toEqual([1, 2, 3, 4, 5]);
    expect(named.slice(-NAMED_WITHOUT_DEPOSITS).map((c) => c.institution_id)).toEqual([102, 103, 104]);
  });

  it("gives unused bank slots to credit unions and drops thin overlaps", () => {
    const named = pickNamedCompetitors([rival(1, 500), rival(2, null, 2), ...[3, 4, 5, 6].map((id) => rival(id, null))], own);
    expect(named.map((c) => c.institution_id)).toEqual([1, 3, 4, 5, 6]);
  });
});

function parseCsv(csv: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r") continue;
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  const [header, ...body] = rows;
  return body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
}

describe("buildReportCsv", () => {
  it("writes one row per record with the report's context, the institution first", () => {
    const data = market({ competitors: 20 });
    const rows = parseCsv(buildReportCsv(data, analyzeMarket(data), "2026-10-17"));
    const yours = rows.filter((r) => r.row === "yours");
    expect(yours).toHaveLength(analyzeMarket(data).lines.length);
    expect(rows.filter((r) => r.row === "competitor")).toHaveLength(20 * KEYS.length);
    expect(rows[0]).toMatchObject({ report_institution_id: "1", report_date: "2026-10-17", currency: "USD" });
    expect(rows[0].market_counties).toContain("Los Angeles");
    const overdraft = yours.find((r) => r.fee_line === "Overdraft (per item)")!;
    expect(overdraft).toMatchObject({ fee_basis: "per item", amount: "20", amount_basis: "published price", record: "1", records: "1", record_used: "yes", missing_reason: "" });
  });

  it("says why a cell is empty: not found, too few competitors", () => {
    const data = market({ competitors: 20, ownKeys: KEYS.slice(0, 5) });
    data.lines = data.lines.filter((l) => !(l.line === "nsf" && l.institution_id >= 107));
    const rows = parseCsv(buildReportCsv(data, analyzeMarket(data))).filter((r) => r.row === "yours");
    expect(rows.find((r) => r.fee_line === "Debit card replacement")?.missing_reason).toBe(MISSING_NOT_FOUND);
    expect(rows.find((r) => r.fee_line === "NSF / returned item")?.missing_reason).toBe(MISSING_TOO_FEW);
    expect(rows.find((r) => r.fee_line === "Paper statement")?.missing_reason).toBe(MISSING_NOT_FOUND);
  });

  it("lists every record behind a calculated amount and the record left out", () => {
    const data = market({ competitors: 20 });
    const rival = data.lines.find((l) => l.institution_id === 100 && l.line === "overdraft")!;
    rival.tiers = [
      { id: 11, amount: 10, fee_name: "Overdraft (Basic)", source_line: "Overdraft fee | $10", source_url: "https://r/fees.pdf", schedule_read_on: "2026-10-01" },
      { id: 12, amount: 30, fee_name: "Overdraft (Premier)", source_line: "Overdraft fee | $30", source_url: "https://r/fees.pdf", schedule_read_on: "2026-10-01" },
      { id: 13, amount: 35, fee_name: "Overdraft fees vary", source_line: "The amount for overdraft fees varies, but $35 is common.", source_url: "https://r/learning/money-management/checking", schedule_read_on: "2026-10-01" },
    ];
    const analysis = analyzeMarket(data);
    const rows = parseCsv(buildReportCsv(data, analysis)).filter((r) => r.row === "competitor" && r.institution_id === "100" && r.fee_line === "Overdraft (per item)");
    expect(rows.map((r) => [r.record_id, r.record_amount, r.record_used])).toEqual([["11", "10", "yes"], ["12", "30", "yes"], ["13", "35", "no"]]);
    expect(rows[0]).toMatchObject({ amount: "30", amount_basis: "highest of 2 published prices", published_range: "$10 to $30", records: "3" });
    expect(rows[2].missing_reason).toBe("excluded: educational article, not the bank's fee schedule");
    expect(analysis.exclusions).toEqual({ competitorAmounts: 0, competitorRecords: 1, ownAmounts: 0, ownRecords: 0, scopeRecords: 0 });
  });

  it("quotes commas and neutralizes spreadsheet formulas", () => {
    const data = market({ competitors: 20 });
    data.subject.institution_name = "=HYPERLINK(1), Bank";
    const csv = buildReportCsv(data, analyzeMarket(data));
    expect(csv).toContain(`"'=HYPERLINK(1), Bank"`);
  });
});

describe("evidence check", () => {
  it("leaves out a competitor amount its evidence does not show and works the medians out without it", () => {
    const data = market({ competitors: 20 });
    const before = analyzeMarket(data).lines.find((l) => l.key === "overdraft")!;
    const rival = data.lines.find((l) => l.institution_id === 119 && l.line === "overdraft")!;
    rival.source_url = "https://bank.example/personal-banking/learning/money-management/types-of-checking-accounts";
    rival.source_line = "The amount for overdraft fees varies, but $29 each occurrence is common.";
    const analysis = analyzeMarket(data);
    const after = analysis.lines.find((l) => l.key === "overdraft")!;
    expect(before.peers?.n).toBe(20);
    expect(after.peers?.n).toBe(19);
    expect(after.peers?.median).toBe(19);
    expect(after.excludedFigures?.map((f) => f.institution_id)).toEqual([119]);
    expect(after.excludedFigures?.[0].evidence.excluded[0].problem).toBe("not_a_fee_schedule");
    expect(analysis.named.find((c) => c.institution_id === 119)?.fees.overdraft).toBeUndefined();
    expect(analysis.exclusions?.competitorAmounts).toBe(1);
    const csv = parseCsv(buildReportCsv(data, analysis)).filter((r) => r.institution_id === "119" && r.fee_line === "Overdraft (per item)");
    expect(csv).toHaveLength(1);
    expect(csv[0]).toMatchObject({ amount: "", record_used: "no", missing_reason: "excluded: educational article, not the bank's fee schedule" });
  });

  it("leaves out a record whose quote does not state its amount", () => {
    const data = market({ competitors: 20 });
    const rival = data.lines.find((l) => l.institution_id === 105 && l.line === "stop_payment")!;
    rival.source_line = "Stop payment | $5";
    const line = analyzeMarket(data).lines.find((l) => l.key === "stop_payment")!;
    expect(line.excludedFigures?.[0].evidence.excluded[0].problem).toBe("quote_without_amount");
    const csv = parseCsv(buildReportCsv(data, analyzeMarket(data))).filter((r) => r.institution_id === "105" && r.fee_line === "Stop payment");
    expect(csv[0].missing_reason).toBe(MISSING_EXCLUDED);
    expect(MISSING_EXCLUDED).toBe("excluded: the quote does not show the amount");
  });

  it("names what the quote describes and the fee it is not, on the page's records and in the CSV", () => {
    const data = market({ competitors: 20 });
    const blank = { source_url: null, updated_at: null, schedule_read_on: null };
    const atm: MarketFeeLine = { institution_id: 103, line: "atm_non_network", amount: 4, fee_name: "ATM", source_line: "", ...blank };
    const maintenance: MarketFeeLine = { institution_id: 104, line: "monthly_maintenance", amount: 3.49, fee_name: "Monthly", source_line: "", ...blank };
    data.lines.push(atm, maintenance);
    // PNC's two ATM prices (rows 13164 and the $3 domestic one): $5 abroad must not average in.
    atm.tiers = [
      { id: 21, amount: 3, fee_name: "Non-PNC Bank ATM Fee (US, Canada, Puerto Rico, US Virgin Islands)", source_line: "Puerto Rico and the U.S. Virgin Islands ..... $3.00 each", source_url: "https://r/fees.pdf", schedule_read_on: "2026-10-01" },
      { id: 22, amount: 5, fee_name: "Non-PNC Bank ATM Fee (All Other Countries)", source_line: "At non-PNC Bank ATMs in all other countries ..... $5.00 each", source_url: "https://r/fees.pdf", schedule_read_on: "2026-10-01" },
    ];
    maintenance.tiers = [
      { id: 31, amount: 2.99, fee_name: "For a monthly fee", source_line: "First Commerce offers the ATM Freedom add-on for the Power Checking account. For a monthly fee of $2.99, you'll get unlimited surcharge refunds", source_url: "https://r/checking", schedule_read_on: "2026-10-01" },
      { id: 32, amount: 3.99, fee_name: "Power Checking + CoverMe Monthly service charge", source_line: "Power Checking + CoverMe - $3.99/month", source_url: "https://r/checking", schedule_read_on: "2026-10-01" },
    ];
    const analysis = analyzeMarket(data);
    const atmLine = analysis.lines.find((l) => l.key === "atm_non_network")!;
    const pnc = atmLine.peerFigures.find((f) => f.institution_id === 103)!;
    expect(pnc.amount).toBe(3);
    expect(pnc.evidence?.excluded[0]).toMatchObject({ record_id: 22, problem: "international_atm", reason: "international ATM withdrawal, not domestic" });
    const commerce = analysis.lines.find((l) => l.key === "monthly_maintenance")!.peerFigures.find((f) => f.institution_id === 104)!;
    expect(commerce.amount).toBe(3.99);
    expect(commerce.evidence?.excluded[0]).toMatchObject({ record_id: 31, reason: "ATM surcharge-refund add-on, not account maintenance" });
    expect(analysis.exclusions?.scopeRecords).toBe(2);
    // The CSV's missing_reason for a left-out record (one line, so only compared lines get rows).
    expect(excludedReason(pnc.evidence?.excluded[0])).toBe("excluded: international ATM withdrawal, not domestic");
    expect(excludedReason(commerce.evidence?.excluded[0])).toBe("excluded: ATM surcharge-refund add-on, not account maintenance");
  });
});

describe("diffReports", () => {
  it("is empty when nothing moved", () => {
    const data = market({ competitors: 20 });
    expect(diffReports(analyzeMarket(data), analyzeMarket(data))).toEqual([]);
  });

  it("lists a named competitor's change and the median it moves", () => {
    const before = market({ competitors: 20 });
    const after = market({ competitors: 20 });
    // Every rival raises stop payment by $5: each named rival's fee and the median move.
    after.lines = after.lines.map((l) =>
      l.institution_id !== 1 && l.line === "stop_payment" ? { ...l, amount: l.amount + 5, source_line: `stop_payment | $${l.amount + 5}` } : l,
    );
    const changes = diffReports(analyzeMarket(before), analyzeMarket(after));
    const median = changes.find((c) => c.subject === "median");
    expect(median).toMatchObject({ key: "stop_payment", before: expect.any(Number) });
    expect(median!.after! - median!.before!).toBe(5);
    const rival = changes.find((c) => c.subject === "competitor" && c.who === "Rival 0");
    expect(rival).toMatchObject({ key: "stop_payment", before: 10, after: 15 });
    expect(changes.filter((c) => c.subject === "own")).toEqual([]);
  });
});

describe("positionCounts", () => {
  it("counts above, inside and below the local middle half", () => {
    const counts = positionCounts(analyzeMarket(market({ competitors: 20, ownAmount: 100 })).lines);
    expect(counts).toEqual({ above: KEYS.length, inside: 0, below: 0 });
  });
});
