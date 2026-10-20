/**
 * The audit history of operators' fee actions (H03-T08 to T10, #978), read for the admin audit
 * page and for the notice on saved Hamilton answers. Read-only: nothing here writes.
 *
 * - Corrections and reversals come from `published_fee_corrections` (every version, never edited
 *   except to mark one superseded).
 * - Holds and releases come from their `pipeline_feedback` rows (`admin.fee_hold`).
 * - Each action's refresh status is read from its run's events (`index.refresh`,
 *   `cache.invalidate`, and those of any retry run linked by `retry_of`), the national index's
 *   `computed_at`, and the live fee list itself (`fee-refresh-status.ts` decides).
 * - Saved outputs made before an action are counted by the fee rows they recorded
 *   (`hamilton_saved_output_fee_refs`); one that recorded none is counted by the institution it
 *   is about (`saved-output-corrections.ts` explains both matches).
 */

import type { sql as Sql } from "./connection";
import { correctionsReady } from "@/lib/fee-correction-guard";
import { FEE_HOLD_CHECK } from "@/lib/fee-hold-rules";
import type { FeeValues } from "@/lib/fee-correction-rules";
import { refreshStatus, rowsTouched, type AuditAction, type RefreshEvent, type RefreshStatus } from "@/lib/fee-refresh-status";
import type { AffectedSavedOutputs, FeeChangeSince, NoticeBasis } from "@/lib/saved-output-corrections";
import { feeRefsReady, readSavedOutputFeeRefs, type SavedOutputKind } from "./saved-output-fee-refs";

type SqlTag = typeof Sql;

export interface FeeAuditEntry {
  /** Unique across both sources: "correction:<id>" or "hold:<feedback id>". */
  key: string;
  action: AuditAction;
  at: string;
  institutionId: number;
  institutionName: string | null;
  feeName: string;
  /** The values before the change; for a hold or release, the fee's own values. */
  before: FeeValues | null;
  /** The values after a correction or reversal; null for a hold or release. */
  after: FeeValues | null;
  reason: string | null;
  actorName: string | null;
  sourceDocumentId: number | null;
  sourceExcerpt: string | null;
  sourceLocation: string | null;
  runId: number | null;
  /** The published row the action took out, and the one it made live. */
  previousFeePublishedId: number | null;
  feePublishedId: number | null;
  version: number | null;
  /** Where the change stands now, in a few words. */
  publication: string;
  /** Null when the action has no run to read (a row written before runs were recorded). */
  refresh: RefreshStatus | null;
  savedOutputs: AffectedSavedOutputs | null;
}

export const AUDIT_PAGE_LIMIT = 100;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

interface CorrectionRow {
  id: number | string;
  created_at: Date | string;
  action: "correct" | "reverse";
  status: "current" | "superseded";
  version: number | string;
  institution_id: number | string;
  institution_name: string | null;
  previous_fee_published_id: number | string;
  fee_published_id: number | string;
  before_canonical_fee_key: string;
  before_fee_name: string;
  before_amount: number | string | null;
  before_frequency: string | null;
  before_conditions: string | null;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string;
  frequency: string | null;
  conditions: string | null;
  source_document_id: number | string | null;
  source_excerpt: string | null;
  source_location: string | null;
  reason: string;
  actor_name: string;
  agent_run_id: number | string | null;
}

interface HoldRow {
  id: number | string;
  created_at: Date | string;
  kind: "admin_hold" | "admin_release";
  institution_id: number | string;
  institution_name: string | null;
  fee_published_id: number | string | null;
  canonical_fee_key: string | null;
  amount: number | string | null;
  fee_name: string | null;
  actor_name: string | null;
  reason: string | null;
  agent_run_id: number | string | null;
}

/** An entry as read, before its current state is added. `status` is a correction version's. */
export type FeeAuditBase = Omit<FeeAuditEntry, "publication" | "refresh" | "savedOutputs"> & { status?: "current" | "superseded" };
type Base = FeeAuditBase;

