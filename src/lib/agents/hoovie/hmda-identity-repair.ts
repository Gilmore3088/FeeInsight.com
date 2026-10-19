import { sql } from "@/lib/data-store/connection";
import type { RegistryDb } from "@/lib/agents/magellan/registry/partitions";
import { lockHmdaYear } from "@/lib/agents/magellan/registry/hmda-lock";
import { matchHmdaIdentities, normalizeHmdaRssd, type HmdaInstitutionIdentity, type HmdaIdentityMatch } from "@/lib/regulatory/hmda-identity";
import { readFdicIdentityHolds, lockFdicIdentityHolds } from "@/lib/data-store/fdic-identity-holds";
import { HMDA_REPAIR_MANIFEST, HMDA_REPAIR_MANIFEST_DIGEST, hashHmdaJson } from "./hmda-repair-manifest";
import { HMDA_REPAIR_WRITES_ENABLED } from "./hmda-repair-release";
import { readHmdaRepairSource, type HmdaRepairSource } from "./hmda-repair-source";

export { HMDA_REPAIR_MANIFEST_DIGEST } from "./hmda-repair-manifest";
export const HMDA_IDENTITY_REPAIR_STEP_KEY = "hmda-identity-repair";
export const HMDA_IDENTITY_REPAIR_SOURCE = "hoovie.hmda-identity-repair";
const APPLIED = "hmda.identity_repair.applied";
const ROLLED_BACK = "hmda.identity_repair.rolled_back";
type JsonRow = Record<string, unknown>;
export interface HmdaRepairSnapshot { institutions: JsonRow[]; lenders: JsonRow[]; originations: JsonRow[]; costs: JsonRow[] }
export interface HmdaRepairParams {
  source: typeof HMDA_IDENTITY_REPAIR_SOURCE;
  mode: "preview" | "apply" | "rollback";
  manifest_digest: string;
  authorization_reference?: string;
  apply_event_id?: number;
}
interface Receipt {
  schema_version: number;
  manifest_digest: string;
  mode: "apply" | "rollback";
  source_sha256: string;
  before: HmdaRepairSnapshot;
  after: HmdaRepairSnapshot;
  postimage_hash: string;
  counts: typeof HMDA_REPAIR_MANIFEST.fixedBounds;
  authorization_reference: string;
  apply_event_id?: number;
}

export function parseHmdaRepairParams(value: unknown): HmdaRepairParams {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid HMDA repair parameters");
  const p = value as Record<string, unknown>;
  const allowed = new Set(["source", "mode", "manifest_digest", "authorization_reference", "apply_event_id", "ledger_agent_fallback"]);
  if (Object.keys(p).some((key) => !allowed.has(key)) || p.source !== HMDA_IDENTITY_REPAIR_SOURCE
    || typeof p.mode !== "string" || !["preview", "apply", "rollback"].includes(p.mode) || p.manifest_digest !== HMDA_REPAIR_MANIFEST_DIGEST) {
    throw new Error("HMDA repair requires the exact server-owned manifest and mode");
  }
  if ((p.mode !== "preview" || p.authorization_reference !== undefined)
    && (typeof p.authorization_reference !== "string" || !p.authorization_reference.trim() || p.authorization_reference.length > 200)) {
    throw new Error("HMDA repair requires an explicit authorization reference");
  }
  if (p.mode === "rollback" && (!Number.isSafeInteger(p.apply_event_id) || Number(p.apply_event_id) < 1)) throw new Error("Rollback requires its apply receipt ID");
  if (p.mode !== "rollback" && p.apply_event_id !== undefined) throw new Error("Apply receipt ID is only valid for rollback");
  return { source: HMDA_IDENTITY_REPAIR_SOURCE, mode: p.mode as HmdaRepairParams["mode"], manifest_digest: HMDA_REPAIR_MANIFEST_DIGEST,
    ...(p.authorization_reference !== undefined ? { authorization_reference: String(p.authorization_reference).trim() } : {}),
    ...(p.apply_event_id !== undefined ? { apply_event_id: Number(p.apply_event_id) } : {}) };
}

