import { ncuaCallMeasure } from "@/lib/data-catalog/ncua-call-measures";
import { sql } from "./connection";
import { readColdCallRows, type ColdFileRef } from "@/lib/data-catalog/cold-reads";
import { inSavepoint } from "@/lib/agents/savepoint";

/**
 * A live re-read of the filing rows a Hamilton answer's supported filing claims rest on (#1077,
 * claim contract step 7). The paid answer eval ties each such claim to the row as it stands now,
 * not as the answer's tools read it. Read-only selects; no model call, no write.
 *
 * Values come back on the same terms as the claim facts (hamilton/claim-evidence.ts):
 * - `institution_financial_records`: dollar fields are stored in thousands and returned in dollars;
 *   `fee_income_ratio` is the stored fraction. An NCUA standalone quarter is the year to date minus
 *   the prior quarter's year to date in the same year (Q1 as filed), the split `QUARTER_SC` makes
 *   (call-report-sql.ts); with no prior quarter on file there is no live quarter.
 * - `institution_call_report_items`: the NCUA line with the measure's own item code, stored unit
 *   and period basis, as stored (dollars or a count, as `queryData` returns it). A pruned quarter
 *   is re-read from its verified archive on exactly the same terms; storage movement is not a
 *   missing fact. Corrupt, incomplete or unavailable archives remain missing.
 */

export type FilingRereadTable = "institution_financial_records" | "institution_call_report_items";

export interface FilingRereadKey {
  /** The claim fact's ID; the result is keyed by it. */
  id: string;
  table: FilingRereadTable;
  source: "fdic" | "ncua";
  institutionId: number;
  /** A quarter end, YYYY-MM-DD. */
  reportDate: string;
  /** A financial-record column, or a `call:<item key>` measure. */
  metric: string;
  basis: "ytd" | "standalone_quarter" | "point_in_time";
}

/** The financial-record columns a claim fact can name, and whether each is money. */
const RECORD_FIELDS: Readonly<Record<string, "usd" | "fraction">> = {
  service_charge_income: "usd",
  total_revenue: "usd",
  total_assets: "usd",
  total_deposits: "usd",
  fee_income_ratio: "fraction",
};

const QUARTER_END = /^(20\d{2})-(03-31|06-30|09-30|12-31)$/;

const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** The quarter end before `reportDate` in the same year; null for Q1. */
export function priorQuarterEnd(reportDate: string): string | null {
  const match = QUARTER_END.exec(reportDate);
  if (!match) return null;
  const prior: Record<string, string | null> = { "03-31": null, "06-30": "03-31", "09-30": "06-30", "12-31": "09-30" };
  const end = prior[match[2]];
  return end ? `${match[1]}-${end}` : null;
}

export type FinancialRecordRow = { institution_id: unknown; report_date: unknown; source: unknown } & Record<string, unknown>;

/**
 * One key's live value from financial-record rows (any of the institution's rows; the right ones
 * are picked here). Null when no live row holds it. Pure, so the split is tested without a database.
 */
export function financialRecordValue(key: FilingRereadKey, rows: readonly FinancialRecordRow[]): number | null {
  const kind = RECORD_FIELDS[key.metric];
  if (!kind) return null;
  const rowOn = (date: string) => rows.find((r) => Number(r.institution_id) === key.institutionId && String(r.source) === key.source
    && String(r.report_date instanceof Date ? r.report_date.toISOString().slice(0, 10) : r.report_date).slice(0, 10) === date);
  const stored = numberOrNull(rowOn(key.reportDate)?.[key.metric]);
  if (stored === null) return null;
  let value = stored;
  if (key.source === "ncua" && key.basis === "standalone_quarter") {
    const prior = priorQuarterEnd(key.reportDate);
    if (prior) {
      const before = numberOrNull(rowOn(prior)?.[key.metric]);
      if (before === null) return null;
      value = stored - before;
    }
  }
  return kind === "usd" ? value * 1000 : value;
}

/** Live values for each key: a number, or null when no live row holds it. Throws when the database cannot be read. */
export async function readFilingValues(keys: readonly FilingRereadKey[], db: typeof sql = sql): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const records = keys.filter((k) => k.table === "institution_financial_records" && RECORD_FIELDS[k.metric] && QUARTER_END.test(k.reportDate));
  const calls = keys.filter((k) => k.table === "institution_call_report_items" && k.source === "ncua" && QUARTER_END.test(k.reportDate));
  const archiveIndex = new Map<string, Promise<ColdFileRef | null>>();
  const archiveReads = new Map<string, ReturnType<typeof readColdCallRows>>();
  for (const key of keys) out.set(key.id, null);

  if (records.length > 0) {
    const ids = [...new Set(records.map((k) => k.institutionId))];
    const dates = [...new Set(records.flatMap((k) => [k.reportDate, ...(priorQuarterEnd(k.reportDate) ? [priorQuarterEnd(k.reportDate)!] : [])]))];
    const rows = await db<FinancialRecordRow[]>`
      SELECT institution_id, report_date, source,
             service_charge_income, total_revenue, total_assets, total_deposits, fee_income_ratio
        FROM institution_financial_records
       WHERE institution_id = ANY(${ids}::bigint[])
         AND source IN ('fdic', 'ncua')
         AND report_date::text = ANY(${dates}::text[])
    `;
    for (const key of records) out.set(key.id, financialRecordValue(key, [...rows]));
  }

  for (const key of calls) {
    const measure = ncuaCallMeasure(key.metric.replace(/^call:/, ""));
    if (!measure || measure.periodBasis !== key.basis) continue;
    const [row] = await db<Array<{ value: unknown }>>`
      SELECT value
        FROM institution_call_report_items
       WHERE institution_id = ${key.institutionId}
         AND source = 'ncua'
         AND item_key = ${measure.key}
         AND item_code = ${measure.code}
         AND unit = ${measure.storedUnit}
         AND period_basis = ${measure.periodBasis}
         AND report_date = ${key.reportDate}::date
       LIMIT 1
    `;
    // The measure's stored unit is dollars or a count, as queryData returns it: no rescaling.
    if (row) { out.set(key.id, numberOrNull(row.value)); continue; }
    if (!archiveIndex.has(key.reportDate)) archiveIndex.set(key.reportDate, inSavepoint(db, async (scope) => {
      const [file] = await scope<Array<{ source: string; period: string; object_key: string; row_count: string; sha256: string }>>`
        SELECT source,period,object_key,row_count,sha256 FROM public_data_cold_files
         WHERE table_name=${"institution_call_report_items"} AND source='ncua' AND period=${key.reportDate}
           AND pruned_at IS NOT NULL AND verified_at IS NOT NULL
      `;
      return file ? {source:file.source,period:file.period,objectKey:file.object_key,rowCount:Number(file.row_count),sha256:file.sha256} : null;
    }).catch(() => null));
    const file = await archiveIndex.get(key.reportDate)!;
    if (!file) continue;
    const cacheKey = `${key.reportDate}|${key.metric}`;
    if (!archiveReads.has(cacheKey)) archiveReads.set(cacheKey, readColdCallRows([file], {
      itemKey: measure.key,
      institutionIds: [...new Set(calls.filter((k) => k.reportDate===key.reportDate && k.metric===key.metric).map((k) => k.institutionId))],
    }));
    const archived = await archiveReads.get(cacheKey)!;
    if (archived.failed.length || archived.incomplete?.length) continue;
    out.set(key.id, numberOrNull(archived.rows.find((r) => r.institution_id===key.institutionId)?.value));
  }
  return out;
}