async function readCorrections(db: SqlTag, institutionId: number | null, limit: number): Promise<Base[]> {
  if (!(await correctionsReady(db))) return [];
  const rows = await db<CorrectionRow[]>`
    SELECT c.id, c.created_at, c.action, c.status, c.version, c.institution_id, i.institution_name,
           c.previous_fee_published_id, c.fee_published_id,
           c.before_canonical_fee_key, c.before_fee_name, c.before_amount, c.before_frequency, c.before_conditions,
           c.canonical_fee_key, c.fee_name, c.amount, c.frequency, c.conditions,
           c.source_document_id, c.source_excerpt, c.source_location, c.reason, c.actor_name, c.agent_run_id
      FROM published_fee_corrections c
      LEFT JOIN institution_sources i ON i.id = c.institution_id
     WHERE (${institutionId}::bigint IS NULL OR c.institution_id = ${institutionId}::bigint)
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT ${limit}
  `;
  return rows.map((row) => ({
    key: `correction:${row.id}`,
    action: row.action,
    at: iso(row.created_at),
    institutionId: Number(row.institution_id),
    institutionName: row.institution_name,
    feeName: row.fee_name,
    before: {
      canonicalFeeKey: row.before_canonical_fee_key,
      feeName: row.before_fee_name,
      amount: num(row.before_amount),
      frequency: row.before_frequency,
      conditions: row.before_conditions,
    },
    after: {
      canonicalFeeKey: row.canonical_fee_key,
      feeName: row.fee_name,
      amount: num(row.amount),
      frequency: row.frequency,
      conditions: row.conditions,
    },
    reason: row.reason,
    actorName: row.actor_name,
    sourceDocumentId: num(row.source_document_id),
    sourceExcerpt: row.source_excerpt,
    sourceLocation: row.source_location,
    runId: num(row.agent_run_id),
    previousFeePublishedId: num(row.previous_fee_published_id),
    feePublishedId: num(row.fee_published_id),
    version: num(row.version),
    status: row.status,
  }));
}

async function readHolds(db: SqlTag, institutionId: number | null, limit: number): Promise<Base[]> {
  const rows = await db<HoldRow[]>`
    SELECT pf.id, pf.created_at, pf.kind, pf.institution_id, i.institution_name, pf.fee_published_id,
           pf.canonical_fee_key, pf.amount, pf.evidence->>'fee_name' AS fee_name,
           pf.evidence->>'actor' AS actor_name, pf.evidence->>'reason' AS reason, pf.agent_run_id
      FROM pipeline_feedback pf
      LEFT JOIN institution_sources i ON i.id = pf.institution_id
     WHERE pf.check_name = ${FEE_HOLD_CHECK}
       AND pf.kind IN ('admin_hold', 'admin_release')
       AND (${institutionId}::bigint IS NULL OR pf.institution_id = ${institutionId}::bigint)
     ORDER BY pf.created_at DESC, pf.id DESC
     LIMIT ${limit}
  `;
  return rows.map((row) => {
    const feeId = num(row.fee_published_id);
    const values: FeeValues = {
      canonicalFeeKey: row.canonical_fee_key ?? "",
      feeName: row.fee_name ?? "",
      amount: num(row.amount),
      frequency: null,
      conditions: null,
    };
    return {
      key: `hold:${row.id}`,
      action: row.kind === "admin_hold" ? "hold" : "release",
      at: iso(row.created_at),
      institutionId: Number(row.institution_id),
      institutionName: row.institution_name,
      feeName: row.fee_name ?? "",
      before: values,
      after: null,
      reason: row.reason,
      actorName: row.actor_name,
      sourceDocumentId: null,
      sourceExcerpt: null,
      sourceLocation: null,
      runId: num(row.agent_run_id),
      previousFeePublishedId: null,
      feePublishedId: feeId,
      version: null,
    };
  });
}

export interface RowState {
  live: boolean;
  listed: boolean;
}

async function readRowStates(db: SqlTag, ids: number[]): Promise<Map<number, RowState>> {
  const states = new Map<number, RowState>();
  if (ids.length === 0) return states;
  const rows = await db<{ fee_published_id: number | string; live: boolean; listed: boolean }[]>`
    SELECT fp.fee_published_id,
           (fp.quarantined_at IS NULL AND fp.rolled_back_at IS NULL) AS live,
           EXISTS (SELECT 1 FROM published_fee_catalog c WHERE c.fee_published_id = fp.fee_published_id) AS listed
      FROM published_fee_records fp
     WHERE fp.fee_published_id = ANY(${ids}::bigint[])
  `;
  for (const row of rows) states.set(Number(row.fee_published_id), { live: row.live === true, listed: row.listed === true });
  return states;
}

