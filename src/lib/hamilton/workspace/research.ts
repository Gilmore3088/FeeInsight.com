/**
 * Server loaders for the Hamilton workspace: the Briefing and one fee's Research.
 * Deterministic reads of live data; no provider calls. Every figure comes from
 * published_fee_catalog, fee_change_records or institution_financial_records.
 */

import type { CallCohortHistory } from "@/lib/data-catalog/call-cohort-history";
import { countedAmounts } from "@/lib/data-store/fee-stats";
import { sql } from "@/lib/data-store/connection";
import { getInstitutionById } from "@/lib/data-store/core";
import { loadConfirmedFeeChanges } from "@/lib/report-assemblers/monthly-pulse";
import {
  getInstitutionFeeRows,
  getInstitutionOwnFees,
  getOwnFeesForInstitutions,
  getPeerFeeValues,
  getPeerGroupMembers,
  getSegmentFeeValues,
  catalogStamp,
  type PeerFeeValue,
} from "@/lib/data-store/fee-index";
import type { DatasetStamp } from "@/lib/dataset-stamp";
import { financialMeasureDefinition, financialSourceForCharter } from "@/lib/data-store/financial-peer-contract";
import { getPeerServiceChargeMedians, getRevenueTrend } from "@/lib/data-store/call-reports";
import { getLocalMarketMembers, type LocalMarketMembers } from "@/lib/data-store/custom-report-market";
import { getStateEconomicContext } from "@/lib/data-store/economic-context";
import { STATE_NEWS_SOURCE_PATTERNS, TOPIC_SQL } from "@/lib/data-store/news";
import { STRUCK_ENFORCEMENT_AGENCIES, STRUCK_REG_ARTICLE_SOURCES } from "@/lib/data-store/struck-sources";
import { getNationalRateStats, getRateFeesByInstitution } from "@/lib/data-store/rate-fees";
import { getInstitutionRegulators } from "@/lib/data-store/regulators";
import { getComplaintBenchmark, getInstitutionComplaintYears } from "@/lib/data-store/complaints";
import { getAccountLineups, summarizeLineup, type LineupAccount } from "@/lib/data-store/account-lineup";
import { LINEUP_CATEGORY } from "@/lib/agents/knox/lineup";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { severalFeesOf, type InstitutionOwnFee, type SeveralFees } from "@/lib/own-fee";
import { percentFeeAllowed } from "@/lib/percent-fees";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";
import {
  ASSET_TIER_RANGES,
  buildInstitutionPeerFilterCandidates,
  describePeerFilters,
  coversOwnFees,
  defaultCandidateEntries,
  PEER_GROUP_ANCHOR,
  peerSetCandidate,
  type ActivePeerSet,
  type HamiltonPeerFilters,
} from "../peer-index";
import { economicBackdrop } from "./economy";
import { feeRegulatoryNews, feeRules, marketLayer, ruleChangeObservations, type RegArticleRow } from "./context";
import {
  competitorMoveObservations,
  feePositionRows,
  marketPositionObservations,
  MAX_OBSERVATIONS,
  rankObservations,
  revenueShiftObservation,
  type FeeChangeInput,
} from "./observations";
import { studyObservations, withStudyPlace, type DependenceYear, type StudyPlacementRow } from "./studies";
import { priceBands } from "./bands";
import { regulatoryFacts } from "./regulators";
import {
  enforcementCode,
  statePostFacts,
  wireFacts,
  WIRE_ACTION_YEARS,
  WIRE_BILL_DAYS,
  WIRE_POST_DAYS,
  WIRE_RULE_DAYS,
  type WirePostRow,
  type WireRows,
} from "./wire";
import { CONSUMER_LAW_PG, isConsumerLaw } from "@/lib/data-store/regulatory-watch";
import { STATE_BILL_STAGE_LABELS, toRegulatorPosts } from "@/lib/data-store/state-news";
import { readableHeadline } from "@/lib/regulatory/state-news";
import { enforcementAgencyLabel } from "@/lib/regulatory/state-enforcement";
import { OCC_ENFORCEMENT_SEARCH_URL } from "@/lib/regulatory/enforcement";
import { buildSegmentResearch, shortSegmentLabel } from "./segment";
import { LOCAL_COMPETITORS_GROUP, MIN_LOCAL_PEERS_FOR_POSITION, MIN_PEERS_FOR_POSITION } from "./scenario";
import { feeRevenueLine, institutionFinancials, serviceChargeTrend, type ServiceChargeRow } from "./revenue";
import {
  WORKSPACE_ENGINE_VERSION,
  type Briefing,
  type BriefingLocalMarket,
  type EconomicBackdrop,
  type ChangeEvent,
  type Fact,
  type FeeResearch,
  type AccountLineupSet,
  type FeeStructureSet,
  type InstitutionFinancials,
  type LocalMarketInfo,
  type MarketIncome,
  type MarketLayer,
  type MarketLayerScope,
  type AskSegment,
  type OwnFeeRow,
  type PeerGroupCoverage,
  type PeerValue,
  type RateResearch,
  type SegmentResearch,
  type SourceRef,
} from "./types";

/** Competitor moves older than this are history, not news. */
export const COMPETITOR_MOVE_WINDOW_DAYS = 180;
/** Regulator releases newer than this reach the Briefing. */
export const RULE_CHANGE_WINDOW_DAYS = 60;
/** Regulator releases newer than this are listed under a fee's Research. */
export const REGULATION_NEWS_WINDOW_DAYS = 365;

interface CategoryPeers {
  label: string;
  /** The bank's own saved peer group was used, not one Hamilton picked. */
  saved?: boolean;
  /** The filters of the peer group chosen, for its dataset stamp. */
  filters?: HamiltonPeerFilters;
  values: PeerFeeValue[];
}

interface LayerSet {
  scope: MarketLayerScope;
  label: string;
  /** The filters the layer's values were read with, for its dataset stamp. */
  filters?: HamiltonPeerFilters;
  values: Map<string, PeerFeeValue[]>;
}

interface WorkspaceBase {
  institutionId: number;
  institutionName: string;
  stateCode: string | null;
  fedDistrict: number | null;
  charterType: string;
  assetTier: string | null;
  /** Total assets in thousands of dollars. */
  totalAssets?: number | null;
  /** National, Fed district, state, and charter and size, each loaded whole. */
  layers: LayerSet[];
  /** When the layers' read returned, for their dataset stamps (#1924); no stamps without it. */
  readAt?: Date;
  /** The narrowest default peer group, named on the Briefing. */
  peerLabel: string;
  /**
   * The price the bank's schedule states per fee. A fee it states several different amounts
   * for is left out: their median is no price of its own (#1913). ownCategories lists both.
   */
  ownValues: Map<string, number>;
  /** Per fee the bank states several different amounts for: the range and each named fee (#2030). */
  ownSeveral?: Map<string, SeveralFees>;
  /** Every fee category the bank publishes, priced or not. */
  ownCategories: Set<string>;
  /** Per fee, the narrowest peer group with enough institutions publishing it. */
  peers: Map<string, CategoryPeers>;
}

function peerLabel(filters: HamiltonPeerFilters): string {
  return Object.keys(filters).length === 0 ? "Verified national index" : describePeerFilters(filters);
}

export { PEER_GROUP_ANCHOR } from "../peer-index";

/** `covers[i]`: candidate i passes the shared group rule (coversOwnFees); index-aligned with the candidates. */
type GroupOptions = { activeFirst?: boolean; covers?: readonly boolean[] };

/**
 * Which candidate group is the institution's peer group, the same for every fee and every
 * question (#2046): the saved group from Settings when there is one, otherwise the narrowest
 * default group (state, charter, size and district, then progressively wider, then national)
 * where at least MIN_PEERS_FOR_POSITION other institutions publish 80% of the bank's own fees
 * (#2098), the same rule Simulate and reports use.
 */
export function peerGroupIndex(valuesBySet: Map<string, PeerFeeValue[]>[], candidateCount: number, options: GroupOptions = {}): number {
  if (options.activeFirst) return 0;
  for (let index = 0; index < candidateCount - 1; index++) {
    // `covers` is the shared rule (#2098, coversOwnFees); without it, the overdraft test.
    const fits = options.covers ? options.covers[index] : peerAmounts(valuesBySet[index]?.get(PEER_GROUP_ANCHOR) ?? []).length >= MIN_PEERS_FOR_POSITION;
    if (fits) return index;
  }
  return candidateCount - 1;
}

