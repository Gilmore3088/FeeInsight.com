/** @vitest-environment node */
/**
 * #1896: the report's price-move exhibit prints in the PDF exactly as on screen: the change per
 * item and the local rank and peer band, with no fee income figure per 1,000 charges and no share
 * of filed income worked out from one. Synthetic data only; no claim about a real institution.
 */
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import { buildReportExhibits } from "@/lib/hamilton/report-exhibits";
import type { SelectedInstitutionFeeDelta } from "@/lib/hamilton/report-evidence";
import type { ReportSummaryResponse } from "@/lib/hamilton/types";
import { PdfDocument } from "./PdfDocument";
import { ReportExhibitTable } from "./ReportAnswer";

function delta(fee_category: string, institution_amount: number, peer_median: number): SelectedInstitutionFeeDelta {
  return {
    fee_name: fee_category, fee_category, institution_amount, peer_median, peer_p25: null, peer_p75: null,
    delta_amount: institution_amount - peer_median, delta_percent: ((institution_amount - peer_median) / peer_median) * 100,
    position: institution_amount > peer_median ? "above_peer_median" : "below_peer_median",
    evidence_tier: "verified", excluded_from_verified_benchmark: false, institution_count: 40, maturity: "strong", confidence: null, source_url: null,
  };
}

const { exhibits } = buildReportExhibits({
  institutionName: "Synthetic Bank",
  deltas: [delta("nsf", 25, 30)],
  peerLabel: "synthetic peers",
  market: {
    basis: "branch_counties", label: "Synthetic County area", county_fips: [1], sod_year: 2026,
    competitors: [30, 32, 28, 26, 34].map((nsf, i) => ({
      institution_id: i + 1, institution_name: `Synthetic ${i + 1}`, charter_type: "bank", market_deposits: null, fees: { nsf }, document_url: null, document_date: null,
    })),
  },
  serviceCharges: { year: 2025, amount: 1_000_000, source: "fdic" },
});
const move = exhibits.find((e) => e.id === "dollar_impact")!;

const report = {
  title: "Synthetic price moves",
  answer: { headline: "Synthetic headline.", decisions: [] },
  exhibits: [move],
  watchlist: [],
  sources: [],
  executiveSummary: ["Synthetic summary."],
  snapshot: [],
  strategicRationale: "Synthetic rationale.",
  tradeoffs: [],
  recommendation: "Synthetic trade-off.",
  implementationNotes: [],
  exportControls: { pdfEnabled: true, shareEnabled: false },
} as ReportSummaryResponse;

describe("price-move exhibit, screen and PDF (#1896)", () => {
  it("prints the same columns and cells in the PDF as on screen, with no per-1,000 figure", async () => {
    const buffer = await renderToBuffer(createElement(PdfDocument, { report, reportType: "peer_benchmarking" }) as unknown as ReactElement<DocumentProps>);
    const pdf = (await extractText(new Uint8Array(buffer), { mergePages: true })).text.replace(/\s+/g, " ");
    const screen = renderToStaticMarkup(<ReportExhibitTable exhibit={move} number={1} />);
    for (const text of [...move.columns, ...move.rows[0]]) {
      expect(pdf).toContain(text);
      expect(screen).toContain(text.replace("&", "&amp;"));
    }
    expect(pdf).toContain("Change per item");
    for (const out of [pdf, screen]) {
      expect(out).not.toMatch(/per 1,000|Share of 2025/);
    }
  });
});
