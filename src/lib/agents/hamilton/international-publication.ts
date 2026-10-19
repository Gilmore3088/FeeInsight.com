import type { sql } from "@/lib/data-store/connection";
import { productKey, productKeySql } from "@/lib/fee-product";
import { sourceOwnedWireScope } from "@/lib/custom-report/own-wire-scope";
import { matchOriginalRawSource, withLockedSourcePrefix, type LockedSourceSnapshot } from "../darwin/locked-raw-source";
import { internationalPublicationPolicy, potentialInternationalPublicationPeer, type InternationalPublicationFacts } from "./international-publication-policy";
import type { VerifiedFeeRow } from "./publish";

type Db = typeof sql;
interface Candidate extends VerifiedFeeRow {
  verified_state: string;
  raw_state: string;
  raw_institution_id: number | string;
  raw_extraction_note: string | null;
  raw_conditions: string | null;
  review_status: string;
}
interface Peer {
  published_id: number | string;
  verified_id: number | string | null;
  raw_id: number | string | null;
  institution_id: number | string;
  public_document_id: number | string | null;
  raw_document_id: number | string | null;
  raw_institution_id: number | string | null;
  name: string;
  category: string;
  amount: number | string | null;
  frequency: string | null;
  audience: string | null;
  product: string | null;
  source_url: string | null;
  public_conditions: string | null;
  raw_conditions: string | null;
  raw_extraction_note: string | null;
  peer_state: string;
}
export interface InternationalPublicationDeferral {
  reason: string;
  conflictingPublishedIds: number[];
}
export type InternationalPublicationWrite<T> = { kind: "written"; value: T }
  | { kind: "deferred"; detail: InternationalPublicationDeferral };

class Deferred extends Error {
  constructor(readonly detail: InternationalPublicationDeferral) { super("International publication remains undecided"); }
}
const defer = (reason: string, ids: number[] = []): never => { throw new Deferred({ reason, conflictingPublishedIds: ids }); };
const positive = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const key = (row: Peer) => `${row.published_id}:${row.peer_state}`;
const samePeers = (one: Peer[], two: Peer[]) => one.length === two.length && one.every((row, at) => key(row) === key(two[at]));

async function candidateOf(tx: Db, verifiedId: number): Promise<Candidate | undefined> {
  const [row] = await tx<Candidate[]>`
    SELECT fv.*, to_jsonb(fv)::text AS verified_state, to_jsonb(fv)::text AS selected_verified_state,
      to_jsonb(fr)::text AS raw_state, fr.institution_id AS raw_institution_id,
      fr.extraction_note AS raw_extraction_note, fr.conditions AS raw_conditions,
      fr.agent_event_id AS raw_agent_event_id,fr.product_name,fr.source_document_id,
      sd.crawled_at AS document_crawled_at,to_jsonb(sd)->>'companion_source_id' AS document_stream,
      sd.document_url,inst.institution_name
    FROM verified_fee_observations fv
    LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id
    LEFT JOIN source_documents sd ON sd.id=fr.source_document_id
    LEFT JOIN institution_sources inst ON inst.id=fv.institution_id
    WHERE fv.fee_verified_id=${verifiedId}`;
  return row;
}

/**
 * Catalog projection columns, including the current correction overlay, independent of
 * original-source availability. Include latent live rows below the three-category floor:
 * a later fee in this publish step can make them visible. No source-binding failure can
 * erase a peer's existing public comparability or turn its sourced flag off.
 */
