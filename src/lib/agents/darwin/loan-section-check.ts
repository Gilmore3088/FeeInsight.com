import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import {
  HEADING_BULLET,
  ROW_VALUE_WORDS,
  SECTION_DOLLAR_PRICE,
  SECTION_HEADER_ROW,
  SECTION_ROW_PRICE,
  STACKED_PRICE_LINE,
  sectionNamePatternSql,
  sectionWordsSql,
  trimSql,
} from "@/lib/custom-report/card-program-section";
import {
  HEADING_SENTENCE_END,
  LOAN_HEADING_END,
  LOAN_HEADING_MAX_CHARS,
  LOAN_HEADING_MAX_WORDS,
  LOAN_HEADING_WORDS,
  LOAN_SECTION_DEPOSIT_KEYS,
  LOAN_SECTION_DEPOSIT_ROW_WORDS,
  LOAN_SECTION_REACH_LINES,
  NOT_LOAN_HEADING_WORDS,
  PRICE_WORD_CELL,
  loanSectionFee,
} from "@/lib/custom-report/loan-section-fee";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of deposit-category fees printed in a loan section of a general fee
 * schedule (#1905; decision 2026-10-15, "Darwin re-checks every live fee against today's rules").
 * The rule is the shared `loanSectionFee` (`@/lib/custom-report/loan-section-fee`), which Knox v123
 * also applies when it files a read (`loanSectionFeeRead`). It catches Navy Federal's "Equity Loan"
 * section inside `/membership/fees-and-charges.html` (doc 39026), whose "Home Equity Line Check
 * returned (due to non-sufficient funds)" $29 went live as the account's NSF fee (154634) and whose
 * "Tax Service Charge" $25 went live as its monthly maintenance fee (154635), each beside the same
 * fee read from the page's earlier copy as an other lending fee (122342, 122343).
 *
 * A fee comes down when it is live under one of `LOAN_SECTION_DEPOSIT_KEYS`, its name names no
 * deposit account or service, and every line of its document's stored text that prints its name with
 * its price sits in a loan section. Each step reads the next `LOAN_SECTION_DOCUMENT_BATCH` documents
 * after a cursor kept on the run ledger (the `darwin.loan_section` event's `next_after_id`, 0 once a
 * pass reaches the end), only documents behind such a live fee whose text names a loan
 * (`LOAN_TEXT_SQL`). An institution-scoped run reads that institution's documents and leaves the
 * cursor alone.
 *
 * The switch is the code constant `LOAN_SECTION_TAKEDOWN_LIVE`, on since James's yes (2026-10-26). Off (`live: false`), or in a dry
 * run, the step only reports what it would take down. On, a matching fee goes through the shared
 * 12-hour second look (check `darwin.loan_section`) and is archived on its second failure: rolled
 * back with `loan_section: #<doc>`, its verified row rejected with the `loan_section` flag, never
 * deleted, and a `darwin.loan_section_takedown` event lists them. The fee is not re-filed in place:
 * the bank's next read files the row under other lending (Knox v123), still checked by Darwin.
 *
 * Read-only dry run, prod, 2026-10-26 (`loanSectionFeesSql`, the Postgres mirror, in three document
 * ranges for the SQL tool's 60-second limit): 8 live fees at 7 institutions, each read against its
 * bank's stored text and each a loan's fee. See
 * `docs/project/findings/2026-10-26-loan-section-rows-filed-as-deposit-fees.md`.
 */
export const LOAN_SECTION_CHECK = "darwin.loan_section";
export const LOAN_SECTION_CHECK_VERSION = 1;
/** The switch (see the module note): on since James's yes on the dry run (2026-10-26). */
export const LOAN_SECTION_TAKEDOWN_LIVE: boolean = true;
export const LOAN_SECTION_REASON = "loan_section";
export const LOAN_SECTION_FLAG = "loan_section";
/** Documents read per step. */
export const LOAN_SECTION_DOCUMENT_BATCH = 400;
export const LOAN_SECTION_SAMPLES = 20;
/**
 * A text that names a loan anywhere: the only texts read (Postgres `~*`, a plain alternation so it
 * scans fast). Wider than `LOAN_HEADING_WORDS`, never narrower; `loanSectionHeading` does the line
 * test in JS.
 */
export const LOAN_TEXT_SQL = "loan|lending|mortgage|heloc|equity|line[^a-z0-9]*of[^a-z0-9]*credit|credit[^a-z0-9]*line";

export interface LoanSectionFeeRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
}

export interface LoanSectionDocumentRow {
  source_document_id: number | string;
  document_url: string | null;
  normalized_text: string | null;
  fees: LoanSectionFeeRow[] | string | null;
}

export interface LoanSectionMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number;
  canonicalFeeKey: string | null;
  sourceDocumentId: number;
  documentUrl: string;
  reason: string;
}

