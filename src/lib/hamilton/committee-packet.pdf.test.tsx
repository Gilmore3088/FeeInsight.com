/** @vitest-environment node */
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { extractText } from "unpdf";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CommitteePacketPdf, type PacketPageSize } from "@/components/hamilton/reports/CommitteePacketPdf";
import { CommitteePacketView } from "@/components/hamilton/reports/CommitteePacket";
import { buildCommitteePacket, footnoteMarks } from "./committee-packet";
import { fullPacketInput } from "./committee-packet.fixture";

// The fee menu for price and yield (ten fees) is a client menu that reads the router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => "/pro/reports/committee",
  useSearchParams: () => new URLSearchParams(),
}));

async function render(packet: ReturnType<typeof buildCommitteePacket>, pageSize: PacketPageSize) {
  const buffer = await renderToBuffer(createElement(CommitteePacketPdf, { packet, pageSize }) as unknown as ReactElement<DocumentProps>);
  const { text, totalPages } = await extractText(new Uint8Array(buffer), { mergePages: false });
  return { pages: text as string[], totalPages, head: Buffer.from(buffer).subarray(0, 4).toString() };
}

describe("committee packet PDF", () => {
  const packet = buildCommitteePacket(fullPacketInput());
  const long = buildCommitteePacket(fullPacketInput({}, 30));

  for (const size of ["LETTER", "A4"] as const) {
    it(`renders at ${size} in the packet's order, with a sane page count and no blank page`, async () => {
      const { pages, totalPages, head } = await render(packet, size);
      expect(head).toBe("%PDF");
      // Brief, position, financial context, appendix and sources: more than 5 pages, fewer than 20.
      expect(totalPages).toBeGreaterThanOrEqual(6);
      expect(totalPages).toBeLessThanOrEqual(20);
      // No page holds only its footer.
      for (const page of pages) expect(page.replace(/\s+/g, " ").replace(/Hamilton — Fee Insight · Pricing committee packet · read [A-Za-z]+ \d+, \d{4}/, "").replace(/Page \d+ of \d+/, "").trim().length).toBeGreaterThan(40);
      const all = pages.join("\n").replace(/\s+/g, " ");
      // Exhibits first; every table in the appendix; limitations, method and sources last.
      const order = ["Executive brief", "Fees above the peers' middle 50%", "Where each fee sits among", "Priorities for review", "Competitive position", "Financial context", "Service charge income per $10,000 of total assets", "Appendix", "'s fees against", "Each peer's published fees, part 1 of 2", "Nearest peers on each side", "Limitations, method and sources", "Material limitations", "Not available in this packet", "Method", "Sources"];
      let at = -1;
      for (const phrase of order) {
        const i = all.indexOf(phrase, at + 1);
        expect(i, phrase).toBeGreaterThan(at);
        at = i;
      }
      expect(all).not.toMatch(/Watched fees|None found|No changes found|Position check|Hamilton Pro/);
      expect(all).toContain(`Page 1 of ${totalPages}`);
    }, 30000);
  }

  it("repeats a long table's heading and column headings on each page it runs onto", async () => {
    const { pages } = await render(long, "A4");
    const matrixPages = pages.filter((p) => p.includes("Each peer's published fees, part 1 of 2"));
    expect(matrixPages.length).toBeGreaterThanOrEqual(2);
    for (const p of matrixPages) expect(p).toMatch(/Institution[\s\S]*Overdraft[\s\S]*Source/);
  }, 30000);

  it("prints only footnote numbers that are in the Sources list", async () => {
    const { pages } = await render(packet, "LETTER");
    const all = pages.join("\n");
    const cut = all.lastIndexOf("Sources\n") === -1 ? all.lastIndexOf("Sources") : all.lastIndexOf("Sources\n");
    const marks = new Set(all.slice(0, cut).split("\n").flatMap(footnoteMarks));
    const sources = all.slice(cut);
    expect(marks.size).toBeGreaterThan(10);
    for (const n of marks) expect(sources).toContain(`[${n}]`);
    expect(packet.footnotes.length).toBeGreaterThanOrEqual(30);
  }, 30000);
});

it("renders the screen in the same order, with a source list and no form", () => {
  const packet = buildCommitteePacket(fullPacketInput());
  const html = renderToStaticMarkup(createElement(CommitteePacketView, {
    packet,
    hrefFor: () => "/pro/reports/committee?instId=323",
    fees: packet.feeCategories.map((category) => ({ category, name: category })),
    selected: { yieldFee: null },
  }));
  const order = ["Executive brief", "Fees above the peers&#x27; middle 50%", "Exhibit 1", "Where each fee sits among", "Priorities for review", "Competitive position", "Financial context", "Appendix", "Appendix A", "Material limitations", "Not available in this packet", "Method", "Sources"];
  let at = -1;
  for (const phrase of order) {
    const i = html.indexOf(phrase, at + 1);
    expect(i, phrase).toBeGreaterThan(at);
    at = i;
  }
  for (const phrase of ["id=\"fn-1\"", "Back to the executive brief", "Try a price", "Download PDF", "A4"]) expect(html).toContain(phrase);
  expect(html).not.toMatch(/<form|Position check|Watched fees|None found|you should|Hamilton Pro/i);
});
