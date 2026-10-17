import { sql } from "./connection";
import { MIN_GROUP, groupExpression, type CallItemGroup } from "./call-report-items";

/**
 * Reads over institution_network_memberships (Zelle and FedNow participants, the Fed's
 * Regulation II covered-issuer list) and reg_ii_interchange_figures. Server only.
 *
 * A share is members over the institutions we track in the group (institution_sources rows
 * from FDIC or NCUA that are not marked inactive), and always carries both counts. A group
 * below MIN_GROUP institutions gets no share. Unmatched listed rows count toward no group,
 * so a share is a floor: getNetworkListSummary says how many listed rows went unmatched.
 */

export type NetworkGroup = CallItemGroup;

/**
 * Networks with a published list we load. "reg-ii-not-exempt" is the Fed's list of covered
 * debit issuers. Allpoint, MoneyPass and CO-OP publish locators only; OpenStreetMap's ATM
 * `network` tag (getOsmNetworkTagCounts) is the partial stand-in.
 */
export const LOADED_NETWORKS = ["zelle", "fednow", "rtp", "reg-ii-not-exempt", "reg-ii-exempt"] as const;
export const COVERED_ISSUER_NETWORK = "reg-ii-not-exempt";
export type LoadedNetwork = (typeof LOADED_NETWORKS)[number];

/** Members over institutions, or null when the group is too small to show. */
export function shareOf(members: number, institutions: number, minGroup: number = MIN_GROUP): number | null {
  if (institutions < minGroup || institutions <= 0) return null;
  return members / institutions;
}

/**
 * SQL boolean for "this institution is on the Fed's newest Regulation II Not Exempt (covered
 * issuer) list", over institution_sources aliased `alias`. For a peer dimension: a fixed
 * string, no user input. False also covers an institution the list names but we could not match.
 */
export function coveredIssuerSql(alias = "s"): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`Bad table alias: ${alias}`);
  return `EXISTS (SELECT 1 FROM institution_network_memberships m WHERE m.institution_id = ${alias}.id AND m.network = '${COVERED_ISSUER_NETWORK}' AND m.as_of = (SELECT MAX(as_of) FROM institution_network_memberships WHERE network = '${COVERED_ISSUER_NETWORK}'))`;
}

export async function latestNetworkSnapshot(network: string): Promise<string | null> {
  const [row] = await sql<{ as_of: string | null }[]>`
    SELECT MAX(as_of)::text AS as_of FROM institution_network_memberships WHERE network = ${network}
  `;
  return row?.as_of ?? null;
}

export interface NetworkShareRow {
  group_value: string | null;
  institutions: number;
  members: number;
  share: number | null;
}

/** Share of tracked institutions on a network's newest list, by state, district, tier, charter or metro. */
export async function getNetworkShare(network: LoadedNetwork, groupBy: NetworkGroup, asOf?: string): Promise<{ asOf: string | null; rows: NetworkShareRow[] }> {
  const date = asOf ?? (await latestNetworkSnapshot(network));
  if (!date) return { asOf: null, rows: [] };
  const group = sql.unsafe(groupExpression(groupBy));
  const rows = await sql<Array<{ group_value: string | null; institutions: number; members: number }>>`
    WITH members AS (
      SELECT DISTINCT institution_id
        FROM institution_network_memberships
       WHERE network = ${network} AND as_of = ${date}::date AND institution_id IS NOT NULL
    )
    SELECT ${group} AS group_value,
           COUNT(*)::int AS institutions,
           COUNT(m.institution_id)::int AS members
      FROM institution_sources s
      LEFT JOIN members m ON m.institution_id = s.id
     WHERE s.source IN ('fdic', 'ncua')
       AND COALESCE(s.regulatory_status, 'active') <> 'inactive'
     GROUP BY 1
     ORDER BY 1 NULLS LAST
  `;
  return {
    asOf: date,
    rows: [...rows].map((r) => ({ ...r, share: shareOf(r.members, r.institutions) })),
  };
}

export interface NetworkListSummaryRow {
  network: string;
  as_of: string;
  listed_rows: number;
  matched_rows: number;
  unmatched_rows: number;
  matched_institutions: number;
}

/** Per network, the newest snapshot's size and how much of it matched an institution we track. */
export async function getNetworkListSummary(): Promise<NetworkListSummaryRow[]> {
  const rows = await sql<NetworkListSummaryRow[]>`
    SELECT m.network, m.as_of::text AS as_of,
           COUNT(*)::int AS listed_rows,
           COUNT(m.institution_id)::int AS matched_rows,
           (COUNT(*) - COUNT(m.institution_id))::int AS unmatched_rows,
           COUNT(DISTINCT m.institution_id)::int AS matched_institutions
      FROM institution_network_memberships m
      JOIN (SELECT network, MAX(as_of) AS as_of FROM institution_network_memberships GROUP BY network) l
        ON l.network = m.network AND l.as_of = m.as_of
     GROUP BY m.network, m.as_of
     ORDER BY m.network
  `;
  return [...rows];
}

/** Listed rows on a network's newest list that matched no institution, for review. */
export async function getUnmatchedListings(network: LoadedNetwork, limit = 200) {
  return sql<Array<{ listed_name: string; listed_city: string | null; listed_state: string | null; listed_rssd: string | null; listed_cert: string | null }>>`
    SELECT listed_name, listed_city, listed_state, listed_rssd, listed_cert
      FROM institution_network_memberships
     WHERE network = ${network}
       AND institution_id IS NULL
       AND as_of = (SELECT MAX(as_of) FROM institution_network_memberships WHERE network = ${network})
     ORDER BY listed_name
     LIMIT ${limit}
  `;
}

