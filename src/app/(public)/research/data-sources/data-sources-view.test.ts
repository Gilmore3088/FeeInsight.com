import { describe, expect, it } from "vitest";
import {
  DATA_SOURCES,
  coverageBar,
  FED_DISTRICT_COUNT,
  REPORT_REQUEST_HREF,
  SAMPLE_REPORT_HREF,
  nextAction,
  sourceMap,
  usable,
  type SourceCounts,
} from "./data-sources-view";

const NONE: SourceCounts = {
  observations: null,
  institutions: null,
  banks: null,
  creditUnions: null,
  fdicReports: null,
  ncuaReports: null,
};

describe("DATA_SOURCES", () => {
  it("has unique anchors, https links and no em-dashes", () => {
    const ids = DATA_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of DATA_SOURCES) {
      if (s.href) expect(s.href).toMatch(/^https:\/\//);
      expect(`${s.name} ${s.publisher} ${s.takes} ${s.refresh ?? ""}`).not.toMatch(/[\u2014\u2013]/);
    }
  });
});

describe("sourceMap", () => {
  it("puts the fee schedules first and every other source in one group", () => {
    const map = sourceMap(NONE);
    expect(map.primary.id).toBe("fee-schedules");
    const grouped = map.groups.flatMap((g) => g.nodes.map((n) => n.id));
    expect(grouped).toHaveLength(DATA_SOURCES.length - 1);
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("shows only live counts, never a failed or zero read", () => {
    const map = sourceMap({ ...NONE, observations: 0, banks: 4321, fdicReports: Number.NaN });
    expect(map.primary.figures).toEqual([]);
    const figures = Object.fromEntries(map.groups.flatMap((g) => g.nodes).map((n) => [n.id, n.figure]));
    expect(figures["fdic-bankfind"]).toEqual({ value: "4,321", label: "banks tracked" });
    expect(figures["ncua-credit-unions"]).toBeNull();
    expect(figures["fdic-call-reports"]).toBeNull();
    expect(figures["fed-districts"]).toEqual({ value: String(FED_DISTRICT_COUNT), label: "districts" });
    expect(figures["cfpb-complaints"]).toBeNull();
  });

  it("labels the primary counts with the shared coverage names", () => {
    const map = sourceMap({ ...NONE, observations: 76629, institutions: 3890 });
    expect(map.primary.figures).toEqual([
      { value: "76,629", label: "published fee entries" },
      { value: "3,890", label: "institutions with published fees" },
    ]);
  });
});

describe("coverageBar", () => {
  it("is null unless all three reads worked", () => {
    expect(coverageBar({ ...NONE, banks: 4000, creditUnions: 6000 })).toBeNull();
    expect(coverageBar({ ...NONE, banks: 0, creditUnions: 6000, institutions: 3000 })).toBeNull();
  });

  it("puts both bars on the list's scale", () => {
    const bar = coverageBar({ ...NONE, banks: 4000, creditUnions: 6000, institutions: 3000 })!;
    expect(bar.banks).toEqual({ value: "4,000", pct: 40 });
    expect(bar.creditUnions).toEqual({ value: "6,000", pct: 60 });
    expect(bar.withFees).toEqual({ value: "3,000", pct: 30 });
  });
});

it("keeps the phone grid free of empty cells", () => {
  const narrow = sourceMap(NONE).groups.filter((g) => !g.wide).length;
  expect(narrow % 2).toBe(0);
});

describe("usable", () => {
  it("rejects null, zero, negative and non-finite", () => {
    expect([null, undefined, 0, -1, Number.NaN, Infinity].map(usable)).toEqual([false, false, false, false, false, false]);
    expect(usable(1)).toBe(true);
  });
});

describe("nextAction", () => {
  it("sends to the sample report when it is live, else the tagged request form", () => {
    expect(nextAction(true).href).toBe(SAMPLE_REPORT_HREF);
    expect(nextAction(false).href).toBe(REPORT_REQUEST_HREF);
    expect(REPORT_REQUEST_HREF).toBe("/reports?report=institution&src=data-sources#request");
  });
});

it("counts twelve Fed districts", () => {
  expect(FED_DISTRICT_COUNT).toBe(12);
});
