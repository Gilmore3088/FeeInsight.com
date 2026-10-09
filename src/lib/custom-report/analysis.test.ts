import { describe, expect, it } from "vitest";
import type { CustomReportMarketData, MarketFeeLine } from "@/lib/data-store/custom-report-market";
import { analyzeMarket, buildReportCsv, diffReports, positionCounts, unavailableReason, MIN_COMPARABLE_LINES, MIN_LOCAL_PEERS_PER_LINE, NAMED_COMPETITORS, NAMED_WITHOUT_DEPOSITS, pickNamedCompetitors, quantile, type NamedCompetitor } from "./analysis";

const KEYS = ["overdraft", "nsf", "stop_payment", "cashiers_check", "wire_domestic_outgoing", "card_replacement"];

function market(opts: { competitors: number; ownKeys?: string[]; ownAmount?: number }): CustomReportMarketData {
  const lines: MarketFeeLine[] = [];
  for (const key of opts.ownKeys ?? KEYS) {
    lines.push({ institution_id: 1, line: key, amount: opts.ownAmount ?? 20, fee_name: `Own ${key}`, source_url: "https://a", updated_at: "2026-10-01", schedule_read_on: "2026-09-30", source_line: `${key} | $20` });
  }
  const competitors = [];
  for (let i = 0; i < opts.competitors; i += 1) {
    const id = 100 + i;
    competitors.push({ institution_id: id, institution_name: `Rival ${i}`, city: "X", state_code: "CA", charter_type: "bank", market_deposits: 1000 - i });
    for (const key of KEYS) lines.push({ institution_id: id, line: key, amount: 10 + i, fee_name: key, source_url: null, updated_at: null, schedule_read_on: null, source_line: key });
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
    expect(result.findings[0]).toContain("($40) is above the local range");
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

describe("unavailableReason", () => {
  it("names the institution's missing fee when enough competitors publish the line", () => {
    const data = market({ competitors: 20, ownKeys: KEYS.filter((k) => k !== "nsf") });
    const nsf = analyzeMarket(data).lines.find((l) => l.key === "nsf")!;
    expect(nsf.own).toBeNull();
    expect(nsf.peers?.n).toBe(20);
    expect(unavailableReason(nsf)).toBe("own_fee_missing");
  });

  it("names too few competitors when the institution's fee is on file", () => {
    const data = market({ competitors: 20 });
    data.lines = data.lines.filter((l) => !(l.line === "nsf" && l.institution_id >= 100 + MIN_LOCAL_PEERS_PER_LINE - 1));
    const nsf = analyzeMarket(data).lines.find((l) => l.key === "nsf")!;
    expect(nsf.own?.amount).toBe(20);
    expect(nsf.peers?.n).toBe(MIN_LOCAL_PEERS_PER_LINE - 1);
    expect(unavailableReason(nsf)).toBe("too_few_peers");
  });

  it("names both when the fee is missing and too few competitors publish it", () => {
    const data = market({ competitors: 20, ownKeys: KEYS.filter((k) => k !== "nsf") });
    data.lines = data.lines.filter((l) => !(l.line === "nsf" && l.institution_id >= 103));
    const nsf = analyzeMarket(data).lines.find((l) => l.key === "nsf")!;
    expect(unavailableReason(nsf)).toBe("own_fee_missing_and_too_few_peers");
    const none = analyzeMarket(market({ competitors: 20 })).lines.find((l) => l.key === "monthly_maintenance")!;
    expect(none.own).toBeNull();
    expect(none.peers).toBeNull();
    expect(unavailableReason(none)).toBe("own_fee_missing_and_too_few_peers");
  });

  it("is null for a compared line, at exactly the threshold", () => {
    const data = market({ competitors: MIN_LOCAL_PEERS_PER_LINE + 10 });
    data.lines = data.lines.filter((l) => !(l.line === "nsf" && l.institution_id >= 100 + MIN_LOCAL_PEERS_PER_LINE));
    const nsf = analyzeMarket(data).lines.find((l) => l.key === "nsf")!;
    expect(nsf.peers?.n).toBe(MIN_LOCAL_PEERS_PER_LINE);
    expect(nsf.comparable).toBe(true);
    expect(unavailableReason(nsf)).toBeNull();
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
    expect(line.own?.tiers?.map((t) => t.amount)).toEqual([35, 5]);
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
    expect(result.named[0].sources.overdraft.source_line).toBe("overdraft");
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

describe("buildReportCsv", () => {
  it("lists the institution's lines, then every competitor figure on comparable lines", () => {
    const data = market({ competitors: 20 });
    const csv = buildReportCsv(data, analyzeMarket(data));
    const rows = csv.trim().split("\r\n");
    expect(rows[0]).toContain("competitors_charging_less");
    expect(rows.filter((r) => r.startsWith("yours,"))).toHaveLength(analyzeMarket(data).lines.length);
    expect(rows.filter((r) => r.startsWith("competitor,"))).toHaveLength(20 * KEYS.length);
  });

  it("quotes commas and neutralizes spreadsheet formulas", () => {
    const data = market({ competitors: 20 });
    data.subject.institution_name = "=HYPERLINK(1), Bank";
    const csv = buildReportCsv(data, analyzeMarket(data));
    expect(csv).toContain(`"'=HYPERLINK(1), Bank"`);
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
    after.lines = after.lines.map((l) => (l.institution_id !== 1 && l.line === "stop_payment" ? { ...l, amount: l.amount + 5 } : l));
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