async function readRefreshEvents(db: SqlTag, runIds: number[]): Promise<Map<number, RefreshEvent[]>> {
  const byRun = new Map<number, RefreshEvent[]>();
  if (runIds.length === 0) return byRun;
  // A retry run carries `retry_of` in its params; its events count for the run it retried.
  const rows = await db<{ run_id: number | string; event_type: string; status: string; created_at: Date | string }[]>`
    SELECT COALESCE(NULLIF(r.params_json->>'retry_of', '')::int, e.agent_run_id) AS run_id,
           e.event_type, e.status, e.created_at
      FROM agent_run_events e
      JOIN agent_runs r ON r.id = e.agent_run_id
     WHERE e.event_type IN ('index.refresh', 'cache.invalidate')
       AND (e.agent_run_id = ANY(${runIds}::int[])
            OR (r.run_kind = 'manual_repair' AND r.current_stage = 'admin.fee_refresh'
                AND NULLIF(r.params_json->>'retry_of', '')::int = ANY(${runIds}::int[])))
  `;
  for (const row of rows) {
    const runId = Number(row.run_id);
    const list = byRun.get(runId) ?? [];
    list.push({ eventType: row.event_type, status: row.status, createdAt: iso(row.created_at) });
    byRun.set(runId, list);
  }
  return byRun;
}

async function readIndexComputedAt(db: SqlTag): Promise<string | null> {
  try {
    const [row] = await db<{ computed_at: Date | string | null }[]>`SELECT MAX(computed_at) AS computed_at FROM fee_index_cache`;
    return row?.computed_at ? iso(row.computed_at) : null;
  } catch {
    return null;
  }
}

/** The fee row an action changed for saved outputs: the row a correction or reversal took out, or the held/released row. */
export function affectedFeeId(entry: Pick<FeeAuditBase, "action" | "previousFeePublishedId" | "feePublishedId">): number | null {
  return entry.action === "correct" || entry.action === "reverse" ? entry.previousFeePublishedId : entry.feePublishedId;
}

interface SavedOutputKey {
  key: string;
  institutionId: number;
  at: string;
  /** The fee row the action changed; null when unknown. */
  fee: number | null;
  /** A release brings a fee back, so no saved output can name it: match by institution too. */
  byInstitution: boolean;
}

/**
 * Counts saved outputs made before each action that it affects: those that recorded the changed
 * fee row, and those that recorded no fee rows and are about the action's institution (older
 * outputs). Before the fee-rows table exists, every output is matched by institution. A table
 * that cannot be read gives null.
 */
async function readSavedOutputCounts(db: SqlTag, keys: SavedOutputKey[]): Promise<Map<string, AffectedSavedOutputs>> {
  const out = new Map<string, AffectedSavedOutputs>();
  for (const k of keys) out.set(k.key, { analyses: null, reports: null, briefings: null });
  if (keys.length === 0) return out;
  const payload = JSON.stringify(keys.map((k) => ({ key: k.key, inst: k.institutionId, at: k.at, fee: k.fee, inst_match: k.byInstitution })));
  const count = async (field: keyof AffectedSavedOutputs, run: () => Promise<{ key: string; n: number | string }[]>) => {
    try {
      for (const row of await run()) {
        const entry = out.get(row.key);
        if (entry) entry[field] = Number(row.n);
      }
    } catch {
      // The table is absent or unreadable here: the count stays unknown rather than zero.
    }
  };
  let withRefs = false;
  try {
    withRefs = await feeRefsReady(db);
  } catch {
    withRefs = false;
  }
  if (withRefs) {
    await count("analyses", () => db<{ key: string; n: number }[]>`
      SELECT k.key, (SELECT COUNT(*) FROM hamilton_saved_analyses a
                      LEFT JOIN hamilton_saved_output_fee_refs r ON r.output_kind = 'analysis' AND r.output_id = a.id::text
                      WHERE a.status = 'active' AND a.created_at < k.at
                        AND ((r.output_id IS NOT NULL AND k.fee IS NOT NULL AND r.fee_published_ids @> ARRAY[k.fee])
                             OR ((r.output_id IS NULL OR k.inst_match) AND a.institution_id = k.inst::text)))::int AS n
        FROM jsonb_to_recordset(${payload}::jsonb) AS k(key text, inst bigint, at timestamptz, fee bigint, inst_match boolean)
    `);
    await count("reports", () => db<{ key: string; n: number }[]>`
      SELECT k.key, (SELECT COUNT(*) FROM hamilton_reports rp
                      LEFT JOIN hamilton_saved_output_fee_refs r ON r.output_kind = 'report' AND r.output_id = rp.id::text
                      WHERE rp.created_at < k.at
                        AND ((r.output_id IS NOT NULL AND k.fee IS NOT NULL AND r.fee_published_ids @> ARRAY[k.fee])
                             OR ((r.output_id IS NULL OR k.inst_match) AND rp.institution_id = k.inst::text)))::int AS n
        FROM jsonb_to_recordset(${payload}::jsonb) AS k(key text, inst bigint, at timestamptz, fee bigint, inst_match boolean)
    `);
  } else {
    await count("analyses", () => db<{ key: string; n: number }[]>`
      SELECT k.key, (SELECT COUNT(*) FROM hamilton_saved_analyses a
                      WHERE a.institution_id = k.inst::text AND a.status = 'active' AND a.created_at < k.at)::int AS n
        FROM jsonb_to_recordset(${payload}::jsonb) AS k(key text, inst bigint, at timestamptz)
    `);
    await count("reports", () => db<{ key: string; n: number }[]>`
      SELECT k.key, (SELECT COUNT(*) FROM hamilton_reports r
                      WHERE r.institution_id = k.inst::text AND r.created_at < k.at)::int AS n
        FROM jsonb_to_recordset(${payload}::jsonb) AS k(key text, inst bigint, at timestamptz)
    `);
  }
  // Briefings record no fee rows yet (their positions carry no row ids): matched by institution.
  await count("briefings", () => db<{ key: string; n: number }[]>`
    SELECT k.key, (SELECT COUNT(*) FROM hamilton_briefing_snapshots b
                    WHERE b.institution_id = k.inst AND b.created_at < k.at)::int AS n
      FROM jsonb_to_recordset(${payload}::jsonb) AS k(key text, inst bigint, at timestamptz)
  `);
  return out;
}

