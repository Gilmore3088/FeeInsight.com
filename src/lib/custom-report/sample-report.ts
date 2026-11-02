import { sql } from "@/lib/data-store/connection";
import { getCustomReportMarketDataCached } from "@/lib/data-store/public-cached-reads";
import { cachedPublicRead } from "@/lib/data-store/public-read-cache";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { analyzeMarket } from "./analysis";
import type { MarketReport } from "./report-data";

/**
 * The public sample report (value funnel A5) is a live report for one real community bank,
 * built by the same code a buyer's report uses, so it can never drift from what a buyer
 * gets. The institution is chosen in this order:
 *   1. SAMPLE_REPORT_INSTITUTION_ID, when set, pins it (ready or not).
 *   2. DEMO_SAMPLE_INSTITUTION_ID, when its local market passes the readiness bar today
 *      and names at least SAMPLE_MIN_NAMED competitors.
 *   3. Otherwise the first candidate whose local market passes the readiness bar today.
 * When none passes, there is no sample and the page says one is on its way.
 */

/**
 * Capital City Bank (Tallahassee, FL), the lead bank of James's standard demo set for every
 * site example, demo and video: Capital City Bank, U.S. Bank, M&T Bank, Navy Federal and
 * SchoolsFirst FCU. Never use Frost Bank in a sample, demo or video.
 */
export const DEMO_SAMPLE_INSTITUTION_ID = 323;

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

const sampleCandidateIdsCached = cachedPublicRead("sample-report-candidates-v2", sampleCandidateIds);

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

/** Today's sample: the chosen institution and its report, or null when no candidate passes. */
async function findSampleReport(): Promise<{ id: number; report: MarketReport } | null> {
  const pinned = pinnedSampleInstitutionId();
  if (pinned) {
    const result = await evaluate(pinned);
    return result.ready && result.report ? { id: pinned, report: result.report } : null;
  }
  const demo = await evaluate(DEMO_SAMPLE_INSTITUTION_ID);
  if (demo.ready && demo.named >= SAMPLE_MIN_NAMED && demo.report) return { id: demo.id, report: demo.report };
  // A ready demo naming too few competitors still competes on the automatic fallback.
  const evaluated: Awaited<ReturnType<typeof evaluate>>[] = demo.ready ? [demo] : [];
  for (const id of await sampleCandidateIdsCached()) {
    if (id === DEMO_SAMPLE_INSTITUTION_ID) continue;
    const result = await evaluate(id);
    evaluated.push(result);
    if (result.ready && result.named >= SAMPLE_MIN_NAMED) break;
  }
  const chosen = evaluated.find((c) => c.id === chooseSample(evaluated));
  return chosen?.report ? { id: chosen.id, report: chosen.report } : null;
}

/**
 * Which institution today's sample is for, as one shared cached answer. Choosing loads and
 * analyses at least the demo bank's whole market report, and up to 13 of them when it does not
 * pass. Every institution, fee and research page asks whether a sample exists, and each used to
 * answer by choosing again (findings/2026-11-02-sample-report-chosen-on-every-page.md).
 */
const sampleInstitutionCached = cachedPublicRead(
  "sample-report-institution-v1",
  async () => ({ id: (await findSampleReport())?.id ?? null }),
  () => false,
);

/** The live sample report, or null when no candidate's market passes today. */
export async function loadSampleReport(): Promise<MarketReport | null> {
  const { id } = await sampleInstitutionCached();
  if (id === null) return null;
  const chosen = await evaluate(id);
  if (chosen.ready && chosen.report) return chosen.report;
  // The remembered choice no longer passes (its market changed since): choose again.
  return (await findSampleReport())?.report ?? null;
}

/** Whether the live sample exists today, so links to it never land on the "on its way" note. */
export async function sampleReportAvailable(): Promise<boolean> {
  const choice = await sampleInstitutionCached().catch(() => ({ id: null }));
  return choice.id !== null;
}
