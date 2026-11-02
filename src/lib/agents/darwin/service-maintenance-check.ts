import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { SERVICE_MAINTENANCE_CATEGORY, serviceMaintenanceRead, type ServiceKind } from "@/lib/service-maintenance-heading";
import { storedLine } from "./rate-floor-check";
import { sourceLineFor } from "./verify";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of monthly maintenance fees read from a row under a service's heading
 * (#1092, state key 5608; decision 2026-10-15, "Darwin re-checks every live fee against today's
 * rules"). Knox v165 holds such a read for review and Darwin's verify refuses it
 * (`service_maintenance_heading`), both through `@/lib/service-maintenance-heading`; the ones read
 * before stay live. River City Bank's "Consumer Online Banking Services and Mobile Banking Fees" over
 * "Monthly Maintenance Fee | No charge" is the online banking service's fee: published as the
 * account's monthly maintenance, it tells readers the bank has free checking.
 *
 * Each verify step reads every live flat monthly maintenance fee (about 4,100 rows on Nov 1,
 * `service-monthly-charge.ts`), a page of `SERVICE_MAINTENANCE_LIMIT` at a time by fee id, then the text
 * Knox read (the artifact its note names) where that text prints a service's words at all (the SQL
 * prefilter). It stops after `SERVICE_MAINTENANCE_MAX_PAGES` pages and reports how many rows it left
 * unjudged (review of #2953). `serviceMaintenanceRead` decides, the test verify applies: Knox's row and
 * the line `checkFeeAgainstSource` traces the fee to (`sourceLineFor`, Darwin's own trace) must both sit
 * under a heading that names only services. A fee the shared check cannot trace is counted unconfirmed
 * and never taken down on Knox's row alone (review of #2953). A fee whose text is gone or prints no
 * service word is not judged. An admin-corrected fee is never read. An institution-scoped
 * run reads that institution's only. Switched on (`SERVICE_MAINTENANCE_TAKEDOWN_LIVE`), a match goes
 * through the shared 12-hour second look (check `darwin.service_maintenance_heading`) and is archived on
 * its second failure: rolled back with `service_maintenance_heading: <services>, "<heading>"`, its
 * verified row rejected with the `service_maintenance_heading` flag so publish does not bring it back,
 * never deleted, and a `darwin.service_maintenance_heading_takedown` event lists them. In a dry run, or
 * with the switch off (the default), it only reports. Count it with `npm run audit:switch-dry-runs`
 * (section 9) first.
 */
export const SERVICE_MAINTENANCE_CHECK = "darwin.service_maintenance_heading";
export const SERVICE_MAINTENANCE_CHECK_VERSION = 1;
/** The switch: off, the step only reports; on, matches come down after the second look. */
export const SERVICE_MAINTENANCE_TAKEDOWN_LIVE = false;
export const SERVICE_MAINTENANCE_REASON = "service_maintenance_heading";
export const SERVICE_MAINTENANCE_FLAG = "service_maintenance_heading";
/** Rows per page of the read. */
export const SERVICE_MAINTENANCE_LIMIT = 6_000;
/** Pages one step reads before it stops and reports the rest as unjudged. */
export const SERVICE_MAINTENANCE_MAX_PAGES = 10;
export const SERVICE_MAINTENANCE_SAMPLES = 20;
/** The most rows one read returns. */
export const SERVICE_MAINTENANCE_MAX_ROWS = 10_000;
/** Texts read per query, so one read never holds every candidate's text at once. */
const TEXT_CHUNK = 50;

/** Postgres pre-filter on the text Knox read: it prints at least one service's words somewhere. */
export const SERVICE_MAINTENANCE_TEXT_PREFILTER =
  String.raw`(on-?\s?line|mobile|internet|text)\s+banking|bill\s?pay|e-?\s?statement|electronic\s+statement|remote\s+deposit|zelle|treasury`;

export interface ServiceMaintenanceLiveRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  /** Knox's extraction note, whose excerpt is the stored line. */
  source_line: string | null;
  /** The artifact the note names: the text Knox read. */
  artifact_id: number | string | null;
}

export interface ServiceMaintenanceMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number;
  heading: string;
  services: ServiceKind[];
  sourceLine: string;
  tracedLine: string | null;
  reason: string;
}