/** Raw database JSON retains NUMERIC and microsecond timestamp facts used by the review. */
async function snapshot(tx: RegistryDb): Promise<HmdaRepairSnapshot> {
  const ids = HMDA_REPAIR_MANIFEST.guards.institutions.ids;
  const leis = HMDA_REPAIR_MANIFEST.cohort.map((row) => row.lei);
  const year = HMDA_REPAIR_MANIFEST.year;
  const institutions = await tx`SELECT to_jsonb(s) AS row FROM institution_sources s WHERE s.id IN ${tx(ids)} ORDER BY s.id`;
  const lenders = await tx`SELECT to_jsonb(l) AS row FROM hmda_lenders l WHERE l.activity_year=${year} AND l.lei IN ${tx(leis)} ORDER BY l.lei`;
  // Select the complete annual LEI scope, not just reviewed IDs: extra/new states must abort.
  const originations = await tx`SELECT to_jsonb(c) AS row FROM hmda_lender_originations c WHERE c.activity_year=${year} AND c.lei IN ${tx(leis)} ORDER BY c.id LIMIT ${HMDA_REPAIR_MANIFEST.guards.originations.rows + 1}`;
  const costs = await tx`SELECT to_jsonb(c) AS row FROM hmda_lender_loan_costs c WHERE c.activity_year=${year} AND c.lei IN ${tx(leis)} ORDER BY c.id LIMIT ${HMDA_REPAIR_MANIFEST.guards.costs.rows + 1}`;
  const rows = (result: unknown) => [...result as Array<{ row: JsonRow }>].map(({ row }) => row);
  return { institutions: rows(institutions), lenders: rows(lenders), originations: rows(originations), costs: rows(costs) };
}

function verifyBefore(before: HmdaRepairSnapshot): void {
  for (const table of ["institutions", "lenders", "originations", "costs"] as const) {
    const guard = HMDA_REPAIR_MANIFEST.guards[table];
    if (before[table].length !== guard.rows || hashHmdaJson(before[table]) !== guard.sha256) throw new Error(`HMDA repair ${table} preimage/rowset drift: refresh review`);
  }
  if (before.institutions.some((row) => row.lei !== null) || before.lenders.some((row) => row.institution_id !== null || row.match_method !== null)
    || [...before.originations, ...before.costs].some((row) => row.institution_id !== null)) throw new Error("HMDA initial-link repair requires null reviewed identities");
}

async function identities(tx: RegistryDb): Promise<HmdaInstitutionIdentity[]> {
  const rows = await tx`SELECT jsonb_build_object('id',s.id,'lei',s.lei,'rssdId',s.rssd_id,'source',s.source,
      'certNumber',s.cert_number,'registrySyncedAt',s.registry_synced_at,
      'leiLink',CASE WHEN l.institution_id IS NULL THEN NULL ELSE jsonb_build_object('status',l.status,'lei',l.lei,
      'basis',l.match_basis,'candidates',l.candidate_leis,'sourceUrl',l.source_url,'checkedAt',l.checked_at,'matchKey',l.match_key) END) AS row
    FROM institution_sources s LEFT JOIN institution_lei_links l ON l.institution_id=s.id ORDER BY s.id LIMIT 20001`;
  if (rows.length > 20_000) throw new Error("HMDA reference registry exceeds reviewed read bound");
  return [...rows as unknown as Array<{ row: HmdaInstitutionIdentity }>].map(({ row }) => row);
}

function verifySource(source: HmdaRepairSource, before: HmdaRepairSnapshot): void {
  if (source.sha256 !== HMDA_REPAIR_MANIFEST.sourceSha256 || source.url !== HMDA_REPAIR_MANIFEST.sourceUrl) throw new Error("HMDA repair source digest drift");
  for (const row of HMDA_REPAIR_MANIFEST.cohort) {
    const owners = source.identities.filter((item) => item.lei === row.lei);
    const sameCert = source.identities.filter((item) => item.certificate === row.certificate);
    const canonical = before.institutions.find((item) => Number(item.id) === row.institutionId);
    if (new Set(owners.map((item) => item.certificate)).size !== 1 || owners[0]?.certificate !== row.certificate
      || sameCert.length !== 1 || sameCert[0].lei !== row.lei || canonical?.source !== "fdic" || canonical.cert_number !== row.certificate
      || normalizeHmdaRssd(canonical.rssd_id) !== sameCert[0].rssdId || sameCert[0].rssdId !== row.sourceRssd) {
      throw new Error(`HMDA repair source ownership/identifier conflict: ${row.lei}`);
    }
  }
}

