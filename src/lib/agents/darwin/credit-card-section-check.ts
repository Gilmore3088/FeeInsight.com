import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { creditCardSectionColumns, creditCardSectionRead, creditCardStatementRead } from "@/lib/agents/knox/credit-card-section";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of card replacements printed in a credit card section (Knox v175, backlog dry
 * run 6, and its review on PR #2967; decision 2026-10-15, "Darwin re-checks every live fee against
 * today's rules"). Knox v175 leaves such a read out (`creditCardSectionRead`, knox/credit-card-section.ts);
 * the ones read before stay live. Greylock FCU's "Card Replacement (Emergency/Rush Delivery)" $35 (published
 * 73521, doc 20487), printed in the right column under "CREDIT CARD CHARGES", is live as the bank's rush
 * card fee beside its own $5 debit card replacement.
 *
 * Each verify step reads every live flat card_replacement and rush_card fee whose text (the artifact its
 * Knox note names) names a credit card (`CREDIT_CARD_TEXT_SQL`). The rule is Knox's own, run on the stored
 * line (Knox's `excerpt="..."`) and the same text: every line that prints the line and the fee's name must
 * sit under a credit card title in the name's own column. A fee whose text is gone, or whose note keeps no
 * line, is not judged. An admin-corrected fee is never read. An institution-scoped run reads that
 * institution's only. Switched on (`CREDIT_CARD_SECTION_TAKEDOWN_LIVE`), a match goes through the shared
 * 12-hour second look (check `darwin.credit_card_section`) and is archived on its second failure: rolled
 * back with `credit_card_section: "<name>" #<artifact>`, its verified row rejected with the
 * `credit_card_section` flag so publish does not bring it back, never deleted, and a
 * `darwin.credit_card_section_takedown` event lists them. In a dry run, or with the switch off (the
 * default), it only reports.
 *
 * Dry run, prod read-only, 2026-11-03: see docs/project/findings/2026-11-03-knox-backlog-dry-run-6-misfiles.md.
 *
 * v2 (Knox v176, backlog dry run 7): it also reads every live flat paper statement fee whose own name opens
 * with a credit card (`CARD_STATEMENT_NAME_SQL`, then Knox's `creditCardStatementRead` on the name): USF FCU's
 * "Visa Monthly Paper Statement Fee" $1.25 is the card's statement, not the deposit paper statement. The rule
 * reads the name alone, so such a fee needs only its artifact, not a stored line or a text naming a credit
 * card. Dry run, prod read-only, 2026-11-03: see
 * docs/project/findings/2026-11-03-knox-backlog-dry-run-7-misfiles.md.
 */
export const CREDIT_CARD_SECTION_CHECK = "darwin.credit_card_section";
export const CREDIT_CARD_SECTION_CHECK_VERSION = 2;
/** The switch: off, the step only reports; on, matches come down after the second look. */
export const CREDIT_CARD_SECTION_TAKEDOWN_LIVE = false;
export const CREDIT_CARD_SECTION_REASON = "credit_card_section";
export const CREDIT_CARD_SECTION_FLAG = "credit_card_section";
export const CREDIT_CARD_SECTION_KEYS = ["card_replacement", "rush_card", "paper_statement"] as const;
/** The key whose fees Knox's name-only rule judges (`creditCardStatementRead`), not the section reader. */
export const CREDIT_CARD_STATEMENT_KEY = "paper_statement";
export const CREDIT_CARD_SECTION_LIMIT = 5_000;
export const CREDIT_CARD_SECTION_SAMPLES = 20;
/** The most rows one read returns. */
export const CREDIT_CARD_SECTION_MAX_ROWS = 10_000;
/** Texts read per query, so one read never holds every candidate's text at once. */
const TEXT_CHUNK = 50;

/** Postgres pre-filter on the text: it names a credit card somewhere (`creditCardSectionColumns` reads nothing else). */
export const CREDIT_CARD_TEXT_SQL = String.raw`credit\s+cards?`;
/** Postgres pre-filter on a paper statement fee's name: it opens with a credit card (`creditCardStatementRead` judges the rest). */
export const CARD_STATEMENT_NAME_SQL = String.raw`^\W*(visa|master\s?card|amex|american\s+express|discover|credit\s+cards?)`;

export interface CreditCardSectionLiveRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  /** Knox's extraction note, whose excerpt is the stored line. */
  source_line: string | null;
  /** The artifact the note names: the text Knox read. */
  artifact_id: number | string | null;
}

export interface CreditCardSectionMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number;
  canonicalFeeKey: string | null;
  artifactId: number;
  line: string;
  reason: string;
}

