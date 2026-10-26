import { sql } from "@/lib/data-store/connection";
import { packHmdaCosts } from "@/lib/regulatory/hmda-cost-storage";
import { HMDA_REPAIR_MANIFEST } from "@/lib/agents/hoovie/hmda-repair-manifest";
import {
  fetchAporTable,
  fetchHmdaPanel,
  type AporRate,
  type AporTable,
  fetchHmdaStateAggregate,
  fetchHmdaStateYear,
  HMDA_FIRST_YEAR,
  HMDA_REQUIRED_FIELDS,
  HMDA_STATES,
  hmdaCleaningReport,
  parseHmdaPartition,
  type HmdaCleaningReport,
  type HmdaCostCell,
  type HmdaOriginationCell,
  type HmdaPanel,
} from "@/lib/regulatory/hmda";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { readFdicIdentityHolds, lockFdicIdentityHolds } from "@/lib/data-store/fdic-identity-holds";
import { HMDA_ORDINARY_IDENTITY_WRITES_ENABLED } from "@/lib/agents/hoovie/hmda-repair-release";
import { heldHmdaAnnualLinks, matchHmdaIdentities, summarizeHmdaMatching, type HmdaInstitutionIdentity, type HmdaIdentityMatch, type HmdaMatchingSummary } from "@/lib/regulatory/hmda-identity";
import { lockHmdaYear } from "./hmda-lock";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: one year and state of HMDA originations, aggregated per lender per
 * county and MSA/MD (hmda_lender_originations) with exact loan-cost medians per lender per MSA
 * (hmda_lender_loan_costs), and the year's filers (hmda_lenders) matched to institution_sources by
 * LEI, else by the public panel's RSSD. Unmatched lenders are kept with institution_id NULL.
 *
 * Partitions are year + state ("2025-CA"), not a whole year: a national year is roughly 8-15
 * million originations (several GB of CSV), far past one 300-second step; the largest single
 * state-year (California in a refinance boom) is about a million rows, which one streamed step
 * can sum. Newest year first, every state of a year before the year below it.
 */

export const HMDA_SOURCE = "hmda";
export const HMDA_PARSER_VERSION = 3;
export const HMDA_SCHEDULED_PARSER_VERSION = HMDA_ORDINARY_IDENTITY_WRITES_ENABLED ? HMDA_PARSER_VERSION : 2;
const LATEST_REFRESH_HOURS = 24 * 90;
const HISTORICAL_REFRESH_HOURS = 24 * 365;
const NOT_PUBLISHED_RETRY_HOURS = 24 * 14;
const WRITE_CHUNK = 2_000;

/**
 * Newest HMDA year the Data Browser should hold. Year Y is published around spring/summer of
 * Y+1, so from July Y+1 on Y is expected; before that, Y-1. A year asked for too early records
 * an empty partition and is retried.
 */
export function latestHmdaYear(now: Date): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= 6 ? year - 1 : year - 2;
}

export function hmdaPartitions(now: Date, firstYear: number = HMDA_FIRST_YEAR): string[] {
  const out: string[] = [];
  for (let year = latestHmdaYear(now); year >= Math.max(firstYear, HMDA_FIRST_YEAR); year -= 1) {
    for (const state of HMDA_STATES) out.push(`${year}-${state}`);
  }
  return out;
}

export interface RegistryHmdaOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
}

export interface RegistryHmdaResult {
  source: string;
  partitionKey: string;
  year: number;
  state: string;
  sourceUrl: string;
  bytes: number;
  originations: number;
  originationAmount: number;
  lenders: number;
  originationCells: number;
  costCells: number;
  writtenLenders: number;
  matchedLenders: number;
  unmatchedLenders: number;
  matching: HmdaMatchingSummary;
  writtenOriginationRows: number;
  writtenCostRows: number;
  propagatedOriginationRows: number;
  propagatedCostRows: number;
  removedStaleRows: number;
  missingFields: string[];
  reconciliationCountDifference: number | null;
  panelAvailable: boolean;
  cleaning: HmdaCleaningReport;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
}

