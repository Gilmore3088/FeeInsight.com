import { describe, expect, it } from "vitest";
import type { ReportLine } from "@/lib/custom-report/analysis";
import { displayQuote, sourcedFees, verifiedSourceQuote } from "./sample-sources";

// Source rows as the live sample report stored them on 2026-10-15 (West Shore Bank's schedule).
function line(key: string, fee_name: string, amount: number, source_line: string): ReportLine {
  return {
    key,
    label: key,
    own: { amount, fee_name, source_url: null, updated_at: null, schedule_read_on: "2026-10-08", source_line },
    peers: null,
    comparable: false,
    position: null,
    percentile: null,
    chargingLess: null,
    peerFigures: [],
  };
}

describe("verifiedSourceQuote", () => {
  it("prints only the cell that states the fee, never the neighbouring fee on its row", () => {
    const wire = line(
      "wire_intl_outgoing",
      "Outgoing International Wires",
      40,
      "Zipper Bags (Small)…………………………. $4.00 | Outgoing International Wires…….……… $40.00/ea",
    );
    const quote = verifiedSourceQuote(wire);
    expect(quote).not.toBeNull();
    expect(quote).not.toContain("Zipper");
    expect(quote).toContain("$40.00");
  });

  it("keeps a name and its price that sit in two cells", () => {
    expect(verifiedSourceQuote(line("stop_payment", "Stop Payment", 25, "Stop Payment | $25.00 per item"))).toBe(
      "Stop Payment … $25.00 per item",
    );
  });

  it("shows nothing when no part of the row states the fee", () => {
    expect(verifiedSourceQuote(line("wire_intl_outgoing", "Outgoing International Wires", 40, "Zipper Bags (Small)…… $4.00"))).toBeNull();
    expect(verifiedSourceQuote(line("overdraft", "Overdraft", 10, "Lost Key……… $25.00"))).toBeNull();
    expect(verifiedSourceQuote(line("not_a_report_line", "Overdraft", 10, "Overdraft $10.00"))).toBeNull();
  });

  it("lists only fees whose source passes the check", () => {
    const fees = sourcedFees([
      line("overdraft", "Overdraft (items paid)", 10, "Overdraft (items paid)……………………. $10.00 | Lost Key…………………………………………………………… $25.00"),
      line("wire_intl_outgoing", "Outgoing International Wires", 40, "Zipper Bags (Small)…… $4.00"),
      line("stop_payment", "Stop Payment", 35, "Stop Payment………………………………………………… $35.00 | Over $300 USD…………………………..……. $40.00"),
    ]);
    expect(fees.map((f) => [f.key, f.quote])).toEqual([
      ["overdraft", "Overdraft (items paid) … $10.00"],
      ["stop_payment", "Stop Payment … $35.00"],
    ]);
  });
});

describe("displayQuote", () => {
  it("joins schedule cells with one leader, never the stored row's pipe", () => {
    expect(displayQuote("Outgoing International Fee | $75")).toBe("Outgoing International Fee … $75");
    expect(displayQuote("Overdraft Item Fee*…………… | $35")).toBe("Overdraft Item Fee* … $35");
    expect(displayQuote("Stop Payment………… $35.00")).toBe("Stop Payment … $35.00");
  });
});
