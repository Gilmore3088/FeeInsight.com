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
  const word = /[\p{L}\p{N}]/u;
  const digit = /\p{N}/u;
  outer: for (let i = 0; i + pin.length <= hay.length; i += 1) {
    for (let j = 0; j < pin.length; j += 1) if (hay[i + j] !== pin[j]) continue outer;
    // Whole tokens only: "$3" must not match inside "$35.00", nor "fee" inside "feet".
    const before = hay[i - 1];
    const after = hay[i + pin.length];
    if (before && word.test(before) && word.test(pin[0])) continue;
    if (after && word.test(after) && word.test(pin[pin.length - 1])) continue;
    if (after && (after === "." || after === ",") && digit.test(pin[pin.length - 1]) && digit.test(hay[i + pin.length + 1] ?? "")) continue;
    // A quote ending "$3." or "$25," must not stop inside "$3.50" or "$25,000"; nor start inside one.
    const last = pin[pin.length - 1];
    if ((last === "." || last === ",") && digit.test(pin[pin.length - 2] ?? "") && after && digit.test(after)) continue;
    if ((pin[0] === "." || pin[0] === ",") && digit.test(pin[1] ?? "") && before && digit.test(before)) continue;
    if (before && (before === "." || before === ",") && digit.test(pin[0]) && digit.test(hay[i - 2] ?? "")) continue;
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts only a real calendar date written YYYY-MM-DD, so date strings compare in order. */
export function assertIsoDate(value: string, field: string): void {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!ISO_DATE.test(value) || value < "0001-01-01" || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new EvidencePilotError(`${field} must be a date written YYYY-MM-DD, not ${JSON.stringify(value)}`);
  }
}

/** A free fee is stored with amount 0, so both sides of a match use one form. */
function storedAmount(terms: { amountKind: ObligationAmountKind; amount: number | null }): number | null {
  return terms.amountKind === "free" ? 0 : terms.amount;
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
  /** Product or tier the fee applies to when a document prices it more than once; "" when one. */
  variant?: string;
  amountKind: ObligationAmountKind;
  /** Dollars; null unless amountKind is "fixed" ("free" is stored as 0). */
  amount: number | null;
  /** Percent; set only when amountKind is "rate". */
  ratePercent: number | null;
}

/** One fee the source states, from a read independent of the obligations (the recall side). */
export async function recordSourceFee(
  input: FeeTerms & {
    evidenceSegmentId: number;
    method: string;
    agentRunId?: number | null;
    /** When the document says the fee takes effect later than its capture ("effective December 1"). */
    validFrom?: string | null;
  },
  db: Db = sql,
): Promise<number> {
  const [segment] = await db`SELECT institution_id FROM evidence_segments WHERE id = ${input.evidenceSegmentId}`;
  if (!segment) throw new EvidencePilotError(`No evidence segment ${input.evidenceSegmentId}`);
  await requirePilotInstitution(db, Number(segment.institution_id));
  if (input.validFrom != null) {
    assertIsoDate(input.validFrom, "validFrom");
    // valid_from marks a price announced for later; a date on or before capture would let a stale line replace the current one.
    const [captured] = await db`
      SELECT to_char(w.captured_at::date, 'YYYY-MM-DD') AS day
        FROM evidence_segments s
        JOIN agent_source_text_witnesses w ON w.artifact_id = s.witness_artifact_id AND w.text_hash = s.witness_text_hash
       WHERE s.id = ${input.evidenceSegmentId}`;
    if (captured && input.validFrom <= String(captured.day)) {
      throw new EvidencePilotError(`validFrom ${input.validFrom} must be after the capture date ${captured.day}; leave it null for a fee already in effect`);
    }
  }
  const [row] = await db`
    INSERT INTO evidence_source_fees
      (institution_id, evidence_segment_id, canonical_key, audience, variant, amount, amount_kind, rate_percent, method,
       agent_run_id, valid_from)
    VALUES (${Number(segment.institution_id)}, ${input.evidenceSegmentId}, ${input.canonicalKey}, ${input.audience},
            ${input.variant ?? ""}, ${storedAmount(input)}, ${input.amountKind}, ${input.ratePercent}, ${input.method},
            ${input.agentRunId ?? null}, ${input.validFrom ?? null}::date)
    RETURNING id
  `;
  return Number(row.id);
}

