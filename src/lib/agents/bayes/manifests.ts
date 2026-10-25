import { sql } from "@/lib/data-store/connection";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";
import { countKnoxRereadsDue } from "@/lib/agents/knox/extract";
import { CATEGORY_GUARD_VERSION } from "@/lib/fee-category-guard";
import { FREQUENCY_FILL_VERSION } from "@/lib/agents/hamilton/frequency-fill";
import { countCurrentCopyPairs, CURRENT_COPY_STRATEGY } from "@/lib/agents/hamilton/current-copy";
import { countRetidyReplay, NAME_RETIDY_STRATEGY } from "@/lib/agents/knox/name-retidy";
import { DARWIN_VERIFY_STRATEGY, darwinDueSql } from "@/lib/agents/darwin/verify";
import { DARWIN_PEER_GRADED_VERSIONS, DARWIN_PEER_STRATEGY } from "@/lib/agents/darwin/peer-checks";
import { pdfStackedPersistedSql, pdfStackedFailedReviewSql } from "@/lib/agents/rosetta/pdf-stacked-repair";
import { PUBLISHER_AGENT_NAMES } from "@/lib/agents/gutenberg/names";

type SqlTag = typeof sql;

/**
 * Bayes's impact manifests (Agentic OS PRD 8.3): every versioned rule or parser declares what
 * an older version processed and how today's version reaches it. The ledger counts each one
 * per change (`ledger.ts`); a change whose reach cannot be counted yet says so instead of
 * reading as finished.
 *
 * Counts use the owning agent's own selection where one exists (Knox's due-text query, the
 * registry scheduler's stale-parser test, the retidy's due institutions), so "queued" means work the agent will really pick up.
 */

export interface ReplayCount {
  /** Records an older version processed, or the one run a change needs. */
  affected: number;
  /** Already processed at this version. */
  done: number;
  /** The owner's own selection will process these again. */
  queued: number;
  /** Left on the older result on purpose, by reason. */
  exclusions: Record<string, number>;
  note?: string;
}

export interface ReplayManifest {
  key: string;
  owner: "knox" | "darwin" | "hamilton" | "magellan" | "rosetta";
  stage: string | null;
  strategy: string | null;
  version: number;
  /** The change key's version part when one number does not name the change. */
  versionLabel?: string;
  unit: string;
  affects: string;
  /** Null when the reach of this change cannot be counted yet; `notCounted` says why. */
  count: ((db: SqlTag) => Promise<ReplayCount>) | null;
  notCounted?: string;
}

const n = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0);

export function changeKey(manifest: Pick<ReplayManifest, "key" | "version" | "versionLabel">): string {
  return `${manifest.key}@${manifest.versionLabel ?? manifest.version}`;
}

/** Knox rules: every current copy an older rules version read. */
async function countKnoxRules(db: SqlTag): Promise<ReplayCount> {
  const [row] = await db<Array<{ affected: number | string; done: number | string }>>`
    WITH read_version AS (
      SELECT institution_id, input_fingerprint, MAX(strategy_version) AS version
        FROM pipeline_attempts
       WHERE stage = 'extract' AND strategy = ${KNOX_RULES_STRATEGY.strategy}
       GROUP BY institution_id, input_fingerprint
    )
    SELECT COUNT(*) FILTER (WHERE rv.version IS NOT NULL) AS affected,
           COUNT(*) FILTER (WHERE rv.version >= ${KNOX_RULES_STRATEGY.version}) AS done
      FROM agent_source_texts t
      JOIN source_documents doc ON doc.id = t.source_document_id AND doc.superseded_by_id IS NULL
      LEFT JOIN read_version rv ON rv.institution_id = t.institution_id AND rv.input_fingerprint = t.text_hash
     WHERE t.status = 'completed' AND t.char_count > 0
  `;
  const affected = n(row?.affected);
  const done = n(row?.done);
  const queued = Math.min((await countKnoxRereadsDue(db)).due, Math.max(0, affected - done));
  return {
    affected,
    done,
    queued,
    exclusions: { knox_keeps_older_read: Math.max(0, affected - done - queued) },
    note: "Knox re-reads a current copy only when its own rules ask (thin text, $10B+ bank, missing fees, older copy still live, stale or unnamed read, priority bank); the rest keep their older read.",
  };
}

/** One registry source: every partition an older parser recorded. */
function countRegistrySource(source: string, version: number) {
  return async (db: SqlTag): Promise<ReplayCount> => {
    const [row] = await db<Array<Record<string, number | string>>>`
      SELECT COUNT(*) AS affected,
             COUNT(*) FILTER (
               WHERE status IN ('succeeded', 'empty') AND COALESCE((detail->>'parser_version')::int, 1) >= ${version}
             ) AS done,
             COUNT(*) FILTER (
               WHERE (status IN ('succeeded', 'empty') AND COALESCE((detail->>'parser_version')::int, 1) < ${version})
                  OR status = 'scheduled'
             ) AS queued,
             COUNT(*) FILTER (WHERE status = 'failed') AS failed,
             COUNT(*) FILTER (WHERE status NOT IN ('succeeded', 'empty', 'scheduled', 'failed')) AS other
        FROM registry_ingest_partitions
       WHERE source = ${source}
    `;
    const exclusions: Record<string, number> = {};
    if (n(row?.failed) > 0) exclusions.failed_partition = n(row?.failed);
    if (n(row?.other) > 0) exclusions.other_status = n(row?.other);
    return { affected: n(row?.affected), done: n(row?.done), queued: n(row?.queued), exclusions };
  };
}