export interface ServiceMaintenanceFindings {
  checked: number;
  /** Candidates whose text is gone, or prints no service word: not judged. */
  noText: number;
  /**
   * Knox's row sits under a service's heading but the shared check traces the fee to no line: unconfirmed,
   * never taken down on Knox's row alone (review of #2953).
   */
  unconfirmed: number;
  matched: number;
  institutions: number;
  /** Matches by price: $0 reads and priced reads. */
  free: number;
  priced: number;
  samples: ServiceMaintenanceMatch[];
}

export interface ServiceMaintenanceResult extends ServiceMaintenanceFindings {
  live: boolean;
  dryRun: boolean;
  scoped: boolean;
  /** Rows past the last page read: left unjudged this step. */
  unjudged: number;
  flagged: number;
  waiting: number;
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Pure: the matches among the rows the read selected, each judged on its own text (`texts`, by
 * artifact id) the way verify judges a new read: Knox's row and Darwin's traced line.
 */
export function findServiceMaintenance(
  rows: readonly ServiceMaintenanceLiveRow[],
  texts: ReadonlyMap<number, string>,
): ServiceMaintenanceFindings & { matches: ServiceMaintenanceMatch[] } {
  const matches: ServiceMaintenanceMatch[] = [];
  const seen = new Set<number>();
  let noText = 0;
  let unconfirmed = 0;
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const artifactId = num(row.artifact_id);
    const amount = num(row.amount);
    const text = artifactId == null ? undefined : texts.get(artifactId);
    if (!text || amount == null) {
      noText += 1;
      continue;
    }
    const name = (row.fee_name ?? "").trim();
    const line = row.source_line ? storedLine(row.source_line) : "";
    const tracedLine = sourceLineFor(
      { fee_name: name, amount, source_document_id: artifactId, amount_kind: "flat", rate_percent: null },
      new Map([[artifactId as number, text]]),
      SERVICE_MAINTENANCE_CATEGORY,
    );
    const found = serviceMaintenanceRead({ excerpt: line, tracedLine, canonicalFeeKey: SERVICE_MAINTENANCE_CATEGORY, documentText: text });
    if (!found) continue;
    if (!tracedLine) {
      unconfirmed += 1;
      continue;
    }
    matches.push({
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: name,
      amount,
      heading: found.heading,
      services: found.services,
      sourceLine: line.slice(0, 300),
      tracedLine: tracedLine ? tracedLine.slice(0, 300) : null,
      reason: `${SERVICE_MAINTENANCE_REASON}: ${found.services.join("+")}, "${found.heading.slice(0, 120)}"`,
    });
  }
  return {
    checked: seen.size,
    noText,
    unconfirmed,
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    free: matches.filter((fee) => fee.amount === 0).length,
    priced: matches.filter((fee) => fee.amount !== 0).length,
    samples: matches.slice(0, SERVICE_MAINTENANCE_SAMPLES),
    matches,
  };
}

/**
 * Read-only: every live flat monthly maintenance fee Knox read, with the artifact it read.
 * `institutionId` (the verify step's scope) or `institutionIds` (the switch dry-run audit's) narrow it.
 */
