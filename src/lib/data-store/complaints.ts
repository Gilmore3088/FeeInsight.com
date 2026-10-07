import { getSql } from "./connection";

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
       AND ic.issue != '_total'
       AND ic.issue IN (
         'Problem caused by your funds being low',
         'Fees or interest',
         'Managing an account'
       )
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
     WHERE ic.issue != '_total'
       AND ic.issue IN (
         'Problem caused by your funds being low',
         'Fees or interest',
         'Managing an account'
       )`
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
    WHERE institution_id = ${targetId} AND issue != '_total'
    GROUP BY issue ORDER BY count DESC LIMIT 10
  `;

  const feeIssueRows = await sql`
    SELECT COALESCE(SUM(complaint_count), 0)::int AS fee_count
    FROM institution_complaint_records
    WHERE institution_id = ${targetId}
      AND issue != '_total'
      AND issue IN (
        'Problem caused by your funds being low',
        'Fees or interest',
        'Managing an account'
      )
  `;

  const total = Number((totalRow as unknown as { total: string }).total);

  const allIssueRows = [...issueRows];
  const allIssueTotal = allIssueRows.reduce(
    (sum, r) => sum + Number((r as unknown as { count: string }).count),
    0
  );

  const feeCount = Number(
    (feeIssueRows[0] as unknown as { fee_count: string }).fee_count
  );
  const feeRelatedPct = allIssueTotal > 0 ? (feeCount / allIssueTotal) * 100 : 0;

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
 * Fee-related uses the same three issues as the national summary.
 */
export async function getInstitutionComplaintYears(targetId: number): Promise<InstitutionComplaintYear[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT report_period,
           COALESCE(SUM(complaint_count) FILTER (WHERE issue = '_total'), 0)::int AS total,
           COALESCE(SUM(complaint_count) FILTER (WHERE issue IN (
             'Problem caused by your funds being low',
             'Fees or interest',
             'Managing an account'
           )), 0)::int AS fee_related
      FROM institution_complaint_records
     WHERE institution_id = ${targetId}
     GROUP BY report_period
     ORDER BY report_period DESC
  `;
  return [...rows].map((row) => ({
    year: String(row.report_period),
    total_complaints: Number(row.total),
    fee_related_complaints: Number(row.fee_related),
  }));
}
