import { getSql } from "./connection";
import { FEE_ISSUES, FEE_PRODUCTS_KEY, FEE_SUB_ISSUES, FEE_SUB_ISSUES_KEY } from "@/lib/complaints/fee-issues";

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** Rows that count as fee complaints (src/lib/complaints/fee-issues.ts), for a table alias. */
export function feeComplaintFilterSql(alias = "ic"): string {
  return `((${alias}.product = ${quote(FEE_PRODUCTS_KEY)} AND ${alias}.issue IN (${FEE_ISSUES.map(quote).join(", ")}))
        OR (${alias}.product = ${quote(FEE_SUB_ISSUES_KEY)} AND ${alias}.issue IN (${FEE_SUB_ISSUES.map(quote).join(", ")})))`;
}

export interface DistrictComplaintSummary {
  fed_district: number;
  total_complaints: number;
  fee_related_complaints: number;
  institution_count: number;
  top_products: { product: string; count: number }[];
}

export interface InstitutionComplaintProfile {
  institution_id: number;
  total_complaints: number;
  by_product: { product: string; count: number }[];
  by_issue: { issue: string; count: number }[];
  fee_related_pct: number;
}

export async function getDistrictComplaintSummary(
  district: number,
  reportPeriod?: string
): Promise<DistrictComplaintSummary> {
  const sql = getSql();

  // Total complaints for institutions in this district
  const totalRows = await sql.unsafe(
    `SELECT
       COUNT(DISTINCT ic.institution_id)::int AS institution_count,
       COALESCE(SUM(ic.complaint_count), 0)::int AS total_complaints
     FROM institution_complaint_records ic
     JOIN institution_sources ct ON ct.id = ic.institution_id
     WHERE ct.fed_district = $1
       AND ic.issue = '_total'
       ${reportPeriod ? "AND ic.report_period = $2" : ""}`,
    reportPeriod ? [district, reportPeriod] : [district]
  ) as { institution_count: string; total_complaints: string }[];

  // Fee-related complaints (issues matching FEE_ISSUES categories)
  const feeRows = await sql.unsafe(
    `SELECT COALESCE(SUM(ic.complaint_count), 0)::int AS fee_complaints
     FROM institution_complaint_records ic
     JOIN institution_sources ct ON ct.id = ic.institution_id
     WHERE ct.fed_district = $1
       AND ${feeComplaintFilterSql("ic")}
       ${reportPeriod ? "AND ic.report_period = $2" : ""}`,
    reportPeriod ? [district, reportPeriod] : [district]
  ) as { fee_complaints: string }[];

  // Top products
  const productRows = await sql.unsafe(
    `SELECT ic.product, SUM(ic.complaint_count)::int AS count
     FROM institution_complaint_records ic
     JOIN institution_sources ct ON ct.id = ic.institution_id
     WHERE ct.fed_district = $1 AND ic.issue = '_total'
       ${reportPeriod ? "AND ic.report_period = $2" : ""}
     GROUP BY ic.product
     ORDER BY count DESC
     LIMIT 5`,
    reportPeriod ? [district, reportPeriod] : [district]
  ) as { product: string; count: string }[];

  const total = totalRows[0] ? Number(totalRows[0].total_complaints) : 0;
  const instCount = totalRows[0] ? Number(totalRows[0].institution_count) : 0;
  const feeRelated = feeRows[0] ? Number(feeRows[0].fee_complaints) : 0;

  return {
    fed_district: district,
    total_complaints: total,
    fee_related_complaints: feeRelated,
    institution_count: instCount,
    top_products: productRows.map((r) => ({
      product: r.product,
      count: Number(r.count),
    })),
  };
}

export async function getNationalComplaintSummary(): Promise<{
  total_complaints: number;
  fee_related_pct: number;
  average_per_institution: number;
}> {
  const sql = getSql();

  const totalRows = await sql.unsafe(
    `SELECT
       COUNT(DISTINCT ic.institution_id)::int AS institution_count,
       COALESCE(SUM(ic.complaint_count), 0)::int AS total_complaints
     FROM institution_complaint_records ic
     WHERE ic.issue = '_total'`
  ) as { institution_count: string; total_complaints: string }[];

  const feeRows = await sql.unsafe(
    `SELECT COALESCE(SUM(ic.complaint_count), 0)::int AS fee_complaints
     FROM institution_complaint_records ic
     WHERE ${feeComplaintFilterSql("ic")}`
  ) as { fee_complaints: string }[];

  const total = totalRows[0] ? Number(totalRows[0].total_complaints) : 0;
  const instCount = totalRows[0] ? Number(totalRows[0].institution_count) : 1;
  const feeRelated = feeRows[0] ? Number(feeRows[0].fee_complaints) : 0;

  return {
    total_complaints: total,
    fee_related_pct: total > 0 ? (feeRelated / total) * 100 : 0,
    average_per_institution: instCount > 0 ? total / instCount : 0,
  };
}

