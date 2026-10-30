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
import { COMMENTARY_NOTE } from "./storyline-trace";

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

  it("prints the reading in one box with no per-sentence source lines", async () => {
    const squash = (text: string) => text.replace(/\s+/g, "").toLowerCase();
    // Review probes: every number is in the answer, every sentence is false. No source line, ever.
    const probes = ["Your bank charges $29.50 for an overdraft.", "The peer median is $32.", "Fee income fell 4.2% to $209 thousand.", "16 competitors charge $32 or more."];
    const answer = memoAnswer();
    answer.memo!.narrativeBinding!.interpretation = probes;
    answer.hamiltonView = "";
    answer.whatThisMeans = probes.join(" ");
    for (const brief of [report, boardBriefFromAnalysis(answer, "saved", { title: "", teamNote: "", includeEvidence: true })]) {
      const buffer = await renderToBuffer(createElement(PdfDocument, { report: brief, reportType: "board_brief" }) as unknown as ReactElement<DocumentProps>);
      const pdf = (await extractText(new Uint8Array(buffer), { mergePages: true })).text;
      const html = renderToStaticMarkup(createElement(ReportOutput, { report: brief, reportType: "board_brief" })).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'");
      for (const raw of [pdf, html]) {
        const out = squash(raw);
        const box = out.slice(out.indexOf(squash("What Is Behind It")), out.indexOf(squash("Limits of this evidence")));
        for (const sentence of brief.boardBrief!.reading!) expect(box).toContain(squash(sentence));
        expect(box).not.toContain("source:");
      }
    }
  }, 30000);

  it("labels the box as commentary when every number in it is in the exhibits", async () => {
    const answer = memoAnswer();
    answer.memo!.narrativeBinding!.interpretation = [...BOARD];
    answer.hamiltonView = "";
    answer.whatThisMeans = BOARD.join(" ");
    const brief = boardBriefFromAnalysis(answer, "saved", { title: "", teamNote: "", includeEvidence: true });
    const buffer = await renderToBuffer(createElement(PdfDocument, { report: brief, reportType: "board_brief" }) as unknown as ReactElement<DocumentProps>);
    const pdf = (await extractText(new Uint8Array(buffer), { mergePages: true })).text.replace(/\s+/g, "").toLowerCase();
    const html = renderToStaticMarkup(createElement(ReportOutput, { report: brief, reportType: "board_brief" })).replace(/&#x27;/g, "'").replace(/\s+/g, "").toLowerCase();
    for (const out of [pdf, html]) {
      expect(out).toContain(COMMENTARY_NOTE.replace(/\s+/g, "").toLowerCase());
      expect(out).not.toContain(INTERPRETATION_LABEL.replace(/\s+/g, "").toLowerCase());
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
