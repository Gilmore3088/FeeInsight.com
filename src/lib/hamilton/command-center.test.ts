import { describe, expect, it } from "vitest";
import { buildCommandCenter, commandCenterQuarter, type CommandCenterInput } from "./command-center";
import type { FinancialPerformanceView, FinancialQuarter } from "./financial-quarters";
import type { BriefingDiff } from "./workspace/briefing-diff";
import type { Briefing, FeePositionRow, Observation } from "./workspace/types";

const INST = { id: 9701940, name: "Harbor Ridge Test Bank" };

function row(feeCategory: string, current: number, band: FeePositionRow["band"]): FeePositionRow {
  return { feeCategory, displayName: feeCategory, current, band, peerLabel: "Ohio banks, $1B to $10B" };
}

const band = (p25: number, median: number, p75: number) => ({ p25, median, p75, n: 24 });

function observation(kind: Observation["kind"], headline: string, feeCategory: string | null = null): Observation {
  return { id: `${kind}:${headline}`, kind, feeCategory, headline, facts: [], actions: [], salience: 1 };
}

function briefing(overrides: Partial<Briefing> = {}): Briefing {
  return {
    institutionId: INST.id,
    institutionName: INST.name,
    stateCode: "OH",
    observations: [],
    institutionFinancials: null,
    nationalIncome: null,
    nationalIncomeSeries: [],
    feesReviewed: 4,
    positions: [
      row("overdraft", 35, band(28, 30, 33)),
      row("nsf", 30, band(25, 30, 34)),
      row("monthly_maintenance", 4, band(5, 8, 10)),
      row("wire_domestic_outgoing", 25, null),
    ],
    peerLabel: "Ohio banks, $1B to $10B",
    generatedAt: "2026-10-20T12:00:00Z",
    provenance: { engineVersion: "1.22.0", generatedAt: "2026-10-20T12:00:00Z", dataAsOf: {}, sources: [], assumptions: [], clientFacts: [] },
    ...overrides,
  };
}

function quarter(reportDate: string, label: string, fee: number | null, extra: Partial<FinancialQuarter["fee"]> = {}): FinancialQuarter {
  return {
    reportDate,
    key: label,
    label,
    fee: { value: fee, qoqPct: 3.2, yoyPct: 6.1, peerMedian: 1710, peers: 12, yearToDate: null, ...extra },
    deposits: { value: 2_120_000, qoqPct: 1, yoyPct: 4.4, peerMedian: null, peers: 12 },
    assets: { value: 2_480_000, qoqPct: 1, yoyPct: 4, peerMedian: null, peers: 12 },
    evidence: { entity: INST.name, regulator: "FDIC", form: "FFIEC call report", quarterEnd: reportDate, retrievedAt: null, sourceUrl: null, variables: [], calculation: "", heldReason: null },
  };
}

function financials(quarters: FinancialQuarter[] = [quarter("2026-06-30", "Q2 2026", 2013)]): FinancialPerformanceView {
  return { source: "fdic", institutionName: INST.name, quarters, short: false };
}

function diff(changes: BriefingDiff["changes"]): CommandCenterInput["changes"] {
  return {
    kind: "diff",
    diff: {
      institutionId: INST.id,
      fromQuarter: "2026-Q3",
      toQuarter: "2026-Q4",
      fromGeneratedAt: "2026-07-03T12:00:00Z",
      toGeneratedAt: "2026-10-02T12:00:00Z",
      fromPeerLabel: "Ohio banks, $1B to $10B",
      toPeerLabel: "Ohio banks, $1B to $10B",
      changes,
    },
  };
}

function input(overrides: Partial<CommandCenterInput> = {}): CommandCenterInput {
  return { institution: INST, briefing: briefing(), financials: financials(), changes: null, stateLabel: "Ohio", windowDays: 180, ...overrides };
}

const byKey = (answers: ReturnType<typeof buildCommandCenter>, key: string) => answers.find((a) => a.key === key)!;