async function peersOf(tx: Db, candidate: Candidate): Promise<Peer[]> {
  return tx<Peer[]>`
    SELECT fp.fee_published_id AS published_id,fv.fee_verified_id AS verified_id,fr.fee_raw_id AS raw_id,
      fp.institution_id,fr.institution_id AS raw_institution_id,fr.source_document_id AS raw_document_id,
      CASE WHEN pc.id IS NULL THEN fr.source_document_id ELSE cs.id::integer END AS public_document_id,
      fp.fee_name AS name,fp.canonical_fee_key AS category,fp.amount,fp.frequency,fp.fee_audience AS audience,
      fr.product_name AS product,
      CASE WHEN pc.id IS NULL THEN COALESCE(fp.source_url,fv.source_url,fr.source_url) ELSE cs.document_url END AS source_url,
      CASE WHEN pc.id IS NULL THEN fr.conditions ELSE pc.conditions END AS public_conditions,
      fr.conditions AS raw_conditions,fr.extraction_note AS raw_extraction_note,
      jsonb_build_array(to_jsonb(fp),to_jsonb(fv),to_jsonb(fr),to_jsonb(pc),to_jsonb(cs))::text AS peer_state
    FROM published_fee_records fp
    LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id=fp.lineage_ref
    LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id=fv.fee_raw_id
    LEFT JOIN published_fee_corrections pc ON pc.fee_published_id=fp.fee_published_id
      AND pc.institution_id=fp.institution_id AND pc.status='current'
    LEFT JOIN source_documents cs ON pc.id IS NOT NULL AND cs.id=COALESCE(pc.source_document_id,fr.source_document_id)
      AND cs.institution_id=fp.institution_id
    WHERE fp.institution_id=${Number(candidate.institution_id)} AND fp.canonical_fee_key=${candidate.canonical_fee_key}
      AND fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL AND fp.amount_kind='flat'
      AND ${tx.unsafe(productKeySql("fr.product_name"))}=${productKey(candidate.product_name)}
    ORDER BY fp.fee_published_id`;
}

function peerFacts(row: Peer, source?: LockedSourceSnapshot): InternationalPublicationFacts {
  const original = source && matchOriginalRawSource({ institution_id: row.raw_institution_id!,
    source_document_id: row.raw_document_id, extraction_note: row.raw_extraction_note, conditions: row.raw_conditions }, source);
  return { publishedId: Number(row.published_id), category: row.category, name: row.name,
    amount: row.amount == null ? null : Number(row.amount), frequency: row.frequency,
    audience: row.audience, product: row.product, sourceUrl: row.source_url,
    sourceLine: row.public_conditions, sourced: positive(row.public_document_id),
    scope: original?.kind === "matched" ? sourceOwnedWireScope(source!.normalizedText, row.name, Number(row.amount))
      : { kind: "unresolved", reason: "missing_owner" } };
}

function candidateFacts(current: Candidate, source?: LockedSourceSnapshot): InternationalPublicationFacts {
  return { category: current.canonical_fee_key, name: current.fee_name,
    amount: current.amount == null ? null : Number(current.amount), frequency: current.frequency,
    audience: current.fee_audience ?? "unknown", product: current.product_name ?? null,
    sourceUrl: current.document_url ?? current.source_url, sourceLine: current.raw_conditions,
    sourced: positive(current.source_document_id),
    scope: source ? sourceOwnedWireScope(source.normalizedText, current.fee_name, Number(current.amount))
      : { kind: "unresolved", reason: "missing_owner" } };
}

/**
 * Unwired guard adapter. Actual current lineage is authority. The real outer savepoint
 * rolls back every newly acquired prefix/suffix lock on a deferred decision. All new
 * row locks are NOWAIT; it never waits for a source after an earlier outer-step fee lock.
 * Normal run-store publish steps are advisory-serialized; external/manual insertions
 * remain outside this nonserializable phantom guarantee.
 */
