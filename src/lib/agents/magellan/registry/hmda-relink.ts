import { sql } from "@/lib/data-store/connection";
import { readFdicIdentityHolds, lockFdicIdentityHolds } from "@/lib/data-store/fdic-identity-holds";
import { matchHmdaIdentities, type HmdaIdentityMatch } from "@/lib/regulatory/hmda-identity";
import { HMDA_FIRST_YEAR } from "@/lib/regulatory/hmda";
import { latestHmdaYear, readInstitutionIdentities } from "./hmda";
import { lockHmdaYear } from "./hmda-lock";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Hoovie, #2232: link a year's HMDA lenders to our institutions through the canonical LEI links
 * (`institution_lei_links`), without downloading the LAR again.
 *
 * The FFIEC Reporter Panel, which gave HMDA lenders an RSSD, stopped after 2023, so 2024 on was
 * never linked, and every HMDA partition refreshes only yearly. The GLEIF lei-match partitions
 * now link institutions to the LEI that GLEIF lists under their FDIC cert or NCUA charter. This
 * step applies those links to the lenders already stored.
 *
 * It only fills: a lender row that already has an institution is never changed or cleared, and
 * a row that came from the panel (`in_panel`) is left to the panel loader, which knows the panel's
 * conflicts. A fill needs `matchHmdaIdentities` to say `matched` by LEI (never RSSD alone, never a
 * name+state proposal); a held, shared or contradicted identity stays unlinked. Each run links at
 * most RELINK_BATCH lenders and copies their institution to that year's origination and loan-cost
 * cells, so one step stays short; the rest go next run.
 *
 * Off (`HMDA_RELINK_LIVE` false) or in a dry run, it writes no HMDA row and records what it would
 * link in the partition detail, so the count is visible before anyone turns it on.
 */

/**
 * On since 2026-11-04 (James's yes on the decision card, #2232): a live run writes institution_id on
 * existing HMDA rows. Off-mode prod counts on 2026-11-02: 3,406 lenders in 2025 and 3,433 in 2024
 * would link, 0 ambiguous. Set false to stop; filled links stay.
 */
export const HMDA_RELINK_LIVE = true;
/**
 * Its own registry source, not a partition of "hmda": a relink success must never stand in for an
 * HMDA download in feed freshness, source health or the registry counts.
 */
export const HMDA_RELINK_SOURCE = "hmda-relink";
export const HMDA_RELINK_PARSER_VERSION = 1;
export const HMDA_RELINK_PREFIX = "relink-";
export const RELINK_BATCH = 300;
const CELL_CHUNK = 50;
const SAMPLE_SIZE = 12;
const WEEKLY_HOURS = 24 * 7;
const MORE_HOURS = 1;

export function hmdaRelinkPartitions(now: Date, firstYear: number = HMDA_FIRST_YEAR): string[] {
  const out: string[] = [];
  for (let year = latestHmdaYear(now); year >= Math.max(firstYear, HMDA_FIRST_YEAR); year -= 1) out.push(`${HMDA_RELINK_PREFIX}${year}`);
  return out;
}

export function parseHmdaRelinkPartition(key: string): number | null {
  const m = /^relink-(\d{4})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  return year >= HMDA_FIRST_YEAR && year <= 2100 ? year : null;
}

export function isHmdaRelinkPartition(key: string): boolean {
  return parseHmdaRelinkPartition(key) !== null;
}

export interface HmdaRelinkFill {
  lei: string;
  institutionId: number;
  basis: string | null;
}

export interface HmdaRelinkPlan {
  /** Stored lender rows for the year with no institution and no panel record. */
  unlinked: number;
  fills: HmdaRelinkFill[];
  /** Why the rest stay unlinked, by matcher reason (ambiguous and unmatched alike). */
  kept: Record<string, number>;
}