/** The networks one institution is listed on, newest snapshot of each. */
export async function getInstitutionNetworks(institutionId: number) {
  return sql<Array<{ network: string; as_of: string; listed_name: string; match_method: string | null }>>`
    SELECT DISTINCT ON (m.network) m.network, m.as_of::text AS as_of, m.listed_name, m.match_method
      FROM institution_network_memberships m
      JOIN (SELECT network, MAX(as_of) AS as_of FROM institution_network_memberships GROUP BY network) l
        ON l.network = m.network AND l.as_of = m.as_of
     WHERE m.institution_id = ${institutionId}
     ORDER BY m.network, m.listed_name
  `;
}

export interface InterchangeFigureRow {
  table_title: string | null;
  row_label: string;
  column_label: string;
  value_text: string;
  value: number | null;
  unit: string | null;
  survey_year: number | null;
  page_url: string;
}

/** The Fed's Regulation II interchange table cells as published, optionally for one survey year. */
export async function getInterchangeFigures(surveyYear?: number): Promise<InterchangeFigureRow[]> {
  const rows = await sql<InterchangeFigureRow[]>`
    SELECT table_title, row_label, column_label, value_text, value::float8 AS value, unit, survey_year, page_url
      FROM reg_ii_interchange_figures
     WHERE (${surveyYear ?? null}::int IS NULL OR survey_year = ${surveyYear ?? null}::int)
     ORDER BY page_url, table_index, row_label, column_label
  `;
  return [...rows];
}

// ---------------------------------------------------------------------------------------------
// OpenStreetMap ATMs and bank branches (ODbL: show OSM_ATTRIBUTION wherever these are shown)

export const OSM_ATTRIBUTION_TEXT = "© OpenStreetMap contributors, ODbL 1.0";

/** Rows from each state's newest OpenStreetMap pull only, so a location OSM removed drops out. */
const OSM_CURRENT = `o.as_of = (SELECT MAX(as_of) FROM osm_financial_locations x WHERE x.partition_state = o.partition_state)`;

export interface OsmStateCountRow {
  state: string;
  as_of: string;
  atms: number;
  banks: number;
  linked_locations: number;
  linked_institutions: number;
}

/** Mapped ATMs and bank branches per state, and how many link to an institution we track. */
export async function getOsmStateCounts(): Promise<OsmStateCountRow[]> {
  const rows = await sql<OsmStateCountRow[]>`
    SELECT o.partition_state AS state, MAX(o.as_of)::text AS as_of,
           COUNT(*) FILTER (WHERE o.kind = 'atm')::int AS atms,
           COUNT(*) FILTER (WHERE o.kind = 'bank')::int AS banks,
           COUNT(o.institution_id)::int AS linked_locations,
           COUNT(DISTINCT o.institution_id)::int AS linked_institutions
      FROM osm_financial_locations o
     WHERE ${sql.unsafe(OSM_CURRENT)}
     GROUP BY o.partition_state
     ORDER BY o.partition_state
  `;
  return [...rows];
}

export interface OsmNetworkTagRow {
  group_value: string | null;
  network_tag: string;
  atms: number;
}

/**
 * ATMs per OSM `network` tag as mappers wrote it (Allpoint, MoneyPass, CO-OP ...), by state or
 * nationally. Mapping coverage is partial and uneven, so this is a count of mapped ATMs, never
 * a network's footprint or an institution's membership.
 */
export async function getOsmNetworkTagCounts(groupBy: "national" | "state"): Promise<OsmNetworkTagRow[]> {
  const group = sql.unsafe(groupBy === "state" ? "o.partition_state" : "'US'");
  const rows = await sql<OsmNetworkTagRow[]>`
    SELECT ${group} AS group_value, o.network_tag, COUNT(*)::int AS atms
      FROM osm_financial_locations o
     WHERE o.kind = 'atm' AND o.network_tag IS NOT NULL AND ${sql.unsafe(OSM_CURRENT)}
     GROUP BY 1, 2
     ORDER BY 1, 3 DESC
  `;
  return [...rows];
}

export interface OsmInstitutionLocationRow {
  group_value: string | null;
  institutions: number;
  /** Median mapped locations per linked institution; null below MIN_GROUP. */
  median_locations: number | null;
}

/** Median mapped ATMs + branches per linked institution, by the institution's own grouping. */
export async function getOsmLocationsPerInstitution(groupBy: NetworkGroup): Promise<OsmInstitutionLocationRow[]> {
  const group = sql.unsafe(groupExpression(groupBy));
  const rows = await sql<OsmInstitutionLocationRow[]>`
    WITH per_inst AS (
      SELECT o.institution_id, COUNT(*)::int AS locations
        FROM osm_financial_locations o
       WHERE o.institution_id IS NOT NULL AND ${sql.unsafe(OSM_CURRENT)}
       GROUP BY o.institution_id
    )
    SELECT ${group} AS group_value,
           COUNT(*)::int AS institutions,
           CASE WHEN COUNT(*) >= ${MIN_GROUP} THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY p.locations)::float8 END AS median_locations
      FROM per_inst p
      JOIN institution_sources s ON s.id = p.institution_id
     GROUP BY 1
     ORDER BY 1 NULLS LAST
  `;
  return [...rows];
}
