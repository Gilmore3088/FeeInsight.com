import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("@/lib/data-store/public-cached-reads", () => ({ getCustomReportMarketDataCached: vi.fn() }));
vi.mock("@/lib/data-store/public-read-cache", () => ({ cachedPublicRead: (_key: string, fn: unknown) => fn }));
vi.mock("./analysis", () => ({ analyzeMarket: vi.fn() }));

import { sql } from "@/lib/data-store/connection";
import { getCustomReportMarketDataCached } from "@/lib/data-store/public-cached-reads";
import { analyzeMarket } from "./analysis";
import {
  chooseSample,
  DEMO_SAMPLE_INSTITUTION_ID,
  loadSampleReport,
  pinnedSampleInstitutionId,
  SAMPLE_MIN_NAMED,
} from "./sample-report";

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

describe("loadSampleReport", () => {
  const AUTO_ID = 4821;
  const PIN_ID = 777;

  /** Each id's market: ready or not, and how many competitors the report names. */
  function markets(byId: Record<number, { ready: boolean; named: number }>) {
    (sql as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: AUTO_ID }]);
    vi.mocked(getCustomReportMarketDataCached).mockImplementation(
      async (id: number) => ({ id, market: { basis: "branch_counties" } }) as never,
    );
    vi.mocked(analyzeMarket).mockImplementation(((data: { id: number }) => {
      const m = byId[data.id] ?? { ready: false, named: 0 };
      return {
        readiness: { ready: m.ready, competitorsWithData: 20 },
        named: Array.from({ length: m.named }, () => ({})),
      };
    }) as never);
  }

  const chosenId = (report: Awaited<ReturnType<typeof loadSampleReport>>) =>
    (report?.data as unknown as { id: number } | undefined)?.id ?? null;

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("SAMPLE_REPORT_INSTITUTION_ID", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the pinned institution over the demo bank", async () => {
    vi.stubEnv("SAMPLE_REPORT_INSTITUTION_ID", String(PIN_ID));
    markets({
      [PIN_ID]: { ready: true, named: SAMPLE_MIN_NAMED },
      [DEMO_SAMPLE_INSTITUTION_ID]: { ready: true, named: SAMPLE_MIN_NAMED },
    });
    expect(chosenId(await loadSampleReport())).toBe(PIN_ID);
  });

  it("uses the demo bank when its market is ready", async () => {
    markets({
      [DEMO_SAMPLE_INSTITUTION_ID]: { ready: true, named: SAMPLE_MIN_NAMED },
      [AUTO_ID]: { ready: true, named: 9 },
    });
    expect(chosenId(await loadSampleReport())).toBe(DEMO_SAMPLE_INSTITUTION_ID);
  });

  it("falls back to the automatic choice when the demo bank's market is not ready", async () => {
    markets({
      [DEMO_SAMPLE_INSTITUTION_ID]: { ready: false, named: 0 },
      [AUTO_ID]: { ready: true, named: SAMPLE_MIN_NAMED },
    });
    expect(chosenId(await loadSampleReport())).toBe(AUTO_ID);
  });

  it("falls back when the demo bank names too few competitors", async () => {
    markets({
      [DEMO_SAMPLE_INSTITUTION_ID]: { ready: true, named: SAMPLE_MIN_NAMED - 1 },
      [AUTO_ID]: { ready: true, named: SAMPLE_MIN_NAMED },
    });
    expect(chosenId(await loadSampleReport())).toBe(AUTO_ID);
  });

  it("names Capital City Bank as the demo bank", () => {
    expect(DEMO_SAMPLE_INSTITUTION_ID).toBe(323);
  });
});