/** Fills only: an LEI match to one institution, with no hold, conflict or RSSD disagreement. */
export function planHmdaRelink(
  lenders: ReadonlyArray<{ lei: string; rssdId: string | null }>,
  matches: readonly HmdaIdentityMatch[],
): HmdaRelinkPlan {
  const kept: Record<string, number> = {};
  const fills: HmdaRelinkFill[] = [];
  for (const match of matches) {
    if (match.status === "matched" && match.method === "lei" && match.institutionId !== null) {
      const link = match.evidence.find((e) => e.institutionId === match.institutionId && e.kind !== "respondent_rssd");
      fills.push({ lei: match.lei, institutionId: match.institutionId, basis: link?.kind === "canonical_lei_link" ? link.linkBasis : link?.kind ?? null });
      continue;
    }
    const reason = match.status === "matched" ? `not_by_lei_${match.reason}` : match.reason;
    kept[reason] = (kept[reason] ?? 0) + 1;
  }
  fills.sort((a, b) => a.lei.localeCompare(b.lei));
  return { unlinked: lenders.length, fills, kept };
}

export interface HmdaRelinkResult {
  source: typeof HMDA_RELINK_SOURCE;
  partitionKey: string;
  year: number;
  live: boolean;
  dryRun: boolean;
  unlinked: number;
  wouldLink: number;
  linked: number;
  propagatedOriginationRows: number;
  propagatedCostRows: number;
  remaining: number;
  byBasis: Record<string, number>;
  kept: Record<string, number>;
  sample: HmdaRelinkFill[];
}

export interface HmdaRelinkOptions {
  partitionKey: string;
  runId?: number | null;
  dryRun?: boolean;
  db?: RegistryDb;
  /** Tests only; production reads HMDA_RELINK_LIVE. */
  live?: boolean;
  /** Tests only; production uses RELINK_BATCH. */
  batch?: number;
}

