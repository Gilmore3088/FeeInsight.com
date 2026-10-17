/** Server reads behind lifecycleFields: a benchmark report's first finding and an institution's name. */
import { sql } from "@/lib/data-store/connection";
import { getNationalIndexCached } from "@/lib/data-store";
import { getPeerIndexCached } from "@/lib/data-store/public-cached-reads";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import type { BenchmarkScope } from "@/lib/benchmark-report";
import type { Finding } from "@/lib/research-report/finding";
import {
  buildReportCharterPairs,
  buildReportRows,
  computeDistrictFindings,
  computeNationalFindings,
} from "@/app/(public)/reports/benchmark/[scope]/report-data";
import type { LifecycleDeps } from "./lifecycle-fields";

/** The same reads and findings as the report page (reports/benchmark/[scope]/page.tsx), first one only. */
async function loadFinding(scope: BenchmarkScope): Promise<Finding | null> {
  const area = scope.kind === "district" ? { fed_districts: [scope.district] } : {};
  const [areaIndex, national, bank, cu] = await Promise.all([
    scope.kind === "district" ? getPeerIndexCached(area) : getNationalIndexCached(),
    scope.kind === "district" ? getNationalIndexCached() : Promise.resolve(null),
    getPeerIndexCached({ ...area, charter_type: "bank" }),
    getPeerIndexCached({ ...area, charter_type: "credit_union" }),
  ]);
  const rows = buildReportRows(areaIndex, national);
  const pairs = buildReportCharterPairs(bank, cu, rows);
  const findings = scope.kind === "national"
    ? computeNationalFindings(rows, pairs)
    : computeDistrictFindings(`${DISTRICT_NAMES[scope.district]} district`, rows, pairs);
  return findings[0] ?? null;
}

async function institutionName(id: number): Promise<string | null> {
  const [row] = await sql<{ institution_name: string | null }[]>`
    SELECT institution_name FROM institution_sources WHERE id = ${id}`;
  return row?.institution_name ?? null;
}

export const lifecycleDeps: LifecycleDeps = { loadFinding, institutionName };