/** Category guard and frequency fill: one catch-up run per version pair re-checks every live fee. */
async function countGuardCatchUp(db: SqlTag): Promise<ReplayCount> {
  const { GUARD_CATCH_UP_SOURCE } = await import("@/lib/agents/hamilton/guard-catch-up");
  const marker = {
    source: GUARD_CATCH_UP_SOURCE,
    category_guard_version: CATEGORY_GUARD_VERSION,
    frequency_fill_version: FREQUENCY_FILL_VERSION,
  };
  const [run] = await db<Array<{ id: number | string; status: string }>>`
    SELECT id, status FROM agent_runs
     WHERE agent_name = ANY(${[...PUBLISHER_AGENT_NAMES]}::text[]) AND params_json @> ${JSON.stringify(marker)}::jsonb
     ORDER BY id DESC
     LIMIT 1
  `;
  return guardRunCount(run ? { id: Number(run.id), status: run.status } : null);
}

/** Pure: the catch-up run's state as a count. A failed run blocks a re-run (the scheduler keys on params). */
export function guardRunCount(run: { id: number; status: string } | null): ReplayCount {
  if (!run) return { affected: 1, done: 0, queued: 1, exclusions: {}, note: "No catch-up run yet; the next tick schedules it." };
  if (run.status === "completed") return { affected: 1, done: 1, queued: 0, exclusions: {}, note: `Run ${run.id} re-checked every live fee.` };
  if (run.status === "failed" || run.status === "cancelled") {
    return {
      affected: 1,
      done: 0,
      queued: 0,
      exclusions: { failed_run_blocks_rerun: 1 },
      note: `Run ${run.id} ended ${run.status}; the tick will not schedule another for this version pair.`,
    };
  }
  return { affected: 1, done: 0, queued: 1, exclusions: {}, note: `Run ${run.id} is ${run.status}.` };
}

/** Current copy: older/current pairs with a fee the current copy does not restate. */
async function countCurrentCopy(db: SqlTag): Promise<ReplayCount> {
  return currentCopyCount(await countCurrentCopyPairs(db));
}

/** Pure: the current-copy pair counts as a replay count. */
export function currentCopyCount(c: { pairs: number; done: number; queued: number; noText: number }): ReplayCount {
  return {
    affected: c.pairs,
    done: c.done,
    queued: c.queued,
    exclusions: c.noText > 0 ? { no_completed_text: c.noText } : {},
    note: "A checked pair can keep live fees: the check flags them for a second look rather than taking them down.",
  };
}

/** Name retidy: institutions with a messy live name, due now or tidied at this version. */
/**
 * Darwin's peer check (v5, #1112): raw fees whose latest hold came from an older peer version.
 * A hold counts when Darwin's own selection re-decides it: it recorded `peer_version`, or its
 * run's peer attempt was a graded version (`DARWIN_PEER_GRADED_VERSIONS`). Queued is what
 * Darwin's due query picks up now; the ungraded v1/v2 holds are left held on purpose (#1694).
 */
async function countPeerRange(db: SqlTag): Promise<ReplayCount> {
  const version = DARWIN_PEER_STRATEGY.version;
  const [row] = await db.unsafe<Array<{ affected: number | string; done: number | string; queued: number | string; ungraded: number | string }>>(`
    WITH old_hold AS (
      SELECT DISTINCT ON (pa.input_fingerprint)
             pa.input_fingerprint,
             substring(pa.input_fingerprint from 5)::bigint AS fee_raw_id,
             (pa.detail->>'peer_version' IS NOT NULL
              OR EXISTS (
                SELECT 1
                  FROM pipeline_attempts peer
                 WHERE peer.input_fingerprint = pa.input_fingerprint
                   AND peer.strategy = '${DARWIN_PEER_STRATEGY.strategy}'
                   AND peer.strategy_version IN (${DARWIN_PEER_GRADED_VERSIONS.join(", ")})
                   AND peer.agent_run_id = pa.agent_run_id
                   AND (peer.detail->>'peer_held')::boolean
              )) AS graded
        FROM pipeline_attempts pa
       WHERE pa.strategy = '${DARWIN_VERIFY_STRATEGY.strategy}'
         AND pa.strategy_version = ${DARWIN_VERIFY_STRATEGY.version}
         AND pa.detail->>'reason_code' = 'peer_outlier'
         AND COALESCE((pa.detail->>'peer_version')::int, 0) < ${version}
       ORDER BY pa.input_fingerprint, pa.id DESC
    )
    SELECT COUNT(*) FILTER (WHERE graded) AS affected,
           COUNT(*) FILTER (WHERE graded AND EXISTS (
             SELECT 1 FROM pipeline_attempts done
              WHERE done.input_fingerprint = old_hold.input_fingerprint
                AND done.strategy = '${DARWIN_VERIFY_STRATEGY.strategy}'
                AND COALESCE((done.detail->>'peer_version')::int, 0) >= ${version}
           )) AS done,
           COUNT(*) FILTER (WHERE graded AND EXISTS (
             SELECT 1 FROM raw_fee_observations fr
              WHERE fr.fee_raw_id = old_hold.fee_raw_id AND ${darwinDueSql(true)}
           )) AS queued,
           COUNT(*) FILTER (WHERE NOT graded) AS ungraded
      FROM old_hold`);
  return peerRangeCount({ affected: n(row?.affected), done: n(row?.done), queued: n(row?.queued), ungraded: n(row?.ungraded) });
}

