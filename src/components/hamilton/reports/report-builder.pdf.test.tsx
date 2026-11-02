/** @vitest-environment node */
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import { buildCommitteePacket } from "@/lib/hamilton/committee-packet";
import { fullPacketInput } from "@/lib/hamilton/committee-packet.fixture";
import { buildReportDocument, builderData, presetLayout, type BuilderLayout } from "@/lib/hamilton/report-builder";
import { ReportBuilderPdf } from "./ReportBuilderPdf";
import { ReportBuilder } from "./ReportBuilder";

const data = builderData(buildCommitteePacket(fullPacketInput()));

async function pdfPages(layout: BuilderLayout) {
  const doc = buildReportDocument(data, layout);
  const buffer = await renderToBuffer(createElement(ReportBuilderPdf, { doc }) as unknown as ReactElement<DocumentProps>);
  const { text, totalPages } = await extractText(new Uint8Array(buffer), { mergePages: false });
  return { doc, pages: (text as string[]).map((p) => p.replace(/\s+/g, " ")), totalPages };
}

describe("report builder PDF matches its preview", () => {
  const layouts: [string, BuilderLayout][] = [
    ["board, letter", presetLayout("board")],
    ["committee, letter", presetLayout("committee")],
    ["committee, A4, reordered", { ...presetLayout("committee", { pageSize: "A4", period: "8" }), order: ["sources", "trend", "changes", "fees", "above", "findings", "summary"] }],
  ];
  for (const [name, layout] of layouts) {
    it(`prints the preview's pages and sections in order (${name})`, async () => {
      const { doc, pages, totalPages } = await pdfPages(layout);
      expect(totalPages).toBe(doc.pageCount);
      doc.pages.forEach((page, i) => {
        expect(pages[i]).toContain(`Page ${page.number} of ${doc.pageCount}`);
        let at = -1;
        for (const section of page.sections) {
          const heading = `${section.n}. ${section.title}`;
          const found = pages[i].indexOf(heading, at + 1);
          expect(found, heading).toBeGreaterThan(at);
          at = found;
        }
      });
      // The last thing on the last page made it onto the page.
      const last = doc.pages[doc.pages.length - 1].sections.at(-1)!;
      if (last.view.key === "sources") expect(pages.at(-1)).toContain(last.view.lines.at(-1)!.slice(0, 40));
      const all = pages.join(" ");
      expect(all).not.toMatch(/Hamilton Pro|\[\d+(, \d+)*\]/);
    }, 30000);
  }

  it("prints the wider group a fee was compared with, on screen and in the PDF", async () => {
    const WIDER = "Florida banks and credit unions of every size";
    const widened = { ...data, bars: data.bars.map((b) => (b.band === "above" ? { ...b, comparedWith: WIDER } : b)) };
    const layout = presetLayout("committee");
    const doc = buildReportDocument(widened, layout);
    const buffer = await renderToBuffer(createElement(ReportBuilderPdf, { doc }) as unknown as ReactElement<DocumentProps>);
    const { text, totalPages } = await extractText(new Uint8Array(buffer), { mergePages: true });
    expect(totalPages).toBe(doc.pageCount);
    expect((text as string).replace(/\s+/g, " ")).toContain(`Compared with ${WIDER}`);
    // The preview shows one page at a time: put the fee rows on page one.
    const html = renderToStaticMarkup(createElement(ReportBuilder, { data: widened, layout: { ...layout, on: ["above"] }, onLayoutChange: () => undefined, peerSetId: null, savedPeerSets: [] }));
    expect(html.replace(/<!-- -->/g, "")).toContain(`Compared with ${WIDER}`);
  }, 30000);

  it("draws the same pages on screen", () => {
    const layout = presetLayout("committee");
    const doc = buildReportDocument(data, layout);
    const html = renderToStaticMarkup(createElement(ReportBuilder, { data, layout, onLayoutChange: () => undefined, peerSetId: null, savedPeerSets: [] }));
    expect(html).toContain(`Build: ${doc.title}`);
    expect(html).toContain(`${doc.sectionCount} sections · ${doc.pageCount} pages`);
    // One page shows at a time; its sections are the document's first page's.
    for (const section of doc.pages[0].sections) expect(html).toContain(`${section.n}. ${section.title}`);
    expect(html).toContain(`Page 1 of ${doc.pageCount}`);
    expect(html).toMatch(/role="img" aria-label="\d+ fees above/);
  });
});
