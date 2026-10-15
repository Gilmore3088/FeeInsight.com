/** @vitest-environment node */
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { extractText } from "unpdf";
import { expect, it } from "vitest";
import { PdfDocument } from "@/components/hamilton/reports/PdfDocument";
import { boardBriefFromAnalysis, editBoardBrief } from "./board-brief";
import type { AnalyzeResponse } from "./types";

it("exports edited board presentation with original values, sources and separate identities", async () => {
  const analysis: AnalyzeResponse = {
    title: "Wire review", confidence: { level: "medium", basis: ["Historical published schedules"] },
    hamiltonView: "Research CU wire fee is $35.", whatThisMeans: "Original peer median is $30.", whyItMatters: [],
    evidence: { metrics: [{ label: "Research wire", value: "$35", note: "Original schedule, 2026-07-01" }] },
    exploreFurther: ["Review waiver terms."],
    identityContext: { version: 1, researchInstitutionId: 2, researchInstitutionName: "Research CU", accountInstitutionId: 1, accountInstitutionName: "Home CU", accountStatus: "identified" },
  };
  const original = boardBriefFromAnalysis(analysis, "original", { title: "Draft", teamNote: "", includeEvidence: true });
  const report = editBoardBrief(original, { title: "Board review", teamNote: "Discuss waivers at the next meeting.", includeEvidence: true });
  const buffer = await renderToBuffer(createElement(PdfDocument, { report, reportType: "board_brief" }) as unknown as ReactElement<DocumentProps>);
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  const normalized = text.replace(/\s+/g, " ");
  for (const phrase of ["Board review", "Research institution: Research CU", "Account institution: Home CU", "$35", "$30", "2026-07-01", "Team note (user-authored)", "Discuss waivers at the next meeting."]) expect(normalized).toContain(phrase);
  expect(normalized).toContain("not recorded");
}, 20000);
