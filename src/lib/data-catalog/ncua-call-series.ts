import { unstable_cache } from "next/cache";
import { withTransaction } from "@/lib/data-store/connection";
import { NCUA_CALL_MEASURES, ncuaCallMeasure, type NcuaCallMeasure } from "./ncua-call-measures";

export interface NcuaCallSeries extends NcuaCallMeasure {
  periodMin: string;
  periodMax: string;
  sourceUrl: string | null;
  fetchedAt: string | null;
}

interface BoundsRow {
  item_key: string;
  period_min: string;
  period_max: string;
  source_url: string | null;
  fetched_at: string | Date | null;
}

type Db = Parameters<Parameters<typeof withTransaction>[0]>[0];
export const NCUA_CALL_SERIES_CACHE_SECONDS = 300;
const RETRY_COOLDOWN_MS = 60_000;

/**
 * Twelve bounded index probes, not a scan of the call-report warehouse. The existing
 * (item_key, report_date) index can find each selected line's first/last comparable filing.
 * A missing/contradictory line is not advertised. Bounds do not imply every quarter or CU filed.
 */
export async function readNcuaCallSeries(db?: Db): Promise<NcuaCallSeries[]> {
  const selected = JSON.stringify(NCUA_CALL_MEASURES.map((m) => ({
    item_key: m.key, item_code: m.code, stored_unit: m.storedUnit, period_basis: m.periodBasis,
  })));
  const run = async (tx: Db) => {
    await tx`SET LOCAL statement_timeout = '5s'`;
    const rows = await tx<BoundsRow[]>`
      WITH selected AS (
        -- Bind serialized JSON as text so postgres-js does not encode the string a second time.
        SELECT * FROM jsonb_to_recordset(${selected}::text::jsonb)
          AS k(item_key text, item_code text, stored_unit text, period_basis text)
      )
      SELECT k.item_key, first.period AS period_min, last.period AS period_max,
             last.source_url, last.fetched_at
        FROM selected k
        JOIN LATERAL (
          SELECT to_char(c.report_date, 'YYYY-MM-DD') AS period
            FROM institution_call_report_items c
           WHERE c.item_key = k.item_key AND c.item_code = k.item_code AND c.source = 'ncua'
             AND c.unit = k.stored_unit AND c.period_basis = k.period_basis AND c.value IS NOT NULL
           ORDER BY c.report_date ASC LIMIT 1
        ) first ON true
        JOIN LATERAL (
          SELECT to_char(c.report_date, 'YYYY-MM-DD') AS period, c.source_url, c.fetched_at
            FROM institution_call_report_items c
           WHERE c.item_key = k.item_key AND c.item_code = k.item_code AND c.source = 'ncua'
             AND c.unit = k.stored_unit AND c.period_basis = k.period_basis AND c.value IS NOT NULL
           ORDER BY c.report_date DESC LIMIT 1
        ) last ON true
       ORDER BY k.item_key
    `;
    return [...rows].flatMap((row): NcuaCallSeries[] => {
      const definition = ncuaCallMeasure(row.item_key);
      if (!definition) return [];
      return [{ ...definition, periodMin: row.period_min, periodMax: row.period_max,
        sourceUrl: row.source_url, fetchedAt: row.fetched_at ? new Date(row.fetched_at).toISOString() : null }];
    });
  };
  if (!db) return withTransaction(run);
  const root = db as Db & { begin?: (cb: (tx: Db) => Promise<NcuaCallSeries[]>) => Promise<NcuaCallSeries[]> };
  return typeof root.begin === "function" ? root.begin(run) : run(db);
}

const cachedRead = unstable_cache(readNcuaCallSeries, ["data-catalog", "ncua-call-series-v1"], {
  revalidate: NCUA_CALL_SERIES_CACHE_SECONDS,
});
let inFlight: Promise<NcuaCallSeries[]> | null = null;
let retryAfter = 0;

/** Test hook: clear only the process-level single-flight/retry guard. */
export function resetNcuaCallSeriesRetry(): void {
  inFlight = null;
  retryAfter = 0;
}

/** Short cached metadata read, shared between Hamilton surfaces; failures are not empty coverage. */
export function getNcuaCallSeries(): Promise<NcuaCallSeries[]> {
  if (Date.now() < retryAfter) return Promise.reject(new Error("NCUA measure discovery is temporarily unavailable"));
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      try {
        return await cachedRead();
      } catch (error) {
        // Tests/CLI callers have no Next incremental cache. Still use the same bounded reader.
        if (error instanceof Error && error.message.startsWith("Invariant: incrementalCache missing")) return await readNcuaCallSeries();
        throw error;
      }
    } catch (error) {
      retryAfter = Date.now() + RETRY_COOLDOWN_MS;
      throw error;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