export function peerRangeCount(c: { affected: number; done: number; queued: number; ungraded: number }): ReplayCount {
  return {
    affected: c.affected,
    done: c.done,
    queued: c.queued,
    exclusions: c.ungraded > 0 ? { ungraded_peer_version: c.ungraded } : {},
  };
}

async function countNameRetidy(db: SqlTag): Promise<ReplayCount> {
  return retidyCount(await countRetidyReplay(db));
}

/** Pure: due and done institution ids as a replay count; an institution due again after a new fee counts as queued. */
export function retidyCount({ due, doneCurrent }: { due: number[]; doneCurrent: number[] }): ReplayCount {
  const queued = new Set(due);
  const done = doneCurrent.filter((id) => !queued.has(id)).length;
  return { affected: queued.size + done, done, queued: queued.size, exclusions: {} };
}

export interface RosettaVersions {
  read: number;
  pdfLayout: number;
  ocr: number;
  jsFallback: number;
  tableRows: number;
  pdfStackedRepair: number;
}

async function loadRosettaVersions(): Promise<RosettaVersions> {
  const versions = await import("@/lib/agents/rosetta/reader-versions");
  return {
    read: versions.ROSETTA_READ_VERSION,
    pdfLayout: versions.PDF_LAYOUT_VERSION,
    ocr: versions.ROSETTA_OCR_VERSION,
    jsFallback: versions.ROSETTA_JS_FALLBACK_VERSION,
    tableRows: versions.ROSETTA_TABLE_ROWS_VERSION,
    pdfStackedRepair: versions.PDF_STACKED_REPAIR_VERSION,
  };
}

const ROSETTA_NOT_COUNTED = "Rosetta's re-read selection (rosetta/read.ts) is not shared as a count yet.";

/**
 * Rosetta's reader versions (#1120): ROSETTA_READ_VERSION, PDF_LAYOUT_VERSION, ROSETTA_OCR_VERSION,
 * ROSETTA_JS_FALLBACK_VERSION and ROSETTA_TABLE_ROWS_VERSION. A new reader reaches a stored
 * document only when Rosetta reads it again.
 */
export function rosettaReaderManifests(versions: RosettaVersions): ReplayManifest[] {
  const reader = (key: string, strategy: string, version: number, affects: string): ReplayManifest => ({
    key: `rosetta.${key}`,
    owner: "rosetta",
    stage: "read",
    strategy,
    version,
    unit: "stored document text",
    affects,
    count: null,
    notCounted: ROSETTA_NOT_COUNTED,
  });
  return [
    reader("read", "read.page_check", versions.read, "Texts read from PDFs, HTML, plain text and Word files by an older reader."),
    reader("pdf_layout", "read.pdf_layout", versions.pdfLayout, "PDF texts laid out by an older column and row layout."),
    reader("ocr", "read.ocr_tesseract", versions.ocr, "Scanned PDFs read by an older OCR pass."),
    reader("js_fallback", "read.js_fallback", versions.jsFallback, "JavaScript-built pages read by an older browser fallback."),
    reader("table_rows", "read.table_rows", versions.tableRows, "Fee tables split into rows by an older table reader."),
    {
      key: "rosetta.pdf_stacked_repair",
      owner: "rosetta", stage: "read", strategy: "read.pdf_layout",
      version: versions.pdfStackedRepair,
      unit: "current-copy PDF text",
      affects: "Stored PDFs with crossed and standalone bullet-price lines; a free geometry check, at most four per read step. General reader3 and prose-layout4 replay floors stay settled.",
      count: async (db): Promise<ReplayCount> => {
        const { countPdfStackedRepairsDue } = await import("@/lib/agents/rosetta/read");
        const queued = await countPdfStackedRepairsDue(db);
        const [row] = await db.unsafe<Array<{ done: number | string; failed: number | string }>>(`
          SELECT COUNT(*) FILTER (WHERE succeeded) AS done,
                 COUNT(*) FILTER (WHERE NOT succeeded) AS failed
            FROM (
              SELECT doc.id, BOOL_OR(${pdfStackedPersistedSql("adt", "pa")}) AS succeeded
                FROM source_documents doc
                JOIN agent_source_texts adt ON adt.source_document_id = doc.id
                 AND adt.source_hash = doc.content_hash
                JOIN pipeline_attempts pa ON pa.source_document_id = doc.id
                 AND pa.input_fingerprint = doc.content_hash
               WHERE doc.superseded_by_id IS NULL AND doc.duplicate_of_id IS NULL
                 AND pa.stage = 'read'
                 AND (${pdfStackedPersistedSql("adt", "pa")} OR ${pdfStackedFailedReviewSql("pa")})
               GROUP BY doc.id
            ) checked
        `);
        const done = n(row?.done);
        const failed = n(row?.failed);
        return { affected: queued + done + failed, done, queued, exclusions: failed ? { repair_failed_requires_review: failed } : {},
          note: "Queued uses the complete read owner's due query; done counts checks bound to the committed current-copy artifact, including unchanged geometry. Unbound successful reader outputs remain due when the stored witness remains. Failed checks retain earlier text and require review rather than retrying every lane run. A check is not a claim that every fee was corrected or published." };
      },
    },
  ];
}

