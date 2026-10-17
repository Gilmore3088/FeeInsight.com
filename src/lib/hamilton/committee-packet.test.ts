import { describe, expect, it } from "vitest";
import {
  buildCommitteePacket,
  committeePacketReport,
  previousQuarterStart,
  priceAndYield,
  type CommitteePacketInput,
} from "./committee-packet";
import type { PeerValue } from "./workspace/types";

function peer(id: number, name: string, amount: number, doc: number, publishedAt = "2026-09-20T00:00:00.000Z"): PeerValue {
  return { institutionId: id, institutionName: name, amount, stateCode: "FL", sourceDocumentIds: [doc], documentUrls: [`https://example.test/${doc}.pdf`], publishedAt };
}

const overdraftPeers = [
  peer(5, "U.S. Bank", 36, 501),
  peer(21, "M&T Bank", 37, 2101),
  peer(4956, "Navy Federal Credit Union", 20, 495601),
  peer(6741, "SchoolsFirst Federal Credit Union", 25, 674101),
  peer(9001, "Example Savings Bank", 30, 900101, "2026-08-02T00:00:00.000Z"),
];

function input(over: Partial<CommitteePacketInput> = {}): CommitteePacketInput {
  return {
    institutionId: 323,
    institutionName: "Capital City Bank",
    generatedAt: "2026-10-17T12:00:00.000Z",
    peerSetLabel: "Florida peers",
    feeListSource: "watchlist",
    fees: [
      {
        feeCategory: "overdraft",
        current: 32,
        peerLabel: "Florida peers",
        peers: overdraftPeers,
        ownRows: [
          { amount: 32, sourceDocumentId: 32301, documentUrl: "https://example.test/ccb.pdf", publishedAt: "2026-10-01T00:00:00.000Z" },
          { amount: 15, sourceDocumentId: 32301, documentUrl: "https://example.test/ccb.pdf", publishedAt: "2026-10-01T00:00:00.000Z" },
        ],
      },
      { feeCategory: "stop_payment", current: null, peerLabel: "Florida peers", peers: [peer(5, "U.S. Bank", 35, 501)], ownRows: [] },
    ],
    quarterly: null,
    changesSince: "2026-07-01",
    changes: [
      { institutionId: 21, institutionName: "M&T Bank", feeCategory: "overdraft", oldAmount: 35, newAmount: 37, changedAt: "2026-09-02T00:00:00.000Z", scheduleUrl: "https://example.test/2101.pdf" },
      // Not a peer in this packet: left out.
      { institutionId: 77, institutionName: "Other Bank", feeCategory: "overdraft", oldAmount: 30, newAmount: 34, changedAt: "2026-09-03T00:00:00.000Z", scheduleUrl: null },
    ],
    financials: null,
    rules: [],
    income: [
      { institutionId: 323, institutionName: "Capital City Bank", reportDate: "2026-06-30", source: "fdic", serviceChargeIncomeThousands: 4200, incomePer10kAssets: 4.5 },
      { institutionId: 5, institutionName: "U.S. Bank", reportDate: "2026-06-30", source: "fdic", serviceChargeIncomeThousands: 300000, incomePer10kAssets: 2.1 },
      { institutionId: 21, institutionName: "M&T Bank", reportDate: "2026-06-30", source: "fdic", serviceChargeIncomeThousands: 110000, incomePer10kAssets: 5.2 },
      { institutionId: 4956, institutionName: "Navy Federal Credit Union", reportDate: "2026-06-30", source: "ncua", serviceChargeIncomeThousands: 90000, incomePer10kAssets: 6.0 },
      { institutionId: 6741, institutionName: "SchoolsFirst Federal Credit Union", reportDate: "2026-06-30", source: "ncua", serviceChargeIncomeThousands: 8000, incomePer10kAssets: 1.9 },
      { institutionId: 9001, institutionName: "Example Savings Bank", reportDate: "2026-06-30", source: "fdic", serviceChargeIncomeThousands: 700, incomePer10kAssets: 3.0 },
    ],
    ...over,
  };
}