/**
 * Peers per fee, all from the one peer group (#2046). A fee too few in the group publish is not
 * widened to another group, which made the peer count drift from question to question; its label
 * says how many publish it, and the answer says too few to compare.
 */
export function choosePeers(
  candidates: HamiltonPeerFilters[],
  valuesBySet: Map<string, PeerFeeValue[]>[],
  categories: string[],
  options: GroupOptions = {},
): Map<string, CategoryPeers> {
  const index = peerGroupIndex(valuesBySet, candidates.length, options);
  const filters = candidates[index] ?? {};
  const chosen = new Map<string, CategoryPeers>();
  for (const category of categories) {
    const values = valuesBySet[index]?.get(category) ?? [];
    // Counted as the band counts them: sister charters of one shared schedule once (rule 7).
    const publishing = peerAmounts(values).length;
    const label = publishing >= MIN_PEERS_FOR_POSITION || index === candidates.length - 1
      ? peerLabel(filters)
      : `${peerLabel(filters)}; ${publishing === 0 ? "none" : `only ${publishing}`} of them publish this fee`;
    chosen.set(category, { label, filters, values, saved: Boolean(options.activeFirst) && index === 0 });
  }
  return chosen;
}

/** The market layers an institution belongs to, widest first. Layers it lacks the data for are left out. */
export function marketLayerSets(institution: {
  state_code: string | null;
  charter_type: string | null;
  asset_size_tier: string | null;
  fed_district: number | null;
}): { scope: MarketLayerScope; label: string; filters: HamiltonPeerFilters }[] {
  const sets: { scope: MarketLayerScope; label: string; filters: HamiltonPeerFilters }[] = [
    { scope: "national", label: "National", filters: {} },
  ];
  if (institution.fed_district) {
    const name = DISTRICT_NAMES[institution.fed_district];
    sets.push({
      scope: "fed_district",
      label: `Fed district ${institution.fed_district}${name ? ` (${name})` : ""}`,
      filters: { fed_districts: [institution.fed_district] },
    });
  }
  if (institution.state_code) {
    sets.push({
      scope: "state",
      label: STATE_NAMES[institution.state_code] ?? institution.state_code,
      filters: { state_code: institution.state_code },
    });
  }
  if (institution.charter_type && institution.asset_size_tier) {
    const kind = institution.charter_type === "credit_union" ? "Credit unions" : "Banks";
    const range = ASSET_TIER_RANGES[institution.asset_size_tier];
    const tier = range ? `${range} in assets` : institution.asset_size_tier.replace(/_/g, " ");
    sets.push({
      scope: "charter_size",
      label: `${kind}, ${tier}`,
      filters: { charter_type: institution.charter_type, asset_tiers: [institution.asset_size_tier] },
    });
  }
  return sets;
}

/** Options every engine entry point takes: the bank's own peer group from Settings, when it set one. */
export interface EnginePeerOptions {
  peerSet?: Pick<ActivePeerSet, "filters" | "label"> | null;
}

/**
 * Which candidates pass the shared group rule (coversOwnFees, #2098), from per-fee counts of each
 * default candidate. The bank's full list of published fees is read when only some were asked for.
 * Undefined when a read fails, so the overdraft test still picks a group.
 */
async function groupCoverage(institutionId: number, candidates: HamiltonPeerFilters[], ownCategories?: ReadonlySet<string>): Promise<boolean[] | undefined> {
  try {
    const [indexes, own] = await Promise.all([
      defaultCandidateEntries(candidates.slice(0, -1)),
      ownCategories ? Promise.resolve(ownCategories) : getInstitutionOwnFees(institutionId).then((fees) => new Set(fees.keys())),
    ]);
    return candidates.map((_, i) => i < indexes.length && coversOwnFees(indexes[i] ?? [], own));
  } catch {
    return undefined;
  }
}

/**
 * The bank's own fees split by what its schedule states: one price per fee (`ownValues`), or,
 * for a fee it states several different amounts for, the range and each named fee
 * (`ownSeveral`). A fee in neither is not published; one in `ownSeveral` is never "missing" (#2030).
 */
export function splitOwnFees(ownFees: ReadonlyMap<string, InstitutionOwnFee>): { ownValues: Map<string, number>; ownSeveral: Map<string, SeveralFees> } {
  const ownValues = new Map<string, number>();
  const ownSeveral = new Map<string, SeveralFees>();
  for (const [category, fee] of ownFees) {
    if (fee.price !== null) ownValues.set(category, fee.price);
    const several = severalFeesOf(fee);
    if (several) ownSeveral.set(category, several);
  }
  return { ownValues, ownSeveral };
}

async function loadBase(
  institutionId: number,
  categories?: string[],
  options: EnginePeerOptions = {},
): Promise<WorkspaceBase | null> {
  const institution = await getInstitutionById(institutionId);
  if (!institution) return null;
  const ownFees = await getInstitutionOwnFees(institutionId, categories);
  const { ownValues, ownSeveral } = splitOwnFees(ownFees);
  const ownCategories = new Set(ownFees.keys());
  const wanted = categories ?? [...ownCategories];
  // The anchor fee is always read: it picks the one peer group every answer uses (#2046).
  const read = wanted.includes(PEER_GROUP_ANCHOR) ? wanted : [...wanted, PEER_GROUP_ANCHOR];
  const activeFirst = Boolean(options.peerSet);
  const candidates: HamiltonPeerFilters[] = [
    ...(options.peerSet ? [peerSetCandidate(options.peerSet)] : []),
    ...buildInstitutionPeerFilterCandidates(institution),
    {},
  ];
  const layerSets = marketLayerSets(institution);
  // One read for the peer candidates and the layers; national is already the last candidate.
  const extra = layerSets.filter((l) => l.scope !== "national");
  const [valuesBySet, covers] = await Promise.all([
    getPeerFeeValues([...candidates, ...extra.map((l) => l.filters)], read, institutionId),
    activeFirst ? Promise.resolve(undefined) : groupCoverage(institutionId, candidates, categories ? undefined : ownCategories),
  ]);
  const groupOptions = { activeFirst, covers };
  const groupIndex = peerGroupIndex(valuesBySet.slice(0, candidates.length), candidates.length, groupOptions);
  const readAt = new Date();
  const national = valuesBySet[candidates.length - 1] ?? new Map();
  return {
    institutionId,
    institutionName: institution.institution_name,
    stateCode: institution.state_code,
    fedDistrict: institution.fed_district ?? null,
    charterType: institution.charter_type,
    assetTier: institution.asset_size_tier,
    totalAssets: institution.asset_size === null || institution.asset_size === undefined ? null : Number(institution.asset_size),
    layers: [
      { scope: "national", label: "National", filters: {}, values: national },
      ...extra.map((l, i) => ({ scope: l.scope, label: l.label, filters: l.filters, values: valuesBySet[candidates.length + i] ?? new Map() })),
    ],
    readAt,
    peerLabel: peerLabel(candidates[groupIndex]),
    ownValues,
    ownSeveral,
    ownCategories,
    peers: choosePeers(candidates, valuesBySet.slice(0, candidates.length), wanted, groupOptions),
  };
}

export function toPeerValue(v: PeerFeeValue): PeerValue {
  return {
    institutionId: v.institution_id,
    institutionName: v.institution_name,
    amount: v.amount,
    stateCode: v.state_code,
    sourceDocumentIds: v.source_document_ids,
    documentUrls: v.document_urls,
    publishedAt: v.published_at,
    ...(v.total_assets !== undefined ? { totalAssets: v.total_assets } : {}),
    ...(v.several ? { several: v.several } : {}),
    ...(v.fee_published_ids?.length ? { feePublishedIds: v.fee_published_ids } : {}),
    ...(v.counted_as !== undefined ? { countedAs: v.counted_as } : {}),
  };
}

/**
 * The amounts a group's band and position are built from: one per institution, and sister
 * charters of one shared fee schedule once (statistics rule 7, `counted_as`), as the index's
 * medians count them. Sorted ascending.
 */
export function peerAmounts(values: readonly PeerFeeValue[]): number[] {
  return countedAmounts(values.map((v) => ({ institutionId: v.institution_id, amount: v.amount, countedAs: v.counted_as })));
}