async function proposedMatches(tx: RegistryDb, before: HmdaRepairSnapshot): Promise<HmdaIdentityMatch[]> {
  const canonical = (await identities(tx)).map((row) => {
    const proposal = HMDA_REPAIR_MANIFEST.cohort.find((item) => item.institutionId === row.id);
    return proposal ? { ...row, lei: proposal.lei } : row;
  });
  const matches = matchHmdaIdentities(before.lenders.map((row) => ({ lei: String(row.lei), rssdId: row.rssd_id == null ? null : String(row.rssd_id) })), canonical, await readFdicIdentityHolds(tx));
  if (matches.length !== HMDA_REPAIR_MANIFEST.fixedBounds.annualLenders || matches.some((row) => row.status !== "matched" || row.method !== "lei"
    || row.institutionId !== HMDA_REPAIR_MANIFEST.cohort.find((item) => item.lei === row.lei)?.institutionId)) throw new Error("HMDA repair matching result differs from review");
  return matches;
}

async function lockLedger(tx: RegistryDb, runId: number, stepId: number, params: HmdaRepairParams): Promise<void> {
  const rows = await tx`SELECT r.status AS run_status,r.params_json,r.cancel_requested_at,r.trigger_source,r.run_kind,r.triggered_by,
    s.status AS step_status,s.step_key,s.input_payload
    FROM agent_runs r JOIN agent_run_steps s ON s.agent_run_id=r.id
    WHERE r.id=${runId} AND s.id=${stepId} FOR UPDATE OF r,s`;
  const row = rows[0];
  if (!row || row.run_status !== "running" || row.cancel_requested_at != null || row.step_status !== "running" || row.step_key !== HMDA_IDENTITY_REPAIR_STEP_KEY
    || row.trigger_source !== "admin" || row.run_kind !== "manual_repair" || !/^admin:[1-9]\d*$/.test(String(row.triggered_by))
    || hashHmdaJson(parseHmdaRepairParams(row.params_json)) !== hashHmdaJson(params)
    || hashHmdaJson(parseHmdaRepairParams(row.input_payload)) !== hashHmdaJson(params)) throw new Error("HMDA repair run/step is not its authorized running ledger owner");
}

async function priorReceipt(db: RegistryDb, runId: number, type: string): Promise<{ id: number; receipt: Receipt } | null> {
  const rows = await db`SELECT id,detail FROM agent_run_events WHERE agent_run_id=${runId} AND event_type=${type} ORDER BY id LIMIT 2`;
  if (rows.length > 1) throw new Error("HMDA repair has conflicting commit receipts");
  return rows[0] ? { id: Number(rows[0].id), receipt: rows[0].detail as Receipt } : null;
}

function verifyReceipt(receipt: Receipt): void {
  if (receipt.schema_version !== 1 || receipt.manifest_digest !== HMDA_REPAIR_MANIFEST_DIGEST || receipt.source_sha256 !== HMDA_REPAIR_MANIFEST.sourceSha256
    || hashHmdaJson(receipt.counts) !== hashHmdaJson(HMDA_REPAIR_MANIFEST.fixedBounds) || hashHmdaJson(receipt.after) !== receipt.postimage_hash) throw new Error("Invalid HMDA repair commit receipt");
  verifyBefore(receipt.mode === "apply" ? receipt.before : receipt.after);
}

function assertKeys(actual: unknown, expected: number[], table: string): void {
  const ids = [...actual as Array<{ id: number | string }>].map((r) => Number(r.id)).sort((a, b) => a - b);
  if (hashHmdaJson(ids) !== hashHmdaJson([...expected].sort((a, b) => a - b))) throw new Error(`Unexpected HMDA repair ${table} write set`);
}

