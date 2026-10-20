import { fullPacketInput } from "./committee-packet.fixture";
import { describe, expect, it } from "vitest";
import {
  buildCommitteePacket,
  footnoteMarks,
  packetSections,
  previousQuarterStart,
  priceAndYield,
  type CommitteePacket,
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

/** Every cell and sentence of the packet that can carry a footnote mark. */
function allText(packet: CommitteePacket): string[] {
  const tables = [packet.position.table, packet.position.changes, packet.financial.trend, packet.financial.normalizedTable, ...packet.appendix].filter(Boolean);
  return [
    packet.brief.conclusion,
    ...packet.brief.findings.map((f) => f.evidence),
    packet.position.comparedNote ?? "",
    packet.financial.trendSummary ?? "",
    ...tables.flatMap((t) => t!.rows.flat()),
  ];
}

describe("buildCommitteePacket: competitive position", () => {
  it("gives one compact row per fee: value, median with N, middle 50%, position and coverage", () => {
    const packet = buildCommitteePacket(input());
    const table = packet.position.table;
    expect(table.columns).toEqual(["Fee", "Capital City Bank", "Peer median (N)", "Peers' middle 50%", "Position", "Coverage"]);
    const [overdraft, stop] = table.rows;
    expect(overdraft[0]).toBe("Overdraft");
    // Several published amounts: the comparison value with the range beside it.
    expect(overdraft[1]).toMatch(/^\$32 \(2 published amounts, \$15 to \$32\) \[\d+\]$/);
    expect(overdraft[2]).toMatch(/^\$30 \(5 peers\) \[\d+\]$/);
    expect(overdraft[3]).toBe("$25 to $36");
    expect(overdraft[4]).toBe("Within the middle 50%; at the 60th percentile");
    expect(overdraft[5]).toBe("5 of 5 peers publish");
    // Nearest peers and per-peer citations are not in this table.
    expect(overdraft.join(" ")).not.toMatch(/U\.S\. Bank|Example Savings Bank/);
    // A fee the bank does not publish, and too few peers: said, never 0.
    expect(stop[1]).toBe("Not found in published schedules");
    expect(stop[2]).toBe("–");
    expect(stop[4]).toBe("Not placed");
    expect(stop[5]).toBe("1 of 5 peers publish");
  });

  it("names a widened group in its row and in the limitations", () => {
    const base = input();
    const widened = { ...base.fees[0], feeCategory: "nsf", peerLabel: "FL · bank peers" };
    const packet = buildCommitteePacket({ ...base, fees: [base.fees[0], widened] });
    expect(packet.position.table.rows[1][0]).toBe("NSF / Returned Item (compared with FL · bank peers)");
    expect(packet.brief.limitations.join(" ")).toContain("NSF / returned item was compared with a wider group");
  });

  it("lists only the packet's peers' confirmed moves, and says so in one line when there are none", () => {
    const packet = buildCommitteePacket(input());
    expect(packet.position.changes?.rows).toHaveLength(1);
    expect(packet.position.changes?.rows[0].slice(0, 4)).toEqual(["M&T Bank", "Overdraft", "$35 to $37 ($2 higher)", "Sep 2, 2026"]);
    const none = buildCommitteePacket(input({ changes: [] }));
    expect(none.position.changes).toBeNull();
    const line = none.unavailable.find((l) => l.startsWith("Peer fee changes"));
    expect(line).toContain("not evidence that peer fees held steady");
  });

  it("never shows missing history as stability", () => {
    const first = buildCommitteePacket(input({ quarterly: { kind: "first", quarter: "2026-Q4" }, changes: [] }));
    expect(first.unavailable).toContain("Quarter-on-quarter changes: Hamilton has one stored copy (Q4 2026); the comparison starts next quarter.");
    const none = buildCommitteePacket(input({ quarterly: null, changes: [] }));
    expect(none.unavailable[0]).toMatch(/^Quarter-on-quarter changes: Hamilton holds no stored quarterly copy/);
    for (const p of [first, none]) {
      expect(p.position.comparedNote).toBeNull();
      expect(JSON.stringify(p)).not.toMatch(/No changes? found|None found|no change recorded/i);
    }
  });

  it("says no change only when two stored copies were compared", () => {
    const diff = (changes: { kind: "peer_median"; feeCategory: string; text: string }[]): CommitteePacketInput["quarterly"] => ({
      kind: "diff",
      diff: {
        institutionId: 323, fromQuarter: "2026-Q3", toQuarter: "2026-Q4",
        fromGeneratedAt: "2026-07-02T00:00:00.000Z", toGeneratedAt: "2026-10-02T00:00:00.000Z",
        fromPeerLabel: "Florida peers", toPeerLabel: "Florida peers",
        changes,
      },
    });
    const moved = buildCommitteePacket(input({ quarterly: diff([{ kind: "peer_median", feeCategory: "overdraft", text: "Overdraft: the peer median moved from $29.00 to $30.00 ($1.00 higher; 5 peers)." }]) }));
    expect(moved.position.changes?.rows[0].slice(0, 4)).toEqual(["Stored quarterly copies", "Overdraft", "Overdraft: the peer median moved from $29.00 to $30.00 ($1.00 higher; 5 peers).", "Q3 2026 to Q4 2026"]);
    const still = buildCommitteePacket(input({ quarterly: diff([]) }));
    expect(still.position.comparedNote).toMatch(/^Stored Q3 2026 and Q4 2026 quarterly copies compared: no change recorded between them .* \[\d+, \d+\]\.$/);
    expect(still.unavailable.some((l) => l.startsWith("Quarter-on-quarter"))).toBe(false);
  });
});

describe("buildCommitteePacket: executive brief", () => {
  it("retains the current policy when every fee compares within the middle 50%", () => {
    const packet = buildCommitteePacket(input());
    expect(packet.brief.conclusion).toMatch(/^On a like-for-like basis, the one fee compared sits within the peers' middle 50%\.$/);
    expect(packet.brief.findings).toEqual([]);
    expect(packet.brief.unresolved).toEqual([]);
    expect(packet.brief.nextStep).toEqual({
      kind: "retain",
      feeCategory: null,
      action: "Retain the current fee policy and monitor these positions at the next review.",
      rationale: "Every fee compared sits within the peers' middle 50%, so the benchmark gives no reason to revisit a price.",
    });
  });

  it("selects the largest like-for-like differences, with no fee type weighted above another", () => {
    const packet = buildCommitteePacket(fullPacketInput());
    // By percentage gap from the median: wire 25%, cashier's check 21%, NSF 20%. A routine fee ranks with a headline one.
    expect(packet.brief.findings.map((f) => f.feeCategory)).toEqual(["wire_domestic_outgoing", "cashiers_check", "nsf"]);
    // Monthly maintenance is listed at several amounts with no single price, so it is not compared.
    expect(packet.brief.conclusion).toMatch(/^On a like-for-like basis, 3 of the 7 fees compared sit outside the peers' middle 50%\. The largest benchmark difference selected for review is outgoing domestic wire: \$30, \$6 \(25%\) above the peer median of \$24 \[\d+, \d+\]\.$/);
    const [wire] = packet.brief.findings;
    expect(wire.statement).toBe("Outgoing domestic wire, at $30, is above all 9 peers.");
    expect(wire.evidence).toMatch(/^\$6 \(25%\) above the peer median of \$24; middle 50% \$22 to \$26; 9 of 12 peers publish it \[\d+, \d+\]$/);
    // The business impact is said to be unknown, never implied by the ranking.
    expect(packet.brief.impact).toContain("Business impact is unknown");
    expect(JSON.stringify(packet.brief)).not.toMatch(/matters most|most material|headline fee/i);
    // Several published amounts keep overdraft (compared at its highest tier) out of the findings until resolved.
    expect(packet.brief.unresolved).toEqual([
      {
        feeCategory: "overdraft",
        fee: "Overdraft",
        position: "$45, above all 12 peers",
        caveats: ["The schedule lists 2 amounts ($15 to $45); the comparison uses $45; another product's amount would change the position."],
      },
    ]);
  });

  it("recommends an investigation for management, never a price", () => {
    const base = input();
    const high = { ...base.fees[0], current: 45, ownRows: [{ amount: 45, sourceDocumentId: 1, documentUrl: null, publishedAt: null }] };
    const packet = buildCommitteePacket({ ...base, fees: [high, base.fees[1]] });
    const [f] = packet.brief.findings;
    // Every limitation that applies is kept: here only the thin peer count.
    expect(f.caveats).toEqual(["Only 5 peers publish it, so one peer's change can move the median."]);
    expect(packet.brief.nextStep).toEqual({
      kind: "investigate",
      feeCategory: "overdraft",
      action: "Before the committee weighs the price, compare the overdraft terms (eligible accounts, waivers, caps) with the nearest peers in Appendix B.",
      rationale: "Different terms may explain the gap. If the terms match, the committee can decide whether to keep the current price; nothing here requires a change.",
    });
    expect(JSON.stringify(packet.brief)).not.toMatch(/\b(raise|lower (it|the fee)|increase|cut|should)\b/i);
  });

  it("asks to resolve a doubtful comparison before anything else", () => {
    const base = input();
    const two = { ...base.fees[0], current: 45, ownRows: [45, 15].map((amount) => ({ amount, sourceDocumentId: 1, documentUrl: null, publishedAt: null })) };
    const packet = buildCommitteePacket({ ...base, fees: [two, base.fees[1]] });
    expect(packet.brief.findings).toEqual([]);
    expect(packet.brief.unresolved.map((u) => u.caveats)).toEqual([["The schedule lists 2 amounts ($15 to $45); the comparison uses $45; another product's amount would change the position.", "Only 5 peers publish it, so one peer's change can move the median."]]);
    expect(packet.brief.conclusion).toMatch(/^On a like-for-like basis, every fee that compares like for like sits within the peers' middle 50%\. Overdraft sits outside it, but the comparison needs resolving first\.$/);
    expect(packet.brief.nextStep?.kind).toBe("resolve");
  });

  it("says so plainly when no fee can be placed", () => {
    const base = input();
    const thin = { ...base.fees[0], peers: base.fees[0].peers.slice(0, 2) };
    const packet = buildCommitteePacket({ ...base, fees: [thin, base.fees[1]] });
    expect(packet.brief.findings).toEqual([]);
    expect(packet.brief.nextStep).toBeNull();
    expect(packet.brief.conclusion).toMatch(/^Capital City Bank publishes 1 of the 2 fees in this packet, but none has 5 or more peers in .* publishing it, so no benchmark difference can be assessed yet\.$/);
  });

  it("states the material limitations once, in one short list", () => {
    const packet = buildCommitteePacket(input());
    const text = packet.brief.limitations.join("\n");
    expect(text).toContain("Coverage: stop payment is not on Capital City Bank's published schedule in the index.");
    expect(text).toContain("History: no stored quarterly copy");
    expect(text).toContain("Comparability: each institution counts once per fee");
    // Overdraft is the one fee still compared from several amounts: its highest tier (#1930).
    expect(text).toContain("Overdraft has several published amounts at Capital City Bank (Appendix C)");
    expect(packet.brief.limitations.length).toBeLessThanOrEqual(6);
  });

  describe("a fee published at several amounts, with no single price", () => {
    // Since #1930 a fee other than overdraft with several different amounts has no comparison
    // value, so it arrives with `current: null` and its rows in `ownRows`.
    const nsfPeers = [
      peer(5, "U.S. Bank", 34, 501),
      peer(21, "M&T Bank", 30, 2101),
      peer(4956, "Navy Federal Credit Union", 29, 495601),
      peer(6741, "SchoolsFirst Federal Credit Union", 25, 674101),
      peer(9001, "Example Savings Bank", 32, 900101),
    ];
    const nsf = {
      feeCategory: "nsf",
      current: null,
      peerLabel: "Florida peers",
      peers: nsfPeers,
      ownRows: [15, 35, 25].map((amount) => ({ amount, sourceDocumentId: 32377, documentUrl: "https://example.test/ccb-nsf.pdf", publishedAt: "2026-10-01T00:00:00.000Z" })),
    };
    const base = input();
    const packet = buildCommitteePacket({ ...base, fees: [base.fees[0], nsf, base.fees[1]] });
    const nsfRow = (table: { rows: string[][] }) => table.rows.find((row) => /NSF/.test(row[0]))!;

    it("never calls it missing from the schedule", () => {
      const text = packet.brief.limitations.join("\n");
      expect(text).toContain("Coverage: stop payment is not on Capital City Bank's published schedule in the index.");
      expect(text).not.toMatch(/NSF[^.]* (?:is|are) not on Capital City Bank's published schedule/);
      expect(JSON.stringify(packet)).not.toMatch(/NSF[^"]*Not found/);
    });

    it("shows the published range with the bank's schedule cited", () => {
      const row = nsfRow(packet.position.table);
      expect(row[1]).toMatch(/^\$15 to \$35 \(3 published amounts, no single price\) \[\d+\]$/);
      expect(row[4]).toBe("Not placed: no single price");
      const mark = Number(row[1].match(/\[(\d+)\]$/)![1]);
      const note = packet.footnotes.find((f) => f.n === mark)!;
      expect(`${note.label} ${note.detail} ${note.url}`).toMatch(/Capital City Bank/);
      const matrix = packet.appendix.find((t) => t.id === "peer_fee_matrix")!;
      const nsfColumn = matrix.columns.findIndex((c) => /NSF/.test(c));
      expect(matrix.rows[0][nsfColumn]).toBe("$15 to $35");
      const bar = packet.position.bars.find((b) => b.feeCategory === "nsf")!;
      expect(bar.current).toBeNull();
      expect(bar.ownRange).toBe("$15 to $35");
      expect(bar.marks).toMatch(new RegExp(`\\b${mark}\\b`));
    });

    it("says once that no single price can be placed, and counts the fee as published", () => {
      const text = packet.brief.limitations.join("\n");
      expect(text).toContain("Capital City Bank's schedule lists NSF / returned item at 3 amounts, $15 to $35 (Appendix C). With no single price, it is not placed against the peers.");
      expect(text).not.toContain("NSF / returned item has several published amounts");
      expect(packet.glance.published).toBe(2);
      expect(packet.glance.placed).toBe(1);
    });
  });

  it("drops the watched-fee label when no fees are saved", () => {
    const published = buildCommitteePacket(input({ feeListSource: "published" }));
    expect(published.feeListNote).toBe("Fees in this packet: the institution's published fees, overdraft and NSF first (up to 10).");
    expect(JSON.stringify(published)).not.toMatch(/watched fee/i);
    expect(buildCommitteePacket(input()).feeListNote).toBe("Fees in this packet: the fees saved on your watchlist.");
  });
});

describe("buildCommitteePacket: financial context", () => {
  it("prints the filed income trend with the peer median's filer count", () => {
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
    const trend = packet.financial.trend!;
    expect(trend.rows[0]).toEqual(["Jun 30, 2026", expect.stringMatching(/^\$4\.2 million \[\d+\]$/), expect.stringMatching(/^\$2\.5 million \(median of 412 filers\) \[\d+\]$/)]);
    expect(trend.rows[1][2]).toBe("Not found in filings");
    expect(packet.financial.trendSummary).toMatch(/^Fewer than four quarters on file/);
  });

  it("gives one normalized comparison with its denominator and says it is context only", () => {
    const packet = buildCommitteePacket(input());
    const n = packet.financial.normalized!;
    expect(n).toMatchObject({ quarter: "2026-06-30", own: 4.5, peersCompared: 5, median: 3, q1: 2.1, q3: 5.2 });
    expect(n.definition).toContain("divided by total assets in the same filing, times 10,000. Denominator: total assets as filed, not deposits.");
    expect(packet.financial.context).toMatch(/^This is context, not a measure of pricing effectiveness, customer burden or revenue opportunity/);
    expect(packet.financial.normalizedTable?.rows[0]).toEqual(["Capital City Bank", expect.stringMatching(/^\$4\.50 \[\d+\]$/)]);
  });

  it("turns missing filings into availability lines, not empty exhibits", () => {
    const packet = buildCommitteePacket(input({ income: [], rules: [] }));
    expect(packet.financial.trend).toBeNull();
    expect(packet.financial.normalizedTable).toBeNull();
    expect(packet.unavailable).toEqual(expect.arrayContaining([
      "Filed fee income trend: no FDIC call report or NCUA 5300 service charge income on file for Capital City Bank.",
      "Service charge income per $10,000 of total assets: no filing on file for this institution or its peers in this packet.",
      "Rules, bills and enforcement actions: none on file that bear on these fees.",
    ]));
    expect(packet.appendix.map((t) => t.id)).toEqual(["peer_fee_matrix", "nearest_peers", "product_details"]);
  });
});

describe("buildCommitteePacket: appendix and sources", () => {
  it("holds the full matrix, nearest peers, product details and price and yield, lettered", () => {
    const packet = buildCommitteePacket(input());
    const sections = packetSections(packet);
    expect(sections.appendix.map((l) => `${l.label} ${l.table.id}`)).toEqual([
      "Appendix A peer_fee_matrix", "Appendix B nearest_peers", "Appendix C product_details", "Appendix E price_and_yield",
    ]);
    // Exhibits run in the brief's reading order: each fee, then income per $10,000 of assets, then the rest.
    expect(sections.position.map((l) => l.label)).toEqual(["Exhibit 1", "Exhibit 3"]);
    expect(sections.financial.find((l) => l.table.id === "normalized_income")?.label).toBe("Exhibit 2");
    const nearest = packet.appendix.find((t) => t.id === "nearest_peers")!;
    expect(nearest.rows[0][2]).toMatch(/^\$30: Example Savings Bank \[\d+\]$/);
    expect(nearest.rows[0][3]).toMatch(/^\$36: U\.S\. Bank \[\d+\]$/);
    expect(nearest.columns).toEqual(["Fee", "This institution", "Nearest below", "Nearest above", "Peers' amounts"]);
    expect(nearest.rows[0][4]).toBe("3 lower, 0 the same, 2 higher");
    // No schedule wording on these rows: the index's display names, never raw keys.
    const products = packet.appendix.find((t) => t.id === "product_details")!;
    expect(products.columns[1]).toBe("Listed in the index as");
    expect(products.rows[0][1]).toBe("Overdraft");
    // Per-$10,000 figures to the cent, each row sourced.
    const normalized = packet.financial.normalizedTable!;
    expect(normalized.rows.find((r) => r[0] === "Peers' middle 50%")?.[1]).toMatch(/^\$2\.10 to \$5\.20 \[\d+\]$/);
    const matrix = packet.appendix.find((t) => t.id === "peer_fee_matrix")!;
    expect(matrix.rows[0][0]).toBe("Capital City Bank");
    expect(matrix.rows.find((r) => r[0] === "M&T Bank")?.[2]).toBe("Not found");
  });

  it("numbers every source once and every mark resolves to a listed source", () => {
    const packet = buildCommitteePacket(input());
    const ccb = packet.footnotes.find((f) => f.label === "Capital City Bank, published fee schedule")!;
    expect(ccb.detail).toBe("published Oct 1, 2026");
    expect(ccb.url).toBe("https://example.test/ccb.pdf");
    expect(packet.footnotes.filter((f) => f.label === "U.S. Bank, published fee schedule")).toHaveLength(1);
    expect(packet.footnotes.map((f) => f.n)).toEqual(packet.footnotes.map((_, i) => i + 1));
    const used = allText(packet).flatMap(footnoteMarks);
    expect(used.length).toBeGreaterThan(0);
    for (const n of used) expect(n).toBeLessThanOrEqual(packet.footnotes.length);
    // Every listed source is cited somewhere.
    for (const f of packet.footnotes) expect(used).toContain(f.n);
  });

  it("recommends no fee and names no internal agent or plan", () => {
    const text = JSON.stringify(buildCommitteePacket(input()));
    expect(text).not.toMatch(/you should|we recommend|consider raising|consider lowering|Position check/i);
    expect(text).not.toMatch(/Hamilton Pro|Knox|Darwin|Magellan|Rosetta|Atlas|Frost/);
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

describe("previousQuarterStart", () => {
  it("is the first day of the quarter before", () => {
    expect(previousQuarterStart("2026-10-17T00:00:00.000Z")).toBe("2026-07-01");
    expect(previousQuarterStart("2027-02-01T00:00:00.000Z")).toBe("2026-10-01");
  });
});