async function writeLenders(
  db: RegistryDb,
  year: number,
  leis: string[],
  panel: HmdaPanel,
  runId: number | null,
  matches: HmdaIdentityMatch[],
  fallbackSourceUrl: string,
): Promise<{ written: number; matched: number }> {
  let written = 0;
  let matched = 0;
  const byLei = new Map(matches.map((match) => [match.lei, match]));
  for (let at = 0; at < leis.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(
      leis.slice(at, at + WRITE_CHUNK).map((lei) => {
        const p = panel.lenders.get(lei);
        const match = byLei.get(lei)!;
        return {
          lei,
          respondent_name: p?.respondentName ?? null,
          rssd_id: p?.rssdId ?? null,
          parent_rssd: p?.parentRssd ?? null,
          top_holder_rssd: p?.topHolderRssd ?? null,
          agency_code: p?.agencyCode ?? null,
          assets: p?.assets ?? null,
          other_lender_code: p?.otherLenderCode ?? null,
          in_panel: Boolean(p),
          institution_id: HMDA_ORDINARY_IDENTITY_WRITES_ENABLED ? match.institutionId : null,
          match_method: HMDA_ORDINARY_IDENTITY_WRITES_ENABLED ? match.method : null,
          raw_json: { ...p?.raw, ...(HMDA_ORDINARY_IDENTITY_WRITES_ENABLED ? {
            feeinsight_identity: { ...match, version: HMDA_PARSER_VERSION, panel_available: panel.available, panel_url: panel.url },
          } : {}) },
        };
      }),
    );
    const result = await db`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          lei text, respondent_name text, rssd_id text, parent_rssd text, top_holder_rssd text,
          agency_code text, assets text, other_lender_code text, in_panel boolean, raw_json jsonb,
          institution_id bigint, match_method text)
      )
      INSERT INTO hmda_lenders AS l (
        activity_year, lei, respondent_name, rssd_id, parent_rssd, top_holder_rssd, agency_code, assets,
        other_lender_code, institution_id, match_method, in_panel, raw_json, source_url, agent_run_id, fetched_at)
      SELECT ${year}, r.lei, r.respondent_name, r.rssd_id, r.parent_rssd, r.top_holder_rssd, r.agency_code, r.assets,
             r.other_lender_code, r.institution_id, r.match_method, r.in_panel, COALESCE(r.raw_json, '{}'::jsonb),
             ${panel.available ? panel.url : fallbackSourceUrl}, ${runId}, NOW()
        FROM r
      ON CONFLICT (activity_year, lei) DO UPDATE SET
        respondent_name = EXCLUDED.respondent_name,
        rssd_id = EXCLUDED.rssd_id,
        parent_rssd = EXCLUDED.parent_rssd,
        top_holder_rssd = EXCLUDED.top_holder_rssd,
        agency_code = EXCLUDED.agency_code,
        assets = EXCLUDED.assets,
        other_lender_code = EXCLUDED.other_lender_code,
        institution_id = CASE WHEN ${HMDA_ORDINARY_IDENTITY_WRITES_ENABLED} THEN EXCLUDED.institution_id ELSE l.institution_id END,
        match_method = CASE WHEN ${HMDA_ORDINARY_IDENTITY_WRITES_ENABLED} THEN EXCLUDED.match_method ELSE l.match_method END,
        in_panel = EXCLUDED.in_panel,
        raw_json = CASE WHEN ${HMDA_ORDINARY_IDENTITY_WRITES_ENABLED} THEN EXCLUDED.raw_json
          ELSE (EXCLUDED.raw_json - 'feeinsight_identity') || CASE WHEN l.raw_json ? 'feeinsight_identity'
            THEN jsonb_build_object('feeinsight_identity', l.raw_json->'feeinsight_identity') ELSE '{}'::jsonb END END,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING (l.institution_id IS NOT NULL) AS matched
    `;
    const rows = [...(result as unknown as Array<{ matched: boolean }>)];
    written += rows.length;
    matched += rows.filter((row) => row.matched).length;
  }
  return { written, matched };
}

