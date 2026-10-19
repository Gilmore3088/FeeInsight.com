import { createHash } from "node:crypto";
import type { sql } from "@/lib/data-store/connection";
import { FDIC_IDENTITY_HOLD_WRITES_ENABLED } from "@/lib/agents/hoovie/hmda-repair-release";
import { normalizeLei } from "@/lib/regulatory/gleif";

type AppSql = typeof sql;

export interface FdicIdentityHoldInput {
  certificate: string;
  institutionId: number | null;
  reason: "shared_lei" | "stored_lei_conflict" | "source_certificate_conflict";
  storedLei: string | null;
  implicatedLeis: string[];
  reportedLeis: string[];
  ownerCertificates: string[];
  evidence: Record<string, unknown>;
}

export interface FdicIdentityHold extends FdicIdentityHoldInput {
  id: number;
  fingerprint: string;
  sourceUrl: string;
  sourceSha256: string;
  observedAt: string;
  agentRunId: number;
}

export interface FdicIdentityHoldSource {
  sourceUrl: string;
  sourceSha256: string;
  observedAt: string;
  agentRunId: number;
}

const MAX_HOLDS = 5_000;
const positiveId = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const certificate = (value: string) => /^\d+$/.test(value);
const hashPattern = /^[a-f0-9]{64}$/;

function checkedInput(input: FdicIdentityHoldInput): FdicIdentityHoldInput {
  const leis = (values: string[]) => Array.isArray(values) && values.length > 0
    && values.every((value) => typeof value === "string" && normalizeLei(value) === value);
  if (!certificate(input.certificate) || (input.institutionId !== null && !positiveId(input.institutionId))
    || !["shared_lei", "stored_lei_conflict", "source_certificate_conflict"].includes(input.reason)
    || !leis(input.implicatedLeis) || !leis(input.reportedLeis)
    || !Array.isArray(input.ownerCertificates) || !input.ownerCertificates.length || !input.ownerCertificates.every(certificate)
    || !input.ownerCertificates.includes(input.certificate)
    || !input.reportedLeis.every((lei) => input.implicatedLeis.includes(lei))
    || (normalizeLei(input.storedLei) !== null && !input.implicatedLeis.includes(normalizeLei(input.storedLei)!))
    || !input.evidence || Array.isArray(input.evidence) || typeof input.evidence !== "object") {
    throw new Error("Invalid FDIC identity hold evidence; refusing identity matching/writes");
  }
  return { ...input, implicatedLeis: [...new Set(input.implicatedLeis)].sort(),
    reportedLeis: [...new Set(input.reportedLeis)].sort(), ownerCertificates: [...new Set(input.ownerCertificates)].sort() };
}

/** Conflict identity excludes observation time, source digest and raw spelling, so replays do not churn rows. */
export function fdicIdentityHoldFingerprint(input: FdicIdentityHoldInput): string {
  const row = checkedInput(input);
  return createHash("sha256").update(JSON.stringify({ certificate: row.certificate, institutionId: row.institutionId,
    reason: row.reason, storedLei: normalizeLei(row.storedLei), implicatedLeis: row.implicatedLeis,
    reportedLeis: row.reportedLeis, ownerCertificates: row.ownerCertificates })).digest("hex");
}

/** Held through the match/write transaction. Missing schema is an error, never an empty hold set. */
export async function lockFdicIdentityHolds(tx: AppSql): Promise<void> {
  await tx`LOCK TABLE institution_identity_holds IN SHARE MODE`;
}

