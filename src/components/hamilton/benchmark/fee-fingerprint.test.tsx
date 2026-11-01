import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FeeFingerprint, FingerprintStrip } from "@/lib/hamilton/fee-fingerprint";
import { FeeFingerprintView, peerMarks, periodText, stripNote } from "./FeeFingerprint";

const blank: FingerprintStrip = {
  feeCategory: "overdraft",
  feeName: "Overdraft",
  status: "placed",
  current: 29,
  currentLabel: "$29.00",
  peerCount: 12,
  peerAmounts: [20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 32],
  band: { p25: 22.75, median: 25.5, p75: 28.5 },
  percentile: 71,
  namedPeers: [],
  period: { from: "2026-03-04", to: "2026-10-01" },
};

const fingerprint: FeeFingerprint = {
  institutionName: "Capital City Bank",
  peerLabel: "Team peers",
  saved: true,
  minPeers: 10,
  source: "Fees on each institution's own published schedule, verified against that schedule (Bank Fee Index)",
  strips: [
    blank,
    {
      ...blank,
      feeCategory: "nsf",
      feeName: "NSF",
      status: "few_peers",
      peerCount: 2,
      peerAmounts: [25, 30],
      band: null,
      percentile: null,
      namedPeers: [
        { institutionId: 1, institutionName: "First Bank", amount: 25 },
        { institutionId: 2, institutionName: "Second CU", amount: 30 },
      ],
      period: { from: "2026-09-01", to: "2026-09-20" },
    },
    { ...blank, feeCategory: "stop_payment", feeName: "Stop Payment", status: "not_published", current: null, currentLabel: null, percentile: null },
  ],
};