/** Annual identities must agree in every state's cells, including when a match is cleared. */
async function writeAnnualIdentities(
  db: RegistryDb,
  year: number,
  leis: string[],
  panel: HmdaPanel,
  runId: number | null,
  matches: HmdaIdentityMatch[],
  fallbackSourceUrl: string,
): Promise<{ written: number; matched: number; propagatedOriginationRows: number; propagatedCostRows: number }> {
  const tx = db;
  const lenders = await writeLenders(tx, year, leis, panel, runId, matches, fallbackSourceUrl);
  let propagatedOriginationRows = 0;
  let propagatedCostRows = 0;
  if (!HMDA_ORDINARY_IDENTITY_WRITES_ENABLED) return { ...lenders, propagatedOriginationRows, propagatedCostRows };
  for (let at = 0; at < leis.length; at += WRITE_CHUNK) {
    const selectedLeis = leis.slice(at, at + WRITE_CHUNK);
    const originations = await tx`
      UPDATE hmda_lender_originations c SET institution_id = l.institution_id
        FROM hmda_lenders l
       WHERE l.activity_year = ${year} AND l.lei IN ${tx(selectedLeis)}
         AND c.activity_year = l.activity_year AND c.lei = l.lei
         AND c.institution_id IS DISTINCT FROM l.institution_id
      RETURNING c.id
    `;
    const costs = await tx`
      UPDATE hmda_lender_loan_costs c SET institution_id = l.institution_id
        FROM hmda_lenders l
       WHERE l.activity_year = ${year} AND l.lei IN ${tx(selectedLeis)}
         AND c.activity_year = l.activity_year AND c.lei = l.lei
         AND c.institution_id IS DISTINCT FROM l.institution_id
      RETURNING c.id
    `;
    propagatedOriginationRows += [...(originations as unknown as unknown[])].length;
    propagatedCostRows += [...(costs as unknown as unknown[])].length;
  }
  return { ...lenders, propagatedOriginationRows, propagatedCostRows };
}

/** Read once after the LAR finishes; missing identity infrastructure is an error, never zero matches. */
async function readInstitutionIdentities(db: RegistryDb): Promise<HmdaInstitutionIdentity[]> {
  const tx = db;
  const rows = await tx`
    SELECT s.id, s.lei, s.rssd_id, s.source, s.cert_number, s.registry_synced_at,
           l.status AS lei_status, l.lei AS linked_lei, l.match_basis, l.candidate_leis,
           l.source_url AS lei_source_url, l.checked_at AS lei_checked_at, l.match_key
      FROM institution_sources s
      LEFT JOIN institution_lei_links l ON l.institution_id = s.id
  `;
  return [...(rows as unknown as Array<Record<string, unknown>>)].map((row) => ({
    id: Number(row.id),
    lei: row.lei == null ? null : String(row.lei),
    rssdId: row.rssd_id == null ? null : String(row.rssd_id),
    source: row.source == null ? null : String(row.source),
    certNumber: row.cert_number == null ? null : String(row.cert_number),
    registrySyncedAt: row.registry_synced_at instanceof Date ? row.registry_synced_at.toISOString() : row.registry_synced_at == null ? null : String(row.registry_synced_at),
    leiLink: row.lei_status == null ? null : {
      status: String(row.lei_status),
      lei: row.linked_lei == null ? null : String(row.linked_lei),
      basis: row.match_basis == null ? null : String(row.match_basis),
      candidates: Array.isArray(row.candidate_leis) ? row.candidate_leis.map(String) : [],
      sourceUrl: row.lei_source_url == null ? null : String(row.lei_source_url),
      checkedAt: row.lei_checked_at instanceof Date ? row.lei_checked_at.toISOString() : row.lei_checked_at == null ? null : String(row.lei_checked_at),
      matchKey: row.match_key == null ? null : String(row.match_key),
    },
  }));
}