/**
 * A peer of the chosen group with the catalog rows behind its value (#981, H06-T04), so the peer
 * median can name them. Only the chosen group carries them; the wider layers stay light.
 */
export function toPeerValueWithRecords(v: PeerFeeValue): PeerValue {
  return {
    ...toPeerValue(v),
    ...(v.fee_records ? {
      feeRecords: v.fee_records.map((r) => ({
        id: r.id, amount: r.amount, feeName: r.fee_name, frequency: r.frequency, feeAudience: r.fee_audience,
        sourceDocumentId: r.source_document_id, documentUrl: r.document_url,
      })),
    } : {}),
  };
}

function feeLayers(base: WorkspaceBase, feeCategory: string): MarketLayer[] {
  const current = base.ownValues.get(feeCategory) ?? null;
  return base.layers.map((layer) => {
    const values = layer.values.get(feeCategory) ?? [];
    return marketLayer(
      layer.scope,
      layer.label,
      peerAmounts(values),
      current,
      values.map((v) => v.published_at),
      values.map(toPeerValue),
    );
  });
}

/**
 * Each market layer's dataset stamp for one fee (#1924): a live read of the published catalog
 * under the statistics contract, the layer's filters, and the bank itself left out, as
 * getPeerFeeValues reads it. The local market has no filter set, so no stamp.
 */
export function feeLayerStamps(base: WorkspaceBase, feeCategory: string): Partial<Record<MarketLayerScope, DatasetStamp>> {
  const out: Partial<Record<MarketLayerScope, DatasetStamp>> = {};
  if (!base.readAt) return out;
  for (const layer of base.layers) {
    if (!layer.filters) continue;
    out[layer.scope] = catalogStamp({
      mode: "live",
      readAt: base.readAt,
      runId: null,
      newestRecordAt: newest((layer.values.get(feeCategory) ?? []).map((v) => v.published_at)),
      scope: layer.filters,
      extraFilters: [excludeOwnFilter(base.institutionId)],
    });
  }
  return out;
}

function excludeOwnFilter(institutionId: number) {
  return { key: `exclude:institution:${institutionId}`, label: "The institution being compared left out" };
}

/**
 * The dataset stamp of the peer group a fee's band was read from (#1924): the same one read as the
 * layers, under the chosen group's filters with the bank left out. Null without the read time or
 * the group's filters.
 */
export function feePeerStamp(base: Pick<WorkspaceBase, "institutionId" | "readAt" | "peers">, feeCategory: string): DatasetStamp | null {
  const chosen = base.peers.get(feeCategory);
  if (!base.readAt || !chosen?.filters) return null;
  return catalogStamp({
    mode: "live",
    readAt: base.readAt,
    runId: null,
    newestRecordAt: newest(chosen.values.map((v) => v.published_at)),
    scope: chosen.filters,
    extraFilters: [excludeOwnFilter(base.institutionId)],
  });
}

const FEE_SOURCE: SourceRef = {
  label: "Fees on each institution's own published schedule (verified, live)",
  table: "published_fee_catalog",
};
const CHANGES_SOURCE: SourceRef = { label: "Fee changes seen on published schedules", table: "fee_change_records" };

function newest(dates: (string | null | undefined)[]): string | null {
  return dates.filter((d): d is string => !!d).sort().pop() ?? null;
}