describe("buildCommitteePacket", () => {
  it("puts each watched fee against its peers with a sourced median of N peers and the named neighbours", () => {
    const packet = buildCommitteePacket(input());
    const positions = packet.exhibits.find((e) => e.id === "peer_range")!;
    const [overdraft, stop] = positions.rows;
    expect(overdraft[0]).toBe("Overdraft");
    // Several published amounts: labelled the comparison value, with the range shown.
    expect(overdraft[1]).toMatch(/^\$32 \(comparison value; 2 published amounts, \$15 to \$32\) \[\d+\]$/);
    expect(overdraft[3]).toMatch(/^\$30, median of 5 peers \[\d+\]$/);
    expect(overdraft[4]).toContain("at the 60th percentile of 5 peers; 3 charge less, 0 the same, 2 more");
    expect(overdraft[5]).toMatch(/^\$30: Example Savings Bank \[\d+\]$/);
    expect(overdraft[6]).toMatch(/^\$36: U\.S\. Bank \[\d+\]$/);
    // A fee the bank does not publish, and too few peers: said, never 0.
    expect(stop[1]).toBe("Not found in published schedules");
    expect(stop[3]).toBe("Too few peers (1)");
  });

  it("numbers every source once and ties each institution's schedule to its documents and dates", () => {
    const packet = buildCommitteePacket(input());
    const ccb = packet.footnotes.find((f) => f.label === "Capital City Bank, published fee schedule")!;
    expect(ccb.detail).toBe("document 32301 · published Oct 1, 2026");
    expect(ccb.url).toBe("https://example.test/ccb.pdf");
    const usBank = packet.footnotes.filter((f) => f.label === "U.S. Bank, published fee schedule");
    expect(usBank).toHaveLength(1);
    expect(packet.footnotes.map((f) => f.n)).toEqual(packet.footnotes.map((_, i) => i + 1));
    // Every footnote number used in a cell resolves to a listed source.
    const used = packet.exhibits.flatMap((e) => e.rows.flat()).flatMap((c) => [...c.matchAll(/\[(\d+(?:, \d+)*)\]/g)].flatMap((m) => m[1].split(", ").map(Number)));
    expect(used.length).toBeGreaterThan(0);
    for (const n of used) expect(n).toBeLessThanOrEqual(packet.footnotes.length);
  });

  it("lists only the packet's peers' moves, each with its schedule, and says None found otherwise", () => {
    const moves = buildCommitteePacket(input()).exhibits.find((e) => e.id === "competitor_moves")!;
    expect(moves.rows).toHaveLength(1);
    expect(moves.rows[0].slice(0, 4)).toEqual(["M&T Bank", "Overdraft", "$35 to $37 ($2 higher)", "Sep 2, 2026"]);
    expect(moves.note).toContain("no stored quarterly copy");
    const none = buildCommitteePacket(input({ changes: [] })).exhibits.find((e) => e.id === "competitor_moves")!;
    expect(none.rows).toEqual([]);
    expect(none.empty).toBe("None found");
  });

  it("compares the stored quarterly copies when two exist", () => {
    const moves = buildCommitteePacket(input({
      quarterly: {
        kind: "diff",
        diff: {
          institutionId: 323, fromQuarter: "2026-Q3", toQuarter: "2026-Q4",
          fromGeneratedAt: "2026-07-02T00:00:00.000Z", toGeneratedAt: "2026-10-02T00:00:00.000Z",
          fromPeerLabel: "Florida peers", toPeerLabel: "Florida peers",
          changes: [{ kind: "peer_median", feeCategory: "overdraft", text: "Overdraft: the peer median moved from $29.00 to $30.00 ($1.00 higher; 5 peers)." }],
        },
      },
    })).exhibits.find((e) => e.id === "competitor_moves")!;
    expect(moves.rows[0].slice(0, 4)).toEqual(["Quarterly copies compared", "Overdraft", "Overdraft: the peer median moved from $29.00 to $30.00 ($1.00 higher; 5 peers).", "Q3 2026 to Q4 2026"]);
    expect(moves.subtitle).toContain("Q3 2026 and Q4 2026 copies compared");
  });

  it("says once when filings, rules or a quarterly copy are missing", () => {
    const packet = buildCommitteePacket(input());
    expect(packet.exhibits.find((e) => e.id === "fee_income_trend")!.empty).toBe("Not found in filings");
    expect(packet.exhibits.find((e) => e.id === "regulatory")!.empty).toBe("None found");
  });

  it("prints the filed income trend with the peer median's population", () => {
    const packet = buildCommitteePacket(input({
      financials: {
        source: "fdic", label: "Service charges on deposit accounts (FDIC call report)",
        quarters: [{ quarterEnd: "2026-06-30", amount: 4_200_000 }, { quarterEnd: "2026-03-31", amount: 4_000_000 }],
        latestTtm: null, priorTtm: null, yoyPct: null, quarterEnd: "2026-06-30",
        sourceRef: { label: "Service charges on deposit accounts (FDIC call report)", table: "institution_financial_records", asOf: "2026-06-30" },
        peerMedian: {
          label: "Banks, $1B to $10B in assets",
          quarters: [{ quarterEnd: "2026-06-30", amount: 2_500_000, institutions: 412 }],
          sourceRef: { label: "FDIC call report filers, Banks, $1B to $10B in assets, median quarterly service charges", table: "institution_financial_records", asOf: "2026-06-30" },
        },
      },
    }));
    const trend = packet.exhibits.find((e) => e.id === "fee_income_trend")!;
    expect(trend.rows[0]).toEqual(["Jun 30, 2026", expect.stringMatching(/^\$4\.2 million \[\d+\]$/), expect.stringMatching(/^\$2\.5 million, median of 412 filers \[\d+\]$/)]);
    expect(trend.rows[1][2]).toBe("Not found in filings");
  });

  it("places a proposed fee only when the reader entered one, with no advice", () => {
    expect(buildCommitteePacket(input()).positionCheck).toBeNull();
    const packet = buildCommitteePacket(input({ proposed: { feeCategory: "overdraft", amount: 35 } }));
    expect(packet.positionCheck?.check).toMatchObject({ n: 5, less: 3, more: 2, percentile: 60 });
    const text = JSON.stringify(packet);
    expect(text).not.toMatch(/you should|we recommend|consider raising|consider lowering/i);
    expect(text).not.toMatch(/Hamilton Pro|Knox|Darwin|Magellan|Rosetta|Atlas/);
  });
});

