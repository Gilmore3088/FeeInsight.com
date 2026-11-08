/** @vitest-environment node */
import { createElement, type ReactElement } from "react";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { getDocumentProxy } from "unpdf";
import { expect, it } from "vitest";
import { HAMILTON_ATTRIBUTION } from "@/lib/constants";
import type { ReportSummaryResponse } from "@/lib/hamilton/types";
import { PdfDocument } from "./PdfDocument";

// Independently frozen synthetic literals: pdf-pagination-design-v1.json, before source changes.
// These exercise saved evidence preservation and layout, not current-bank truth.
const DENSE_ROWS: string[][] = [
  [
    "ROW-001",
    "$35.01",
    "SRC-001 record fee:published:2001; document 9701201; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-001",
    "Check-001"
  ],
  [
    "ROW-002",
    "$35.02",
    "SRC-002 record fee:published:2002; document 9701202; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-002",
    "Check-002"
  ],
  [
    "ROW-003",
    "$35.03",
    "SRC-003 record fee:published:2003; document 9701203; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-003",
    "Check-003"
  ],
  [
    "ROW-004",
    "$35.04",
    "SRC-004 record fee:published:2004; document 9701204; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-004",
    "Check-004"
  ],
  [
    "ROW-005",
    "$35.05",
    "SRC-005 record fee:published:2005; document 9701205; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-005",
    "Check-005"
  ],
  [
    "ROW-006",
    "$35.06",
    "SRC-006 record fee:published:2006; document 9701206; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-006",
    "Check-006"
  ],
  [
    "ROW-007",
    "$35.07",
    "SRC-007 record fee:published:2007; document 9701207; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-007",
    "Check-007"
  ],
  [
    "ROW-008",
    "$35.08",
    "SRC-008 record fee:published:2008; document 9701208; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-008",
    "Check-008"
  ],
  [
    "ROW-009",
    "$35.09",
    "SRC-009 record fee:published:2009; document 9701209; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-009",
    "Check-009"
  ],
  [
    "ROW-010",
    "$35.10",
    "SRC-010 record fee:published:2010; document 9701210; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-010",
    "Check-010"
  ],
  [
    "ROW-011",
    "$35.11",
    "SRC-011 record fee:published:2011; document 9701211; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-011",
    "Check-011"
  ],
  [
    "ROW-012",
    "$35.12",
    "SRC-012 record fee:published:2012; document 9701212; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-012",
    "Check-012"
  ],
  [
    "ROW-013",
    "$35.13",
    "SRC-013 record fee:published:2013; document 9701213; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-013",
    "Check-013"
  ],
  [
    "ROW-014",
    "$35.14",
    "SRC-014 record fee:published:2014; document 9701214; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-014",
    "Check-014"
  ],
  [
    "ROW-015",
    "$35.15",
    "SRC-015 record fee:published:2015; document 9701215; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-015",
    "Check-015"
  ],
  [
    "ROW-016",
    "$35.16",
    "SRC-016 record fee:published:2016; document 9701216; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-016",
    "Check-016"
  ],
  [
    "ROW-017",
    "$35.17",
    "SRC-017 record fee:published:2017; document 9701217; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-017",
    "Check-017"
  ],
  [
    "ROW-018",
    "$35.18",
    "SRC-018 record fee:published:2018; document 9701218; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-018",
    "Check-018"
  ],
  [
    "ROW-019",
    "$35.19",
    "SRC-019 record fee:published:2019; document 9701219; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-019",
    "Check-019"
  ],
  [
    "ROW-020",
    "$35.20",
    "SRC-020 record fee:published:2020; document 9701220; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-020",
    "Check-020"
  ],
  [
    "ROW-021",
    "$35.21",
    "SRC-021 record fee:published:2021; document 9701221; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-021",
    "Check-021"
  ],
  [
    "ROW-022",
    "$35.22",
    "SRC-022 record fee:published:2022; document 9701222; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-022",
    "Check-022"
  ],
  [
    "ROW-023",
    "$35.23",
    "SRC-023 record fee:published:2023; document 9701223; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-023",
    "Check-023"
  ],
  [
    "ROW-024",
    "$35.24",
    "SRC-024 record fee:published:2024; document 9701224; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-024",
    "Check-024"
  ]
];
const SMALL_ROWS = [
  ["SMALL-001", "$35", "Compact source one; SMALL-END-001", "Checked"],
  ["SMALL-002", "$30", "Compact source two; SMALL-END-002", "Checked"],
];
const LIMIT = "EVIDENCE-LIMIT Stored synthetic snapshot; no current bank schedule recheck.";
const AFTER = "AFTER-TABLE-MARKER";
const TITLE = "Original saved evidence table";
const SUBTITLE = "Frozen synthetic records; reporting date 2026-06-30";

