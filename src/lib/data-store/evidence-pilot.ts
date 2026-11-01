import { sql } from "./connection";

/**
 * Evidence-first pilot layer (migration 20270110000083, James 2026-11-01 "Pilot-first new layer").
 *
 * For up to ten pilot institutions, fees are held as obligations with bitemporal versions, and each
 * version cites the exact characters of an append-only normalized witness
 * (agent_source_text_witnesses). A separate source-side inventory lists the fees a document states,
 * read independently of the obligations, so both directions are scored:
 *   precision = current obligation versions matched by a source fee / current versions,
 *   recall    = source fees matched by a current obligation version / source fees.
 * The live fee tiers, catalog and site never read these tables.
 */

type Db = typeof sql;

export const EVIDENCE_PILOT_MAX_INSTITUTIONS = 10;
export const EVIDENCE_PILOT_TARGETS = { precision: 0.995, recall: 0.9 } as const;

export type PilotCohort = "bank" | "credit_union";
export type ObligationAmountKind = "fixed" | "free" | "varies" | "rate";
export type ObligationAudience = "consumer" | "business";

export class EvidencePilotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidencePilotError";
  }
}

async function atomic<T>(db: Db, work: (scope: Db) => Promise<T>): Promise<T> {
  const savepoint = (db as unknown as { savepoint?: (work: (scope: Db) => Promise<T>) => Promise<T> }).savepoint;
  if (savepoint) return savepoint.call(db, work);
  return db.begin((scope) => work(scope as unknown as Db)) as Promise<T>;
}

function foldChar(ch: string): string {
  if (/\s/.test(ch)) return " ";
  if (ch === "‘" || ch === "’") return "'";
  if (ch === "“" || ch === "”") return '"';
  if (/[‐-―]/.test(ch)) return "-";
  const lower = ch.toLowerCase();
  return Array.from(lower).length === 1 ? lower : ch;
}

/**
 * Finds a quoted line in a text, ignoring case, runs of whitespace, curly quotes and dash variants,
 * and returns the span of the ORIGINAL characters it covers. Offsets count Unicode code points, as
 * PostgreSQL's substr does, so the database can check the span against the witness exactly.
 * Returns null when the quote is not in the text.
 */
export function locateQuote(text: string, quote: string): { start: number; end: number; segment: string } | null {
  const chars = Array.from(text);
  let folded = "";
  const origin: number[] = [];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = foldChar(chars[i]);
    if (ch === " " && (folded.length === 0 || folded.endsWith(" "))) continue;
    folded += ch;
    origin.push(i);
  }
  const needle = Array.from(quote).map(foldChar).join("").replace(/ +/g, " ").trim();
  if (!needle) return null;
  // `folded` is built one code point per entry of `origin`; search in code points, not UTF-16 units.
  const hay = Array.from(folded);
  const pin = Array.from(needle);
  outer: for (let i = 0; i + pin.length <= hay.length; i += 1) {
    for (let j = 0; j < pin.length; j += 1) if (hay[i + j] !== pin[j]) continue outer;
    const start = origin[i];
    const end = origin[i + pin.length - 1] + 1;
    return { start, end, segment: chars.slice(start, end).join("") };
  }
  return null;
}

export async function addPilotInstitution(
  input: { institutionId: number; cohort: PilotCohort; reason: string; addedBy: string },
  db: Db = sql,
): Promise<{ added: boolean }> {
  return atomic(db, async (tx) => {
    await tx`LOCK TABLE evidence_pilot_institutions IN SHARE ROW EXCLUSIVE MODE`;
    const [existing] = await tx`SELECT 1 FROM evidence_pilot_institutions WHERE institution_id = ${input.institutionId}`;
    if (existing) return { added: false };
    const [count] = await tx`SELECT COUNT(*)::int AS n FROM evidence_pilot_institutions`;
    if (Number(count.n) >= EVIDENCE_PILOT_MAX_INSTITUTIONS) {
      throw new EvidencePilotError(`The pilot already has ${EVIDENCE_PILOT_MAX_INSTITUTIONS} institutions`);
    }
    await tx`
      INSERT INTO evidence_pilot_institutions (institution_id, cohort, reason, added_by)
      VALUES (${input.institutionId}, ${input.cohort}, ${input.reason}, ${input.addedBy})
    `;
    return { added: true };
  });
}

async function requirePilotInstitution(db: Db, institutionId: number): Promise<void> {
  const [row] = await db`SELECT 1 FROM evidence_pilot_institutions WHERE institution_id = ${institutionId}`;
  if (!row) throw new EvidencePilotError(`Institution ${institutionId} is not in the evidence pilot`);
}

