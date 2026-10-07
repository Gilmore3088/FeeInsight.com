import { sql } from "@/lib/data-store/connection";
import { getCustomReportMarketDataCached } from "@/lib/data-store/public-cached-reads";
import { cachedPublicRead } from "@/lib/data-store/public-read-cache";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { analyzeMarket } from "./analysis";
import type { MarketReport } from "./report-data";

/**
 * The public sample report (value funnel A5) is a live report for one real community bank,
 * built by the same code a buyer's report uses, so it can never drift from what a buyer
 * gets. SAMPLE_REPORT_INSTITUTION_ID pins the institution; otherwise the sample is the
 * first candidate whose local market passes the readiness bar today. When none passes,
 * there is no sample and the page says one is on its way.
 */

/** Community banks, by asset_size (thousands of dollars): $250M to $2B. */
const SAMPLE_MIN_ASSETS = 250_000;
const SAMPLE_MAX_ASSETS = 2_000_000;
/** Headline fee categories the bank itself must publish, so its own column reads full. */
const SAMPLE_MIN_OWN_CATEGORIES = 12;
const SAMPLE_CANDIDATES = 12;
/** A sample worth showing names at least this many local competitors. */
export const SAMPLE_MIN_NAMED = 5;

export interface SampleCandidate {
  id: number;
  ready: boolean;
  named: number;
  competitorsWithData: number;
}

/** First ready candidate naming SAMPLE_MIN_NAMED+ competitors, else the ready one naming most. */
export function chooseSample(candidates: SampleCandidate[]): number | null {
  const ready = candidates.filter((c) => c.ready);
  const full = ready.find((c) => c.named >= SAMPLE_MIN_NAMED);
  if (full) return full.id;
  const best = [...ready].sort((a, b) => b.named - a.named || b.competitorsWithData - a.competitorsWithData)[0];
  return best?.id ?? null;
}

export function pinnedSampleInstitutionId(raw = process.env.SAMPLE_REPORT_INSTITUTION_ID): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function sampleCandidateIds(): Promise<number[]> {
  const keys = [...HEADLINE_FEE_KEYS];
  const rows = await sql<{ id: number }[]>`
    WITH coverage AS (
      SELECT institution_id, COUNT(DISTINCT canonical_fee_key) AS categories
      FROM published_fee_catalog
      WHERE canonical_fee_key = ANY(${keys})
      GROUP BY institution_id
    )
    SELECT s.id
    FROM institution_sources s
    JOIN coverage c ON c.institution_id = s.id
    WHERE s.charter_type = 'bank'
      AND COALESCE(s.regulatory_status, 'active') <> 'inactive'
      AND s.asset_size >= ${SAMPLE_MIN_ASSETS} AND s.asset_size < ${SAMPLE_MAX_ASSETS}
      AND c.categories >= ${SAMPLE_MIN_OWN_CATEGORIES}
    ORDER BY c.categories DESC, ABS(s.asset_size - 500000), s.id
    LIMIT ${SAMPLE_CANDIDATES}`;
  return rows.map((row) => Number(row.id));
}

const sampleCandidateIdsCached = cachedPublicRead("sample-report-candidates", sampleCandidateIds);

async function evaluate(id: number): Promise<SampleCandidate & { report: MarketReport | null }> {
  const data = await getCustomReportMarketDataCached(id);
  if (!data?.market) return { id, ready: false, named: 0, competitorsWithData: 0, report: null };
  const analysis = analyzeMarket(data);
  return {
    id,
    ready: analysis.readiness.ready,
    named: analysis.named.length,
    competitorsWithData: analysis.readiness.competitorsWithData,
    report: { data, analysis, savedAt: null, sinceBought: null },
  };
}

/** The live sample report, or null when no candidate's market passes today. */
export async function loadSampleReport(): Promise<MarketReport | null> {
  const pinned = pinnedSampleInstitutionId();
  if (pinned) {
    const result = await evaluate(pinned);
    return result.ready ? result.report : null;
  }
  const evaluated: Awaited<ReturnType<typeof evaluate>>[] = [];
  for (const id of await sampleCandidateIdsCached()) {
    const result = await evaluate(id);
    evaluated.push(result);
    if (result.ready && result.named >= SAMPLE_MIN_NAMED) break;
  }
  const chosen = chooseSample(evaluated);
  return evaluated.find((c) => c.id === chosen)?.report ?? null;
}
