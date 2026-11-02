import { describe, expect, it } from "vitest";
import { buildCommitteePacket } from "./committee-packet";
import { fullPacketInput } from "./committee-packet.fixture";
import {
  BUILDER_PAGE,
  BUILDER_SECTION_KEYS,
  activeSections,
  buildReportDocument,
  builderData,
  encodeBuilderLayout,
  parseBuilderLayout,
  presetLayout,
  savedReportStatus,
  sectionHeight,
  withoutMarks,
  type BuilderLayout,
} from "./report-builder";

const data = builderData(buildCommitteePacket(fullPacketInput()));

describe("report builder layout", () => {
  it("starts each preset with its sections on and in order, the rest after them and off", () => {
    const board = presetLayout("board");
    expect(activeSections(board)).toEqual(["summary", "above", "trend", "sources"]);
    expect(board.order).toHaveLength(BUILDER_SECTION_KEYS.length);
    expect(activeSections(presetLayout("committee"))).toEqual(["summary", "findings", "above", "fees", "changes", "trend", "sources"]);
  });

  it("round-trips through a link and falls back on anything malformed", () => {
    const base = presetLayout("committee");
    const custom: BuilderLayout = { ...base, on: ["trend", "summary"], period: "8", pageSize: "A4", audience: "board", order: ["trend", ...base.order.filter((k) => k !== "trend")] };
    // `on` comes back in display order.
    expect(parseBuilderLayout(encodeBuilderLayout(custom))).toEqual({ ...custom, on: ["trend", "summary"] });
    expect(parseBuilderLayout("nonsense")).toEqual(presetLayout("board"));
    expect(parseBuilderLayout(42)).toEqual(presetLayout("board"));
    // Unknown and repeated sections are dropped; missing ones come back off.
    const parsed = parseBuilderLayout("board:board:4:LETTER:summary,evil,summary,-trend");
    expect(parsed.on).toEqual(["summary"]);
    expect(parsed.order).toHaveLength(BUILDER_SECTION_KEYS.length);
  });
});

describe("report builder document", () => {
  it("draws ticked sections in the chosen order and numbers them", () => {
    const layout = { ...presetLayout("board"), order: ["trend", "summary", "above", "sources", "findings", "fees", "changes"] as typeof BUILDER_SECTION_KEYS[number][] };
    const doc = buildReportDocument(data, layout);
    const sections = doc.pages.flatMap((p) => p.sections);
    expect(sections.map((s) => s.view.key)).toEqual(["trend", "summary", "above", "sources"]);
    expect(sections.map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(doc.pageCount).toBe(doc.pages.length);
  });

  it("redraws as a section is turned off", () => {
    const all = buildReportDocument(data, presetLayout("committee"));
    const fewer = buildReportDocument(data, { ...presetLayout("committee"), on: ["summary"] });
    expect(fewer.sectionCount).toBe(1);
    expect(fewer.pageCount).toBe(1);
    expect(all.pageCount).toBeGreaterThan(1);
  });

  it("keeps every page within the printable height", () => {
    for (const size of ["LETTER", "A4"] as const) {
      const doc = buildReportDocument(data, { ...presetLayout("committee"), pageSize: size });
      const body = BUILDER_PAGE[size].height - BUILDER_PAGE.marginTop - BUILDER_PAGE.marginBottom;
      for (const page of doc.pages) {
        const used = (page.number === 1 ? BUILDER_PAGE.coverHeight : 0) + page.sections.reduce((h, s) => h + sectionHeight(s.view) + BUILDER_PAGE.sectionGap, 0);
        if (page.sections.length > 1) expect(used).toBeLessThanOrEqual(body);
      }
    }
  });

  it("places a fee only with enough peers, and lists fees above the range largest gap first", () => {
    const doc = buildReportDocument(data, presetLayout("committee"));
    const views = doc.pages.flatMap((p) => p.sections.map((s) => s.view));
    const fees = views.find((v) => v.key === "fees");
    const above = views.find((v) => v.key === "above");
    if (fees?.key !== "fees" || above?.key !== "above") throw new Error("missing sections");
    for (const row of fees.rows) {
      if (row.position === "too_few") expect(row.median).toBe("—");
    }
    const gaps = above.rows.map((r) => Number((r.gap ?? "").replace(/[^0-9.]/g, "")));
    expect(above.rows.length).toBeGreaterThan(0);
    expect(gaps.every((g) => g > 0)).toBe(true);
  });

  it("gives a board the short list and a committee the long one", () => {
    const rows = (audience: "board" | "committee") => {
      const doc = buildReportDocument(data, { ...presetLayout("committee"), audience });
      const v = doc.pages.flatMap((p) => p.sections.map((s) => s.view)).find((x) => x.key === "fees");
      return v?.key === "fees" ? v.rows.length : 0;
    };
    expect(rows("board")).toBeLessThanOrEqual(6);
    expect(rows("committee")).toBeGreaterThan(rows("board"));
  });

  it("shows the income window the period asks for", () => {
    const trend = (period: "4" | "8" | "all") => {
      const v = buildReportDocument(data, { ...presetLayout("board"), period }).pages.flatMap((p) => p.sections.map((s) => s.view)).find((x) => x.key === "trend");
      return v?.key === "trend" ? v : null;
    };
    expect(trend("4")?.quarters).toHaveLength(4);
    expect(trend("8")?.quarters).toHaveLength(8);
    expect(trend("all")?.quarters).toHaveLength(data.income!.quarters.length);
    expect(trend("4")?.headline).not.toMatch(/\[\d/);
  });

  it("states sources in words, with no footnote marks", () => {
    expect(withoutMarks("Wire at $30 [1, 6].")).toBe("Wire at $30.");
    expect(withoutMarks("compare with the nearest peers in Appendix B.")).toBe("compare with the nearest peers in the pricing committee brief's Appendix B.");
    const text = JSON.stringify(buildReportDocument(data, presetLayout("committee")));
    expect(text).not.toMatch(/\[\d+(, \d+)*\]/);
  });
});

describe("saved report status", () => {
  it("is edited only when a team note or a changed section is saved", () => {
    expect(savedReportStatus({ report_type: "peer_benchmarking", report_json: {} })).toBe("as_written");
    expect(savedReportStatus({ report_type: "board_brief", report_json: { boardBrief: { teamNote: "  " } } })).toBe("as_written");
    expect(savedReportStatus({ report_type: "board_brief", report_json: { boardBrief: { teamNote: "Seen by CFO" } } })).toBe("edited");
    expect(savedReportStatus({ report_type: "monthly_briefing", report_json: { monthlyBriefing: { sections: [{ draft: "a", text: "a" }] } } })).toBe("as_written");
    expect(savedReportStatus({ report_type: "monthly_briefing", report_json: { monthlyBriefing: { sections: [{ draft: "a", text: "b" }] } } })).toBe("edited");
  });
});