describe("FeeFingerprint", () => {
  it("leads with the count the marks use and says why sister charters make more names (#1896)", () => {
    const few = fingerprint.strips[1];
    expect(stripNote(few, fingerprint)).toMatch(/^Only 2 institutions publish this fee in the group, fewer than the 10 needed for a median\. First Bank \$25; Second CU \$30\./);
    // Four named, three counted: Harbor Bank and Harbor Bank North share one schedule.
    const sisters: FingerprintStrip = {
      ...few,
      peerCount: 3,
      peerAmounts: [25, 30, 32],
      namedPeers: [
        { institutionId: 1, institutionName: "First Bank", amount: 25 },
        { institutionId: 3, institutionName: "Harbor Bank", amount: 30 },
        { institutionId: 4, institutionName: "Harbor Bank North", amount: 30, countedAs: 3 },
        { institutionId: 2, institutionName: "Second CU", amount: 32 },
      ],
    };
    const note = stripNote(sisters, fingerprint);
    expect(note).toMatch(/^Only 3 institutions publish this fee in the group, fewer than the 10 needed for a median\./);
    expect(note).toContain("Institutions that share one fee schedule count once, so 4 are named.");
    expect(note).toContain("First Bank $25; Harbor Bank $30; Harbor Bank North $30; Second CU $32.");
    expect(note).not.toMatch(/Only 4 institutions/);
  });

  it("names a peer that states several amounts by its range, not the median it counts at", () => {
    const few = fingerprint.strips[1];
    const several: FingerprintStrip = {
      ...few,
      namedPeers: [
        { institutionId: 1, institutionName: "First Bank", amount: 25 },
        {
          institutionId: 2,
          institutionName: "Second CU",
          amount: 30,
          several: { low: 25, high: 35, fees: [{ name: "Paper", amount: 35 }, { name: "Online", amount: 25 }] },
        },
      ],
    };
    expect(stripNote(several, fingerprint)).toContain("Second CU $25 to $35");
  });

  it("gives each placed strip its peer count, median, percentile, source and period", () => {
    expect(stripNote(blank, fingerprint)).toBe(
      "12 institutions: median $25.50, middle half $22.75 to $28.50; 71st percentile. Source: published fee schedules, Mar 2026 to Oct 2026.",
    );
  });

  it("says lowest or highest in the group rather than the 0th or 100th percentile", () => {
    expect(stripNote({ ...blank, percentile: 0 }, fingerprint)).toContain("; lowest in the group.");
    expect(stripNote({ ...blank, percentile: 100 }, fingerprint)).toContain("; highest in the group.");
  });

  it("keeps a fee stated as a rate off the dollar strip", () => {
    const note = stripNote({ ...blank, status: "stated_as_rate", current: null, currentLabel: "1.1% of the transaction", percentile: null, band: null }, fingerprint);
    expect(note).toMatch(/^Stated as a rate \(1\.1% of the transaction\), so it is not placed among dollar prices\./);
  });

  it("labels a rate stated only for business accounts as business, never as missing (#1896)", () => {
    const rate: FingerprintStrip = { ...blank, feeCategory: "card_foreign_txn", feeName: "Foreign Transaction", status: "stated_as_rate", current: null, currentLabel: "1.5% of the transaction", percentile: null, band: null, audience: "business" };
    expect(stripNote(rate, fingerprint)).toBe(
      "Stated only for business accounts, as a rate (1.5% of the transaction), so it is not compared with the group's dollar prices. 12 institutions in the group publish it as a dollar price. Source: published fee schedules, Mar 2026 to Oct 2026.",
    );
    const html = renderToStaticMarkup(<FeeFingerprintView fingerprint={{ ...fingerprint, strips: [rate] }} />);
    expect(html).toContain("Business accounts only");
    expect(html).not.toContain("Missing");
    // A consumer rate carries no audience line.
    const consumer = renderToStaticMarkup(<FeeFingerprintView fingerprint={{ ...fingerprint, strips: [{ ...rate, audience: undefined }] }} />);
    expect(consumer).not.toContain("Business accounts only");
  });

  it("draws peers at one price as one mark with their count (#1896)", () => {
    expect(peerMarks([30, 25, 30, 30.001, 35])).toEqual([
      { amount: 25, count: 1 },
      { amount: 30, count: 3 },
      { amount: 35, count: 1 },
    ]);
    const shared: FingerprintStrip = { ...blank, peerAmounts: [20, 25, 25, 25, 30, 30, 31, 32, 33, 34, 35, 36] };
    const html = renderToStaticMarkup(<FeeFingerprintView fingerprint={{ ...fingerprint, strips: [shared] }} />);
    // 12 peers at 9 prices: 9 marks.
    expect(html.match(/title="[^"]*"/g)).toHaveLength(9);
    expect(html).toContain('title="3 institutions at $25"');
    expect(html).toContain('title="2 institutions at $30"');
    expect(html).toContain("; 3 institutions at $25, 2 institutions at $30");
    expect(html).toContain("A number over a gray mark is how many institutions in the group charge that price.");
    // No shared price: no counts and no legend line.
    const single = renderToStaticMarkup(<FeeFingerprintView fingerprint={{ ...fingerprint, strips: [blank] }} />);
    expect(single).not.toContain("A number over a gray mark");
    expect(single).not.toContain("institutions at $");
  });

  it("links each fee to My fees for the research institution", () => {
    const html = renderToStaticMarkup(<FeeFingerprintView fingerprint={fingerprint} institutionId="323" />);
    expect(html).toContain('href="/pro/research?fee=overdraft&amp;instId=323"');
  });

  it("names the peers and their prices when too few publish the fee for a median", () => {
    const note = stripNote(fingerprint.strips[1], fingerprint);
    expect(note).toContain("fewer than the 10 needed for a median");
    expect(note).toContain("First Bank $25; Second CU $30");
    expect(note).not.toMatch(/median \$/);
  });

  it("shows an unpublished fee as missing rather than leaving it out", () => {
    const html = renderToStaticMarkup(<FeeFingerprintView fingerprint={fingerprint} />);
    expect(html).toContain("Stop Payment");
    expect(html).toContain("Missing");
    expect(stripNote(fingerprint.strips[2], fingerprint)).toMatch(/^Missing: not on Capital City Bank's published schedule/);
    expect(html).toContain("Fee position against Team peers");
  });

  it("states one month when every peer fee was published in it", () => {
    expect(periodText({ from: "2026-09-01", to: "2026-09-20" })).toBe("Sep 2026");
    expect(periodText(null)).toBeNull();
  });

  it("never uses an em dash", () => {
    const html = renderToStaticMarkup(<FeeFingerprintView fingerprint={fingerprint} />);
    expect(html).not.toContain("\u2014");
  });
});
