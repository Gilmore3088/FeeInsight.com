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
import { BOARD, MARKET, memoAnswer } from "./board-brief-quality.fixture";
import { INTERPRETATION_LABEL } from "./narrative-bound";
import { TRACED_READING_LABEL, TRACED_READING_NOTE } from "./storyline-trace";

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

  it("prints traced sentences with their sources apart from Hamilton's reading", async () => {
    // The PDF sets a label in spaced capitals, so compare without spaces or case.
    const squash = (text: string) => text.replace(/\s+/g, "").toLowerCase();
    for (const raw of [await pdfText(), screen()]) {
      const out = squash(raw);
      const traced = out.indexOf(squash(TRACED_READING_LABEL));
      const reading = out.indexOf(squash(INTERPRETATION_LABEL));
      expect(traced).toBeGreaterThan(-1);
      expect(out.indexOf(squash(BOARD[0]))).toBeGreaterThan(traced);
      expect(out).toContain(squash("Source: NCUA 5300 call report, as of Jun 30, 2026"));
      expect(out).toContain(squash(TRACED_READING_NOTE));
      // The filing sentence is printed once, in the traced box, never under the reading label.
      expect(out.split(squash(BOARD[0])).length).toBe(2);
      expect(reading).toBeGreaterThan(traced);
      expect(out.indexOf(squash(MARKET[0]))).toBeGreaterThan(reading);
    }
  }, 20000);

  it("puts the first exhibit on page 1 after the answer, not a blank page", async () => {
    const buffer = await renderToBuffer(createElement(PdfDocument, { report, reportType: "board_brief" }) as unknown as ReactElement<DocumentProps>);
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: false });
    const first = (text as string[])[0].replace(/\s+/g, "");
    expect(first).toContain(report.answer!.headline.replace(/\s+/g, ""));
    expect(first).toContain(report.exhibits![0].title.replace(/\s+/g, ""));
  }, 20000);
});