function sinceDate(days: number, now = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Price changes in the state over the window that the bank's own schedules bear out
 * (the Monthly Pulse rule). A recorded change the schedules do not support is left out,
 * so a misread PDF never shows as a competitor's move.
 */
async function loadStateChanges(stateCode: string | null, feeCategory?: string): Promise<FeeChangeInput[]> {
  if (!stateCode) return [];
  const { changes } = await loadConfirmedFeeChanges(`${sinceDate(COMPETITOR_MOVE_WINDOW_DAYS)}T00:00:00.000Z`, stateCode);
  return changes
    .filter((c) => !feeCategory || c.fee_category === feeCategory)
    .map((c) => ({
      institutionName: c.institution_name,
      feeCategory: c.fee_category,
      oldAmount: c.old_amount,
      newAmount: c.new_amount,
      changedAt: c.changed_at,
    }));
}

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

export interface OwnScheduleRow {
  fee_on_file: boolean;
  collected: boolean;
  schedule: { url: string | null; read: string | null } | null;
}

/** loadOwnSchedule's answer from its one row: undefined whenever either claim could be false (#2035). */
export function ownScheduleFrom(row: OwnScheduleRow): FeeResearch["ownSchedule"] {
  if (row.fee_on_file) return undefined;
  if (!row.schedule) return row.collected ? undefined : null;
  return { documentUrl: row.schedule.url ?? null, readAt: row.schedule.read ? String(row.schedule.read).slice(0, 10) : null };
}

/**
 * The schedule most of the bank's live fees were read from, and when it was last read (#2035).
 * Undefined, so the answer keeps its neutral wording, whenever "lists no such fee" or "no
 * schedule on file" could be false: a row for the fee exists in any state (stated as a rate, held
 * for review, filtered out of the peer figures, not yet published), a row is still in the
 * verification queue (it has no category yet), a collected schedule has no live fees yet,
 * or the read fails.
 * Null only when no schedule was ever collected.
 */
async function loadOwnSchedule(institutionId: number, feeCategory: string): Promise<FeeResearch["ownSchedule"]> {
  try {
    const [row] = await sql`
      SELECT
        EXISTS (SELECT 1 FROM published_fee_catalog p WHERE p.institution_id = ${institutionId} AND p.fee_category = ${feeCategory})
          OR EXISTS (SELECT 1 FROM published_fee_rate_catalog r WHERE r.institution_id = ${institutionId} AND r.fee_category = ${feeCategory})
          OR EXISTS (SELECT 1 FROM verified_fee_observations v WHERE v.institution_id = ${institutionId} AND v.fee_category = ${feeCategory} AND v.review_status <> 'rejected')
          OR EXISTS (SELECT 1 FROM pipeline_attempts pa
                      WHERE pa.institution_id = ${institutionId} AND pa.stage = 'verify'
                        AND pa.detail->>'decision' = 'needs_review' AND pa.detail->>'canonical_fee_key' = ${feeCategory})
          OR EXISTS (SELECT 1 FROM raw_fee_observations fr
                      WHERE fr.institution_id = ${institutionId} AND fr.source = 'knox'
                        AND fr.outlier_flags ? 'needs_darwin_verification'
                        AND NOT EXISTS (SELECT 1 FROM verified_fee_observations v WHERE v.fee_raw_id = fr.fee_raw_id)
                        AND NOT EXISTS (SELECT 1 FROM pipeline_attempts pa
                                         WHERE pa.input_fingerprint = 'raw:' || fr.fee_raw_id AND pa.stage = 'verify'))
          AS fee_on_file,
        EXISTS (SELECT 1 FROM source_documents d WHERE d.institution_id = ${institutionId} AND d.status = 'success') AS collected,
        (SELECT json_build_object('url', sd.document_url, 'read', GREATEST(sd.last_checked_at, sd.crawled_at))
           FROM published_fee_catalog ef
           JOIN source_documents sd ON sd.id = ef.source_document_id AND sd.institution_id = ef.institution_id
          WHERE ef.institution_id = ${institutionId}
            AND ef.review_status = 'approved'
          GROUP BY sd.id, sd.document_url, sd.last_checked_at, sd.crawled_at
          ORDER BY COUNT(*) DESC, GREATEST(sd.last_checked_at, sd.crawled_at) DESC
          LIMIT 1) AS schedule`;
    return row ? ownScheduleFrom(row as OwnScheduleRow) : undefined;
  } catch {
    return undefined;
  }
}

async function loadServiceChargeRows(institutionId: number, charterType: unknown): Promise<ServiceChargeRow[]> {
  const source = financialSourceForCharter(charterType);
  if (!source) return [];
  const rows = await sql`
    SELECT report_date, source, service_charge_income, overdraft_revenue, nsf_revenue
      FROM institution_financial_records
     WHERE institution_id = ${institutionId}
       AND source IN ('fdic', 'ncua') AND source = ${source}
     ORDER BY report_date DESC
     LIMIT 24`;
  return rows.map((r) => ({
    report_date: String(r.report_date).slice(0, 10),
    source: String(r.source),
    service_charge_income: numOrNull(r.service_charge_income),
    overdraft_revenue: numOrNull(r.overdraft_revenue),
    nsf_revenue: numOrNull(r.nsf_revenue),
  }));
}

/** The current fee dependence study's yearly median and middle half, per charter; empty before its first run. */
export async function loadDependenceSeries(): Promise<Record<string, DependenceYear[]>> {
  try {
    const [row] = await sql`
      SELECT findings->'series' AS series FROM hamilton_studies WHERE study_key = 'fee_dependence' AND is_current`;
    const series = row?.series && typeof row.series === "object" ? (row.series as Record<string, unknown[]>) : {};
    return Object.fromEntries(
      Object.entries(series).map(([charter, points]) => [
        charter,
        (Array.isArray(points) ? points : []).map((p) => {
          const v = p as Record<string, unknown>;
          return { year: Number(v.year), median: Number(v.median), p25: Number(v.p25), p75: Number(v.p75) };
        }),
      ]),
    );
  } catch (error) {
    console.error("[workspace] dependence series failed", error);
    return {};
  }
}

/** The institution's placements in Hamilton's current studies; none before the first studies run. */
export async function loadStudyPlacements(institutionId: number): Promise<StudyPlacementRow[]> {
  try {
    const rows = await sql`
      SELECT s.study_key, s.title, s.as_of, s.n, s.findings->>'headline' AS study_headline,
             p.metric, p.value, p.peer_group, p.peer_n, p.peer_median, p.percentile, p.detail
        FROM hamilton_study_placements p
        JOIN hamilton_studies s ON s.id = p.study_id AND s.is_current
       WHERE p.institution_id = ${institutionId}`;
    return rows.map((r) => ({
      studyKey: String(r.study_key),
      title: String(r.title),
      asOf: String(r.as_of),
      studyN: Number(r.n),
      studyHeadline: r.study_headline == null ? null : String(r.study_headline),
      metric: String(r.metric),
      value: numOrNull(r.value),
      peerGroup: String(r.peer_group),
      peerN: Number(r.peer_n),
      peerMedian: numOrNull(r.peer_median),
      percentile: numOrNull(r.percentile),
      detail: r.detail && typeof r.detail === "object" ? (r.detail as Record<string, unknown>) : {},
    }));
  } catch (error) {
    console.error("[workspace] study placements failed", error);
    return [];
  }
}

/** Regulator releases (FDIC, Fed, OCC, CFPB) published in the window, newest first. */
async function loadRegArticles(days: number, now = new Date()): Promise<RegArticleRow[]> {
  try {
    const rows = await sql`
      SELECT source, title, link, ${sql.unsafe(TOPIC_SQL)} AS topic, published_at
        FROM reg_articles
       WHERE published_at >= ${sinceDate(days, now)}
         AND NOT (source LIKE ANY(${STATE_NEWS_SOURCE_PATTERNS}::text[]))
       ORDER BY published_at DESC
       LIMIT 300`;
    return rows.map((r) => ({
      source: String(r.source),
      title: String(r.title),
      link: String(r.link),
      topic: String(r.topic),
      published_at: r.published_at === null ? null : String(r.published_at),
    }));
  } catch {
    // The feed table is created by its collector; before its first run there is nothing to read.
    return [];
  }
}

const isoDay = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const textList = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

/**
 * The Regulatory Wire rows a regulation answer can cite (#1090): federal rules with a fee topic,
 * the state's fee bills, consumer-law enforcement actions by the bank's own federal regulator
 * (OCC or Federal Reserve) or against an institution in its state, and the state regulator's
 * fee posts. The regulator, the state and the consumer-law test are applied in SQL, so the row
 * limit never cuts off the bank's own actions behind other banks' (#1254). Each read fails to
 * empty on its own.
 */
export async function loadWire(
  stateCode: string | null,
  primaryRegulator: string | null,
  now = new Date(),
): Promise<WireRows & { posts: WirePostRow[] }> {
  const today = now.toISOString().slice(0, 10);
  // A state code is upper-cased once here and compared upper case in SQL (party_state too).
  const state = stateCode ? stateCode.toUpperCase() : null;
  const federal = enforcementCode(primaryRegulator);
  const actionSince = new Date(now);
  actionSince.setUTCFullYear(actionSince.getUTCFullYear() - WIRE_ACTION_YEARS);
  const empty = (label: string) => (error: unknown): Record<string, unknown>[] => {
    console.error(`[hamilton-research] wire ${label} read failed`, { error });
    return [];
  };
  const [rules, bills, actions, posts] = await Promise.all([
    sql`
      SELECT kind, title, agencies, topics, published_on, comments_close_on, effective_on, url
        FROM reg_tracker_items
       WHERE source = 'federal_register'
         AND kind IN ('proposed_rule', 'final_rule')
         AND cardinality(topics) > 0
         AND (published_on >= ${sinceDate(WIRE_RULE_DAYS, now)}::date
              OR comments_close_on >= ${today}::date
              OR effective_on >= ${sinceDate(WIRE_RULE_DAYS, now)}::date)
       ORDER BY published_on DESC NULLS LAST
       LIMIT 100`.catch(empty("rules")),
    state
      ? sql`
          SELECT jurisdiction, identifier, title, stage, stage_on, published_on, topics, url
            FROM reg_tracker_items
           WHERE source = 'open_states'
             AND jurisdiction = ${state}
             AND cardinality(topics) > 0
             AND COALESCE(stage_on, published_on) >= ${sinceDate(WIRE_BILL_DAYS, now)}::date
           ORDER BY COALESCE(stage_on, published_on) DESC NULLS LAST
           LIMIT 50`.catch(empty("bills"))
      : Promise.resolve([]),
    federal || state
      ? sql`
          SELECT agency, party_name, party_state, action_type, subject, start_date, document_url
            FROM institution_enforcement_actions
           WHERE start_date >= ${actionSince.toISOString().slice(0, 10)}::date
             AND (agency = ${federal} OR upper(party_state) = ${state})
             -- Struck states' orders (DECISIONS.md "No non-commercial data") are never read.
             AND agency <> ALL(${[...STRUCK_ENFORCEMENT_AGENCIES]}::text[])
             AND subject ~* ${CONSUMER_LAW_PG}
             -- Rows the reader would drop for having no link must not use up the LIMIT (#1359).
             AND (document_url IS NOT NULL OR agency = 'OCC')
           ORDER BY start_date DESC NULLS LAST, id DESC
           LIMIT 50`.catch(empty("enforcement"))
      : Promise.resolve([]),
    state
      ? sql`
          SELECT source, title, link, published_at
            FROM reg_articles
           WHERE source = ${`state:${state}`}
             AND source <> ALL(${[...STRUCK_REG_ARTICLE_SOURCES]}::text[])
             AND published_at >= ${sinceDate(WIRE_POST_DAYS, now)}
           ORDER BY published_at DESC
           LIMIT 200`.catch(empty("state posts"))
      : Promise.resolve([]),
  ]);
  const stateName = state ? STATE_NAMES[state] ?? state : null;
  return {
    rules: (rules as Record<string, unknown>[]).map((r) => ({
      kind: String(r.kind),
      title: String(r.title),
      agencies: textList(r.agencies),
      topics: textList(r.topics),
      published_on: isoDay(r.published_on),
      comments_close_on: isoDay(r.comments_close_on),
      effective_on: isoDay(r.effective_on),
      url: r.url ? String(r.url) : null,
    })),
    bills: (bills as Record<string, unknown>[]).map((r) => ({
      state_code: String(r.jurisdiction),
      identifier: r.identifier ? String(r.identifier) : null,
      title: readableHeadline(String(r.title)),
      stage_label: r.stage ? STATE_BILL_STAGE_LABELS[String(r.stage)] ?? null : null,
      stage_on: isoDay(r.stage_on) ?? isoDay(r.published_on),
      topics: textList(r.topics),
      url: r.url ? String(r.url) : null,
    })),
    // Only actions whose agency subject names consumer law. A state order carries a subject only
    // when its regulator's page states one (#1428); one with none is left out, never guessed at.
    actions: (actions as Record<string, unknown>[])
      .filter((r) => isConsumerLaw(r.subject ? String(r.subject) : null))
      .map((r) => ({
        agency: String(r.agency),
        agency_label: enforcementAgencyLabel(String(r.agency)),
        party_name: String(r.party_name),
        party_state: r.party_state ? String(r.party_state).toUpperCase() : null,
        action_type: r.action_type ? String(r.action_type) : null,
        start_date: isoDay(r.start_date),
        // The OCC export has no document links; its search page finds the order by name.
        url: r.document_url ? String(r.document_url) : String(r.agency) === "OCC" ? OCC_ENFORCEMENT_SEARCH_URL : null,
      })),
    posts: toRegulatorPosts(
      (posts as Record<string, unknown>[]).map((r) => ({
        source: String(r.source),
        title: String(r.title),
        link: String(r.link),
        published_at: r.published_at === null ? null : String(r.published_at),
      })),
    )
      .filter((p) => p.fee_related)
      .map((p) => ({ state_code: p.state_code, agency: `${stateName ?? p.state_code} state regulator`, title: p.title, link: p.link, published_at: p.published_at })),
  };
}

/** Canonical regulator income, newest quarter first, in dollars (eight quarters). */
export async function loadNationalIncomeSeries(charterType: unknown): Promise<{ quarters: MarketIncome[]; cohortHistory?: CallCohortHistory }> {
  const source = financialSourceForCharter(charterType);
  if (!source) return { quarters: [] };
  // Keep dated cross-sections; no comparable economic-growth baseline is established.
  const trend = await getRevenueTrend(12, source);
  const thousands = 1000;
  return { cohortHistory: trend.cohort_history, quarters: trend.quarters.slice(0, 8).map((q) => ({
    quarter: q.quarter,
    financialSource: source,
    measureDefinition: { ...financialMeasureDefinition(source), unit: "USD" },
    total: q.total_service_charges * thousands,
    banks: q.bank_service_charges * thousands,
    creditUnions: q.cu_service_charges * thousands,
    institutions: q.total_institutions,
    yoyPct: null,
    sourceRef: {
      label: `${financialMeasureDefinition(source).publisher}: ${financialMeasureDefinition(source).definition}; standalone quarters, canonical ${source === "ncua" ? "credit-union" : "bank"} filers on file; dated cross-sections using current registry links, not constant-cohort or merger-adjusted growth`,
      table: "institution_financial_records",
      asOf: q.quarter,
    },
  })) };
}

/** The bank's own income with the median of its charter and asset size beside it, quarter by quarter. */
export async function withPeerMedian(base: Pick<WorkspaceBase, "assetTier" | "charterType" | "institutionId" | "layers">, financials: InstitutionFinancials | null): Promise<InstitutionFinancials | null> {
  if (!financials || !base.assetTier) return financials;
  const label = base.layers.find((l) => l.scope === "charter_size")?.label;
  const history = await getPeerServiceChargeMedians(base.charterType, base.assetTier, 8, base.institutionId).catch(() => ({ quarters: [] }));
  const medians = history.quarters.filter((m) => m.median_thousands !== null);
  if (!label || history.quarters.length === 0) return financials;
  return {
    ...financials,
    peerMedian: {
      label,
      cohortHistory: "cohort_history" in history ? history.cohort_history : undefined,
      quarters: medians.map((m) => ({ quarterEnd: m.quarter_end, amount: m.median_thousands! * 1000, institutions: m.institutions })),
      sourceRef: {
        label: `${financials.source === "ncua" ? "NCUA 5300" : "FDIC call report"} filers, ${label}, ${financials.source === "ncua" ? "median quarterly broad credit-union fee income" : "median quarterly bank deposit service charges"}; dated cross-sections of current-registry size peers, not constant-cohort or merger-adjusted growth`,
        table: "institution_financial_records",
        asOf: medians[0]?.quarter_end ?? history.quarters[0].quarter_end,
      },
    },
  };
}

const SOD_SOURCE_LABEL = "FDIC Summary of Deposits, branch deposits by county";
const BRIEFING_COMPETITORS = 6;

/**
 * The bank and its largest local competitors that publish any fee it charges, with one value
 * per institution and fee read the same way as its peers (the national layer already loaded).
 */
export function briefingLocalMarket(
  base: WorkspaceBase,
  market: LocalMarketMembers | null,
  limit = BRIEFING_COMPETITORS,
): BriefingLocalMarket | null {
  if (!market) return null;
  const national = base.layers.find((l) => l.scope === "national")?.values;
  if (!national) return null;
  // One value per competitor and fee, as peers are read; a fee it states several different
  // amounts for also carries their range and names (#1931), shown in place of that median.
  const valueOf = new Map<number, { values: Record<string, number>; several: Record<string, SeveralFees> }>();
  // Columns follow the bank's own priced row (LocalCompetitors keys off it), so a fee it
  // states several amounts for is left out here rather than shown as an empty column.
  for (const category of base.ownValues.keys()) {
    for (const v of national.get(category) ?? []) {
      const id = Number(v.institution_id);
      const entry = valueOf.get(id) ?? { values: {}, several: {} };
      entry.values[category] = v.amount;
      if (v.several) entry.several[category] = v.several;
      valueOf.set(id, entry);
    }
  }
  const others = market.members.filter((m) => !m.is_subject);
  const rows = others
    .filter((m) => valueOf.has(Number(m.institution_id)))
    .slice(0, limit)
    .map((m) => {
      const entry = valueOf.get(Number(m.institution_id))!;
      return {
        institutionId: m.institution_id,
        name: m.institution_name,
        own: false,
        marketDeposits: m.market_deposits,
        values: entry.values,
        ...(Object.keys(entry.several).length > 0 ? { several: entry.several } : {}),
      };
    });
  if (rows.length === 0) return null;
  return {
    info: {
      basis: market.basis,
      places: market.places,
      sodYear: market.sod_year,
      institutions: others.length,
      source: { label: SOD_SOURCE_LABEL, asOf: String(market.sod_year) },
    },
    rows: [
      { institutionId: base.institutionId, name: base.institutionName, own: true, marketDeposits: null, values: Object.fromEntries(base.ownValues) },
      ...rows,
    ],
  };
}

/** The local market layer and named competitors for one fee, from the national values already loaded. */
export function localMarketView(
  base: WorkspaceBase,
  market: LocalMarketMembers | null,
  feeCategory: string,
): { layer: MarketLayer | null; competitors: PeerValue[] | null; info: LocalMarketInfo | null } {
  if (!market) return { layer: null, competitors: null, info: null };
  const others = market.members.filter((m) => !m.is_subject);
  const national = base.layers.find((l) => l.scope === "national")?.values.get(feeCategory) ?? [];
  const byId = new Map(national.map((v) => [v.institution_id, v]));
  const competitors: PeerValue[] = others
    .filter((m) => byId.has(m.institution_id))
    .map((m) => ({ ...toPeerValue(byId.get(m.institution_id) as PeerFeeValue), marketDeposits: m.market_deposits }));
  const source: SourceRef = { label: SOD_SOURCE_LABEL, asOf: String(market.sod_year) };
  const info: LocalMarketInfo = {
    basis: market.basis,
    places: market.places,
    sodYear: market.sod_year,
    institutions: others.length,
    source,
  };
  const layer = marketLayer(
    "local",
    `Local market (${market.places.join("; ")})`,
    competitors.map((c) => c.amount),
    base.ownValues.get(feeCategory) ?? null,
    competitors.map((c) => c.publishedAt),
    competitors,
  );
  return { layer, competitors, info };
}

/** One fee as the engine compares it: the bank's value and the chosen peers with their records. */
export interface EngineFeePeers {
  feeCategory: string;
  current: number | null;
  peerLabel: string;
  peers: PeerValue[];
}

export interface EngineFeePeerRead {
  institutionName: string;
  stateCode: string | null;
  charterType: string;
  peerLabel: string;
  fees: EngineFeePeers[];
  financials: InstitutionFinancials | null;
}

/**
 * The pricing committee packet's engine read: for each fee asked about, the same peers the Research
 * screen picks (the bank's own group from Settings first, widening per fee), each with the catalog
 * rows behind its value, plus the bank's filed service charge trend. No wire, economy or local
 * market reads; deterministic, no provider calls.
 */
export async function getEngineFeePeers(
  institutionId: number,
  categories: string[],
  options: EnginePeerOptions = {},
): Promise<EngineFeePeerRead | null> {
  if (categories.length === 0) return null;
  const base = await loadBase(institutionId, categories, options);
  if (!base) return null;
  const financialRows = await loadServiceChargeRows(institutionId, base.charterType).catch(() => [] as ServiceChargeRow[]);
  const financials = await withPeerMedian(base, institutionFinancials(financialRows)).catch(() => null);
  return {
    institutionName: base.institutionName,
    stateCode: base.stateCode,
    charterType: base.charterType,
    peerLabel: base.peerLabel,
    fees: categories.map((feeCategory) => {
      const chosen = base.peers.get(feeCategory);
      return {
        feeCategory,
        current: base.ownValues.get(feeCategory) ?? null,
        peerLabel: chosen?.label ?? base.peerLabel,
        peers: (chosen?.values ?? []).map(toPeerValueWithRecords),
      };
    }),
    financials,
  };
}

/** The one peer group's values for each fee asked about, for the fee position fingerprint (#1894). */
export interface EnginePeerGroupRead {
  institutionName: string;
  /** The group's name: the saved peer set's when there is one. */
  peerLabel: string;
  /** True when the group is the saved peer set from Settings. */
  saved: boolean;
  fees: { feeCategory: string; peers: PeerValue[] }[];
}

/**
 * The same group every screen uses (#1893): the saved peer set first, else the default group,
 * with each fee's peer values. Only the peer read; no financials, wire or local market.
 * Deterministic, no provider calls.
 */
export async function getEnginePeerGroup(
  institutionId: number,
  categories: string[],
  options: EnginePeerOptions = {},
): Promise<EnginePeerGroupRead | null> {
  if (categories.length === 0) return null;
  const base = await loadBase(institutionId, categories, options);
  if (!base) return null;
  return {
    institutionName: base.institutionName,
    peerLabel: base.peerLabel,
    saved: [...base.peers.values()].some((p) => p.saved),
    fees: categories.map((feeCategory) => ({
      feeCategory,
      peers: (base.peers.get(feeCategory)?.values ?? []).map(toPeerValue),
    })),
  };
}

export async function getWorkspaceBriefing(
  institutionId: number,
  now = new Date(),
  options: EnginePeerOptions = {},
): Promise<Briefing | null> {
  const base = await loadBase(institutionId, undefined, options);
  if (!base) return null;
  const [changes, financialRows, articles, nationalIncomeHistory, studyRows, market] = await Promise.all([
    loadStateChanges(base.stateCode),
    loadServiceChargeRows(institutionId, base.charterType),
    loadRegArticles(RULE_CHANGE_WINDOW_DAYS, now),
    loadNationalIncomeSeries(base.charterType),
    loadStudyPlacements(institutionId),
    getLocalMarketMembers(institutionId).catch(() => null),
  ]);
  const nationalIncomeSeries = nationalIncomeHistory.quarters;
  const nationalIncome = nationalIncomeSeries[0] ?? null;
  const positions = [...base.ownValues].map(([feeCategory, current]) => {
    const peers = base.peers.get(feeCategory);
    return {
      feeCategory,
      current,
      peers: peerAmounts(peers?.values ?? []),
      peerLabel: peers?.label ?? base.peerLabel,
    };
  });
  const trend = serviceChargeTrend(financialRows);
  const financials = await withPeerMedian(base, institutionFinancials(financialRows));
  const shift = revenueShiftObservation(trend, base.institutionName);
  const bankCategories = base.ownCategories;
  const rules = ruleChangeObservations(articles, bankCategories);
  const studies = studyObservations(studyRows, base.institutionName);
  const moves = competitorMoveObservations(changes, bankCategories, base.stateCode ?? "the institution's state");
  const observations = withStudyPlace(
    rankObservations([
      ...marketPositionObservations(positions, base.institutionName),
      ...moves,
      ...(shift ? [shift] : []),
      ...rules,
      ...studies,
    ]),
    studies,
    MAX_OBSERVATIONS,
  );
  return {
    institutionId,
    institutionName: base.institutionName,
    stateCode: base.stateCode,
    observations,
    // Counted before the observations are capped, so a market line never undercounts (#1891).
    stateFeeChanges: moves.length,
    institutionFinancials: financials,
    localMarket: briefingLocalMarket(base, market),
    overdraftIncome: base.ownCategories.has("overdraft") ? feeRevenueLine(financialRows, "overdraft", base.charterType) : null,
    nationalIncome,
    nationalIncomeSeries,
    nationalIncomeCohortHistory: nationalIncomeHistory.cohortHistory,
    feesReviewed: base.ownCategories.size,
    positions: feePositionRows(positions),
    peerLabel: base.peerLabel,
    generatedAt: now.toISOString(),
    provenance: {
      engineVersion: WORKSPACE_ENGINE_VERSION,
      generatedAt: now.toISOString(),
      peerGroup: { label: base.peerLabel, n: new Set([...base.peers.values()].flatMap((p) => p.values.map((v) => v.counted_as ?? v.institution_id))).size },
      dataAsOf: {
        fees: newest([...base.peers.values()].flatMap((p) => p.values.map((v) => v.published_at))),
        financials: financials?.quarterEnd ?? null,
        changes: newest(changes.map((c) => c.changedAt.slice(0, 10))),
      },
      sources: [
        FEE_SOURCE,
        { ...CHANGES_SOURCE, label: `${CHANGES_SOURCE.label}, ${base.stateCode ?? "no state"}, last ${COMPETITOR_MOVE_WINDOW_DAYS} days` },
        ...(financials ? [financials.sourceRef] : []),
        ...(financials?.peerMedian ? [financials.peerMedian.sourceRef] : []),
        ...(nationalIncome ? [nationalIncome.sourceRef] : []),
        { label: `FDIC, Federal Reserve, OCC and CFPB releases, last ${RULE_CHANGE_WINDOW_DAYS} days`, table: "reg_articles" },
        ...(studies.length ? [{ label: "Hamilton studies (call reports, published fees)", table: "hamilton_studies" }] : []),
      ],
      assumptions: [
        `Each fee is compared with the narrowest default peer group where at least ${MIN_PEERS_FOR_POSITION} other institutions publish it, widening to national.`,
        "One value per institution: the median of its published amounts, or the highest tier for overdraft.",
        "Observations are ranked by how unusual they are; ranking never implies a price direction.",
        "A regulator release appears only when its title mentions fees, overdraft, NSF, Reg E or Reg DD.",
      ],
      clientFacts: [],
    },
  };
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)) * 100) / 100;
}