describe("buildCommandCenter (#1891)", () => {
  it("answers the five questions in order, each linking into the page behind it with the institution kept", () => {
    const answers = buildCommandCenter(input());
    expect(answers.map((a) => a.key)).toEqual(["performance", "change", "peers", "market", "next"]);
    const hrefs = answers.flatMap((a) => a.links.map((l) => l.href));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        `/pro/financials?instId=${INST.id}`,
        `/pro/peers?instId=${INST.id}`,
        `/pro/monitor?instId=${INST.id}`,
        `/pro/news?instId=${INST.id}`,
        `/pro/reports?intent=executive-briefing&instId=${INST.id}`,
      ]),
    );
  });

  it("states the newest filed quarter with its filing and period", () => {
    const performance = byKey(buildCommandCenter(input()), "performance");
    expect(performance.lines[0]).toBe(
      "Deposit service charges in Q2 2026 were $2.0 million, up 6.1% on Q2 2025. The peer group median was $1.7 million across 12 institutions.",
    );
    expect(performance.source).toMatch(/^FDIC call report, Q2 2026/);
    expect(commandCenterQuarter(financials())).toBe("Q2 2026");
  });

  it("says so when no quarter is filed, with no figure", () => {
    const performance = byKey(buildCommandCenter(input({ financials: null })), "performance");
    expect(performance.lines[0]).toMatch(/No filed quarter/);
    expect(performance.source).toBeNull();
    expect(commandCenterQuarter(null)).toBeNull();
  });

  it("counts unconfirmed own fee moves as data updates, never as price changes (V5 P5 acceptance)", () => {
    const change = byKey(
      buildCommandCenter(
        input({
          changes: diff([
            { kind: "own_record", feeCategory: "overdraft", text: "Overdraft: the figure on file moved from $30.00 to $35.00.", amounts: { from: 30, to: 35, feeName: "Overdraft" } },
            { kind: "fee_added", feeCategory: "nsf", text: "NSF: added to the fees on file at $30.00." },
            { kind: "peer_median", feeCategory: "nsf", text: "NSF: the peer median moved." },
          ]),
        }),
      ),
      "change",
    );
    const text = change.lines.join(" ");
    expect(text).toContain("No price change on its published schedules is confirmed since Q3 2026.");
    expect(text).toContain("2 fee figures on file changed without a confirmed price change; these are updates to our data, not price changes by Harbor Ridge Test Bank.");
    expect(text).not.toMatch(/raised|lowered|moved from \$30/);
  });

  it("names a confirmed own price change as one", () => {
    const confirmed = "Overdraft: its price changed from $30.00 to $35.00 ($5.00 higher), confirmed against its published schedules and recorded Sep 2, 2026.";
    const change = byKey(
      buildCommandCenter(input({ changes: diff([{ kind: "own_price", feeCategory: "overdraft", text: confirmed, amounts: { from: 30, to: 35, feeName: "Overdraft" } }]) })),
      "change",
    );
    expect(change.lines).toContain(`1 confirmed price change on its published schedules since Q3 2026. ${confirmed}`);
    expect(change.lines.join(" ")).not.toContain("updates to our data");
    expect(change.source).toContain("briefings saved Jul 3, 2026 and Oct 2, 2026");
  });

  it("before a second quarterly copy, says when changes start", () => {
    const change = byKey(buildCommandCenter(input({ changes: { kind: "first", quarter: "2026-Q4" } })), "change");
    expect(change.lines).toContain("Fee changes are listed from Q1 2027, once a second quarterly copy of this briefing is saved.");
  });

  it("places only fees with enough peers, and names local competitors", () => {
    const peers = byKey(
      buildCommandCenter(
        input({
          briefing: briefing({
            localMarket: {
              info: {} as never,
              rows: [
                { institutionId: INST.id, name: INST.name, own: true, marketDeposits: null, values: {} },
                ...["Maple Test Bank", "Riverbend Test Bank", "Oakfield Test CU", "Stone Test Bank"].map((name, i) => ({
                  institutionId: i + 1,
                  name,
                  own: false,
                  marketDeposits: null,
                  values: {},
                })),
              ],
            },
          }),
        }),
      ),
      "peers",
    );
    expect(peers.lines).toEqual([
      "Of 3 fees compared with its peer group (Ohio banks, $1B to $10B), 1 sits within the middle half of peer prices, 1 above it and 1 below.",
      "1 fee is not placed, as fewer than 10 peers publish it.",
      "Local competitors on file: Maple Test Bank, Riverbend Test Bank, Oakfield Test CU and 1 other.",
    ]);
    expect(peers.source).toContain("verified and live, read Oct 20, 2026");
  });

  it("says when no rule item is flagged, and points to the Regulatory Wire", () => {
    const market = byKey(buildCommandCenter(input()), "market");
    expect(market.lines[1]).toBe("No regulator release bearing on its fees is flagged in this month's briefing; the Regulatory Wire lists every recent item.");
  });

  it("reports confirmed state moves and the first rule item, with their period", () => {
    const market = byKey(
      buildCommandCenter(
        input({
          briefing: briefing({
            observations: [
              observation("competitor_move", "Maple Test Bank changed its overdraft fee", "overdraft"),
              observation("rule_change", "The CFPB published a rule on overdraft fees on Sep 30, 2026."),
            ],
          }),
        }),
      ),
      "market",
    );
    expect(market.lines).toEqual([
      "1 fee Harbor Ridge Test Bank publishes changed at an institution in Ohio in the last 180 days, each confirmed on that institution's schedules.",
      "The CFPB published a rule on overdraft fees on Sep 30, 2026.",
    ]);
    expect(market.source).toBe("Fee changes confirmed on published schedules, Ohio, last 180 days to Oct 20, 2026.");
  });

  it("points to the briefing's first item and always offers the quarter's brief", () => {
    const next = byKey(
      buildCommandCenter(input({ briefing: briefing({ observations: [observation("market_position", "Its overdraft fee is in the top 10% of peers", "overdraft")] }) })),
      "next",
    );
    expect(next.lines[0]).toMatch(/overdraft fee is in the top 10% of peers/);
    expect(next.links.map((l) => l.label)).toEqual(["Research this fee", "Build this quarter's brief"]);
    const quiet = byKey(buildCommandCenter(input()), "next");
    expect(quiet.lines[0]).toBe("Nothing in this month's briefing stands out for a closer look.");
    expect(quiet.links.map((l) => l.label)).toEqual(["Build this quarter's brief"]);
  });

  it("writes no em dash, no internal agent name and never calls the institution yours", () => {
    const text = JSON.stringify(buildCommandCenter(input({ changes: { kind: "first", quarter: "2026-Q4" } })));
    expect(text).not.toMatch(/—|Knox|Darwin|Magellan|Rosetta|Atlas|Gutenberg|Hoovie|Deming|Hamilton Pro|\byour\b/i);
  });
});