/** Where the change stands now, from the rows' current state. Pure. */
export function publicationLabel(entry: Base, states: Map<number, RowState>): string {
  const state = (id: number | null) => (id == null ? undefined : states.get(id));
  switch (entry.action) {
    case "hold":
      return state(entry.feePublishedId)?.live ? "Released since" : "Held";
    case "release":
      return state(entry.feePublishedId)?.live ? "Live" : "Taken down again since";
    case "correct":
    case "reverse": {
      if (entry.status === "superseded") return "Superseded by a later version";
      return state(entry.feePublishedId)?.live ? "Current version, live" : "Current version, taken down since";
    }
  }
}

/**
 * Every operator fee action, newest first, with its refresh status and the saved outputs made
 * before it. `institutionId` narrows it to one institution.
 */
export async function listFeeAuditEntries(
  db: SqlTag,
  options: { institutionId?: number | null; limit?: number; now?: Date } = {},
): Promise<FeeAuditEntry[]> {
  const limit = Math.min(Math.max(1, options.limit ?? AUDIT_PAGE_LIMIT), AUDIT_PAGE_LIMIT);
  const institutionId = options.institutionId ?? null;
  const [corrections, holds] = await Promise.all([
    readCorrections(db, institutionId, limit),
    readHolds(db, institutionId, limit),
  ]);
  const entries = [...corrections, ...holds]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.key.localeCompare(b.key)))
    .slice(0, limit);

  const feeIds = new Set<number>();
  const runIds = new Set<number>();
  for (const entry of entries) {
    if (entry.feePublishedId != null) feeIds.add(entry.feePublishedId);
    if (entry.previousFeePublishedId != null) feeIds.add(entry.previousFeePublishedId);
    if (entry.runId != null) runIds.add(entry.runId);
  }
  const [states, events, indexComputedAt, saved] = await Promise.all([
    readRowStates(db, [...feeIds]),
    readRefreshEvents(db, [...runIds]),
    readIndexComputedAt(db),
    readSavedOutputCounts(db, entries.map((entry) => ({
      key: entry.key,
      institutionId: entry.institutionId,
      at: entry.at,
      fee: affectedFeeId(entry),
      byInstitution: entry.action === "release",
    }))),
  ]);

  return entries.map((entry) => {
    const { status: _status, ...rest } = entry;
    void _status;
    const touched = rowsTouched(entry.action, entry.previousFeePublishedId, entry.feePublishedId);
    const removed = touched.removed == null ? undefined : states.get(touched.removed);
    const added = touched.added == null ? undefined : states.get(touched.added);
    const refresh = entry.runId == null
      ? null
      : refreshStatus({
          action: entry.action,
          actionAt: entry.at,
          events: events.get(entry.runId) ?? [],
          indexComputedAt,
          catalog: {
            removedStillListed: touched.removed == null ? null : removed?.listed ?? false,
            addedListed: touched.added == null ? null : added?.listed ?? false,
            addedStillLive: touched.added == null ? null : added?.live ?? false,
          },
          now: options.now,
        });
    return { ...rest, publication: publicationLabel(entry, states), refresh, savedOutputs: saved.get(entry.key) ?? null };
  });
}

