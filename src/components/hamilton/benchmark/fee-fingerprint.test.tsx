import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FeeFingerprint, FingerprintStrip } from "@/lib/hamilton/fee-fingerprint";
import { FeeFingerprintView, periodText, stripNote } from "./FeeFingerprint";

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
        { institutionName: "First Bank", amount: 25 },
        { institutionName: "Second CU", amount: 30 },
      ],
      period: { from: "2026-09-01", to: "2026-09-20" },
    },
    { ...blank, feeCategory: "stop_payment", feeName: "Stop Payment", status: "not_published", current: null, currentLabel: null, percentile: null },
  ],
};

describe("FeeFingerprint", () => {
  it("names every listed institution and says when sister charters count once", () => {
    const few = fingerprint.strips[1];
    const sisters = { ...few, peerCount: 1 };
    expect(stripNote(few, fingerprint)).toMatch(/^Only 2 institutions in the group publish it, fewer than/);
    expect(stripNote(sisters, fingerprint)).toMatch(/^Only 2 institutions in the group publish it \(1 counting sister charters once\), fewer than/);
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