export function serviceMaintenanceRowsSql(db: SqlTag, options: { institutionId?: number; institutionIds?: readonly number[] | null; limit?: number; afterId?: number } = {}) {
  const ids = options.institutionId != null ? [options.institutionId] : options.institutionIds?.length ? [...options.institutionIds] : null;
  const scoped = ids != null;
  const limit = Math.max(1, Math.min(options.limit ?? SERVICE_MAINTENANCE_LIMIT, SERVICE_MAINTENANCE_MAX_ROWS));
  return db<ServiceMaintenanceLiveRow[]>`
    SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fr.fee_name, fp.amount,
           fr.extraction_note AS source_line,
           (substring(fr.extraction_note FROM 'artifact #([0-9]+)'))::bigint AS artifact_id
      FROM published_fee_records fp
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE fp.rolled_back_at IS NULL
       AND fp.quarantined_at IS NULL
       AND fp.amount_kind = 'flat'
       AND fp.amount IS NOT NULL
       AND fp.canonical_fee_key = ${SERVICE_MAINTENANCE_CATEGORY}
       AND fr.extraction_note LIKE '%excerpt=%'
       -- notAdminCorrectedSql("fp") (fee-correction-guard), written inline for the tagged template: never take down an admin-corrected fee.
       AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
       AND (${!scoped} OR fp.institution_id = ANY(${ids ?? [0]}::bigint[]))
       AND fp.fee_published_id > ${options.afterId ?? 0}
     ORDER BY fp.fee_published_id
     LIMIT ${limit}::int
  `;
}

/** Read-only: how many live flat monthly maintenance fees lie after `afterId`, the ones a read left unjudged. */
export async function serviceMaintenanceRemaining(db: SqlTag, options: { institutionId?: number; institutionIds?: readonly number[] | null; afterId: number }): Promise<number> {
  const ids = options.institutionId != null ? [options.institutionId] : options.institutionIds?.length ? [...options.institutionIds] : null;
  const [row] = await db<{ remaining: number | string }[]>`
    SELECT count(*) AS remaining
      FROM published_fee_records fp
     WHERE fp.rolled_back_at IS NULL
       AND fp.quarantined_at IS NULL
       AND fp.amount_kind = 'flat'
       AND fp.amount IS NOT NULL
       AND fp.canonical_fee_key = ${SERVICE_MAINTENANCE_CATEGORY}
       AND (${ids == null} OR fp.institution_id = ANY(${ids ?? [0]}::bigint[]))
       AND fp.fee_published_id > ${options.afterId}
  `;
  return Number(row?.remaining ?? 0);
}

/** Adds one page's findings to the running total (institutions are recounted from the matches). */
export function addServiceMaintenanceFindings(
  total: ServiceMaintenanceFindings & { matches: ServiceMaintenanceMatch[] },
  page: ServiceMaintenanceFindings & { matches: ServiceMaintenanceMatch[] },
): void {
  total.checked += page.checked;
  total.noText += page.noText;
  total.unconfirmed += page.unconfirmed;
  total.matched += page.matched;
  total.free += page.free;
  total.priced += page.priced;
  total.matches.push(...page.matches);
  total.institutions = new Set(total.matches.map((fee) => fee.institutionId)).size;
  total.samples = total.matches.slice(0, SERVICE_MAINTENANCE_SAMPLES);
}

export function emptyServiceMaintenanceFindings(): ServiceMaintenanceFindings & { matches: ServiceMaintenanceMatch[] } {
  return { checked: 0, noText: 0, unconfirmed: 0, matched: 0, institutions: 0, free: 0, priced: 0, samples: [], matches: [] };
}

/** Read-only: the texts Knox read, by artifact id, only where the text prints a service's words. */
export async function serviceMaintenanceTexts(db: SqlTag, artifactIds: readonly number[]): Promise<Map<number, string>> {
  const texts = new Map<number, string>();
  const ids = [...new Set(artifactIds)];
  for (let start = 0; start < ids.length; start += TEXT_CHUNK) {
    const chunk = ids.slice(start, start + TEXT_CHUNK);
    const rows = await db<{ id: number | string; normalized_text: string | null }[]>`
      SELECT id, normalized_text FROM agent_source_texts
       WHERE id = ANY(${chunk}::bigint[]) AND normalized_text IS NOT NULL
         AND normalized_text ~* ${SERVICE_MAINTENANCE_TEXT_PREFILTER}
    `;
    for (const row of rows) if (row.normalized_text) texts.set(Number(row.id), row.normalized_text);
  }
  return texts;
}

