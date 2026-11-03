import { sql } from "@/lib/data-store/connection";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";
import { countKnoxRereadsDue, KNOX_REREAD_BELOW_VERSION, KNOX_REREAD_REFRESH_DAYS } from "@/lib/agents/knox/extract";
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
  // Queued is Knox's own selection (`countKnoxRereadsDue` runs the extract step's query), so it moves
  // with the re-read floor: a bump below KNOX_REREAD_BELOW_VERSION adds no queue, a raise of the floor does.
  const rereads = await countKnoxRereadsDue(db);
  const queued = Math.min(rereads.due, Math.max(0, affected - done));
  const left = Math.max(0, affected - done - queued);
  const heldByFloor = Math.min(rereads.heldByFloor, left);
  return {
    affected,
    done,
    queued,
    exclusions: { knox_read_at_floor_recently: heldByFloor, knox_keeps_older_read: left - heldByFloor },
    note: `Knox re-reads a current copy only when its own rules ask (thin text, $10B+ bank, missing fees, older copy still live, stale or unnamed read, priority bank). Since Nov 2 those re-reads wait for the floor (KNOX_REREAD_BELOW_VERSION v${KNOX_REREAD_BELOW_VERSION}) or a ${KNOX_REREAD_REFRESH_DAYS}-day refresh (KNOX_REREAD_REFRESH_DAYS), except missing fees and one-institution runs; knox_read_at_floor_recently counts texts last read at or above the floor inside that window. The rest keep their older read.`,
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
  glyphRepair: number;
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
    glyphRepair: versions.GLYPH_REPAIR_VERSION,
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
    {
      ...reader("read", "read.page_check", versions.read, "Texts read from PDFs, HTML, plain text and Word files by an older reader."),
      unit: "current-copy document text",
      // #2069 ("Re-read all", James, 25 Oct): every older-reader current copy, OCR and JavaScript
      // fallback texts included, is replayed once per version, a few a read step.
      count: async (db): Promise<ReplayCount> => {
        const { countReaderReplaysDue } = await import("@/lib/agents/rosetta/read");
        const { countReaderReplaysDone, READER_REPLAY_PER_RUN } = await import("@/lib/agents/rosetta/reader-replay");
        const queued = await countReaderReplaysDue(db);
        const { done, textChanged } = await countReaderReplaysDone(db);
        return { affected: queued + done, done, queued, exclusions: {},
          note: `Queued is the read step's own replay selection (current copies whose text an older version of its reader wrote: a primary or the legacy reader, free OCR or the JavaScript fallback; the paid pass is not replayed), read at most ${READER_REPLAY_PER_RUN} a step. Done counts rosetta.reader_replay receipts at this version; ${textChanged} stored a new text, which Knox re-extracts and Darwin re-checks. A replay keeps the earlier text unless the new one lists at least as many fees. A replay whose bytes are a known failure for its reader is settled without a read and counts as done; a scan deferred past a run's OCR allowance stays queued. Thin texts the ordinary re-read settled count as neither.` };
      },
      notCounted: undefined,
    },
    reader("pdf_layout", "read.pdf_layout", versions.pdfLayout, "PDF texts laid out by an older column and row layout."),
    reader("ocr", "read.ocr_tesseract", versions.ocr, "Scanned PDFs read by an older OCR pass."),
    reader("js_fallback", "read.js_fallback", versions.jsFallback, "JavaScript-built pages read by an older browser fallback."),
    reader("table_rows", "read.table_rows", versions.tableRows, "Fee tables split into rows by an older table reader."),
    // GLYPH_REPAIR_VERSION (#2598): completed texts still carrying U+FFFD or a Unicode ligature,
    // read once per version. Dry run 2026-10-25: 173 current copies at 100 institutions. Oct 26
    // (#1513): also PDF texts with a fee word a font's dropped ligature broke, 8 completed texts.
    {
      key: "rosetta.glyph_repair",
      owner: "rosetta", stage: "read", strategy: "read.glyph_repair",
      version: versions.glyphRepair,
      unit: "current-copy text",
      affects: "Completed PDF, HTML and plain texts with a glyph their reader could not name (U+FFFD) or a Unicode ligature, or PDF texts with a fee word a dropped ligature broke (Internaonal), read once more with glyph repair and charset-aware decoding. Knox reads each changed text; no fee row is changed by the read.",
      count: async (db): Promise<ReplayCount> => {
        const { countGlyphRepairs } = await import("@/lib/agents/rosetta/read");
        const { queued, done } = await countGlyphRepairs(db);
        return { affected: queued + done, done, queued, exclusions: {},
          note: "Current copies (not superseded or a duplicate). A text whose glyphs have no single reading keeps them and counts as done once read at this version." };
      },
    },
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
  // Nov 2 pipeline wiring audit, gap 8: which website a search result saves, not a selector that replays fee work.
  REDIRECT_WEBSITE_PROOF_VERSION: "v1 names the `detail.moved_to_proof` judgement on discover attempts whose homepage redirected to another domain: whether the landing is proven the institution's own site before it replaces `institution_sources.website_url`. It selects no bank, re-searches nothing, and holds, rejects or re-files no fee; a landing judged `not_own_site` (a social, bot-wall, hosting or file host) is no longer saved as the website, and an `unproven` one (a challenge page included) stays saved while `REDIRECT_WEBSITE_PROOF_LIVE` is off.",
  // Fix plan step 3 (Oct 27): a discovery selector for links that gave no live fee, not fee work.
  BARREN_LINK_SEARCH_VERSION: "v1 marks the `detail.barren_link_search` on discover attempts for banks with no live fee whose current main page was read at least 3 days ago and gave fewer than three verified fee types. Each such bank is searched once per version with the free finders, in 2 reserved slots a step plus spare capacity; a page found replaces the link only when it passes the fee-page check and lists more fee lines than the old page, and the old link is kept as a companion. No fee row is held, rejected or re-filed, no paid call is made, and nothing is replayed by the version. v2 (2026-11-02 coverage audit): a page that cannot replace the link (no more fee lines than the link's own text, or the link itself under a print or tracking address) no longer stops the search; the selector re-searches the banks whose v1 search stopped on such a page (103 on Nov 2, 70 of them on their own link's print copy) and leaves v1 searches that ran to their end alone. Still no fee row held, rejected or re-filed, no paid call, nothing replayed.",
  // 2026-10-27: a new fetch strategy behind an off switch, not a selector that replays fee work.
  BROWSER_FETCH_STRATEGY: "v1 names the attempt `fetch.browser_render` that Magellan's fetch step writes when it renders, in headless Chromium, a fee link whose current main document Rosetta read as `js_required`. It is off unless MAGELLAN_BROWSER=on, renders at most 5 a step and 50 a day, and stores the page as an ordinary source document through fetchAndRecordLink; Rosetta, Knox, Darwin and Hamilton then read it under their own versions. No fee row is held, rejected or re-filed, no provider is called, and nothing is replayed by the version. v2 (2026-11-01): every v1 render failed before Chromium started, because the Vercel bundle lacked playwright-core's own files; a bank's 30-day retry window now counts only v2 renders, so the 112 banks v1 locked out are tried again, and a step whose browser cannot start tries no bank. Still no fee row held, rejected or re-filed, no provider call, nothing replayed.",
  // #1101: a report version on the paid attempt's detail, not a selector that replays fee work.
  KNOX_PAID_FIND_MISS_VERSION: "v1 names the `free_misses` summary on each `extract.paid` attempt's detail and the `knox.paid_find_misses` step event: each grounded paid fee filed as read, read under another category, held or missed by today's free team on the same text, with the line's shape, the text's layout, the host and the platform. It is computed after the paid call from the free team's deterministic read, buys no call, and writes, holds or re-files no fee; nothing is replayed by the version.",
  // Wiring audit gap 4 (Nov 2): holds pre-Darwin rows behind an off switch, no replay.
  TWO_READ_AGREEMENT_STRATEGY: "v1 names Knox's two-read agreement (`knox/two-read-agreement.ts`) and its `knox.two_read_agreement` step event: the free and paid raw rows of one current text paired by printed line and compared by category and amount. Behind KNOX_TWO_READ_AGREEMENT_LIVE (off) it holds rows still waiting for Darwin that the two reads disagree on, releases its own holds whose disagreement no longer stands, and flags agreeing unverified rows; it reads no text again, buys no call and changes no verified or live row, so nothing is replayed by the version. v2 (Nov 2): two categories equal under the shared `EQUIVALENT_CATEGORIES` (`knox/category-equivalence.ts`, the answer-key gate's map: minimum_balance = monthly_maintenance) count as one category, so a \"$10 fee if balance below $1,000\" read under one by each reader agrees; every other disagreement stands. The Nov 2 dry run's would-hold falls from 171 to 83 rows. Still off, no text read again, no call bought, no verified or live row changed, nothing replayed.",
  // #2068: what a paid read carries, not a selector that replays fee work.
  KNOX_PAID_STRATEGY: "v3 sends each paid read the document-scoped role lessons and the category lessons its text prints, and files its kept rows through the free read's category lessons. The flag has the free read's form, `knox_lesson:<model key>-><right>`, with the key the model returned on the wrong side. The paid selector excludes a text with any settled `extract.paid` attempt irrespective of version, so the bump buys no new read and replays nothing; only texts read for the first time from now on carry the lessons.",
  // #1102: an evidence version on learning-store rows, not a selector that replays fee work.
  UNTRACED_READ_ERROR_EVIDENCE_VERSION: "v1 names the evidence on the `knox.untraced_held` pipeline_feedback rows that Knox's extract step writes for a text whose held lines stayed untraced under 3 or more rules versions (at most 200 texts a step). Rosetta's existing read-error re-read reads such a document once more only when its reader version moves, and keeps the new text only when it lists at least as many fees. No fee row is held, rejected or re-filed, and nothing is replayed by the version.",
  // #1455: a review receipt for a shared website host, not a selector that replays fee work.
  WEBSITE_OWNER_STRATEGY: "v1 names the attempt `discover.website_owner` that Magellan writes when it reads a homepage to decide whose website a host shared by unrelated active institutions is. It reviews each host once per version every 30 days (7 when the homepage was unread), at most 5 institutions per discover step. A flag only stops Magellan searching that host and sends the bank to the website search; no fee row is held, rejected or taken down, and no Knox or provider work is replayed by the version. v2 (2026-11-01): a host that spells out exactly one unrelated sharer's name and not this institution's is that sharer's website when the homepage does not pass this institution's check (fivestarcu.com for Jackson Area FCU 5286, stmaryscu.org for Metrowest 4884, stearnsbank.com for Battle Bank 4027). The bump re-reviews every contested host once (about 15 institutions); still no fee row is held, rejected or taken down by Magellan.",
  // #2477: a receipt strategy for a status-only reopen, not a selector that replays work.
  SAME_TEXT_COPY_STRATEGY: "v2 (Nov 2) reopens only copies the account/product-page rule rejected (707 at 635 banks), and the backlog pass is on (SAME_TEXT_COPY_REOPEN_LIVE true, sampled clean 20 of 20). v1 names the receipt `read.same_text_copy` that reopenSameTextCopies writes when it sets a wrong_document current copy to completed because an older copy of the same page holds the same text and Knox rows. Under v1 the backlog pass was off and only counted and sampled: 714 current copies at 641 banks on 2026-10-25. Nothing is replayed by the version; reopened texts reach Knox's ordinary selection, and no fee row or provider work is touched here.",
  // #2625: recorded on each fdic-financials partition, deliberately not a registry replay selector.
  FDIC_FINANCIALS_PARSER_VERSION: "v2 attaches a BankFind quarter to the bank by the certificate the FFIEC POR file says filed as its RSSD that quarter. Only quarters with stored POR certificates (2023 Q1 on) can change, and the FFIEC call-detail loader (v6) makes each such fdic-financials quarter due again when its POR shows a bank filing under a certificate that is not today's. Registering this version in REGISTRY_PARSER_VERSIONS would reload every quarter back to 2010 for no change, so there is no separate replay to count. No fee row or provider work is touched.",
  // #1912: a check version on the live name refresh's receipts, not a selector that replays fee work.
  LIVE_NAME_REFRESH_VERSION: "v1 names the `hamilton.live_name_refresh` check and its `live_name_refreshed` pipeline_feedback rows, written when a live fee takes the strictly better name (restored glyphs or ligatures, or a wire's channel clause) of a newer verified re-read of its own printed line. It reads the live fees beside their newest re-reads on each step (at most every 6 hours for a full read) and writes unless LIVE_NAME_REFRESH_LIVE is false, 0 or off (on by default since 2026-10-31, James's yes on #2072), never an admin-corrected fee; nothing is replayed by the version, no fee is held, rejected or re-filed, and no provider work is bought.",
  // #1911: a study method version, not a fee selector.
  PRICE_STUDY_VERSION: "v2 reads each institution's study price under statistics rule 11: its general rows when it also states a named account's exception price in the category. The price studies rebuild on their next step under the new method version; no fee row, raw/verified/published tier or provider work is touched or replayed.",
  // #2052: a study method version, not a fee selector.
  INFERRED_VOLUME_VERSION: "v4 counts overdraft/NSF income only when current against its charter's newest call report filing: bank income within one quarter, credit union December year-to-date income within four quarters. The study rebuilds itself on its next daily step under the new method version; no fee row, raw/verified/published tier or provider work is touched or replayed.",
  PAID_RETURNED_EVENT_VERSION: "v1 is prospective source-owned paired-action proof and fresh raw lineage only. Existing same-unit, judged and held histories cannot be bypassed by projected names or line_share; mixed/unknown scope stays eligibility-held. Extract88/stale78/lineup73/twin82/verify3/source-check2/recheck5/publish3 remain settled. No selector, global category-guard version, historical replay, recovery, provider or source work is queued.",
  // #2265: implementation versions cannot authorize the broader identity rollout.
  HMDA_PARSER_VERSION: "Implementation v3 is prepared, but the default-off ordinary identity gate leaves HMDA_SCHEDULED_PARSER_VERSION at2. Registry replay counts use that effective scheduled selector; the explicit ten-bank repair is manual-only and creates no automatic replay. Any ordinary activation requires separate review, including #2266.",
  FDIC_UNIVERSE_PARSER_VERSION: "Implementation v3 is prepared, but own-LEI propagation is default off and FDIC_UNIVERSE_SCHEDULED_PARSER_VERSION stays2. Registry replay counts use the effective scheduled selector. Enabling broader source identity writes is a separate reviewed release; the ten-bank repair does not authorize it.",
  // Mountain Star FCU fee 159428 (Nov 2): the replay is behind its own switch, off.
  PDF_LAYOUT_REPLAY_VERSION: "v6 names the layout version a reader replay brings stored read.pdf_layout texts to (side-by-side fee tables keep each cell in its own table). With PDF_CELL_REPLAY_LIVE off (the code default) it selects nothing; on, every current completed read.pdf_layout text with a cell break and no layout read of its bytes at v6 is read once more in the reader replay lane (rosetta.reader_replay receipts, key pdf_layout_version), and the rosetta.read manifest counts it. Nov 2 (SELECT on prod): 3,226 such texts carrying 30,735 live fees. The record-only layout recheck measures the live fees first; a changed text goes to Knox and Darwin re-checks its fees. No fee row or provider work is touched by the version.",
  PDF_PROSE_REREAD_VERSION: "Frozen layout4 prose retry floor. Stacked layout5 has a separate measured current-copy witness and pdf_stacked@1 persisted-artifact check; changing PDF_LAYOUT_VERSION does not reopen every settled prose document.",
  // #2068, #2057: lessons apply when Knox reads a text, so they reach old texts only on a re-read.
  KNOX_LESSONS_VERSION: "v5 also reads extract-stage hand corrections, category holds and Deming's category-guard audit misses as category verdicts, one bank each (v4 added name-family lessons). Lessons are read at each extract step and act on texts Knox reads; old texts are read again only when KNOX_RULES_STRATEGY moves, and the knox.rules manifest counts that replay. Dry run 2026-10-26 (SELECT on prod pipeline_feedback): 0 rows teach a category yet (no extract correction or hold of a person's own, no category audit miss; 76 name and 3 amount misses teach none; 21 takedown-sync copies of corrections are skipped), so no lesson or live fee changes until such findings are filed; every re-filed fee is still checked by Darwin.",
  // #2062: lessons apply when Knox reads a text, behind their own switch, so nothing replays.
  KNOX_AUDIENCE_LESSONS_VERSION: "v2 (#2072) no longer trusts a business-only address for every fee of the document: when the document's stored text holds a priced personal section (a tabbed page), only a fee whose own line sits under a business heading is taught, and one under a personal or general heading, or whose line cannot be placed, stays unknown; with no stored text there is no document lesson. The v1 sample was 27/47 correct, all 20 errors on one tabbed page (Portland FCU, document 37425); the v2 count on prod was not re-run. v1 reads confirmed business-schedule takedowns still down for that reason as the audience of their own document's fees: the same name at the same amount there, or every fee of a business-only document, is written business when the line states no audience. Applying waits for KNOX_AUDIENCE_LESSONS_LIVE (off); off, each extract step only counts the reads it would label. Dry run 2026-10-27 (SELECT on prod): 396 lessons on 158 documents; 47 live fees with no audience on 13 banks' business-only documents would be read as business on a re-read. KNOX_RULES_STRATEGY is not moved, so no text is read again; switching the lessons on takes that bump, and the knox.rules manifest counts its replay. No fee row, verified or published tier, or provider work is touched by the version.",
  // #2062: lessons apply when Knox reads a text, behind their own switch, so nothing replays.
  // Gap 11 (Nov 2): a report on the extract step's detail behind an off switch; not a selector that replays fee work.
  KNOX_FREE_PATH_LESSONS_VERSION: "v1 runs every Knox role lesson that has a machine part (freePathRule: rate_floor, loan_payment_example, no_fee_sentence, maintenance_per_item, each a shared test with a Darwin live twin) on every read the free extract step writes, and names the free_path_lessons report on the step detail: the lessons run, the ones that fired with up to 20 lines each, and the prose-only lessons not applied. Holding a read waits for KNOX_FREE_PATH_LESSONS_LIVE (off); off, nothing is written differently. On, a fired read is written held for review (knox_review:taken_down under knox.role_lesson:<id>), never sent to Darwin; a row already written is never touched. Dry run 2026-11-02 (SELECT on prod): of 10,222 free reads in 3 days, the rules' prefilters keep 251 rows, 230 of them categorised reads, and no rule fires on any of them, so switching on would change 0 of the sampled reads. KNOX_RULES_STRATEGY is not moved, so no text is read again; no fee row, verified or published tier, or provider work is touched by the version. v2 (Nov 2): the maintenance_per_item rule (shared ownLinePricesPerItem) lets a period that starts the words right after the read's own price win over per-item wording later in the line or its run-on name, so \"$10 monthly maintenance fee and per item fees apply\" (raws 1348250, 1286678) no longer fires. Re-run on the sampler's 259 free reads Oct 30 to Nov 2: fires 12 to 10 (maintenance_per_item 3 to 1, the two false ones gone; raw 1344273 \"$10.00 per debit\" still fires). The switch stays off, so nothing is written differently; nothing older to replay.",
  KNOX_READ_LESSONS_VERSION: "v1 reads other checks' fixes to a document's read as lessons for that document's next extract, keyed on document, name and amount: a frequency Hamilton's fill or Darwin's hourly check set on the live fee is written on a read that repeats the old one; a fee still down as a wrong payer, a frequency hold or Knox's own same-document duplicate (when the text also reads the kept name) is written held for review; a held line Knox's recheck promoted and Darwin verified, still live, is written under the verified category. Applying waits for KNOX_READ_LESSONS_LIVE (off); off, each extract step only counts the reads it would change. Dry run 2026-10-27 (SELECT on prod): 11,452 frequency, 4 wrong-payer, 40 frequency-hold, 92 duplicate and 940 promotion lessons; no live fee is taken down or re-filed, only new raw reads change. KNOX_RULES_STRATEGY is not moved, so no text is read again; no fee row, verified or published tier, or provider work is touched by the version.",
  // #2186: prospective hard-hold proof cannot be fabricated for historical confirmations.
  TAKEDOWN_LESSONS_VERSION: "v2 restricts newly inserted learned holds to complete supported fee identity and a limit-guard witness captured before judgement, retained in confirmation, and current at insertion. Missing/unsupported/contended proof leaves new candidates for ordinary Darwin. Existing raw rows/holds and extract83/stale78/verify3/batch4/publish3/refresh2/current-copy2/newer-copy1 fingerprints stay settled; no historical release, replay or provider work is queued.",
  // #1911 code phase: evidence format, not a new extraction selector or recovery authorization.
  ANCILLARY_PRODUCT_VERSION: "v1 owns only newly inserted raw rows from a bounded single-primary-product document. Existing raw conflicts, held takeovers and settled extract/verify/publish/copy decisions stay unchanged. Normalized represented-product guards restrict future matching and ordinary live duplicate sweeps; no metadata backfill, historical replay, numeric-policy change or recovery is queued. The flag stays v1 when a second document form proves the product (2026-11-01, #1911: a short single-account disclosure that defers to the general fee schedule, `singleAccountDisclosure`, read only while KNOX_SINGLE_ACCOUNT_OWNER_LIVE is on): every reader re-derives the owner from `primaryAncillaryProduct`, so no reader needs to tell the forms apart.",
  // #1911 current-data recovery: a correction strategy behind its own switch, not a re-read selector.
  ANCILLARY_OWNER_CORRECT_STRATEGY: "v2 (2026-11-01, #1911) also plans single-account disclosures (`singleAccountDisclosure`); their changes apply only while KNOX_SINGLE_ACCOUNT_OWNER_LIVE is on (off by default) and documents settled with it off carry a v2-sa-off fingerprint, so each is read once more when it turns on. Bumping v1 to v2 re-reads each scoped document once under the wider screen. v1 names the attempts of Knox's ancillary product recovery (ancillary-owner-correct.ts): each document with a live Knox fee whose raw row has no product is read once per version and text id, and a fee its single named product's fee block witnesses takes that product and the ancillary_product:v1 flag, only while product_name is NULL. Applying is on by default since 2026-10-31 (James's yes on #2072); KNOX_ANCILLARY_OWNER_CORRECT_LIVE set to 0, false or off rolls it back to counting only. No extraction, verification or publication fingerprint is reopened, no row is deleted, no provider work is queued.",
  // #1912 current-data recovery: a correction strategy behind its own switch, not a re-read selector.
  ACCOUNT_SUBJECT_CORRECT_STRATEGY: "v1 names the attempts of Knox's account subject recovery (account-subject-correct.ts, #1912): each document with a live Knox monthly maintenance or minimum balance fee whose raw row has no product is read once per version and text id, and a fee whose own sentence (or the line just above) names its account as subject at the fee's own price, and whose whole lineup read today records that account, takes it, only while product_name is NULL. Bank- or state-scoped steps only. Applying waits for KNOX_ACCOUNT_SUBJECT_CORRECT_LIVE; off, it only counts. No extraction, verification or publication fingerprint is reopened, no row is deleted, no provider work is queued.",
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
  // v3 (#1986): the same step also re-reads every translated-copy takedown and restores one whose English line is gone (switch off).
  TRANSLATED_COPY_CHECK_VERSION: "Each verify step re-reads every live fee on a Spanish-copy document and, from v3, every translated-copy takedown (no cursor); nothing to replay.",
  // v2 (#1910): the name cover reads NSF/insufficient, OD/overdraft and a paid NSF item/overdraft as one item.
  PRODUCT_PAGE_REPEAT_CHECK_VERSION: "Each verify step re-reads every live product-page fee with a same-price schedule twin (no cursor), so version 2's wider name cover reaches every live fee on the next step; nothing older to replay.",
  NO_FEE_SENTENCE_CHECK_VERSION: "First version: each verify step reads every live flat fee whose stored line has a \"no ... fee\" sentence before a price (no cursor, 19 rows on Oct 30); its switch is off, so it only reports; nothing older to replay.",
  WORKED_EXAMPLE_CHECK_VERSION: "First version (prod sample, Nov 2): each verify step reads every live flat fee whose prose excerpt has an example word in the 3,000 characters of its stored text before it (no cursor; 1,267 rows on Nov 2 with the text hash proved, 1 match, 89920); its switch (DARWIN_WORKED_EXAMPLE_TAKEDOWN_LIVE) is off, so it only reports; nothing older to replay.",
  LOAN_PAYMENT_EXAMPLE_CHECK_VERSION: "First version (#2854): each verify step reads every live flat fee whose stored line has payment words, the amount financed, per $1,000 or \"for N months\" (no cursor, 443 rows on Nov 1, 4 matches); its switch (DARWIN_LOAN_PAYMENT_EXAMPLE_TAKEDOWN_LIVE) is off, so it only reports; nothing older to replay.",
  STALE_COPY_CHECK_VERSION: "First version (Nov 2): each verify step reads the next 60 superseded copies that still carry live flat fees after a ledger cursor, so every copy is read again on the next pass; nothing is recorded per copy, so there is nothing to replay. v2 (Nov 2) keeps more pairs live (own-name row elsewhere, two-fee row, missing qualifier); the cursor pass reads every copy again under it, and its switch (STALE_COPY_RETIRE_LIVE) is on. v3 (Nov 2) keeps a would-be drop live when the current copy still names and prices it, restates it in the same category and amount, or comes from another address; with STALE_COPY_DROPPED_LINE_LIVE on (Nov 2, after a sampled-clean dry run) a drop counts a Knox read from the stale-read floor and recognizes a same-address page by its text. The cursor pass reads every copy again under it.",
  OD_TRANSFER_REFILE_CHECK_VERSION: "First version: each verify step re-reads the stored line of every live overdraft fee that says transfer, sweep or protection (no cursor, 122 rows after an Oct 31 rollback); its switch is off, so it only reports; nothing older to replay.",
  LOAN_PAYMENT_NSF_REFILE_CHECK_VERSION: "First version: each verify step reads every live NSF fee whose name prices a bounced loan, mortgage or lease payment (no cursor, 2 rows on Oct 31); its switch is off, so it only reports; nothing older to replay.",
  PROTECTION_ITEM_REFILE_CHECK_VERSION: "First version: each verify step re-reads the stored page of every live overdraft-protection transfer fee named only \"Overdraft Protection\" (92 rows on Nov 1, 5 would re-file); its switch is off, so it only reports; nothing older to replay.",
  // v1 (#2248): live flat fees whose own line proves a page, document, image or statement unit.
  OWN_UNIT_CHECK_VERSION: "First version: its cursor re-reads every live flat per-event fee whose stored line names a unit (2,000 a verify step); its switch is off, so it only reports; nothing older to replay. #1905 (Nov 1) adds live fees with no frequency whose own line names a part of an hour (a fraction glyph included), written only with OWN_UNIT_BLANK_PART_HOUR_LIVE (off): dry run 34 re-files at 30 institutions (9 at 8 written with ½ or ¼). The version stays 1: nothing was ever written, and the cursor reads every candidate again each pass. v2 (Nov 2): the shared unit reader (Knox v156) reads no unit from a free allowance's period or from one price that names two units; nothing had been written under v1 (switch off), so there is nothing older to replay: 3 of the 758 per-event re-files drop out (98831, 65324, 134768).",
  // v1 (inst 608): a live monthly or minimum balance fee filed under an account above a numbered heading.
  ACCOUNT_OWNER_CHECK_VERSION: "First version: its cursor re-reads every live Knox monthly maintenance or minimum balance fee with a stored account (1,000 a verify step); its switch is on since 2026-11-02, so a `refile` takes today's account at once (no second look), never on an admin-corrected fee; nothing older to replay.",
  // v1 (Oct 30): live monthly maintenance fees stored per item.
  MAINTENANCE_FREQUENCY_CHECK_VERSION: "First version: each verify step re-reads every live monthly maintenance fee stored per item (no cursor, 17 rows on Oct 30); its switch is off, so it only reports; nothing older to replay. v3 (Nov 2): a period right after the fee's own price wins over per-item wording later in its line or name (shared ownLinePricesPerItem, also Darwin's verify hold maintenance_per_item). Dry run 2026-11-02 (SELECT on prod): 0 of 298 live per-event or blank maintenance fees held before and after; of the 90 live maintenance fees whose name or line has per-item wording after a price (SQL prefilter of 4,563), the shared test drops from 13 to 10 per-item calls (54443, 160822, 61618 are $5.00/month fees). Nothing to replay: the check judges every row again each step.",
  // v1 (Pipeline wiring audit gap 2, Nov 2): range and peer holds sent back to the bank's page.
  HOLD_SOURCE_REREAD_STRATEGY: "First version: each pass reads the 100 oldest range and peer holds not yet read on their current copy (a fresh fetch requested for a copy over 30 days old, else a free Knox re-read of the current text); its switch is off, so it only reports and records no attempt. Its own attempts key each hold on its current document or text, so a later version reads every hold again once; there is nothing older to replay. Dry run Nov 2 (prod, read-only): 5,551 holds, 217 stale copy, 5,154 current copy, 180 no text. v2 (Nov 2): a confirmed re-read releases its hold (back to verify) only when the held reason no longer applies under today's range and peer checks (holdReasonCleared); otherwise it is recorded as confirmed_still_held and stays held, and a confirmation whose amount its line gives as a limit stays held as stated_unread. v1 never wrote an attempt (switch off), so there is nothing older to replay; the version bump makes every hold due once under v2. Dry run (prod, read-only, SQL replica of the gate over all 5,535 eligible holds, not the reader): 2,443 would release if confirmed, 3,092 would stay held.",
  // v1 (#1513): a live fee whose own line Knox's re-read files under another category (other_category).
  REREAD_CATEGORY_CHECK_VERSION: "First version: each verify step re-reads every live fee whose Knox re-read settled other_category (no cursor, about a dozen rows); its switch is on since 2026-10-31 (James's yes on #2072), so a re-file or twin takedown follows the 12-hour second look, never on an admin-corrected fee; nothing older to replay.",
  // v1 (#1673): same-line copies the v1 restore brought back beside their older line's live replacement.
  SAME_LINE_REPLACEMENT_CHECK_VERSION: "First version: each verify step re-reads every live fee after a confirmed same-line takedown (no cursor, a few dozen rows); its switch is on (Oct 26), so matches come down after the second look; nothing older to replay.",
  // v1 (#1876): two live reads of one printed line (same document, line, category and amount).
  SAME_LINE_READ_CHECK_VERSION: "First version: each verify step re-reads every live fee that shares its stored source line with another (no cursor, a few hundred rows); its switch is on (Oct 26), so matches come down after the second look; nothing older to replay.",
  // v1 (Nov 3): live fees read from a document whose address calls it old or archived (old-labelled-document-check.ts).
  OLD_LABELLED_DOCUMENT_CHECK_VERSION: "First version: a verify step re-reads every live fee whose document's path passes the old-or-archived pre-filter (no cursor, at most hourly, 238 candidates and 86 old-labelled on Nov 3); its switch (OLD_LABELLED_DOCUMENT_TAKEDOWN_LIVE) is off, so it only reports; nothing older to replay.",
  // v1 (Nov 3): one printed line live under two products (product-split-check.ts).
  PRODUCT_SPLIT_CHECK_VERSION: "First version: each verify step re-reads every pair of live dollar fees of one institution, category, variant and amount under different products whose stored lines fold to the same words, on one document or an older copy and its current copy (no cursor, 119 pairs on Nov 3); its switch (PRODUCT_SPLIT_MERGE_LIVE) is off, so it only reports; nothing older to replay.",
  // v1 (#1882): a live $0 overdraft that is only the smallest band of a priced cell or row.
  BANDED_ZERO_CHECK_VERSION: "First version: each verify step re-reads every live $0 overdraft, NSF and continuous overdraft fee (about 140 rows, no cursor); its switch is on (Oct 26), so matches come down after the second look; nothing older to replay.",
  // v1 (#1397): a live $0 that is an item in one named account's list of benefits (Knox rules v157 holds new ones).
  ACCOUNT_BENEFIT_ZERO_CHECK_VERSION: "First version: each verify step re-reads every live $0 fee whose stored line is a free item (no cursor, 142 rows on Nov 1); its switch (DARWIN_ACCOUNT_BENEFIT_ZERO_LIVE) is off, so it only reports; nothing older to replay. v2 (Nov 3, Knox v171): also reads an item under \"This account also includes:\" and a perk an account's own cell of a comparison table prices free, and selects live $0 cell rows on texts with an account header (308 candidates on Nov 3, the same 12 matches as v1, none new); still a report while the switch is off, re-read every step, nothing to replay.",
  SERVICE_MAINTENANCE_CHECK_VERSION: "First version: each verify step re-reads every live flat monthly maintenance fee whose text prints a service's words (no cursor; not yet counted on prod); its switch (SERVICE_MAINTENANCE_TAKEDOWN_LIVE) is off, so it only reports; nothing older to replay.",
  NOT_ACCOUNT_FEE_LINE_CHECK_VERSION: "First version: each verify step re-reads every live flat fee whose Knox line says no dividend or interest is earned, and every live monthly maintenance fee on a text that prints an online services section title (no cursor; 493 rows on Nov 2, 2 matches, live 73916 and 152003); its switch (NOT_ACCOUNT_FEE_LINE_TAKEDOWN_LIVE) is off, so it only reports; nothing older to replay.",
  FREE_LIST_ITEM_CHECK_VERSION: "First version: each verify step re-reads every live flat priced fee whose Knox line joins a name line to a price line on a text that prints a free services list heading (no cursor; 39 rows on Nov 2, 1 match, live 159428); its switch (FREE_LIST_ITEM_TAKEDOWN_LIVE) is off, so it only reports; nothing older to replay.",
  CREDIT_CARD_SECTION_CHECK_VERSION: "First version: each verify step re-reads every live flat card replacement and rush card fee on a text that names a credit card with Knox v175's credit card section reader (no cursor; 2,347 rows on Nov 3, 75 matches on 62 texts); its switch (CREDIT_CARD_SECTION_TAKEDOWN_LIVE) is off, so it only reports; nothing older to replay.",
  ZERO_WAIVER_ROW_CHECK_VERSION: "First version: each verify step re-reads every live flat $0 fee whose stored line opens with a no-fee phrase or says \"to avoid / to waive\" (no cursor; not yet counted on prod); its switch (ZERO_WAIVER_ROW_TAKEDOWN_LIVE) is off, so it only reports; nothing older to replay. v2 (Nov 2, Knox v168): also reads a $0 whose free word is advice in a \"Ways to Avoid\" section (avoid_fee_advice); read-only on prod, 2 live fees match (89909, 105000 at Financial Health FCU), reported only while the switch is off.",
  // v2 (#1673): the same-line restore follows the older line's replacement before bringing a copy back.
  SAME_LINE_DUPLICATE_RESTORE_VERSION: "Each publish step re-reads every same-line takedown whose older line is down (no cursor), so v2's replacement check reaches every pending restore on the next step; the copies v1 already restored are read by Darwin's same-line replacement re-check.",
  // v1 (#1915): schedule editions not yet in effect. Every verify step reads every live fee on a dated document.
  // v2 (T1): an edition line past a web page's menu, counted only until EDITION_LATE_HEADING_LIVE.
  // v3 (#1945): a later dated edition of the same schedule takes over, read from every text-dated document each step.
  // v5 (Nov 3, backlog dry run 7): a schedule's closing edition line ("Effective Date 01/05/2027." after the footnotes, GTE doc 42265).
  EDITION_CHECK_VERSION: "Each verify step re-reads every live or held fee on a document whose heading or late edition line states an edition, and every verified row on a document whose text states its date (no cursor); nothing older to replay. v5 (Nov 3): the shared reader also takes a schedule's closing edition line; dry run (SELECT on prod) over 690 short texts with a 2026-2028 effective line past the heading: 2 more documents not yet in effect (GTE 42265 with no rows yet, Solon/Chagrin Falls 16774 with 7 live fees held until 2026-12-01), no new takeover, restore or lost hold. The publish hold (edition-hold.ts) reads the same reader each step, so nothing older to replay.",
  // v1 (#2022): Canadian bank documents. A full verify step re-reads every live document's text at most hourly.
  CANADIAN_DOCUMENT_CHECK_VERSION: "First version: a verify step re-reads every live fee's document text (no cursor, at most hourly); nothing older to replay.",
  // v1 (#1905): a late charge's cap or floor read as the late fee. On (LATE_CHARGE_BOUND_TAKEDOWN_LIVE), sampled clean 5 of 5.
  LATE_CHARGE_BOUND_CHECK_VERSION: "First version: each verify step reads every live late_payment fee whose name is a late charge's cap or floor (no cursor) and takes it down after the second look; nothing older to replay.",
  // v1 (#1615): a percentage charge's floor read as a flat fee. On (RATE_FLOOR_TAKEDOWN_LIVE) since James's yes, Oct 26.
  RATE_FLOOR_CHECK_VERSION: "First version: each verify step reads every live flat fee whose stored line carries greater-of wording and a percentage (no cursor, 58 rows on Oct 25); its switch is on (Oct 26), so matches come down after the second look; nothing older to replay.",
  // v1 (#1912): a live international wire fee whose own line states no direction, or another one. On
  // (INTERNATIONAL_DIRECTION_TAKEDOWN_LIVE) since v3 sampled clean, 2026-11-02.
  INTERNATIONAL_DIRECTION_CHECK_VERSION: "Each verify step reads the next batch of live international wire fees after a cursor on the run ledger, so every pass reads every live fee again; nothing older to replay. v2 (2026-11-02) keeps an undirected international wire filed outgoing when its document lists incoming wires apart or names no direction: 65 of 2,458 match (420 at v1). v3 (2026-11-02) keeps it unless the document prices an incoming international wire at its price: 7 match, all right in the sample, so the switch is on. v4 (2026-11-02, #2890) reads an incoming price only from a wire line, its first price, and counts an equal one only beside an outgoing international price that differs: 6 match (152355 kept). The cursor re-reads every live fee; nothing older to replay.",
  // v1 (#1908, #1905): fees printed in a prepaid, payroll, gift or travel card section of a general
  // schedule. A full verify step re-reads every live document whose text names a card program, at most hourly.
  CARD_PROGRAM_SECTION_CHECK_VERSION: "First version: a verify step re-reads every live fee on a document whose text names a card program (no cursor, at most hourly); nothing older to replay.",
  // v1 (#1905): deposit-category fees printed in a loan section of a general schedule. On
  // (LOAN_SECTION_TAKEDOWN_LIVE) since James's yes, Oct 26.
  LOAN_SECTION_CHECK_VERSION: "First version: each verify step reads the next batch of documents behind a live deposit-category fee whose text names a loan, after a cursor on the run ledger; its switch is on (Oct 26), so matches come down after the second look; nothing older to replay.",
  // v8 (#1112): new no-fee, discount, allowance and loan-amount name rules. Each step's eval-verdict
  // pass reads every live fee whose name or line matches one of their prefilter clauses
  // (`V8_PREFILTER`), then the second look; Darwin reads each new row under them. There is no
  // backlog for a replay to count. v9 (#1696): the stored line's "$X discount" at the fee's own
  // amount, with its own clause (`V9_PREFILTER`); the fees only v9 fails (8 live on 2026-10-26) wait
  // behind `EVAL_VERDICT_SECOND_BATCH_ACTS`.
  EVAL_VERDICT_VERSION: "Each step re-reads every live fee the eval-verdict prefilter selects (each rule shape has a clause, V8_PREFILTER and V9_PREFILTER), and Darwin reads each new row at verify; nothing to replay.",
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
  // Nov 2 (replay backlog review): the re-read floor. The once-per-version re-read classes wait for it
  // or for KNOX_REREAD_REFRESH_DAYS, so a rules bump below it adds no queue; the knox.rules manifest's
  // queue is the step's own selection, and its knox_read_at_floor_recently exclusion counts the texts it holds.
  KNOX_REREAD_BELOW_VERSION: "The re-read floor inside the extract step's selection; the knox.rules manifest counts its queue (countKnoxRereadsDue) and the texts it holds (knox_read_at_floor_recently).",
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
  // #1200: publish follows the current copy, a re-point of live fees in place, not a selector Bayes replays.
  CURRENT_COPY_REPOINT_STRATEGY: "v2 moves a live fee on a superseded copy onto the current-copy row publish skipped as identical to it, in place: name, amount, category, id and published date stay. The row must trace to the same printed line, the current copy must be newer, and the live fee must pass the shared source check on the current copy. It holds, rejects or re-files no fee and records no price change; while PUBLISH_REPOINT_CURRENT_COPY_LIVE is off it only counts. No historical replay or backfill is queued.",
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
  // v2 (#2055): the selector skips banks tried at this version only, so the fetch steps re-try each
  // v1 bank once themselves (free GETs, 10 a step) and its attempt now records detail.link.
  SAVED_LINK_FETCH_STRATEGY: "A free fetch route; every fetch step selects the saved links not yet tried at this version and works through them (v2 re-tries each bank once so its attempt records the saved link it asked for), so there is nothing to replay.",
  LIVE_SOURCE_REFETCH_STRATEGY: "A new free fetch route (#1200); every fetch step selects the stale pages live fees cite, oldest first, so there is nothing to replay.",
  // v3 / v2 (#1326): the re-searches no longer accept the link they replace. Their selectors pick
  // every bank not yet searched at the new version, so the discover steps re-search them themselves.
  UPGRADE_SEARCH_VERSION: "Its selector re-searches every product-page link not yet searched at v3; there is nothing to replay.",
  FRESHNESS_SEARCH_VERSION: "Its selector re-searches every stale link not yet searched at v2; there is nothing to replay.",
  // v1 (#1878): a new pass that stores each document's own stated date. Its selector reads every
  // live-fee document and current copy whose stated_date_version is below the current one (200 a
  // discover step), so a new version re-dates them itself.
  STATED_DATE_VERSION: "Its selector dates every live-fee document and current copy not yet dated at the current version (200 a discover step); there is nothing to replay.",
  // v2 reader (Nov 2 audit): STATED_DATE_BACKFILL_LIVE is on, so STATED_DATE_VERSION is 2 and the
  // same selector re-reads every v1 document with it (the backfill).
  STATED_DATE_READER_VERSION: "Its own selector re-dates every v1 document now STATED_DATE_BACKFILL_LIVE is on (200 a discover step); there is nothing to replay.",
  STATED_DATE_FIRST_VERSION: "Not a rerun: the oldest stated-date version readers accept, so v1 dates stay readable while v2 re-reads them.",
  // v1 (#1342): a new hand-started step that reads every live fee with no source link on each run.
  SOURCE_LINK_VERSION: "Its own step reads every live fee with no source link on each run; nothing to replay.",
  SOURCE_LINK_DRIFT_VERSION: "Every publish step reads every live fee whose link opens another page than its own document; nothing to replay.",
  // v3 (#1397): the recheck reads every verified row once per version, so each verify step works
  // through the whole verified set under v3 itself (200 a step).
  // v4 (#1571, #1574): the same selector re-reads every verified row once under v4.
  // v5 (#1593): and once more under v5.
  DARWIN_RECHECK_STRATEGY: "Its selector re-reads every verified row not yet read at the current version (200 a verify step); there is nothing to replay.",
  // v2 (#1397): tier disclosures named TIS, terms and charges or summary of fees, and the bank-wide no-charge exception.
  TIER_PERK_RULE_VERSION: "The recheck reads it on every row it judges; verify and the conditional-$0 resolver still call the v2 rule (tierPerkZero), a follow-up on #1397. Live rows the recheck already read at v5 are reached by its own cohort (DARWIN_RECHECK_TIER_RULE_LIVE, on since 2026-11-02): live $0s on a tier address no attempt read under this rule version. v3 (2026-11-02) fails a tier schedule's $0 only when the bank's general schedule prices the fee: 13 at 3 institutions, 6 would fail, 7 stay. Nothing else to replay.",
  // v1 (Gap 9, Pipeline wiring audit Nov 2): a fee against the bank's live value for it.
  // v2 (#2924): same page or schedule priors only, real unheld priors, take down only an older edition.
  HISTORY_RULE_VERSION: "Verify records each accepted fee's history verdict and the recheck's history cohort reads live fees whose priors at publish all disagree with them (100 a step, detail.history_rule); its switch (DARWIN_HISTORY_CHECK_LIVE) is off, so both only report. v2 (2026-11-02): v1 history_jump holds are re-read under v2 and the cohort reads each live fee once more (154 live fees at 106 institutions in the v2 cohort); v1 never acted, so nothing else to replay.",
  LAYOUT_RULE_VERSION: "The recheck's layout cohort (on with DARWIN_CONDITIONAL_ZERO_LAYOUT_LIVE, since 2026-10-31) re-reads the rows a v5 read failed as conditional_zero that no attempt read under this rule version (detail.layout_rule): 65 rejected rows, none live, on 2026-10-31 (4 would pass). Nothing else to replay.",
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
  // v8 (#1521): a floor read without the line's thresholds ("$500 minimum balance" is none), and a
  // floor holds a refused line only when the amount is not a cap's or opening deposit's figure; the
  // same cursor reads every live name again. Dry run 2026-10-26: no live verdict changes.
  // v9 (#1443, #1521): names cut on a comparison ("Paid NSF Item <") join as rereads only, behind
  // COMPARATOR_FRAGMENT_REREAD_LIVE (off at first; shadow `comparator_shadow`), plus the floor nits; same cursor.
  // Dry run 2026-11-01: switch off no verdict changes; on, 66 rereads, 0 takedowns, 0 renames.
  // v9 round 2 (#1443): a comparator reread never pre-empts a pronoun or takedown verdict; the comparator
  // shape is read only for a name with none. COMPARATOR_FRAGMENT_REREAD_LIVE turns on (sampled clean) on
  // the dry run of 2026-11-02: 0 takedowns, 66 rereads, 1 pronoun reread kept, no live fee changes action.
  // No bump: the same cursor reads every live name again under the switch; nothing to replay.
  LIVE_FRAGMENT_STRATEGY: "Its cursor re-reads every live fee name each pass (2,000 a verify step); there is nothing to replay.",
  // v2 (#1456): a fee whose name is silent on the hour is read on its own stored line too; line-only
  // fees are written only with HOURLY_LINE_LIVE on (on since 2026-10-20). Same cursor.
  HOURLY_CHECK_VERSION: "Its cursor re-reads every live fee name and stored line for an hourly price each pass (2,000 a verify step); there is nothing to replay.",
  // v1 (#1442): a new shadow pass. Its ledger cursor re-reads every live fee's source document address
  // each pass (2,000 a verify step), and nonDepositCountSql counts the whole live table read-only.
  // v2 (#1518): lending wording on loan documents and brokerage_document (own sub-switch) as their
  // own reasons, generic lending fees on rate pages kept live; same cursor, shadow, nothing written.
  // v5 (#1944 follow-up): a card's Truth in Lending rate table at the opening (credit_terms_document,
  // its own sub-switch, off); same cursor, so the next pass counts it; nothing written while off.
  NON_DEPOSIT_CHECK_VERSION: "Its cursor re-reads every live fee's source document address, and since v4 its document's opening, each pass (2,000 a verify step); there is nothing to replay.",
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
  // v24 (#1918): "$15K" or "$1.5M" is a balance, never a price; same fingerprint path.
  // v25 (#1916): a late charge in a safe deposit box section is not a late payment; same fingerprint path.
  // v26 (#2070): a fee whose every row at its price is for a discontinued account is refused; same fingerprint path.
  // v30 (#2040): NO_CHARGE_SENTENCE_READ_LIVE on, so an NSF $0 traces to a no-charge sentence; same fingerprint path.
  SOURCE_CHECK_STRATEGY: "Its fingerprint carries the version, so each publish step's batch re-checks every institution not yet checked at the new version; nothing to replay.",
  // v3 (#1810): headings over an opening deposit, "Interest Checking" and numbered accounts name a fee.
  // v4 (#1917): a fused breadcrumb or menu is no heading, and a comparison table's header row stops
  // the search. Names given before from a heading v4 refuses (3 live on Oct 25) are set back by the
  // step itself, across every institution, before it names again.
  ACCOUNT_NAME_STRATEGY: "Its fingerprint carries the version, so each publish step's batch (40 institutions) re-reads every institution with a generic monthly name not yet read at v4; earlier names from a refused heading are set back by the step; nothing to replay.",
  STATE_LISTS_PARSER_VERSION: "New sources (depositories, non-bank lenders, Urban debt held until its license is confirmed); no older rows to replay.",
};