export interface EvidenceSegment {
  id: number;
  institutionId: number;
  sourceDocumentId: number;
  start: number;
  end: number;
  text: string;
}

/**
 * Records the span of a witness that a quote names. Returns null when the quote is not in the
 * witness text: a claim with no exact source is never stored as evidence.
 */
export async function recordEvidenceSegment(
  input: { witnessArtifactId: number; witnessTextHash: string; quote: string },
  db: Db = sql,
): Promise<EvidenceSegment | null> {
  const [witness] = await db`
    SELECT institution_id, source_document_id, normalized_text
      FROM agent_source_text_witnesses
     WHERE artifact_id = ${input.witnessArtifactId} AND text_hash = ${input.witnessTextHash}
  `;
  if (!witness) throw new EvidencePilotError(`No witness ${input.witnessArtifactId}/${input.witnessTextHash}`);
  const institutionId = Number(witness.institution_id);
  await requirePilotInstitution(db, institutionId);
  const span = locateQuote(String(witness.normalized_text), input.quote);
  if (!span) return null;
  const sourceDocumentId = Number(witness.source_document_id);
  const [inserted] = await db`
    INSERT INTO evidence_segments
      (institution_id, source_document_id, witness_artifact_id, witness_text_hash, char_start, char_end, segment_text)
    VALUES (${institutionId}, ${sourceDocumentId}, ${input.witnessArtifactId}, ${input.witnessTextHash},
            ${span.start}, ${span.end}, ${span.segment})
    ON CONFLICT (witness_artifact_id, witness_text_hash, char_start, char_end) DO NOTHING
    RETURNING id
  `;
  const id = inserted
    ? Number(inserted.id)
    : Number((await db`
        SELECT id FROM evidence_segments
         WHERE witness_artifact_id = ${input.witnessArtifactId} AND witness_text_hash = ${input.witnessTextHash}
           AND char_start = ${span.start} AND char_end = ${span.end}
      `)[0].id);
  return { id, institutionId, sourceDocumentId, start: span.start, end: span.end, text: span.segment };
}

export interface FeeTerms {
  canonicalKey: string;
  audience: ObligationAudience;
  amountKind: ObligationAmountKind;
  /** Dollars; null unless amountKind is "fixed" (or 0 for "free"). */
  amount: number | null;
  /** Percent; set only when amountKind is "rate". */
  ratePercent: number | null;
}

/** One fee the source states, from a read independent of the obligations (the recall side). */
export async function recordSourceFee(
  input: FeeTerms & { evidenceSegmentId: number; method: string; agentRunId?: number | null },
  db: Db = sql,
): Promise<number> {
  const [segment] = await db`SELECT institution_id FROM evidence_segments WHERE id = ${input.evidenceSegmentId}`;
  if (!segment) throw new EvidencePilotError(`No evidence segment ${input.evidenceSegmentId}`);
  const [row] = await db`
    INSERT INTO evidence_source_fees
      (institution_id, evidence_segment_id, canonical_key, audience, amount, amount_kind, rate_percent, method, agent_run_id)
    VALUES (${Number(segment.institution_id)}, ${input.evidenceSegmentId}, ${input.canonicalKey}, ${input.audience},
            ${input.amount}, ${input.amountKind}, ${input.ratePercent}, ${input.method}, ${input.agentRunId ?? null})
    RETURNING id
  `;
  return Number(row.id);
}

export interface ObligationVersionInput extends FeeTerms {
  institutionId: number;
  variant?: string;
  frequency?: string | null;
  conditions?: string | null;
  /** ISO date the fee takes effect. */
  validFrom: string;
  /** ISO date it stops (exclusive); null while open. */
  validTo?: string | null;
  validFromBasis: "stated_effective_date" | "document_first_seen";
  evidenceSegmentIds: number[];
  producedBy: string;
  agentRunId?: number | null;
}

/**
 * Records what we now believe an obligation is over [validFrom, validTo). An identical current
 * version only gains the new evidence. Otherwise the new version is added and every current version
 * it overlaps is superseded; the parts of an old version outside the new range are kept as their
 * own versions (same terms and evidence), so history in both time axes stays whole.
 */