type Box = { page: number; text: string; left: number; right: number; top: number; bottom: number; fontHeight: number; footer: boolean };
type Geometry = { boxes: Box[]; text: string; pages: number };
function savedReport(rows: string[][]): ReportSummaryResponse {
  return {
    title: "Saved synthetic evidence pagination", executiveSummary: [], snapshot: [],
    answer: { headline: "This saved synthetic table preserves every original figure and source.", decisions: [] },
    boardBrief: { teamNote: "", includeEvidence: true },
    strategicRationale: `${AFTER} All original saved rows precede this paragraph.`,
    tradeoffs: [], recommendation: "Saved synthetic evidence; no current truth claim.", implementationNotes: ["Synthetic preservation control."],
    exhibits: [{ id: "evidence_records", title: TITLE, subtitle: SUBTITLE,
      columns: ["Figure", "Value", "Source", "Check"], rows, note: LIMIT }],
    sources: [], exportControls: { pdfEnabled: true, shareEnabled: false },
  };
}
async function geometry(rows: string[][]): Promise<Geometry> {
  const footerDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const bytes = await renderToBuffer(createElement(PdfDocument, { report: savedReport(rows), reportType: "board_brief" }) as unknown as ReactElement<DocumentProps>);
  const evidenceDirectory = process.env.BOARD_BRIEF_PDF_EVIDENCE_DIR;
  if (evidenceDirectory) {
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(join(evidenceDirectory, `rows-${rows.length}.pdf`), bytes, { flag: "wx" });
  }
  const document = await getDocumentProxy(new Uint8Array(bytes));
  const boxes: Box[] = [];
  const observedPages = [];
  try {
    expect(document.numPages).toBeGreaterThan(0); expect(document.numPages).toBeLessThanOrEqual(12);
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number), viewport = page.getViewport({ scale: 1 });
      expect([viewport.width, viewport.height]).toEqual([612, 792]);
      const content = await page.getTextContent();
      observedPages.push({ page: number, width: viewport.width, height: viewport.height, styles: content.styles, items: content.items });
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        expect(item.transform[1]).toBe(0); expect(item.transform[2]).toBe(0);
        const font = content.styles[item.fontName];
        if (!font || !Number.isFinite(font.ascent) || !Number.isFinite(font.descent)) throw new Error("Native PDF font metrics unavailable");
        // item.height is the full font size. Painted text bounds use the font's
        // native ascent/descent; this matches Poppler's independent word boxes.
        const top = viewport.height - item.transform[5] - item.height * font.ascent;
        boxes.push({ page: number, text: item.str, left: item.transform[4], right: item.transform[4] + item.width,
          top, bottom: viewport.height - item.transform[5] - item.height * font.descent, fontHeight: item.height,
          footer: top > 728 && (item.str === HAMILTON_ATTRIBUTION || item.str === footerDate) });
      }
    }
    if (evidenceDirectory) writeFileSync(join(evidenceDirectory, `rows-${rows.length}-geometry.json`), JSON.stringify({ pages: observedPages, boxes }, null, 2), { flag: "wx" });
    return { boxes, text: boxes.map(box => box.text).join(" ").replace(/\s+/g, " "), pages: document.numPages };
  } finally { await document.destroy(); }
}
function one(g: Geometry, token: string): Box {
  const found = g.boxes.filter(box => box.text.includes(token));
  expect(found, `Exact source marker ${token} must survive once`).toHaveLength(1);
  return found[0];
}
function before(a: Box, b: Box) { return a.page < b.page || (a.page === b.page && b.top >= a.bottom + 0.5); }
function contentProblems(g: Geometry): string[] {
  return g.boxes.filter(box => !box.footer && (box.left < 71 || box.right > 541 || box.top < 63 || box.bottom > 729))
    .map(box => `Page ${box.page}: ${box.text.slice(0, 48)} outside content bounds`);
}
function preserved(g: Geometry, rows: string[][]) {
  for (const row of rows) for (const cell of row) expect(g.text).toContain(cell);
  expect(g.text).toContain(LIMIT); expect(g.text).toContain(AFTER);
}