/**
 * Version constants whose bump does not make an agent redo old records, so they need no
 * manifest. `scripts/ci-guards.sh bayes-manifest-kill` accepts a changed constant named here or
 * in a manifest above.
 */
export const VERSIONS_WITHOUT_REPLAY: Readonly<Record<string, string>> = {
  // #2052: a study method version, not a fee selector.
  INFERRED_VOLUME_VERSION: "v4 counts overdraft/NSF income only when current against its charter's newest call report filing: bank income within one quarter, credit union December year-to-date income within four quarters. The study rebuilds itself on its next daily step under the new method version; no fee row, raw/verified/published tier or provider work is touched or replayed.",
  PAID_RETURNED_EVENT_VERSION: "v1 is prospective source-owned paired-action proof and fresh raw lineage only. Existing same-unit, judged and held histories cannot be bypassed by projected names or line_share; mixed/unknown scope stays eligibility-held. Extract88/stale78/lineup73/twin82/verify3/source-check2/recheck5/publish3 remain settled. No selector, global category-guard version, historical replay, recovery, provider or source work is queued.",
  // #2265: implementation versions cannot authorize the broader identity rollout.
  HMDA_PARSER_VERSION: "Implementation v3 is prepared, but the default-off ordinary identity gate leaves HMDA_SCHEDULED_PARSER_VERSION at2. Registry replay counts use that effective scheduled selector; the explicit ten-bank repair is manual-only and creates no automatic replay. Any ordinary activation requires separate review, including #2266.",
  FDIC_UNIVERSE_PARSER_VERSION: "Implementation v3 is prepared, but own-LEI propagation is default off and FDIC_UNIVERSE_SCHEDULED_PARSER_VERSION stays2. Registry replay counts use the effective scheduled selector. Enabling broader source identity writes is a separate reviewed release; the ten-bank repair does not authorize it.",
  PDF_PROSE_REREAD_VERSION: "Frozen layout4 prose retry floor. Stacked layout5 has a separate measured current-copy witness and pdf_stacked@1 persisted-artifact check; changing PDF_LAYOUT_VERSION does not reopen every settled prose document.",
  // #2068: lessons apply when Knox reads a text, so they reach old texts only on a re-read.
  KNOX_LESSONS_VERSION: "v4 adds name-family category lessons, applied only when the exact name has none. Lessons are read at each extract step and act on texts Knox reads; old texts are read again only when KNOX_RULES_STRATEGY moves, and the knox.rules manifest counts that replay. Dry run 2026-10-25: 7 live fees (balance inquiries filed as network ATM fees) would be re-filed when their banks are next read, each still checked by Darwin.",
  // #2186: prospective hard-hold proof cannot be fabricated for historical confirmations.
  TAKEDOWN_LESSONS_VERSION: "v2 restricts newly inserted learned holds to complete supported fee identity and a limit-guard witness captured before judgement, retained in confirmation, and current at insertion. Missing/unsupported/contended proof leaves new candidates for ordinary Darwin. Existing raw rows/holds and extract83/stale78/verify3/batch4/publish3/refresh2/current-copy2/newer-copy1 fingerprints stay settled; no historical release, replay or provider work is queued.",
  // #1911 code phase: evidence format, not a new extraction selector or recovery authorization.
  ANCILLARY_PRODUCT_VERSION: "v1 owns only newly inserted raw rows from a bounded single-primary-product document. Existing raw conflicts, held takeovers and settled extract/verify/publish/copy decisions stay unchanged. Normalized represented-product guards restrict future matching and ordinary live duplicate sweeps; no metadata backfill, historical replay, numeric-policy change or recovery is queued.",
  // v2 (#1862): provenance gating excludes old unbound fixture judgments. Original document
  // mappings are absent; replay cannot manufacture them or convert old scores into new trust.
  DARWIN_VERDICT_SCORE_STRATEGY: "Frozen-reference provenance starts a distinct protocol/manifest series. Unbound historical chunks and lessons remain historical; no fee replay or key repair is authorized.",
  // Discovery's own selector searches banks last checked by an older method. Guessed-path
  // memory affects future attempts, without rewriting attempt history or existing fee data.
  DISCOVERY_METHOD_VERSION: "The discovery selector searches banks last checked by an older method; its normal runs apply the new guessed-path memory, with no separate replay.",
  SITE_SEARCH_STRATEGY: "Reporting-only version: future query receipts distinguish unchecked hits from rejected ones; historical receipts are not rewritten or replayed.",
  PDF_READER_AGREEMENT_VERSION: "Record-only receipt (#2219): each PDF read records whether its stored layout reading and the PDF's drawing order pair a fee name with different prices. It never changes stored text, reader eligibility or any fee, so there is nothing to replay; older reads gain a receipt on their next ordinary read.",
  LAYOUT_RECHECK_VERSION: "Record-only measurement (#2219): each read step re-reads up to three older-layout PDF texts from the vault and records, per document, which live fees the shared source check supports in the old and new text. It writes only agent_run_events receipts, never a stored text, read attempt, playbook or fee, so it reopens no document and there is nothing to replay; a new protocol version only re-samples texts.",
  ROSETTA_DOCUMENT_ACCESS_VERSION: "Logging-only strategy for failures before a reader runs; existing reader versions and retry windows decide eligibility, with no separate replay.",
  ROSETTA_PAID_READ_VERSION: "Prospective response/usage policy v2 only: the paid selector excludes old settled attempts on the same bytes irrespective of version. Historical truncation and usage remain unverified; no replay or provider work is authorized.",
  // v1 (#1868): the first LEI match rules. Every institution is checked by the gleif registry's
  // lei-match partitions in bounded batches; nothing was matched under an earlier version.
  LEI_MATCH_PARSER_VERSION: "First version: the gleif lei-match partitions check every institution in bounded batches; nothing older to replay.",
  // v1 (#1909): Darwin re-reads every live fee on a Spanish copy of a schedule each verify step (no
  // cursor; a few hundred rows), so there is no backlog for a replay to count.
  TRANSLATED_COPY_CHECK_VERSION: "Each verify step re-reads every live fee on a Spanish-copy document (no cursor); nothing to replay.",
  PRODUCT_PAGE_REPEAT_CHECK_VERSION: "First version: each verify step re-reads every live product-page fee with a same-price schedule twin (no cursor); nothing older to replay.",
  // v1 (#1915): schedule editions not yet in effect. Every verify step reads every live fee on a dated document.
  EDITION_CHECK_VERSION: "First version: each verify step re-reads every live or held fee on a document whose heading states an edition (no cursor); nothing older to replay.",
  // v1 (#2022): Canadian bank documents. A full verify step re-reads every live document's text at most hourly.
  CANADIAN_DOCUMENT_CHECK_VERSION: "First version: a verify step re-reads every live fee's document text (no cursor, at most hourly); nothing older to replay.",
  // v8 (#1112): new no-fee, discount, allowance and loan-amount name rules. Each step's eval-verdict
  // pass reads every live fee whose name or line matches one of their prefilter clauses
  // (`V8_PREFILTER`), then the second look; Darwin reads each new row under them. There is no
  // backlog for a replay to count.
  EVAL_VERDICT_VERSION: "Each step re-reads every live fee the eval-verdict prefilter selects (each rule shape has a clause, V8_PREFILTER for v8), and Darwin reads each new row at verify; nothing to replay.",
  // v1 (Oct 17): a person uploads a copy of a schedule they downloaded. It runs only on an upload,
  // so there is no backlog of older documents to read again.
  HAND_SUPPLIED_STRATEGY: "Runs only when a person uploads a file on /admin/magellan/hand-supplied; nothing older to replay.",
  // v6 (Oct 17): an unclassified committee assignment moves a committee bill's stage date. The state
  // bills read treats a state stored under an older version as due, so its next run re-reads them.
  STATE_BILLS_TAGGING_VERSION: "The state bills read re-reads states stored under an older version on its next runs; nothing to replay.",
  // v1 (#1100 gap 3): a new pass 2 specialist inside the free team, logged under extract.rules.
  // Old texts are read again only when KNOX_RULES_STRATEGY moves, and the knox.rules manifest
  // counts that replay.
  KNOX_ACCOUNT_TABLE_STRATEGY: "A pass 2 specialist under extract.rules; the knox.rules manifest counts the replay when KNOX_RULES_STRATEGY moves.",
  // v7 (#1827): a price-first row keeps its own price. It moves with KNOX_RULES_STRATEGY (v79), whose
  // knox.rules manifest counts the replay.
  KNOX_TABLE_STRATEGY: "A pass 2 specialist under extract.rules; it moves with KNOX_RULES_STRATEGY, whose knox.rules manifest counts the replay.",
  // v75 (Knox recall, Oct 17): raised from 26 so every current copy read before v75 is read once
  // more. It is one of the extract step's own re-read triggers, which the knox.rules manifest's
  // queue counts with the same query (`countKnoxRereadsDue`), so the replay is counted there.
  KNOX_STALE_READ_BELOW_VERSION: "A re-read trigger inside the extract step's selection; the knox.rules manifest counts its queue (countKnoxRereadsDue).",
  // v2 (Oct 15): footnoted held names ("1Monthly fee") also meet the live fees printed without the
  // mark. The week mark carries the version, so each lane's next extract step reads its held lines
  // again under v2; there is no backlog for a replay to count.
  NAME_FILE_KEY_VERSION: "Each lane's next extract step re-reads its held lines under the new week mark; nothing to replay.",
  // v1 (Oct 15): a new pass over the v17 review's recorded passes; each verify step reads all of
  // them that it has not acted on, so there is no backlog for a replay to count.
  DARWIN_RECORDED_RELEASE_STRATEGY: "Each verify step reads every recorded v17 pass it has not acted on; nothing to replay.",
  // v1 (#1059): a new step that reads every live fee verified as unknown on each run (a daily dry
  // run while off), so there is no backlog for a replay to count. v2 (#1626) changes the fee-name
  // reading; the full dry run's chain is keyed by the version, so it reads every document again.
  // v3 (#1059 unknown review) changes the context reading; the live chain is keyed by the version,
  // so it reads every document's still-unknown fees again.
  AUDIENCE_RELABEL_VERSION: "Its own step reads every live unknown-audience fee on each run; nothing to replay.",
  // v2 (#1068) changes how a refresh is written (in place), not which fee moves; the stale fees
  // it works through are picked by the same query every publish step, so there is nothing to replay.
  // #2109 only excludes cross-audience pairs from future refreshes. It intentionally keeps v2
  // fingerprints: previously decided pairs and already-moved lineage need no automatic replay.
  REFRESH_COPY_STRATEGY: "Refreshes matching-audience/product stale fees in place on normal publish steps. The audience/product safety restrictions keep v2 decisions closed; no historical correction or replay is queued.",
  // #2117/#2118/#2121 deliberately retain v1 pair fingerprints. Tightening a positive witness can
  // retire more on pending/future pairs, so this is not the earlier 'only retire less' exception.
  // Previously settled pairs require a separately reviewed impact/official-source decision.
  // #1674 also treats an exact account-type-held twin as present in planning/final restore;
  // it prevents future hold bypasses without reopening any settled v1 pair.
  NEWER_COPY_STRATEGY: "Identity witnesses, restore identity and hold guards apply only to pending pairs and future newer copies. Existing v1 decisions stay closed; no historical replay, correction or backfill is queued.",
  // #2131 narrows exact identity on normal live sweeps and future undecided publishes. Existing
  // v3 decisions (including skipped audiences) remain settled; historical recovery is separate.
  // #1055: a v3 refusal for low confidence is decided once more when the row's confidence now
  // clears the floor (Knox re-scored ~1,037 promoted rates that kept a 0.5 placeholder).
  HAMILTON_PUBLISH_STRATEGY: "Audience/product-safe duplicate checks retain publish v3 decisions. No historical publish replay or closed-duplicate recovery is queued; ordinary live sweeps use the restricted identity predicate. The one re-decision: a v3 refusal for low confidence whose row's confidence now clears the floor (#1055).",
  // v2 (#1030) changes which institutions a paid search picks next (no live fee first) and what
  // it asks for; earlier searches are not redone, they age off the paid cooldown as before.
  // v3 (2026-10-17, magellan/top-ten-first.ts) puts state top-10 slot holders with nothing live
  // first and lets them try weekly inside the cooldown; its own selector picks them.
  SCHEDULE_SEARCH_STRATEGY: "A paid search: each institution becomes due again on the rolling cooldown, so there is nothing to replay.",
  // v2 (2026-10-17, magellan/top-ten-first.ts) changes which institutions the paid web search
  // picks first (state top-10 slot holders with nothing live) and when (a weekly early try on the
  // disclosure rung); its own selector picks them, and earlier searches are not redone.
  PAID_FIND_STRATEGY: "A paid search: its selector picks the top-10 slot holders itself, so there is nothing to replay.",
  // v2 (#1102): the re-check's flag carries its version, so every held percentage line is read
  // again by the extract steps themselves (100 a step); there is nothing to replay.
  HELD_RATE_RECHECK_VERSION: "Its versioned flag makes the extract steps re-read every held percentage line under v2.",
  // v1 (#1051): a new fetch route, not a changed rule. Its selector picks every unreachable fee
  // link each fetch step (3 a step, once a week each), so the backlog is worked by the route itself.
  ADDRESS_VARIANT_FETCH_STRATEGY: "A new free fetch route; every fetch step selects the unreachable links it works through, so there is nothing to replay.",
  // v1 (#1881, Oct 19): a new fetch route. Its selector picks every never-fetched saved fee link
  // (10 a step, switch off until James says yes), so the backlog is worked by the route itself.
  SAVED_LINK_FETCH_STRATEGY: "A new free fetch route; every fetch step selects the never-fetched saved links it works through, so there is nothing to replay.",
  LIVE_SOURCE_REFETCH_STRATEGY: "A new free fetch route (#1200); every fetch step selects the stale pages live fees cite, oldest first, so there is nothing to replay.",
  // v3 / v2 (#1326): the re-searches no longer accept the link they replace. Their selectors pick
  // every bank not yet searched at the new version, so the discover steps re-search them themselves.
  UPGRADE_SEARCH_VERSION: "Its selector re-searches every product-page link not yet searched at v3; there is nothing to replay.",
  FRESHNESS_SEARCH_VERSION: "Its selector re-searches every stale link not yet searched at v2; there is nothing to replay.",
  // v1 (#1342): a new hand-started step that reads every live fee with no source link on each run.
  SOURCE_LINK_VERSION: "Its own step reads every live fee with no source link on each run; nothing to replay.",
  SOURCE_LINK_DRIFT_VERSION: "Every publish step reads every live fee whose link opens another page than its own document; nothing to replay.",
  // v3 (#1397): the recheck reads every verified row once per version, so each verify step works
  // through the whole verified set under v3 itself (200 a step).
  // v4 (#1571, #1574): the same selector re-reads every verified row once under v4.
  // v5 (#1593): and once more under v5.
  DARWIN_RECHECK_STRATEGY: "Its selector re-reads every verified row not yet read at the current version (200 a verify step); there is nothing to replay.",
  // v1 (#1511): a new shadow pass over Darwin's re-read requests. Its resolution key carries its
  // version and the Knox rules version, so every request is read again by the extract steps themselves.
  KNOX_REREAD_FEEDBACK_STRATEGY: "Its resolution key carries its version and the Knox rules version, so the extract steps read every request again themselves; nothing to replay.",
  // v1 (#1443): the live fragment re-check's rules (parenthetical exemption, glued-sentence rename,
  // priced trailing range left live). Its ledger cursor reads the whole live table again every pass.
  // v2 (#1499): the wider sentence_end head, the generic/clause/service-list bars, no rename of an
  // opening-deposit line and a re-read request to Knox per sentence_end takedown; the same cursor
  // reads every live name again under v2, still in shadow.
  // v3 (#1499): the if/when balance gate under $100, no rename with another price in the name,
  // "(cont.)" dropped, "2FA" kept, and the sentence_end tail name; the cursor reads every name again.
  // v4 (#1499 review): the tail's figure-equals-amount gate, total wording, the dormancy tier, tail
  // qualifiers and generic tails, lower-case heads before a balance condition; same cursor, shadow.
  // v5 (#1499, prod hand-check of v4): "may therefore" totals, period and bare-activation generics,
  // "only if" and "your" balance conditions, generic heads on a balance-below condition, and the
  // figure gate on the footnote-stripped name skipping bare counts; same cursor, shadow.
  // v6 (#1499, prod check of v5): takedown only at $0/no amount, a credit, no fee of this bank or a
  // refused amount; every other unnamed pronoun or sentence_end line is kept live (`reread`); waiver
  // wording bars renames only and a line ending on a threshold is refused; same cursor, shadow.
  // v6 round 4 (rev10, prod r10, still v6 in shadow): every refusal under $100 is a reread, a rename
  // needs a rest free of the rename bar (or one of three narrow forms) and a fee-noun target with no
  // figure; same cursor, nothing written. Round 5 (rev11): head and tail renames are allowlists,
  // credits and "no fee of this bank" are narrowed to an allowlist and the line start; still shadow.
  // Round 6 (rev12): subject-carrying tail leads, soft if/when clauses and floors, cents figures as "$",
  // a credit guard and NBSP parity in the count SQL; still shadow.
  LIVE_FRAGMENT_STRATEGY: "Its cursor re-reads every live fee name each pass (2,000 a verify step); there is nothing to replay.",
  // v2 (#1456): a fee whose name is silent on the hour is read on its own stored line too; line-only
  // fees are written only with HOURLY_LINE_LIVE on (on since 2026-10-20). Same cursor.
  HOURLY_CHECK_VERSION: "Its cursor re-reads every live fee name and stored line for an hourly price each pass (2,000 a verify step); there is nothing to replay.",
  // v1 (#1442): a new shadow pass. Its ledger cursor re-reads every live fee's source document address
  // each pass (2,000 a verify step), and nonDepositCountSql counts the whole live table read-only.
  // v2 (#1518): lending wording on loan documents and brokerage_document (own sub-switch) as their
  // own reasons, generic lending fees on rate pages kept live; same cursor, shadow, nothing written.
  NON_DEPOSIT_CHECK_VERSION: "Its cursor re-reads every live fee's source document address each pass (2,000 a verify step); there is nothing to replay.",
  // v1 (#1440): a new shadow pass over one printed line live under two readings.
  LINE_CONFLICT_CHECK_VERSION: "Every verify step reads every live line read twice in one grouped read; there is nothing to replay.",
  // v1 (#1455): a new shadow pass. Its selector reads every shared or vendor-path document pair not
  // yet read at v1 (25 a verify step), and documentOwnerCountSql counts the whole backlog read-only.
  DOCUMENT_OWNER_STRATEGY: "A new shadow pass; its selector reads every shared or vendor-path pair not yet read at v1, and documentOwnerCountSql counts the backlog; nothing to replay.",
  // v18 (#1810): an opening deposit under an account heading is not the heading's price. The version
  // is in each institution's check fingerprint, so every publish step's batch re-checks institutions
  // not yet checked at v18.
  // v20 (#1916): a fee never takes the other column's price on a two-column page; same fingerprint path.
  // v23 (#1479): a name | description | price row stays one fee's row; same fingerprint path.
  SOURCE_CHECK_STRATEGY: "Its fingerprint carries the version, so each publish step's batch re-checks every institution not yet checked at the new version; nothing to replay.",
  // v3 (#1810): headings over an opening deposit, "Interest Checking" and numbered accounts name a fee.
  ACCOUNT_NAME_STRATEGY: "Its fingerprint carries the version, so each publish step's batch (40 institutions) re-reads every institution with a generic monthly name not yet read at v3; nothing to replay.",
  STATE_LISTS_PARSER_VERSION: "New sources (depositories, non-bank lenders, Urban debt held until its license is confirmed); no older rows to replay.",
};

