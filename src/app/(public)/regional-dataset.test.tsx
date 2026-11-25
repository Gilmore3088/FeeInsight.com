import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SITE_URL } from "@/lib/constants";
import { CityReport } from "./fees/city/[state]/[city]/city-report";
import { StateReport } from "./research/state/[code]/state-report";

vi.mock("@/app/landing-serif", () => ({ homeSerif: { variable: "serif-var" } }));
vi.mock("@/lib/public-stats", () => ({
  formatCount: (n: number) => String(n),
  getPublicNationalIndex: async () => [],
  getPublicStatsSummary: async () => ({ complete: true, refreshedOn: null }),
}));
vi.mock("@/lib/data-store", () => ({
  getBeigeBookHeadline: async () => null,
  getCityInstitutions: async () => [],
  getLatestBeigeBook: async () => [],
}));
vi.mock("@/lib/custom-report/sample-report", () => ({
  sampleReportAvailable: async () => false,
}));
vi.mock("@/lib/data-store/public-read-cache", () => ({
  shortenPageLife: async () => undefined,
  cachedPublicRead: (_key: string, read: unknown) => read,
}));
vi.mock("@/lib/data-store/public-cached-reads", () => ({
  getCityMarketCached: async () => ({
    area: "city", institutions: [], bank_branches: 0, cu_branches: 0,
    deposit_years: [], community: {}, points: [], unplaced: 0,
  }),
  getStateFeeIndexesCached: async () => ({
    all: [], bank: [], credit_union: [],
    verified_institutions: 0, verified_bank_institutions: 0,
    verified_cu_institutions: 0, verified_fees: 0,
  }),
  getPeerIndexCached: async () => [],
  getStateMarketFeesCached: async () => [],
  getStateHubCached: async () => null,
  getResearchCoverageCached: async () => null,
  getStatePeerSetIndexesCached: async () => [],
}));

function emittedDatasets(node: ReactNode): Array<Record<string, unknown>> {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{
      children?: ReactNode;
      type?: string;
      dangerouslySetInnerHTML?: { __html: string };
    }>(child)) return [];
    if (child.type === "script" && child.props.type === "application/ld+json") {
      const value = JSON.parse(child.props.dangerouslySetInnerHTML?.__html ?? "");
      return value["@type"] === "Dataset" ? [value] : [];
    }
    return emittedDatasets(child.props.children);
  });
}

describe("regional report dataset markup", () => {
  it.each([
    ["state", () => StateReport({ code: "wa", user: null }), "/research/state/WA"],
    ["city", () => CityReport({ state: "wa", city: "seattle", area: "city" }), "/fees/city/wa/seattle"],
  ] as const)("%s report links its described dataset to the canonical index", async (_kind, report, path) => {
    const datasets = emittedDatasets(await report());
    expect(datasets).toHaveLength(1);
    expect(datasets[0]).toMatchObject({
      url: SITE_URL + path,
      isPartOf: SITE_URL + "/fees",
    });
    expect(datasets[0].description).toEqual(expect.any(String));
    expect((datasets[0].description as string).length).toBeGreaterThanOrEqual(50);
  });
});
