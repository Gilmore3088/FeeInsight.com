import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const mockSql = Object.assign(vi.fn(), { unsafe: vi.fn((text: string) => text) });
  return { getSql: () => mockSql, sql: mockSql };
});

import { sql } from "./connection";
import { getCharterFeeRevenueSummary, getFeeRevenueData, getTierFeeRevenueSummary } from "./fee-revenue";
import { getFeeDependencyTrend, getRevenuePerInstitutionTrend } from "./derived-analytics";

/**
 * #1950: Postgres has round(numeric, integer) but no round(double precision, integer).
 * AVG over PERCENTILE_CONT (always double precision) or over a float column is a double, so
 * every two-argument ROUND in SQL must cast its first argument to numeric. Returns each
 * two-argument ROUND(...) call whose first argument does not end in ::numeric.
 */
function uncastTwoArgRounds(text: string): string[] {
  const bad: string[] = [];
  const re = /\bround\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let comma = -1;
    let i = start;
    for (; i < text.length && depth > 0; i++) {
      const ch = text[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 1) comma = i;
    }
    if (comma === -1) continue;
    const first = text.slice(start, comma).trim();
    if (!/::numeric$/i.test(first)) bad.push(text.slice(m.index, i).replace(/\s+/g, " "));
  }
  return bad;
}

const mock = sql as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function capturedSql(): string {
  return mock.mock.calls.map((call) => (Array.isArray(call[0]) ? call[0].join(" ") : String(call[0]))).join("\n");
}

beforeEach(() => {
  mock.mockReset();
  mock.mockResolvedValue([]);
});

describe("uncastTwoArgRounds", () => {
  it("flags a double rounded to places and passes numeric casts and one-argument rounds", () => {
    expect(uncastTwoArgRounds("ROUND(AVG(x), 2)")).toEqual(["ROUND(AVG(x), 2)"]);
    expect(uncastTwoArgRounds("ROUND(AVG(\n  CASE WHEN a > 0 THEN b ELSE NULL END\n), 2)")).toHaveLength(1);
    expect(uncastTwoArgRounds("ROUND(AVG(x)::numeric, 2)")).toEqual([]);
    expect(uncastTwoArgRounds("ROUND((a * 1.0 / b)::numeric, 2)")).toEqual([]);
    expect(uncastTwoArgRounds("ROUND(s.asset_size / 1000.0)")).toEqual([]);
  });
});

describe("SQL round casts to numeric (#1950)", () => {
  it.each([
    ["getFeeRevenueData", () => getFeeRevenueData()],
    ["getTierFeeRevenueSummary", () => getTierFeeRevenueSummary()],
    ["getCharterFeeRevenueSummary", () => getCharterFeeRevenueSummary()],
    ["getFeeDependencyTrend", () => getFeeDependencyTrend()],
    ["getRevenuePerInstitutionTrend", () => getRevenuePerInstitutionTrend()],
  ])("%s rounds only numeric values", async (_name, read) => {
    await read();
    const text = capturedSql();
    expect(text).toMatch(/ROUND\(/);
    expect(uncastTwoArgRounds(text)).toEqual([]);
  });

  it("fee-revenue pins the cast on every rounded column", async () => {
    await getTierFeeRevenueSummary();
    const text = capturedSql();
    expect(text).toContain("ROUND(AVG(ifin.service_charge_income)::numeric, 0) as avg_service_charge_income");
    expect(text).toContain("ROUND(AVG(ef_avg.avg_fee)::numeric, 2) as avg_fee_amount");
    expect(text).toMatch(/\)::numeric, 2\) as avg_fee_income_ratio/);
    mock.mockClear();
    await getFeeRevenueData();
    const detail = capturedSql();
    expect(detail).toContain("ROUND(ef.avg_fee::numeric, 2) as avg_fee");
    expect(detail).toContain("ROUND((ifin.service_charge_income * 1.0 / ifin.total_assets * 10000)::numeric, 2)");
  });

  it("no data-store source file rounds a non-numeric value to places", () => {
    const dir = join(process.cwd(), "src/lib/data-store");
    const offenders: string[] = [];
    for (const file of readdirSync(dir, { recursive: true }) as string[]) {
      if (!/\.ts$/.test(file) || /\.test(-helper)?\.ts$/.test(file)) continue;
      const source = readFileSync(join(dir, file), "utf8");
      // Only SQL spells ROUND in capitals; the TypeScript round() helpers are lowercase.
      const sqlRounds = uncastTwoArgRounds(source).filter((call) => call.startsWith("ROUND"));
      for (const call of sqlRounds) offenders.push(`${file}: ${call}`);
    }
    expect(offenders).toEqual([]);
  });
});
