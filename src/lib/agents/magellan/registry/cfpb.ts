import { sql } from "@/lib/data-store/connection";
import {
  CFPB_FIRST_YEAR,
  fetchCfpbCompanyBreakdown,
  fetchCfpbCompanyCounts,
  fetchCfpbCompanyProductIssues,
} from "@/lib/regulatory/cfpb";
import { FEE_PRODUCTS, FEE_PRODUCTS_KEY, FEE_SUB_ISSUES_KEY, subIssueKey } from "@/lib/complaints/fee-issues";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { loadAcceptedLinks, loadIdentityIndex, matchCompany, upsertIdentityLinks, type IdentityLinkInput } from "./identity";
import { chunk, mapWithConcurrency, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: one calendar year of CFPB consumer complaints.
 *
 * 1. List every company with complaints that year and match names to
 *    institutions (institution_identity_links; ambiguous names wait for review).
 * 2. For each accepted company, pull the product and issue breakdown.
 * 3. Pull the issues (and sub-issues, when CFPB returns them) within the
 *    deposit and card products, which is what fee complaints are counted from
 *    (src/lib/complaints/fee-issues.ts).
 * 4. Replace the whole year in institution_complaint_records: product totals
 *    with issue '_total', every issue under product '_all', and the deposit and
 *    card issues under FEE_PRODUCTS_KEY / FEE_SUB_ISSUES_KEY. Several companies
 *    mapped to one institution are summed.
 */

export const CFPB_SOURCE = "cfpb";
const BREAKDOWN_CONCURRENCY = 4;
/** v2: all issues (no top-15 cut), deposit/card fee issues, whole-year replace, better name matching. */
export const CFPB_PARSER_VERSION = 2;
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
  feeProductComplaints: number;
  subIssuesLoaded: boolean;
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
    feeProductComplaints: 0,
    subIssuesLoaded: false,
    rowsWritten: 0,
    dryRun,
  };
  if (dryRun) return result;

  await upsertIdentityLinks(db, "cfpb_company", decisions, options.runId ?? null);
  // Use the stored links, which include any a person accepted or rejected by hand.
  const accepted = await loadAcceptedLinks(db, "cfpb_company");
  const companyCounts = new Map(companies.map((c) => [c.key, c.doc_count]));
  const linked = [...accepted.entries()].filter(([company]) => companyCounts.has(company));

  // Both requests per company run together, so a year stays inside one function call.
  const breakdowns = await mapWithConcurrency(linked, BREAKDOWN_CONCURRENCY, async ([company, institutionId]) => {
    const [breakdown, feeProducts] = await Promise.all([
      fetchCfpbCompanyBreakdown(company, year, options.fetchOptions),
      fetchCfpbCompanyProductIssues(company, year, FEE_PRODUCTS, options.fetchOptions),
    ]);
    return { institutionId, breakdown, feeProducts };
  });

  type Counts = Map<string, number>;
  const add = (map: Counts, key: string, count: number) => map.set(key, (map.get(key) ?? 0) + count);
  const byInstitution = new Map<number, { products: Counts; issues: Counts; feeIssues: Counts; feeSubIssues: Counts }>();
  for (const { institutionId, breakdown, feeProducts } of breakdowns) {
    const entry = byInstitution.get(institutionId) ?? { products: new Map(), issues: new Map(), feeIssues: new Map(), feeSubIssues: new Map() };
    for (const product of breakdown.products) add(entry.products, product.key, product.doc_count);
    for (const issue of breakdown.issues) add(entry.issues, issue.key, issue.doc_count);
    for (const issue of feeProducts.issues) add(entry.feeIssues, issue.key, issue.doc_count);
    for (const sub of feeProducts.subIssues) add(entry.feeSubIssues, subIssueKey(sub.issue, sub.subIssue), sub.doc_count);
    byInstitution.set(institutionId, entry);
    result.complaints += breakdown.total;
    result.feeProductComplaints += feeProducts.total;
    if (feeProducts.subIssues.length > 0) result.subIssuesLoaded = true;
  }

  const rows: Array<{ institution_id: number; product: string; issue: string; complaint_count: number }> = [];
  for (const [institutionId, entry] of byInstitution) {
    for (const [product, count] of entry.products) rows.push({ institution_id: institutionId, product, issue: "_total", complaint_count: count });
    for (const [issue, count] of entry.issues) rows.push({ institution_id: institutionId, product: "_all", issue, complaint_count: count });
    for (const [issue, count] of entry.feeIssues) rows.push({ institution_id: institutionId, product: FEE_PRODUCTS_KEY, issue, complaint_count: count });
    for (const [issue, count] of entry.feeSubIssues) rows.push({ institution_id: institutionId, product: FEE_SUB_ISSUES_KEY, issue, complaint_count: count });
  }
  result.institutions = byInstitution.size;

  // Replace the whole year, so products that dropped to zero and links that were withdrawn disappear.
  await db`
    DELETE FROM institution_complaint_records
     WHERE report_period = ${String(year)}
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
    detail: {
      institutions: result.institutions,
      complaints: result.complaints,
      fee_product_complaints: result.feeProductComplaints,
      sub_issues_loaded: result.subIssuesLoaded,
      parser_version: CFPB_PARSER_VERSION,
    },
  });
  return result;
}