describe("priceAndYield", () => {
  it("sets each peer's fee beside its filed income in one quarter and reads it against the medians", () => {
    const py = priceAndYield(input())!;
    expect(py.quarter).toBe("2026-06-30");
    expect(py.peersCompared).toBe(5);
    expect(py.medianFee).toBe(30);
    expect(py.medianIncome).toBe(3);
    expect(py.points[0]).toMatchObject({ institutionId: 323, own: true, fee: 32, reading: null });
    const reading = new Map(py.points.map((p) => [p.name, p.reading]));
    expect(reading.get("U.S. Bank")).toBe("fee_high_income_low");
    expect(reading.get("Navy Federal Credit Union")).toBe("fee_low_income_high");
    expect(reading.get("M&T Bank")).toBeNull();
  });

  it("leaves out a filer from another quarter and gives no medians below five peers", () => {
    const rows = input().income.map((r) => (r.institutionId === 9001 ? { ...r, reportDate: "2026-03-31" } : r));
    const py = priceAndYield(input({ income: rows }))!;
    expect(py.points.some((p) => p.institutionId === 9001)).toBe(false);
    expect(py.medianFee).toBeNull();
  });
});

describe("committeePacketReport", () => {
  it("prints the same exhibits, lists findings and no actions, and footnotes as numbered sources", () => {
    const packet = buildCommitteePacket(input());
    const report = committeePacketReport(packet);
    expect(report.answer?.decisions).toEqual([]);
    expect(report.exhibits?.map((e) => e.id)).toEqual(["peer_range", "peer_fee_matrix", "competitor_moves", "fee_income_trend", "regulatory", "price_and_yield"]);
    expect(report.exhibits?.find((e) => e.id === "regulatory")?.rows).toEqual([["None found", "", ""]]);
    expect(report.sources?.[0]?.label).toMatch(/^\[1\] /);
  });
});

describe("previousQuarterStart", () => {
  it("is the first day of the quarter before", () => {
    expect(previousQuarterStart("2026-10-17T00:00:00.000Z")).toBe("2026-07-01");
    expect(previousQuarterStart("2027-02-01T00:00:00.000Z")).toBe("2026-10-01");
  });
});