export async function loadManifests(): Promise<ReplayManifest[]> {
  const { REGISTRY_PARSER_VERSIONS } = await import("@/lib/agents/registry-scheduler");
  // From reader-versions.ts, which imports nothing: the readers themselves load PDF and OCR code.
  const rosetta = await loadRosettaVersions();
  const manifests: ReplayManifest[] = [
    // v83 (#2151): faithful wrapped bullets use the existing due-text selection.
    // No stale-floor increase or historical rejection replay accompanies this fix.
    // v132 (#1912): a commercial lockbox service is no safe deposit box (held unclassified); the live
    // fee it reached (135270) comes down through guard v100's catch-up, not a replay. Floor stays v97.
    // v133 (#2040): a "we do not charge an NSF fee" sentence is the NSF fee's $0, behind
    // NO_CHARGE_SENTENCE_READ_LIVE (off), so the bump reads nothing new; switching it on takes its own
    // bump. Oct 27 dry run (read-only, current copies, after the third #2753 review, refuse by default on
    // any other NSF fee sentence that does not agree with the $0): 3 texts at 3 institutions would read
    // it, none held. Floor stays v97.
    // v134 (#1912): the international wire direction review reads more of the ways banks print a
    // direction ("(in/out)", "Wire – Out", "Outside U.S.", a direction in the next cell). Live fees it
    // reaches are judged by Darwin's international direction re-check (switch off), not a replay. Floor stays v97.
    // v135 (#1912): a wire's channel printed after its price ("$30.00 - phone request") stays in its
    // name. Category and amount are unchanged, so the rules re-check reproduces the same fees and no
    // live fee moves; Oct 27 dry run (read-only): 3 of 187 candidate live wire fees would be renamed on
    // a re-read (110356, 110355, 71592). Floor stays v97.
    // v136 (#2067): a percentage charge's minimum or maximum ("($10 Max) | 5% of Total") is held as the
    // rate, never read as a flat fee. The rules re-check keeps the live ones while the shared check traces
    // them (SOURCE_CHECK_RATE_BOUND then off); source check v27 counts them (17 at 17 institutions, Oct 27
    // dry run). No replay. Floor stays v97. SOURCE_CHECK_RATE_BOUND is on by default since 2026-10-31 (#2072).
    // v137 (#2137): a reward, bonus or credit paid to the customer ("2) Earn $50 when you complete two or
    // more online bill payments", "$5 reward") is no fee. The rules re-check keeps the live ones while the
    // shared check traces them (SOURCE_CHECK_REWARD_CREDIT off); source check v28 counts them (7 at 7
    // institutions, Oct 27 dry run). No replay. Floor stays v97.
    // v138 (#2285): a wire line whose direction prices #2021's reader declines ("Business Wire Fees" over
    // "Wire Transfer Fee | $5 on Incoming Wires / $10 on Outgoing Domestic") is held, each price with its
    // own direction and a business heading's audience, and no legacy reader reads it again. Adds holds
    // and removes borrowed reads only; Oct 30 count (read-only): no current text has such a line, so no
    // live fee moves. No replay. Floor stays v97.
    // v139 (#2248): a fee's own literal unit ("Photocopies - $0.75 per page", "$0.50 per page ($2.50
    // minimum)") is read through a dash, markdown emphasis, its own floor or cap and a slashed label, so
    // a new read keeps per_page and its own clause instead of per_item. Prices unchanged; new reads only.
    // Oct 30 count (read-only): on the own lines of 667 live legacy page-priced fees at 522 institutions
    // the reader now witnesses 549 (was 522). No live fee moves. No replay. Floor stays v97.
    // v145 (#2072, Oct 31): no rule changes. KNOX_REREAD_PUBLISHED_NAME_LIVE turns on (James's yes on
    // the decision card) and the bump reads settled re-read requests again: 5 kept-live fragments take
    // publish's full name (dry run Oct 27-30, `published_name`). No replay. Floor stays v97.
    // v151 (#2137, Nov 1): a fee's reimbursement, refund or rebate, or a credit toward a fee ("$500
    // appraisal fee reimbursement", "$35 annual fee credit towards the cost of a safe deposit box"), is a
    // reward paid to the customer, not a refund of the account's own service charge; held reads at one
    // drop too. Drop-only. Source check v29 counts the live ones (9 at 9 institutions, Nov 1 dry run)
    // behind SOURCE_CHECK_REWARD_CREDIT (off). No replay. Floor stays v97.
    // v152 (#1905, Nov 1): a fraction glyph names a part of an hour ("Checkbook balancing (repeated) |
    // $5.00 (per ½ hour)", Navy Federal; "$25.00 per ½ hr.", "$10.00 per ¼ hour"), so a new read keeps
    // per_half_hour or per_quarter_hour instead of a flat price. Prices unchanged; new reads only. Nov 1
    // count (read-only): 9 live blank-frequency fees at 8 institutions price that way on their own line;
    // they move only through Darwin's own-unit re-check with OWN_UNIT_BLANK_PART_HOUR_LIVE (off). No
    // replay. Floor stays v97.
    // v153 (#2854, Nov 1): a loan's payment example ("estimated payment of $1,473.89", "60 monthly
    // payments of", "per $1,000 borrowed") is never read as a charge (`loanPaymentExample`). Drop-only.
    // Nov 1 count (read-only): 4 live fees at 1 institution (Pelican 7482, 141052-141055) read such a
    // price; Darwin's live re-check (`darwin.loan_payment_example`, switch off) reports them. Floor stays v97.
    // v154 (#2040): the no-charge NSF read refuses fewer pages for clauses that name an NSF fee without
    // pricing it (contents entries, amounts of $1,000 or more, the recoverable-loss, merchant returned
    // check charge, liability and posting-order clauses). Behind NO_CHARGE_SENTENCE_READ_LIVE (off), so
    // the bump reads nothing new. Nov 1 dry run (read-only, current copies, switch on): 4 texts at 4
    // institutions would read NSF $0 (Wells Fargo 4, 172, 359 and United Bank 67), none held; 4, 359 and
    // 67 have no NSF row, 172 already shows $0. No replay. Floor stays v97.
    // v155 (#2040, Nov 2): no rule changes. NO_CHARGE_SENTENCE_READ_LIVE turns on (sampled clean on the
    // v154 dry run above), and the bump reads current copies again so those 4 texts read NSF $0; source
    // check v30 re-traces live fees with the witness on. No replay. Floor stays v97.
    // v156 (#2248, Nov 2): a free allowance's period ("(per statement; 2 free per statement cycle)") and one
    // price naming two units ("$5.00/statement or document copy") name no unit. New reads only. Nov 2 replay
    // (read-only): 3 of 758 live per-event fees Darwin's own-unit re-check would re-file drop out
    // (98831, 65324, 134768); they stay per item. No replay. Floor stays v97.
    // v157 (#1397, Nov 2): a held free read that is one item of one named account's list of benefits
    // (`accountBenefitZeroOf`) is held as a range for review, never sent to Darwin as a free fee. New
    // reads only. Nov 2 count (read-only, whitelist walk): 12 live $0s at 4 institutions are such items; Darwin's live
    // re-check (`darwin.account_benefit_zero`, switch off) reports them. No replay. Floor stays v97.
    // Gap 10 (Nov 2, no version change): the re-read backlog (`knox/reread-backlog.ts`,
    // KNOX_REREAD_BACKLOG_LIVE off) gives each extract step 10 to 20 slots for current texts last read
    // below today's version, behind live fees first, oldest version first. Off it only counts: 14,104 text
    // fingerprints below v155 on Nov 2, 7,103 behind live fees. On, it works this manifest's
    // knox_keeps_older_read exclusion down without a replay; countKnoxRereadsDue does not count it.
    // v161 (#1092, Nov 1; v157-v160 are #2894, #2926, #2927 and #2928's): names held as unclassified that the taxonomy and DECISIONS
    // already place (a skipped loan payment, a re-amortization, a payoff's processing, a foreign
    // check's acceptance, verification letters, a DMV filing; a bare title fee stays held). Admit-only: on the 333
    // frozen texts 11 reads are added and none changes. The live-correction paths read without it while
    // HELD_VOCABULARY_RELABEL_LIVE is off. No replay. Floor stays v97.
    // v163 (#1092, Nov 2; v162 is #2932's): a held free read whose own line is a "No fee for ..." item of a list of free
    // items, or the balance row that avoids a fee (`zeroWaiverRowOf`), is held as a range for review,
    // never sent to Darwin as a free fee. New reads only; Darwin's live re-check
    // (`darwin.zero_waiver_row`, ZERO_WAIVER_ROW_TAKEDOWN_LIVE off) reports the live ones. No replay.
    // Floor stays v97.
    // v164 (live-source audit draw 275762, Nov 2; v163 is #2938's): a read whose own line has a later cell opening
    // with a bullet item takes the name the item alone reads at the same category and amount
    // (`bulletItemRead`), never the other column's words in front of it. Rename only: no line moves and no
    // read is added or dropped. On 21 full texts (20 two-column bullet pages and Elite Community's 13895)
    // 26 reads are renamed, none added or lost. Name retidy v28 renames the live rows. No replay. Floor stays v97.
    // v169 (#1092, James's Nov 2 review; v167 is #2958's, v168 the second backlog dry run's fix): a
    // priced read whose name is an item of a "free services" list and whose price the self-check found on another line (`freeListItemRead`) is held
    // untraced. Drop only, new reads only. Nov 2 sample (read-only, prod stored texts, main vs head): on 51
    // read.pdf_layout multi-column texts and on all 207 texts with such a list heading that live priced fees
    // cite, the one read lost is Mountain Star's "Fax Service" $5 (text 36365); none added or changed.
    // Darwin's live re-check (`darwin.free_list_item`, FREE_LIST_ITEM_TAKEDOWN_LIVE off) reports the live
    // one (159428). No replay. Floor stays v97.
    // v170 (third re-read backlog dry run, Nov 2): a heading a responsive table repeats in each cell is
    // stripped before any reader (`withoutColumnLabelEchoes`); a rate disclosure's no-dividend balance
    // (`dividendThresholdSentence`) and a monthly fee under an online services section title
    // (`onlineServiceMonthlyFee`) are dropped; a threshold a comparison word ties to the name is put back
    // into it (`withThresholdFigures`, rename only). On the 40 rb3 texts (v169 vs v170) the four wrong reads
    // are gone and no right read is lost; on 60 fresh random texts (main vs head) 5 reads are renamed only.
    // Darwin's live re-check (`darwin.not_account_fee_line`, NOT_ACCOUNT_FEE_LINE_TAKEDOWN_LIVE off) reports
    // the live ones (73916, 152003). No replay. Floor stays v97.
    // v171 (fourth re-read backlog dry run, Nov 3): a short "Stop Pay" files as the stop payment ahead of the
    // check rules (`STOP_PAY_SHORT`); a list of free items one per line is no stacked table (table v13,
    // `freeItemList`); an item under "This account also includes:" and an account comparison table's perk
    // cell are one account's benefit (`accountBenefitZeroOf`, held); an item named insufficient with no
    // "funds" is the NSF row (`ITEM_INSUFFICIENT`), so the plain returned check beside it is the deposited
    // item return. On the 40 rb4 texts (v170 vs v171) every wrong and doubtful row is gone and no right row is
    // lost; rb3 gains one right row; on 60 fresh random texts (main vs head) six crossed-over perk reads go and
    // one NSF read is added. Darwin's account-benefit re-check v2 (switch off) matches no new live fee. No
    // replay. Floor stays v97.
    // v172 (fifth re-read backlog dry run, Nov 3): a statement's copy priced per item is document
    // reproduction; a low or minimum balance charge is minimum_balance ahead of "service charge"
    // (`LOW_BALANCE_CHARGE`); a label priced before the fee's own name never borrows a heading
    // (`feeNamedAfterPrice`); a free word naming its own item never prices the line above (`freeWordOnItem`);
    // "Cashier's (Counter) Check" files by its own label. On the 40 rb5 texts (v171 vs v172) the six wrong
    // rows are gone (two re-filed right, four dropped) and the other 93 changed rows are unchanged; rb, rb3 and
    // rb4 do not change; rb2 re-files three already-stored "Service charge (Minimum Balance Fee)" reads to
    // minimum_balance. No Darwin re-check (no guard rule). No replay. Floor stays v97.
    // v174 (#1092, Nov 2, state key 5608; v164-v172 are on main, #2967 ships as v175): a monthly maintenance read, $0 or priced, whose row sits under a
    // heading that names a service rather than an account (`serviceMaintenanceOf`) is held as a range for
    // review, never sent to Darwin. New reads only: on the 291 frozen texts no read changes. Darwin's live
    // re-check (`darwin.service_maintenance_heading`, SERVICE_MAINTENANCE_TAKEDOWN_LIVE off) reports the
    // live ones. No replay. Floor stays v97.
    // v175 (sixth re-read backlog dry run, Nov 3; renumbered from v173 when merging after #2953): a bullet list's heading shared with another column's
    // priced row still heads its bullets (`listHeadingOf`), and an item bulleted under a stop payment heading
    // is the stop payment (`stopPaymentListRead`); a card replacement under a credit card title in its own
    // column is left out (`creditCardSectionRead`); a labelled clause's price takes its audience, misspelt
    // "accoutns" included (fee-audience.ts); a two-column free row is held once (`sameFreeCellName`). rb6
    // (v172 vs v173): the wrong row is re-filed, a $0 credit card replacement is not read, the other 95 changed
    // rows are unchanged; rb, rb4 and rb5 stop reading four credit card section replacements; rb2 and rb3 do
    // not change. Review of v172 folded in (`GENERIC_FEE_NAME`, `LOW_BALANCE_CHARGE`, `ITEM_INSUFFICIENT`
    // narrowed; no harness read changes). Review of v175 (PR #2967): the credit card section ends at any debit
    // card, ATM or other section heading and a row takes its priced column; `ITEM_INSUFFICIENT` keeps an item
    // "paid or returned" as NSF and files a deposited one as the deposited item return; the stop payment list
    // needs a named second cell and the list's own price. Darwin's live re-check (`darwin.credit_card_section`,
    // CREDIT_CARD_SECTION_TAKEDOWN_LIVE off) reports the 75 live credit card section replacements (62 texts).
    // No replay. Floor stays v97.
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
    // v83 (Oct 25, #1690): the non-network ATM fee refuses research, photo, negative-share and
    // additional-card names.
    // v84 (Oct 25, #1788): a generic monthly charge under another service's heading or cell fails
    // monthly maintenance (Positive Pay, ACH, bill pay, cards, paper statements).
    // v85 (Oct 25, #1831): a refundable safe deposit box key or security deposit fails the box rule.
    // v86 (Oct 25, #1918): monthly maintenance admits a checking account's own named fee (Knox's pattern).
    // v87 (Oct 25, #1916): a late payment printed in a safe deposit box section re-files live to
    // safe_deposit_box (99 of 111 on the Oct 25 dry run; 12 duplicates of a live box late fee come down).
    // v88 (Oct 25, #1912): book transfers fail the domestic wire categories, and a cash advance priced
    // at another bank's ATMs fails cash advance.
    // v89 (Oct 25, #1877): overdraft admits a credit union's "Draft Protection Fee" (Knox v112's pattern);
    // names only, so no live fee changes on the Oct 25 dry run.
    // v90 (Oct 25, #1912): a plain return charge printed in a foreign check or collection section
    // re-files from NSF to deposited_item_return, and a late charge named for the safe deposit box
    // re-files from late_payment to safe_deposit_box (2 move in place; 6 go to the second look).
    // v91 (Oct 25, #1905): the non-network ATM fee admits a share withdrawal at another network's ATM
    // (Knox v115's network table read); names only, 0 live and 0 raw rows on the Oct 25 dry run.
    // v92 (Oct 25, #1947): a monthly maintenance fee its own line prices as the paper statement charge
    // re-files to paper_statement (5 move in place; 14 beside a live twin go to the second look).
    // v94 (Oct 26, #2100): International ATM refuses the card foreign transaction fee's non-fee names
    // (low balance, currency exchange or orders, check collection, "many"); 0 live fees on the dry run.
    // v95 (Oct 26, #1513): a domestic wire whose name writes "international" short ("Int. Wire",
    // "Intern.") re-files to the international wire, switched on by James; 2 live wires on the dry run.
    // v96 (Oct 26, #1912, numbered v93 while #2688 was open): a night drop or double-spaced night deposit box name is never a safe deposit
    // box name, and a box late fee keeps its own $1 Darwin floor, so a $1 box late fee (36020) re-files
    // in place instead of coming down. Dry-run counts in the PR.
    // v97 (Oct 26, #1905): an NSF or overdraft fee named for a home equity loan or line, a HELOC or a
    // line of credit (not an overdraft line of credit, nor one that also names a deposit account)
    // re-files to other_lending_fee; beside a live other lending twin (154634 beside 122342) it goes to
    // the second look. Dry-run counts in the PR.
    // v98 (Oct 26, #1912): a rejected wire ("Foreign Wire Reject", 67971) fails the domestic and
    // international wire types, as a returned or recalled wire does. Dry-run counts in the PR.
    // v99 (Oct 26, #1912): a bill pay return the payee sent back (its name, or its stored line or the
    // note wrapped onto the next) fails NSF and re-files to bill_pay; 1 live fee (85460) on the dry run.
    // v100 (Oct 26, #1912): a commercial lockbox service (its name, or its stored line or business
    // heading) fails safe_deposit_box with no re-file; 1 live fee (135270) comes down on the dry run.
    // v101 (Oct 27, #1947): an NSF-filed name that names a collection item ("NSF Collection Item
    // (incoming)", `COLLECTION_NSF_NAME`) fails NSF and re-files to collection_item; 11 live fees re-file
    // in place on the dry run, 1 takedown is restored as collection_item (26203), 0 come down.
    // v102 (Nov 1, #1100, with Knox v149): a named service's own monthly charge (online banking, bill
    // payer, text banking, mobile check deposit, remote capture, a card program) fails monthly
    // maintenance; 17 live fees on the dry run: 4 re-file in place (3 to bill_pay, 1 to mobile_deposit)
    // and 13 come down.
    // v103 (Nov 2, with Knox v158): a domestic wire whose name or own stored label sends it outside the
    // U.S. ("not be initially processed through a U.S. bank", "Out of USA", "Non U.S.") re-files to the
    // international wire; 6 live fees re-file in place on the dry run, 0 come down.
    // v104 (Nov 2, with Knox v159): a non-network ATM name that opens with the bank's own abbreviation
    // and "ATM" ("UNFCU ATM fees in Nairobi") is the bank's own machine and fails atm_non_network; 7 live
    // fees come down on the dry run (6 are what non-members pay at the bank's own ATM), 0 re-file.
    // v105 (Nov 2, with Knox v162): od_protection_transfer also accepts a name that opens with an
    // automatic transfer into checking ("Automatic Transfer of Funds to a Checking Account"); accept-only,
    // so 0 live fees come down or re-file on the dry run; rows rejected for this name are judged again.
    // v107 (Nov 2, with Knox v167): deposited_item_return accepts a charged-back check or item and
    // excess_withdrawal a savings withdrawal fee or a money market excess check; accept-only, so 0 live
    // fees come down or re-file on the dry run (1 live name matches, already filed there).
    // v108 (Nov 2, with Knox v168; v107 is #2958's): a wire's confirmation is its notice and fails every
    // wire type (1 live fee comes down, 131028), and a coin counting name carrying a three-dimension box
    // size re-files to safe_deposit_box (2 live fees, 97753 and 64741, come down as twins of the bank's
    // live box rent at the same price).
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
