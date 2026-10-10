/**
 * Server loaders for the Hamilton workspace: the Briefing and one fee's Research.
 * Deterministic reads of live data; no provider calls. Every figure comes from
 * published_fee_catalog, fee_change_records or institution_financial_records.
 */

import { sql } from "@/lib/data-store/connection";
import { getInstitutionById } from "@/lib/data-store/core";
import { loadConfirmedFeeChanges } from "@/lib/report-assemblers/monthly-pulse";
import {
  getFeeValuesForInstitutions,
  getInstitutionFeeRows,
  getInstitutionFeeValues,
  getPeerFeeValues,
  getSegmentFeeValues,
  type PeerFeeValue,
} from "@/lib/data-store/fee-index";
import { getPeerServiceChargeMedians, getRevenueTrend } from "@/lib/data-store/call-reports";
import { getLocalMarketMembers, type LocalMarketMembers } from "@/lib/data-store/custom-report-market";
import { getStateEconomicContext } from "@/lib/data-store/economic-context";
import { STATE_NEWS_SOURCE_PATTERNS } from "@/lib/data-store/news";
import { getNationalRateStats, getRateFeesByInstitution } from "@/lib/data-store/rate-fees";
import { getInstitutionRegulators } from "@/lib/data-store/regulators";
import { getComplaintBenchmark, getInstitutionComplaintYears } from "@/lib/data-store/complaints";
import { getAccountLineups, summarizeLineup, type LineupAccount } from "@/lib/data-store/account-lineup";
import { LINEUP_CATEGORY } from "@/lib/agents/knox/lineup";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { percentFeeAllowed } from "@/lib/percent-fees";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";
import {
  ASSET_TIER_RANGES,
  buildInstitutionPeerFilterCandidates,
  describePeerFilters,
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
import { buildSegmentResearch, shortSegmentLabel } from "./segment";
import { MIN_PEERS_FOR_POSITION } from "./scenario";
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
  values: PeerFeeValue[];
}

interface LayerSet {
  scope: MarketLayerScope;
  label: string;
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
  /** The narrowest default peer group, named on the Briefing. */
  peerLabel: string;
  ownValues: Map<string, number>;
  /** Per fee, the narrowest peer group with enough institutions publishing it. */
  peers: Map<string, CategoryPeers>;
}

function peerLabel(filters: HamiltonPeerFilters): string {
  return Object.keys(filters).length === 0 ? "Verified national index" : describePeerFilters(filters);
}

/**
 * Peers per fee: the first of the institution's default peer groups (state, charter, size
 * and district, then progressively wider, then national) where at least
 * MIN_PEERS_FOR_POSITION other institutions publish that fee. With `activeFirst`, the first
 * candidate is the bank's own peer group from Settings; a fee it is too thin for widens to
 * the next group, and the label says how many the bank's group had.
 */
