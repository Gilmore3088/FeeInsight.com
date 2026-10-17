import { sql } from "@/lib/data-store/connection";

/**
 * Reads over merger and acquisition decisions (institution_structure_events, sources
 * 'fed-orders' and 'occ-merger-decisions', loaded by the Magellan step bank-merger-orders).
 * Server only. Answers "which deals were approved near me?": a decision is near an area when
 * the applicant or the target has Summary of Deposits branches there in the newest SOD year,
 * where a party is the matched bank, or every bank under its matched holding company.
 *
 * Competitive figures are the order's own words (raw_json.competitive: sentence, market,
 * hhi_change, hhi_post, deposit_shares) and are passed through untouched; nothing is computed.
 * Deposits are FDIC SOD thousands of dollars. Credit unions are not in the SOD.
 */

export const DECISION_SOURCES = ["fed-orders", "occ-merger-decisions"] as const;

export interface CompetitiveFigure {
  sentence: string;
  market: string | null;
  hhi_change: number | null;
  hhi_post: number | null;
  deposit_shares: number[];
}

export interface NearbyDecision {
  event_id: number;
  source: string;
  decision_date: string | null;
  kind: string | null;
  title: string | null;
  applicant: string | null;
  target: string | null;
  document_url: string | null;
  applicant_local_deposits: number | null;
  applicant_local_branches: number;
  target_local_deposits: number | null;
  target_local_branches: number;
  competitive: CompetitiveFigure[];
  sod_year: number | null;
}

export interface AreaFilter {
  /** Two-letter postal code. */
  stateCode?: string | null;
  /** Five-digit county FIPS codes (as numbers or strings). */
  countyFips?: Array<number | string> | null;
  /** FDIC SOD MSA code as stored (institution_branch_deposits.msa_code). */
  msaCode?: number | null;
}

/** Pure: an area filter as query parameters; null when it names no area. */
export function areaParams(area: AreaFilter): { state: string | null; counties: number[] | null; msa: number | null } | null {
  const state = area.stateCode && /^[A-Za-z]{2}$/.test(area.stateCode.trim()) ? area.stateCode.trim().toUpperCase() : null;
  const counties = (area.countyFips ?? []).map((c) => Number(String(c).trim())).filter((c) => Number.isInteger(c) && c > 0 && c < 100_000);
  const msa = area.msaCode && Number.isInteger(area.msaCode) && area.msaCode > 0 ? area.msaCode : null;
  if (!state && counties.length === 0 && !msa) return null;
  return { state, counties: counties.length > 0 ? counties : null, msa };
}

/** Pure: the competitive figures stored with a decision, dropping anything not shaped as written. */
export function competitiveOf(value: unknown): CompetitiveFigure[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null && typeof (f as Record<string, unknown>).sentence === "string")
    .map((f) => ({
      sentence: String(f.sentence),
      market: typeof f.market === "string" ? f.market : null,
      hhi_change: typeof f.hhi_change === "number" ? f.hhi_change : null,
      hhi_post: typeof f.hhi_post === "number" ? f.hhi_post : null,
      deposit_shares: Array.isArray(f.deposit_shares) ? f.deposit_shares.filter((s): s is number => typeof s === "number") : [],
    }));
}

