import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import {
  accumulateHmdaCsv,
  fetchAporTable,
  fetchHmdaPanel,
  parseAporTable,
  fetchHmdaStateAggregate,
  HmdaAccumulator,
  hmdaCleaningReport,
  hmdaCounty,
  hmdaNumber,
  parseHmdaPanel,
  parseHmdaPartition,
  sortedQuantile,
  splitCsvLine,
} from "./hmda";

const HEADER =
  "activity_year,lei,derived_msa_md,state_code,county_code,action_taken,loan_purpose,loan_amount,total_loan_costs,origination_charges,discount_points,lender_credits";

function stream(text: string, chunk = 7): ReadableStream<Uint8Array> {
  const bytes = strToU8(text);
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(at, at + chunk));
      at += chunk;
    },
  });
}

describe("HMDA cell parsing", () => {
  it("keeps NA, Exempt and blank as reasons, never a number", () => {
    expect(hmdaNumber("205000")).toEqual({ value: 205000 });
    expect(hmdaNumber("NA")).toEqual({ missing: "na" });
    expect(hmdaNumber("Exempt")).toEqual({ missing: "exempt" });
    expect(hmdaNumber("")).toEqual({ missing: "blank" });
    expect(hmdaNumber("abc")).toEqual({ missing: "unreadable" });
  });

  it("reads county codes and partitions", () => {
    expect(hmdaCounty("6037")).toBe("06037");
    expect(hmdaCounty("NA")).toBeNull();
    expect(parseHmdaPartition("2024-CA")).toEqual({ year: 2024, state: "CA" });
    expect(parseHmdaPartition("2017-CA")).toBeNull();
    expect(parseHmdaPartition("2024-ZZ")).toBeNull();
  });

  it("splits quoted CSV cells", () => {
    expect(splitCsvLine('a,"b,c","d""e"')).toEqual(["a", "b,c", 'd"e']);
  });

  it("takes exact quantiles", () => {
    expect(sortedQuantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(sortedQuantile([], 0.5)).toBeNull();
  });
});

describe("accumulateHmdaCsv", () => {
  const body = [
    HEADER,
    "2024,LEI1,31080,CA,06037,1,1,205000,5000,1200,0,NA",
    "2024,lei1,31080,CA,06037,1,31,105000,3000,800,500,Exempt",
    "2024,LEI1,31080,CA,06059,1,1,305000,4000,NA,NA,NA",
    "2024,LEI2,99999,CA,NA,1,2,NA,Exempt,Exempt,Exempt,Exempt",
    "2024,,31080,CA,06037,1,1,100000,1,1,1,1",
    "2024,LEI3,31080,CA,06037,3,1,100000,1,1,1,1",
    "2024,LEI3,31080,CA",
  ].join("\r\n");

  it("sums lender x county cells and keeps cost medians per lender x MSA", async () => {
    const { acc, bytes } = await accumulateHmdaCsv(stream(body), 2024, "CA");
    expect(bytes).toBeGreaterThan(0);
    expect(acc?.usable).toBe(true);
    expect(acc?.missingFields).toEqual([]);
    const cells = acc!.originationCells();
    const la = cells.find((c) => c.lei === "LEI1" && c.countyFips === "06037")!;
    expect(la).toMatchObject({ originations: 2, originationAmount: 310000, purchaseCount: 1, refinanceCount: 1, refinanceAmount: 105000 });
    const lei2 = cells.find((c) => c.lei === "LEI2")!;
    expect(lei2).toMatchObject({ countyFips: null, msaMd: "99999", originations: 1, originationAmount: 0, amountMissing: 1 });
    const cost = acc!.costCellsOut().find((c) => c.lei === "LEI1")!;
    expect(cost.originations).toBe(3);
    expect(cost.costs.total_loan_costs).toMatchObject({ n: 3, median: 4000 });
    expect(cost.costs.lender_credits).toMatchObject({ n: 0, median: null, na: 2, exempt: 1 });
    expect(acc!.stats).toMatchObject({ noLei: 1, notOriginated: 1, malformedRows: 1, noCounty: 1, outsideMsa: 1, loanAmountMissing: 1 });
  });

  it("reports a header without the required fields as unusable", async () => {
    const { acc } = await accumulateHmdaCsv(stream("<html>error</html>\n"), 2024, "CA");
    expect(acc?.usable).toBe(false);
    expect(acc?.missingFields).toContain("lei");
  });
});

describe("HMDA panel and aggregations", () => {
  it("reads the RSSD from whichever candidate column exists", () => {
    const panel = parseHmdaPanel("lei,respondent_rssd,respondent_name\nlei1,480228,Bank A\nLEI1,480228,Bank A\n", "u");
    expect(panel.rssdField).toBe("RESPONDENT_RSSD");
    expect(panel.lenders.get("LEI1")).toMatchObject({ rssdId: "480228", respondentName: "Bank A" });
    expect(panel.duplicateLeis).toBe(1);
    expect(panel.conflictingLeis).toEqual([]);
    expect(panel.missingFields).toContain("PARENT_RSSD");
  });

  it("deduplicates only a shared positive respondent RSSD, ignoring numeric padding", () => {
    const panel = parseHmdaPanel("lei,respondent_rssd\nLEI1,000480228\nlei1,480228\n", "u");
    expect(panel.lenders.get("LEI1")?.rssdId).toBe("480228");
    expect(panel.duplicateLeis).toBe(1);
    expect(panel.conflictingLeis).toEqual([]);
  });

  it.each([["480228", "999"], ["480228", ""], ["-1", "480228"], ["", ""], ["0", "NA"]])(
    "holds conflicting or missing duplicate respondent keys (%s, %s) in either order",
    (first, second) => {
      for (const values of [[first, second], [second, first]]) {
        const panel = parseHmdaPanel(`lei,respondent_rssd\nLEI1,${values[0]}\nlei1,${values[1]}\n`, "u");
        expect(panel.lenders.get("LEI1")?.rssdId).toBeNull();
        expect(panel.duplicateLeis).toBe(1);
        expect(panel.conflictingLeis).toEqual(["LEI1"]);
      }
    },
  );

  it("does not restore a conflicted LEI when a later row repeats one candidate", () => {
    const panel = parseHmdaPanel("lei,respondent_rssd\nLEI1,480228\nLEI1,999\nLEI1,480228\n", "u");
    expect(panel.conflictingLeis).toEqual(["LEI1"]);
    expect(panel.lenders.get("LEI1")?.rssdId).toBeNull();
    expect(panel.duplicateLeis).toBe(2);
  });

  it("reads the actual 2023 TOPHOLDER_RSSD header without treating it as respondent identity", () => {
    const panel = parseHmdaPanel("lei,respondent_rssd,parent_rssd,topholder_rssd\nLEI1,-1,999,888\n", "u");
    expect(panel.lenders.get("LEI1")).toMatchObject({ rssdId: null, parentRssd: "999", topHolderRssd: "888" });
    expect(panel.missingFields).not.toContain("TOPHOLDER_RSSD");
  });

  it.each([2024, 2025])("does not send an HTTP request for the retired %s panel", async (year) => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    const panel = await fetchHmdaPanel(year, { fetchImpl, backoffMs: 0 });
    expect(panel).toMatchObject({ available: false, note: expect.stringContaining("discontinued") });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("unzips the panel csv", async () => {
    const zip = zipSync({ "2023_public_panel_csv.csv": strToU8("lei,id_rssd\nLEI1,1\n") });
    const fetchImpl = vi.fn(async () => new Response(zip as unknown as BodyInit, { status: 200 })) as unknown as typeof fetch;
    const panel = await fetchHmdaPanel(2023, { fetchImpl, backoffMs: 0 });
    expect(panel.rssdField).toBe("ID_RSSD");
    expect(panel.lenders.get("LEI1")?.rssdId).toBe("1");
  });

  it("reads the state's count and sum, and says why when it cannot", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ aggregations: [{ count: 3, sum: 615000 }] }), { status: 200 })) as unknown as typeof fetch;
    expect(await fetchHmdaStateAggregate(2024, "CA", { fetchImpl: ok, backoffMs: 0 })).toEqual({ count: 3, sum: 615000, note: null });
    const odd = vi.fn(async () => new Response(JSON.stringify({ rows: [] }), { status: 200 })) as unknown as typeof fetch;
    expect((await fetchHmdaStateAggregate(2024, "CA", { fetchImpl: odd, backoffMs: 0 })).note).toMatch(/no aggregations array/);
  });
});