export async function withInternationalPublicationWrite<T>(db: Db, options: {
  feeVerifiedId: number;
  /** A normal selected snapshot is a CAS expectation, never source or classification evidence. */
  expectedVerifiedState?: string;
}, work: (tx: Db, actual: VerifiedFeeRow | null) => Promise<T>): Promise<InternationalPublicationWrite<T>> {
  const savepoint = (db as unknown as { savepoint?: (work: (tx: Db) => Promise<InternationalPublicationWrite<T>>) => Promise<InternationalPublicationWrite<T>> }).savepoint;
  if (!savepoint) {
    const begin = (db as unknown as { begin?: (work: (tx: Db) => Promise<InternationalPublicationWrite<T>>) => Promise<InternationalPublicationWrite<T>> }).begin;
    if (!begin) throw new TypeError("International publication binding requires a native transaction");
    return begin.call(db, tx => withInternationalPublicationWrite(tx, options, work));
  }
  try {
    return await savepoint.call(db, async tx => {
      if (!positive(options.feeVerifiedId)) return defer("missing_candidate");
      const before = await candidateOf(tx, options.feeVerifiedId);
      if (!before) return defer("missing_candidate");
      if (!before.canonical_fee_key.startsWith("wire_intl_")) return { kind: "written", value: await work(tx, null) };
      if (options.expectedVerifiedState != null && before.verified_state !== options.expectedVerifiedState) return defer("selected_changed");
      if (!positive(before.source_document_id) || !positive(before.fee_raw_id)) return defer("candidate_source_unavailable");
      const peers = await peersOf(tx, before);
      const relevantPeers = peers.filter(row => potentialInternationalPublicationPeer(candidateFacts(before), peerFacts(row)));
      const refs = [{ documentId: Number(before.source_document_id), institutionId: Number(before.institution_id) },
        ...relevantPeers.map(row => ({ documentId: Number(row.public_document_id), institutionId: Number(row.institution_id) }))];
      const prefix = await withLockedSourcePrefix(tx, refs);
      if (prefix.kind !== "bound") return defer(`source_${prefix.kind}${"reason" in prefix ? `:${prefix.reason}` : ""}`);
      const publishedIds = peers.map(row => Number(row.published_id)).sort((a, b) => a - b);
      const verifiedIds = [...new Set([Number(before.fee_verified_id), ...peers.filter(row => positive(row.verified_id)).map(row => Number(row.verified_id))])].sort((a, b) => a - b);
      const rawIds = [...new Set([Number(before.fee_raw_id), ...peers.filter(row => positive(row.raw_id)).map(row => Number(row.raw_id))])].sort((a, b) => a - b);
      if (publishedIds.length) await tx`SELECT fee_published_id FROM published_fee_records WHERE fee_published_id=ANY(${publishedIds}::bigint[]) ORDER BY fee_published_id FOR UPDATE NOWAIT`;
      await tx`SELECT fee_verified_id FROM verified_fee_observations WHERE fee_verified_id=ANY(${verifiedIds}::bigint[]) ORDER BY fee_verified_id FOR UPDATE NOWAIT`;
      await tx`SELECT fee_raw_id FROM raw_fee_observations WHERE fee_raw_id=ANY(${rawIds}::bigint[]) ORDER BY fee_raw_id FOR UPDATE NOWAIT`;
      const current = await candidateOf(tx, options.feeVerifiedId);
      if (!current || current.verified_state !== before.verified_state || current.raw_state !== before.raw_state
        || !["verified", "approved"].includes(current.review_status)) return defer("candidate_changed");
      const freshPeers = await peersOf(tx, current);
      if (!samePeers(peers, freshPeers)) return defer("peer_membership_changed");
      const source = prefix.sources.get(Number(current.source_document_id));
      if (!source || matchOriginalRawSource({ institution_id: current.raw_institution_id,
        source_document_id: current.source_document_id!, extraction_note: current.raw_extraction_note,
        conditions: current.raw_conditions }, source).kind !== "matched") return defer("candidate_original_unavailable");
      const policy = internationalPublicationPolicy(candidateFacts(current, source),
      freshPeers.map(row => peerFacts(row, prefix.sources.get(Number(row.public_document_id)))));
      if (policy.kind === "deferred") return defer(policy.reason, policy.conflictingPublishedIds);
      return { kind: "written", value: await work(tx, current) };
    });
  } catch (error) {
    if (error instanceof Deferred) return { kind: "deferred", detail: error.detail };
    if ((error as { code?: string }).code === "55P03" || (error as { code?: string }).code === "40001")
      return { kind: "deferred", detail: { reason: "identity_busy_or_changed", conflictingPublishedIds: [] } };
    throw error;
  }
}
