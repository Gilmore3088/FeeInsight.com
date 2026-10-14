/**
 * The analyst export: each fee an institution publishes, next to the national, state,
 * asset-size peer and local market benchmarks, one row per fee category. Values follow the
 * statistics contract (fee-stats.ts), so they match the index pages and Hamilton.
 */
import { sql } from "./connection";
import { getLocalMarketMembers } from "./custom-report-market";
import { getFeeValuesForInstitutions, getInstitutionFeeValues, getPeerIndexes, type IndexEntry } from "./fee-index";
import { marketMediansFrom } from "./regulatory-watch";
import { getNationalRateStats, getRateFeesByInstitution } from "./rate-fees";
import { STATS_ROW_FILTER, MIN_INSTITUTIONS_FOR_MEDIAN } from "./fee-stats";
import { getDisplayName, getFeeFamily } from "@/lib/fee-taxonomy";
import { institutionDisplayName } from "@/lib/institution-display-name";

export const BENCHMARK_MIN_INSTITUTIONS = MIN_INSTITUTIONS_FOR_MEDIAN;
const MARKET_PEER_LIMIT = 40;

export interface BenchmarkGroup {
  median: number | null;
  p25: number | null;
  p75: number | null;
  institutions: number;
}

export interface BenchmarkRow {
  fee_category: string;
  display_name: string;
  family: string | null;
  amount: number;
  national: BenchmarkGroup;
  state: BenchmarkGroup;
  asset_peers: BenchmarkGroup;
  local_market: { median: number | null; institutions: number };
  /** Against the asset-size peers: below their 25th percentile, above their 75th, or between. */
  position: "lower" | "typical" | "higher" | null;
  source_url: string | null;
}

/**
 * A fee the institution states as a rate ("1% of the transaction"), benchmarked only
 * against other rates for the same fee (published_fee_rate_catalog), never against dollars.
 */
export interface BenchmarkRateRow {
  fee_category: string;
  display_name: string;
  family: string | null;
  rate_percent: number;
  /** "1.1% of the transaction", "3% of the advance ($10 minimum)". */
  rate_terms: string;
  national: BenchmarkGroup;
  /** Against every institution's rate for this fee: below the 25th percentile, above the 75th, or between. */
  position: "lower" | "typical" | "higher" | null;
  source_url: string | null;
}

export interface InstitutionBenchmark {
  institution: { id: number; name: string; state: string | null; charter_type: string | null; asset_tier: string | null };
  groups: { national: string; state: string; asset_peers: string; local_market: string | null };
  rows: BenchmarkRow[];
  rate_rows: BenchmarkRateRow[];
}

const EMPTY: BenchmarkGroup = { median: null, p25: null, p75: null, institutions: 0 };

function group(entries: IndexEntry[], category: string): BenchmarkGroup {
  const entry = entries.find((e) => e.fee_category === category);
  if (!entry || entry.institution_count < BENCHMARK_MIN_INSTITUTIONS) {
    return { ...EMPTY, institutions: entry?.institution_count ?? 0 };
  }
  return { median: entry.median_amount, p25: entry.p25_amount, p75: entry.p75_amount, institutions: entry.institution_count };
}

export function positionAgainst(amount: number, peers: BenchmarkGroup): BenchmarkRow["position"] {
  if (peers.p25 === null || peers.p75 === null) return null;
  if (amount < peers.p25) return "lower";
  if (amount > peers.p75) return "higher";
  return "typical";
}

const CHARTER_LABEL: Record<string, string> = { bank: "banks", credit_union: "credit unions" };