export interface CreditCardSectionFindings {
  checked: number;
  /** Candidates whose text is gone or whose note keeps no line: not judged. */
  noText: number;
  matched: number;
  documents: number;
  institutions: number;
  samples: CreditCardSectionMatch[];
}

export interface CreditCardSectionResult extends CreditCardSectionFindings {
  live: boolean;
  dryRun: boolean;
  scoped: boolean;
  flagged: number;
  waiting: number;
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pure: the matches among the rows the read selected, each judged by Knox's rule on its own text (`texts`, by artifact id). */
export function findCreditCardSectionFees(
  rows: readonly CreditCardSectionLiveRow[],
  texts: ReadonlyMap<number, string>,
): CreditCardSectionFindings & { matches: CreditCardSectionMatch[] } {
  const matches: CreditCardSectionMatch[] = [];
  const seen = new Set<number>();
  const columnsByText = new Map<number, ReturnType<typeof creditCardSectionColumns>>();
  let noText = 0;
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const artifactId = num(row.artifact_id);
    const text = artifactId == null ? undefined : texts.get(artifactId);
    const line = excerptOf(row.source_line);
    const byName = row.canonical_fee_key === CREDIT_CARD_STATEMENT_KEY;
    if (artifactId == null || (!byName && (!text || !line))) {
      noText += 1;
      continue;
    }
    const amount = num(row.amount);
    if (amount == null || amount < 0) continue;
    const name = (row.fee_name ?? "").trim();
    if (byName) {
      if (!creditCardStatementRead({ canonicalHint: row.canonical_fee_key, feeName: name })) continue;
    } else {
      if (!columnsByText.has(artifactId)) columnsByText.set(artifactId, creditCardSectionColumns(text!));
      if (!creditCardSectionRead({ canonicalHint: row.canonical_fee_key, feeName: name, excerpt: line!, amount }, text!, columnsByText.get(artifactId)!)) continue;
    }
    matches.push({
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: name,
      amount,
      canonicalFeeKey: row.canonical_fee_key,
      artifactId,
      line: (line ?? "").slice(0, 300),
      reason: `${CREDIT_CARD_SECTION_REASON}: "${name.slice(0, 80)}" #${artifactId}`,
    });
  }
  return {
    checked: seen.size,
    noText,
    matched: matches.length,
    documents: new Set(matches.map((fee) => fee.artifactId)).size,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, CREDIT_CARD_SECTION_SAMPLES),
    matches,
  };
}

/**
 * Read-only: every live flat card replacement and rush card fee whose text names a credit card, with the
 * artifact Knox read. `institutionId` (the verify step's scope) or `institutionIds` (a dry-run audit's)
 * narrow it.
 */