it("keeps a compact saved table, its limit and following paragraph legible", async () => {
  const g = await geometry(SMALL_ROWS);
  preserved(g, SMALL_ROWS);
  expect(contentProblems(g)).toEqual([]);
  const title = one(g, TITLE), subtitle = one(g, SUBTITLE), first = one(g, "SMALL-001"), end = one(g, "SMALL-END-002");
  expect(before(title, subtitle)).toBe(true); expect(before(subtitle, first)).toBe(true);
  expect(before(one(g, "SMALL-END-001"), one(g, "SMALL-002"))).toBe(true);
  expect(before(end, one(g, "EVIDENCE-LIMIT"))).toBe(true);
  expect(before(one(g, "EVIDENCE-LIMIT"), one(g, AFTER))).toBe(true);
}, 30000);

it("paginates dense saved evidence without compressing rows or losing provenance", async () => {
  const g = await geometry(DENSE_ROWS);
  preserved(g, DENSE_ROWS);
  const problems = contentProblems(g);
  const first = one(g, "ROW-001"), last = one(g, "END-024");
  if (!before(one(g, TITLE), one(g, SUBTITLE))) problems.push("Exhibit title and subtitle overlap");
  if (!before(one(g, SUBTITLE), first)) problems.push("Exhibit heading overlaps first row");
  const rowPages = new Set<number>();
  for (let index = 0; index < DENSE_ROWS.length; index++) {
    const label = one(g, DENSE_ROWS[index][0]), suffix = DENSE_ROWS[index][0].slice(4);
    const source = one(g, `SRC-${suffix}`), end = one(g, `END-${suffix}`), value = one(g, DENSE_ROWS[index][1]), check = one(g, DENSE_ROWS[index][3]);
    rowPages.add(label.page);
    if ([source, end, value, check].some(box => box.page !== label.page)) problems.push(`Row ${suffix} loses same-page value/source association`);
    if (end.top < source.top || end.bottom < source.bottom) problems.push(`Row ${suffix} provenance order reverses`);
    if ([label, source, end, value, check].some(box => box.fontHeight < 7.99)) problems.push(`Row ${suffix} font was shrunk below original8pt`);
    if (index + 1 < DENSE_ROWS.length && !before(end, one(g, DENSE_ROWS[index + 1][0]))) problems.push(`Row ${suffix} provenance overlaps next row`);
  }
  if (rowPages.size < 2) problems.push("Dense rows were squeezed into one page instead of paginated");
  if (!before(last, one(g, "EVIDENCE-LIMIT"))) problems.push("Limit overlaps final row");
  if (!before(one(g, "EVIDENCE-LIMIT"), one(g, AFTER))) problems.push("Following paragraph overlaps saved evidence");
  expect({ violations: problems.length, examples: problems.slice(0, 12) }).toEqual({ violations: 0, examples: [] });
}, 30000);