/** The state economy, rates, prices and Beige Book; null on a failed read or no state. */
export async function loadEconomy(stateCode: string | null, district: number | null): Promise<EconomicBackdrop | null> {
  if (!stateCode) return null;
  try {
    const ctx = await getStateEconomicContext(stateCode, district);
    return economicBackdrop(ctx, STATE_NAMES[stateCode] ?? stateCode, district, district ? DISTRICT_NAMES[district] ?? null : null);
  } catch (error) {
    console.error("[hamilton-research] economy read failed", { stateCode, error });
    return null;
  }
}

/** The daily cap category that goes with a per-item fee, when there is one. */
// One daily cap covers overdraft and NSF since the top-50 fold (James, Oct 8).
const DAILY_CAP: Record<string, string> = { overdraft: "od_daily_cap", nsf: "od_daily_cap" };

async function loadSegment(base: WorkspaceBase, feeCategory: string, segment: AskSegment): Promise<SegmentResearch> {
  const current = base.ownValues.get(feeCategory) ?? null;
  try {
    const { institutionsInSegment, ownInSegment, values, caps, limits } = await getSegmentFeeValues(
      segment,
      feeCategory,
      DAILY_CAP[feeCategory] ?? null,
      base.institutionId,
    );
    const members = values.map((v) => {
      const limit = limits.get(v.institution_id);
      return {
        ...toPeerValueWithRecords(v),
        totalAssets: v.total_assets,
        charterType: v.charter_type,
        dailyCap: caps.get(v.institution_id) ?? null,
        dailyFeeLimit: limit ? { count: limit.count, line: limit.line } : null,
      };
    });
    return buildSegmentResearch({ segment, feeCategory, institutionsInSegment, members, current, ownInSegment });
  } catch (error) {
    console.error("[hamilton-research] segment read failed", { segment: segment.label, error });
    return {
      ...buildSegmentResearch({ segment, feeCategory, institutionsInSegment: 0, members: [], current, ownInSegment: false }),
      problem: `Hamilton could not read ${segment.label} just now.`,
    };
  }
}