/** Global read includes inactive and not-yet-tracked owners. Every row remains active. */
export async function readFdicIdentityHolds(db: AppSql): Promise<FdicIdentityHold[]> {
  const rows = await db`SELECT id, fingerprint, certificate, institution_id, reason, stored_lei,
      implicated_leis, reported_leis, owner_certificates, evidence, source_url, source_sha256,
      observed_at, agent_run_id FROM institution_identity_holds ORDER BY id LIMIT ${MAX_HOLDS + 1}`;
  if (rows.length > MAX_HOLDS) throw new Error("FDIC identity hold bound exceeded; refusing identity matching");
  return rows.map((row) => {
    const value = { ...checkedInput({ certificate: String(row.certificate),
      institutionId: row.institution_id == null ? null : Number(row.institution_id), reason: row.reason,
      storedLei: row.stored_lei, implicatedLeis: row.implicated_leis, reportedLeis: row.reported_leis,
      ownerCertificates: row.owner_certificates, evidence: row.evidence }),
    id: Number(row.id), fingerprint: String(row.fingerprint), sourceUrl: String(row.source_url),
    sourceSha256: String(row.source_sha256), observedAt: new Date(row.observed_at).toISOString(), agentRunId: Number(row.agent_run_id) };
    if (!positiveId(value.id) || !positiveId(value.agentRunId) || !hashPattern.test(value.sourceSha256)
      || value.fingerprint !== fdicIdentityHoldFingerprint(value)) throw new Error("Corrupt FDIC identity hold lineage");
    return value;
  });
}

/** Caller owns a transaction, canonical-table lock, then hold write lock. No update/delete/clear path. */
export async function persistFdicIdentityHolds(tx: AppSql, inputs: FdicIdentityHoldInput[], source: FdicIdentityHoldSource): Promise<number> {
  if (!FDIC_IDENTITY_HOLD_WRITES_ENABLED) throw new Error("FDIC identity hold writes are release-disabled");
  const sourceUrl = new URL(source.sourceUrl);
  if (!positiveId(source.agentRunId) || !hashPattern.test(source.sourceSha256)
    || !Number.isFinite(Date.parse(source.observedAt)) || sourceUrl.protocol !== "https:"
    || sourceUrl.hostname !== "api.fdic.gov" || sourceUrl.pathname !== "/banks/institutions") throw new Error("Invalid FDIC identity hold source lineage");
  // Locking the actual run and step prevents cancellation/completion racing the evidence write.
  const owner = await tx`SELECT r.id FROM agent_runs r JOIN agent_run_steps s ON s.agent_run_id=r.id
    WHERE r.id=${source.agentRunId} AND r.status='running' AND r.run_kind='workflow'
      AND r.cancel_requested_at IS NULL AND r.params_json->>'source'='magellan.registry'
      AND r.params_json->>'registry_source'='fdic-universe' AND r.params_json->>'partition_key'='current'
      AND s.step_key='registry-fdic-universe' AND s.status='running'
      AND r.agent_name IN ('magellan','hoovie') AND s.agent_name=r.agent_name
    FOR SHARE OF r,s`;
  if (owner.length !== 1) throw new Error("FDIC identity hold write requires its running registry ledger owner");
  const payload = inputs.map((input) => { const row = checkedInput(input); return { ...row, fingerprint: fdicIdentityHoldFingerprint(row) }; });
  if (payload.length > MAX_HOLDS) throw new Error("FDIC identity hold write bound exceeded");
  // LOCK also enforces transaction ownership (Postgres rejects LOCK outside a transaction).
  await tx`LOCK TABLE institution_identity_holds IN ROW EXCLUSIVE MODE`;
  if (!payload.length) return 0;
  const rows = await tx`INSERT INTO institution_identity_holds
    (fingerprint,certificate,institution_id,reason,stored_lei,implicated_leis,reported_leis,owner_certificates,evidence,
     source_url,source_sha256,observed_at,agent_run_id)
    SELECT x.fingerprint,x.certificate,x."institutionId",x.reason,x."storedLei",x."implicatedLeis",x."reportedLeis",x."ownerCertificates",x.evidence,
      ${source.sourceUrl},${source.sourceSha256},${source.observedAt}::timestamptz,${source.agentRunId}
    FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS x(fingerprint text,certificate text,"institutionId" bigint,reason text,
      "storedLei" text,"implicatedLeis" text[],"reportedLeis" text[],"ownerCertificates" text[],evidence jsonb)
    ON CONFLICT (fingerprint) DO NOTHING RETURNING id`;
  return rows.length;
}
