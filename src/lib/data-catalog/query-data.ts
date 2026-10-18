import { z } from "zod";

import { ASSET_TIERS } from "@/lib/api-v1";
import { PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { withTransaction } from "@/lib/data-store/connection";
import { getInstitutionHqLocation, normalizeGeoCode, type AreaGeoType } from "@/lib/data-store/economy-aggregates";
import {
  getInstitutionFeeRows,
  getNationalIndexCached,
  getPeerIndex,
  getStateFeeIndexes,
  type IndexEntry,
} from "@/lib/data-store/fee-index";
import { PeerSetError, definitionFor, getPeerSubject, resolvePeerRequest, resolvePeerSet, type PeerSetRequest } from "@/lib/data-store/peer-sets";
import { STRUCK_AREA_SERIES_KEYS, STRUCK_FRED_SERIES, areaRowServedSql, notYetFromPublisherReason } from "@/lib/data-store/struck-sources";
import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";
import { MAX_NEAREST_PEERS, PEER_REGULATORS, type PeerRegulator } from "@/lib/peer-set-dimensions";
import { catalogEntry, scopeForAreaGeoType, type CatalogScopeKind } from "./catalog";

/**
 * One safe query over the data catalog, for Hamilton's tools and the site. The caller names a
 * measure and a scope; this module writes the SQL. Every value from the input reaches Postgres as
 * a bound parameter, never as SQL text, and a measure the catalog does not let us show is refused
 * with a plain reason.
 *
 * - `area:<source>:<series_key>`: a public-data series from area_statistics.
 * - `fee:<category>`: a fee category from the published fee index.
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
      .regex(/^(?:area:[a-z0-9-]+:[A-Za-z0-9_.-]+|fee:[a-z0-9_]+)$/, 'measure is "area:<source>:<series_key>" or "fee:<category>"'),
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

export type QueryDataRow = Record<string, string | number | null>;

export type QueryDataResult =
  | { ok: true; measure: string; scope: CatalogScopeKind; rows: QueryDataRow[]; unit: string | null; citation: QueryDataCitation; note?: string }
  | { ok: false; measure: string; reason: string };

function refuse(measure: string, reason: string): QueryDataResult {
  return { ok: false, measure, reason };
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Parses "area:<source>:<series_key>"; the schema has already checked the characters. */
export function parseMeasure(measure: string): { kind: "area"; source: string; seriesKey: string } | { kind: "fee"; category: string } {
  if (measure.startsWith("fee:")) return { kind: "fee", category: measure.slice(4) };
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
    return measure.kind === "area"
      ? await queryArea(input, measure.source, measure.seriesKey)
      : await queryFee(input, measure.category);
  } catch (error) {
    if (error instanceof PeerSetError) return refuse(input.measure, error.message);
    throw error;
  }
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
  if (scope.kind === "peer_set") return { reason: "Peer groups are not supported for public-data measures yet; ask by institution, state, county, metro or national." };
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

  const resolved = await areaTargets(input.scope, entry.areaGeoTypes);
  if ("reason" in resolved) return refuse(input.measure, resolved.reason);

  const geoTypes = resolved.targets.map((t) => t.geoType);
  const codes = resolved.targets.map((t) => t.code);
  // Bounds become months ("2026Q2" -> 2026-04 .. 2026-06), so a quarter, month or year bound works on any series.
  const from = input.period?.from ? periodMonths(input.period.from).start : null;
  const to = input.period?.to ? periodMonths(input.period.to).end : null;
  const limit = Math.min(input.limit ?? QUERY_DATA_DEFAULT_LIMIT, QUERY_DATA_MAX_LIMIT);

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
         AND (${from}::text IS NULL OR (CASE
               WHEN a.period ~ '^[0-9]{4}$' THEN a.period || '-12'
               WHEN a.period ~ '^[0-9]{4}Q[1-4]$' THEN left(a.period, 4) || '-' || lpad((substr(a.period, 6, 1)::int * 3)::text, 2, '0')
               WHEN a.period ~ '^[0-9]{4}-[0-9]{2}' THEN left(a.period, 7)
             END) >= ${from}::text)
         AND (${to}::text IS NULL OR (CASE
               WHEN a.period ~ '^[0-9]{4}$' THEN a.period || '-01'
               WHEN a.period ~ '^[0-9]{4}Q[1-4]$' THEN left(a.period, 4) || '-' || lpad(((substr(a.period, 6, 1)::int - 1) * 3 + 1)::text, 2, '0')
               WHEN a.period ~ '^[0-9]{4}-[0-9]{2}' THEN left(a.period, 7)
             END) <= ${to}::text)
       ORDER BY a.period DESC, a.geo_type, a.geo_code
       LIMIT ${limit}
    `;
  });

  const list = [...rows];
  const units = [...new Set(list.map((r) => r.unit))];
  const newest = list[0];
  const fetched = list.map((r) => iso(r.fetched_at)).filter((d): d is string => Boolean(d)).sort().pop() ?? null;
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
    citation: {
      publisher: entry.publisher,
      source_url: newest?.source_url ?? null,
      as_of: newest?.period ?? null,
      fetched_at: fetched,
      ...(entry.licence.licenceName ? { licence: entry.licence.licenceName } : {}),
      ...(entry.licence.attribution ? { attribution: entry.licence.attribution } : {}),
    },
    ...(list.length === 0 ? { note: "No figures are loaded for this series at this scope and period." } : {}),
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

function fromIndex(input: QueryDataInput, category: string, entries: IndexEntry[], label: string): QueryDataResult {
  const entry = entries.find((e) => e.fee_category === category);
  return feeResult(input, category, entry ? [indexRow(entry, label)] : [], entry?.last_updated ?? null, null);
}

async function queryFee(input: QueryDataInput, category: string): Promise<QueryDataResult> {
  if (!CANONICAL_CATEGORIES.has(category)) return refuse(input.measure, `"${category}" is not a fee category in the ${PRODUCT_NAME}.`);
  const { scope } = input;
  switch (scope.kind) {
    case "national":
      return fromIndex(input, category, await getNationalIndexCached(), "United States");
    case "state": {
      const state = normalizeGeoCode("state", scope.id ?? "");
      if (!state) return refuse(input.measure, `"${scope.id}" is not a valid state code.`);
      const indexes = await getStateFeeIndexes(state);
      return fromIndex(input, category, indexes.all, state);
    }
    case "peer_set": {
      const peer = scope.peer as PeerSetRequest;
      const usesSame = Object.values(peer).some((value) => value === "same");
      if (Object.values(peer).every((value) => value === undefined)) return refuse(input.measure, "A peer group needs at least one filter, such as charter_type, asset_tiers or states.");
      if (peer.nearest !== undefined && !scope.id) return refuse(input.measure, '"nearest" peers need scope.id, the institution to measure distance from.');
      let resolved;
      if (scope.id) {
        if (!/^\d{1,10}$/.test(scope.id)) return refuse(input.measure, "scope.id is the institution's numeric id.");
        const subject = await getPeerSubject(Number(scope.id));
        if (!subject) return refuse(input.measure, `No institution with id ${scope.id}.`);
        resolved = await resolvePeerRequest(subject, peer);
      } else {
        if (usesSame) return refuse(input.measure, '"same" in a peer group needs scope.id, the institution it is the same as.');
        resolved = await resolvePeerSet(definitionFor({ id: 0 }, peer, null), null);
      }
      if (!resolved.filters) return feeResult(input, category, [], null, null, `No institutions match the peer group (${resolved.label}).`);
      return fromIndex(input, category, await getPeerIndex(resolved.filters), resolved.label);
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