function targetSnapshot(before: HmdaRepairSnapshot, matches: HmdaIdentityMatch[], runId: number): HmdaRepairSnapshot {
  const proposal = (lei: unknown) => HMDA_REPAIR_MANIFEST.cohort.find((item) => item.lei === lei)!;
  return {
    institutions: before.institutions.map((row) => ({ ...row, lei: HMDA_REPAIR_MANIFEST.cohort.find((item) => item.institutionId === Number(row.id))!.lei })),
    lenders: before.lenders.map((row) => ({ ...row, institution_id: proposal(row.lei).institutionId, match_method: "lei",
      raw_json: { ...row.raw_json as JsonRow, feeinsight_identity: { ...matches.find((item) => item.lei === row.lei),
        repair_run_id: runId, manifest_digest: HMDA_REPAIR_MANIFEST_DIGEST, source_url: HMDA_REPAIR_MANIFEST.sourceUrl, source_sha256: HMDA_REPAIR_MANIFEST.sourceSha256 } } })),
    originations: before.originations.map((row) => ({ ...row, institution_id: proposal(row.lei).institutionId })),
    costs: before.costs.map((row) => ({ ...row, institution_id: proposal(row.lei).institutionId })),
  };
}

/** Updates only the approved identity columns; guarded full snapshots detect trigger side effects. */
async function writeSnapshot(tx: RegistryDb, target: HmdaRepairSnapshot): Promise<void> {
  let rows = await tx`WITH p AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(target.institutions)}::jsonb) AS x(id bigint,lei text))
    UPDATE institution_sources s SET lei=p.lei FROM p WHERE s.id=p.id RETURNING s.id`;
  assertKeys(rows, HMDA_REPAIR_MANIFEST.guards.institutions.ids, "institutions");
  rows = await tx`WITH p AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(target.lenders)}::jsonb)
      AS x(activity_year integer,lei text,institution_id bigint,match_method text,raw_json jsonb))
    UPDATE hmda_lenders l SET institution_id=p.institution_id,match_method=p.match_method,raw_json=p.raw_json FROM p
    WHERE l.activity_year=${HMDA_REPAIR_MANIFEST.year} AND l.activity_year=p.activity_year AND l.lei=p.lei RETURNING l.lei`;
  if (hashHmdaJson([...rows].map((r) => String(r.lei)).sort()) !== hashHmdaJson(HMDA_REPAIR_MANIFEST.cohort.map((r) => r.lei).sort())) throw new Error("Unexpected HMDA repair lender write set");
  rows = await tx`WITH p AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(target.originations)}::jsonb) AS x(id bigint,institution_id bigint))
    UPDATE hmda_lender_originations c SET institution_id=p.institution_id FROM p WHERE c.id=p.id AND c.activity_year=${HMDA_REPAIR_MANIFEST.year} RETURNING c.id`;
  assertKeys(rows, HMDA_REPAIR_MANIFEST.guards.originations.ids, "originations");
  rows = await tx`WITH p AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(target.costs)}::jsonb) AS x(id bigint,institution_id bigint))
    UPDATE hmda_lender_loan_costs c SET institution_id=p.institution_id FROM p WHERE c.id=p.id AND c.activity_year=${HMDA_REPAIR_MANIFEST.year} RETURNING c.id`;
  assertKeys(rows, HMDA_REPAIR_MANIFEST.guards.costs.ids, "costs");
}