export function choosePeers(
  candidates: HamiltonPeerFilters[],
  valuesBySet: Map<string, PeerFeeValue[]>[],
  categories: string[],
  options: { activeFirst?: boolean } = {},
): Map<string, CategoryPeers> {
  const chosen = new Map<string, CategoryPeers>();
  for (const category of categories) {
    for (const [index, filters] of candidates.entries()) {
      const values = valuesBySet[index]?.get(category) ?? [];
      if (values.length >= MIN_PEERS_FOR_POSITION || index === candidates.length - 1) {
        const ownCount = valuesBySet[0]?.get(category)?.length ?? 0;
        const label = options.activeFirst && index > 0
          ? `${peerLabel(filters)}; your group ${peerLabel(candidates[0])} has ${ownCount} publishing this fee`
          : peerLabel(filters);
        chosen.set(category, { label, values });
        break;
      }
    }
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

async function loadBase(
  institutionId: number,
  categories?: string[],
  options: EnginePeerOptions = {},
): Promise<WorkspaceBase | null> {
  const institution = await getInstitutionById(institutionId);
  if (!institution) return null;
  const ownValues = await getInstitutionFeeValues(institutionId, categories);
  const wanted = categories ?? [...ownValues.keys()];
  const activeFirst = Boolean(options.peerSet);
  const candidates: HamiltonPeerFilters[] = [
    ...(options.peerSet ? [peerSetCandidate(options.peerSet)] : []),
    ...buildInstitutionPeerFilterCandidates(institution),
    {},
  ];
  const layerSets = marketLayerSets(institution);
  // One read for the peer candidates and the layers; national is already the last candidate.
  const extra = layerSets.filter((l) => l.scope !== "national");
  const valuesBySet = await getPeerFeeValues([...candidates, ...extra.map((l) => l.filters)], wanted, institutionId);
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
      { scope: "national", label: "National", values: national },
      ...extra.map((l, i) => ({ scope: l.scope, label: l.label, values: valuesBySet[candidates.length + i] ?? new Map() })),
    ],
    peerLabel: peerLabel(candidates[0]),
    ownValues,
    peers: choosePeers(candidates, valuesBySet.slice(0, candidates.length), wanted, { activeFirst }),
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
  };
}