export async function recordObligationVersion(
  input: ObligationVersionInput,
  db: Db = sql,
): Promise<{ obligationId: number; versionId: number; unchanged: boolean; superseded: number[] }> {
  if (input.evidenceSegmentIds.length === 0) throw new EvidencePilotError("An obligation version needs evidence");
  return atomic(db, async (tx) => {
    await requirePilotInstitution(tx, input.institutionId);
    const variant = input.variant ?? "";
    const [obligation] = await tx`
      INSERT INTO fee_obligations (institution_id, canonical_key, audience, variant)
      VALUES (${input.institutionId}, ${input.canonicalKey}, ${input.audience}, ${variant})
      ON CONFLICT (institution_id, canonical_key, audience, variant) DO UPDATE SET variant = EXCLUDED.variant
      RETURNING id
    `;
    const obligationId = Number(obligation.id);
    const validTo = input.validTo ?? null;
    const overlapping = await tx`
      SELECT id, valid_from::text AS valid_from, valid_to::text AS valid_to,
             (amount IS NOT DISTINCT FROM ${input.amount}::numeric
              AND amount_kind = ${input.amountKind}
              AND rate_percent IS NOT DISTINCT FROM ${input.ratePercent}::numeric
              AND frequency IS NOT DISTINCT FROM ${input.frequency ?? null}::text
              AND conditions IS NOT DISTINCT FROM ${input.conditions ?? null}::text
              AND valid_from = ${input.validFrom}::date
              AND valid_to IS NOT DISTINCT FROM ${validTo}::date) AS same
        FROM fee_obligation_versions
       WHERE obligation_id = ${obligationId} AND superseded_at IS NULL
         AND daterange(valid_from, valid_to, '[)') && daterange(${input.validFrom}::date, ${validTo}::date, '[)')
       ORDER BY valid_from
       FOR UPDATE
    `;
    const link = async (versionId: number, segmentIds: number[]) => {
      for (const segmentId of segmentIds) {
        await tx`
          INSERT INTO fee_obligation_evidence (obligation_version_id, evidence_segment_id)
          VALUES (${versionId}, ${segmentId}) ON CONFLICT DO NOTHING
        `;
      }
    };
    const same = overlapping.length === 1 && overlapping[0].same === true ? overlapping[0] : null;
    if (same) {
      await link(Number(same.id), input.evidenceSegmentIds);
      return { obligationId, versionId: Number(same.id), unchanged: true, superseded: [] };
    }
    const insertVersion = async (terms: { from: string; to: string | null; copyOf?: number }) => {
      if (terms.copyOf) {
        const [copy] = await tx`
          INSERT INTO fee_obligation_versions
            (obligation_id, amount, amount_kind, rate_percent, frequency, conditions, valid_from, valid_to,
             valid_from_basis, produced_by, agent_run_id)
          SELECT obligation_id, amount, amount_kind, rate_percent, frequency, conditions, ${terms.from}::date, ${terms.to}::date,
                 valid_from_basis, produced_by, agent_run_id
            FROM fee_obligation_versions WHERE id = ${terms.copyOf}
          RETURNING id
        `;
        const segments = await tx`SELECT evidence_segment_id FROM fee_obligation_evidence WHERE obligation_version_id = ${terms.copyOf}`;
        await link(Number(copy.id), segments.map((s) => Number(s.evidence_segment_id)));
        return Number(copy.id);
      }
      const [row] = await tx`
        INSERT INTO fee_obligation_versions
          (obligation_id, amount, amount_kind, rate_percent, frequency, conditions, valid_from, valid_to,
           valid_from_basis, produced_by, agent_run_id)
        VALUES (${obligationId}, ${input.amount}, ${input.amountKind}, ${input.ratePercent}, ${input.frequency ?? null},
                ${input.conditions ?? null}, ${terms.from}::date, ${terms.to}::date, ${input.validFromBasis},
                ${input.producedBy}, ${input.agentRunId ?? null})
        RETURNING id
      `;
      await link(Number(row.id), input.evidenceSegmentIds);
      return Number(row.id);
    };
    const versionId = await insertVersion({ from: input.validFrom, to: validTo });
    const superseded: number[] = [];
    for (const old of overlapping) {
      const oldId = Number(old.id);
      await tx`
        UPDATE fee_obligation_versions SET superseded_at = clock_timestamp(), superseded_by = ${versionId}
         WHERE id = ${oldId}
      `;
      superseded.push(oldId);
      if (String(old.valid_from) < input.validFrom) await insertVersion({ from: String(old.valid_from), to: input.validFrom, copyOf: oldId });
      if (validTo !== null && (old.valid_to === null || String(old.valid_to) > validTo)) {
        await insertVersion({ from: validTo, to: old.valid_to === null ? null : String(old.valid_to), copyOf: oldId });
      }
    }
    return { obligationId, versionId, unchanged: false, superseded };
  });
}