export async function getInstitutionComplaintProfile(
  targetId: number
): Promise<InstitutionComplaintProfile> {
  const sql = getSql();

  const [totalRow] = await sql`
    SELECT COALESCE(SUM(complaint_count), 0)::int AS total
    FROM institution_complaint_records
    WHERE institution_id = ${targetId} AND issue = '_total'
  `;

  const productRows = await sql`
    SELECT product, SUM(complaint_count)::int AS count
    FROM institution_complaint_records
    WHERE institution_id = ${targetId} AND issue = '_total'
    GROUP BY product ORDER BY count DESC
  `;

  const issueRows = await sql`
    SELECT issue, SUM(complaint_count)::int AS count
    FROM institution_complaint_records
    WHERE institution_id = ${targetId} AND product = '_all'
    GROUP BY issue ORDER BY count DESC LIMIT 10
  `;

  const feeIssueRows = await sql.unsafe(
    `SELECT COALESCE(SUM(ic.complaint_count), 0)::int AS fee_count
       FROM institution_complaint_records ic
      WHERE ic.institution_id = $1
        AND ${feeComplaintFilterSql("ic")}`,
    [targetId],
  );

  const total = Number((totalRow as unknown as { total: string }).total);

  const allIssueRows = [...issueRows];
  const allIssueTotal = allIssueRows.reduce(
    (sum, r) => sum + Number((r as unknown as { count: string }).count),
    0
  );

  const feeCount = Number(
    (feeIssueRows[0] as unknown as { fee_count: string }).fee_count
  );
  // Share of all complaints; the top-10 issue list no longer bounds the denominator.
  const feeRelatedPct = total > 0 ? (feeCount / total) * 100 : allIssueTotal > 0 ? (feeCount / allIssueTotal) * 100 : 0;

  return {
    institution_id: targetId,
    total_complaints: total,
    by_product: [...productRows].map((r) => ({
      product: String((r as unknown as { product: string }).product),
      count: Number((r as unknown as { count: string }).count),
    })),
    by_issue: allIssueRows.map((r) => ({
      issue: String((r as unknown as { issue: string }).issue),
      count: Number((r as unknown as { count: string }).count),
    })),
    fee_related_pct: Math.round(feeRelatedPct * 10) / 10,
  };
}

export interface InstitutionComplaintYear {
  year: string;
  total_complaints: number;
  fee_related_complaints: number;
}

/**
 * CFPB complaints matched to one institution, per calendar year, newest first.
 * Fee-related uses the shared definition in src/lib/complaints/fee-issues.ts.
 */
export async function getInstitutionComplaintYears(targetId: number): Promise<InstitutionComplaintYear[]> {
  const sql = getSql();
  const rows = await sql.unsafe(
    `SELECT ic.report_period,
            COALESCE(SUM(ic.complaint_count) FILTER (WHERE ic.issue = '_total'), 0)::int AS total,
            COALESCE(SUM(ic.complaint_count) FILTER (WHERE ${feeComplaintFilterSql("ic")}), 0)::int AS fee_related
       FROM institution_complaint_records ic
      WHERE ic.institution_id = $1
      GROUP BY ic.report_period
      ORDER BY ic.report_period DESC`,
    [targetId],
  );
  return [...rows].map((row) => ({
    year: String(row.report_period),
    total_complaints: Number(row.total),
    fee_related_complaints: Number(row.fee_related),
  }));
}

export type ComplaintPeerLevel = "state" | "fed_district" | "national";

export interface ComplaintBenchmark {
  institution_id: number;
  institution_name: string;
  year: string;
  /** "matched": CFPB complaints are linked to this institution; "none": no CFPB company matched it,
   * so its count is zero; "unconfirmed": a CFPB company may be this institution but awaits review. */
  match_status: "matched" | "none" | "unconfirmed";
  /** null when the match awaits review: the count is unknown, not zero. */
  total_complaints: number | null;
  fee_complaints: number | null;
  deposits_thousands: number | null;
  fee_complaints_per_billion: number | null;
  peer_level: ComplaintPeerLevel;
  peer_label: string;
  peer_count: number;
  peers_with_fee_complaints: number;
  peer_median_per_billion: number | null;
  peer_median_fee_complaints: number;
  peer_fee_complaints_total: number;
  /** False until CFPB sub-issues load; "Managing an account" fee problems are then not counted. */
  sub_issues_loaded: boolean;
  summary: string;
}