/** The fees around overdraft and NSF that show how a group structures them. */
export const STRUCTURE_COLUMNS: { category: string; label: string }[] = [
  { category: "overdraft", label: "Overdraft fee" },
  { category: "nsf", label: "NSF fee" },
  { category: "od_daily_cap", label: "Daily cap" },
  { category: "od_protection_transfer", label: "Transfer fee" },
  { category: "continuous_od", label: "Continuous OD" },
];
const STRUCTURE_FEES = new Set(["overdraft", "nsf", "od_daily_cap", "nsf_daily_cap", "od_protection_transfer", "continuous_od"]);

async function loadStructure(
  base: WorkspaceBase,
  group: { label: string; members: { institutionId: number; institutionName: string }[] },
): Promise<FeeStructureSet | null> {
  if (group.members.length === 0) return null;
  try {
    const ids = [base.institutionId, ...group.members.map((m) => m.institutionId)];
    const fees = await getOwnFeesForInstitutions(ids, STRUCTURE_COLUMNS.map((c) => c.category));
    // One value per institution and fee, as before; several different fees in one also carry
    // their range and names (#1931), shown in place of that median.
    const row = (institutionId: number, name: string, own: boolean) => {
      const values: Record<string, number> = {};
      const several: Record<string, SeveralFees> = {};
      for (const [category, fee] of fees.get(Number(institutionId)) ?? new Map<string, InstitutionOwnFee>()) {
        values[category] = fee.value;
        const span = severalFeesOf(fee);
        if (span) several[category] = span;
      }
      return { institutionId, name, own, values, ...(Object.keys(several).length > 0 ? { several } : {}) };
    };
    return {
      groupLabel: group.label,
      columns: STRUCTURE_COLUMNS,
      rows: [row(base.institutionId, base.institutionName, true), ...group.members.map((m) => row(m.institutionId, m.institutionName, false))],
      source: FEE_SOURCE,
    };
  } catch (error) {
    console.error("[hamilton-research] structure read failed", { error });
    return null;
  }
}