/**
 * Operators' fee changes for one institution after a time, for the notice on a saved output
 * (H03-T09). Read-only; a failed read gives no changes, so a saved answer still opens.
 */
export async function getFeeChangesSince(db: SqlTag, institutionId: number, since: string): Promise<FeeChangeSince[]> {
  const changes: FeeChangeSince[] = [];
  try {
    if (await correctionsReady(db)) {
      const rows = await db<{ action: "correct" | "reverse"; created_at: Date | string }[]>`
        SELECT action, created_at FROM published_fee_corrections
         WHERE institution_id = ${institutionId} AND created_at > ${since}::timestamptz
         ORDER BY created_at DESC LIMIT 200
      `;
      for (const row of rows) changes.push({ kind: row.action, at: iso(row.created_at) });
    }
    const holds = await db<{ kind: string; created_at: Date | string }[]>`
      SELECT kind, created_at FROM pipeline_feedback
       WHERE check_name = ${FEE_HOLD_CHECK} AND kind IN ('admin_hold', 'admin_release')
         AND institution_id = ${institutionId} AND created_at > ${since}::timestamptz
       ORDER BY created_at DESC LIMIT 200
    `;
    for (const row of holds) changes.push({ kind: row.kind === "admin_hold" ? "hold" : "release", at: iso(row.created_at) });
  } catch (error) {
    console.error("[fee-correction-audit] fee changes since a saved output could not be read", { institutionId, error });
    return [];
  }
  return changes;
}

/**
 * Operators' changes to the fee rows a saved output used, after a time (H03-T09): every version
 * in the correction chain of a used row, and holds and releases of a used row, plus releases at
 * the output's own institution (a fee brought back is one the output could not have named).
 * Read-only; a failed read gives no changes, so a saved output still opens.
 */
export async function getFeeChangesForFees(
  db: SqlTag,
  feeIds: number[],
  institutionId: number | null,
  since: string,
): Promise<FeeChangeSince[]> {
  const ids = [...new Set(feeIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (ids.length === 0 && institutionId == null) return [];
  const changes: FeeChangeSince[] = [];
  try {
    if (ids.length > 0 && (await correctionsReady(db))) {
      const rows = await db<{ action: "correct" | "reverse"; created_at: Date | string }[]>`
        SELECT c.action, c.created_at FROM published_fee_corrections c
         WHERE c.fee_chain_id IN (
                 SELECT fee_chain_id FROM published_fee_corrections
                  WHERE previous_fee_published_id = ANY(${ids}::bigint[]) OR fee_published_id = ANY(${ids}::bigint[]))
           AND c.created_at > ${since}::timestamptz
         ORDER BY c.created_at DESC LIMIT 200
      `;
      for (const row of rows) changes.push({ kind: row.action, at: iso(row.created_at) });
    }
    const holds = await db<{ kind: string; created_at: Date | string }[]>`
      SELECT kind, created_at FROM pipeline_feedback
       WHERE check_name = ${FEE_HOLD_CHECK} AND kind IN ('admin_hold', 'admin_release')
         AND created_at > ${since}::timestamptz
         AND (fee_published_id = ANY(${ids}::bigint[])
              OR (kind = 'admin_release' AND ${institutionId}::bigint IS NOT NULL AND institution_id = ${institutionId}::bigint))
       ORDER BY created_at DESC LIMIT 200
    `;
    for (const row of holds) changes.push({ kind: row.kind === "admin_hold" ? "hold" : "release", at: iso(row.created_at) });
  } catch (error) {
    console.error("[fee-correction-audit] fee changes since a saved output could not be read", { feeIds: ids.length, error });
    return [];
  }
  return changes;
}

/**
 * The fee changes behind a saved output's notice: by the fee rows it recorded when it has them,
 * otherwise by the institution it is about. Read-only and never throws.
 */
export async function getSavedOutputChanges(
  db: SqlTag,
  output: { kind: SavedOutputKind; id: string; institutionId: number | null; savedAt: string },
): Promise<{ basis: NoticeBasis; changes: FeeChangeSince[] }> {
  const refs = await readSavedOutputFeeRefs(db, output.kind, output.id);
  if (refs && refs.length > 0) {
    return {
      basis: "fees",
      changes: await getFeeChangesForFees(db, refs.map((ref) => ref.feePublishedId), output.institutionId, output.savedAt),
    };
  }
  if (output.institutionId == null) return { basis: "institution", changes: [] };
  return { basis: "institution", changes: await getFeeChangesSince(db, output.institutionId, output.savedAt) };
}
