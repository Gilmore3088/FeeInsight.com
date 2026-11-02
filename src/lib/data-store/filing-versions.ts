import type { sql } from "./connection";

type Db = typeof sql;

/** One amendment of a filing quarter (#2613): the values it replaced, as [before, after]. */
export interface FilingAmendment {
  table: "institution_financial_records" | "institution_call_report_items";
  source: string;
  reportDate: string;
  itemKey: string | null;
  changed: Record<string, [unknown, unknown]>;
  supersededAt: string;
}

/**
 * The amendments to one institution's filing quarters after `since` (a saved claim's read time),
 * oldest first. Read-only; empty before the versions table exists, which the caller can tell apart
 * by `available`. A claim that cited a quarter listed here was read before the filing changed.
 */
export async function readFilingAmendments(
  db: Db,
  input: { institutionId: number; reportDates: readonly string[]; since: string },
): Promise<{ available: boolean; amendments: FilingAmendment[] }> {
  const [ready] = await db<{ ok: boolean }[]>`SELECT to_regclass('registry_filing_versions') IS NOT NULL AS ok`;
  if (!ready?.ok || input.reportDates.length === 0) return { available: Boolean(ready?.ok), amendments: [] };
  const rows = await db<{ table_name: FilingAmendment["table"]; source: string; report_date: string; item_key: string | null; changed: unknown; superseded_at: string }[]>`
    SELECT table_name, source, report_date::text AS report_date, item_key, changed, superseded_at::text AS superseded_at
      FROM registry_filing_versions
     WHERE institution_id = ${input.institutionId}
       AND report_date = ANY(${[...input.reportDates]}::date[])
       AND superseded_at > ${input.since}::timestamptz
     ORDER BY superseded_at, id
  `;
  return {
    available: true,
    amendments: rows.map((r) => ({
      table: r.table_name,
      source: r.source,
      reportDate: r.report_date,
      itemKey: r.item_key,
      changed: (typeof r.changed === "string" ? JSON.parse(r.changed) : r.changed) as FilingAmendment["changed"],
      supersededAt: r.superseded_at,
    })),
  };
}