/** Manual-only ledger handler. Writes are code-disabled until a separate reviewed release. */
export async function executeHmdaIdentityRepair(input: { db?: RegistryDb; runId: number; stepId: number; params: unknown }): Promise<{ summary: string; detail: Record<string, unknown> }> {
  const params = parseHmdaRepairParams(input.params);
  if (!Number.isSafeInteger(input.runId) || input.runId < 1 || !Number.isSafeInteger(input.stepId) || input.stepId < 1) throw new Error("HMDA repair requires ledger IDs");
  if (params.mode !== "preview" && !HMDA_REPAIR_WRITES_ENABLED) throw new Error("HMDA repair writes are disabled pending production authorization");
  const db = input.db ?? sql;
  const type = params.mode === "rollback" ? ROLLED_BACK : APPLIED;
  const prior = params.mode === "preview" ? null : await priorReceipt(db, input.runId, type);
  // HTTP happens before locks. Replay and rollback rely on the immutable receipt, not a fresh publisher response.
  const source = params.mode === "rollback" || prior ? null : await readHmdaRepairSource();
  return await db.begin(async (raw) => {
    const tx = raw as unknown as RegistryDb;
    if (params.mode === "preview") await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    await tx`SET LOCAL statement_timeout = '15s'`;
    await tx`SET LOCAL lock_timeout = '2s'`;
    if (params.mode !== "preview") {
      await lockLedger(tx, input.runId, input.stepId, params);
      await lockHmdaYear(tx, HMDA_REPAIR_MANIFEST.year);
      // Prevent phantom child inserts and ownership changes by writers outside the year protocol.
      // Readers remain available; this bounded transaction fails after 2s instead of waiting indefinitely.
      await tx`LOCK TABLE institution_sources,institution_lei_links,hmda_lenders,hmda_lender_originations,hmda_lender_loan_costs IN SHARE ROW EXCLUSIVE MODE`;
      await lockFdicIdentityHolds(tx);
    }
    const before = await snapshot(tx);
    if (params.mode !== "preview") {
      const existing = await priorReceipt(tx, input.runId, type);
      if (existing) {
        verifyReceipt(existing.receipt);
        if (existing.receipt.mode !== params.mode || hashHmdaJson(before) !== existing.receipt.postimage_hash) throw new Error("HMDA repair replay postimage drift");
        return { summary: `HMDA identity ${params.mode} already committed; no writes`, detail: { mode: params.mode, writes: 0, replayed: true, receipt_event_id: existing.id, manifest_digest: HMDA_REPAIR_MANIFEST_DIGEST } };
      }
    }
    let target: HmdaRepairSnapshot;
    if (params.mode === "rollback") {
      const events = await tx`SELECT e.detail,r.params_json FROM agent_run_events e JOIN agent_runs r ON r.id=e.agent_run_id
        WHERE e.id=${params.apply_event_id!} AND e.event_type=${APPLIED}`;
      if (events.length !== 1) throw new Error("HMDA apply receipt not found");
      const applied = events[0].detail as Receipt;
      verifyReceipt(applied);
      const owner = parseHmdaRepairParams(events[0].params_json);
      if (applied.mode !== "apply" || owner.mode !== "apply" || hashHmdaJson(before) !== applied.postimage_hash) throw new Error("HMDA rollback postimage drift");
      const priorRollbacks = await tx`SELECT id FROM agent_run_events WHERE event_type=${ROLLED_BACK} AND detail->>'apply_event_id'=${String(params.apply_event_id)} LIMIT 1`;
      if (priorRollbacks.length) throw new Error("HMDA apply receipt was already rolled back");
      target = applied.before;
    } else {
      verifyBefore(before);
      if (!source) throw new Error("HMDA repair source evidence missing");
      verifySource(source, before);
      const matches = await proposedMatches(tx, before);
      if (params.mode === "preview") return { summary: "HMDA repair preview: 10 banks and 124 aggregate rows eligible; no writes",
        detail: { mode: "preview", writes: 0, replayed: false, eligible: true, manifest_digest: HMDA_REPAIR_MANIFEST_DIGEST, counts: HMDA_REPAIR_MANIFEST.fixedBounds, source_sha256: source.sha256, matches } };
      target = targetSnapshot(before, matches, input.runId);
    }
    await writeSnapshot(tx, target);
    const after = await snapshot(tx);
    if (hashHmdaJson(after) !== hashHmdaJson(target)) throw new Error("HMDA repair post-write facts differ; transaction aborted");
    const receipt: Receipt = { schema_version: 1, manifest_digest: HMDA_REPAIR_MANIFEST_DIGEST, mode: params.mode,
      source_sha256: HMDA_REPAIR_MANIFEST.sourceSha256, before, after, postimage_hash: hashHmdaJson(after),
      counts: HMDA_REPAIR_MANIFEST.fixedBounds, authorization_reference: params.authorization_reference!,
      ...(params.mode === "rollback" ? { apply_event_id: params.apply_event_id } : {}) };
    const events = await tx`INSERT INTO agent_run_events (agent_run_id,step_id,event_type,status,message,detail)
      VALUES (${input.runId},${input.stepId},${type},'completed',${`HMDA identity ${params.mode} committed for exact reviewed scope`},${JSON.stringify(receipt)}::jsonb) RETURNING id`;
    return { summary: `HMDA identity ${params.mode}: 10 banks, 10 annual lenders, 85 origination and 39 cost rows`,
      detail: { mode: params.mode, writes: 144, replayed: false, receipt_event_id: Number(events[0].id), manifest_digest: HMDA_REPAIR_MANIFEST_DIGEST, counts: receipt.counts } };
  }) as { summary: string; detail: Record<string, unknown> };
}