export type AdjudicationVerdict = "match" | "amount_mismatch" | "category_mismatch" | "not_in_source" | "missing_from_obligations";

export async function recordAdjudication(
  input: {
    obligationVersionId?: number | null;
    sourceFeeId?: number | null;
    verdict: AdjudicationVerdict;
    method: string;
    reviewer: string;
    notes?: string | null;
    agentRunId?: number | null;
  },
  db: Db = sql,
): Promise<number> {
  const [row] = await db`
    INSERT INTO fee_adjudications (obligation_version_id, source_fee_id, verdict, method, reviewer, notes, agent_run_id)
    VALUES (${input.obligationVersionId ?? null}, ${input.sourceFeeId ?? null}, ${input.verdict}, ${input.method},
            ${input.reviewer}, ${input.notes ?? null}, ${input.agentRunId ?? null})
    RETURNING id
  `;
  return Number(row.id);
}

export interface PilotScore {
  /** Current obligation versions in effect on `asOf`. */
  versions: number;
  versionsMatched: number;
  sourceFees: number;
  sourceFeesMatched: number;
  /** null when there is nothing to score yet. */
  precision: number | null;
  recall: number | null;
  /** Current versions on `asOf` that cite no segment of a stored witness (should always be 0). */
  versionsWithoutEvidence: number;
  meetsTargets: boolean;
}

/**
 * Two-way reconciliation on one date. A version and a source fee match when they name the same
 * institution, fee type, audience, amount kind and amount (or rate). Source fees count once per
 * (institution, segment, fee type, audience, kind, amount), however many reads recorded them.
 */
export async function scoreEvidencePilot(asOf: string, db: Db = sql): Promise<PilotScore> {
  const [row] = await db`
    WITH current_versions AS (
      SELECT v.id, o.institution_id, o.canonical_key, o.audience, v.amount_kind, v.amount, v.rate_percent
        FROM fee_obligation_versions v JOIN fee_obligations o ON o.id = v.obligation_id
       WHERE v.superseded_at IS NULL
         AND daterange(v.valid_from, v.valid_to, '[)') @> ${asOf}::date
    ), source AS (
      SELECT DISTINCT institution_id, evidence_segment_id, canonical_key, audience, amount_kind, amount, rate_percent
        FROM evidence_source_fees
    )
    SELECT
      (SELECT COUNT(*) FROM current_versions)::int AS versions,
      (SELECT COUNT(*) FROM current_versions v WHERE EXISTS (
         SELECT 1 FROM source s WHERE s.institution_id = v.institution_id AND s.canonical_key = v.canonical_key
            AND s.audience = v.audience AND s.amount_kind = v.amount_kind
            AND s.amount IS NOT DISTINCT FROM v.amount AND s.rate_percent IS NOT DISTINCT FROM v.rate_percent))::int AS versions_matched,
      (SELECT COUNT(*) FROM source)::int AS source_fees,
      (SELECT COUNT(*) FROM source s WHERE EXISTS (
         SELECT 1 FROM current_versions v WHERE s.institution_id = v.institution_id AND s.canonical_key = v.canonical_key
            AND s.audience = v.audience AND s.amount_kind = v.amount_kind
            AND s.amount IS NOT DISTINCT FROM v.amount AND s.rate_percent IS NOT DISTINCT FROM v.rate_percent))::int AS source_fees_matched,
      (SELECT COUNT(*) FROM current_versions v WHERE NOT EXISTS (
         SELECT 1 FROM fee_obligation_evidence e WHERE e.obligation_version_id = v.id))::int AS versions_without_evidence
  `;
  const versions = Number(row.versions);
  const sourceFees = Number(row.source_fees);
  const precision = versions > 0 ? Number(row.versions_matched) / versions : null;
  const recall = sourceFees > 0 ? Number(row.source_fees_matched) / sourceFees : null;
  return {
    versions,
    versionsMatched: Number(row.versions_matched),
    sourceFees,
    sourceFeesMatched: Number(row.source_fees_matched),
    precision,
    recall,
    versionsWithoutEvidence: Number(row.versions_without_evidence),
    meetsTargets: precision !== null && recall !== null
      && precision >= EVIDENCE_PILOT_TARGETS.precision && recall >= EVIDENCE_PILOT_TARGETS.recall,
  };
}