const LINEUP_SOURCE: SourceRef = {
  label: "Monthly maintenance fees on each institution's own published schedule, with the account each one belongs to (verified, live)",
  table: "published_fee_catalog",
};

/** Monthly maintenance only: the bank's account lineup beside each group member's. */
async function loadLineup(
  base: WorkspaceBase,
  group: { label: string; members: { institutionId: number; institutionName: string }[] },
): Promise<AccountLineupSet | null> {
  try {
    const ids = [base.institutionId, ...group.members.map((m) => m.institutionId)];
    const accounts = await getAccountLineups(ids);
    const byInstitution = new Map<number, LineupAccount[]>();
    for (const account of accounts) {
      byInstitution.set(account.institutionId, [...(byInstitution.get(account.institutionId) ?? []), account]);
    }
    const ownAccounts = byInstitution.get(base.institutionId) ?? [];
    if (ownAccounts.length === 0) return null;
    const rows = [
      { institutionId: base.institutionId, name: base.institutionName, own: true, summary: summarizeLineup(ownAccounts) },
      ...group.members
        .filter((m) => m.institutionId !== base.institutionId && byInstitution.has(m.institutionId))
        .map((m) => ({ institutionId: m.institutionId, name: m.institutionName, own: false, summary: summarizeLineup(byInstitution.get(m.institutionId)!) })),
    ];
    return { groupLabel: group.label, rows, ownAccounts: [...ownAccounts].sort((a, b) => a.monthlyFee - b.monthlyFee), source: LINEUP_SOURCE };
  } catch (error) {
    console.error("[hamilton-research] lineup read failed", { error });
    return null;
  }
}

const RATE_SOURCE_LABEL ="Fees stated as a rate on each institution's own published schedule (verified, live)";

/**
 * The fee where it is stated as a rate, for the fees that may publish as one. Rates are read
 * from published_fee_rate_catalog and never pooled with dollar amounts. Null for other fees
 * or on a failed read (the dollar answer still stands).
 */
async function loadRates(institutionId: number, feeCategory: string, asOf: string): Promise<RateResearch | null> {
  if (!percentFeeAllowed(feeCategory)) return null;
  try {
    const [ownRates, stats] = await Promise.all([getRateFeesByInstitution(institutionId), getNationalRateStats(feeCategory)]);
    const own = ownRates
      .filter((r) => r.fee_category === feeCategory)
      .sort((a, b) => b.rate_percent - a.rate_percent)
      .map((r) => ({ feeName: r.fee_name, label: r.rate_label, ratePercent: r.rate_percent, sourceUrl: r.source_url }));
    return {
      own,
      national: {
        n: stats.institution_count,
        median: stats.median_rate,
        p25: stats.p25_rate,
        p75: stats.p75_rate,
        min: stats.min_rate,
        max: stats.max_rate,
      },
      source: { label: RATE_SOURCE_LABEL, table: "published_fee_rate_catalog", asOf },
    };
  } catch (error) {
    console.error("[hamilton-research] rate read failed", { feeCategory, error });
    return null;
  }
}

/**
 * The group's institutions with no value for the fee; null when the read fails, so the list still
 * shows, and null for the national fallback, which is every institution rather than a group.
 */
async function loadPeerGroupCoverage(filters: HamiltonPeerFilters, institutionId: number, feeCategory: string, peers: PeerValue[]): Promise<PeerGroupCoverage | null> {
  const scoped = Boolean(filters.institutionIds?.length || filters.charter_type || filters.state_code || filters.states?.length || filters.asset_tiers?.length || filters.fed_districts?.length);
  if (!scoped) return null;
  try {
    const group = await getPeerGroupMembers(filters, institutionId, feeCategory);
    const listed = new Set(peers.map((p) => p.institutionId));
    return {
      total: group.total,
      missing: group.members
        .filter((m) => !listed.has(m.institution_id))
        .map((m) => ({ institutionId: m.institution_id, institutionName: m.institution_name, stateCode: m.state_code, totalAssets: m.total_assets, hasSchedule: m.has_schedule, uncounted: m.has_uncounted_fee })),
    };
  } catch {
    return null;
  }
}

/** How many institutions a scoped peer group holds; undefined for the national index or when the read fails. */
async function loadPeerGroupSize(filters: HamiltonPeerFilters, institutionId: number, feeCategory: string): Promise<number | undefined> {
  const scoped = Boolean(filters.institutionIds?.length || filters.charter_type || filters.state_code || filters.states?.length || filters.asset_tiers?.length || filters.fed_districts?.length);
  if (!scoped) return undefined;
  try {
    return (await getPeerGroupMembers(filters, institutionId, feeCategory, 1)).total;
  } catch {
    return undefined;
  }
}