describe("APOR tables", () => {
  it("reads a pipe table, leaves blanks out and reports odd cells", () => {
    const t = parseAporTable("Date|1|2|30\n1/2/2025|6.10|6.20|\n2025-01-09|6.00|x|6.90\nnot a date|1|1|1\n", "fixed");
    expect(t.delimiter).toBe("|");
    expect(t.termColumns).toEqual([1, 2, 30]);
    expect(t.rates).toContainEqual({ rateType: "fixed", effectiveDate: "2025-01-02", termYears: 1, apor: 6.1 });
    expect(t.rates).toHaveLength(4);
    expect(t).toMatchObject({ undatedRows: 1, unreadableCells: 1 });
  });

  it("loads nothing from a header without term columns", () => {
    expect(parseAporTable("a,b\n1,2\n", "adjustable").note).toMatch(/no numeric term columns/);
  });

  it("falls back to the next location", async () => {
    const fetchImpl = vi.fn(async (url: unknown) =>
      String(url).includes("s3.amazonaws") ? new Response("gone", { status: 404 }) : new Response("Date,1\n1/2/2025,6\n", { status: 200 }),
    ) as unknown as typeof fetch;
    const t = await fetchAporTable("fixed", { fetchImpl, backoffMs: 0 });
    expect(t.url).toContain("ffiec.cfpb.gov");
    expect(t.rates).toHaveLength(1);
  });
});

