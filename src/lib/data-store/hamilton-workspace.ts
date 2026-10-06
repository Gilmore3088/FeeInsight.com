/**
 * Hamilton workspace records: decisions, their event log and what the bank told Hamilton
 * (memory). Tables from migration 20270108000001; private to server routes.
 *
 * A memory fact is never edited in place: a new value supersedes the old row, so every
 * figure Hamilton used can be traced to who gave it and when.
 */

import { sql, withTransaction } from "./connection";
import type {
  DecisionEvent,
  DecisionEventKind,
  DecisionRecord,
  DecisionStatus,
  MemoryFact,
} from "@/lib/hamilton/workspace/types";

type Db = typeof sql;

let schemaReady: Promise<boolean> | null = null;

/** True once the workspace tables exist; checked once per process. */
export function workspaceSchemaReady(db: Db = sql): Promise<boolean> {
  schemaReady ??= (async () => {
    const [row] = (await db`
      SELECT to_regclass('public.hamilton_decisions') IS NOT NULL
         AND to_regclass('public.hamilton_decision_events') IS NOT NULL
         AND to_regclass('public.hamilton_institution_memory') IS NOT NULL AS ready
    `) as unknown as { ready: boolean }[];
    return Boolean(row?.ready);
  })().catch((error) => {
    schemaReady = null;
    console.error("[hamilton-workspace] schema check failed", error);
    return false;
  });
  return schemaReady;
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

interface MemoryRow {
  id: string;
  institution_id: number | string;
  field_key: string;
  value: unknown;
  given_by: string | null;
  source: MemoryFact["source"];
  created_at: Date | string;
}

function toFact(row: MemoryRow): MemoryFact {
  return {
    id: row.id,
    institutionId: Number(row.institution_id),
    fieldKey: row.field_key,
    value: row.value,
    givenBy: row.given_by,
    source: row.source,
    createdAt: iso(row.created_at),
  };
}

/** The bank's current facts (superseded rows left out), newest first. */
export async function getMemoryFacts(userId: number, institutionId: number, db: Db = sql): Promise<MemoryFact[]> {
  const rows = (await db`
    SELECT id, institution_id, field_key, value, given_by, source, created_at
      FROM hamilton_institution_memory
     WHERE user_id = ${userId} AND institution_id = ${institutionId} AND superseded_at IS NULL
     ORDER BY created_at DESC
  `) as unknown as MemoryRow[];
  return rows.map(toFact);
}

/** Saves a fact and supersedes the earlier value for the same key, in one transaction. */
export async function saveMemoryFact(input: {
  userId: number;
  institutionId: number;
  fieldKey: string;
  value: unknown;
  givenBy: string | null;
  source: MemoryFact["source"];
  uploadId?: string | null;
}): Promise<MemoryFact> {
  return withTransaction(async (tx) => {
    await tx`
      UPDATE hamilton_institution_memory
         SET superseded_at = NOW()
       WHERE user_id = ${input.userId} AND institution_id = ${input.institutionId}
         AND field_key = ${input.fieldKey} AND superseded_at IS NULL
    `;
    const [row] = (await tx`
      INSERT INTO hamilton_institution_memory (user_id, institution_id, field_key, value, given_by, source, upload_id)
      VALUES (${input.userId}, ${input.institutionId}, ${input.fieldKey}, ${JSON.stringify(input.value)}::jsonb,
              ${input.givenBy}, ${input.source}, ${input.uploadId ?? null})
      RETURNING id, institution_id, field_key, value, given_by, source, created_at
    `) as unknown as MemoryRow[];
    return toFact(row);
  });
}

interface DecisionRow {
  id: string;
  institution_id: number | string;
  fee_category: string | null;
  title: string;
  status: DecisionStatus;
  chosen_amount: number | string | null;
  chosen_by: string | null;
  watch_conditions: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

function toDecision(row: DecisionRow): DecisionRecord {
  return {
    id: row.id,
    institutionId: Number(row.institution_id),
    feeCategory: row.fee_category,
    title: row.title,
    status: row.status,
    chosenAmount: row.chosen_amount === null ? null : Number(row.chosen_amount),
    chosenBy: row.chosen_by,
    watchConditions: Array.isArray(row.watch_conditions) ? row.watch_conditions.map(String) : [],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function getDecision(userId: number, decisionId: string, db: Db = sql): Promise<DecisionRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(decisionId)) return null;
  const [row] = (await db`
    SELECT id, institution_id, fee_category, title, status, chosen_amount, chosen_by, watch_conditions, created_at, updated_at FROM hamilton_decisions WHERE id = ${decisionId} AND user_id = ${userId}
  `) as unknown as DecisionRow[];
  return row ? toDecision(row) : null;
}

/** The newest decision on this fee that is not closed, or a new one opened now. */
export async function findOrOpenDecision(input: {
  userId: number;
  institutionId: number;
  feeCategory: string;
  title: string;
  actor: string | null;
}): Promise<{ decision: DecisionRecord; opened: boolean }> {
  return withTransaction(async (tx) => {
    const [existing] = (await tx`
      SELECT id, institution_id, fee_category, title, status, chosen_amount, chosen_by, watch_conditions, created_at, updated_at FROM hamilton_decisions
       WHERE user_id = ${input.userId} AND institution_id = ${input.institutionId}
         AND fee_category = ${input.feeCategory} AND status <> 'closed'
       ORDER BY updated_at DESC
       LIMIT 1
    `) as unknown as DecisionRow[];
    if (existing) return { decision: toDecision(existing), opened: false };
    const [row] = (await tx`
      INSERT INTO hamilton_decisions (user_id, institution_id, fee_category, title)
      VALUES (${input.userId}, ${input.institutionId}, ${input.feeCategory}, ${input.title})
      RETURNING id, institution_id, fee_category, title, status, chosen_amount, chosen_by, watch_conditions, created_at, updated_at
    `) as unknown as DecisionRow[];
    await tx`
      INSERT INTO hamilton_decision_events (decision_id, kind, detail, actor)
      VALUES (${row.id}, 'opened', ${JSON.stringify({ feeCategory: input.feeCategory })}::jsonb, ${input.actor})
    `;
    return { decision: toDecision(row), opened: true };
  });
}

/** Appends events to a decision's log and touches its updated_at. */
export async function addDecisionEvents(
  decisionId: string,
  events: { kind: DecisionEventKind; detail: Record<string, unknown>; actor: string | null }[],
  status?: DecisionStatus,
): Promise<void> {
  if (events.length === 0 && !status) return;
  await withTransaction(async (tx) => {
    for (const e of events) {
      await tx`
        INSERT INTO hamilton_decision_events (decision_id, kind, detail, actor)
        VALUES (${decisionId}, ${e.kind}, ${JSON.stringify(e.detail)}::jsonb, ${e.actor})
      `;
    }
    if (status) {
      await tx`UPDATE hamilton_decisions SET status = ${status}, updated_at = NOW() WHERE id = ${decisionId} AND status <> ${status}`;
    }
    await tx`UPDATE hamilton_decisions SET updated_at = NOW() WHERE id = ${decisionId}`;
  });
}

interface EventRow {
  id: string;
  decision_id: string;
  kind: DecisionEventKind;
  detail: Record<string, unknown> | null;
  actor: string | null;
  at: Date | string;
}

export async function getDecisionEvents(decisionId: string, db: Db = sql): Promise<DecisionEvent[]> {
  const rows = (await db`
    SELECT id, decision_id, kind, detail, actor, at
      FROM hamilton_decision_events
     WHERE decision_id = ${decisionId}
     ORDER BY at, id
  `) as unknown as EventRow[];
  return rows.map((r) => ({ id: r.id, decisionId: r.decision_id, kind: r.kind, detail: r.detail ?? {}, actor: r.actor, at: iso(r.at) }));
}

/** Prices tested in a decision so far, oldest first, each once. */
export function testedPrices(events: DecisionEvent[]): number[] {
  const out: number[] = [];
  for (const e of events) {
    if (e.kind !== "scenario_tested") continue;
    const tested = Number(e.detail.tested);
    if (Number.isFinite(tested) && !out.includes(tested)) out.push(tested);
  }
  return out;
}

// ─── Uploads ─────────────────────────────────────────────────────────────────

export type UploadStatus = "received" | "mapped" | "applied" | "rejected";

export interface UploadRecord<P = unknown> {
  id: string;
  institutionId: number;
  fileName: string;
  status: UploadStatus;
  /** What Hamilton read from the file (the preview), kept so the reader can apply it later. */
  preview: P;
  createdAt: string;
}

interface UploadRow {
  id: string;
  institution_id: number | string;
  file_name: string;
  status: UploadStatus;
  column_map: unknown;
  created_at: Date | string;
}

function toUpload<P>(row: UploadRow): UploadRecord<P> {
  return {
    id: row.id,
    institutionId: Number(row.institution_id),
    fileName: row.file_name,
    status: row.status,
    preview: row.column_map as P,
    createdAt: iso(row.created_at),
  };
}

/** Records an upload and what was read from it. The file itself is not stored. */
export async function createUpload<P>(input: {
  userId: number;
  institutionId: number;
  fileName: string;
  contentType: string | null;
  byteSize: number;
  preview: P;
  status: UploadStatus;
}): Promise<UploadRecord<P>> {
  const [row] = (await sql`
    INSERT INTO hamilton_uploads (user_id, institution_id, file_name, content_type, byte_size, storage_key, column_map, status)
    VALUES (${input.userId}, ${input.institutionId}, ${input.fileName}, ${input.contentType}, ${input.byteSize}, NULL,
            ${JSON.stringify(input.preview)}::jsonb, ${input.status})
    RETURNING id, institution_id, file_name, status, column_map, created_at
  `) as unknown as UploadRow[];
  return toUpload<P>(row);
}

export async function getUpload<P>(userId: number, uploadId: string): Promise<UploadRecord<P> | null> {
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) return null;
  const [row] = (await sql`
    SELECT id, institution_id, file_name, status, column_map, created_at
      FROM hamilton_uploads WHERE id = ${uploadId} AND user_id = ${userId}
  `) as unknown as UploadRow[];
  return row ? toUpload<P>(row) : null;
}

export async function setUploadStatus(uploadId: string, status: UploadStatus): Promise<void> {
  await sql`UPDATE hamilton_uploads SET status = ${status} WHERE id = ${uploadId}`;
}
