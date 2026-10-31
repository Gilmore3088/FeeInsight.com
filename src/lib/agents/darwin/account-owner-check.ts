import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { opensOnNameNumber, printedNearerThan, withLineupFromText, type AccountLineup } from "@/lib/agents/knox/lineup";
import { accountKind } from "@/lib/account-kind";
import { notAdminCorrectedSql } from "@/lib/fee-correction-guard";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of the account a live monthly maintenance or minimum balance fee is filed
 * under (inst 608; decision 2026-10-15, "Darwin re-checks every live fee against today's rules").
 * Before Knox v141, an account heading that opens on its own number ("360 Checking", "50+ Checking")
 * was no heading to Knox: its digits read as a price or footnote, so the lookback ran past it and
 * filed the fee under the account printed above ("Gold Checking" took 360 Checking's $8.00 monthly
 * fee, live 57400; River Bank's "Easy Checking", which has no monthly fee, took 50+ Checking's $7.00,
 * live 108790). Knox v141 reads such headings on new reads, but a re-read keeps the raw row's stored
 * product, so live fees keep the wrong account.
 *
 * Each Darwin verify step reads the next `ACCOUNT_OWNER_CHECK_BATCH` live Knox fees of those two
 * categories with a stored account (`raw_fee_observations.product_name`, never one a person
 * corrected), after a cursor kept on the run ledger (the `darwin.account_owner_check` event's
 * `next_after_id`, 0 once a pass reaches the end). Only documents whose newest text prints a line
 * opening on a number are read. Each fee is judged by `accountOwnerVerdict`, one of:
 * - `refile`: today's Knox lineup read of the fee's own stored line (`withLineupFromText`) names an
 *   account that opens on its own number, that account's heading is printed on its own line between
 *   the stored account's heading and the fee's line (`printedNearerThan`), and both are the same kind
 *   of account (`accountKind`, told for both), so the account-type hold's answer stands.
 * - kept, reported only: `same` (today's read names the stored account, or none), `other_reason`
 *   (today's read differs, but not by a nearer numbered heading: another rule's change, left to its
 *   own check), `kind_change` (the nearer account is another kind, or one whose kind cannot be told;
 *   left to the account-type hold's owner), `no_text` and `no_excerpt`.
 *
 * Price, category and liveness never change: nothing is taken down. With `ACCOUNT_OWNER_REFILE_LIVE`
 * false (the default) or in a dry run, nothing is written to any fee; a switched-off step records
 * only its counts. Switched on, the raw row's `product_name` takes today's account (guarded on the
 * old value), and a published name that opens on the old account ("Gold Checking Monthly service
 * fee", Hamilton's account name) opens on the new one instead (guarded on the old name). Each change
 * is logged to `pipeline_feedback` (kind `account_owner_refiled`, evidence `from` and `to` for the
 * account and the name, so it is reversed by setting both back) and a `darwin.account_owner_refiled`
 * run event lists the batch.
 *
 * Dry run, prod read-only 2026-10-30: of 2,468 live Knox monthly maintenance and minimum balance fees
 * with a stored account, 2 print a numbered account heading between their stored account and their
 * line (57400 and 108790); both would be re-filed.
 */
export const ACCOUNT_OWNER_CHECK = "darwin.account_owner_check";
export const ACCOUNT_OWNER_CHECK_VERSION = 1;
const ACCOUNT_NAME_SHAPE =
  /^\d{1,3}(?:\+|st|nd|rd|th)?((?:\s+[A-Z][\w'&-]*){0,3})\s+(?:Checking|Savings|Share Certificate|Certificate|CD|Money Market|Club|IRA|Account)(?:\s+(?:Plus|Rewards|Elite|Premier|Preferred|Select|Gold|Platinum|Advantage|Value|Basic|Classic))?$/;
/** Words between the number and the account word that describe accounts rather than name one. */
const NOT_A_NAME_WORD = new Set([
  "of", "great", "simple", "different", "new", "popular", "best", "top", "our", "your", "free", "easy", "smart",
  "tiers", "levels", "kinds", "types", "ways", "choices", "options", "checking", "savings", "account", "accounts",
]);
/**
 * A name built like an account name: the number, then optional words of its own, an account word, and at
 * most one modifier from a short list ("360 Checking", "50+ Checking Rewards", "1st Choice Checking Elite").
 * Marks (®, *, †) are ignored. "2 Checking Account", "3 Great Checking" or "4 Kinds Of Checking" are not
 * names (fourth review of #2812), so Darwin holds them.
 */
function accountNameShaped(name: string): boolean {
  const bare = name.replace(/[®*†‡]/g, "").replace(/\s+/g, " ").trim();
  const match = ACCOUNT_NAME_SHAPE.exec(bare);
  if (!match) return false;
  const middle = match[1].trim().split(" ").filter(Boolean);
  return middle.every((word) => !NOT_A_NAME_WORD.has(word.toLowerCase()));
}
/** The switch, off: on, `refile` fees take today's account; off, a step only counts them. */
export const ACCOUNT_OWNER_REFILE_LIVE = false;
export const ACCOUNT_OWNER_REFILED_KIND = "account_owner_refiled";
export const ACCOUNT_OWNER_REFILED_EVENT = "darwin.account_owner_refiled";
/** Candidate live fees read per step (2,468 in all on Oct 30). */
export const ACCOUNT_OWNER_CHECK_BATCH = 1_000;
const SAMPLES = 20;
const ACCOUNT_CATEGORIES = ["monthly_maintenance", "minimum_balance"];

export type AccountOwnerOutcome = "refile" | "same" | "other_reason" | "kind_change" | "no_text" | "no_excerpt";

export interface AccountOwnerRow {
  fee_published_id: number | string;
  fee_raw_id: number | string;
  institution_id: number | string;
  institution_name?: string | null;
  source_document_id: number | string | null;
  /** The live (published) name. */
  fee_name: string;
  /** The name Knox read, which today's lineup read takes. */
  raw_fee_name: string;
  amount: number | string | null;
  canonical_fee_key: string;
  product_name: string;
  conditions: string | null;
}

export interface AccountOwnerVerdict {
  feePublishedId: number;
  feeRawId: number;
  institutionId: number;
  sourceDocumentId: number | null;
  canonicalFeeKey: string;
  amount: number | null;
  outcome: AccountOwnerOutcome;
  from: string;
  to: string | null;
  feeName: string;
  /** The live name opening on the new account, when it opened on the old one; else null (kept). */
  newFeeName: string | null;
  sourceLine: string | null;
}

const num = (value: number | string | null | undefined) => (value == null || value === "" ? null : Number(value));
const squash = (value: string) => value.replace(/\s+/g, " ").trim();
const same = (a: string, b: string) => squash(a).toLowerCase() === squash(b).toLowerCase();

/** "Gold Checking Monthly service fee" with Gold Checking -> 360 Checking reads "360 Checking Monthly service fee". */
export function renamedForAccount(name: string, from: string, to: string): string | null {
  const head = squash(from);
  const live = squash(name);
  if (!head || live.length <= head.length || live.slice(0, head.length).toLowerCase() !== head.toLowerCase()) return null;
  if (!/\s/.test(live[head.length])) return null;
  return `${squash(to)} ${live.slice(head.length + 1).trim()}`;
}

/** Pure: one live fee's verdict against its document's newest text. */
export function accountOwnerVerdict(row: AccountOwnerRow, text: string | null | undefined): AccountOwnerVerdict {
  const excerpt = excerptOf(row.conditions);
  const amount = num(row.amount);
  const base: AccountOwnerVerdict = {
    feePublishedId: Number(row.fee_published_id),
    feeRawId: Number(row.fee_raw_id),
    institutionId: Number(row.institution_id),
    sourceDocumentId: num(row.source_document_id),
    canonicalFeeKey: row.canonical_fee_key,
    amount,
    outcome: "same",
    from: row.product_name,
    to: null,
    feeName: row.fee_name,
    newFeeName: null,
    sourceLine: excerpt,
  };
  if (!excerpt) return { ...base, outcome: "no_excerpt" };
  if (!text) return { ...base, outcome: "no_text" };
  const today = withLineupFromText(
    { canonicalHint: row.canonical_fee_key, feeName: row.raw_fee_name, excerpt, amount, lineup: null as AccountLineup | null },
    text,
    { institutionName: row.institution_name ?? null },
  ).lineup?.productName ?? null;
  if (!today || same(today, row.product_name)) return base;
  if (!opensOnNameNumber(today) || !printedNearerThan(text, excerpt, today, row.product_name)) {
    return { ...base, outcome: "other_reason", to: today };
  }
  // Only a name built like an account name re-files a live fee: the number, then words that end on an
  // account word or on a short modifier after one ("360 Checking", "50+ Checking Rewards"). A line such
  // as "2 Checking Options" or "50 Checking Account Holders Served" is held (third review of #2812).
  if (!accountNameShaped(today)) {
    return { ...base, outcome: "other_reason", to: today };
  }
  // A kind that cannot be told is held, never assumed (review of #2812).
  const kind = accountKind(today);
  if (kind == null || kind !== accountKind(row.product_name)) {
    return { ...base, outcome: "kind_change", to: today };
  }
  // A footnote mark or a spaced-off ® at the end is not part of the account's name.
  const owner = today.replace(/\s+®$/, "").replace(/[\s*†‡]+$/, "");
  return { ...base, outcome: "refile", to: owner, newFeeName: renamedForAccount(row.fee_name, row.product_name, owner) };
}

export interface AccountOwnerFindings {
  checked: number;
  outcomes: Partial<Record<AccountOwnerOutcome, number>>;
  samples: AccountOwnerVerdict[];
}

export function findAccountOwners(rows: AccountOwnerRow[], texts: Map<number, string>): AccountOwnerFindings & { verdicts: AccountOwnerVerdict[] } {
  const verdicts = rows.map((row) => {
    const documentId = num(row.source_document_id);
    return accountOwnerVerdict(row, documentId == null ? null : texts.get(documentId));
  });
  const outcomes: Partial<Record<AccountOwnerOutcome, number>> = {};
  for (const verdict of verdicts) outcomes[verdict.outcome] = (outcomes[verdict.outcome] ?? 0) + 1;
  return {
    checked: rows.length,
    outcomes,
    samples: verdicts.filter((verdict) => verdict.outcome === "refile" || verdict.outcome === "kind_change").slice(0, SAMPLES),
    verdicts,
  };
}

export interface AccountOwnerResult extends AccountOwnerFindings {
  live: boolean;
  dryRun: boolean;
  afterId: number | null;
  nextAfterId: number | null;
  /** Published fee ids whose account (and, when it opened on it, name) changed. */
  refiled: number[];
}

/** Pure: the `pipeline_feedback` row a re-filed fee is logged with, old values kept for a rollback. */
export function accountOwnerFeedbackRow(verdict: AccountOwnerVerdict, runId: number | null): FeedbackRow {
  return {
    aboutStage: "extract",
    signal: "wrong",
    kind: ACCOUNT_OWNER_REFILED_KIND,
    reportedBy: "darwin",
    checkName: ACCOUNT_OWNER_CHECK,
    aboutVersion: ACCOUNT_OWNER_CHECK_VERSION,
    institutionId: verdict.institutionId,
    sourceDocumentId: verdict.sourceDocumentId,
    feeRawId: verdict.feeRawId,
    feePublishedId: verdict.feePublishedId,
    canonicalFeeKey: verdict.canonicalFeeKey,
    amount: verdict.amount,
    // A record: Knox v141 already reads numbered headings on new reads.
    weight: 0,
    evidence: {
      field: "product_name",
      from: verdict.from,
      to: verdict.to,
      fee_name: { from: verdict.feeName, to: verdict.newFeeName ?? verdict.feeName },
      source_line: verdict.sourceLine,
    },
    runId,
    dedupeKey: `${ACCOUNT_OWNER_CHECK}:v${ACCOUNT_OWNER_CHECK_VERSION}:${verdict.feeRawId}:${verdict.from}:${verdict.to}`,
  };
}

/** The candidate live fees, in id order; `$1` the cursor, `$2` an institution (0 for all), `$3` the limit. */
export const ACCOUNT_OWNER_ROWS_SQL = `
  SELECT fp.fee_published_id, fr.fee_raw_id, fp.institution_id, inst.institution_name, fr.source_document_id,
         fp.fee_name, fr.fee_name AS raw_fee_name, fr.amount, fp.canonical_fee_key, fr.product_name,
         COALESCE(fr.extraction_note, fr.conditions) AS conditions
    FROM published_fee_records fp
    JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
    JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
    LEFT JOIN institution_sources inst ON inst.id = fp.institution_id
   WHERE fp.rolled_back_at IS NULL
     AND fp.quarantined_at IS NULL
     AND fp.canonical_fee_key = ANY(ARRAY[${ACCOUNT_CATEGORIES.map((key) => `'${key}'`).join(", ")}]::text[])
     AND fr.source = 'knox'
     AND NULLIF(btrim(fr.product_name), '') IS NOT NULL
     AND ${notAdminCorrectedSql("fp")}
     AND fp.fee_published_id > $1
     AND ($2::bigint = 0 OR fp.institution_id = $2::bigint)
   ORDER BY fp.fee_published_id
   LIMIT $3::int`;

/** A line that opens on a number and a word: the documents worth reading. */
const NUMBERED_LINE_SQL = String.raw`(^|\n)\s*\d{1,3}(\+|st|nd|rd|th)?\s+[A-Za-z]`;

/** Newest completed text per document, only for documents that print a line opening on a number. */
async function textsFor(db: SqlTag, rows: AccountOwnerRow[]): Promise<Map<number, string>> {
  const documentIds = [...new Set(rows.map((row) => num(row.source_document_id)).filter((id): id is number => id != null))];
  const texts = new Map<number, string>();
  if (documentIds.length === 0) return texts;
  const found = await inSavepoint(db, (scope) => scope.unsafe<Array<{ source_document_id: number | string; normalized_text: string | null }>>(
    `SELECT source_document_id, normalized_text FROM (
       SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
         FROM agent_source_texts
        WHERE source_document_id = ANY($1::bigint[])
          AND status = 'completed'
          AND normalized_text IS NOT NULL
        ORDER BY source_document_id, id DESC
     ) newest
     WHERE normalized_text ~ $2`,
    [documentIds, NUMBERED_LINE_SQL],
  ));
  for (const text of found) {
    if (typeof text.normalized_text === "string") texts.set(Number(text.source_document_id), text.normalized_text);
  }
  return texts;
}

/**
 * Pure: the verdicts after the document prefilter. A fee whose document prints no numbered line is
 * `same` (no numbered heading can be nearer); `no_text` is kept for a fee with no document at all.
 */
function judge(rows: AccountOwnerRow[], texts: Map<number, string>) {
  const found = findAccountOwners(rows, texts);
  for (const verdict of found.verdicts) {
    if (verdict.outcome === "no_text" && verdict.sourceDocumentId != null) verdict.outcome = "same";
  }
  const outcomes: Partial<Record<AccountOwnerOutcome, number>> = {};
  for (const verdict of found.verdicts) outcomes[verdict.outcome] = (outcomes[verdict.outcome] ?? 0) + 1;
  return { ...found, outcomes };
}

async function readCursor(db: SqlTag): Promise<number> {
  const [row] = await inSavepoint(db, (scope) => scope<{ next_after_id: string | null }[]>`
    SELECT detail->>'next_after_id' AS next_after_id
      FROM agent_run_events
     WHERE event_type = ${ACCOUNT_OWNER_CHECK}
       AND detail->>'next_after_id' IS NOT NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `);
  return num(row?.next_after_id ?? null) ?? 0;
}

function verdictDetail(verdict: AccountOwnerVerdict) {
  return {
    fee_published_id: verdict.feePublishedId,
    fee_raw_id: verdict.feeRawId,
    institution_id: verdict.institutionId,
    amount: verdict.amount,
    outcome: verdict.outcome,
    product_name: { from: verdict.from, to: verdict.to },
    fee_name: { from: verdict.feeName, to: verdict.newFeeName ?? verdict.feeName },
    source_line: verdict.sourceLine,
  };
}

/** The findings as ledger detail. */
export function accountOwnerFindingsDetail(found: AccountOwnerFindings) {
  return {
    checked: found.checked,
    outcomes: found.outcomes,
    would_refile: found.outcomes.refile ?? 0,
    samples: found.samples.map(verdictDetail),
  };
}

/** The step detail (and ledger event detail) for one step's share. */
export function accountOwnerDetail(result: AccountOwnerResult) {
  return {
    check: ACCOUNT_OWNER_CHECK,
    version: ACCOUNT_OWNER_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    batch: ACCOUNT_OWNER_CHECK_BATCH,
    after_id: result.afterId,
    next_after_id: result.nextAfterId,
    ...accountOwnerFindingsDetail(result),
    refiled: result.refiled.length,
  };
}

/** One sentence for the verify step's summary; empty when nothing would change. */
export function accountOwnerNote(result: AccountOwnerResult): string {
  const would = result.outcomes.refile ?? 0;
  if (would === 0 && result.refiled.length === 0) return "";
  const mode = result.live && !result.dryRun ? `${result.refiled.length.toLocaleString()} re-filed` : result.dryRun ? "dry run: would re-file, nothing written" : "switch off: would re-file, nothing written";
  return ` Account-owner re-check: ${would.toLocaleString()} of ${result.checked.toLocaleString()} live monthly or minimum balance fee(s) read belong to a numbered account printed nearer their line (${mode}).`;
}

/**
 * One step's share of the live re-check (see the module note). Never throws: a failed read reports
 * nothing checked, and a failed write leaves the fees as they were.
 */
export async function recheckAccountOwners(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number },
): Promise<AccountOwnerResult> {
  const live = options.live ?? ACCOUNT_OWNER_REFILE_LIVE;
  const limit = Math.max(1, Math.min(options.limit ?? ACCOUNT_OWNER_CHECK_BATCH, 20_000));
  const scoped = options.institutionId != null;
  const result: AccountOwnerResult = { live, dryRun: options.dryRun, checked: 0, outcomes: {}, samples: [], afterId: null, nextAfterId: null, refiled: [] };
  let verdicts: AccountOwnerVerdict[];
  try {
    const afterId = scoped ? 0 : await readCursor(db);
    const rows = await inSavepoint(db, (scope) => scope.unsafe<AccountOwnerRow[]>(ACCOUNT_OWNER_ROWS_SQL, [afterId, options.institutionId ?? 0, limit]));
    if (!scoped) {
      result.afterId = afterId;
      result.nextAfterId = rows.length < limit ? 0 : Number(rows[rows.length - 1].fee_published_id);
    }
    const found = judge(rows, await textsFor(db, rows));
    Object.assign(result, { checked: found.checked, outcomes: found.outcomes, samples: found.samples });
    verdicts = found.verdicts;
  } catch (error) {
    console.warn("[darwin] account owner check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const refiles = verdicts.filter((verdict) => verdict.outcome === "refile" && verdict.to);

  if (live && !options.dryRun && refiles.length > 0) {
    let written: AccountOwnerVerdict[] = [];
    try {
      written = await inSavepoint(db, async (scope) => {
        const landed: AccountOwnerVerdict[] = [];
        for (const fix of refiles) {
          // Only while the raw row still holds the account judged wrong.
          const raw = await scope<{ fee_raw_id: number | string }[]>`
            UPDATE raw_fee_observations SET product_name = ${fix.to}
             WHERE fee_raw_id = ${fix.feeRawId} AND product_name = ${fix.from}
            RETURNING fee_raw_id
          `;
          if (raw.length === 0) continue;
          if (fix.newFeeName) {
            await scope`
              UPDATE published_fee_records SET fee_name = ${fix.newFeeName}
               WHERE fee_published_id = ${fix.feePublishedId} AND fee_name = ${fix.feeName}
                 AND rolled_back_at IS NULL AND quarantined_at IS NULL
            `;
          }
          landed.push(fix);
        }
        if (landed.length > 0) await recordFeedback(scope, landed.map((fix) => accountOwnerFeedbackRow(fix, options.runId)));
        return landed;
      });
    } catch (error) {
      console.error("[darwin] account owner refile failed", error instanceof Error ? error.message : error);
      written = [];
    }
    result.refiled = written.map((fix) => fix.feePublishedId);
    if (written.length > 0) {
      try {
        await inSavepoint(db, (scope) => scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${options.stepId ?? null}, ${ACCOUNT_OWNER_REFILED_EVENT}, 'completed',
            ${`Re-filed ${written.length} live monthly or minimum balance fee(s) under the numbered account printed nearer their line; price and category unchanged, old values kept in pipeline_feedback`},
            ${JSON.stringify({ version: ACCOUNT_OWNER_CHECK_VERSION, refiled: written.length, samples: written.slice(0, SAMPLES).map(verdictDetail) })}::jsonb
          )
        `);
      } catch (error) {
        console.error("[darwin] account owner refile event failed", error instanceof Error ? error.message : error);
      }
      invalidatePublicReadCache();
    }
  }

  // The step's report, which also carries the cursor for the next step. A dry run writes nothing.
  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${ACCOUNT_OWNER_CHECK}, 'completed',
          ${`Read ${result.checked} live monthly or minimum balance fee(s) with a stored account: ${result.outcomes.refile ?? 0} belong to a numbered account printed nearer their line; ${live ? `${result.refiled.length} re-filed` : "switch off, nothing written"}`},
          ${JSON.stringify(accountOwnerDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] account owner check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/**
 * The dry-run count over the whole live table in one read (nothing written, no cursor), for the
 * count James sees before the switch goes on. Run it with the verify step's `account_owner_full_count` param.
 */
export async function countAccountOwners(db: SqlTag): Promise<AccountOwnerFindings | null> {
  try {
    const rows = await inSavepoint(db, (scope) => scope.unsafe<AccountOwnerRow[]>(ACCOUNT_OWNER_ROWS_SQL, [0, 0, 1_000_000]));
    const found = judge(rows, await textsFor(db, rows));
    return { checked: found.checked, outcomes: found.outcomes, samples: found.samples };
  } catch (error) {
    console.warn("[darwin] account owner full count failed", error instanceof Error ? error.message : error);
    return null;
  }
}