export function creditCardSectionRowsSql(db: SqlTag, options: { institutionId?: number; institutionIds?: readonly number[] | null; limit?: number } = {}) {
  const ids = options.institutionId != null ? [options.institutionId] : options.institutionIds?.length ? [...options.institutionIds] : null;
  const scoped = ids != null;
  const limit = Math.max(1, Math.min(options.limit ?? CREDIT_CARD_SECTION_LIMIT, CREDIT_CARD_SECTION_MAX_ROWS));
  return db<CreditCardSectionLiveRow[]>`
    WITH candidates AS (
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fr.fee_name, fp.amount,
             fp.canonical_fee_key, fr.extraction_note AS source_line,
             (substring(fr.extraction_note FROM 'artifact #([0-9]+)'))::bigint AS artifact_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount_kind = 'flat'
         AND fp.amount >= 0
         AND fp.canonical_fee_key = ANY(${[...CREDIT_CARD_SECTION_KEYS]}::text[])
         AND (fp.canonical_fee_key <> ${CREDIT_CARD_STATEMENT_KEY} OR fr.fee_name ~* ${CARD_STATEMENT_NAME_SQL})
         -- notAdminCorrectedSql("fp") (fee-correction-guard), written inline for the tagged template: never take down an admin-corrected fee.
         AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
         AND (${!scoped} OR fp.institution_id = ANY(${ids ?? [0]}::bigint[]))
    ),
    named AS (
      SELECT a.id
        FROM agent_source_texts a
       WHERE a.id IN (SELECT DISTINCT artifact_id FROM candidates WHERE artifact_id IS NOT NULL)
         AND a.normalized_text ~* ${CREDIT_CARD_TEXT_SQL}
    )
    SELECT c.* FROM candidates c
     WHERE c.artifact_id IN (SELECT id FROM named)
        OR (c.canonical_fee_key = ${CREDIT_CARD_STATEMENT_KEY} AND c.artifact_id IS NOT NULL)
     ORDER BY c.fee_published_id
     LIMIT ${limit}::int
  `;
}

/** Read-only: the texts Knox read, by artifact id. */
export async function creditCardSectionTexts(db: SqlTag, artifactIds: readonly number[]): Promise<Map<number, string>> {
  const texts = new Map<number, string>();
  const ids = [...new Set(artifactIds)];
  for (let start = 0; start < ids.length; start += TEXT_CHUNK) {
    const chunk = ids.slice(start, start + TEXT_CHUNK);
    const rows = await db<{ id: number | string; normalized_text: string | null }[]>`
      SELECT id, normalized_text FROM agent_source_texts WHERE id = ANY(${chunk}::bigint[]) AND normalized_text IS NOT NULL
    `;
    for (const row of rows) if (row.normalized_text) texts.set(Number(row.id), row.normalized_text);
  }
  return texts;
}

function emptyResult(live: boolean, dryRun: boolean, scoped: boolean): CreditCardSectionResult {
  return { live, dryRun, scoped, checked: 0, noText: 0, matched: 0, documents: 0, institutions: 0, samples: [], flagged: 0, waiting: 0, takenDown: [] };
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckCreditCardSectionFees(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<CreditCardSectionResult> {
  const live = options.live ?? CREDIT_CARD_SECTION_TAKEDOWN_LIVE;
  const result = emptyResult(live, options.dryRun, options.institutionId != null);

  let rows: CreditCardSectionLiveRow[];
  let texts: Map<number, string>;
  try {
    rows = await inSavepoint(db, (scope) => creditCardSectionRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
    const artifactIds = rows.map((row) => num(row.artifact_id)).filter((id): id is number => id != null);
    texts = await inSavepoint(db, (scope) => creditCardSectionTexts(scope, artifactIds));
  } catch (error) {
    console.warn("[darwin] credit card section check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findCreditCardSectionFees(rows, texts);
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: CREDIT_CARD_SECTION_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  if (!options.dryRun && result.matched > 0) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${CREDIT_CARD_SECTION_CHECK}, 'completed',
          ${`Read live card replacements printed in a credit card section and credit card statement fees: ${result.matched} of ${result.checked} live fee(s) on ${result.documents} document(s); ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(creditCardSectionDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] credit card section check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: CreditCardSectionMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-credit-card-section-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
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
                   WHEN fv.outlier_flags ? ${CREDIT_CARD_SECTION_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${CREDIT_CARD_SECTION_FLAG}::text)
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
    console.error("[darwin] credit card section takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: CreditCardSectionMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.credit_card_section_takedown', 'completed',
        ${`Archived ${archived.length} live card replacement(s) printed in a credit card section or credit card statement fee(s), on their second look`},
        ${JSON.stringify({ version: CREDIT_CARD_SECTION_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] credit card section takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: CreditCardSectionMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    artifact_id: fee.artifactId,
    line: fee.line,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function creditCardSectionDetail(result: CreditCardSectionResult) {
  return {
    check: CREDIT_CARD_SECTION_CHECK,
    version: CREDIT_CARD_SECTION_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    checked: result.checked,
    no_text: result.noText,
    matched: result.matched,
    documents: result.documents,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
