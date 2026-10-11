// @vitest-environment node
import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { sampleStoryline } from "@/components/hamilton/storyline/test-fixture";
import { storylineAnalysis } from "@/lib/hamilton/workspace/analysis-record";
import type { StoryExhibit } from "@/lib/hamilton/workspace/storyline-types";
import { AnalysisPdfDocument } from "./AnalysisPdfDocument";
import { drawableExhibits, pdfMoney, pdfSigned, sourceLine } from "./StoryExhibitPdf";

const src = { label: "Bank Fee Index, published fee schedules", asOf: "2026-10-08T02:11:56.530Z" };

/** Every exhibit kind, the fixture's five plus the three the engine shares with the Pro page. */
function allKinds(): StoryExhibit[] {
  return [
    ...sampleStoryline().exhibits,
    {
      id: "pos",
      actionTitle: "Peers' middle half charges $28.75 to $31.25; your $30 sits at the 58th percentile.",
      exhibit: {
        kind: "fee_position",
        title: "t",
        unit: "dollars",
        own: 30,
        ownLabel: "Example Bank",
        band: { label: "Peers", p25: 28.75, median: 30, p75: 31.25, n: 12 },
        markers: [
          { label: "Peer median", scope: "peer", value: 30, n: 12 },
          { label: "National median", scope: "national", value: 30, n: 2025 },
        ],
        sources: [src],
      },
    },
    {
      id: "local",
      actionTitle: "1 of 3 competitors charge less than your $30.",
      exhibit: {
        kind: "competitor_range",
        title: "t",
        unit: "dollars",
        own: 30,
        ownLabel: "Example Bank",
        items: [
          { name: "Alpha Bank", amount: 10, url: null },
          { name: "Beta Bank", amount: 35, url: null },
          { name: "Gamma Bank", amount: 36, url: null },
        ],
        sources: [src],
      },
    },
    {
      id: "trend",
      actionTitle: "Service charges rose 11.8% in a year.",
      exhibit: {
        kind: "trend",
        title: "t",
        unit: "dollars",
        series: [{ label: "Example Bank", points: [{ date: "2025-06-30", value: 8_000_000 }, { date: "2026-06-30", value: 9_000_000 }] }],
        sources: [src],
      },
    },
    {
      id: "income-split",
      actionTitle: "You earn $1.20 more per $1,000 of deposits than peers.",
      exhibit: {
        kind: "structure_matrix",
        title: "t",
        columns: [],
        rows: [],
        sources: [src],
        incomeSplit: { unit: "per_1000_deposits", own: 5.2, peerMedian: 4, peerLabel: "Peers", n: 40, priceIndex: 104, priceExplained: 0.3, otherExplained: 0.9, quarterEnd: "2026-06-30" },
      },
    },
  ];
}

describe("StoryExhibitPdf", () => {
  it("formats money for the PDF's standard font, with an en dash for negatives", () => {
    expect(pdfMoney(209400)).toBe("$209,400");
    expect(pdfMoney(28.75)).toBe("$28.75");
    expect(pdfMoney(null)).toBe("Not published");
    expect(pdfSigned(-60000)).toBe("–$60,000");
    expect(pdfSigned(40000)).toBe("+$40,000");
    expect(pdfSigned(0)).toBe("$0");
  });

  it("names each source once, with a readable date", () => {
    expect(sourceLine([src, src, { label: "FDIC Summary of Deposits", asOf: "2026" }], "A note.")).toBe(
      "Sources: Bank Fee Index, published fee schedules, as of Oct 8, 2026; FDIC Summary of Deposits, as of 2026. A note.",
    );
    expect(sourceLine([])).toBeNull();
  });

  it("drops exhibits with nothing to draw", () => {
    const empty: StoryExhibit = { id: "e", actionTitle: "x", exhibit: { kind: "competitor_range", title: "t", unit: "dollars", own: 1, ownLabel: "x", items: [], sources: [] } };
    expect(drawableExhibits([empty, ...allKinds()]).map((e) => e.id)).not.toContain("e");
    expect(drawableExhibits(undefined)).toEqual([]);
  });

  it("renders an exported Ask with every exhibit kind drawn", async () => {
    const story = { ...sampleStoryline(), exhibits: allKinds() };
    const analysis = storylineAnalysis(story, "test");
    const buffer = await renderToBuffer(<AnalysisPdfDocument analysis={analysis} analysisFocus="Peer Position" institutionName="Example Bank" />);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(buffer.byteLength).toBeGreaterThan(5000);
  }, 30_000);
});
