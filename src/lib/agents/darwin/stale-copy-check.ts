import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { currentCopyVerdict } from "@/lib/agents/hamilton/current-copy";
import { NEWER_COPY_MIN_SHARED_FEES, NEWER_COPY_MIN_SHARED_SHARE, squash } from "@/lib/agents/hamilton/newer-copy-retire";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";
import { sameProduct } from "@/lib/fee-product";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fees still read from a superseded copy of their bank's page (Nov 2 audit:
 * 7,035 live fees, 6,720 of them flat dollar fees, cite 2,364 superseded copies; James's live check
 * found Citizens Savings Bank (IA, institution 3416) showing "Overdraft charge" $25 from the current
 * copy beside "Overdraft Fee" $25 from the February copy of the same page).
 *
 * Why the existing machinery leaves them live (prod, read-only, Nov 2):
 * - Hamilton's refresh-copy (`hamilton/refresh-copy.ts`) moves a fee onto the current copy only when
 *   the current copy's row is the same line under the same tidied name. A current-copy row Knox read
 *   under another name ("Overdraft charge" for "Overdraft Fee") is already live in its own right, so
 *   the pair is skipped (`name_differs`, `pair_taken`) and both stay live.
 * - Hamilton's current-copy check (`hamilton/current-copy.ts`) skips every fee whose current copy has
 *   a verified row at the same category and amount (`restated_row`, refresh-copy's job), so that twin
 *   is never judged by anyone; and its takedown (`CURRENT_COPY_CONFIRM_LIVE`) is off because its text
 *   matcher alone flagged fees the current copy still prints (hand checks, #2477, #2072).
 * Measured: 759 live flat fees have a live fee of the same category and amount read from their
 * current copy (356 of them also of the same audience and product), and 4,500 sit on copies whose
 * current copy's text Knox has read at a rules version at least the fee's own, but only 123 at v155
 * and none yet at v156.
 *
 * This check settles each such fee one of two ways, each on the current copy's stored text, judged
 * with the one shared source check (`checkFeeAgainstSource`):
 * - Twin (`twin`): a live fee read from the current copy is the same line: same category, amount,
 *   audience and product; the current text states the twin at that amount; the stale fee does not
 *   trace on the current text to any other line; and either the twin has the stale fee's name or the
 *   twin's current line is the line the stale fee traces to on the older copy. The stale fee is the
 *   double count and comes down, reason `stale_copy_twin: kept #<twin> (#<old> -> #<current>)`. A
 *   stale fee printed on a line of its own stays (`stated`), and a same-price fee on another line
 *   ("Checking Dormant Charges" for "Savings Dormant Charges") is no twin. No Knox version is needed:
 *   the twin is the current copy's own verified read of the line.
 * - Dropped (`dropped`): no twin, and all of: Knox has read the current copy's stored text (same text
 *   hash) at the current rules version or later (`KNOX_RULES_STRATEGY.version`, and never below the
 *   fee's own read version); the older copy's text states the fee (else the matcher's miss,
 *   `unproven`); the current text does not (`checkFeeAgainstSource` fails) and Hamilton's current-copy
 *   verdict, with its layout and change-notice guards, does not call it stated or unproven; Knox's
 *   read of the current copy has no row at the fee's amount under the same name; and the current copy
 *   is recognizably the same schedule (it states at least `NEWER_COPY_MIN_SHARED_FEES` and
 *   `NEWER_COPY_MIN_SHARED_SHARE` of the older copy's judged live fees, or carries their twins). Then
 *   the fee comes down, reason `stale_copy_dropped: not on current copy #<current> (Knox v<n>)`.
 * Every other fee stays live, counted by why: `stated` (the current copy prints it; refresh-copy's or
 * the next re-read's to move), `waiting_reread` (Knox has not read the current text at the current
 * version: the re-read backlog's job), `knox_reads_it`, `unproven`, `not_same_schedule`, `no_text`.
 *
 * Admin-corrected and quarantined fees are never read; only flat dollar fees above $0 are judged.
 * Switched on, a fee to retire goes through the shared 12-hour second look (check
 * `darwin.stale_copy`) and is archived on its second failure: rolled back with its reason, its
 * verified row rejected with the `stale_copy` flag so publish does not bring it back, never deleted;
 * a twin retire also requires the twin to be live in the same write. A `darwin.stale_copy_takedown`
 * event lists them. With `STALE_COPY_RETIRE_LIVE` false (the default), or in a dry run, the step only
 * reports. Each step reads the next `STALE_COPY_DOCUMENT_LIMIT` superseded copies after a cursor kept
 * on the run ledger (the `darwin.stale_copy` event's `next_after_id`, 0 once a pass reaches the end),
 * so every copy is read again on the next pass and a first look meets its second. An
 * institution-scoped run reads that institution's copies and leaves the cursor alone.
 */
export const STALE_COPY_CHECK = "darwin.stale_copy";
export const STALE_COPY_CHECK_VERSION = 1;
export const STALE_COPY_RETIRE_LIVE = false;
export const STALE_COPY_FLAG = "stale_copy";
export const STALE_COPY_TWIN_REASON_PREFIX = "stale_copy_twin: kept #";
export const STALE_COPY_DROPPED_REASON_PREFIX = "stale_copy_dropped: not on current copy #";
export const STALE_COPY_BATCH_PREFIX = "darwin-stale-copy-";
export const STALE_COPY_DOCUMENT_LIMIT = 60;
export const STALE_COPY_SAMPLES = 20;

export type StaleCopyVerdict =
  | "twin"
  | "dropped"
  | "stated"
  | "waiting_reread"
  | "knox_reads_it"
  | "unproven"
  | "not_same_schedule"
  | "no_text";

export const STALE_COPY_VERDICTS: readonly StaleCopyVerdict[] = [
  "twin", "dropped", "stated", "waiting_reread", "knox_reads_it", "unproven", "not_same_schedule", "no_text",
];

/** One live fee read from a superseded copy, with its bank's current copy of the page. */
export interface StaleCopyFeeRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  older_document_id: number | string;
  current_document_id: number | string;
  canonical_fee_key: string | null;
  fee_name: string;
  amount: number | string | null;
  product_name: string | null;
  fee_audience: string | null;
  /** Highest Knox rules version that read the older copy (null: read before the ledger). */
  fee_read_version: number | string | null;
  /** Highest Knox rules version that read the current copy's stored text (its text hash). */
  current_read_version: number | string | null;
}

/** A live fee read from the current copy. */
export interface StaleCopyTwinRow {
  fee_published_id: number | string;
  current_document_id: number | string;
  canonical_fee_key: string | null;
  fee_name: string;
  amount: number | string | null;
  product_name: string | null;
  fee_audience: string | null;
}

/** A row Knox read from the current copy, live or not. */
export interface StaleCopyRawRow {
  current_document_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
}

export interface StaleCopyDocumentInput {
  fees: StaleCopyFeeRow[];
  twins: StaleCopyTwinRow[];
  rawRows: StaleCopyRawRow[];
  currentText: string | null;
  olderText: string | null;
  /** The rules version a current-copy read must reach before Knox's silence counts; defaults to Knox's current one. */
  knoxVersion?: number;
}

export interface StaleCopyJudgement {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  sourceDocumentId: number;
  currentDocumentId: number;
  canonicalFeeKey: string | null;
  feeName: string;
  amount: number | null;
  verdict: StaleCopyVerdict;
  /** The twin kept, for a `twin` verdict. */
  keptFeePublishedId: number | null;
  /** The current-copy line the fee (or its twin) traces to, when one does. */
  currentLine: string | null;
  reason: string;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const sameAmount = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) < 0.005;
const audienceKey = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

function trace(text: string, name: string, amount: number, key: string | null) {
  return checkFeeAgainstSource(text, name, amount, ".", key);
}

/**
 * Pure: one superseded copy's live fees judged against its current copy (see the module note). Every
 * fee gets one verdict; only `twin` and `dropped` retire.
 */
export function judgeStaleCopyDocument(input: StaleCopyDocumentInput): StaleCopyJudgement[] {
  const knoxVersion = input.knoxVersion ?? KNOX_RULES_STRATEGY.version;
  const currentText = input.currentText ?? "";
  const olderText = input.olderText ?? "";
  const judged = input.fees.map((fee) => {
    const amount = num(fee.amount);
    const base: StaleCopyJudgement = {
      feePublishedId: Number(fee.fee_published_id),
      feeVerifiedId: num(fee.fee_verified_id),
      institutionId: Number(fee.institution_id),
      sourceDocumentId: Number(fee.older_document_id),
      currentDocumentId: Number(fee.current_document_id),
      canonicalFeeKey: fee.canonical_fee_key,
      feeName: (fee.fee_name ?? "").trim(),
      amount,
      verdict: "unproven",
      keptFeePublishedId: null,
      currentLine: null,
      reason: "",
    };
    if (!currentText.trim()) return { ...base, verdict: "no_text" as const };
    if (amount == null || !(amount > 0)) return base;
    const own = trace(currentText, base.feeName, amount, fee.canonical_fee_key);
    const older = trace(olderText, base.feeName, amount, fee.canonical_fee_key);
    const lineOf = (result: ReturnType<typeof trace>) => (result.ok ? squash(result.sourceLine) : null);

    // Twin: the current copy's own live read of the same line.
    for (const twin of input.twins) {
      if (Number(twin.current_document_id) !== base.currentDocumentId) continue;
      if (Number(twin.fee_published_id) === base.feePublishedId) continue;
      if ((twin.canonical_fee_key ?? "") !== (fee.canonical_fee_key ?? "")) continue;
      if (!sameAmount(num(twin.amount), amount)) continue;
      if (audienceKey(twin.fee_audience) !== audienceKey(fee.fee_audience) || !sameProduct(twin.product_name, fee.product_name)) continue;
      const twinTrace = trace(currentText, twin.fee_name, amount, twin.canonical_fee_key);
      if (!twinTrace.ok) continue;
      const twinLine = squash(twinTrace.sourceLine);
      // The stale fee printed on a line of its own on the current copy is another fee, not this twin.
      if (own.ok && lineOf(own) !== twinLine) continue;
      // Same line: the twin has the stale fee's name, or reads the very line the stale fee was read
      // from on the older copy ("An overdraft charge of $25.00 per presentment …" read as "Overdraft
      // Fee" in February and "Overdraft charge" in October). A same-price fee on another line
      // ("Checking Dormant Charges" beside "Savings Dormant Charges") is no twin.
      if (squash(twin.fee_name) !== squash(base.feeName) && lineOf(older) !== twinLine) continue;
      const kept = Number(twin.fee_published_id);
      return {
        ...base,
        verdict: "twin" as const,
        keptFeePublishedId: kept,
        currentLine: twinTrace.sourceLine.slice(0, 300),
        reason: `${STALE_COPY_TWIN_REASON_PREFIX}${kept} (#${base.sourceDocumentId} -> #${base.currentDocumentId})`,
      };
    }
    if (own.ok) return { ...base, verdict: "stated" as const, currentLine: own.sourceLine.slice(0, 300) };

    const required = Math.max(knoxVersion, num(fee.fee_read_version) ?? 0);
    const readAt = num(fee.current_read_version);
    if (readAt == null || readAt < required) return { ...base, verdict: "waiting_reread" as const };
    if (!older.ok) return base;
    const layout = currentCopyVerdict(
      {
        fee_published_id: base.feePublishedId,
        fee_verified_id: base.feeVerifiedId ?? 0,
        institution_id: base.institutionId,
        older_document_id: base.sourceDocumentId,
        current_document_id: base.currentDocumentId,
        canonical_fee_key: fee.canonical_fee_key ?? "",
        fee_name: base.feeName,
        amount,
        product_name: fee.product_name,
        restated_row: false,
      },
      currentText,
      olderText,
    );
    if (layout === "still_stated") return { ...base, verdict: "stated" as const };
    if (layout !== "dropped" && layout !== "still_named") return base;
    const ownName = squash(base.feeName);
    const knoxRow = input.rawRows.some((row) =>
      Number(row.current_document_id) === base.currentDocumentId
      && sameAmount(num(row.amount), amount)
      && squash(row.fee_name ?? "") === ownName);
    if (knoxRow) return { ...base, verdict: "knox_reads_it" as const };
    return {
      ...base,
      verdict: "dropped" as const,
      reason: `${STALE_COPY_DROPPED_REASON_PREFIX}${base.currentDocumentId} (Knox v${readAt}; read from #${base.sourceDocumentId})`,
    };
  });

  // Same schedule: the current copy must carry enough of the older copy's fees for its silence to count.
  const proven = judged.filter((fee) => fee.verdict === "twin" || fee.verdict === "stated" || fee.verdict === "dropped");
  const carried = proven.filter((fee) => fee.verdict !== "dropped").length;
  const recognized = carried >= NEWER_COPY_MIN_SHARED_FEES && carried >= proven.length * NEWER_COPY_MIN_SHARED_SHARE;
  return recognized ? judged : judged.map((fee) => (fee.verdict === "dropped" ? { ...fee, verdict: "not_same_schedule" as const, reason: "" } : fee));
}

export interface StaleCopyFindings {
  documents: number;
  checked: number;
  byVerdict: Record<StaleCopyVerdict, number>;
  /** Fees to retire (`twin` + `dropped`). */
  matched: number;
  institutions: number;
  samples: StaleCopyJudgement[];
}

export interface StaleCopyResult extends StaleCopyFindings {
  live: boolean;
  dryRun: boolean;
  scoped: boolean;
  knoxVersion: number;
  afterId: number;
  /** The next step's cursor: the last copy read on a full batch, or 0 once a pass reaches the end. */
  nextAfterId: number;
  flagged: number;
  waiting: number;
  cleared: number;
  takenDown: number[];
}

function emptyVerdicts(): Record<StaleCopyVerdict, number> {
  return Object.fromEntries(STALE_COPY_VERDICTS.map((verdict) => [verdict, 0])) as Record<StaleCopyVerdict, number>;
}

/** Pure: the findings over many documents' judgements. */
export function staleCopyFindings(judgements: StaleCopyJudgement[]): StaleCopyFindings & { retire: StaleCopyJudgement[] } {
  const byVerdict = emptyVerdicts();
  for (const fee of judgements) byVerdict[fee.verdict] += 1;
  const retire = judgements.filter((fee) => fee.verdict === "twin" || fee.verdict === "dropped");
  return {
    documents: new Set(judgements.map((fee) => fee.sourceDocumentId)).size,
    checked: judgements.length,
    byVerdict,
    matched: retire.length,
    institutions: new Set(retire.map((fee) => fee.institutionId)).size,
    samples: retire.slice(0, STALE_COPY_SAMPLES),
    retire,
  };
}

/**
 * Read-only: the live flat fees on up to `limit` superseded copies (oldest copy first), each with the
 * newest copy at the end of its `superseded_by_id` chain and the Knox rules versions that read each.
 */
export function staleCopyRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number; afterId?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = Math.max(1, Math.min(options.limit ?? STALE_COPY_DOCUMENT_LIMIT, 5_000));
  return db<StaleCopyFeeRow[]>`
    WITH RECURSIVE live AS MATERIALIZED (
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fr.source_document_id AS older_document_id,
             sd.superseded_by_id, fp.canonical_fee_key, fp.fee_name, fp.amount, fr.product_name, fp.fee_audience
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        JOIN source_documents sd ON sd.id = fr.source_document_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount_kind = 'flat'
         AND fp.amount > 0
         AND sd.superseded_by_id IS NOT NULL
         AND sd.superseded_by_id <> sd.id
         -- notAdminCorrectedSql("fp") (fee-correction-guard), inline for the tagged template.
         AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
         AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
    ), docs AS MATERIALIZED (
      SELECT DISTINCT older_document_id, superseded_by_id FROM live
       WHERE older_document_id > ${options.afterId ?? 0}::bigint
       ORDER BY older_document_id LIMIT ${limit}::int
    ), chain AS (
      -- The newest copy at the end of the page's chain: a copy can itself be superseded.
      SELECT d.older_document_id, d.superseded_by_id AS current_document_id, 1 AS depth FROM docs d
      UNION ALL
      SELECT c.older_document_id, s.superseded_by_id, c.depth + 1
        FROM chain c JOIN source_documents s ON s.id = c.current_document_id
       WHERE s.superseded_by_id IS NOT NULL AND s.superseded_by_id <> s.id AND c.depth < 20
    ), current_copy AS (
      SELECT DISTINCT ON (older_document_id) older_document_id, current_document_id FROM chain ORDER BY older_document_id, depth DESC
    ), current_text AS (
      SELECT DISTINCT ON (t.source_document_id) t.source_document_id, t.text_hash
        FROM agent_source_texts t JOIN current_copy cc ON cc.current_document_id = t.source_document_id
       WHERE t.status = 'completed' AND t.normalized_text IS NOT NULL
       ORDER BY t.source_document_id, t.id DESC
    )
    SELECT live.fee_published_id, live.fee_verified_id, live.institution_id, live.older_document_id, cc.current_document_id,
           live.canonical_fee_key, live.fee_name, live.amount, live.product_name, live.fee_audience,
           (SELECT MAX(pa.strategy_version) FROM pipeline_attempts pa
             WHERE pa.source_document_id = live.older_document_id AND pa.stage = 'extract' AND pa.strategy = ${KNOX_RULES_STRATEGY.strategy}) AS fee_read_version,
           (SELECT MAX(pa.strategy_version) FROM pipeline_attempts pa
             WHERE pa.source_document_id = cc.current_document_id AND pa.stage = 'extract' AND pa.strategy = ${KNOX_RULES_STRATEGY.strategy}
               AND pa.input_fingerprint = ct.text_hash) AS current_read_version
      FROM live
      JOIN current_copy cc ON cc.older_document_id = live.older_document_id
      LEFT JOIN current_text ct ON ct.source_document_id = cc.current_document_id
     ORDER BY live.older_document_id, live.fee_published_id
  `;
}

/** Read-only: live flat fees read from the given current copies. */
function currentTwinsSql(db: SqlTag, currentIds: number[]) {
  return db<StaleCopyTwinRow[]>`
      SELECT fp.fee_published_id, fr.source_document_id AS current_document_id, fp.canonical_fee_key, fp.fee_name, fp.amount,
             fr.product_name, fp.fee_audience
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL AND fp.amount_kind = 'flat'
         AND fr.source_document_id = ANY(${currentIds}::bigint[])
  `;
}

/** Read-only: every row Knox read from the given current copies. */
function currentRawRowsSql(db: SqlTag, currentIds: number[]) {
  return db<StaleCopyRawRow[]>`
    SELECT source_document_id AS current_document_id, fee_name, amount
      FROM raw_fee_observations WHERE source_document_id = ANY(${currentIds}::bigint[])
  `;
}

async function readCursor(db: SqlTag): Promise<number> {
  try {
    const [row] = await inSavepoint(db, (scope) => scope<{ next_after_id: string | null }[]>`
      SELECT detail->>'next_after_id' AS next_after_id
        FROM agent_run_events
       WHERE event_type = ${STALE_COPY_CHECK}
         AND detail->>'next_after_id' IS NOT NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `);
    return num(row?.next_after_id ?? null) ?? 0;
  } catch (error) {
    console.warn("[darwin] stale copy cursor read failed", error instanceof Error ? error.message : error);
    return 0;
  }
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a failed
 * write leaves the fees as they were.
 */
export async function recheckStaleCopies(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date; knoxVersion?: number },
): Promise<StaleCopyResult> {
  const live = options.live ?? STALE_COPY_RETIRE_LIVE;
  const knoxVersion = options.knoxVersion ?? KNOX_RULES_STRATEGY.version;
  const scoped = options.institutionId != null;
  const afterId = scoped ? 0 : await readCursor(db);
  const limit = Math.max(1, Math.min(options.limit ?? STALE_COPY_DOCUMENT_LIMIT, 5_000));
  const result: StaleCopyResult = {
    live, dryRun: options.dryRun, scoped, knoxVersion, afterId, nextAfterId: afterId,
    documents: 0, checked: 0, byVerdict: emptyVerdicts(), matched: 0, institutions: 0, samples: [],
    flagged: 0, waiting: 0, cleared: 0, takenDown: [],
  };

  let judgements: StaleCopyJudgement[];
  try {
    judgements = await inSavepoint(db, async (scope) => {
      const fees = await staleCopyRowsSql(scope, { institutionId: options.institutionId, limit, afterId });
      const olderIds = [...new Set(fees.map((fee) => Number(fee.older_document_id)))];
      // A full batch continues after its last copy; a short one finished the pass.
      result.nextAfterId = scoped ? afterId : olderIds.length >= limit ? Math.max(...olderIds) : 0;
      if (fees.length === 0) return [];
      const currentIds = [...new Set(fees.map((fee) => Number(fee.current_document_id)))];
      const ids = [...new Set([...currentIds, ...fees.map((fee) => Number(fee.older_document_id))])];
      const twins = await currentTwinsSql(scope, currentIds);
      const raw = await currentRawRowsSql(scope, currentIds);
      const texts = await scope<{ source_document_id: number | string; normalized_text: string }[]>`
        SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
          FROM agent_source_texts
         WHERE source_document_id = ANY(${ids}::bigint[]) AND status = 'completed' AND normalized_text IS NOT NULL
         ORDER BY source_document_id, id DESC
      `;
      const text = new Map(texts.map((row) => [Number(row.source_document_id), row.normalized_text]));
      const byDocument = new Map<number, StaleCopyFeeRow[]>();
      for (const fee of fees) {
        const id = Number(fee.older_document_id);
        byDocument.set(id, [...(byDocument.get(id) ?? []), fee]);
      }
      return [...byDocument.values()].flatMap((docFees) => {
        const currentId = Number(docFees[0].current_document_id);
        return judgeStaleCopyDocument({
          fees: docFees,
          twins: twins.filter((twin) => Number(twin.current_document_id) === currentId),
          rawRows: raw.filter((row) => Number(row.current_document_id) === currentId),
          currentText: text.get(currentId) ?? null,
          olderText: text.get(Number(docFees[0].older_document_id)) ?? null,
          knoxVersion,
        });
      });
    });
  } catch (error) {
    console.warn("[darwin] stale copy check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { retire, ...findings } = staleCopyFindings(judgements);
  Object.assign(result, findings);

  if (live && !options.dryRun) {
    const retiring = new Set(retire.map((fee) => fee.feePublishedId));
    const passing = judgements.filter((fee) => !retiring.has(fee.feePublishedId) && fee.verdict === "stated").map((fee) => fee.feePublishedId);
    const unjudged = judgements.filter((fee) => !retiring.has(fee.feePublishedId) && fee.verdict !== "stated").map((fee) => fee.feePublishedId);
    const look = await secondLook(db, { check: STALE_COPY_CHECK, runId: options.runId, failing: retire, passing, unjudged, dryRun: false, now: options.now });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    result.cleared = look.cleared;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  if (!options.dryRun && (result.checked > 0 || result.nextAfterId !== afterId)) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${STALE_COPY_CHECK}, 'completed',
          ${`Read ${result.checked} live fee(s) on ${result.documents} superseded cop${result.documents === 1 ? "y" : "ies"}: ${result.byVerdict.twin} twin(s) of a live current-copy fee, ${result.byVerdict.dropped} not on the current copy, ${result.byVerdict.stated} still stated, ${result.byVerdict.waiting_reread} waiting on a Knox v${knoxVersion} read; ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would retire, nothing written"}`},
          ${JSON.stringify(staleCopyDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] stale copy check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/**
 * Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never
 * deleted. A twin retire needs its kept twin still live in the same write, so the line keeps a reading.
 */
async function archive(db: SqlTag, runId: number, fees: StaleCopyJudgement[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`${STALE_COPY_BATCH_PREFIX}${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[],
                      ${fees.map((fee) => fee.amount ?? 0)}::numeric[], ${fees.map((fee) => fee.keptFeePublishedId ?? 0)}::bigint[])
               AS v(fee_published_id, reason, amount, kept_id)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.amount = v.amount
           AND fp.rolled_back_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
           AND (v.kept_id = 0 OR EXISTS (
             SELECT 1 FROM published_fee_records kept WHERE kept.fee_published_id = v.kept_id AND kept.rolled_back_at IS NULL
           ))
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const verified = fees.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
      if (verified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${STALE_COPY_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${STALE_COPY_FLAG}::text)
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
    console.error("[darwin] stale copy takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: StaleCopyJudgement[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.stale_copy_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) read from a superseded copy of their page, on their second look`},
        ${JSON.stringify({ version: STALE_COPY_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] stale copy takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: StaleCopyJudgement) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    older_document_id: fee.sourceDocumentId,
    current_document_id: fee.currentDocumentId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    verdict: fee.verdict,
    kept_fee_published_id: fee.keptFeePublishedId,
    current_line: fee.currentLine,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function staleCopyDetail(result: StaleCopyResult) {
  return {
    check: STALE_COPY_CHECK,
    version: STALE_COPY_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    knox_version: result.knoxVersion,
    after_id: result.afterId,
    next_after_id: result.scoped ? null : result.nextAfterId,
    documents: result.documents,
    checked: result.checked,
    by_verdict: result.byVerdict,
    matched: result.matched,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    cleared: result.cleared,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