export async function getFeeResearch(
  institutionId: number,
  feeCategory: string,
  now = new Date(),
  options: { segment?: AskSegment | null; listPeers?: boolean } & EnginePeerOptions = {},
): Promise<FeeResearch | null> {
  const base = await loadBase(institutionId, [feeCategory], options);
  if (!base) return null;
  // The Wire's enforcement read needs the bank's federal regulator, so it waits on this one read.
  const regulatorRead = getInstitutionRegulators(institutionId).catch(() => null);
  // Read beside the rest; used only when the bank has no row for the fee (#2035).
  const ownScheduleRead = loadOwnSchedule(institutionId, feeCategory);
  // Every answer says how many institutions the one peer group holds (#2046); a list question
  // reads the whole group below, so only the others count it here, beside the rest.
  const groupFilters = base.peers.get(feeCategory)?.filters;
  const peerGroupSizeRead = !options.listPeers && groupFilters ? loadPeerGroupSize(groupFilters, institutionId, feeCategory) : Promise.resolve(undefined);
  const [changes, financialRows, articles, market, ownFeeRows, nationalIncomeHistory, economy, segment, rates, regulators, complaints, complaintBenchmark, wireRows] = await Promise.all([
    loadStateChanges(base.stateCode, feeCategory),
    loadServiceChargeRows(institutionId, base.charterType),
    loadRegArticles(REGULATION_NEWS_WINDOW_DAYS, now),
    getLocalMarketMembers(institutionId).catch(() => null),
    getInstitutionFeeRows(institutionId, feeCategory),
    loadNationalIncomeSeries(base.charterType),
    loadEconomy(base.stateCode, base.fedDistrict),
    options.segment ? loadSegment(base, feeCategory, options.segment) : Promise.resolve(null),
    loadRates(institutionId, feeCategory, now.toISOString().slice(0, 10)),
    regulatorRead,
    getInstitutionComplaintYears(institutionId).catch(() => []),
    getComplaintBenchmark(institutionId).catch(() => null),
    regulatorRead.then((r) => loadWire(base.stateCode, r?.primaryRegulator ?? null, now)),
  ]);
  const nationalIncomeSeries = nationalIncomeHistory.quarters;
  const ownRows: OwnFeeRow[] = ownFeeRows;
  // A fee with no row of its own is told apart: not listed on the schedule, or no schedule (#2035).
  const ownSchedule = ownRows.length === 0 ? await ownScheduleRead : undefined;
  const wireScope = { feeCategory, stateCode: base.stateCode, primaryRegulator: regulators?.primaryRegulator ?? null, today: now };
  const wire = wireFacts(wireRows, wireScope);
  const statePosts = statePostFacts(wireRows.posts, wireScope);
  const financials = await withPeerMedian(base, institutionFinancials(financialRows));
  const revenueLine = feeRevenueLine(financialRows, feeCategory, base.charterType);
  const local = localMarketView(base, market, feeCategory);
  const layers = [...feeLayers(base, feeCategory), ...(local.layer ? [local.layer] : [])];
  const chosen = base.peers.get(feeCategory);
  const peers: PeerValue[] = (chosen?.values ?? []).map(toPeerValueWithRecords);
  // A list question names the whole group, so the peers with no value for the fee are read too.
  const peerGroup = options.listPeers && chosen?.filters ? await loadPeerGroupCoverage(chosen.filters, institutionId, feeCategory, peers) : undefined;
  const peerGroupSize = peerGroup ? peerGroup.total : await peerGroupSizeRead;
  const sorted = countedAmounts(peers);
  const band = sorted.length > 0
    ? { p25: quantile(sorted, 0.25), median: quantile(sorted, 0.5), p75: quantile(sorted, 0.75), n: sorted.length }
    : null;
  const peerStamp = feePeerStamp(base, feeCategory);
  const current = base.ownValues.get(feeCategory) ?? null;
  const structureGroup =
    segment && !segment.problem
      ? { label: shortSegmentLabel(segment.segment), members: segment.members }
      : local.competitors && local.competitors.length >= MIN_LOCAL_PEERS_FOR_POSITION
        ? { label: LOCAL_COMPETITORS_GROUP, members: local.competitors }
        : { label: `peers (${chosen?.label ?? base.peerLabel})`, members: peers };
  const structure = STRUCTURE_FEES.has(feeCategory) ? await loadStructure(base, structureGroup) : null;
  const lineup = feeCategory === LINEUP_CATEGORY ? await loadLineup(base, structureGroup) : null;
  const changeEvents: ChangeEvent[] = changes.map((c) => ({
    date: c.changedAt.slice(0, 10),
    institutionName: c.institutionName,
    from: c.oldAmount,
    to: c.newAmount,
  }));
  const recentChanges: Fact[] = changes
    .filter((c) => c.oldAmount !== null && c.newAmount !== null)
    .slice(0, 10)
    .map((c) => ({
      text: `${c.institutionName}: $${c.oldAmount} to $${c.newAmount} on ${new Date(`${c.changedAt.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}.`,
      source: { ...CHANGES_SOURCE, asOf: c.changedAt.slice(0, 10) },
    }));
  return {
    institutionId,
    institutionName: base.institutionName,
    feeCategory,
    displayName: getDisplayName(feeCategory),
    current,
    ownSeveral: base.ownSeveral?.get(feeCategory) ?? null,
    peerLabel: chosen?.label ?? base.peerLabel,
    peers,
    peerGroupSaved: chosen?.saved ?? false,
    ...(peerGroupSize !== undefined ? { peerGroupSize } : {}),
    ...(peerGroup !== undefined ? { peerGroup } : {}),
    band,
    bands: priceBands(sorted, current),
    layers,
    layerStamps: feeLayerStamps(base, feeCategory),
    ...(peerStamp ? { peerStamp } : {}),
    localCompetitors: local.competitors,
    localMarket: local.info,
    recentChanges,
    // Null until a filing carries a line for this fee: NCUA overdraft (IS0048) and NSF
    // (IS0049) income, or the bank overdraft-and-NSF line (RIAD H032, banks over $1B).
    revenueLine,
    ownRows,
    ...(ownSchedule !== undefined ? { ownSchedule } : {}),
    nationalIncomeSeries,
    nationalIncomeCohortHistory: nationalIncomeHistory.cohortHistory,
    institutionFinancials: financials,
    regulation: [
      ...regulatoryFacts({
        institutionName: base.institutionName,
        feeCategory,
        stateCode: base.stateCode,
        charterType: base.charterType,
        regulators,
        complaints,
        complaintBenchmark,
        readOn: now.toISOString().slice(0, 10),
      }),
      ...feeRules(feeCategory, base.charterType),
      // The Wire: rules, bills and enforcement first, then federal releases, then state posts.
      ...wire,
      ...feeRegulatoryNews(articles, feeCategory),
      ...statePosts,
    ],
    economy,
    segment,
    changeEvents,
    structure,
    lineup,
    rates,
    provenance: {
      engineVersion: WORKSPACE_ENGINE_VERSION,
      generatedAt: now.toISOString(),
      peerGroup: { label: chosen?.label ?? base.peerLabel, n: sorted.length },
      dataAsOf: {
        fees: newest([...peers.map((p) => p.publishedAt), ...layers.map((l) => l.asOf)]),
        financials: revenueLine?.quarterEnd ?? financials?.quarterEnd ?? null,
        changes: newest(changes.map((c) => c.changedAt.slice(0, 10))),
      },
      sources: [
        FEE_SOURCE,
        CHANGES_SOURCE,
        ...(financials ? [financials.sourceRef] : []),
        ...(financials?.peerMedian ? [financials.peerMedian.sourceRef] : []),
        ...(revenueLine ? [revenueLine.source] : []),
        ...(nationalIncomeSeries[0] ? [nationalIncomeSeries[0].sourceRef] : []),
        ...(local.info ? [local.info.source] : []),
        ...(economy?.indicators.map((i) => i.source) ?? []),
        ...(economy?.beigeBook ? [economy.beigeBook.source] : []),
        ...(segment ? [segment.source] : []),
        ...(rates ? [rates.source] : []),
        ...(lineup ? [lineup.source] : []),
        { label: `FDIC, Federal Reserve, OCC and CFPB releases, last ${REGULATION_NEWS_WINDOW_DAYS} days`, table: "reg_articles" },
        ...(wire.some((f) => f.source.table === "reg_tracker_items") ? [{ label: "Federal Register rules and state fee bills (Open States)", table: "reg_tracker_items" }] : []),
        ...(wire.some((f) => f.source.table === "institution_enforcement_actions") ? [{ label: "OCC, Federal Reserve and state enforcement action lists", table: "institution_enforcement_actions" }] : []),
      ],
      assumptions: [
        sorted.length < MIN_PEERS_FOR_POSITION
          ? `Only ${sorted.length} institutions in the peer group publish this fee, too few for percentiles.`
          : chosen?.saved
            ? "Peers are the saved peer group, the same group for every fee."
            : `Peers are one group for every fee: the narrowest default group where at least ${MIN_PEERS_FOR_POSITION} other institutions publish an overdraft fee.`,
        "One value per institution: the median of its published amounts, or the highest tier for overdraft.",
        ...(rates
          ? ["Where a fee is stated as a rate, rates are compared only with other rates, one per institution, never with dollar amounts."]
          : []),
        "Each peer's amount links to the schedule document it was read from.",
        "Pricing groups count each institution once, at its highest published tier.",
        "A fee change is shown only when the institution's own schedule bears it out.",
        "A blank cell in a table means the fee is not on that institution's published schedule in the index.",
        `Market layers show percentiles only where at least ${MIN_PEERS_FOR_POSITION} other institutions publish the fee, or ${MIN_LOCAL_PEERS_FOR_POSITION} local competitors in the local layer.`,
        "The local market is the counties holding the bank's branches (up to three, in its main state), or its headquarters city when it is not in the Summary of Deposits, as in the custom report.",
        "Rules come from a short reviewed list. State fee laws appear only once reviewed; none is cited otherwise.",
        "Recent rules, bills and enforcement actions come from the Regulatory Wire as each agency or legislature published them; they are listed, not interpreted.",
        "CFPB complaints count only where the CFPB company name matched this institution; no match is not proof of none.",
      ],
      clientFacts: [],
    },
  };
}