function emptyResult(live: boolean, dryRun: boolean, scoped: boolean): ServiceMaintenanceResult {
  return {
    live, dryRun, scoped, checked: 0, noText: 0, unconfirmed: 0, matched: 0, institutions: 0, free: 0, priced: 0,
    samples: [], unjudged: 0, flagged: 0, waiting: 0, takenDown: [],
  };
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckServiceMaintenance(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<ServiceMaintenanceResult> {
  const live = options.live ?? SERVICE_MAINTENANCE_TAKEDOWN_LIVE;
  const result = emptyResult(live, options.dryRun, options.institutionId != null);

  const total = emptyServiceMaintenanceFindings();
  const limit = Math.max(1, Math.min(options.limit ?? SERVICE_MAINTENANCE_LIMIT, SERVICE_MAINTENANCE_MAX_ROWS));
  try {
    let afterId = 0;
    for (let page = 0; ; page += 1) {
      if (page >= SERVICE_MAINTENANCE_MAX_PAGES) {
        const from = afterId;
        result.unjudged = await inSavepoint(db, (scope) => serviceMaintenanceRemaining(scope, { institutionId: options.institutionId, afterId: from }));
        break;
      }
      const from = afterId;
      const rows = await inSavepoint(db, (scope) => serviceMaintenanceRowsSql(scope, { institutionId: options.institutionId, limit, afterId: from }));
      if (rows.length === 0) break;
      const artifactIds = rows.map((row) => num(row.artifact_id)).filter((id): id is number => id != null);
      const texts = await inSavepoint(db, (scope) => serviceMaintenanceTexts(scope, artifactIds));
      addServiceMaintenanceFindings(total, findServiceMaintenance(rows, texts));
      afterId = Math.max(...rows.map((row) => Number(row.fee_published_id)));
      if (rows.length < limit) break;
    }
  } catch (error) {
    console.warn("[darwin] service maintenance heading check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = total;
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: SERVICE_MAINTENANCE_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  if (!options.dryRun && result.matched + result.unconfirmed + result.unjudged > 0) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${SERVICE_MAINTENANCE_CHECK}, 'completed',
          ${`Read live monthly maintenance fees under a service's heading: ${result.matched} of ${result.checked} live fee(s) at ${result.institutions} institution(s), ${result.unconfirmed} unconfirmed (untraced), ${result.unjudged} left unjudged; ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(serviceMaintenanceDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] service maintenance heading check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: ServiceMaintenanceMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-service-maintenance-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.canonical_fee_key = ${SERVICE_MAINTENANCE_CATEGORY}
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const verified = fees.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
      if (verified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${SERVICE_MAINTENANCE_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${SERVICE_MAINTENANCE_FLAG}::text)
                 END
           WHERE fv.fee_verified_id = ANY(${verified.map((fee) => fee.feeVerifiedId as number)}::bigint[])
             AND fv.review_status IN ('verified', 'approved')
        `;
      }
      return fees.filter((fee) => ids.has(fee.feePublishedId)).map((fee) => fee.feePublishedId);
    });
    if (closed.length > 0) invalidatePublicReadCache();
    return closed;
  } catch (error) {
    console.error("[darwin] service maintenance heading takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: ServiceMaintenanceMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.service_maintenance_heading_takedown', 'completed',
        ${`Archived ${archived.length} live monthly maintenance fee(s) read under a service's heading, on their second look`},
        ${JSON.stringify({ version: SERVICE_MAINTENANCE_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] service maintenance heading takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: ServiceMaintenanceMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    heading: fee.heading,
    services: fee.services,
    source_line: fee.sourceLine,
    traced_line: fee.tracedLine,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function serviceMaintenanceDetail(result: ServiceMaintenanceResult) {
  return {
    check: SERVICE_MAINTENANCE_CHECK,
    version: SERVICE_MAINTENANCE_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    checked: result.checked,
    no_text: result.noText,
    unconfirmed: result.unconfirmed,
    unjudged: result.unjudged,
    matched: result.matched,
    institutions: result.institutions,
    free: result.free,
    priced: result.priced,
    flagged: result.flagged,
    waiting: result.waiting,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
