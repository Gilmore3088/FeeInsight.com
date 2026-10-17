import { sql } from "./connection";

/**
 * Reads over AllThePlaces locations (atp_financial_locations, CC0) and GLEIF entities and
 * relationships (gleif_entities, gleif_relationships; GLEIF terms of use). Server only.
 *
 * AllThePlaces covers the chains its spiders scrape, so every count here is a count of mapped
 * locations, never a market total. A location links to an institution only through the reviewed
 * Wikidata mapping or an exact name in the same state; unlinked ones are counted, never assigned.
 */

export const ATP_SOURCE_NOTE = "AllThePlaces (alltheplaces.xyz), CC0 1.0";
export const GLEIF_SOURCE_NOTE = "GLEIF LEI data, used under GLEIF's terms of use";

/** Each spider's newest run only, so a location a chain closed drops out. */
const ATP_CURRENT = `a.atp_run_id = (SELECT MAX(x.atp_run_id) FROM atp_financial_locations x WHERE x.spider = a.spider)`;

export const MAX_RADIUS_MILES = 50;

/** Radius clamped to (0, 50] miles; null for anything that is not a positive number. */
export function clampMiles(miles: number): number | null {
  if (!Number.isFinite(miles) || miles <= 0) return null;
  return Math.min(miles, MAX_RADIUS_MILES);
}

// ---------------------------------------------------------------------------------------------
// AllThePlaces

export interface AtpSpiderCoverageRow {
  spider: string;
  atp_run_id: string;
  branches: number;
  atms: number;
  linked: number;
  unlinked: number;
  without_coordinates: number;
}

/** Per spider: what its newest run gave and how much of it links to an institution. */
export async function getAtpCoverage(): Promise<AtpSpiderCoverageRow[]> {
  const rows = await sql<AtpSpiderCoverageRow[]>`
    SELECT a.spider, a.atp_run_id,
           COUNT(*) FILTER (WHERE a.kind = 'branch')::int AS branches,
           COUNT(*) FILTER (WHERE a.kind = 'atm')::int AS atms,
           COUNT(a.institution_id)::int AS linked,
           (COUNT(*) - COUNT(a.institution_id))::int AS unlinked,
           COUNT(*) FILTER (WHERE a.lat IS NULL)::int AS without_coordinates
      FROM atp_financial_locations a
     WHERE ${sql.unsafe(ATP_CURRENT)}
     GROUP BY a.spider, a.atp_run_id
     ORDER BY a.spider
  `;
  return [...rows];
}

export interface AtpUnlinkedBrandRow {
  brand: string | null;
  brand_wikidata: string | null;
  locations: number;
  states: number;
}

/** Brands with the most unlinked locations: the review list for brand_wikidata_institutions. */
export async function getAtpUnlinkedBrands(limit = 100): Promise<AtpUnlinkedBrandRow[]> {
  const rows = await sql<AtpUnlinkedBrandRow[]>`
    SELECT COALESCE(a.brand, a.operator) AS brand, a.brand_wikidata, COUNT(*)::int AS locations, COUNT(DISTINCT a.state)::int AS states
      FROM atp_financial_locations a
     WHERE a.institution_id IS NULL AND ${sql.unsafe(ATP_CURRENT)}
     GROUP BY 1, 2
     ORDER BY 3 DESC
     LIMIT ${limit}
  `;
  return [...rows];
}

export interface NearbyBrandRow {
  kind: "branch" | "atm";
  brand: string | null;
  brand_wikidata: string | null;
  /** The institution the brand links to; null when unlinked. */
  institution_id: number | null;
  institution_name: string | null;
  /** Distinct mapped locations within the radius of any of the institution's branches. */
  locations: number;
  nearest_miles: number;
}

export interface NearbyCompetitors {
  miles: number;
  /** The institution's own branches with coordinates, used as centres. */
  own_branches_with_coordinates: number;
  own_branches_without_coordinates: number;
  rows: NearbyBrandRow[];
  source_note: string;
}