describe("hmdaCleaningReport", () => {
  it("reports gaps, reconciliation and outliers without changing values", () => {
    const acc = new HmdaAccumulator(HEADER.split(","), 2024, "CA");
    for (let i = 0; i < 5; i += 1) acc.addRow(`2024,LEI1,31080,CA,06037,1,1,200000,4000,1000,0,0`.split(","));
    for (let i = 0; i < 5; i += 1) acc.addRow(`2024,LEI2,31080,CA,06059,1,1,300000,5000,1000,0,0`.split(","));
    for (let i = 0; i < 5; i += 1) acc.addRow(`2024,LEI3,41860,CA,06075,1,1,90000000,90000,1000,0,0`.split(","));
    acc.addRow(`2024,LEI4,41860,CA,06075,1,1,100000,-5,1000,0,0`.split(","));
    const before = JSON.stringify(acc.originationCells());
    const report = hmdaCleaningReport({
      pull: { url: "u", bytes: 1, firstLine: HEADER, acc },
      aggregate: { count: 15, sum: null, note: null },
      panel: { url: "p", available: true, note: null, lenders: new Map(), rssdField: null, missingFields: [], duplicateLeis: 0 },
    });
    expect(JSON.stringify(acc.originationCells())).toBe(before);
    expect(report.reconciliation).toMatchObject({ streamed_count: 16, data_browser_count: 15, count_difference: 1, sum_difference: null });
    expect(report.average_loan_outliers.count).toBe(1);
    expect(report.average_loan_outliers.examples[0].lei).toBe("LEI3");
    expect(report.cost_values_negative.total_loan_costs).toBe(1);
    expect(report.cost_reporting_lenders.total_loan_costs).toEqual({ reported: 3, exempt_only: 0, blank_or_na_only: 1 });
    expect(report.rows.loanAmountOutliers).toBe(5);
    expect(report.lenders_not_in_panel).toBe(4);
    expect(report.unmatched_lenders).toBeNull();
  });
});

describe("HMDA header spelling", () => {
  it('reads the Data Browser\'s "derived_msa-md" column as derived_msa_md (2025-AL prod run)', () => {
    const acc = new HmdaAccumulator(HEADER.replace("derived_msa_md", "derived_msa-md").split(","), 2025, "AL");
    expect(acc.usable).toBe(true);
    expect(acc.missingFields).not.toContain("derived_msa_md");
  });
});