export interface LoanSectionFindings {
  /** Live deposit-category fees read (on documents whose text names a loan). */
  checked: number;
  documentsRead: number;
  matched: number;
  documents: number;
  institutions: number;
  byCategory: Record<string, number>;
  samples: LoanSectionMatch[];
}

export interface LoanSectionResult extends LoanSectionFindings {
  live: boolean;
  dryRun: boolean;
  scoped: boolean;
  afterId: number;
  /** The next step's cursor: the last document read, or 0 once a pass reaches the end. */
  nextAfterId: number;
  flagged: number;
  waiting: number;
  /** Pending flags this step cleared: live fees in the document range it read that no longer match (#1876). */
  cleared: number;
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function feesOf(row: LoanSectionDocumentRow): LoanSectionFeeRow[] {
  if (Array.isArray(row.fees)) return row.fees;
  if (typeof row.fees === "string") {
    try {
      const parsed = JSON.parse(row.fees) as unknown;
      return Array.isArray(parsed) ? (parsed as LoanSectionFeeRow[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Pure: the live fees on the documents read that are a loan section's rows (see the module note). */
export function findLoanSectionFees(documents: LoanSectionDocumentRow[]): LoanSectionFindings & { matches: LoanSectionMatch[] } {
  const matches: LoanSectionMatch[] = [];
  const seen = new Set<number>();
  let checked = 0;
  for (const document of documents) {
    const documentId = num(document.source_document_id);
    if (documentId == null) continue;
    for (const fee of feesOf(document)) {
      const feeId = Number(fee.fee_published_id);
      if (!Number.isFinite(feeId) || seen.has(feeId)) continue;
      seen.add(feeId);
      checked += 1;
      const amount = num(fee.amount);
      if (amount == null || !loanSectionFee(document.normalized_text, fee.fee_name, amount, fee.canonical_fee_key)) continue;
      matches.push({
        feePublishedId: feeId,
        feeVerifiedId: num(fee.fee_verified_id),
        institutionId: Number(fee.institution_id),
        feeName: fee.fee_name ?? "",
        amount,
        canonicalFeeKey: fee.canonical_fee_key ?? null,
        sourceDocumentId: documentId,
        documentUrl: (document.document_url ?? "").trim(),
        reason: `${LOAN_SECTION_REASON}: #${documentId}`,
      });
    }
  }
  matches.sort((a, b) => a.feePublishedId - b.feePublishedId);
  const byCategory: Record<string, number> = {};
  for (const match of matches) {
    const key = match.canonicalFeeKey ?? "unknown";
    byCategory[key] = (byCategory[key] ?? 0) + 1;
  }
  return {
    checked,
    documentsRead: documents.length,
    matched: matches.length,
    documents: new Set(matches.map((fee) => fee.sourceDocumentId)).size,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    byCategory,
    samples: matches.slice(0, LOAN_SECTION_SAMPLES),
    matches,
  };
}

const DEPOSIT_KEYS_SQL = () => [...LOAN_SECTION_DEPOSIT_KEYS].sort();

/**
 * Read-only: the next documents after `afterId` (by id) behind a live fee in a deposit category the
 * rule reads, whose stored text names a loan, with that text and those live dollar fees. Scoped to
 * one institution, every such document of that institution.
 */
export function loanSectionDocumentsSql(db: SqlTag, options: { institutionId?: number; afterId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const afterId = scoped ? 0 : Math.max(0, Math.trunc(options.afterId ?? 0));
  const limit = Math.max(1, Math.min(options.limit ?? LOAN_SECTION_DOCUMENT_BATCH, 5_000));
  return db<LoanSectionDocumentRow[]>`
    WITH live AS MATERIALIZED (
      SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
             fp.canonical_fee_key, fr.source_document_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount IS NOT NULL
         AND fp.canonical_fee_key = ANY(${DEPOSIT_KEYS_SQL()}::text[])
         AND fr.source_document_id IS NOT NULL
         AND fr.source_document_id > ${afterId}
         AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
    ),
    docs AS MATERIALIZED (
      SELECT ast.source_document_id
        FROM agent_source_texts ast
       WHERE ast.source_document_id IN (SELECT source_document_id FROM live)
         AND ast.normalized_text ~* ${LOAN_TEXT_SQL}
       ORDER BY ast.source_document_id
       LIMIT ${limit}::int
    ),
    grouped AS (
      SELECT docs.source_document_id,
             json_agg(json_build_object(
               'fee_published_id', l.fee_published_id, 'fee_verified_id', l.fee_verified_id,
               'institution_id', l.institution_id, 'fee_name', l.fee_name, 'amount', l.amount,
               'canonical_fee_key', l.canonical_fee_key) ORDER BY l.fee_published_id) AS fees
        FROM docs
        JOIN live l ON l.source_document_id = docs.source_document_id
       GROUP BY docs.source_document_id
    )
    SELECT g.source_document_id, btrim(sd.document_url) AS document_url, ast.normalized_text, g.fees
      FROM grouped g
      JOIN agent_source_texts ast ON ast.source_document_id = g.source_document_id
      LEFT JOIN source_documents sd ON sd.id = g.source_document_id
     ORDER BY g.source_document_id
  `;
}

/** A pattern as a Postgres string literal (quotes doubled; standard_conforming_strings). */
function pgLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Postgres: `loanSectionRow(column)`. */
function loanSectionRowSql(column: string): string {
  return `(${trimSql(column)} ~ ${pgLiteral(SECTION_ROW_PRICE)} OR (strpos(${column}, '|') > 0 AND (lower(${trimSql(column)}) ~ ${pgLiteral(SECTION_HEADER_ROW)} OR ${trimSql(column)} ~* ${pgLiteral(PRICE_WORD_CELL)})))`;
}

/** Postgres: `loanSectionHeading(column)` for a line that is no row. */
function loanSectionHeadingSql(column: string): string {
  const words = sectionWordsSql(column);
  return `(${trimSql(column)} <> '' AND char_length(${trimSql(column)}) <= ${LOAN_HEADING_MAX_CHARS} AND strpos(${column}, '|') = 0
      AND ${trimSql(column)} !~ ${pgLiteral(HEADING_BULLET)} AND ${trimSql(column)} !~ ${pgLiteral(HEADING_SENTENCE_END)}
      AND array_length(regexp_split_to_array(btrim(${words}), ' '), 1) <= ${LOAN_HEADING_MAX_WORDS}
      AND ${words} ~ ${pgLiteral(LOAN_HEADING_WORDS)} AND ${words} ~ ${pgLiteral(LOAN_HEADING_END)}
      AND ${words} !~ ${pgLiteral(NOT_LOAN_HEADING_WORDS)} AND ${words} !~ ${pgLiteral(ROW_VALUE_WORDS)})`;
}

/**
 * The same rule as one read-only SQL statement over the live table, for someone with prod access
 * (the dry-run count): one row per live fee the check would take down, with its section heading and
 * document address. The Postgres mirror of `loanSectionFee`: the same row, header, heading, name and
 * price patterns, and the same reach. Optional document-id bounds split it for a tool with a time
 * limit.
 */
export function loanSectionFeesSql(options: { fromDocumentId?: number; toDocumentId?: number } = {}): string {
  const keys = DEPOSIT_KEYS_SQL().map((key) => `'${key}'`).join(", ");
  const from = Math.max(0, Math.trunc(options.fromDocumentId ?? 0));
  const to = options.toDocumentId == null ? null : Math.trunc(options.toDocumentId);
  return `WITH live AS (
  SELECT fp.fee_published_id, fp.institution_id, fp.fee_name, fp.amount, fp.canonical_fee_key, fr.source_document_id
    FROM published_fee_records fp
    JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
    JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
   WHERE fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL AND fp.amount IS NOT NULL AND fr.source_document_id IS NOT NULL
     AND fp.canonical_fee_key IN (${keys})
     AND fr.source_document_id >= ${from}${to == null ? "" : ` AND fr.source_document_id <= ${to}`}
     AND ${sectionWordsSql("fp.fee_name")} !~ ${pgLiteral(LOAN_SECTION_DEPOSIT_ROW_WORDS)}
), texts AS MATERIALIZED (
  SELECT d.source_document_id, t.normalized_text
    FROM (SELECT DISTINCT source_document_id FROM live) d
    JOIN LATERAL (
      SELECT ast.normalized_text FROM agent_source_texts ast
       WHERE ast.source_document_id = d.source_document_id
    ) t ON TRUE
   WHERE t.normalized_text ~* '${LOAN_TEXT_SQL}'
), all_lines AS (
  SELECT tx.source_document_id, l.n, l.line
    FROM texts tx, regexp_split_to_table(tx.normalized_text, E'\\n') WITH ORDINALITY AS l(line, n)
), lines AS MATERIALIZED (
  SELECT source_document_id, n, line,
         row_number() OVER (PARTITION BY source_document_id ORDER BY n) AS k,
         ${loanSectionRowSql("line")} AS is_row
    FROM all_lines
   WHERE ${trimSql("line")} <> ''
), headed AS (
  SELECT l.*,
         max(CASE WHEN NOT l.is_row THEN l.k END) OVER (PARTITION BY l.source_document_id ORDER BY l.k ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS head_k
    FROM lines l
), section_rows AS MATERIALIZED (
  SELECT h.source_document_id, h.n, ${trimSql("hl.line")} AS heading
    FROM headed h
    JOIN lines hl ON hl.source_document_id = h.source_document_id AND hl.k = h.head_k
    -- The first line under the heading: a bare price there makes the heading a stacked row label.
    JOIN lines fl ON fl.source_document_id = h.source_document_id AND fl.k = h.head_k + 1
   WHERE h.is_row
     AND NOT (fl.is_row AND fl.line ~ ${pgLiteral(STACKED_PRICE_LINE)})
     AND h.k - h.head_k <= ${LOAN_SECTION_REACH_LINES}
     AND h.line ~ ${pgLiteral(SECTION_ROW_PRICE)}
     AND ${sectionWordsSql("h.line")} !~ ${pgLiteral(LOAN_SECTION_DEPOSIT_ROW_WORDS)}
     AND ${loanSectionHeadingSql("hl.line")}
), fees AS (
  SELECT lv.*, ${sectionNamePatternSql("lv.fee_name")} AS name_pattern
    FROM live lv
   WHERE lv.source_document_id IN (SELECT DISTINCT source_document_id FROM section_rows)
), priced AS (
  SELECT f.fee_published_id, al.n, s.heading
    FROM fees f
    JOIN all_lines al ON al.source_document_id = f.source_document_id
    LEFT JOIN section_rows s ON s.source_document_id = al.source_document_id AND s.n = al.n
   WHERE f.name_pattern IS NOT NULL
     AND strpos(al.line, '$') > 0
     AND lower(al.line) ~ f.name_pattern
     AND EXISTS (
       SELECT 1 FROM regexp_matches(substring(lower(al.line) FROM f.name_pattern || '.*$'), ${pgLiteral(SECTION_DOLLAR_PRICE)}, 'g') AS m(price)
        WHERE abs(replace(m.price[1], ',', '')::numeric - f.amount) < 0.005
     )
), judged AS (
  SELECT fee_published_id, min(heading) AS heading FROM priced GROUP BY fee_published_id HAVING bool_and(heading IS NOT NULL)
)
SELECT f.fee_published_id, f.institution_id, f.fee_name, f.amount, f.canonical_fee_key, f.source_document_id,
       j.heading, btrim(sd.document_url) AS document_url
  FROM judged j
  JOIN fees f ON f.fee_published_id = j.fee_published_id
  JOIN source_documents sd ON sd.id = f.source_document_id
 ORDER BY f.fee_published_id;`;
}

async function readCursor(db: SqlTag): Promise<number> {
  try {
    const [row] = await inSavepoint(db, (scope) => scope<{ next_after_id: string | null }[]>`
      SELECT detail->>'next_after_id' AS next_after_id
        FROM agent_run_events
       WHERE event_type = ${LOAN_SECTION_CHECK}
         AND detail->>'next_after_id' IS NOT NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `);
    return num(row?.next_after_id ?? null) ?? 0;
  } catch (error) {
    console.warn("[darwin] loan section cursor read failed", error instanceof Error ? error.message : error);
    return 0;
  }
}

/**
 * One step's share of the re-check (see the module note). Never throws: a failed read reports
 * nothing, and a failed write leaves the fees as they were.
 */
export async function recheckLoanSections(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<LoanSectionResult> {
  const live = options.live ?? LOAN_SECTION_TAKEDOWN_LIVE;
  const scoped = options.institutionId != null;
  const { matches: _none, ...empty } = findLoanSectionFees([]);
  void _none;
  const afterId = scoped ? 0 : await readCursor(db);
  const result: LoanSectionResult = { live, dryRun: options.dryRun, scoped, afterId, nextAfterId: afterId, ...empty, flagged: 0, waiting: 0, cleared: 0, takenDown: [] };

  let documents: LoanSectionDocumentRow[];
  try {
    documents = await inSavepoint(db, (scope) => loanSectionDocumentsSql(scope, { institutionId: options.institutionId, afterId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] loan section check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findLoanSectionFees(documents);
  Object.assign(result, findings);
  const limit = Math.max(1, Math.min(options.limit ?? LOAN_SECTION_DOCUMENT_BATCH, 5_000));
  const lastId = documents.length > 0 ? num(documents[documents.length - 1].source_document_id) : null;
  // A full batch continues after its last document; a short one finished the pass.
  result.nextAfterId = scoped ? afterId : documents.length >= limit && lastId != null ? lastId : 0;

  if (live && !options.dryRun) {
    // The documents this step read in full (#1876): every live fee on a document in
    // (cursor, last document read] -- or to the end on a short batch -- was in its read, so a
    // pending flag there that this step no longer matches clears. A full batch stops at its last
    // document; a fee on a later document waits for the next step. Scoped runs stay in the institution.
    const readScope = {
      institutionId: options.institutionId ?? null,
      documentIdAfter: scoped ? null : afterId,
      documentIdThrough: documents.length >= limit ? lastId : null,
    };
    const look = await secondLook(db, {
      check: LOAN_SECTION_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now, readScope,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    result.cleared = look.cleared;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${LOAN_SECTION_CHECK}, 'completed',
          ${`Read live deposit-category fees for a loan section: ${result.matched} of ${result.checked} live fee(s) on ${result.documents} document(s); ${live ? `${result.flagged} flagged, ${result.cleared} cleared, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(loanSectionDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] loan section check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: LoanSectionMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-loan-section-${runId}`},
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
                   WHEN fv.outlier_flags ? ${LOAN_SECTION_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${LOAN_SECTION_FLAG}::text)
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
    console.error("[darwin] loan section takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: LoanSectionMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.loan_section_takedown', 'completed',
        ${`Archived ${archived.length} live deposit-category fee(s) printed in a loan section, on their second look`},
        ${JSON.stringify({ version: LOAN_SECTION_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] loan section takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: LoanSectionMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    source_document_id: fee.sourceDocumentId,
    document_url: fee.documentUrl,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function loanSectionDetail(result: LoanSectionResult) {
  return {
    check: LOAN_SECTION_CHECK,
    version: LOAN_SECTION_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    after_id: result.afterId,
    next_after_id: result.scoped ? null : result.nextAfterId,
    checked: result.checked,
    documents_read: result.documentsRead,
    matched: result.matched,
    documents: result.documents,
    institutions: result.institutions,
    by_category: result.byCategory,
    flagged: result.flagged,
    waiting: result.waiting,
    cleared: result.cleared,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
