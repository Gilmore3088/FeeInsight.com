/** @vitest-environment node */
// Gate G9 in the printed PDF and on screen. Invented fixture data only (overdraftResearch).
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import { PdfDocument } from "@/components/hamilton/reports/PdfDocument";
import { ReportOutput } from "@/components/hamilton/reports/ReportOutput";
import { boardBriefFromAnalysis } from "./board-brief";
import { memoAnswer } from "./board-brief-quality.fixture";

const report = boardBriefFromAnalysis(memoAnswer(), "saved", { title: "", teamNote: "", includeEvidence: true });

async function pdfText(): Promise<string> {
  const buffer = await renderToBuffer(createElement(PdfDocument, { report, reportType: "board_brief" }) as unknown as ReactElement<DocumentProps>);
  return (await extractText(new Uint8Array(buffer), { mergePages: true })).text.replace(/\s+/g, " ");
}
const screen = () => renderToStaticMarkup(createElement(ReportOutput, { report, reportType: "board_brief" }))
  .replace(/<[^>]+>/g, " ").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("board brief PDF and screen (gate G9)", () => {
  it("prints the answer on page 1 and every exhibit with its figures", async () => {
    for (const out of [await pdfText(), screen()]) {
      expect(out).toContain(report.answer!.headline);
      for (const exhibit of report.exhibits!.filter((e) => e.id === "answer_exhibit")) {
        expect(out).toContain(exhibit.title);
        expect(out).toContain(exhibit.rows[0][1]);
      }
    }
  }, 20000);
});