export async function runHmdaRelink(options: HmdaRelinkOptions): Promise<HmdaRelinkResult> {
  const year = parseHmdaRelinkPartition(options.partitionKey);
  if (year === null) throw new Error(`Invalid HMDA relink partition (want relink-YYYY): ${options.partitionKey}`);
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const live = (options.live ?? HMDA_RELINK_LIVE) && !dryRun;

  return (await db.begin(async (raw) => {
    const tx = raw as unknown as RegistryDb;
    if (!live) await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
    await tx`SET LOCAL statement_timeout = '30s'`;
    if (live) {
      // The same year lock and identity locks the state loader and the scoped repair take.
      await lockHmdaYear(tx, year);
      await tx`LOCK TABLE institution_sources,institution_lei_links IN SHARE MODE`;
      await lockFdicIdentityHolds(tx);
    }
    const rows = await tx<{ lei: string; rssd_id: string | null }[]>`
      SELECT lei, rssd_id FROM hmda_lenders
       WHERE activity_year = ${year} AND institution_id IS NULL AND in_panel IS NOT TRUE
       ORDER BY lei`;
    const lenders = [...rows].map((row) => ({ lei: String(row.lei).trim(), rssdId: row.rssd_id == null ? null : String(row.rssd_id) }));
    const institutions = await readInstitutionIdentities(tx);
    const holds = await readFdicIdentityHolds(tx);
    const plan = planHmdaRelink(lenders, matchHmdaIdentities(lenders, institutions, holds));
    const byBasis: Record<string, number> = {};
    for (const fill of plan.fills) byBasis[fill.basis ?? "unknown"] = (byBasis[fill.basis ?? "unknown"] ?? 0) + 1;

    const batch = live ? plan.fills.slice(0, options.batch ?? RELINK_BATCH) : [];
    let linked = 0;
    let propagatedOriginationRows = 0;
    let propagatedCostRows = 0;
    if (batch.length > 0) {
      const payload = JSON.stringify(batch.map((f) => ({ lei: f.lei, institution_id: f.institutionId, basis: f.basis })));
      const written = await tx`
        WITH r AS (SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(lei text, institution_id bigint, basis text))
        UPDATE hmda_lenders l SET institution_id = r.institution_id, match_method = 'lei',
               raw_json = COALESCE(l.raw_json, '{}'::jsonb) || jsonb_build_object('feeinsight_relink',
                 jsonb_build_object('basis', r.basis, 'agent_run_id', ${options.runId ?? null}::bigint, 'at', clock_timestamp()))
          FROM r
         WHERE l.activity_year = ${year} AND l.lei = r.lei AND l.institution_id IS NULL AND l.in_panel IS NOT TRUE
        RETURNING l.lei`;
      const leis = [...(written as unknown as Array<{ lei: string }>)].map((row) => row.lei);
      linked = leis.length;
      for (let at = 0; at < leis.length; at += CELL_CHUNK) {
        const chunk = leis.slice(at, at + CELL_CHUNK);
        const o = await tx`
          UPDATE hmda_lender_originations c SET institution_id = l.institution_id
            FROM hmda_lenders l
           WHERE l.activity_year = ${year} AND l.lei = ANY(${chunk}::text[])
             AND c.activity_year = l.activity_year AND c.lei = l.lei AND c.institution_id IS NULL
          RETURNING c.id`;
        const c = await tx`
          UPDATE hmda_lender_loan_costs c SET institution_id = l.institution_id
            FROM hmda_lenders l
           WHERE l.activity_year = ${year} AND l.lei = ANY(${chunk}::text[])
             AND c.activity_year = l.activity_year AND c.lei = l.lei AND c.institution_id IS NULL
          RETURNING c.id`;
        propagatedOriginationRows += [...(o as unknown as unknown[])].length;
        propagatedCostRows += [...(c as unknown as unknown[])].length;
      }
    }
    const remaining = live ? plan.fills.length - linked : plan.fills.length;
    const result: HmdaRelinkResult = {
      source: HMDA_RELINK_SOURCE,
      partitionKey: options.partitionKey,
      year,
      live,
      dryRun,
      unlinked: plan.unlinked,
      wouldLink: plan.fills.length,
      linked,
      propagatedOriginationRows,
      propagatedCostRows,
      remaining,
      byBasis,
      kept: plan.kept,
      sample: plan.fills.filter((_, i) => i % Math.max(1, Math.floor(plan.fills.length / SAMPLE_SIZE)) === 0).slice(0, SAMPLE_SIZE),
    };
    if (dryRun) return result;
    // Off, the partition still records its count (the ledger row only), weekly, so the yes/no is
    // asked with today's number. A read-only transaction can't write it; record after.
    if (live) await recordRelink(tx, result, options.runId ?? null);
    return result;
  }).then(async (result) => {
    if (!dryRun && !result.live) await recordRelink(db, result, options.runId ?? null);
    return result;
  })) as HmdaRelinkResult;
}

async function recordRelink(db: RegistryDb, r: HmdaRelinkResult, runId: number | null): Promise<void> {
  await recordRegistryPartition(db, {
    source: HMDA_RELINK_SOURCE,
    partitionKey: r.partitionKey,
    status: "succeeded",
    rowCount: r.linked,
    matchedCount: r.linked,
    unmatchedCount: r.unlinked - r.wouldLink,
    insertedCount: 0,
    sourceUrl: null,
    runId,
    nextAttemptAfterHours: r.live && r.remaining > 0 ? MORE_HOURS : WEEKLY_HOURS,
    detail: {
      parser_version: HMDA_RELINK_PARSER_VERSION,
      relink: true,
      live: r.live,
      year: r.year,
      unlinked_lenders: r.unlinked,
      would_link: r.wouldLink,
      linked: r.linked,
      remaining: r.remaining,
      by_basis: r.byBasis,
      kept: r.kept,
      propagated_origination_rows: r.propagatedOriginationRows,
      propagated_cost_rows: r.propagatedCostRows,
      sample: r.sample,
    },
  });
}