interface CohortRow {
  institution_id: number;
  institution_name: string;
  state_code: string | null;
  fed_district: number | null;
  charter_type: string | null;
  asset_size_tier: string | null;
  deposits: number | null;
  total_complaints: number;
  fee_complaints: number;
  accepted: boolean;
  in_review: boolean;
}

const MIN_PEERS = 10;
const MIN_PEERS_WITH_COMPLAINTS = 3;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * One institution's CFPB fee complaints for a calendar year next to its peers': same charter and
 * asset tier in the same state, widening to the Fed district and then the nation until there are
 * at least 10 peers and 3 of them have fee complaints. Rates are per $1B of deposits. Peers whose
 * CFPB match awaits review are left out (their count is unknown, not zero).
 */
export async function getComplaintBenchmark(institutionId: number, year?: number): Promise<ComplaintBenchmark | null> {
  const sql = getSql();
  const period = String(year ?? new Date().getUTCFullYear() - 1);
  const yearEnd = `${period}-12-31`;
  const rows = (await sql.unsafe(
    `WITH target AS (
       SELECT id, charter_type, asset_size_tier FROM institution_sources WHERE id = $1
     ),
     cohort AS (
       SELECT s.id, s.institution_name, s.state_code, s.fed_district, s.charter_type, s.asset_size_tier
         FROM institution_sources s, target t
        WHERE s.id = t.id
           OR (s.charter_type IS NOT DISTINCT FROM t.charter_type
               AND s.asset_size_tier IS NOT DISTINCT FROM t.asset_size_tier
               AND s.regulatory_status IS DISTINCT FROM 'inactive')
     ),
     dep AS (
       SELECT DISTINCT ON (f.institution_id) f.institution_id, f.total_deposits
         FROM institution_financial_records f
         JOIN cohort c ON c.id = f.institution_id
        -- FDIC and NCUA rows are in thousands; FFIEC call report rows are in dollars, so they are skipped.
        WHERE f.source IN ('fdic', 'ncua')
          AND f.report_date <= $3 AND f.report_date > ($4::int - 2)::text AND f.total_deposits > 0
        ORDER BY f.institution_id, f.report_date DESC
     ),
     comp AS (
       SELECT ic.institution_id,
              COALESCE(SUM(ic.complaint_count) FILTER (WHERE ic.issue = '_total'), 0)::int AS total,
              COALESCE(SUM(ic.complaint_count) FILTER (WHERE ${feeComplaintFilterSql("ic")}), 0)::int AS fee
         FROM institution_complaint_records ic
         JOIN cohort c ON c.id = ic.institution_id
        WHERE ic.report_period = $2
        GROUP BY ic.institution_id
     ),
     links AS (
       SELECT l.institution_id,
              bool_or(l.status = 'accepted') AS accepted,
              bool_or(l.status = 'needs_review') AS in_review
         FROM institution_identity_links l
         JOIN cohort c ON c.id = l.institution_id
        WHERE l.link_type = 'cfpb_company'
        GROUP BY l.institution_id
     )
     SELECT c.id AS institution_id, c.institution_name, c.state_code, c.fed_district, c.charter_type, c.asset_size_tier,
            dep.total_deposits AS deposits,
            COALESCE(comp.total, 0) AS total_complaints,
            COALESCE(comp.fee, 0) AS fee_complaints,
            COALESCE(links.accepted, false) AS accepted,
            COALESCE(links.in_review, false) AS in_review
       FROM cohort c
       LEFT JOIN dep ON dep.institution_id = c.id
       LEFT JOIN comp ON comp.institution_id = c.id
       LEFT JOIN links ON links.institution_id = c.id`,
    [institutionId, period, yearEnd, Number(period)],
  )) as unknown as Array<Record<string, unknown>>;

  const cohort: CohortRow[] = rows.map((r) => ({
    institution_id: Number(r.institution_id),
    institution_name: String(r.institution_name ?? ""),
    state_code: r.state_code == null ? null : String(r.state_code).trim(),
    fed_district: r.fed_district == null ? null : Number(r.fed_district),
    charter_type: r.charter_type == null ? null : String(r.charter_type),
    asset_size_tier: r.asset_size_tier == null ? null : String(r.asset_size_tier),
    deposits: r.deposits == null ? null : Number(r.deposits),
    total_complaints: Number(r.total_complaints ?? 0),
    fee_complaints: Number(r.fee_complaints ?? 0),
    accepted: Boolean(r.accepted),
    in_review: Boolean(r.in_review),
  }));
  const target = cohort.find((r) => r.institution_id === institutionId);
  if (!target) return null;

  const [loaded] = (await sql.unsafe(
    `SELECT EXISTS (SELECT 1 FROM institution_complaint_records WHERE report_period = $1 AND product = '${FEE_SUB_ISSUES_KEY}') AS loaded`,
    [period],
  )) as unknown as Array<{ loaded: boolean }>;

  const rate = (row: CohortRow) => (row.deposits && row.deposits > 0 ? row.fee_complaints / (row.deposits / 1_000_000) : null);
  // A peer whose only CFPB match awaits review has an unknown count, so it is left out.
  const known = cohort.filter((r) => r.institution_id !== institutionId && r.deposits && !(r.in_review && !r.accepted));
  const levels: Array<{ level: ComplaintPeerLevel; label: string; peers: CohortRow[] }> = [
    { level: "state", label: target.state_code ?? "", peers: target.state_code ? known.filter((r) => r.state_code === target.state_code) : [] },
    {
      level: "fed_district",
      label: target.fed_district ? `Fed District ${target.fed_district}` : "",
      peers: target.fed_district ? known.filter((r) => r.fed_district === target.fed_district) : [],
    },
    { level: "national", label: "nationwide", peers: known },
  ];
  const chosen =
    levels.find((l) => l.peers.length >= MIN_PEERS && l.peers.filter((p) => p.fee_complaints > 0).length >= MIN_PEERS_WITH_COMPLAINTS) ??
    levels[levels.length - 1];

  const peerRates = chosen.peers.map(rate).filter((v): v is number => v !== null);
  const peerMedianRate = median(peerRates);
  const targetRate = rate(target);
  const matchStatus: ComplaintBenchmark["match_status"] = target.accepted ? "matched" : target.in_review ? "unconfirmed" : "none";
  const tierLabel = `${(target.asset_size_tier ?? "").replace(/_/g, " ")} ${target.charter_type === "credit_union" ? "credit unions" : "banks"}`.trim();
  const where = chosen.level === "national" ? "nationwide" : `in ${chosen.label}`;

  let summary: string;
  if (matchStatus === "unconfirmed") {
    summary = `A CFPB company may be ${target.institution_name}, but the match is still under review, so no ${period} count is shown.`;
  } else if (target.fee_complaints === 0) {
    summary = `${target.institution_name} had 0 CFPB fee complaints in ${period}. ${chosen.peers.filter((p) => p.fee_complaints > 0).length} of ${chosen.peers.length} ${tierLabel} ${where} had any.`;
  } else {
    const comparison =
      targetRate !== null && peerMedianRate !== null
        ? ` That is ${round1(targetRate)} per $1B of deposits; the peer median is ${round1(peerMedianRate)}.`
        : "";
    summary = `${target.institution_name} had ${target.fee_complaints} CFPB fee complaints in ${period} against ${chosen.peers.length} ${tierLabel} ${where}.${comparison}`;
  }

  return {
    institution_id: institutionId,
    institution_name: target.institution_name,
    year: period,
    match_status: matchStatus,
    total_complaints: matchStatus === "unconfirmed" ? null : target.total_complaints,
    fee_complaints: matchStatus === "unconfirmed" ? null : target.fee_complaints,
    deposits_thousands: target.deposits,
    fee_complaints_per_billion: matchStatus === "unconfirmed" || targetRate === null ? null : round1(targetRate),
    peer_level: chosen.level,
    peer_label: chosen.level === "national" ? "nationwide" : chosen.label,
    peer_count: chosen.peers.length,
    peers_with_fee_complaints: chosen.peers.filter((p) => p.fee_complaints > 0).length,
    peer_median_per_billion: peerMedianRate === null ? null : round1(peerMedianRate),
    peer_median_fee_complaints: median(chosen.peers.map((p) => p.fee_complaints)) ?? 0,
    peer_fee_complaints_total: chosen.peers.reduce((sum, p) => sum + p.fee_complaints, 0),
    sub_issues_loaded: Boolean(loaded?.loaded),
    summary,
  };
}
