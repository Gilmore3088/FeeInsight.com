import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("@/lib/data-store/public-cached-reads", () => ({ getCustomReportMarketDataCached: vi.fn() }));
vi.mock("@/lib/data-store/public-read-cache", () => ({ cachedPublicRead: (_key: string, fn: unknown) => fn }));

import { chooseSample, pinnedSampleInstitutionId, SAMPLE_MIN_NAMED } from "./sample-report";

const candidate = (id: number, ready: boolean, named: number, competitorsWithData = 20) => ({
  id,
  ready,
  named,
  competitorsWithData,
});

describe("chooseSample", () => {
  it("takes the first ready market that names enough competitors", () => {
    expect(chooseSample([candidate(1, false, 9), candidate(2, true, SAMPLE_MIN_NAMED), candidate(3, true, 9)])).toBe(2);
  });

  it("falls back to the ready market naming the most competitors", () => {
    expect(chooseSample([candidate(1, true, 2), candidate(2, true, 4, 10), candidate(3, true, 4, 30)])).toBe(3);
  });

  it("returns null when no market is ready, so the page says a sample is on its way", () => {
    expect(chooseSample([candidate(1, false, 9)])).toBeNull();
    expect(chooseSample([])).toBeNull();
  });
});

describe("pinnedSampleInstitutionId", () => {
  it("reads a positive integer id and ignores anything else", () => {
    expect(pinnedSampleInstitutionId("4821")).toBe(4821);
    expect(pinnedSampleInstitutionId(undefined)).toBeNull();
    expect(pinnedSampleInstitutionId("")).toBeNull();
    expect(pinnedSampleInstitutionId("abc")).toBeNull();
    expect(pinnedSampleInstitutionId("-3")).toBeNull();
  });
});
