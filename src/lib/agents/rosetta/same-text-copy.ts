import type { sql } from "@/lib/data-store/connection";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { preserveStatusChange } from "./normalized-witness";
import { expandUnicodeLigatures, GLYPH_REPAIR_DUE_PATTERN, REPLACEMENT_CHARACTER } from "./glyph-repair";

type SqlTag = typeof sql;

/**
 * Same page, same text, same verdict (#2477).
 *
 * The fee-page check spares a text Knox already pulled fees from (`triageEarlierTexts`: "a text
 * Knox already pulled fees from is never rejected"), but it judged each copy of a page on its own.
 * When Magellan stored a newer copy of a page whose bytes changed and whose text did not (an HTML
 * nonce, a tracking tag), the newer copy had no Knox fees yet, so the product-page rule (#1053,
 * fee-page check v2) rejected it as `wrong_document` while the older copy, with identical text,
 * stayed readable. Knox never reads a `wrong_document` text, so the page's current copy never got
 * rows, Darwin never verified any, Hamilton's refresh had nothing to move the live fees to, and the
 * page's live fees stayed on the superseded copy, out of reach of every current-copy check.
 *
 * Prod, 25 Oct 2026 (read-only): of 2,573 live fees whose page's current copy has no live fee,
 * 684 sit behind a current copy Rosetta judged `wrong_document`; for 441 of them (202 current
 * copies at 186 banks) the current copy's text is byte-for-byte the older copy's, the older copy
 * has Knox rows, and every one was rejected by the product-page rule.
 *
 * The rule: a text on a page's current copy is spared the fee-page check exactly as its older
 * copy was when an older copy of the same page (superseded by this one, same bank) holds the same
 * text and Knox rows sent to Darwin. A changed text is still judged on its own.
 */
export const SAME_TEXT_COPY_STRATEGY = { strategy: "read.same_text_copy", version: 1 } as const;

/**
 * False (shadow): each read step counts and samples the `wrong_document` current copies the rule
 * would reopen (`rosetta.same_text_copies`) and changes none. New reads take the rule at read time
 * either way. True: those texts become readable (`completed`) so Knox reads them. No fee moves
 * here: Knox writes rows for the current copy, Darwin verifies them, and Hamilton's refresh moves a
 * live fee only when the current copy's row is the same line.
 */
export const SAME_TEXT_COPY_REOPEN_LIVE = false;
/** Texts the reopen pass looks at (and, live, reopens) per read step. */
export const SAME_TEXT_COPY_REOPEN_LIMIT = 200;
/** Copies listed in the step's event, so a reviewer can open them. */
export const SAME_TEXT_COPY_SAMPLE = 10;
export const SAME_TEXT_COPY_EVENT = "rosetta.same_text_copies";

/**
 * SQL (text alias `adt`, an agent_source_texts row): the newest older copy of the same page,
 * superseded by this text's document at the same bank, that holds this exact text and Knox rows
 * sent to Darwin; NULL when there is none. The one predicate the rule uses, so the copy it names is
 * the copy that qualified (`sameTextCopyOf` asks the same with a new read's own values).
 * Driven by `source_documents_superseded_by_idx`; the Knox rows by the Knox dedup index.
 */
export function sameTextKnoxCopyIdSql(textAlias = "adt"): string {
  return `(SELECT older.id
             FROM agent_source_texts older_text
             JOIN source_documents older ON older.id = older_text.source_document_id
            WHERE older.superseded_by_id = ${textAlias}.source_document_id
              AND older.institution_id = ${textAlias}.institution_id
              AND older_text.text_hash = ${textAlias}.text_hash
              AND EXISTS (
                SELECT 1 FROM raw_fee_observations older_fr
                 WHERE older_fr.source = 'knox'
                   AND older_fr.source_document_id = older.id
                   AND older_fr.outlier_flags ? 'needs_darwin_verification'
              )
            ORDER BY older.id DESC
            LIMIT 1)`;
}

/** SQL (text alias `adt`): true when the rule covers this text (`sameTextKnoxCopyIdSql` finds a copy). */
export function sameTextKnoxCopySql(textAlias = "adt"): string {
  return `(${textAlias}.text_hash IS NOT NULL AND ${sameTextKnoxCopyIdSql(textAlias)} IS NOT NULL)`;
}

/**
 * At read time: the older copy of this page that holds `textHash` and Knox rows, or null. The
 * text is not stored yet, so the rule is asked with the new read's own values.
 */
