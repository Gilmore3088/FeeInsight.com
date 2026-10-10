/** @vitest-environment node */
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { expect, it } from "vitest";
import { PdfDocument } from "@/components/hamilton/reports/PdfDocument";
import { buildLandingReport } from "./landing-report";
import type { LandingResearchHandoff } from "./landing-research-handoff";
import type { GeographicResearchResult } from "./landing-geographic-research";
it("renders the saved draft shape with the actual PDF renderer", async () => {
  const selection: LandingResearchHandoff = { version: 1, task: "board_report", scope: { kind: "state", stateCode: "DC" }, charter: "credit_union", categories: ["money_order"] };
  const measure = { median: 0, p25: 0, p75: 2, institutions: 8, observations: 8, lastUpdated: "2026-10-10", status: "available" as const };
  const result: GeographicResearchResult = { scope: selection.scope, charter: selection.charter, categories: selection.categories, comparisons: [{ category: "money_order", selected: measure, national: { ...measure, median: 3 }, difference: -3 }], method: "published_fee_index_by_institution", source: "published_fee_catalog" };
  const report = JSON.parse(JSON.stringify(buildLandingReport(selection, result, "2026-10-10")));
  const buffer = await renderToBuffer(createElement(PdfDocument, { report, reportType: "landing_research" }) as unknown as ReactElement<DocumentProps>);
  expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  expect(buffer.length).toBeGreaterThan(1000);
}, 20000);