export interface ObligationVersionInput extends FeeTerms {
  institutionId: number;
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
 * Records what we now believe an obligation is over [validFrom, validTo). A current version with the
 * same terms whose range already covers the new one only gains the new evidence. Otherwise the new
 * version is added and every current version it overlaps is superseded; the parts of an old version
 * outside the new range are kept as their own versions (same terms and evidence; the part after a
 * closed new range is marked carried_forward), so history in both time axes stays whole.
 *
 * The evidence and overlap checks are deferred to commit: a caller that passes its own transaction
 * sees a lineage error at its COMMIT, not from this call.
 */
export async function recordObligationVersion(
  input: ObligationVersionInput,
  db: Db = sql,
): Promise<{ obligationId: number; versionId: number; unchanged: boolean; superseded: number[] }> {
  if (input.evidenceSegmentIds.length === 0) throw new EvidencePilotError("An obligation version needs evidence");
  assertIsoDate(input.validFrom, "validFrom");
  if (input.validTo != null) {
    assertIsoDate(input.validTo, "validTo");
    if (input.validTo <= input.validFrom) throw new EvidencePilotError("validTo must be after validFrom");
  }
  const amount = storedAmount(input);
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
      SELECT id, to_char(valid_from, 'YYYY-MM-DD') AS valid_from, to_char(valid_to, 'YYYY-MM-DD') AS valid_to,
             (amount IS NOT DISTINCT FROM ${amount}::numeric
              AND amount_kind = ${input.amountKind}
              AND rate_percent IS NOT DISTINCT FROM ${input.ratePercent}::numeric
              AND frequency IS NOT DISTINCT FROM ${input.frequency ?? null}::text
              AND conditions IS NOT DISTINCT FROM ${input.conditions ?? null}::text
              AND daterange(valid_from, valid_to, '[)') @> daterange(${input.validFrom}::date, ${validTo}::date, '[)')) AS same
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
    const insertVersion = async (terms: { from: string; to: string | null; copyOf?: number; carried?: boolean }) => {
      if (terms.copyOf) {
        const [copy] = await tx`
          INSERT INTO fee_obligation_versions
            (obligation_id, amount, amount_kind, rate_percent, frequency, conditions, valid_from, valid_to,
             valid_from_basis, produced_by, agent_run_id)
          SELECT obligation_id, amount, amount_kind, rate_percent, frequency, conditions, ${terms.from}::date, ${terms.to}::date,
                 CASE WHEN ${terms.carried ?? false}::boolean THEN 'carried_forward' ELSE valid_from_basis END, produced_by, agent_run_id
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
        VALUES (${obligationId}, ${amount}, ${input.amountKind}, ${input.ratePercent}, ${input.frequency ?? null},
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
        await insertVersion({ from: validTo, to: old.valid_to === null ? null : String(old.valid_to), copyOf: oldId, carried: true });
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
  /** Current obligation versions of pilot institutions in effect on `asOf`. */
  versions: number;
  versionsMatched: number;
  /** Distinct fees stated by each pilot document's latest captured text on or before `asOf`. */
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
 * Two-way reconciliation on one date, for pilot institutions only.
 *
 * Source side: for each pilot page (all copies of a document, grouped by the current copy Magellan
 * points older copies at), only the fees recorded from its latest witness captured on or before
 * `asOf` that has source fees (a newer capture not yet read leaves the older one's fees in place);
 * an older capture's fees (a price since changed) and repeat captures do not count, so a historical
 * `asOf` sees the copy that was current then. A fee the text says starts later than its capture
 * ("effective December 1") is left out until then, and from then it replaces the same fee's earlier
 * price in that text. An announcement in a separate notice document does not replace the
 * schedule's price; it counts once a re-captured schedule shows it. Each distinct (institution, fee type, audience, variant,
 * kind, amount, rate) counts once, however many reads recorded it. Source fees are written only from
 * reads that already agree (the feeder's job), so agreement is required upstream; adjudications are
 * the reviewer's record and do not change the score.
 *
 * A version and a source fee match when institution, fee type, audience, variant, amount kind and
 * amount (or rate) are all equal.
 */
export async function scoreEvidencePilot(
  options: { asOf: string; institutionIds?: number[] },
  db: Db = sql,
): Promise<PilotScore> {
  assertIsoDate(options.asOf, "asOf");
  const only = options.institutionIds ?? null;
  const [row] = await db`
    WITH pilot AS (
      SELECT institution_id FROM evidence_pilot_institutions
       WHERE ${only}::bigint[] IS NULL OR institution_id = ANY(${only}::bigint[])
    ), current_versions AS (
      SELECT v.id, o.institution_id, o.canonical_key, o.audience, o.variant, v.amount_kind, v.amount, v.rate_percent
        FROM fee_obligation_versions v
        JOIN fee_obligations o ON o.id = v.obligation_id
        JOIN pilot p ON p.institution_id = o.institution_id
       WHERE v.superseded_at IS NULL
         AND daterange(v.valid_from, v.valid_to, '[)') @> ${options.asOf}::date
    ), captured AS (
      SELECT f.*, s.source_document_id, w.captured_at, w.artifact_id, w.text_hash,
             -- Magellan points every older copy of a page at the current copy, so the current copy's id names the page.
             coalesce(d.superseded_by_id, d.id, s.source_document_id) AS page_id
        FROM evidence_source_fees f
        JOIN pilot p ON p.institution_id = f.institution_id
        JOIN evidence_segments s ON s.id = f.evidence_segment_id
        JOIN agent_source_text_witnesses w ON w.artifact_id = s.witness_artifact_id AND w.text_hash = s.witness_text_hash
        LEFT JOIN source_documents d ON d.id = s.source_document_id
       WHERE w.captured_at < (${options.asOf}::date + 1)
         AND (f.valid_from IS NULL OR f.valid_from <= ${options.asOf}::date)
    ), latest AS (
      SELECT DISTINCT ON (institution_id, page_id) institution_id, page_id, artifact_id, text_hash
        FROM captured
       ORDER BY institution_id, page_id, captured_at DESC, artifact_id DESC
    ), source AS (
      SELECT DISTINCT c.institution_id, c.canonical_key, c.audience, c.variant, c.amount_kind, c.amount, c.rate_percent
        FROM captured c
        JOIN latest l ON l.institution_id = c.institution_id AND l.page_id = c.page_id
                     AND l.artifact_id = c.artifact_id AND l.text_hash = c.text_hash
       -- A fee the same text replaces from a later date already in effect ("from December 1, $40") drops out.
       WHERE NOT EXISTS (
         SELECT 1 FROM captured n
          WHERE n.artifact_id = c.artifact_id AND n.text_hash = c.text_hash
            AND n.canonical_key = c.canonical_key AND n.audience = c.audience AND n.variant = c.variant
            AND n.valid_from IS NOT NULL AND n.valid_from > n.captured_at::date
            AND n.valid_from > coalesce(c.valid_from, '-infinity'::date))
    )
    SELECT
      (SELECT COUNT(*) FROM current_versions)::int AS versions,
      (SELECT COUNT(*) FROM current_versions v WHERE EXISTS (
         SELECT 1 FROM source s WHERE s.institution_id = v.institution_id AND s.canonical_key = v.canonical_key
            AND s.audience = v.audience AND s.variant = v.variant AND s.amount_kind = v.amount_kind
            AND s.amount IS NOT DISTINCT FROM v.amount AND s.rate_percent IS NOT DISTINCT FROM v.rate_percent))::int AS versions_matched,
      (SELECT COUNT(*) FROM source)::int AS source_fees,
      (SELECT COUNT(*) FROM source s WHERE EXISTS (
         SELECT 1 FROM current_versions v WHERE s.institution_id = v.institution_id AND s.canonical_key = v.canonical_key
            AND s.audience = v.audience AND s.variant = v.variant AND s.amount_kind = v.amount_kind
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