async function writeOriginations(db: RegistryDb, year: number, cells: HmdaOriginationCell[], sourceUrl: string, runId: number | null): Promise<number> {
  let written = 0;
  for (let at = 0; at < cells.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(
      cells.slice(at, at + WRITE_CHUNK).map((c) => ({
        lei: c.lei,
        state_code: c.stateCode,
        county_fips: c.countyFips,
        msa_md: c.msaMd,
        originations: c.originations,
        origination_amount: c.originationAmount,
        amount_missing: c.amountMissing,
        purchase_count: c.purchaseCount,
        purchase_amount: c.purchaseAmount,
        refinance_count: c.refinanceCount,
        refinance_amount: c.refinanceAmount,
      })),
    );
    const result = await db`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          lei text, state_code text, county_fips text, msa_md text, originations integer, origination_amount numeric,
          amount_missing integer, purchase_count integer, purchase_amount numeric, refinance_count integer,
          refinance_amount numeric)
      )
      INSERT INTO hmda_lender_originations (
        activity_year, lei, state_code, county_fips, msa_md, institution_id, originations, origination_amount,
        amount_missing, purchase_count, purchase_amount, refinance_count, refinance_amount, source_url,
        agent_run_id, fetched_at)
      SELECT ${year}, r.lei, r.state_code, r.county_fips, r.msa_md, l.institution_id, r.originations,
             r.origination_amount, r.amount_missing, r.purchase_count, r.purchase_amount, r.refinance_count,
             r.refinance_amount, ${sourceUrl}, ${runId}, clock_timestamp()
        FROM r LEFT JOIN hmda_lenders l ON l.activity_year = ${year} AND l.lei = r.lei
      ON CONFLICT ON CONSTRAINT hmda_lender_originations_key DO UPDATE SET
        institution_id = EXCLUDED.institution_id,
        originations = EXCLUDED.originations,
        origination_amount = EXCLUDED.origination_amount,
        amount_missing = EXCLUDED.amount_missing,
        purchase_count = EXCLUDED.purchase_count,
        purchase_amount = EXCLUDED.purchase_amount,
        refinance_count = EXCLUDED.refinance_count,
        refinance_amount = EXCLUDED.refinance_amount,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = clock_timestamp()
      RETURNING 1 AS written
    `;
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

async function writeCosts(db: RegistryDb, year: number, cells: HmdaCostCell[], sourceUrl: string, runId: number | null): Promise<number> {
  let written = 0;
  for (let at = 0; at < cells.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(
      cells.slice(at, at + WRITE_CHUNK).map((c) => ({
        lei: c.lei,
        state_code: c.stateCode,
        msa_md: c.msaMd,
        originations: c.originations,
        total_loan_costs_n: c.costs.total_loan_costs.n,
        total_loan_costs_median: c.costs.total_loan_costs.median,
        origination_charges_n: c.costs.origination_charges.n,
        origination_charges_median: c.costs.origination_charges.median,
        discount_points_n: c.costs.discount_points.n,
        discount_points_median: c.costs.discount_points.median,
        lender_credits_n: c.costs.lender_credits.n,
        lender_credits_median: c.costs.lender_credits.median,
        // This year's exact row hashes are pinned by the separately reviewed identity repair.
        cost_detail: year === HMDA_REPAIR_MANIFEST.year ? c.costs : packHmdaCosts(c.costs),
      })),
    );
    const result = await db`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          lei text, state_code text, msa_md text, originations integer,
          total_loan_costs_n integer, total_loan_costs_median numeric,
          origination_charges_n integer, origination_charges_median numeric,
          discount_points_n integer, discount_points_median numeric,
          lender_credits_n integer, lender_credits_median numeric, cost_detail jsonb)
      )
      INSERT INTO hmda_lender_loan_costs (
        activity_year, lei, state_code, msa_md, institution_id, originations,
        total_loan_costs_n, total_loan_costs_median, origination_charges_n, origination_charges_median,
        discount_points_n, discount_points_median, lender_credits_n, lender_credits_median, cost_detail,
        source_url, agent_run_id, fetched_at)
      SELECT ${year}, r.lei, r.state_code, r.msa_md, l.institution_id, r.originations,
             r.total_loan_costs_n, r.total_loan_costs_median, r.origination_charges_n, r.origination_charges_median,
             r.discount_points_n, r.discount_points_median, r.lender_credits_n, r.lender_credits_median,
             COALESCE(r.cost_detail, '{}'::jsonb), ${sourceUrl}, ${runId}, clock_timestamp()
        FROM r LEFT JOIN hmda_lenders l ON l.activity_year = ${year} AND l.lei = r.lei
      ON CONFLICT ON CONSTRAINT hmda_lender_loan_costs_key DO UPDATE SET
        institution_id = EXCLUDED.institution_id,
        originations = EXCLUDED.originations,
        total_loan_costs_n = EXCLUDED.total_loan_costs_n,
        total_loan_costs_median = EXCLUDED.total_loan_costs_median,
        origination_charges_n = EXCLUDED.origination_charges_n,
        origination_charges_median = EXCLUDED.origination_charges_median,
        discount_points_n = EXCLUDED.discount_points_n,
        discount_points_median = EXCLUDED.discount_points_median,
        lender_credits_n = EXCLUDED.lender_credits_n,
        lender_credits_median = EXCLUDED.lender_credits_median,
        cost_detail = EXCLUDED.cost_detail,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = clock_timestamp()
      RETURNING 1 AS written
    `;
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

/** Removes the partition's cells that this run did not write (a lender or county gone after a resubmission). */
async function removeStale(db: RegistryDb, year: number, state: string, startedAt: Date | string): Promise<number> {
  const a = await db`
    DELETE FROM hmda_lender_originations
     WHERE activity_year = ${year} AND state_code = ${state} AND fetched_at < ${startedAt}
    RETURNING 1 AS removed
  `;
  const b = await db`
    DELETE FROM hmda_lender_loan_costs
     WHERE activity_year = ${year} AND state_code = ${state} AND fetched_at < ${startedAt}
    RETURNING 1 AS removed
  `;
  return [...(a as unknown as unknown[])].length + [...(b as unknown as unknown[])].length;
}

export async function runRegistryHmda(options: RegistryHmdaOptions): Promise<RegistryHmdaResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const parsed = parseHmdaPartition(options.partitionKey);
  if (!parsed) throw new Error(`Invalid HMDA partition (want YYYY-ST, ${HMDA_FIRST_YEAR} or later): ${options.partitionKey}`);
  const { year, state } = parsed;
  const now = options.now ?? new Date();

  const [pull, aggregate, panel] = await Promise.all([
    fetchHmdaStateYear(year, state, options.fetchOptions),
    fetchHmdaStateAggregate(year, state, options.fetchOptions),
    fetchHmdaPanel(year, options.fetchOptions),
  ]);
  const acc = pull.acc;
  const cells = acc?.usable ? acc.originationCells() : [];
  const costCells = acc?.usable ? acc.costCellsOut() : [];
  const leis = acc?.usable ? acc.leis() : [];
  const cleaningBefore = hmdaCleaningReport({ pull, aggregate, panel });

  let emptyReason: string | null = null;
  if (!acc) emptyReason = "HMDA returned no CSV header (year not published, or an error page)";
  else if (!acc.usable) {
    const missing = HMDA_REQUIRED_FIELDS.filter((f) => acc.missingFields.includes(f));
    emptyReason = `CSV header lacks required fields: ${missing.join(", ")}`;
  } else if (cells.length === 0) emptyReason = "HMDA returned no originations for this year and state";

  // No network work occurs while holding the lock. Every database read/write that can affect
  // this annual identity or its state cells shares one transaction with the scoped repair path.
  return (await db.begin(async (raw) => {
    const db = raw as unknown as RegistryDb;
    if (dryRun) await db`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
    await db`SET LOCAL statement_timeout = '15s'`;
    if (!dryRun) {
      await lockHmdaYear(db, year);
      await db`LOCK TABLE institution_sources,institution_lei_links IN SHARE MODE`;
      await lockFdicIdentityHolds(db);
    }
    const institutions = emptyReason === null ? await readInstitutionIdentities(db) : [];
    const identityHolds = emptyReason === null ? await readFdicIdentityHolds(db) : [];
    const matches = emptyReason === null
      ? matchHmdaIdentities(leis.map((lei) => ({ lei, rssdId: panel.lenders.get(lei)?.rssdId ?? null,
        sourceConflict: panel.conflictingLeis?.includes(lei) })), institutions, identityHolds)
      : [];
    // A held legacy annual ID must not be copied into newly ingested state cells while
    // identity cleanup remains release-disabled. Preserve the whole partition for review.
    if (!dryRun && !HMDA_ORDINARY_IDENTITY_WRITES_ENABLED && emptyReason === null) {
      const annual = await db`SELECT lei, institution_id FROM hmda_lenders
        WHERE activity_year=${year} AND lei::text=ANY(${leis}::text[])`;
      const preserved = annual.map((row) => ({ lei: String(row.lei).trim(),
        institutionId: row.institution_id == null ? null : Number(row.institution_id) }));
      if (matches.some((row) => row.reason === "fdic_identity_hold")
        || heldHmdaAnnualLinks(preserved, institutions, identityHolds).length > 0) {
        throw new Error("HMDA partition is affected by durable FDIC identity holds; identity writes remain disabled pending review");
      }
    }
    const matching = summarizeHmdaMatching(matches);
    const base: RegistryHmdaResult = {
      source: HMDA_SOURCE,
      partitionKey: options.partitionKey,
      year,
      state,
      sourceUrl: pull.url,
      bytes: pull.bytes,
      originations: acc?.stats.originationsCounted ?? 0,
      originationAmount: acc?.stats.originationAmountCounted ?? 0,
      lenders: leis.length,
      originationCells: cells.length,
      costCells: costCells.length,
      writtenLenders: 0,
      matchedLenders: matching.matched,
      unmatchedLenders: matching.unmatched + matching.ambiguous,
      matching,
      writtenOriginationRows: 0,
      writtenCostRows: 0,
      propagatedOriginationRows: 0,
      propagatedCostRows: 0,
      removedStaleRows: 0,
      missingFields: acc?.missingFields ?? [],
      reconciliationCountDifference: cleaningBefore.reconciliation.count_difference,
      panelAvailable: panel.available,
      cleaning: cleaningBefore,
      dryRun,
      empty: emptyReason !== null,
      emptyReason,
    };
    if (dryRun) return base;

    const refreshHours = year >= latestHmdaYear(now) ? LATEST_REFRESH_HOURS : HISTORICAL_REFRESH_HOURS;
    const detail = {
      parser_version: HMDA_SCHEDULED_PARSER_VERSION,
      identity_writes_enabled: HMDA_ORDINARY_IDENTITY_WRITES_ENABLED,
      year,
      state,
      bytes: pull.bytes,
      first_line: pull.firstLine,
      panel_url: panel.url,
    };
    if (emptyReason !== null) {
      await recordRegistryPartition(db, {
        source: HMDA_SOURCE,
        partitionKey: options.partitionKey,
        status: "empty",
        rowCount: 0,
        sourceUrl: pull.url,
        runId: options.runId ?? null,
        nextAttemptAfterHours: acc ? refreshHours : NOT_PUBLISHED_RETRY_HOURS,
        detail: { ...detail, reason: emptyReason, cleaning: cleaningBefore },
      });
      return base;
    }

    const [{ started_at: startedAt }] = [...((await db`SELECT clock_timestamp() AS started_at`) as unknown as Array<{ started_at: Date | string }>)];
    const runId = options.runId ?? null;
    const lenders = await writeAnnualIdentities(db, year, leis, panel, runId, matches, pull.url);
    const writtenOriginationRows = await writeOriginations(db, year, cells, pull.url, runId);
    const writtenCostRows = await writeCosts(db, year, costCells, pull.url, runId);
    // Old cells are removed only when the stream tied out to the Data Browser's own count, so a
    // short read never deletes rows a complete earlier read wrote.
    const tiedOut = cleaningBefore.reconciliation.count_difference === 0;
    const removedStaleRows = tiedOut ? await removeStale(db, year, state, startedAt) : 0;
    const unmatched = lenders.written - lenders.matched;
    const cleaning = { ...cleaningBefore, unmatched_lenders: unmatched };

    await recordRegistryPartition(db, {
      source: HMDA_SOURCE,
      partitionKey: options.partitionKey,
      status: "succeeded",
      rowCount: cells.length,
      matchedCount: lenders.matched,
      unmatchedCount: unmatched,
      insertedCount: writtenOriginationRows,
      sourceUrl: pull.url,
      runId,
      nextAttemptAfterHours: refreshHours,
      detail: {
        ...detail,
        originations: base.originations,
        origination_amount: base.originationAmount,
        lenders: leis.length,
        matched_lenders: lenders.matched,
        unmatched_lenders: unmatched,
        matching,
        written_origination_rows: writtenOriginationRows,
        written_cost_rows: writtenCostRows,
        propagated_origination_rows: lenders.propagatedOriginationRows,
        propagated_cost_rows: lenders.propagatedCostRows,
        removed_stale_rows: removedStaleRows,
        stale_rows_kept_because: tiedOut ? null : "streamed count did not tie out to the Data Browser aggregation",
        cleaning,
      },
    });
    return {
      ...base,
      writtenLenders: lenders.written,
      matchedLenders: lenders.matched,
      unmatchedLenders: unmatched,
      writtenOriginationRows,
      writtenCostRows,
      propagatedOriginationRows: lenders.propagatedOriginationRows,
      propagatedCostRows: lenders.propagatedCostRows,
      removedStaleRows,
      cleaning,
    };
  })) as RegistryHmdaResult;
}

/**
 * Companion step: CFPB's weekly APOR tables (fixed and adjustable, by loan term), which HMDA's
 * rate spread is measured against. One fixed partition; the whole history is re-read weekly.
 */
export const HMDA_APOR_SOURCE = "hmda-apor";
export const HMDA_APOR_PARSER_VERSION = 2;
export const HMDA_APOR_PARTITION = "current";
const APOR_REFRESH_HOURS = 24 * 7;

export interface RegistryHmdaAporResult {
  source: string;
  partitionKey: string;
  sourceUrl: string | null;
  rates: number;
  latestEffectiveDate: string | null;
  writtenRows: number;
  tables: Array<Omit<AporTable, "rates"> & { rates: number }>;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
}

async function writeApor(db: RegistryDb, rates: AporRate[], urls: Record<string, string | null>, runId: number | null): Promise<number> {
  let written = 0;
  for (let at = 0; at < rates.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(
      rates.slice(at, at + WRITE_CHUNK).map((r) => ({
        rate_type: r.rateType,
        effective_date: r.effectiveDate,
        term_years: r.termYears,
        apor: r.apor,
        source_url: urls[r.rateType] ?? null,
      })),
    );
    const result = await db`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          rate_type text, effective_date date, term_years integer, apor numeric, source_url text)
      )
      INSERT INTO hmda_apor_rates (rate_type, effective_date, term_years, apor, source_url, agent_run_id, fetched_at)
      SELECT r.rate_type, r.effective_date, r.term_years, r.apor, r.source_url, ${runId}, NOW() FROM r
      ON CONFLICT (rate_type, effective_date, term_years) DO UPDATE SET
        apor = EXCLUDED.apor,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1 AS written
    `;
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

export async function runRegistryHmdaApor(options: RegistryHmdaOptions): Promise<RegistryHmdaAporResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const tables = await Promise.all([fetchAporTable("fixed", options.fetchOptions), fetchAporTable("adjustable", options.fetchOptions)]);
  const rates = tables.flatMap((t) => t.rates);
  const summaries = tables.map(({ rates: r, ...rest }) => ({ ...rest, rates: r.length }));
  const latest = rates.reduce<string | null>((max, r) => (max === null || r.effectiveDate > max ? r.effectiveDate : max), null);
  const emptyReason = rates.length === 0 ? tables.map((t) => `${t.rateType}: ${t.note ?? "no rates"}`).join("; ") : null;
  const sourceUrl = tables.find((t) => t.url)?.url ?? null;
  const base: RegistryHmdaAporResult = {
    source: HMDA_APOR_SOURCE,
    partitionKey: options.partitionKey,
    sourceUrl,
    rates: rates.length,
    latestEffectiveDate: latest,
    writtenRows: 0,
    tables: summaries,
    dryRun,
    empty: emptyReason !== null,
    emptyReason,
  };
  if (dryRun) return base;
  const detail = { parser_version: HMDA_APOR_PARSER_VERSION, tables: summaries, latest_effective_date: latest };
  if (emptyReason !== null) {
    await recordRegistryPartition(db, {
      source: HMDA_APOR_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl,
      runId: options.runId ?? null,
      nextAttemptAfterHours: APOR_REFRESH_HOURS,
      detail: { ...detail, reason: emptyReason },
    });
    return base;
  }
  const urls = Object.fromEntries(tables.map((t) => [t.rateType, t.url]));
  const writtenRows = await writeApor(db, rates, urls, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: HMDA_APOR_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: rates.length,
    insertedCount: writtenRows,
    sourceUrl,
    runId: options.runId ?? null,
    nextAttemptAfterHours: APOR_REFRESH_HOURS,
    detail: { ...detail, written_rows: writtenRows },
  });
  return { ...base, writtenRows };
}
