/**
 * The free, instant benchmark reports a visitor picks on the report request form:
 * the National report (no input) and one Federal Reserve district report. Both cover the
 * 15 headline fee categories from published_fee_catalog. A report about one institution
 * and its competitors is the paid step and is never built here.
 *
 * Client-safe: the request form imports these helpers. The rows that need the data
 * store live in benchmark-report-rows.ts.
 */
import { DISTRICT_NAMES } from "@/lib/fed-districts";

export type BenchmarkScope = { kind: "national" } | { kind: "district"; district: number };

export const BENCHMARK_REPORT_BASE_PATH = "/reports/benchmark";
const DISTRICT_SLUG = /^district-(\d{1,2})$/;

export function isFedDistrict(value: number): boolean {
  return Number.isInteger(value) && DISTRICT_NAMES[value] !== undefined;
}

export function parseBenchmarkScope(slug: string): BenchmarkScope | null {
  if (slug === "national") return { kind: "national" };
  const match = DISTRICT_SLUG.exec(slug);
  if (!match) return null;
  const district = Number(match[1]);
  return isFedDistrict(district) ? { kind: "district", district } : null;
}

export function benchmarkScopeSlug(scope: BenchmarkScope): string {
  return scope.kind === "national" ? "national" : `district-${scope.district}`;
}

export function benchmarkReportPath(scope: BenchmarkScope): string {
  return `${BENCHMARK_REPORT_BASE_PATH}/${benchmarkScopeSlug(scope)}`;
}

export function benchmarkReportTitle(scope: BenchmarkScope): string {
  return scope.kind === "national"
    ? "National Fee Benchmark Report"
    : `Fed District ${scope.district} (${DISTRICT_NAMES[scope.district]}) Fee Benchmark Report`;
}
