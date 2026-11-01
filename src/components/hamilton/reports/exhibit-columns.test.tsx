import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReportExhibit } from "@/lib/hamilton/types";
import { ReportExhibitTable, exhibitCellClass, exhibitColumnKinds } from "./ReportAnswer";

// Invented rows shaped like the board brief's records exhibit (#1899).
const records: ReportExhibit = {
  id: "evidence_records",
  title: "Records behind the saved answer",
  subtitle: "As saved Oct 25, 2026; not refreshed",
  columns: ["Figure", "Value", "Source as saved", "Check"],
  note: "Invented note.",
  rows: [
    ["NSF / Returned Item, Everyday checking, Test Credit Union", "$27 per_item",
      "record fee:published:9701001 · document 9702001 · version abcdef123456 · reporting date Oct 5, 2026", "Matches the stored source"],
    ["NSF / Returned Item, calculated", "$2", "record derived:difference:subject-peer · the first record minus the second", "Recalculated from the saved records"],
  ],
};

describe("exhibit column sizing (#1899)", () => {
  it("reads a long middle column as prose and a short one as a figure", () => {
    expect(exhibitColumnKinds(records)).toEqual(["label", "figure", "text", "text"]);
    expect(exhibitColumnKinds({ columns: ["Measure", "Value", "Peers"], rows: [["NSF", "$27", "12 peers"]] }))
      .toEqual(["label", "figure", "text"]);
  });

  it("keeps the Figure column readable and lets the source column wrap", () => {
    const html = renderToStaticMarkup(<ReportExhibitTable exhibit={records} number={2} />);
    const cells = [...html.matchAll(/<td class="([^"]*)"/g)].map((m) => m[1]);
    expect(cells[0]).toContain("min-w-[13rem]");
    expect(cells[1]).toContain("whitespace-nowrap");
    expect(cells[2]).toContain("[overflow-wrap:anywhere]");
    expect(cells[2]).not.toContain("whitespace-nowrap");
    expect(html).toContain("overflow-x-auto");
    expect(exhibitCellClass("label", 0, 4)).not.toContain("whitespace-nowrap");
  });

  it("adds no minimum widths to a table with no prose column, so a short exhibit still fits a phone", () => {
    const short = { columns: ["Year", "Reported", "Change"], rows: [["2025", "$1.2M", "+4%"]] };
    const html = renderToStaticMarkup(<ReportExhibitTable exhibit={{ ...records, ...short }} number={1} />);
    expect(html).not.toContain("min-w-[");
  });
});