export async function sameTextCopyOf(
  db: SqlTag,
  input: { institutionId: number; sourceDocumentId: number; textHash: string | null },
): Promise<number | null> {
  if (!input.textHash) return null;
  const [row] = await db<Array<{ id: number | string }>>`
    SELECT older.id
      FROM agent_source_texts older_text
      JOIN source_documents older ON older.id = older_text.source_document_id
     WHERE older.superseded_by_id = ${input.sourceDocumentId}
       AND older.institution_id = ${input.institutionId}
       AND older_text.text_hash = ${input.textHash}
       AND EXISTS (
         SELECT 1 FROM raw_fee_observations older_fr
          WHERE older_fr.source = 'knox'
            AND older_fr.source_document_id = older.id
            AND older_fr.outlier_flags ? 'needs_darwin_verification'
       )
     ORDER BY older.id DESC
     LIMIT 1
  `;
  return row?.id == null ? null : Number(row.id);
}

/** Letters one unknown glyph can stand for once restored ("ffi", the longest ligature). */
export const MAX_LETTERS_PER_GLYPH = 3;
/** Older copies with unknown glyphs compared glyph-blind per read (the newest first). */
export const GLYPH_BLIND_OLDER_COPIES = 3;

/**
 * True when `newerText` is `olderText` read again with its unknown glyphs restored (#2598):
 * every character of the older text other than U+FFFD is in the newer text, in order, and only
 * where the older text has a run of n glyphs may the newer text hold up to 3n other characters
 * (a ligature's letters, a decimal point, a Latin-1 character, or the glyph left as it was).
 * Unicode ligatures are compared as their letters, as the readers now write them. Conservative:
 * each piece is taken at its first fit, so a doubtful alignment reads as different text.
 */
export function sameTextGlyphBlind(olderText: string, newerText: string): boolean {
  const older = expandUnicodeLigatures(olderText);
  if (older === newerText) return true;
  if (!older.includes(REPLACEMENT_CHARACTER)) return false;
  let position = 0;
  let slack = 0;
  for (const piece of older.split(/(\uFFFD+)/)) {
    if (piece.startsWith(REPLACEMENT_CHARACTER)) {
      slack = piece.length * MAX_LETTERS_PER_GLYPH;
      continue;
    }
    if (piece.length === 0) continue;
    let found = -1;
    for (let at = position; at <= position + slack && at + piece.length <= newerText.length; at += 1) {
      if (newerText.startsWith(piece, at)) {
        found = at;
        break;
      }
    }
    if (found < 0) return false;
    position = found + piece.length;
    slack = 0;
  }
  return newerText.length - position <= slack;
}

/**
 * At read time, when no older copy has the new read's exact text: the newest older copy of this
 * page with Knox rows whose stored text carries an unknown glyph and is the new text read before
 * glyph repair (`sameTextGlyphBlind`). Older copies are never read again, so their stored text
 * keeps the glyphs a new read of the page now restores, and without this a page whose text did
 * not change would lose the rule once its next copy is read (#2598 with #2477).
 */
export async function glyphBlindSameTextCopyOf(
  db: SqlTag,
  input: { institutionId: number; sourceDocumentId: number; text: string | null },
): Promise<number | null> {
  if (!input.text) return null;
  const rows = await db<Array<{ id: number | string; normalized_text: string }>>`
    SELECT older.id, older_text.normalized_text
      FROM agent_source_texts older_text
      JOIN source_documents older ON older.id = older_text.source_document_id
     WHERE older.superseded_by_id = ${input.sourceDocumentId}
       AND older.institution_id = ${input.institutionId}
       AND older_text.normalized_text ~ ${GLYPH_REPAIR_DUE_PATTERN}
       AND EXISTS (
         SELECT 1 FROM raw_fee_observations older_fr
          WHERE older_fr.source = 'knox'
            AND older_fr.source_document_id = older.id
            AND older_fr.outlier_flags ? 'needs_darwin_verification'
       )
     ORDER BY older.id DESC
     LIMIT ${GLYPH_BLIND_OLDER_COPIES}
  `;
  const match = rows.find((row) => sameTextGlyphBlind(row.normalized_text, input.text!));
  return match == null ? null : Number(match.id);
}

export interface SameTextCopy {
  textId: number;
  sourceDocumentId: number;
  olderDocumentId: number;
  institutionId: number;
  url: string | null;
}