export async function loadManifests(): Promise<ReplayManifest[]> {
  const { REGISTRY_PARSER_VERSIONS } = await import("@/lib/agents/registry-scheduler");
  // From reader-versions.ts, which imports nothing: the readers themselves load PDF and OCR code.
  const rosetta = await loadRosettaVersions();
  const manifests: ReplayManifest[] = [
    // v83 (#2151): faithful wrapped bullets use the existing due-text selection.
    // No stale-floor increase or historical rejection replay accompanies this fix.
    {
      key: "knox.rules",
      owner: "knox",
      stage: "extract",
      strategy: KNOX_RULES_STRATEGY.strategy,
      version: KNOX_RULES_STRATEGY.version,
      unit: "current-copy text",
      affects: "Fees Knox reads from each current fee schedule. A rules fix reaches a text only when Knox reads it again.",
      count: countKnoxRules,
    },
    // Counts every CATEGORY_GUARD_VERSION bump. v68 (Oct 17): returned foreign checks leave check
    // cashing for returned deposited items, and bill pay refuses overdraft and NSF rows (#1304).
    // v69 (Oct 17): returned foreign items leave NSF, IRA closing charges leave early closure, and
    // the non-network ATM fee refuses non-customers' surcharges at the institution's own ATMs, ATM
    // plans and ATM-named lines that price something else.
    // v70 (Oct 17): card-product fees under the non-network ATM fee and card inactivity under the
    // dormant account fee fail (takedowns held by CARD_PRODUCT_TAKEDOWN_LIVE), and skipped loan
    // payments leave late payment and loan origination for other lending.
    // v71 (Oct 17): the non-network ATM fee refuses another institution's card named in several words
    // after "non-", and an ATM transaction verification re-files to account research.
    // v72 (Oct 17, #1788): an international ATM fee re-files to card_foreign_txn, a sustained overdraft
    // to continuous_od and an incoming wire to its incoming key; an optional add-on fails monthly maintenance.
    // v73 (Oct 17, #1837): a bare direction row read under another column's heading ("Check Printing:
    // Incoming", a wire price) fails outside the categories a direction prices.
    // v74 (Oct 19, #2018): payment investigations re-file to account research, withdrawal limits and
    // returned mail leave account research, excess IRA withdrawals leave IRA termination, currency
    // shipping leaves rush card, loan payments leave returned deposited items, and a withdrawal at
    // the institution's own named ATM fails the non-network ATM fee.
    // v75 (Oct 19, #2023, James's "Take down"): a club or holiday account withdrawal fails early closure.
    // v76 (Oct 19, #2037, James's "Split"): an ATM used abroad re-files from card_foreign_txn and
    // atm_non_network to atm_international, its own type again.
    // v77 (Oct 19, #2388): a card that draws only on credit fails card replacement and rush card.
    // v78 (Oct 20, #2449): account verification is guarded by name; research and wires re-file, and
    // signature guarantees and other names fail.
    // v79 (Oct 20, #1830): bill pay refuses a name its own line puts under a stop payment.
    // v80 (Oct 20, #1912, #1905): PIN replacements, home equity stop payments, ATM-table cash
    // advances and cut-lead-in $0s fail; non-customer cashier's checks wait behind a switch (off).
    // v82 (Oct 25, #1662): the night deposit key-deposit exemptions are tied to the key or the noun.
    {
      key: "hamilton.guard_catch_up",
      owner: "hamilton",
      stage: "publish",
      strategy: "hamilton.guard_catch_up",
      version: CATEGORY_GUARD_VERSION,
      versionLabel: `g${CATEGORY_GUARD_VERSION}.f${FREQUENCY_FILL_VERSION}`,
      unit: "catch-up run",
      affects: `Every live fee's category (guard v${CATEGORY_GUARD_VERSION}) and frequency (fill v${FREQUENCY_FILL_VERSION}).`,
      count: countGuardCatchUp,
    },
    ...Object.entries(REGISTRY_PARSER_VERSIONS).map(([source, version]): ReplayManifest => ({
      key: `magellan.registry.${source}`,
      owner: "magellan",
      stage: "registry",
      strategy: source,
      version,
      unit: "registry partition",
      affects: `Rows Magellan parsed from the ${source} registry.`,
      count: countRegistrySource(source, version),
    })),
    {
      key: "hamilton.current_copy",
      owner: "hamilton",
      stage: "publish",
      strategy: CURRENT_COPY_STRATEGY.strategy,
      version: CURRENT_COPY_STRATEGY.version,
      unit: "older/current document pair",
      affects: "Live fees on a superseded copy that the current copy no longer states.",
      count: countCurrentCopy,
    },
    {
      key: "knox.name_retidy",
      owner: "knox",
      stage: "publish",
      strategy: NAME_RETIDY_STRATEGY.strategy,
      version: NAME_RETIDY_STRATEGY.version,
      unit: "institution",
      affects: "Live fee names Knox tidies in place.",
      count: countNameRetidy,
    },
    ...rosettaReaderManifests(rosetta),
    // DARWIN_SOURCE_CHECK_VERSION (v3, #1479) needs no manifest of its own: darwinDueSql re-selects each
    // `not_in_source` rejection stamped with an older source-check version, so ordinary verify batches
    // decide those rows again (1,966 rows at 740 banks on Oct 25, read-only count).
    {
      key: "darwin.verify_rules",
      owner: "darwin",
      stage: "verify",
      strategy: DARWIN_VERIFY_STRATEGY.strategy,
      version: DARWIN_VERIFY_STRATEGY.version,
      unit: "verified fee",
      affects: "Fees Darwin verified under an older rules version; a rules fix reaches a fee only when Darwin verifies it again.",
      count: null,
      notCounted: "Darwin's re-verify selection (verified-recheck.ts) is not shared as a count yet.",
    },
    {
      key: "darwin.peer_range",
      owner: "darwin",
      stage: "verify",
      strategy: DARWIN_PEER_STRATEGY.strategy,
      version: DARWIN_PEER_STRATEGY.version,
      unit: "held raw fee",
      affects: "Fees Darwin held as peer outliers under an older peer version; v5 re-decides the graded v3/v4 holds once (#1112), and the ungraded v1/v2 holds stay held (#1694).",
      count: countPeerRange,
    },
    {
      key: "darwin.envelopes",
      owner: "darwin",
      stage: "verify",
      strategy: "verify.rules",
      version: 0,
      unit: "held raw fee",
      affects: "Fees Darwin held as outside a category's amount envelope.",
      count: null,
      notCounted: "Envelope edits carry no version, so there is no change to count against.",
    },
  ];
  return manifests;
}