/**
 * Competitor branches and ATMs mapped by AllThePlaces within `miles` of any of an institution's
 * branches (banks: newest FDIC Summary of Deposits year; credit unions: NCUA branches with a
 * geocoded point), by brand and kind. Locations linked to the institution itself are left out.
 */
export async function getCompetitorLocationsNearInstitution(institutionId: number, miles: number): Promise<NearbyCompetitors> {
  const radius = clampMiles(miles);
  if (radius === null) throw new Error(`Radius must be a positive number of miles, got ${miles}`);
  const own = await sql<Array<{ with_coords: number; without_coords: number }>>`
    WITH own AS (
      SELECT latitude, longitude FROM institution_branch_deposits
       WHERE institution_id = ${institutionId} AND year = (SELECT MAX(year) FROM institution_branch_deposits)
      UNION ALL
      SELECT latitude, longitude FROM credit_union_branches WHERE institution_id = ${institutionId}
    )
    SELECT COUNT(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::int AS with_coords,
           COUNT(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL)::int AS without_coords
      FROM own
  `;
  const rows = await sql<NearbyBrandRow[]>`
    WITH own AS (
      SELECT latitude AS lat, longitude AS lon FROM institution_branch_deposits
       WHERE institution_id = ${institutionId} AND year = (SELECT MAX(year) FROM institution_branch_deposits)
         AND latitude IS NOT NULL AND longitude IS NOT NULL
      UNION
      SELECT latitude, longitude FROM credit_union_branches
       WHERE institution_id = ${institutionId} AND latitude IS NOT NULL AND longitude IS NOT NULL
    ),
    near AS (
      SELECT a.id, a.kind, a.brand, a.operator, a.brand_wikidata, a.institution_id,
             MIN(2 * 3958.8 * ASIN(SQRT(
               POWER(SIN(RADIANS(a.lat - o.lat) / 2), 2) +
               COS(RADIANS(o.lat)) * COS(RADIANS(a.lat)) * POWER(SIN(RADIANS(a.lon - o.lon) / 2), 2)))) AS miles
        FROM atp_financial_locations a
        JOIN own o
          ON a.lat BETWEEN o.lat - ${radius / 69.0} AND o.lat + ${radius / 69.0}
         AND a.lon BETWEEN o.lon - ${radius} / (69.17 * GREATEST(COS(RADIANS(o.lat)), 0.01))
                       AND o.lon + ${radius} / (69.17 * GREATEST(COS(RADIANS(o.lat)), 0.01))
       WHERE a.lat IS NOT NULL
         AND a.institution_id IS DISTINCT FROM ${institutionId}
         AND ${sql.unsafe(ATP_CURRENT)}
       GROUP BY a.id, a.kind, a.brand, a.operator, a.brand_wikidata, a.institution_id
    )
    SELECT n.kind, COALESCE(n.brand, n.operator) AS brand, n.brand_wikidata, n.institution_id,
           s.institution_name, COUNT(*)::int AS locations, MIN(n.miles)::float8 AS nearest_miles
      FROM near n
      LEFT JOIN institution_sources s ON s.id = n.institution_id
     WHERE n.miles <= ${radius}
     GROUP BY n.kind, COALESCE(n.brand, n.operator), n.brand_wikidata, n.institution_id, s.institution_name
     ORDER BY locations DESC, nearest_miles
  `;
  const counts = [...own][0];
  return {
    miles: radius,
    own_branches_with_coordinates: counts?.with_coords ?? 0,
    own_branches_without_coordinates: counts?.without_coords ?? 0,
    rows: [...rows].map((r) => ({ ...r, institution_id: r.institution_id === null ? null : Number(r.institution_id) })),
    source_note: ATP_SOURCE_NOTE,
  };
}

export interface BranchAtmRow {
  source: "fdic_sod" | "ncua";
  branch_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  /** Mapped ATMs within the radius not linked to this institution (other institutions or unlinked brands). */
  competitor_atms: number;
  /** Of those, ATMs whose brand links to a tracked institution. */
  competitor_atms_linked: number;
  competitor_brands: number;
  nearest_competitor_atm_miles: number | null;
  /** Mapped ATMs within the radius linked to this institution itself. */
  own_atms: number;
}

