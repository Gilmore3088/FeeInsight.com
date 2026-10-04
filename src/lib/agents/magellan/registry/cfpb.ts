import { sql } from "@/lib/data-store/connection";
import {
  CFPB_FIRST_YEAR,
  fetchCfpbCompanyBreakdown,
  fetchCfpbCompanyCounts,
} from "@/lib/regulatory/cfpb";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { loadAcceptedLinks, loadIdentityIndex, matchCompany, upsertIdentityLinks, type IdentityLinkInput } from "./identity";
import { chunk, mapWithConcurrency, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: one calendar year of CFPB consumer complaints.
 *
 * 1. List every company with complaints that year and match names to
 *    institutions (institution_identity_links; ambiguous names wait for review).
 * 2. For each accepted company, pull the product and issue breakdown.
 * 3. Write institution_complaint_records per institution: product totals with
 *    issue '_total' (the existing convention) and top issues under product
 *    '_all'. Several companies mapped to one institution are summed.
 */

export const CFPB_SOURCE = "cfpb";
const BREAKDOWN_CONCURRENCY = 4;
const TOP_ISSUES = 15;
const CURRENT_YEAR_REFRESH_HOURS = 24 * 7;
const RECENT_YEAR_REFRESH_HOURS = 24 * 30;
const HISTORICAL_REFRESH_HOURS = 24 * 180;

export interface RegistryCfpbOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
}

export interface RegistryCfpbResult {
  source: string;
  partitionKey: string;
  sourceUrl: string;
  companies: number;
  acceptedCompanies: number;
  reviewCompanies: number;
  institutions: number;
  complaints: number;
  rowsWritten: number;
  dryRun: boolean;
}

export async function runRegistryCfpb(options: RegistryCfpbOptions): Promise<RegistryCfpbResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const year = Number(options.partitionKey);
  const now = options.now ?? new Date();
  if (!Number.isInteger(year) || year < CFPB_FIRST_YEAR || year > now.getUTCFullYear()) {
    throw new Error(`Invalid CFPB year partition: ${options.partitionKey}`);
  }

  const { companies, url } = await fetchCfpbCompanyCounts(year, options.fetchOptions);
  const index = await loadIdentityIndex(db);
  const decisions: IdentityLinkInput[] = [];
  for (const company of companies) {
    const match = matchCompany(company.key, index);
    if (match) decisions.push({ externalKey: company.key, externalName: company.key, match, detail: { [`complaints_${year}`]: company.doc_count } });
  }
  const result: RegistryCfpbResult = {
    source: CFPB_SOURCE,
    partitionKey: options.partitionKey,
    sourceUrl: url,
    companies: companies.length,
    acceptedCompanies: decisions.filter((d) => d.match.status === "accepted").length,
    reviewCompanies: decisions.filter((d) => d.match.status === "needs_review").length,
    institutions: 0,
    complaints: 0,
    rowsWritten: 0,
    dryRun,
  };
  if (dryRun) return result;

  await upsertIdentityLinks(db, "cfpb_company", decisions, options.runId ?? null);
  // Use the stored links, which include any a person accepted or rejected by hand.
  const accepted = await loadAcceptedLinks(db, "cfpb_company");
  const companyCounts = new Map(companies.map((c) => [c.key, c.doc_count]));
  const linked = [...accepted.entries()].filter(([company]) => companyCounts.has(company));

  const breakdowns = await mapWithConcurrency(linked, BREAKDOWN_CONCURRENCY, async ([company, institutionId]) => ({
    institutionId,
    breakdown: await fetchCfpbCompanyBreakdown(company, year, options.fetchOptions),
  }));

  const byInstitution = new Map<number, { products: Map<string, number>; issues: Map<string, number> }>();
  for (const { institutionId, breakdown } of breakdowns) {
    const entry = byInstitution.get(institutionId) ?? { products: new Map(), issues: new Map() };
    for (const product of breakdown.products) entry.products.set(product.key, (entry.products.get(product.key) ?? 0) + product.doc_count);
    for (const issue of breakdown.issues) entry.issues.set(issue.key, (entry.issues.get(issue.key) ?? 0) + issue.doc_count);
    byInstitution.set(institutionId, entry);
    result.complaints += breakdown.total;
  }

  const rows: Array<{ institution_id: number; product: string; issue: string; complaint_count: number }> = [];
  for (const [institutionId, entry] of byInstitution) {
    for (const [product, count] of entry.products) rows.push({ institution_id: institutionId, product, issue: "_total", complaint_count: count });
    const topIssues = [...entry.issues.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_ISSUES);
    for (const [issue, count] of topIssues) rows.push({ institution_id: institutionId, product: "_all", issue, complaint_count: count });
  }
  result.institutions = byInstitution.size;

  // Replace the year for every institution touched, so products that dropped to zero disappear.
  const institutionIds = JSON.stringify([...byInstitution.keys()]);
  await db`
    DELETE FROM institution_complaint_records
     WHERE report_period = ${String(year)}
       AND institution_id IN (SELECT (jsonb_array_elements_text(${institutionIds}::jsonb))::bigint)
  `;
  for (const group of chunk(rows, 1_000)) {
    const payload = JSON.stringify(group);
    const written = await db`
      INSERT INTO institution_complaint_records (institution_id, report_period, product, issue, complaint_count, fetched_at)
      SELECT r.institution_id, ${String(year)}, r.product, r.issue, r.complaint_count, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(institution_id bigint, product text, issue text, complaint_count integer)
      ON CONFLICT (institution_id, report_period, product, issue) DO UPDATE SET
        complaint_count = EXCLUDED.complaint_count,
        fetched_at = NOW()
      RETURNING 1
    `;
    result.rowsWritten += [...written].length;
  }

  const currentYear = now.getUTCFullYear();
  await recordRegistryPartition(db, {
    source: CFPB_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: result.companies,
    matchedCount: result.acceptedCompanies,
    unmatchedCount: result.reviewCompanies,
    insertedCount: result.rowsWritten,
    sourceUrl: url,
    runId: options.runId ?? null,
    nextAttemptAfterHours:
      year >= currentYear ? CURRENT_YEAR_REFRESH_HOURS : year === currentYear - 1 ? RECENT_YEAR_REFRESH_HOURS : HISTORICAL_REFRESH_HOURS,
    detail: { institutions: result.institutions, complaints: result.complaints },
  });
  return result;
}