/** Decisions since `since` (YYYY-MM-DD) whose applicant or target has branches in the area, newest first. */
export async function getMergerDecisionsNear(area: AreaFilter, since: string, limit = 50): Promise<NearbyDecision[]> {
  const p = areaParams(area);
  if (!p) return [];
  const rows = await sql<Array<Record<string, unknown>>>`
    WITH d AS (
      SELECT e.id, e.source, e.effective_date, e.change_code, e.change_description, e.acquirer_name, e.outgoing_name,
             e.source_url, e.institution_id, e.raw_json,
             NULLIF(e.raw_json->>'target_institution_id', '')::bigint AS target_id,
             e.raw_json->>'applicant_holding_company_rssd' AS applicant_hc,
             e.raw_json->>'target_holding_company_rssd' AS target_hc
        FROM institution_structure_events e
       WHERE e.source = ANY(${DECISION_SOURCES as unknown as string[]}) AND e.effective_date >= ${since}::date
    ), parties AS (
      SELECT DISTINCT d.id, 'applicant'::text AS side, s.id AS institution_id
        FROM d JOIN institution_sources s
          ON s.id = d.institution_id OR (d.applicant_hc IS NOT NULL AND s.holding_company_rssd = d.applicant_hc)
      UNION
      SELECT DISTINCT d.id, 'target'::text, s.id
        FROM d JOIN institution_sources s
          ON s.id = d.target_id OR (d.target_hc IS NOT NULL AND s.holding_company_rssd = d.target_hc)
    ), sod_year AS (
      SELECT MAX(year) AS y FROM institution_branch_deposits
    ), local AS (
      SELECT b.institution_id, SUM(b.deposits)::float8 AS deposits, COUNT(*)::int AS branches
        FROM institution_branch_deposits b, sod_year
       WHERE b.year = sod_year.y AND b.institution_id IS NOT NULL
         AND (${p.state}::text IS NULL OR b.state = ${p.state})
         AND (${p.counties}::int[] IS NULL OR b.county_fips = ANY(${p.counties}::int[]))
         AND (${p.msa}::int IS NULL OR b.msa_code = ${p.msa})
       GROUP BY b.institution_id
    )
    SELECT d.id AS event_id, d.source, d.effective_date::text AS decision_date, d.change_code AS kind,
           d.change_description AS title, d.acquirer_name AS applicant, d.outgoing_name AS target,
           d.source_url AS document_url, d.raw_json->'competitive' AS competitive,
           SUM(l.deposits) FILTER (WHERE p.side = 'applicant') AS applicant_local_deposits,
           COALESCE(SUM(l.branches) FILTER (WHERE p.side = 'applicant'), 0)::int AS applicant_local_branches,
           SUM(l.deposits) FILTER (WHERE p.side = 'target') AS target_local_deposits,
           COALESCE(SUM(l.branches) FILTER (WHERE p.side = 'target'), 0)::int AS target_local_branches,
           (SELECT y FROM sod_year) AS sod_year
      FROM d
      JOIN parties p ON p.id = d.id
      JOIN local l ON l.institution_id = p.institution_id
     GROUP BY d.id, d.source, d.effective_date, d.change_code, d.change_description, d.acquirer_name, d.outgoing_name,
              d.source_url, d.raw_json
     ORDER BY d.effective_date DESC NULLS LAST
     LIMIT ${limit}
  `;
  return [...rows].map((r) => ({
    event_id: Number(r.event_id),
    source: String(r.source),
    decision_date: (r.decision_date as string | null) ?? null,
    kind: (r.kind as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    applicant: (r.applicant as string | null) ?? null,
    target: (r.target as string | null) ?? null,
    document_url: (r.document_url as string | null) ?? null,
    applicant_local_deposits: r.applicant_local_deposits === null ? null : Number(r.applicant_local_deposits),
    applicant_local_branches: Number(r.applicant_local_branches),
    target_local_deposits: r.target_local_deposits === null ? null : Number(r.target_local_deposits),
    target_local_branches: Number(r.target_local_branches),
    competitive: competitiveOf(r.competitive),
    sod_year: r.sod_year === null ? null : Number(r.sod_year),
  }));
}

/** Decisions per year, agency and kind, with how many carry stated competitive figures. */
export async function getMergerDecisionCounts(sinceYear: number) {
  return sql<Array<{ year: number; source: string; kind: string | null; decisions: number; with_figures: number; matched_applicant: number }>>`
    SELECT EXTRACT(YEAR FROM effective_date)::int AS year, source, change_code AS kind, COUNT(*)::int AS decisions,
           COUNT(*) FILTER (WHERE jsonb_array_length(COALESCE(raw_json->'competitive', '[]'::jsonb)) > 0)::int AS with_figures,
           COUNT(*) FILTER (WHERE institution_id IS NOT NULL OR raw_json->>'applicant_holding_company_rssd' IS NOT NULL)::int AS matched_applicant
      FROM institution_structure_events
     WHERE source = ANY(${DECISION_SOURCES as unknown as string[]}) AND effective_date >= make_date(${sinceYear}, 1, 1)
     GROUP BY 1, 2, 3
     ORDER BY 1 DESC, 2, 3
  `;
}

/** Decisions where an institution (or its holding company) was the applicant or the target. */
export async function getMergerDecisionsForInstitution(institutionId: number) {
  return sql<Array<{ event_id: number; source: string; decision_date: string | null; kind: string | null; side: string; applicant: string | null; target: string | null; document_url: string | null }>>`
    WITH me AS (SELECT id, holding_company_rssd FROM institution_sources WHERE id = ${institutionId})
    SELECT e.id AS event_id, e.source, e.effective_date::text AS decision_date, e.change_code AS kind,
           CASE WHEN e.institution_id = me.id OR e.raw_json->>'applicant_holding_company_rssd' = me.holding_company_rssd
                THEN 'applicant' ELSE 'target' END AS side,
           e.acquirer_name AS applicant, e.outgoing_name AS target, e.source_url AS document_url
      FROM institution_structure_events e, me
     WHERE e.source = ANY(${DECISION_SOURCES as unknown as string[]})
       AND (e.institution_id = me.id
            OR NULLIF(e.raw_json->>'target_institution_id', '')::bigint = me.id
            OR (me.holding_company_rssd IS NOT NULL
                AND me.holding_company_rssd IN (e.raw_json->>'applicant_holding_company_rssd', e.raw_json->>'target_holding_company_rssd')))
     ORDER BY e.effective_date DESC NULLS LAST
  `;
}