export interface SameTextCopyReopenResult {
  live: boolean;
  /** `wrong_document` current copies the rule covers (up to the limit). */
  candidates: number;
  /** Texts made readable this step (0 in shadow mode). */
  reopened: number;
  sample: SameTextCopy[];
}

/**
 * The backlog: `wrong_document` texts on current copies that the rule covers, rejected before it
 * existed. Shadow by default (SAME_TEXT_COPY_REOPEN_LIVE): counted, sampled and logged only.
 */
export async function reopenSameTextCopies(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; institutionId?: number; stateCode?: string; limit?: number; live?: boolean },
): Promise<SameTextCopyReopenResult> {
  const live = options.live ?? SAME_TEXT_COPY_REOPEN_LIVE;
  const limit = Math.max(1, Math.min(options.limit ?? SAME_TEXT_COPY_REOPEN_LIMIT, SAME_TEXT_COPY_REOPEN_LIMIT));
  const institutionId = options.institutionId ?? null;
  const stateCode = normalizeStateCode(options.stateCode);
  const rows = await db<Array<{
    text_id: number | string;
    source_document_id: number | string;
    institution_id: number | string;
    source_url: string | null;
    text_hash: string;
    older_id: number | string;
  }>>`
    SELECT covered.*
      FROM (
        SELECT adt.id AS text_id, adt.source_document_id, adt.institution_id, adt.source_url, adt.text_hash,
               ${db.unsafe(sameTextKnoxCopyIdSql("adt"))} AS older_id
          FROM agent_source_texts adt
          JOIN source_documents doc ON doc.id = adt.source_document_id
          JOIN institution_sources inst ON inst.id = adt.institution_id
         WHERE adt.status = 'wrong_document'
           AND adt.normalized_text IS NOT NULL
           AND adt.text_hash IS NOT NULL
           AND doc.status = 'success'
           AND doc.superseded_by_id IS NULL
           AND doc.duplicate_of_id IS NULL
           AND (${institutionId}::bigint IS NULL OR adt.institution_id = ${institutionId}::bigint)
           AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode}::text)
      ) covered
     -- The copy named is the copy that qualified: same text hash and Knox rows (#2477 review).
     WHERE covered.older_id IS NOT NULL
     ORDER BY covered.text_id
     LIMIT ${limit}
  `;
  const copies: SameTextCopy[] = rows.map((row) => ({
    textId: Number(row.text_id),
    sourceDocumentId: Number(row.source_document_id),
    olderDocumentId: Number(row.older_id),
    institutionId: Number(row.institution_id),
    url: row.source_url,
  }));
  const result: SameTextCopyReopenResult = { live, candidates: copies.length, reopened: 0, sample: copies.slice(0, SAME_TEXT_COPY_SAMPLE) };
  if (copies.length === 0) return result;
  if (live) {
    for (const [index, copy] of copies.entries()) {
      const write = await preserveStatusChange(db, copy.textId, (scope) => scope`
        UPDATE agent_source_texts
           SET status = 'completed', error_message = NULL, updated_at = NOW()
         WHERE id = ${copy.textId}
           AND status = 'wrong_document'
        RETURNING id
      `);
      const changed = Array.isArray(write.value) && write.value.length > 0;
      if (changed) result.reopened += 1;
      await recordAttempt(db, {
        institutionId: copy.institutionId,
        sourceDocumentId: copy.sourceDocumentId,
        stage: "read",
        strategy: SAME_TEXT_COPY_STRATEGY.strategy,
        version: SAME_TEXT_COPY_STRATEGY.version,
        fingerprint: rows[index].text_hash,
        outcome: changed ? "ok" : "unchanged",
        yieldCount: 0,
        costMicrousd: 0,
        runId: options.runId,
        stepId: options.stepId ?? null,
        detail: { text_id: copy.textId, older_document_id: copy.olderDocumentId, url: copy.url, witness_retention: write.retention },
      });
    }
  }
  await db`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    VALUES (
      ${options.runId}, ${options.stepId ?? null}, ${SAME_TEXT_COPY_EVENT}, 'completed',
      ${live
        ? `Reopened ${result.reopened} current cop(ies) rejected as not a fee page whose older copy of the same page holds the same text and Knox fees`
        : `Would reopen (shadow) ${copies.length} current cop(ies) rejected as not a fee page whose older copy of the same page holds the same text and Knox fees`},
      ${JSON.stringify({ live, candidates: copies.length, reopened: result.reopened, limit, sample: result.sample })}::jsonb
    )
  `;
  return result;
}
