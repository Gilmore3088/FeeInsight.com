/** @vitest-environment node */
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { extractText } from "unpdf";
import { expect, it } from "vitest";
import { MonthlyBriefingPdf } from "@/components/hamilton/reports/MonthlyBriefingPdf";
import { buildMonthlyBriefing, editMonthlyBriefing, monthlyBriefingReport } from "./monthly-briefing";

// Synthetic institution and figures only; not a claim about any real institution.
it("exports the six sections with each figure's source and period, and marks the team's words (#1897)", async () => {
  const briefing = buildMonthlyBriefing({
    now: new Date("2026-10-25T12:00:00Z"),
    institution: { id: 7, name: "Harbor Ridge Test Bank", charterType: "bank" },
    financial: null,
    financialPeerLabel: "banks in the same asset-size tier",
    competition: {
      peerLabel: "Ohio community banks",
      peerSource: "saved-peer-set",
      fallbackReason: null,
      peerAsOf: "2026-10-24T08:00:00Z",
      fees: [{ feeCategory: "overdraft", own: 35, ownAsOf: "2026-09-02T00:00:00Z", ownUrl: null, peerMedian: 30, peerCount: 42 }],
    },
    economy: null,
    regulation: [{ text: "Regulation E requires an opt-in before a bank charges for ATM and one-time debit card overdrafts.", source: { label: "Regulation E, 12 CFR 1005.17", asOf: null } }],
  });
  const report = editMonthlyBriefing(monthlyBriefingReport(briefing), { title: "October board pack", sections: { market: "Our reading of the market this month." } });
  const buffer = await renderToBuffer(createElement(MonthlyBriefingPdf, { title: report.title, briefing: report.monthlyBriefing! }) as unknown as ReactElement<DocumentProps>);
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  const normalized = text.replace(/\s+/g, " ");
  for (const phrase of [
    "October board pack",
    "Summary", "Financials", "Competition", "Market", "Regulation", "Management considerations",
    "$35", "$30", "Bank Fee Index, Ohio community banks, 42 institutions", "As of Oct 24, 2026", "Published Sep 2, 2026",
    "Regulation E, 12 CFR 1005.17", "Read Oct 25, 2026",
    "Our reading of the market this month.", "Words edited by your team.",
    "No call report filings are on file",
  ]) expect(normalized).toContain(phrase);
  expect(normalized).not.toContain("\u2014");
}, 20000);
