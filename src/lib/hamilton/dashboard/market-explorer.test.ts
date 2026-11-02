import { describe, expect, it } from "vitest";
import { decodeLandingResearch, type LandingResearchHandoff } from "../landing-research-handoff";
import { buildMarketExplorer, explorerHref, explorerStats, histogramBins, parseDistrict, stateCells, type ExplorerValue } from "./market-explorer";

const value = (id: number, amount: number, stateCode = "FL", extra: Partial<ExplorerValue> = {}): ExplorerValue => ({
  id, name: `Test Bank ${id}`, stateCode, assets: 500_000 + id, charter: "bank", amount, documentUrl: `https://example.test/${id}.pdf`, ...extra,
});

describe("explorerStats", () => {
  it("withholds the median and middle half under ten institutions, keeping the range", () => {
    expect(explorerStats([30, 25, 35])).toEqual({ n: 3, min: 25, max: 35, p25: null, median: null, p75: null });
    const s = explorerStats([20, 22, 25, 25, 28, 30, 30, 32, 34, 35]);
    expect(s.n).toBe(10);
    expect(s.median).toBe(29);
    expect(s.p25).not.toBeNull();
    expect(explorerStats([]).min).toBeNull();
  });
});

describe("histogramBins", () => {
  it("makes twenty bands from $0 wide enough for the 95th percentile, the last one open", () => {
    const h = histogramBins([10, 25, 30, 30, 32, 35, 36, 38, 500], 36);
    expect(h.bins).toHaveLength(20);
    expect(h.bins[0].from).toBe(0);
    expect(h.bins[19].to).toBeNull();
    expect(h.bins.reduce((n, b) => n + b.count, 0)).toBe(9);
    expect(h.bins[19].count).toBeGreaterThanOrEqual(1);
    expect(h.subjectBin).toBe(Math.floor(36 / h.step));
    expect(histogramBins([], null)).toEqual({ step: 0, bins: [], subjectBin: null });
  });
});

describe("buildMarketExplorer", () => {
  const fl = Array.from({ length: 12 }, (_, i) => value(i + 1, 25 + i));
  const values = [...fl, value(100, 30, "GA"), value(101, 31, "GA"), value(200, 29, "FL", { name: "Frost Bank" })];
  const subjectValue = value(5, 29);

  it("ranks the subject in a state, counts never-named institutions without naming them", () => {
    const x = buildMarketExplorer({
      category: "overdraft", feeName: "Overdraft", region: { kind: "state", stateCode: "FL", label: "Florida" },
      values, inRegion: (v) => v.stateCode === "FL",
      subject: { id: 5, name: "Test Bank 5", stateCode: "FL", value: subjectValue },
    });
    expect(x.stats.n).toBe(13);
    expect(x.stats.median).not.toBeNull();
    expect(x.subject).toMatchObject({ price: 29, inScope: true, others: 12, position: "in_range" });
    expect(x.subject!.below).toBe(4);
    expect(x.subject!.level).toBe(1);
    expect(x.rows!.map((r) => r.name)).not.toContain("Frost Bank");
    expect(x.unnamed).toBe(1);
    expect(x.rows!.filter((r) => r.subject)).toHaveLength(1);
    expect(x.states).toHaveLength(51);
    expect(x.states.find((s) => s.code === "GA")).toEqual({ code: "GA", n: 2, median: null });
  });

  it("lists states, not institutions, nationally and says too few under the minimum", () => {
    const x = buildMarketExplorer({
      category: "overdraft", feeName: "Overdraft", region: { kind: "national", label: "United States" },
      values: values.slice(0, 4), inRegion: () => true,
      subject: { id: 5, name: "Test Bank 5", stateCode: "FL", value: subjectValue },
    });
    expect(x.rows).toBeNull();
    expect(x.stats.median).toBeNull();
    expect(x.subject).toMatchObject({ inScope: false, position: "too_few" });
  });

  it("shows the subject's row outside the filters to compare, and no subject without one", () => {
    const x = buildMarketExplorer({
      category: "overdraft", feeName: "Overdraft", region: { kind: "state", stateCode: "GA", label: "Georgia" },
      values, inRegion: (v) => v.stateCode === "GA",
      subject: { id: 5, name: "Test Bank 5", stateCode: "FL", value: subjectValue },
    });
    expect(x.rows!.map((r) => r.id)).toEqual([100, 101, 5]);
    expect(x.subject!.inScope).toBe(false);
    const none = buildMarketExplorer({ category: "overdraft", feeName: "Overdraft", region: { kind: "national", label: "United States" }, values, inRegion: () => true, subject: null });
    expect(none.subject).toBeNull();
    expect(none.histogram.subjectBin).toBeNull();
  });

  it("gives every state a cell even when it has no prices", () => {
    expect(stateCells([]).every((s) => s.n === 0 && s.median === null)).toBe(true);
  });
});

describe("explorer links", () => {
  const selection: LandingResearchHandoff = { version: 1, task: "compare", scope: { kind: "state", stateCode: "FL" }, charter: "all", categories: ["overdraft", "nsf"] };
  const base = { selection, size: "1b-10b", district: null, instId: "323" };
  const read = (href: string) => new URL(href, "https://x");

  it("keeps research, lens, size and instId, and adds district only for a district view", () => {
    const fee = read(explorerHref(base, { category: "nsf" }));
    expect(fee.pathname).toBe("/pro/intelligence");
    expect(fee.searchParams.get("lens")).toBe("fees");
    expect(fee.searchParams.get("size")).toBe("1b-10b");
    expect(fee.searchParams.get("instId")).toBe("323");
    expect(fee.searchParams.has("district")).toBe(false);
    expect(decodeLandingResearch(fee.searchParams.get("research"))?.categories).toEqual(["nsf", "overdraft"]);

    const district = read(explorerHref(base, { region: { district: 6 } }));
    expect(district.searchParams.get("district")).toBe("6");
    expect(decodeLandingResearch(district.searchParams.get("research"))?.scope).toEqual({ kind: "national" });

    const back = read(explorerHref({ ...base, district: 6 }, { region: "GA" }));
    expect(back.searchParams.has("district")).toBe(false);
    expect(decodeLandingResearch(back.searchParams.get("research"))?.scope).toEqual({ kind: "state", stateCode: "GA" });

    const all = read(explorerHref({ ...base, instId: null }, { size: "all", charter: "credit_union" }));
    expect(all.searchParams.has("size")).toBe(false);
    expect(all.searchParams.has("instId")).toBe(false);
    expect(decodeLandingResearch(all.searchParams.get("research"))?.charter).toBe("credit_union");
  });

  it("reads a district from 1 to 12 only", () => {
    expect(parseDistrict("6")).toBe(6);
    expect(parseDistrict("13")).toBeNull();
    expect(parseDistrict("x")).toBeNull();
    expect(parseDistrict(undefined)).toBeNull();
  });
});