export interface BranchAtmSummary {
  miles: number;
  branches_with_coordinates: number;
  branches_without_coordinates: number;
  /** Median competitor ATMs per branch, with the branch count it is taken over; null with no branches. */
  median_competitor_atms: number | null;
  median_count: number;
  branches_with_no_competitor_atm: number;
  rows: BranchAtmRow[];
  source_note: string;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function summarizeBranchAtms(miles: number, rows: BranchAtmRow[], withoutCoordinates: number): BranchAtmSummary {
  const counts = rows.map((r) => r.competitor_atms);
  return {
    miles,
    branches_with_coordinates: rows.length,
    branches_without_coordinates: withoutCoordinates,
    median_competitor_atms: median(counts),
    median_count: counts.length,
    branches_with_no_competitor_atm: counts.filter((c) => c === 0).length,
    rows,
    source_note: ATP_SOURCE_NOTE,
  };
}

/**
 * Competitor ATMs mapped by AllThePlaces near each of an institution's branches: where its
 * customers are most likely to use someone else's ATM and pay an out-of-network fee. Counts are
 * of mapped ATMs (chains AllThePlaces scrapes), so a zero means none mapped, not none there.
 */
export async function getCompetitorAtmsByBranch(institutionId: number, miles: number): Promise<BranchAtmSummary> {
  const radius = clampMiles(miles);
  if (radius === null) throw new Error(`Radius must be a positive number of miles, got ${miles}`);
  const [missing] = await sql<Array<{ n: number }>>`
    SELECT ((SELECT COUNT(*) FROM institution_branch_deposits
              WHERE institution_id = ${institutionId} AND year = (SELECT MAX(year) FROM institution_branch_deposits)
                AND (latitude IS NULL OR longitude IS NULL))
          + (SELECT COUNT(*) FROM credit_union_branches
              WHERE institution_id = ${institutionId} AND (latitude IS NULL OR longitude IS NULL)))::int AS n
  `;
  const rows = await sql<BranchAtmRow[]>`
    WITH own AS (
      SELECT 'fdic_sod'::text AS source, branch_number::text AS branch_key, branch_name, address, city, state,
             latitude AS lat, longitude AS lon
        FROM institution_branch_deposits
       WHERE institution_id = ${institutionId} AND year = (SELECT MAX(year) FROM institution_branch_deposits)
         AND latitude IS NOT NULL AND longitude IS NOT NULL
      UNION ALL
      SELECT 'ncua', site_id::text, site_name, address, city, state, latitude, longitude
        FROM credit_union_branches
       WHERE institution_id = ${institutionId} AND latitude IS NOT NULL AND longitude IS NOT NULL
    ),
    pairs AS (
      SELECT o.source, o.branch_key, a.id, a.institution_id, COALESCE(a.brand, a.operator) AS brand,
             2 * 3958.8 * ASIN(SQRT(
               POWER(SIN(RADIANS(a.lat - o.lat) / 2), 2) +
               COS(RADIANS(o.lat)) * COS(RADIANS(a.lat)) * POWER(SIN(RADIANS(a.lon - o.lon) / 2), 2))) AS miles
        FROM own o
        JOIN atp_financial_locations a
          ON a.kind = 'atm' AND a.lat IS NOT NULL
         AND a.lat BETWEEN o.lat - ${radius / 69.0} AND o.lat + ${radius / 69.0}
         AND a.lon BETWEEN o.lon - ${radius} / (69.17 * GREATEST(COS(RADIANS(o.lat)), 0.01))
                       AND o.lon + ${radius} / (69.17 * GREATEST(COS(RADIANS(o.lat)), 0.01))
       WHERE ${sql.unsafe(ATP_CURRENT)}
    )
    SELECT o.source, o.branch_name, o.address, o.city, o.state,
           COUNT(p.id) FILTER (WHERE p.institution_id IS DISTINCT FROM ${institutionId})::int AS competitor_atms,
           COUNT(p.id) FILTER (WHERE p.institution_id IS NOT NULL AND p.institution_id <> ${institutionId})::int AS competitor_atms_linked,
           COUNT(DISTINCT p.brand) FILTER (WHERE p.institution_id IS DISTINCT FROM ${institutionId})::int AS competitor_brands,
           MIN(p.miles) FILTER (WHERE p.institution_id IS DISTINCT FROM ${institutionId})::float8 AS nearest_competitor_atm_miles,
           COUNT(p.id) FILTER (WHERE p.institution_id = ${institutionId})::int AS own_atms
      FROM own o
      LEFT JOIN pairs p ON p.source = o.source AND p.branch_key = o.branch_key AND p.miles <= ${radius}
     GROUP BY o.source, o.branch_key, o.branch_name, o.address, o.city, o.state
     ORDER BY competitor_atms DESC, o.state, o.city
  `;
  return summarizeBranchAtms(radius, [...rows], missing?.n ?? 0);
}

export interface AtpAreaCountRow {
  geo_type: string;
  geo_code: string;
  period: string;
  branches: number | null;
  atms: number | null;
}

/** Mapped branch and ATM counts for a state's counties (or every state when no state is given), newest period. */
export async function getAtpAreaCounts(state?: string): Promise<AtpAreaCountRow[]> {
  const geoType = state ? "county" : "state";
  const rows = await sql<AtpAreaCountRow[]>`
    SELECT geo_type, geo_code, period,
           MAX(value) FILTER (WHERE series_key = 'atp_bank_branch_locations')::float8 AS branches,
           MAX(value) FILTER (WHERE series_key = 'atp_atm_locations')::float8 AS atms
      FROM area_statistics
     WHERE source = 'alltheplaces'
       AND geo_type = ${geoType}
       AND (${state ?? null}::text IS NULL OR state_code = ${state ?? null}::text)
       AND period = (SELECT MAX(period) FROM area_statistics WHERE source = 'alltheplaces')
     GROUP BY geo_type, geo_code, period
     ORDER BY geo_code
  `;
  return [...rows];
}

// ---------------------------------------------------------------------------------------------
// GLEIF corporate families

export interface FamilyMemberRow {
  lei: string;
  legal_name: string | null;
  jurisdiction: string | null;
  legal_country: string | null;
  entity_status: string | null;
  registration_status: string | null;
  direct_parent_lei: string | null;
  rssd_id: string | null;
  institution_id: number | null;
  institution_name: string | null;
  link_method: string | null;
  /** False when the relationship file names the LEI but its level-1 record is not loaded yet. */
  has_record: boolean;
}

export interface FamilyNode extends FamilyMemberRow {
  children: FamilyNode[];
}

export interface CorporateFamily {
  institution_id: number;
  /** The institution's own LEI(s) found in gleif_entities or institution_sources. */
  institution_leis: string[];
  ultimate_parent_lei: string | null;
  members: number;
  linked_members: number;
  unlinked_members: number;
  tree: FamilyNode | null;
  source_note: string;
}

/**
 * Builds the ownership tree under `root` from flat member rows using direct_parent_lei. A member
 * whose direct parent is not in the family hangs off the root, so nothing is dropped.
 */
export function buildFamilyTree(root: string, members: FamilyMemberRow[]): FamilyNode | null {
  const nodes = new Map<string, FamilyNode>(members.map((m) => [m.lei, { ...m, children: [] }]));
  const top = nodes.get(root);
  if (!top) return null;
  for (const node of nodes.values()) {
    if (node.lei === root) continue;
    const parent = node.direct_parent_lei && node.direct_parent_lei !== node.lei ? nodes.get(node.direct_parent_lei) : undefined;
    (parent ?? top).children.push(node);
  }
  const sort = (n: FamilyNode) => {
    n.children.sort((a, b) => (a.legal_name ?? a.lei).localeCompare(b.legal_name ?? b.lei));
    n.children.forEach(sort);
  };
  sort(top);
  return top;
}

/** The corporate family (by GLEIF ultimate consolidation parent) of one tracked institution. */
export async function getCorporateFamily(institutionId: number): Promise<CorporateFamily> {
  const own = await sql<Array<{ lei: string; ultimate_parent_lei: string | null }>>`
    SELECT e.lei, e.ultimate_parent_lei FROM gleif_entities e
     WHERE e.institution_id = ${institutionId}
        OR e.lei = (SELECT UPPER(TRIM(lei)) FROM institution_sources WHERE id = ${institutionId})
  `;
  const ownRows = [...own];
  const empty: CorporateFamily = { institution_id: institutionId, institution_leis: ownRows.map((r) => r.lei), ultimate_parent_lei: null, members: 0, linked_members: 0, unlinked_members: 0, tree: null, source_note: GLEIF_SOURCE_NOTE };
  if (ownRows.length === 0) return empty;
  // An institution with two LEIs in different families is shown under the first; both LEIs are returned.
  const root = ownRows.map((r) => r.ultimate_parent_lei ?? r.lei).sort()[0];
  const rows = await sql<Array<FamilyMemberRow>>`
    WITH latest AS (SELECT MAX(last_seen_publish) AS p FROM gleif_relationships),
    leis AS (
      SELECT ${root}::text AS lei
      UNION SELECT lei FROM gleif_entities WHERE ultimate_parent_lei = ${root}
      UNION SELECT child_lei FROM gleif_relationships, latest
             WHERE parent_lei = ${root} AND kind = 'ultimate' AND last_seen_publish = latest.p
    )
    SELECT l.lei, e.legal_name, e.jurisdiction, e.legal_country, e.entity_status, e.registration_status,
           COALESCE(e.direct_parent_lei, d.parent_lei) AS direct_parent_lei, e.rssd_id,
           e.institution_id, s.institution_name, e.link_method, (e.lei IS NOT NULL) AS has_record
      FROM leis l
      LEFT JOIN gleif_entities e ON e.lei = l.lei
      LEFT JOIN LATERAL (
        SELECT MIN(r.parent_lei) AS parent_lei FROM gleif_relationships r, latest
         WHERE r.child_lei = l.lei AND r.kind = 'direct' AND r.last_seen_publish = latest.p
      ) d ON TRUE
      LEFT JOIN institution_sources s ON s.id = e.institution_id
  `;
  const members = [...rows].map((r) => ({ ...r, lei: String(r.lei).trim(), direct_parent_lei: r.direct_parent_lei ? String(r.direct_parent_lei).trim() : null, institution_id: r.institution_id === null ? null : Number(r.institution_id) }));
  const linked = members.filter((m) => m.institution_id !== null).length;
  return {
    ...empty,
    ultimate_parent_lei: root,
    members: members.length,
    linked_members: linked,
    unlinked_members: members.length - linked,
    tree: buildFamilyTree(root, members),
  };
}

export interface GleifLinkSummary {
  entities: number;
  linked_by_lei: number;
  linked_by_rssd: number;
  unlinked: number;
  with_parent: number;
  relationships: number;
  latest_publish: string | null;
}

export async function getGleifLinkSummary(): Promise<GleifLinkSummary> {
  const [row] = await sql<GleifLinkSummary[]>`
    SELECT (SELECT COUNT(*) FROM gleif_entities)::int AS entities,
           (SELECT COUNT(*) FROM gleif_entities WHERE link_method = 'lei')::int AS linked_by_lei,
           (SELECT COUNT(*) FROM gleif_entities WHERE link_method = 'rssd')::int AS linked_by_rssd,
           (SELECT COUNT(*) FROM gleif_entities WHERE institution_id IS NULL)::int AS unlinked,
           (SELECT COUNT(*) FROM gleif_entities WHERE ultimate_parent_lei IS NOT NULL)::int AS with_parent,
           (SELECT COUNT(*) FROM gleif_relationships WHERE last_seen_publish = (SELECT MAX(last_seen_publish) FROM gleif_relationships))::int AS relationships,
           (SELECT MAX(last_seen_publish) FROM gleif_relationships) AS latest_publish
  `;
  return row;
}