export async function getInstitutionBenchmark(institutionId: number): Promise<InstitutionBenchmark | null> {
  const [inst] = await sql<{ id: number; institution_name: string; state_code: string | null; charter_type: string | null; asset_size_tier: string | null }[]>`
    SELECT id, institution_name, state_code, charter_type, asset_size_tier FROM institution_sources WHERE id = ${institutionId}`;
  if (!inst) return null;
  const own = await getInstitutionFeeValues(institutionId);
  const charter = inst.charter_type ?? undefined;
  const [indexes, sources, market] = await Promise.all([
    getPeerIndexes([
      { charter_type: charter },
      { charter_type: charter, state_code: inst.state_code ?? undefined },
      { charter_type: charter, asset_tiers: inst.asset_size_tier ? [inst.asset_size_tier] : undefined },
    ]),
    sql<{ fee_category: string; source_url: string | null }[]>`
      SELECT DISTINCT ON (ef.fee_category) ef.fee_category, ef.source_url
        FROM published_fee_catalog ef
       WHERE ef.institution_id = ${institutionId} AND ef.review_status = 'approved'
         AND ${sql.unsafe(STATS_ROW_FILTER)}
         AND ef.amount IS NOT NULL AND ef.amount >= 0
       ORDER BY ef.fee_category, ef.updated_at DESC NULLS LAST, ef.fee_published_id DESC`,
    getLocalMarketMembers(institutionId).catch(() => null),
  ]);
  const rateRows = await getRateBenchmarkRows(institutionId);
  const [national, state, assetPeers] = indexes;
  const rivals = (market?.members ?? []).filter((m) => !m.is_subject).slice(0, MARKET_PEER_LIMIT).map((m) => m.institution_id);
  const marketMedians = marketMediansFrom(
    rivals.length > 0 && own.size > 0 ? await getFeeValuesForInstitutions(rivals, [...own.keys()]) : new Map(),
  );
  const sourceBy = new Map(sources.map((s) => [s.fee_category, s.source_url]));
  const charterLabel = CHARTER_LABEL[inst.charter_type ?? ""] ?? "institutions";

  const rows: BenchmarkRow[] = [...own.entries()]
    .map(([category, amount]) => {
      const peers = group(assetPeers, category);
      const local = marketMedians.get(category);
      return {
        fee_category: category,
        display_name: getDisplayName(category),
        family: getFeeFamily(category),
        amount,
        national: group(national, category),
        state: group(state, category),
        asset_peers: peers,
        local_market: { median: local && local.count >= BENCHMARK_MIN_INSTITUTIONS ? local.median : null, institutions: local?.count ?? 0 },
        position: positionAgainst(amount, peers),
        source_url: sourceBy.get(category) ?? null,
      };
    })
    .sort((a, b) => (a.family ?? "").localeCompare(b.family ?? "") || a.display_name.localeCompare(b.display_name));

  return {
    institution: {
      id: Number(inst.id),
      name: institutionDisplayName(inst.institution_name),
      state: inst.state_code,
      charter_type: inst.charter_type,
      asset_tier: inst.asset_size_tier,
    },
    groups: {
      national: `All ${charterLabel}`,
      state: `${charterLabel[0].toUpperCase()}${charterLabel.slice(1)} in ${inst.state_code ?? "the state"}`,
      asset_peers: `${charterLabel[0].toUpperCase()}${charterLabel.slice(1)} of the same asset size${inst.asset_size_tier ? ` (${inst.asset_size_tier})` : ""}`,
      local_market: market ? `Competitors in ${market.places.slice(0, 2).join("; ")}` : null,
    },
    rows,
    rate_rows: rateRows,
  };
}

/** One row per rate-stated fee category, the lowest rate when a schedule states several. */
async function getRateBenchmarkRows(institutionId: number): Promise<BenchmarkRateRow[]> {
  const fees = (await getRateFeesByInstitution(institutionId, "consumer")).filter((fee) => fee.fee_category);
  const byCategory = new Map<string, (typeof fees)[number]>();
  for (const fee of fees) {
    const current = byCategory.get(fee.fee_category!);
    if (!current || fee.rate_percent < current.rate_percent) byCategory.set(fee.fee_category!, fee);
  }
  const rows = await Promise.all(
    [...byCategory.entries()].map(async ([category, fee]): Promise<BenchmarkRateRow> => {
      const stats = await getNationalRateStats(category);
      const national: BenchmarkGroup =
        stats.institution_count < BENCHMARK_MIN_INSTITUTIONS || stats.median_rate === null
          ? { ...EMPTY, institutions: stats.institution_count }
          : { median: stats.median_rate, p25: stats.p25_rate, p75: stats.p75_rate, institutions: stats.institution_count };
      return {
        fee_category: category,
        display_name: getDisplayName(category),
        family: getFeeFamily(category),
        rate_percent: fee.rate_percent,
        rate_terms: fee.rate_label,
        national,
        position: positionAgainst(fee.rate_percent, national),
        source_url: fee.source_url,
      };
    }),
  );
  return rows.sort((a, b) => (a.family ?? "").localeCompare(b.family ?? "") || a.display_name.localeCompare(b.display_name));
}

export const BENCHMARK_CSV_HEADER = [
  "fee_category", "fee", "family", "amount",
  "national_median", "national_p25", "national_p75", "national_institutions",
  "state_median", "state_institutions",
  "asset_peer_median", "asset_peer_p25", "asset_peer_p75", "asset_peer_institutions",
  "local_market_median", "local_market_institutions",
  "position_vs_asset_peers", "source_url",
  // Fees stated as a rate: their own rows, compared only with other rates.
  "unit", "rate_percent", "rate_terms",
  "national_rate_median", "national_rate_p25", "national_rate_p75", "national_rate_institutions",
  "position_vs_national_rate",
];

export function benchmarkCsvRows(benchmark: InstitutionBenchmark): unknown[][] {
  return benchmark.rows.map((r) => [
    r.fee_category, r.display_name, r.family, r.amount,
    r.national.median, r.national.p25, r.national.p75, r.national.institutions,
    r.state.median, r.state.institutions,
    r.asset_peers.median, r.asset_peers.p25, r.asset_peers.p75, r.asset_peers.institutions,
    r.local_market.median, r.local_market.institutions,
    r.position, r.source_url,
    "dollars", null, null, null, null, null, null, null,
  ]).concat((benchmark.rate_rows ?? []).map((r) => [
    r.fee_category, r.display_name, r.family, null,
    null, null, null, null,
    null, null,
    null, null, null, null,
    null, null,
    null, r.source_url,
    "percent", r.rate_percent, r.rate_terms,
    r.national.median, r.national.p25, r.national.p75, r.national.institutions,
    r.position,
  ]));
}