function feeLayers(base: WorkspaceBase, feeCategory: string): MarketLayer[] {
  const current = base.ownValues.get(feeCategory) ?? null;
  return base.layers.map((layer) => {
    const values = layer.values.get(feeCategory) ?? [];
    return marketLayer(
      layer.scope,
      layer.label,
      values.map((v) => v.amount),
      current,
      values.map((v) => v.published_at),
      values.map(toPeerValue),
    );
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

async function loadServiceChargeRows(institutionId: number): Promise<ServiceChargeRow[]> {
  const rows = await sql`
    SELECT report_date, source, service_charge_income, overdraft_revenue, nsf_revenue
      FROM institution_financial_records
     WHERE institution_id = ${institutionId}
       AND source IN ('fdic', 'ncua')
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
      SELECT source, title, link, topic, published_at
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

/** Industry deposit service charge income, newest quarter first, in dollars (eight quarters). */
export async function loadNationalIncomeSeries(): Promise<MarketIncome[]> {
  // Twelve quarters so each of the newest eight has its year-earlier quarter for the change.
  const trend = await getRevenueTrend(12);
  const thousands = 1000;
  return trend.quarters.slice(0, 8).map((q) => ({
    quarter: q.quarter,
    total: q.total_service_charges * thousands,
    banks: q.bank_service_charges * thousands,
    creditUnions: q.cu_service_charges * thousands,
    institutions: q.total_institutions,
    yoyPct: q.yoy_change_pct === null ? null : Math.round(q.yoy_change_pct * 10) / 10,
    sourceRef: {
      label: "FDIC call reports and NCUA 5300 reports, service charges on deposit accounts, all filers on file",
      table: "institution_financial_records",
      asOf: q.quarter,
    },
  }));
}

/** The bank's own income with the median of its charter and asset size beside it, quarter by quarter. */
async function withPeerMedian(base: WorkspaceBase, financials: InstitutionFinancials | null): Promise<InstitutionFinancials | null> {
  if (!financials || !base.assetTier) return financials;
  const label = base.layers.find((l) => l.scope === "charter_size")?.label;
  const medians = await getPeerServiceChargeMedians(base.charterType, base.assetTier, 8).catch(() => []);
  if (!label || medians.length === 0) return financials;
  return {
    ...financials,
    peerMedian: {
      label,
      quarters: medians.map((m) => ({ quarterEnd: m.quarter_end, amount: m.median_thousands * 1000, institutions: m.institutions })),
      sourceRef: {
        label: `${financials.source === "ncua" ? "NCUA 5300" : "FDIC call report"} filers, ${label}, median quarterly service charges`,
        table: "institution_financial_records",
        asOf: medians[0].quarter_end,
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
  const valueOf = new Map<number, Record<string, number>>();
  for (const category of base.ownValues.keys()) {
    for (const v of national.get(category) ?? []) {
      const values = valueOf.get(v.institution_id) ?? {};
      values[category] = v.amount;
      valueOf.set(v.institution_id, values);
    }
  }
  const others = market.members.filter((m) => !m.is_subject);
  const rows = others
    .filter((m) => valueOf.has(m.institution_id))
    .slice(0, limit)
    .map((m) => ({
      institutionId: m.institution_id,
      name: m.institution_name,
      own: false,
      marketDeposits: m.market_deposits,
      values: valueOf.get(m.institution_id) as Record<string, number>,
    }));
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

export async function getWorkspaceBriefing(
  institutionId: number,
  now = new Date(),
  options: EnginePeerOptions = {},
): Promise<Briefing | null> {
  const base = await loadBase(institutionId, undefined, options);
  if (!base) return null;
  const [changes, financialRows, articles, nationalIncomeSeries, studyRows, market] = await Promise.all([
    loadStateChanges(base.stateCode),
    loadServiceChargeRows(institutionId),
    loadRegArticles(RULE_CHANGE_WINDOW_DAYS, now),
    loadNationalIncomeSeries(),
    loadStudyPlacements(institutionId),
    getLocalMarketMembers(institutionId).catch(() => null),
  ]);
  const nationalIncome = nationalIncomeSeries[0] ?? null;
  const positions = [...base.ownValues].map(([feeCategory, current]) => {
    const peers = base.peers.get(feeCategory);
    return {
      feeCategory,
      current,
      peers: (peers?.values ?? []).map((p) => p.amount),
      peerLabel: peers?.label ?? base.peerLabel,
    };
  });
  const trend = serviceChargeTrend(financialRows);
  const financials = await withPeerMedian(base, institutionFinancials(financialRows));
  const shift = revenueShiftObservation(trend);
  const bankCategories = new Set(base.ownValues.keys());
  const rules = ruleChangeObservations(articles, bankCategories);
  const studies = studyObservations(studyRows);
  const observations = withStudyPlace(
    rankObservations([
      ...marketPositionObservations(positions),
      ...competitorMoveObservations(changes, bankCategories, base.stateCode ?? "your state"),
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
    institutionFinancials: financials,
    localMarket: briefingLocalMarket(base, market),
    overdraftIncome: base.ownValues.has("overdraft") ? feeRevenueLine(financialRows, "overdraft", base.charterType) : null,
    nationalIncome,
    nationalIncomeSeries,
    feesReviewed: base.ownValues.size,
    positions: feePositionRows(positions),
    peerLabel: base.peerLabel,
    generatedAt: now.toISOString(),
    provenance: {
      engineVersion: WORKSPACE_ENGINE_VERSION,
      generatedAt: now.toISOString(),
      peerGroup: { label: base.peerLabel, n: new Set([...base.peers.values()].flatMap((p) => p.values.map((v) => v.institution_id))).size },
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
        ...(studyRows.length ? [{ label: "Hamilton studies (call reports, branch deposits, household income, published fees)", table: "hamilton_studies" }] : []),
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
        ...toPeerValue(v),
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
    const values = await getFeeValuesForInstitutions(ids, STRUCTURE_COLUMNS.map((c) => c.category));
    const row = (institutionId: number, name: string, own: boolean) => ({
      institutionId,
      name,
      own,
      values: Object.fromEntries(values.get(institutionId) ?? new Map<string, number>()),
    });
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

export async function getFeeResearch(
  institutionId: number,
  feeCategory: string,
  now = new Date(),
  options: { segment?: AskSegment | null } & EnginePeerOptions = {},
): Promise<FeeResearch | null> {
  const base = await loadBase(institutionId, [feeCategory], options);
  if (!base) return null;
  const [changes, financialRows, articles, market, ownFeeRows, nationalIncomeSeries, economy, segment, rates, regulators, complaints, complaintBenchmark] = await Promise.all([
    loadStateChanges(base.stateCode, feeCategory),
    loadServiceChargeRows(institutionId),
    loadRegArticles(REGULATION_NEWS_WINDOW_DAYS, now),
    getLocalMarketMembers(institutionId).catch(() => null),
    getInstitutionFeeRows(institutionId, feeCategory),
    loadNationalIncomeSeries(),
    loadEconomy(base.stateCode, base.fedDistrict),
    options.segment ? loadSegment(base, feeCategory, options.segment) : Promise.resolve(null),
    loadRates(institutionId, feeCategory, now.toISOString().slice(0, 10)),
    getInstitutionRegulators(institutionId).catch(() => null),
    getInstitutionComplaintYears(institutionId).catch(() => []),
    getComplaintBenchmark(institutionId).catch(() => null),
  ]);
  const ownRows: OwnFeeRow[] = ownFeeRows;
  const financials = await withPeerMedian(base, institutionFinancials(financialRows));
  const revenueLine = feeRevenueLine(financialRows, feeCategory, base.charterType);
  const local = localMarketView(base, market, feeCategory);
  const layers = [...feeLayers(base, feeCategory), ...(local.layer ? [local.layer] : [])];
  const chosen = base.peers.get(feeCategory);
  const peers: PeerValue[] = (chosen?.values ?? []).map(toPeerValue);
  const sorted = peers.map((p) => p.amount).sort((a, b) => a - b);
  const current = base.ownValues.get(feeCategory) ?? null;
  const structureGroup =
    segment && !segment.problem
      ? { label: shortSegmentLabel(segment.segment), members: segment.members }
      : local.competitors && local.competitors.length >= MIN_PEERS_FOR_POSITION
        ? { label: "local competitors", members: local.competitors }
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
    peerLabel: chosen?.label ?? base.peerLabel,
    peers,
    band: sorted.length > 0
      ? { p25: quantile(sorted, 0.25), median: quantile(sorted, 0.5), p75: quantile(sorted, 0.75), n: sorted.length }
      : null,
    bands: priceBands(sorted, current),
    layers,
    localCompetitors: local.competitors,
    localMarket: local.info,
    recentChanges,
    // Null until a filing carries a line for this fee: NCUA overdraft (IS0048) and NSF
    // (IS0049) income, or the bank overdraft-and-NSF line (RIAD H032, banks over $1B).
    revenueLine,
    ownRows,
    nationalIncomeSeries,
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
      ...feeRegulatoryNews(articles, feeCategory),
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
      peerGroup: { label: chosen?.label ?? base.peerLabel, n: peers.length },
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
      ],
      assumptions: [
        peers.length < MIN_PEERS_FOR_POSITION
          ? `Only ${peers.length} institutions publish this fee even nationally, too few for percentiles.`
          : `Peers are the narrowest default group where at least ${MIN_PEERS_FOR_POSITION} other institutions publish this fee.`,
        "One value per institution: the median of its published amounts, or the highest tier for overdraft.",
        ...(rates
          ? ["Where a fee is stated as a rate, rates are compared only with other rates, one per institution, never with dollar amounts."]
          : []),
        "Each peer's amount links to the schedule document it was read from.",
        "Pricing groups count each institution once, at its highest published tier.",
        "A fee change is shown only when the institution's own schedule bears it out.",
        "A blank cell in a table means the fee is not on that institution's published schedule in the index.",
        `Market layers show percentiles only where at least ${MIN_PEERS_FOR_POSITION} other institutions publish the fee.`,
        "The local market is the counties holding the bank's branches (up to three, in its main state), or its headquarters city when it is not in the Summary of Deposits, as in the custom report.",
        "Rules come from a short reviewed list. State fee laws appear only once reviewed; none is cited otherwise.",
        "CFPB complaints count only where the CFPB company name matched this institution; no match is not proof of none.",
      ],
      clientFacts: [],
    },
  };
}
