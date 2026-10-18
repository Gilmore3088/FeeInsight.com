import { describe, expect, it } from "vitest";
import { buildConnectedPanel } from "./connected-panel-view";
import type { NormalizedFinancial } from "./financial-units";
import type { HamiltonInsight } from "./hamilton-band";
import type { CompareRow } from "./profile-view";

const quarter = (reportDate: string, serviceChargeIncome: number, source = "fdic"): NormalizedFinancial => ({
  reportDate,
  source,
  totalAssets: 4.4e9,
  totalDeposits: null,
  serviceChargeIncome,
  feeIncomeRatioPct: 8.7,
  roaPct: null,
  branchCount: null,
});

const insight = (overrides: Partial<HamiltonInsight> = {}): HamiltonInsight => ({
  quarters: [
    quarter("2026-06-30", 5.7e6),
    quarter("2026-03-31", 5.8e6),
    quarter("2025-12-31", 6.0e6),
    quarter("2025-09-30", 6.1e6),
  ],
  ownSharePct: 8.7,
  peerSharePct: 2.2,
  peerCount: 869,
  filerCount: 900,
  sizeRange: "$1B to $10B",
  kind: "bank",
  ...overrides,
});

const row = (key: string, label: string, amount: number, median: number, extra: Partial<CompareRow> = {}): CompareRow => ({
  key,
  label,
  amount,
  count: 1,
  low: amount,
  high: amount,
  sourceUrl: "https://example.com/schedule.pdf",
  account: null,
  accountPrices: null,
  comparedAt: null,
  highestTier: false,
  excludedCdIra: 0,
  excludedCard: 0,
  waiver: null,
  state: { median, institutions: 120 },
  district: null,
  us: { median, institutions: 2000 },
  missing: null,
  ...extra,
});

const rows: CompareRow[] = [
  row("overdraft", "Overdraft (OD)", 35, 30),
  row("atm_non_network", "Out-of-Network ATM", 3, 2),
  row("monthly_maintenance", "Monthly Maintenance", 8.45, 7.5, { count: 2, low: 7.95, high: 8.95 }),
  row("nsf", "NSF", 0, 30),
];

const build = (overrides: Partial<Parameters<typeof buildConnectedPanel>[0]> = {}) =>
  buildConnectedPanel({
    institutionId: 323,
    institutionName: "Capital City Bank",
    insight: insight(),
    rows,
    stateCode: "FL",
    stateName: "Florida",
    city: "Tallahassee",
    ...overrides,
  });

describe("buildConnectedPanel", () => {
  it("states the trend and the cohort share side by side, without a cause", () => {
    const panel = build();
    expect(panel?.observation).toBe(
      "Service-charge income fell 6.6% from Q3 2025 to Q2 2026, to $5.7M. Its share of revenue, 8.7%, is above the 2.2% median for banks with $1B to $10B in assets.",
    );
    expect(panel?.observation).not.toMatch(/because|due to|driven by|explain/i);
    expect(panel?.caution).toBe("Four quarters are too few to call a trend.");
  });

  it("keeps reported figures apart from calculated comparisons", () => {
    const panel = build();
    expect(panel?.reported).toMatchObject({ source: "FDIC call report", entity: "Bank", sharePct: 8.7 });
    expect(panel?.reported.quarters.map((q) => q.label)).toEqual(["Q3 2025", "Q4 2025", "Q1 2026", "Q2 2026"]);
    expect(panel?.share).toEqual({ own: 8.7, median: 2.2, peers: 869, cohort: "banks with $1B to $10B in assets", direction: "above" });
  });

  it("compares only the three panel fees, labelling a midpoint as a comparison price", () => {
    const fees = build()?.fees ?? [];
    expect(fees.map((fee) => fee.key)).toEqual(["overdraft", "atm_non_network", "monthly_maintenance"]);
    expect(fees[0]).toMatchObject({ label: "Overdraft", amount: "$35", median: "$30", place: "FL", difference: "+$5", direction: "above" });
    expect(fees[2]).toMatchObject({ amount: "$8.45", basis: "Listed at $7.95 to $8.95; we compare the midpoint.", difference: "+$0.95" });
  });

  it("asks questions instead of answering them", () => {
    const questions = build()?.questions ?? [];
    expect(questions).toHaveLength(3);
    for (const question of questions) expect(question.endsWith("?")).toBe(true);
  });

  it("leaves the cohort out when the share is implausible or the cohort is too small", () => {
    expect(build({ insight: insight({ ownSharePct: 0 }) })?.share).toBeNull();
    expect(build({ insight: insight({ peerCount: 2 }) })?.share).toBeNull();
    expect(build({ insight: insight({ peerCount: 2 }) })?.observation).not.toContain("median");
  });

  it("returns nothing without call-report income to connect", () => {
    expect(build({ insight: insight({ quarters: [] }) })).toBeNull();
  });

  it("names a credit union's fee income and filing", () => {
    const panel = build({
      insight: insight({
        kind: "credit union",
        quarters: [quarter("2026-06-30", 500_000, "ncua"), quarter("2026-03-31", 240_000, "ncua")],
      }),
    });
    expect(panel?.reported).toMatchObject({ incomeLabel: "Fee income", source: "NCUA 5300 call report", entity: "Credit union" });
    expect(panel?.reported.quarters.map((q) => q.value)).toEqual([240_000, 260_000]);
    expect(panel?.caution).toBe("Two quarters are too few to call a trend.");
  });

  it("hands Hamilton the institution, cohort, quarter, place and fees", () => {
    const handoff = build()?.handoff;
    expect(handoff).toMatchObject({
      institutionId: 323,
      place: "Tallahassee, Florida",
      quarter: "Q2 2026",
      peerCount: 869,
      sizeRange: "$1B to $10B",
    });
    expect(handoff?.fees[0]).toEqual({ key: "overdraft", label: "overdraft", amount: "$35", against: "the Florida median of $30" });
  });
});
