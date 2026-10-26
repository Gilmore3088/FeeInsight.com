import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));
const coldRead = vi.hoisted(() => vi.fn());
vi.mock("@/lib/data-catalog/cold-reads", () => ({ readColdCallRows: coldRead }));
const { financialRecordValue, priorQuarterEnd, readFilingValues } = await import("./filing-reread");
type Key = Parameters<typeof financialRecordValue>[0];

// Synthetic institutions only (Bank A 9001, a credit union 9101); no figure here is live data.
const key = (change: Partial<Key>): Key => ({
  id: "k", table: "institution_financial_records", source: "fdic", institutionId: 9001, reportDate: "2026-06-30",
  metric: "service_charge_income", basis: "standalone_quarter", ...change,
});
const row = (institution_id: number, report_date: string, source: string, fields: Record<string, unknown>) => ({ institution_id, report_date, source, ...fields });

describe("the live filing re-read (#1077 step 7)", () => {
  it("rechecks archived claims from a verified file once per period/measure, preserving a reported zero", async () => {
    coldRead.mockResolvedValue({rows:[{institution_id:9101,value:0},{institution_id:9102,value:1250}],failed:[],incomplete:[]});
    const db=vi.fn(async(parts:TemplateStringsArray)=>parts.join("").includes("FROM public_data_cold_files")
      ? [{source:"ncua",period:"2023-03-31",object_key:"archive",row_count:"2",sha256:"0".repeat(64)}] : []);
    const a=key({id:"old-a",table:"institution_call_report_items",source:"ncua",institutionId:9101,reportDate:"2023-03-31",metric:"call:acct_452",basis:"point_in_time"});
    const out=await readFilingValues([a,{...a,id:"old-b",institutionId:9102}],db as never);
    expect(Object.fromEntries(out)).toEqual({"old-a":0,"old-b":1250});
    expect(coldRead).toHaveBeenCalledTimes(1);
    expect(coldRead.mock.calls[0][1]).toEqual({itemKey:"acct_452",institutionIds:[9101,9102]});
  });
  it("holds an archived claim when its file fails verification", async () => {
    coldRead.mockResolvedValue({rows:[{institution_id:9101,value:1250}],failed:["ncua 2023-03-31"]});
    const db=vi.fn(async(parts:TemplateStringsArray)=>parts.join("").includes("FROM public_data_cold_files")
      ? [{source:"ncua",period:"2023-03-31",object_key:"archive",row_count:"1",sha256:"0".repeat(64)}] : []);
    const out=await readFilingValues([key({table:"institution_call_report_items",source:"ncua",institutionId:9101,reportDate:"2023-03-31",metric:"call:acct_452",basis:"point_in_time"})],db as never);
    expect(out.get("k")).toBeNull();
  });
  it("names the prior quarter in the same year, and none for Q1", () => {
    expect(priorQuarterEnd("2026-06-30")).toBe("2026-03-31");
    expect(priorQuarterEnd("2026-12-31")).toBe("2026-09-30");
    expect(priorQuarterEnd("2026-03-31")).toBeNull();
    expect(priorQuarterEnd("2026-05-31")).toBeNull();
  });

  it("returns financial-record values on the claim facts' terms: dollars from stored thousands, the ratio as stored", () => {
    const rows = [row(9001, "2026-06-30", "fdic", { service_charge_income: "1100", total_assets: 400_000, fee_income_ratio: 0.1 })];
    expect(financialRecordValue(key({}), rows)).toBe(1_100_000);
    expect(financialRecordValue(key({ metric: "total_assets", basis: "point_in_time" }), rows)).toBe(400_000_000);
    expect(financialRecordValue(key({ metric: "fee_income_ratio" }), rows)).toBe(0.1);
    // Another institution, source or date, an unknown column or a null value is no live row.
    expect(financialRecordValue(key({ institutionId: 9002 }), rows)).toBeNull();
    expect(financialRecordValue(key({ source: "ncua", basis: "ytd" }), rows)).toBeNull();
    expect(financialRecordValue(key({ reportDate: "2026-03-31" }), rows)).toBeNull();
    expect(financialRecordValue(key({ metric: "roa" }), rows)).toBeNull();
    expect(financialRecordValue(key({ metric: "total_deposits" }), rows)).toBeNull();
  });

  it("splits an NCUA standalone quarter from the year to date, and gives none without the prior quarter", () => {
    const cu = (change: Partial<Key>) => key({ source: "ncua", institutionId: 9101, ...change });
    const rows = [row(9101, "2026-06-30", "ncua", { service_charge_income: 2600 }), row(9101, "2026-03-31", "ncua", { service_charge_income: 1200 })];
    expect(financialRecordValue(cu({}), rows)).toBe(1_400_000);
    expect(financialRecordValue(cu({ basis: "ytd" }), rows)).toBe(2_600_000);
    expect(financialRecordValue(cu({ reportDate: "2026-03-31" }), rows)).toBe(1_200_000);
    expect(financialRecordValue(cu({}), rows.slice(0, 1))).toBeNull();
  });

  it("reads each table once per need with plain selects, and keys every result by the fact ID", async () => {
    const queries: string[] = [];
    const db = vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const text = parts.join("?");
      queries.push(text);
      if (text.includes("FROM institution_financial_records")) {
        expect(values[1]).toEqual(["2026-06-30", "2026-03-31"]);
        return [row(9001, "2026-06-30", "fdic", { service_charge_income: 1100 })];
      }
      if (text.includes("FROM institution_call_report_items")) return values.includes("2026-06-30") ? [{ value: 1250 }] : [];
      return [];
    });
    const values = await readFilingValues([
      key({ id: "a" }),
      key({ id: "missing", institutionId: 9002 }),
      key({ id: "call", table: "institution_call_report_items", source: "ncua", institutionId: 9101, metric: "call:acct_452", basis: "point_in_time" }),
      key({ id: "call-old", table: "institution_call_report_items", source: "ncua", institutionId: 9101, reportDate: "2026-03-31", metric: "call:acct_452", basis: "point_in_time" }),
      key({ id: "call-basis", table: "institution_call_report_items", source: "ncua", institutionId: 9101, metric: "call:acct_452", basis: "ytd" }),
    ], db as never);
    expect(Object.fromEntries(values)).toEqual({ a: 1_100_000, missing: null, call: 1250, "call-old": null, "call-basis": null });
    expect(queries.every((q) => /^\s*SELECT/.test(q))).toBe(true);
    expect(queries.filter((q) => q.includes("institution_financial_records"))).toHaveLength(1);
    expect(queries.filter((q) => q.includes("institution_call_report_items"))).toHaveLength(2);
  });
});
