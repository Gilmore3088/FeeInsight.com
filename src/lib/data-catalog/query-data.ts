import { z } from "zod";

import { ASSET_TIERS } from "@/lib/api-v1";
import { PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { withTransaction } from "@/lib/data-store/connection";
import { getInstitutionHqLocation, normalizeGeoCode, type AreaGeoType } from "@/lib/data-store/economy-aggregates";
import {
  getInstitutionFeeRows,
  getNationalIndexCachedStamped,
  getPeerIndexStamped,
  getStateFeeIndexes,
  type IndexEntry,
} from "@/lib/data-store/fee-index";
import { datasetCitation } from "@/lib/dataset-note";
import type { DatasetStamp } from "@/lib/dataset-stamp";
import {
  PeerSetError,
  definitionFor,
  getPeerSubject,
  peerSetMemberIds,
  resolvePeerRequest,
  resolvePeerSet,
  type PeerSetDefinition,
  type PeerSetRequest,
  type ResolvedPeerSet,
} from "@/lib/data-store/peer-sets";
import { STRUCK_AREA_SERIES_KEYS, STRUCK_FRED_SERIES, areaRowServedSql, notYetFromPublisherReason } from "@/lib/data-store/struck-sources";
import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";
import { MAX_NEAREST_PEERS, PEER_REGULATORS, type PeerRegulator } from "@/lib/peer-set-dimensions";
import {
  getCorporateFamily,
  getGleifLinkSummary,
  getInstitutionLeiLink,
  type FamilyNode,
} from "@/lib/data-store/locations-gleif-aggregates";
import {
  CALL_REPORT_ROW_SOURCES,
  FACT_MEASURES,
  FAMILY_MEASURE,
  callReportEntries,
  catalogEntry,
  scopeForAreaGeoType,
  type CatalogEntry,
  type CatalogScopeKind,
} from "./catalog";
import {
  AREA_PERIOD_FIRST_MONTH_SQL,
  AREA_PERIOD_LAST_MONTH_SQL,
  ROLLUP_MIN_INSTITUTIONS,
  areaPeerRollup,
  callInstitutionSeries,
  callPeerRollup,
  hqLevelFor,
  type RollupRow,
} from "./roll-ups";
import {
  MAX_COLD_FILES_PER_QUERY,
  callSourcePeriodKey,
  canonicalColdCallRows,
  coldCallRollup,
  coldFilesInRange,
  coldInstitutionSeries,
  prunedCallFiles,
  readColdCallRows,
  type ColdCallRow,
} from "./cold-reads";
import { ncuaCallMeasure } from "./ncua-call-measures";

/**
 * One safe query over the data catalog, for Hamilton's tools and the site. The caller names a
 * measure and a scope; this module writes the SQL. Every value from the input reaches Postgres as
 * a bound parameter, never as SQL text, and a measure the catalog does not let us show is refused
 * with a plain reason.
 *
 * - `area:<source>:<series_key>`: a public-data series from area_statistics.
 * - `fee:<category>`: a fee category from the published fee index.
 * - `call:<item_key>`: a call-report line from institution_call_report_items (FFIEC and NCUA).
 * - `fact:<name>`: an institution fact read from its own documents (institution_payment_features),
 *   for one institution, with the link to the document it was read from.
 * - `family:lei`: one institution's corporate family from GLEIF (parents and subsidiaries).
 *
 * A peer group (`peer_set`) is resolved by the shared definition in data-store/peer-sets.ts, the
 * one Hamilton's saved groups and the API use. Public data and call-report lines roll up over its
 * members when read (roll-ups.ts): a median, its spread and how many members stand behind it.
 */

/** The first and last month ("YYYY-MM") a period spans: a year, a quarter or a month. */
export function periodMonths(period: string): { start: string; end: string } {
  const year = period.slice(0, 4);
  const quarter = /^\d{4}Q([1-4])$/.exec(period);
  if (quarter) {
    const q = Number(quarter[1]);
    return { start: `${year}-${String(q * 3 - 2).padStart(2, "0")}`, end: `${year}-${String(q * 3).padStart(2, "0")}` };
  }
  if (/^\d{4}-\d{2}/.test(period)) return { start: period.slice(0, 7), end: period.slice(0, 7) };
  return { start: `${year}-01`, end: `${year}-12` };
}

export const QUERY_DATA_MAX_LIMIT = 200;
export const QUERY_DATA_DEFAULT_LIMIT = 50;

const CANONICAL_CATEGORIES = new Set(Object.values(FEE_FAMILIES).flat());
const REGULATOR_KEYS = Object.keys(PEER_REGULATORS) as [PeerRegulator, ...PeerRegulator[]];
/** "2024", "2026Q2" or "2026-09": the period shapes area_statistics holds. */
const PERIOD = /^\d{4}(?:Q[1-4]|-\d{2})?$/;

const peerSetRequestSchema = z
  .object({
    charter_type: z.enum(["bank", "credit_union", "same"]).optional(),
    asset_tiers: z.union([z.array(z.enum(ASSET_TIERS)).min(1).max(ASSET_TIERS.length), z.literal("same")]).optional(),
    asset_min: z.number().int().nonnegative().optional(),
    asset_max: z.number().int().nonnegative().optional(),
    fed_districts: z.union([z.array(z.number().int().min(1).max(12)).min(1).max(12), z.literal("same")]).optional(),
    states: z.union([z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(60), z.literal("same")]).optional(),
    regulators: z.union([z.array(z.enum(REGULATOR_KEYS)).min(1), z.literal("same")]).optional(),
    cu_charter: z.enum(["federal", "state", "same"]).optional(),
    holding_company: z.union([z.string().regex(/^\d{1,10}$/), z.literal("same")]).optional(),
    market: z.union([z.number().int().min(1).max(99_999), z.literal("same")]).optional(),
    nearest: z.number().int().min(1).max(MAX_NEAREST_PEERS).optional(),
  })
  .strict()
  .refine((p) => p.asset_min === undefined || p.asset_max === undefined || p.asset_min <= p.asset_max, {
    message: "asset_min must not be more than asset_max",
  });

export const queryDataInputSchema = z
  .object({
    measure: z
      .string()
      .max(160)
      .regex(
        /^(?:area:[a-z0-9-]+:[A-Za-z0-9_.-]+|fee:[a-z0-9_]+|call:[a-z0-9_]+|fact:[a-z0-9_]+|family:lei)$/,
        'measure is "area:<source>:<series_key>", "fee:<category>", "call:<item_key>", "fact:<name>" or "family:lei"',
      ),
    scope: z
      .object({
        kind: z.enum(["institution", "peer_set", "state", "county", "metro", "national"]),
        id: z.string().trim().min(1).max(20).optional(),
        peer: peerSetRequestSchema.optional(),
      })
      .strict(),
    period: z
      .object({
        from: z.string().regex(PERIOD, "period.from is a year, 2026Q2 or 2026-09").optional(),
        to: z.string().regex(PERIOD, "period.to is a year, 2026Q2 or 2026-09").optional(),
      })
      .strict()
      .optional(),
    limit: z.number().int().min(1).max(QUERY_DATA_MAX_LIMIT).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const { kind, id, peer } = input.scope;
    if (["institution", "state", "county", "metro"].includes(kind) && !id) {
      ctx.addIssue({ code: "custom", path: ["scope", "id"], message: `scope.id is required for ${kind}` });
    }
    if (kind === "institution" && id && !/^\d{1,10}$/.test(id)) {
      ctx.addIssue({ code: "custom", path: ["scope", "id"], message: "scope.id is the institution's numeric id" });
    }
    if (kind === "peer_set" && !peer) {
      ctx.addIssue({ code: "custom", path: ["scope", "peer"], message: "scope.peer is required for peer_set" });
    }
    if (kind !== "peer_set" && peer) {
      ctx.addIssue({ code: "custom", path: ["scope", "peer"], message: "scope.peer is only for peer_set" });
    }
  });

export type QueryDataInput = z.infer<typeof queryDataInputSchema>;

export interface QueryDataCitation {
  publisher: string;
  source_url: string | null;
  /** The newest period (area data) or publish date (fee data) behind the rows. */
  as_of: string | null;
  /** When Fee Insight last loaded the rows; null for fee data, whose date is as_of. */
  fetched_at: string | null;
  /** The open licence the data is published under (e.g. "CC BY 4.0"); absent for public-domain and our own data. */
  licence?: string;
  /** The credit the licence requires, word for word. Show it with every figure from these rows. */
  attribution?: string;
}

export type QueryDataRow = Record<string, string | number | boolean | null>;

export interface CallReportPeerComparison {
  kind: "call_report_peer_comparison";
  label: string;
  definition: PeerSetDefinition | null;
  filters: ResolvedPeerSet["filters"];
  member_count: number | null;
  subject_institution_id: number | null;
  subject_in_requested_cohort: boolean | null;
  minimum_median_count: number;
  size_criterion: {
    basis: "current institution registry assets";
    asset_tiers: string[] | null;
    minimum_usd_inclusive: number | null;
    maximum_usd_inclusive: number | null;
    nearest_count: number | null;
    nearest_order: string | null;
  };
  nearest_requires_approved_published_fee: boolean;
  selection_limitations: string[];
  income_basis_warning: string | null;
}

export const CALL_REPORT_YTD_COMPARISON_WARNING = "These are year-to-date filed values. YTD equals standalone-quarter income only in Q1. For later quarters, a standalone-quarter peer median requires each same institution's current YTD minus its prior-quarter YTD, then a median over the matched, comparable cohort. Never subtract independently rolled-up quarter medians.";

function callPeerComparison(
  label: string, resolved: ResolvedPeerSet | null, memberIds: number[] | null,
  subjectId: number | null, hasYtd: boolean,
): CallReportPeerComparison {
  const definition = resolved?.definition ?? null;
  const nearest = definition?.nearest ?? null;
  return {
    kind: "call_report_peer_comparison", label,
    definition, filters: resolved?.filters ?? null,
    member_count: memberIds?.length ?? null,
    subject_institution_id: subjectId,
    subject_in_requested_cohort: subjectId === null || memberIds === null ? null : memberIds.includes(subjectId),
    minimum_median_count: ROLLUP_MIN_INSTITUTIONS,
    size_criterion: {
      basis: "current institution registry assets",
      asset_tiers: definition?.asset_tiers ?? null,
      minimum_usd_inclusive: definition?.asset_min ?? null,
      maximum_usd_inclusive: definition?.asset_max ?? null,
      nearest_count: nearest,
      nearest_order: nearest === null ? null : "Absolute distance from the subject's current registry total assets, then institution id",
    },
    nearest_requires_approved_published_fee: nearest !== null,
    selection_limitations: [
      "Definition and filters describe the resolved requested cohort; member_count is its membership, not each source/period's reporting sample.",
      "Each result row separately counts canonical same-source reporters for its report date, unit and period basis; subject_included comes from those actual reporters.",
      "Registry asset tiers and asset distances are current registry attributes, not a reconstruction of filing-date assets.",
      "This is a filing cross-section, not a constant historical cohort or a merger-adjusted growth series.",
      ...(nearest !== null ? ["Nearest peers exclude the subject and require at least one approved published fee; this is not all NCUA filers or all institutions nearest in assets."] : []),
    ],
    income_basis_warning: hasYtd ? CALL_REPORT_YTD_COMPARISON_WARNING : null,
  };
}

export type QueryDataResult =
  | {
      ok: true;
      measure: string;
      scope: CatalogScopeKind;
      rows: QueryDataRow[];
      unit: string | null;
      citation: QueryDataCitation;
      note?: string;
      /** Which index read the fee figures came from (#1924), so an answer can cite it; only where the read is stamped. */
      dataset?: ReturnType<typeof datasetCitation>;
      /** Curated call-report semantics to preserve when Hamilton explains or compares figures. */
      peer_comparison?: CallReportPeerComparison;
      measure_metadata?: {
        item_code: string;
        name: string;
        source: string;
        publisher: string;
        unit: string;
        period_basis: string;
        caveat: string;
      };
    }
  | { ok: false; measure: string; reason: string };

function refuse(measure: string, reason: string): QueryDataResult {
  return { ok: false, measure, reason };
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Parses a measure; the schema has already checked the characters. */
export function parseMeasure(
  measure: string,
):
  | { kind: "area"; source: string; seriesKey: string }
  | { kind: "fee"; category: string }
  | { kind: "call"; itemKey: string }
  | { kind: "fact"; name: string }
  | { kind: "family" } {
  if (measure === FAMILY_MEASURE) return { kind: "family" };
  if (measure.startsWith("fee:")) return { kind: "fee", category: measure.slice(4) };
  if (measure.startsWith("call:")) return { kind: "call", itemKey: measure.slice(5) };
  if (measure.startsWith("fact:")) return { kind: "fact", name: measure.slice(5) };
  const rest = measure.slice(5);
  const cut = rest.indexOf(":");
  return { kind: "area", source: rest.slice(0, cut), seriesKey: rest.slice(cut + 1) };
}

/** Validates the input and runs it. Input that fails the schema is refused with the schema's message. */
export async function queryData(raw: unknown): Promise<QueryDataResult> {
  const parsed = queryDataInputSchema.safeParse(raw);
  const measureText = typeof (raw as { measure?: unknown })?.measure === "string" ? (raw as { measure: string }).measure : "";
  if (!parsed.success) return refuse(measureText, parsed.error.issues.map((i) => i.message).join("; "));
  const input = parsed.data;
  const measure = parseMeasure(input.measure);
  try {
    if (measure.kind === "area") return await queryArea(input, measure.source, measure.seriesKey);
    if (measure.kind === "call") return await queryCall(input, measure.itemKey);
    if (measure.kind === "fact") return await queryFact(input, measure.name);
    if (measure.kind === "family") return await queryFamily(input);
    return await queryFee(input, measure.category);
  } catch (error) {
    if (error instanceof PeerSetError) return refuse(input.measure, error.message);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Peer groups (the shared definition in data-store/peer-sets.ts)
// ---------------------------------------------------------------------------

/**
 * A peer_set scope resolved into its group, or the reason it cannot be. One path for every
 * measure, so "peers" means the same institutions for fees, public data and call-report lines.
 * PeerSetError (an unknown metro, a "same" the institution lacks) propagates to queryData.
 */
export async function resolveScopePeers(scope: QueryDataInput["scope"]): Promise<{ resolved: ResolvedPeerSet } | { reason: string }> {
  const peer = (scope.peer ?? {}) as PeerSetRequest;
  if (Object.values(peer).every((value) => value === undefined)) return { reason: "A peer group needs at least one filter, such as charter_type, asset_tiers or states." };
  if (peer.nearest !== undefined && !scope.id) return { reason: '"nearest" peers need scope.id, the institution to measure distance from.' };
  if (scope.id) {
    if (!/^\d{1,10}$/.test(scope.id)) return { reason: "scope.id is the institution's numeric id." };
    const subject = await getPeerSubject(Number(scope.id));
    if (!subject) return { reason: `No institution with id ${scope.id}.` };
    return { resolved: await resolvePeerRequest(subject, peer) };
  }
  if (Object.values(peer).some((value) => value === "same")) return { reason: '"same" in a peer group needs scope.id, the institution it is the same as.' };
  return { resolved: await resolvePeerSet(definitionFor({ id: 0 }, peer, null), null) };
}

/** A roll-up row: no median (null, never zero) when too few members have a figure. */
function rollupRow(row: RollupRow, label: string, memberCount: number | null): QueryDataRow {
  const enough = row.institution_count >= ROLLUP_MIN_INSTITUTIONS;
  return {
    scope_label: label,
    period: row.period,
    median: enough ? row.median : null,
    p25: enough ? row.p25 : null,
    p75: enough ? row.p75 : null,
    unit: row.unit,
    institution_count: row.institution_count,
    ...(memberCount !== null ? { member_count: memberCount } : {}),
    note: enough
      ? null
      : `Only ${row.institution_count} ${row.institution_count === 1 ? "institution has" : "institutions have"} a figure for this period; a median needs at least ${ROLLUP_MIN_INSTITUTIONS}.`,
  };
}

/** How many of the group stand behind the newest figure. */
function coverageNote(rows: RollupRow[], memberCount: number | null, what: string): string {
  if (rows.length === 0) return `No institution in the group has ${what} for this period.`;
  const newest = rows[0];
  const thin = rows.some((r) => r.institution_count < ROLLUP_MIN_INSTITUTIONS);
  const behind = memberCount !== null ? `${newest.institution_count} of the group's ${memberCount} institutions` : `${newest.institution_count} institutions`;
  return `${behind} have ${what} for ${newest.period}.${thin ? ` A period with fewer than ${ROLLUP_MIN_INSTITUTIONS} shows no median.` : ""}`;
}

function newestFetched(rows: Array<{ fetched_at: string | Date | null }>): string | null {
  return rows.map((r) => iso(r.fetched_at)).filter((d): d is string => Boolean(d)).sort().pop() ?? null;
}

// ---------------------------------------------------------------------------
// Area measures (area_statistics)
// ---------------------------------------------------------------------------

interface AreaRow {
  geo_type: AreaGeoType;
  geo_code: string;
  geo_name: string | null;
  period: string;
  value: number | null;
  unit: string;
  note: string | null;
  source_url: string | null;
  fetched_at: string | Date | null;
}

/** The (geo_type, geo_code) pairs a scope reads, or a reason it cannot be read. */
export async function areaTargets(
  scope: QueryDataInput["scope"],
  servedGeoTypes: readonly AreaGeoType[],
): Promise<{ targets: Array<{ geoType: AreaGeoType; code: string }> } | { reason: string }> {
  // queryArea rolls a peer group up from each member's headquarters instead (queryAreaPeers).
  if (scope.kind === "peer_set") return { reason: "A peer group is not one area; it is rolled up from each member's headquarters." };
  if (scope.kind === "institution") {
    const location = await getInstitutionHqLocation(Number(scope.id));
    if (!location) return { reason: `No institution with id ${scope.id}.` };
    // Finest first: the HQ county, then its metro, then its state.
    const candidates: Array<{ geoType: AreaGeoType; code: string | null }> = [
      { geoType: "county", code: location.county_fips },
      { geoType: "metro", code: location.cbsa_code },
      { geoType: "state", code: location.state_code },
    ];
    const targets = candidates
      .filter((c): c is { geoType: AreaGeoType; code: string } => Boolean(c.code) && servedGeoTypes.includes(c.geoType))
      .map((c) => ({ geoType: c.geoType, code: normalizeGeoCode(c.geoType, c.code) }))
      .filter((c): c is { geoType: AreaGeoType; code: string } => Boolean(c.code));
    if (targets.length === 0) return { reason: "This series has no figures at the institution's county, metro or state level, or its headquarters location is not on record." };
    return { targets };
  }
  const geoType: AreaGeoType = scope.kind === "national" ? "nation" : scope.kind;
  if (!servedGeoTypes.includes(geoType)) {
    return { reason: `This source has no ${scope.kind} figures. It covers: ${servedGeoTypes.map(scopeForAreaGeoType).join(", ")}.` };
  }
  const code = normalizeGeoCode(geoType, scope.id ?? "US");
  if (!code) return { reason: `"${scope.id}" is not a valid ${scope.kind} code (state: two-letter code; county: 5-digit FIPS; metro: 5-digit CBSA).` };
  return { targets: [{ geoType, code }] };
}

async function queryArea(input: QueryDataInput, source: string, seriesKey: string): Promise<QueryDataResult> {
  const entry = catalogEntry(source);
  if (!entry || entry.kind !== "public-data") return refuse(input.measure, `"${source}" is not a source in the data catalog.`);
  if (!entry.servable) return refuse(input.measure, entry.notServableReason ?? "This source may not be shown to customers.");
  if (entry.areaGeoTypes.length === 0) return refuse(input.measure, `${entry.label} holds no area figures to query.`);
  // Dropped for want of a confirmed publisher file, not for their terms: say so.
  const notYet = notYetFromPublisherReason(seriesKey);
  if (notYet) return refuse(input.measure, notYet);
  if (STRUCK_FRED_SERIES.includes(seriesKey) || STRUCK_AREA_SERIES_KEYS.includes(seriesKey)) return refuse(input.measure, "This series was struck: its terms do not allow commercial use.");

  // Bounds become months ("2026Q2" -> 2026-04 .. 2026-06), so a quarter, month or year bound works on any series.
  const from = input.period?.from ? periodMonths(input.period.from).start : null;
  const to = input.period?.to ? periodMonths(input.period.to).end : null;
  const limit = Math.min(input.limit ?? QUERY_DATA_DEFAULT_LIMIT, QUERY_DATA_MAX_LIMIT);

  if (input.scope.kind === "peer_set") return queryAreaPeers(input, entry, seriesKey, from, to, limit);

  const resolved = await areaTargets(input.scope, entry.areaGeoTypes);
  if ("reason" in resolved) return refuse(input.measure, resolved.reason);

  const geoTypes = resolved.targets.map((t) => t.geoType);
  const codes = resolved.targets.map((t) => t.code);

  const rows = await withTransaction(async (tx) => {
    await tx`SET LOCAL statement_timeout = '5s'`;
    return tx<AreaRow[]>`
      SELECT a.geo_type, a.geo_code, a.geo_name, a.period, a.value::float8 AS value, a.unit, a.note,
             a.source_url, a.fetched_at
        FROM area_statistics a
        JOIN unnest(${geoTypes}::text[], ${codes}::text[]) AS g(geo_type, geo_code)
          ON a.geo_type = g.geo_type AND a.geo_code = g.geo_code
       WHERE a.source = ${source}
         AND a.series_key = ${seriesKey}
         -- Struck rows (DECISIONS.md "No non-commercial data") are never returned.
         AND ${tx.unsafe(areaRowServedSql("a"))}
         -- A row counts when its own span of months overlaps the bounds. A period in no known shape is
         -- left out once a bound is given.
         -- Same month rule as periodMonths().
         AND (${from}::text IS NULL OR ${tx.unsafe(AREA_PERIOD_LAST_MONTH_SQL)} >= ${from}::text)
         AND (${to}::text IS NULL OR ${tx.unsafe(AREA_PERIOD_FIRST_MONTH_SQL)} <= ${to}::text)
       ORDER BY a.period DESC, a.geo_type, a.geo_code
       LIMIT ${limit}
    `;
  });

  const list = [...rows];
  const units = [...new Set(list.map((r) => r.unit))];
  const newest = list[0];
  const fetched = newestFetched(list);
  return {
    ok: true,
    measure: input.measure,
    scope: input.scope.kind,
    rows: list.map((r) => ({
      geo_type: scopeForAreaGeoType(r.geo_type),
      geo_code: r.geo_code,
      geo_name: r.geo_name,
      period: r.period,
      value: r.value,
      unit: r.unit,
      note: r.note,
    })),
    unit: units.length === 1 ? units[0] : units.length > 1 ? "mixed" : null,
    citation: areaCitation(entry, newest?.source_url ?? null, newest?.period ?? null, fetched),
    ...(list.length === 0 ? { note: "No figures are loaded for this series at this scope and period." } : {}),
  };
}

function areaCitation(entry: CatalogEntry, sourceUrl: string | null, asOf: string | null, fetchedAt: string | null): QueryDataCitation {
  return {
    publisher: entry.publisher,
    source_url: sourceUrl,
    as_of: asOf,
    fetched_at: fetchedAt,
    ...(entry.licence.licenceName ? { licence: entry.licence.licenceName } : {}),
    ...(entry.licence.attribution ? { attribution: entry.licence.attribution } : {}),
  };
}

/**
 * A public-data series over a peer group. Each member's figure is its headquarters area's, at the
 * finest level the source covers (county, then metro, then state), and the median is taken over
 * members, so two peers in one county both count.
 */
async function queryAreaPeers(
  input: QueryDataInput,
  entry: CatalogEntry,
  seriesKey: string,
  from: string | null,
  to: string | null,
  limit: number,
): Promise<QueryDataResult> {
  const geoType = hqLevelFor(entry.areaGeoTypes);
  if (!geoType) return refuse(input.measure, `${entry.label} has only national figures, so every peer group would get the national value; ask with scope national.`);
  const scoped = await resolveScopePeers(input.scope);
  if ("reason" in scoped) return refuse(input.measure, scoped.reason);
  const { resolved } = scoped;
  const memberIds = await peerSetMemberIds(resolved);
  if (memberIds.length === 0) {
    return {
      ok: true,
      measure: input.measure,
      scope: input.scope.kind,
      rows: [],
      unit: null,
      citation: areaCitation(entry, null, null, null),
      note: `No institutions match the peer group (${resolved.label}).`,
    };
  }

  const rows = await withTransaction(async (tx) => {
    await tx`SET LOCAL statement_timeout = '10s'`;
    return areaPeerRollup(tx, { source: entry.id, seriesKey, geoType, memberIds, from, to, limit, servedSql: areaRowServedSql("a") });
  });
  const level = scopeForAreaGeoType(geoType);
  const units = [...new Set(rows.map((r) => r.unit))];
  const newest = rows[0];
  return {
    ok: true,
    measure: input.measure,
    scope: input.scope.kind,
    rows: rows.map((r) => ({ ...rollupRow(r, resolved.label, memberIds.length), geo_level: level, area_count: r.area_count })),
    unit: units.length === 1 ? units[0] : units.length > 1 ? "mixed" : null,
    citation: areaCitation(entry, newest?.source_url ?? null, newest?.period ?? null, newestFetched(rows)),
    note: `Each institution counts once, at its headquarters ${level}. ${coverageNote(rows, memberIds.length, `a ${level} figure`)}`,
  };
}

// ---------------------------------------------------------------------------
// Fee measures (published_fee_catalog, through the existing index readers)
// ---------------------------------------------------------------------------

const FEE_PUBLISHER = `${SITE_NAME}, ${PRODUCT_NAME}`;

function indexRow(entry: IndexEntry, label: string): QueryDataRow {
  return {
    scope_label: label,
    fee_category: entry.fee_category,
    fee_name: getDisplayName(entry.fee_category),
    median_amount: entry.median_amount,
    p25_amount: entry.p25_amount,
    p75_amount: entry.p75_amount,
    min_amount: entry.min_amount,
    max_amount: entry.max_amount,
    institution_count: entry.institution_count,
    observation_count: entry.observation_count,
    maturity_tier: entry.maturity_tier,
    last_updated: entry.last_updated,
  };
}

function feeResult(input: QueryDataInput, category: string, rows: QueryDataRow[], asOf: string | null, sourceUrl: string | null, note?: string): QueryDataResult {
  return {
    ok: true,
    measure: input.measure,
    scope: input.scope.kind,
    rows: rows.slice(0, Math.min(input.limit ?? QUERY_DATA_DEFAULT_LIMIT, QUERY_DATA_MAX_LIMIT)),
    unit: "USD",
    citation: { publisher: FEE_PUBLISHER, source_url: sourceUrl ?? `${SITE_URL.replace(/\/$/, "")}/fees/${category}`, as_of: asOf, fetched_at: null },
    ...(note ? { note } : rows.length === 0 ? { note: "No published fees in this category at this scope." } : {}),
  };
}

function fromIndex(input: QueryDataInput, category: string, entries: IndexEntry[], label: string, stamp?: DatasetStamp): QueryDataResult {
  const entry = entries.find((e) => e.fee_category === category);
  const result = feeResult(input, category, entry ? [indexRow(entry, label)] : [], entry?.last_updated ?? null, null);
  return result.ok && stamp && entry ? { ...result, dataset: datasetCitation(stamp) } : result;
}

async function queryFee(input: QueryDataInput, category: string): Promise<QueryDataResult> {
  if (!CANONICAL_CATEGORIES.has(category)) return refuse(input.measure, `"${category}" is not a fee category in the ${PRODUCT_NAME}.`);
  const { scope } = input;
  switch (scope.kind) {
    case "national": {
      const { entries, stamp } = await getNationalIndexCachedStamped();
      return fromIndex(input, category, entries, "United States", stamp);
    }
    case "state": {
      const state = normalizeGeoCode("state", scope.id ?? "");
      if (!state) return refuse(input.measure, `"${scope.id}" is not a valid state code.`);
      const indexes = await getStateFeeIndexes(state);
      return fromIndex(input, category, indexes.all, state);
    }
    case "peer_set": {
      const scoped = await resolveScopePeers(scope);
      if ("reason" in scoped) return refuse(input.measure, scoped.reason);
      const { resolved } = scoped;
      if (!resolved.filters) return feeResult(input, category, [], null, null, `No institutions match the peer group (${resolved.label}).`);
      const { entries, stamp } = await getPeerIndexStamped(resolved.filters);
      return fromIndex(input, category, entries, resolved.label, stamp);
    }
    case "institution": {
      const rows = await getInstitutionFeeRows(Number(scope.id), category);
      const asOf = rows.map((r) => iso(r.publishedAt)).filter((d): d is string => Boolean(d)).sort().pop() ?? null;
      return feeResult(
        input,
        category,
        rows.map((r) => ({
          fee_name: r.feeName,
          amount: r.amount,
          frequency: r.frequency,
          conditions: r.conditions,
          fee_audience: r.feeAudience,
          document_url: r.documentUrl,
          published_at: iso(r.publishedAt),
        })),
        asOf,
        rows[0]?.documentUrl ?? null,
      );
    }
    case "county":
    case "metro":
      return refuse(input.measure, `Fee figures by ${scope.kind} are not supported yet; ask by institution, peer group, state or national.`);
  }
}

// ---------------------------------------------------------------------------
// Call-report lines (institution_call_report_items)
// ---------------------------------------------------------------------------

/**
 * A call-report line for one institution (its own filed values), or rolled up over a group: a
 * peer group, the institutions with a branch in a metro (the peer definition's market), a state's
 * institutions, or every filer. Dollar lines come back in dollars whichever regulator filed them.
 */
async function queryCall(input: QueryDataInput, itemKey: string): Promise<QueryDataResult> {
  const measure = ncuaCallMeasure(itemKey);
  const entries = callReportEntries().filter((entry) => !measure || entry.id === CALL_REPORT_ROW_SOURCES.ncua);
  const servable = entries.filter((e) => e.servable);
  if (servable.length === 0) return refuse(input.measure, entries[0]?.notServableReason ?? "Call-report lines may not be shown to customers.");
  const rowSources = Object.entries(CALL_REPORT_ROW_SOURCES)
    .filter(([, id]) => servable.some((e) => e.id === id))
    .map(([rowSource]) => rowSource);
  const from = input.period?.from ? periodMonths(input.period.from).start : null;
  const to = input.period?.to ? periodMonths(input.period.to).end : null;
  const limit = Math.min(input.limit ?? QUERY_DATA_DEFAULT_LIMIT, QUERY_DATA_MAX_LIMIT);
  const { scope } = input;
  const metadata = measure ? {
    measure_metadata: {
      item_code: measure.code,
      name: measure.name,
      source: CALL_REPORT_ROW_SOURCES.ncua,
      publisher: servable[0].publisher,
      unit: measure.unit,
      period_basis: measure.periodBasis,
      caveat: measure.caveat,
    },
  } : {};
  const citation = (
    rows: Array<{ source_url: string | null; fetched_at: string | Date | null; period: string }>,
    rowSourcesSeen: string[],
  ): QueryDataCitation => {
    const named = servable.filter((e) => rowSourcesSeen.some((src) => CALL_REPORT_ROW_SOURCES[src] === e.id));
    return {
      publisher: (named.length ? named : servable).map((e) => e.publisher).join("; "),
      source_url: rows[0]?.source_url ?? null,
      as_of: rows[0]?.period ?? null,
      fetched_at: newestFetched(rows),
    };
  };

  if (scope.kind === "institution") {
    const hotRows = await withTransaction(async (tx) => {
      await tx`SET LOCAL statement_timeout = '5s'`;
      return callInstitutionSeries(tx, { itemKey, rowSources, institutionId: Number(scope.id), from, to, limit });
    });
    const { rows, note: coldNote } = await withColdQuarters(hotRows, { itemKey, rowSources, from, to, limit, institutionIds: [Number(scope.id)] }, coldInstitutionSeries);
    const units = [...new Set(rows.map((r) => r.unit))];
    return {
      ok: true,
      measure: input.measure,
      scope: scope.kind,
      ...metadata,
      rows: rows.map((r) => ({
        institution_id: Number(scope.id),
        period: r.period,
        value: r.value,
        unit: r.unit,
        period_basis: r.period_basis,
        item_code: r.item_code,
        item_description: r.item_description,
        schedule: r.schedule,
        source: r.source,
        source_url: r.source_url,
        fetched_at: iso(r.fetched_at),
      })),
      unit: units.length === 1 ? units[0] : units.length > 1 ? "mixed" : null,
      citation: citation(rows, [...new Set(rows.map((r) => r.source))]),
      ...(rows.length === 0
        ? { note: `${measure ? `This institution has no comparable loaded figures for this line with unit ${measure.unit} and period basis ${measure.periodBasis}.` : "This institution has no filed figures for this line in the loaded quarters."}${coldNote ? ` ${coldNote}` : ""}` }
        : coldNote ? { note: coldNote } : {}),
    };
  }

  if (scope.kind === "county") return refuse(input.measure, "Call-report lines are not rolled up by county; ask by institution, peer group, metro, state or national.");

  let label: string;
  let memberIds: number[] | null;
  let cohort: ResolvedPeerSet | null = null;
  const subjectId = scope.kind === "peer_set" && scope.id ? Number(scope.id) : null;
  if (scope.kind === "national") {
    label = measure ? "NCUA credit union filers" : "All filers";
    memberIds = null;
  } else {
    let resolved: ResolvedPeerSet;
    if (scope.kind === "peer_set") {
      const scoped = await resolveScopePeers(scope);
      if ("reason" in scoped) return refuse(input.measure, scoped.reason);
      resolved = scoped.resolved;
    } else {
      const def: PeerSetDefinition = {};
      if (scope.kind === "state") {
        const state = normalizeGeoCode("state", scope.id ?? "");
        if (!state) return refuse(input.measure, `"${scope.id}" is not a valid state code.`);
        def.states = [state];
      } else {
        const metro = normalizeGeoCode("metro", scope.id ?? "");
        if (!metro) return refuse(input.measure, `"${scope.id}" is not a valid metro (5-digit CBSA) code.`);
        def.market_code = Number(metro);
      }
      resolved = await resolvePeerSet(def, null);
    }
    cohort = resolved;
    label = resolved.label;
    memberIds = await peerSetMemberIds(resolved);
    if (memberIds.length === 0) {
      return { ok: true, measure: input.measure, scope: scope.kind, ...metadata, rows: [], unit: null, citation: citation([], []),
        peer_comparison: callPeerComparison(label, cohort, memberIds, subjectId, measure?.periodBasis === "ytd"),
        note: `No institutions match the group (${label}).` };
    }
  }

  const hotRows = await withTransaction(async (tx) => {
    await tx`SET LOCAL statement_timeout = '10s'`;
    return callPeerRollup(tx, { itemKey, rowSources, memberIds, subjectId, from, to, limit });
  });
  const { rows, note: coldNote } = await withColdQuarters(hotRows, { itemKey, rowSources, from, to, limit, institutionIds: memberIds }, (coldRows) => coldCallRollup(coldRows, subjectId));
  const units = [...new Set(rows.map((r) => r.unit))];
  const memberCount = memberIds?.length ?? null;
  const comparison = callPeerComparison(label, cohort, memberIds, subjectId, rows.some((row) => row.period_basis === "ytd") || measure?.periodBasis === "ytd");
  return {
    ok: true,
    measure: input.measure,
    scope: scope.kind,
    ...metadata,
    peer_comparison: comparison,
    rows: rows.map((r) => ({ ...rollupRow(r, `${label} — ${(r.sources ?? []).join("/").toUpperCase()} filers only`, memberCount),
      period_basis: r.period_basis, sources: (r.sources ?? []).join(", "), reported_count: r.institution_count,
      minimum_median_count: ROLLUP_MIN_INSTITUTIONS, subject_included: r.subject_included ?? null,
    })),
    unit: units.length === 1 ? units[0] : units.length > 1 ? "mixed" : null,
    citation: citation(rows, [...new Set(rows.flatMap((r) => r.sources ?? []))]),
    note: `${measure && rows.length === 0 ? `No comparable loaded figures for this line with unit ${measure.unit} and period basis ${measure.periodBasis}. ` : ""}${coverageNote(rows, memberCount, "a filed figure")}${coldNote ? ` ${coldNote}` : ""}${comparison.income_basis_warning ? ` ${comparison.income_basis_warning}` : ""}`,
  };
}

// ---------------------------------------------------------------------------
// Institution facts from their own documents (institution_payment_features)
// ---------------------------------------------------------------------------

interface FactRow {
  status: string;
  evidence_url: string;
  evidence_snippet: string;
  read_at: Date | string | null;
  rule: string;
}

/** What each stored status means, in the words an answer uses. */
const FACT_ANSWERS: Record<string, string> = {
  offers: "yes",
  does_not_offer: "no",
  unclear: "unclear",
};

/**
 * One institution's fact, read from its own documents: yes, no or unclear, with the sentence and
 * the link to the document it came from. No row means none of its stored documents names the
 * service, which is not a "no".
 */
async function queryFact(input: QueryDataInput, name: string): Promise<QueryDataResult> {
  const fact = FACT_MEASURES[name];
  if (!fact) return refuse(input.measure, `"${name}" is not an institution fact; the facts are ${Object.keys(FACT_MEASURES).map((k) => `fact:${k}`).join(", ")}.`);
  const entry = catalogEntry(fact.source);
  if (!entry?.servable) return refuse(input.measure, entry?.notServableReason ?? "This fact is not available.");
  const { scope } = input;
  if (scope.kind !== "institution") return refuse(input.measure, "This fact is answered for one institution at a time; ask with scope.kind institution.");
  const rows = await withTransaction(async (tx) => {
    await tx`SET LOCAL statement_timeout = '5s'`;
    return tx<FactRow[]>`
      SELECT status, evidence_url, evidence_snippet, read_at, rule
        FROM institution_payment_features
       WHERE institution_id = ${Number(scope.id)}
         AND feature = ${fact.feature}
    `;
  });
  const row = [...rows][0];
  if (!row) {
    return {
      ok: true,
      measure: input.measure,
      scope: scope.kind,
      rows: [],
      unit: null,
      citation: { publisher: entry.publisher, source_url: null, as_of: null, fetched_at: null },
      note: "None of this institution's documents that we hold names this service, so whether it offers it is not known.",
    };
  }
  const readAt = iso(row.read_at);
  return {
    ok: true,
    measure: input.measure,
    scope: scope.kind,
    rows: [{ fact: fact.name, answer: FACT_ANSWERS[row.status] ?? "unclear", evidence: row.evidence_snippet, document_url: row.evidence_url, read_at: readAt }],
    unit: null,
    citation: { publisher: entry.publisher, source_url: row.evidence_url, as_of: readAt ? readAt.slice(0, 10) : null, fetched_at: readAt },
    ...(row.status === "unclear"
      ? { note: row.rule === "conflict" ? "The institution's documents disagree about this service." : "The institution's documents name this service without saying whether it is offered." }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Corporate family (GLEIF level 1 and level 2, through institution_lei_links)
// ---------------------------------------------------------------------------

const GLEIF_CATALOG_ID = "gleif";

/** Why an institution has no family to show, from its LEI match. */
async function noFamilyNote(institutionId: number, leis: string[]): Promise<string> {
  if (leis.length > 0) return `This institution's LEI (${leis.join(", ")}) is known, but its GLEIF record is not loaded yet.`;
  const link = await getInstitutionLeiLink(institutionId);
  if (!link) return "This institution has not been matched to an LEI yet.";
  if (link.status === "linked") return `This institution's LEI is ${link.lei}; its GLEIF record is not loaded yet.`;
  if (link.status === "ambiguous") return "More than one LEI could be this institution's, so none is shown until a person reviews the match.";
  return "No LEI was found for this institution in GLEIF's register, so it has no corporate family on record.";
}

/**
 * One institution's corporate family by GLEIF accounting-consolidation parents: the ultimate
 * parent, every member under it, and each member's relation to the institution (its parents, the
 * institution itself, its subsidiaries, and other members of the family).
 */
async function queryFamily(input: QueryDataInput): Promise<QueryDataResult> {
  const entry = catalogEntry(GLEIF_CATALOG_ID);
  if (!entry) return refuse(input.measure, "GLEIF data is not in the data catalog.");
  if (!entry.servable) return refuse(input.measure, entry.notServableReason ?? "This source may not be shown to customers.");
  if (input.scope.kind !== "institution") return refuse(input.measure, "A corporate family is read for one institution; use scope institution with its id.");
  const institutionId = Number(input.scope.id);
  const family = await getCorporateFamily(institutionId);
  const citation = async (lei: string | null): Promise<QueryDataCitation> => {
    let asOf: string | null = null;
    try {
      asOf = (await getGleifLinkSummary()).latest_publish;
    } catch {
      asOf = null;
    }
    return {
      publisher: entry.publisher,
      source_url: lei ? `https://search.gleif.org/#/record/${lei}` : null,
      as_of: asOf,
      fetched_at: null,
      ...(entry.licence.licenceName ? { licence: entry.licence.licenceName } : {}),
    };
  };
  if (!family.tree) {
    return {
      ok: true,
      measure: input.measure,
      scope: "institution",
      rows: [],
      unit: null,
      citation: await citation(family.institution_leis[0] ?? null),
      note: await noFamilyNote(institutionId, family.institution_leis),
    };
  }
  const rows = familyRows(family.tree, new Set(family.institution_leis));
  const limit = Math.min(input.limit ?? QUERY_DATA_DEFAULT_LIMIT, QUERY_DATA_MAX_LIMIT);
  return {
    ok: true,
    measure: input.measure,
    scope: "institution",
    rows: rows.slice(0, limit),
    unit: null,
    citation: await citation(family.institution_leis[0] ?? null),
    note: `${family.members} ${family.members === 1 ? "entity is" : "entities are"} in this corporate family, ${family.linked_members} of them banks or credit unions we track.${rows.length > limit ? ` The first ${limit} are listed.` : ""}`,
  };
}

/**
 * The family tree as rows, root first. relation: "subject" (the institution), "ultimate_parent",
 * "parent" (on the path from the institution up to the root), "subsidiary" (under the
 * institution) or "affiliate" (elsewhere in the family).
 */
export function familyRows(root: FamilyNode, subjectLeis: Set<string>): QueryDataRow[] {
  const byLei = new Map<string, { node: FamilyNode; parent: string | null; depth: number }>();
  const walk = (node: FamilyNode, parent: string | null, depth: number) => {
    byLei.set(node.lei, { node, parent, depth });
    node.children.forEach((c) => walk(c, node.lei, depth + 1));
  };
  walk(root, null, 0);
  const above = new Set<string>();
  const below = new Set<string>();
  const down = (n: FamilyNode) => {
    for (const c of n.children) {
      below.add(c.lei);
      down(c);
    }
  };
  for (const lei of subjectLeis) {
    let up = byLei.get(lei)?.parent ?? null;
    while (up) {
      above.add(up);
      up = byLei.get(up)?.parent ?? null;
    }
    const subject = byLei.get(lei)?.node;
    if (subject) down(subject);
  }
  return [...byLei.values()].map(({ node, parent, depth }) => ({
    relation: subjectLeis.has(node.lei)
      ? "subject"
      : node.lei === root.lei
        ? "ultimate_parent"
        : above.has(node.lei)
          ? "parent"
          : below.has(node.lei)
            ? "subsidiary"
            : "affiliate",
    depth,
    lei: node.lei,
    legal_name: node.legal_name,
    legal_country: node.legal_country,
    parent_lei: parent,
    entity_status: node.entity_status,
    institution_id: node.institution_id,
    institution_name: node.institution_name,
  }));
}

/**
 * Adds archived quarters (#1870): when the hot rows leave room under the limit, quarters whose
 * rows were pruned to cold files are read from those files and shaped like the hot rows. Hot
 * source/period pairs always win; at most MAX_COLD_FILES_PER_QUERY files are read per question.
 */
async function withColdQuarters<T extends { period: string; source?: string; sources?: readonly string[] | null }>(
  hotRows: T[],
  args: { itemKey: string; rowSources: string[]; from: string | null; to: string | null; limit: number; institutionIds: number[] | null },
  shape: (rows: ColdCallRow[]) => T[],
): Promise<{ rows: T[]; note: string | null }> {
  if (hotRows.length >= args.limit) return { rows: hotRows, note: null };
  const hotSourcePeriods = new Set(hotRows.flatMap((row) =>
    (row.source ? [row.source] : row.sources ?? []).map((source) => callSourcePeriodKey(source, row.period)),
  ));
  const files = coldFilesInRange(await prunedCallFiles(), { ...args, hotSourcePeriods });
  if (files.length === 0) return { rows: hotRows, note: null };
  const read = files.slice(0, MAX_COLD_FILES_PER_QUERY);
  const cold = await readColdCallRows(read, { itemKey: args.itemKey, institutionIds: args.institutionIds });
  const institutionIds = [...new Set(cold.rows.map((row) => row.institution_id))]
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  const identities = institutionIds.length === 0 ? [] : await withTransaction(async (tx) => {
    await tx`SET LOCAL statement_timeout = '5s'`;
    return tx<Array<{ id: number | string; charter_type: string }>>`
      SELECT id, charter_type FROM institution_sources WHERE id = ANY(${institutionIds}::bigint[])
    `;
  });
  const comparableRows = canonicalColdCallRows(cold.rows, identities);
  const rows = [...hotRows, ...shape(comparableRows)]
    .sort((a, b) => (a.period === b.period ? 0 : a.period < b.period ? 1 : -1))
    .slice(0, args.limit);
  const notes: string[] = [];
  if (comparableRows.length < cold.rows.length) notes.push("Archived rows with unknown or mismatched canonical institution identity are excluded.");
  if (files.length > read.length) notes.push(`Older quarters are archived; at most ${MAX_COLD_FILES_PER_QUERY} archived quarter files are read per question, so ask with a narrower period to read the rest.`);
  if (cold.failed.length > 0) notes.push(`Archived quarters that could not be read are left out: ${cold.failed.join(", ")}.`);
  if (cold.incomplete?.length) notes.push(`Archived rows with no reported value are left out, not counted as zero: ${cold.incomplete.join(", ")}.`);
  return { rows, note: notes.length > 0 ? notes.join(" ") : null };
}
