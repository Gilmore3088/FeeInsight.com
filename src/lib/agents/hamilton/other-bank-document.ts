import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { hostSql, OTHER_BANK_HOST_CODE } from "@/lib/agents/magellan/other-bank-host";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Another bank's fees (James, Oct 8). A live fee read from a document on another
 * institution's own website (`magellan/other-bank-host.ts`) is that bank's price: Peoples Bank
 * of Rock Valley, Iowa showed 22 fees read from Peoples Bank of Bellingham, Washington's PDF.
 * It comes down on the first run that sees it (James, Oct 8: "fix the problem immediately"),
 * unless the document's text names this bank's own website or city (a schedule a sister
 * charter or an acquirer hosts for it). The host match is a fact about the stored address, not
 * a reading a fixed rule could clear, so there is no 12-hour second look; the first look is
 * still logged (`second-look.ts`, check `hamilton.other_bank_document`).
 *
 * Archived, never deleted: `rolled_back_reason = 'other_bank_document: <host>'` and the
 * verified row rejected with the `other_bank_document` flag, so it is not republished. The
 * lesson goes to Magellan (a `wrong_document` judgement, stage discover). The link joins the
 * bank's rejected sources and leaves its fee link, so discovery searches again.
 *
 * Dry run on prod (Oct 8, read-only): 16 institutions had live fees from another
 * institution's host (321 fees); one (Hema FCU, whose document names its own city) passes.
 */
export const OTHER_BANK_DOCUMENT_CHECK = "hamilton.other_bank_document";
export const OTHER_BANK_DOCUMENT_REASON = "other_bank_document";
export const OTHER_BANK_DOCUMENT_FLAG = "other_bank_document";
export const OTHER_BANK_DOCUMENT_ROLLBACK_LIMIT = 500;

/**
 * A document on a host that is neither this bank's website nor another institution's (admin
 * audit, Oct 8: "source-text checks alone do not establish institution identity"). A bank may
 * host its schedule on a new domain after a rebrand, a sister charter or a file CDN, so such a
 * document passes when its text names the bank (its website, the website's name, its city or
 * its own name), when the host and the bank's website share a name (healthplusfcu.org and
 * .com), when it sits on a shared file host (`SHARED_CONTENT_HOST_PATTERN`), or when a person
 * locked the link by correction. Otherwise the fee is that host's schedule until shown
 * otherwise: logged on the first look and archived on the second, 12 hours later
 * (`second-look.ts`), so a rebrand Magellan re-finds is not lost in one run.
 *
 * Dry run on prod (Oct 9, read-only): 1,894 live fees sat on such hosts; 277 at 17 institutions
 * did not name the bank, among them USF FCU (Tampa) read from usfcu.com and N Y Team FCU read
 * from teamfcu.org.
 */
export const UNCONFIRMED_HOST_CHECK = "hamilton.unconfirmed_document_host";
export const UNCONFIRMED_HOST_REASON = "unconfirmed_document_host";
export const UNCONFIRMED_HOST_FLAG = "unconfirmed_document_host";
/** File and site-builder hosts many banks use for their own documents. */
export const SHARED_CONTENT_HOST_PATTERN =
  "(cdn|static|assets|s3|amazonaws|cloudfront|filesusr|usrfiles|wsimg|hubspotusercontent|ctfassets|sanity[.]io|contentstack|sitecorecloud|digitaloceanspaces|filesafe|marketpath|q4cdn|homecu|kcmspreview|website-files|cms|squarespace|blob[.]core|googleusercontent|wixstatic|azureedge|akamai|storage|wpengine)";

interface OtherBankFeeRow {
  fee_published_id: number | string;
  fee_verified_id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  document_url: string;
  document_host: string;
  other_institution_id: number | string;
  other_institution_name: string;
  names_own_bank: boolean | string | null;
}

export interface OtherBankTakedown {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  sourceDocumentId: number | null;
  documentUrl: string;
  documentHost: string;
  otherInstitutionId: number;
  otherInstitutionName: string;
  reason: string;
  /** `other_bank` when the host is another institution's website; `unconfirmed_host` otherwise. */
  kind: "other_bank" | "unconfirmed_host";
}

export interface OtherBankDocumentResult {
  otherBankFees: number;
  namesOwnBank: number;
  flagged: number;
  waiting: number;
  /** Fees on a host that is neither the bank's nor another institution's, not shown to be this bank's. */
  unconfirmedHostFees: number;
  unconfirmedHostFlagged: number;
  unconfirmedHostWaiting: number;
  rolledBack: OtherBankTakedown[];
  linksCleared: number;
  dryRun: boolean;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function truthy(value: boolean | string | null | undefined): boolean {
  return value === true || String(value ?? "").toLowerCase() === "true" || value === "t";
}

/**
 * Which live fees a host read covers: all (`false`), one institution (`true`, `$1` is its id),
 * or a list of fees (`"fees"`, `$1` is a bigint[] of `fee_published_id`, Deming's fresh audit).
 */
export type HostReadScope = boolean | "fees";

function scopeFilter(scope: HostReadScope): string {
  if (scope === "fees") return "AND fp.fee_published_id = ANY($1::bigint[])";
  return scope ? "AND fp.institution_id = $1" : "";
}

/** The live-fee read: every fee whose document is on another institution's own website. */
export function otherBankFeesSql(scope: HostReadScope): string {
  // Hosts are worked out once per table (CTEs), then matched by equality: one host pattern per
  // row inside a join ran past a minute on prod.
  return `
    WITH live AS (
      SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fr.source_document_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fr.source_document_id IS NOT NULL
         ${scopeFilter(scope)}
    ),
    docs AS (
      SELECT sd.id, sd.document_url, ${hostSql("sd.document_url")} AS host
        FROM source_documents sd
       WHERE sd.id IN (SELECT DISTINCT source_document_id FROM live)
         AND sd.document_url IS NOT NULL
    ),
    sites AS (
      SELECT i.id, i.institution_name, i.city, ${hostSql("i.website_url")} AS host
        FROM institution_sources i
       WHERE i.website_url IS NOT NULL
    ),
    matched AS (
      SELECT l.*, d.document_url, d.host AS document_host, own.host AS own_host, own.city AS own_city
        FROM live l
        JOIN docs d ON d.id = l.source_document_id
        JOIN sites own ON own.id = l.institution_id
       WHERE own.host IS DISTINCT FROM d.host
         AND EXISTS (SELECT 1 FROM sites o WHERE o.host = d.host AND o.id <> l.institution_id)
    )
    SELECT m.fee_published_id, m.fee_verified_id, m.institution_id, m.source_document_id,
           m.document_url, m.document_host,
           COALESCE(o.id, 0) AS other_institution_id, COALESCE(o.institution_name, m.document_host) AS other_institution_name,
           EXISTS (
             SELECT 1 FROM agent_source_texts t
              WHERE t.source_document_id = m.source_document_id
                AND (strpos(lower(t.normalized_text), m.own_host) > 0
                     OR (length(btrim(COALESCE(m.own_city, ''))) >= 3
                         AND strpos(lower(t.normalized_text), lower(btrim(m.own_city))) > 0))
           ) AS names_own_bank
      FROM matched m
      LEFT JOIN LATERAL (
        SELECT s.id, s.institution_name FROM sites s
         WHERE s.host = m.document_host AND s.id <> m.institution_id
         ORDER BY s.id LIMIT 1
      ) o ON true
     ORDER BY m.fee_published_id`;
}

/**
 * The live-fee read for documents on a host that is neither this bank's website nor another
 * institution's, and not a shared file host. `names_own_bank` is true when the text or a
 * person's correction ties the document to this bank, or the host shares the website's name.
 */
export function unconfirmedHostFeesSql(scope: HostReadScope): string {
  const label = (host: string) =>
    `split_part(${host}, '.', greatest(array_length(string_to_array(${host}, '.'), 1) - 1, 1))`;
  return `
    WITH live AS (
      SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fr.source_document_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fr.source_document_id IS NOT NULL
         ${scopeFilter(scope)}
    ),
    docs AS (
      SELECT sd.id, sd.document_url, ${hostSql("sd.document_url")} AS host
        FROM source_documents sd
       WHERE sd.id IN (SELECT DISTINCT source_document_id FROM live)
         AND sd.document_url IS NOT NULL
    ),
    sites AS (
      SELECT i.id, i.institution_name, i.city, ${hostSql("i.website_url")} AS host
        FROM institution_sources i
       WHERE i.website_url IS NOT NULL
    ),
    matched AS (
      SELECT l.*, d.document_url, d.host AS document_host, own.host AS own_host, own.city AS own_city,
             ${label("own.host")} AS own_label, ${label("d.host")} AS document_label,
             btrim(regexp_replace(
               regexp_replace(lower(own.institution_name), ',?[[:space:]]+(national association|n[.]a[.]|ssb|fsb)[[:space:]]*$', ''),
               '[^a-z0-9&'' -]+', ' ', 'g')) AS own_name
        FROM live l
        JOIN docs d ON d.id = l.source_document_id
        JOIN sites own ON own.id = l.institution_id
       WHERE d.host IS NOT NULL
         AND own.host IS DISTINCT FROM d.host
         AND right(d.host, length(own.host) + 1) IS DISTINCT FROM '.' || own.host
         AND d.host !~ '${SHARED_CONTENT_HOST_PATTERN}'
         AND NOT EXISTS (SELECT 1 FROM sites o WHERE o.host = d.host AND o.id <> l.institution_id)
    )
    SELECT m.fee_published_id, m.fee_verified_id, m.institution_id, m.source_document_id,
           m.document_url, m.document_host,
           0 AS other_institution_id, m.document_host AS other_institution_name,
           (
             m.own_label = m.document_label
             OR EXISTS (
               SELECT 1 FROM institution_source_profiles profile
                WHERE profile.institution_id = m.institution_id
                  AND profile.locked_by_correction IS TRUE
                  AND btrim(COALESCE(profile.canonical_source_url, '')) = btrim(m.document_url)
             )
             OR EXISTS (
               SELECT 1 FROM agent_source_texts t
                WHERE t.source_document_id = m.source_document_id
                  AND (strpos(lower(t.normalized_text), m.own_host) > 0
                       OR (length(m.own_label) >= 4 AND strpos(lower(t.normalized_text), m.own_label) > 0)
                       OR (length(btrim(COALESCE(m.own_city, ''))) >= 3
                           AND strpos(lower(t.normalized_text), lower(btrim(m.own_city))) > 0)
                       OR (length(m.own_name) >= 6
                           AND (strpos(regexp_replace(lower(t.normalized_text), '[[:space:]]+', ' ', 'g'), m.own_name) > 0
                                OR strpos(regexp_replace(lower(t.normalized_text), '[[:space:]]+', ' ', 'g'),
                                          replace(m.own_name, ' federal credit union', ' credit union')) > 0)))
             )
           ) AS names_own_bank
      FROM matched m
     ORDER BY m.fee_published_id`;
}

/**
 * Runs the other-bank check for one publish step. A dry run reports what it would flag and
 * take down, and writes nothing. Never blocks the step it runs in.
 */
export async function retireOtherBankDocumentFees(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; limit?: number },
): Promise<OtherBankDocumentResult> {
  const limit = Math.max(1, Math.min(options.limit ?? OTHER_BANK_DOCUMENT_ROLLBACK_LIMIT, 2_000));
  const result: OtherBankDocumentResult = {
    otherBankFees: 0,
    namesOwnBank: 0,
    flagged: 0,
    waiting: 0,
    unconfirmedHostFees: 0,
    unconfirmedHostFlagged: 0,
    unconfirmedHostWaiting: 0,
    rolledBack: [],
    linksCleared: 0,
    dryRun: options.dryRun,
  };
  const params = options.institutionId ? [options.institutionId] : [];
  let rows: OtherBankFeeRow[];
  try {
    rows = await inSavepoint(db, (scope) =>
      scope.unsafe<OtherBankFeeRow[]>(otherBankFeesSql(Boolean(options.institutionId)), params),
    );
  } catch (error) {
    console.error("retireOtherBankDocumentFees read failed:", error);
    return result;
  }
  // A failed read of the wider check never holds back the other-bank takedown.
  let unconfirmedRows: OtherBankFeeRow[] = [];
  try {
    unconfirmedRows = await inSavepoint(db, (scope) =>
      scope.unsafe<OtherBankFeeRow[]>(unconfirmedHostFeesSql(Boolean(options.institutionId)), params),
    );
  } catch (error) {
    console.error("retireOtherBankDocumentFees unconfirmed-host read failed:", error);
  }
  result.otherBankFees = rows.length;
  const split = (source: OtherBankFeeRow[], kind: OtherBankTakedown["kind"]) => {
    const failing: OtherBankTakedown[] = [];
    const passing: number[] = [];
    for (const row of source) {
      if (truthy(row.names_own_bank)) {
        passing.push(Number(row.fee_published_id));
        continue;
      }
      failing.push({
        feePublishedId: Number(row.fee_published_id),
        feeVerifiedId: Number(row.fee_verified_id),
        institutionId: Number(row.institution_id),
        sourceDocumentId: num(row.source_document_id),
        documentUrl: row.document_url,
        documentHost: row.document_host,
        otherInstitutionId: Number(row.other_institution_id),
        otherInstitutionName: row.other_institution_name,
        reason: `${kind === "other_bank" ? OTHER_BANK_DOCUMENT_REASON : UNCONFIRMED_HOST_REASON}: ${row.document_host}`,
        kind,
      });
    }
    return { failing, passing };
  };
  const otherBank = split(rows, "other_bank");
  result.namesOwnBank = otherBank.passing.length;

  // Logged like every takedown, then taken down now: no wait for a second look.
  const look = await secondLook(db, {
    check: OTHER_BANK_DOCUMENT_CHECK,
    runId: options.runId,
    failing: otherBank.failing,
    passing: otherBank.passing,
    dryRun: options.dryRun,
  });
  result.flagged = look.flagged;
  result.waiting = look.waiting;

  // An unconfirmed host waits for its second look, like other takedowns.
  const otherBankIds = new Set(otherBank.failing.map((fee) => fee.feePublishedId));
  const unconfirmed = split(
    unconfirmedRows.filter((row) => !otherBankIds.has(Number(row.fee_published_id))),
    "unconfirmed_host",
  );
  result.unconfirmedHostFees = unconfirmed.failing.length;
  const unconfirmedLook = await secondLook(db, {
    check: UNCONFIRMED_HOST_CHECK,
    runId: options.runId,
    failing: unconfirmed.failing,
    passing: unconfirmed.passing,
    dryRun: options.dryRun,
  });
  result.unconfirmedHostFlagged = unconfirmedLook.flagged;
  result.unconfirmedHostWaiting = unconfirmedLook.waiting;

  const confirmed = [...otherBank.failing, ...unconfirmedLook.confirmed].slice(0, limit);
  if (options.dryRun) {
    result.rolledBack = confirmed;
    return result;
  }
  if (confirmed.length === 0) return result;

  try {
    result.rolledBack = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${options.batchId},
               rolled_back_reason = v.reason
          FROM unnest(${confirmed.map((fee) => fee.feePublishedId)}::bigint[], ${confirmed.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const closed = confirmed.filter((fee) => ids.has(fee.feePublishedId));
      if (closed.length === 0) return closed;
      await scope`
        UPDATE verified_fee_observations fv
           SET review_status = 'rejected',
               outlier_flags = CASE
                 WHEN fv.outlier_flags ? v.flag THEN fv.outlier_flags
                 ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(v.flag)
               END
          FROM unnest(
                 ${closed.map((fee) => fee.feeVerifiedId)}::bigint[],
                 ${closed.map((fee) => (fee.kind === "other_bank" ? OTHER_BANK_DOCUMENT_FLAG : UNCONFIRMED_HOST_FLAG))}::text[]
               ) AS v(fee_verified_id, flag)
         WHERE fv.fee_verified_id = v.fee_verified_id
           AND fv.review_status IN ('verified', 'approved')
      `;
      return closed;
    });
  } catch (error) {
    console.error("other-bank document rollback failed:", error);
    return result;
  }
  if (result.rolledBack.length === 0) return result;
  invalidatePublicReadCache();

  const documents = new Map<number, OtherBankTakedown>();
  for (const fee of result.rolledBack) {
    if (fee.sourceDocumentId != null && !documents.has(fee.sourceDocumentId)) documents.set(fee.sourceDocumentId, fee);
  }

  // The link goes back to discovery: rejected for this bank, and off its fee link unless a
  // person's correction locked it.
  try {
    result.linksCleared = await inSavepoint(db, async (scope) => {
      let cleared = 0;
      for (const fee of documents.values()) {
        const code = fee.kind === "other_bank" ? OTHER_BANK_HOST_CODE : UNCONFIRMED_HOST_REASON;
        const note =
          fee.kind === "other_bank"
            ? `${fee.documentUrl} is ${fee.otherInstitutionName}'s schedule`
            : `${fee.documentUrl} is on ${fee.documentHost}, not this bank's website, and does not name this bank`;
        const rejected = JSON.stringify([{ url: fee.documentUrl, reason: code, at: new Date().toISOString() }]);
        await scope`
          UPDATE institution_source_profiles
             SET rejected_source_urls = (
                   SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb)
                     FROM jsonb_array_elements(COALESCE(rejected_source_urls, '[]'::jsonb)) entry
                    WHERE entry->>'url' IS DISTINCT FROM ${fee.documentUrl}
                 ) || ${rejected}::jsonb,
                 canonical_source_url = CASE
                   WHEN locked_by_correction OR canonical_source_url IS DISTINCT FROM ${fee.documentUrl} THEN canonical_source_url
                   ELSE NULL
                 END,
                 updated_at = NOW()
           WHERE institution_id = ${fee.institutionId}
        `;
        const rows = await scope`
          UPDATE institution_sources inst
             SET fee_schedule_url = NULL,
                 rescue_status = 'pending',
                 failure_reason = ${fee.kind === "other_bank" ? "magellan_other_bank_document" : "magellan_unconfirmed_document_host"},
                 failure_reason_note = ${note},
                 failure_reason_updated_at = NOW()
           WHERE inst.id = ${fee.institutionId}
             AND btrim(COALESCE(inst.fee_schedule_url, '')) = ${fee.documentUrl.trim()}
             AND NOT EXISTS (
               SELECT 1 FROM institution_source_profiles profile
                WHERE profile.institution_id = inst.id AND profile.locked_by_correction IS TRUE
             )
          RETURNING inst.id
        `;
        cleared += rows.length;
      }
      return cleared;
    });
  } catch (error) {
    console.error("other-bank document link reset failed:", error);
  }

  const lessons: FeedbackRow[] = [...documents.values()].map((fee) => ({
    aboutStage: "discover",
    signal: "wrong",
    kind: "wrong_document",
    reportedBy: "hamilton",
    checkName: fee.kind === "other_bank" ? OTHER_BANK_DOCUMENT_CHECK : UNCONFIRMED_HOST_CHECK,
    institutionId: fee.institutionId,
    sourceDocumentId: fee.sourceDocumentId,
    sourceUrl: fee.documentUrl,
    runId: options.runId,
    dedupeKey: `${fee.kind === "other_bank" ? OTHER_BANK_DOCUMENT_CHECK : UNCONFIRMED_HOST_CHECK}:doc:${fee.sourceDocumentId}`,
    evidence: {
      reason: fee.kind === "other_bank" ? OTHER_BANK_HOST_CODE : UNCONFIRMED_HOST_REASON,
      document_url: fee.documentUrl,
      document_host: fee.documentHost,
      other_institution_id: fee.otherInstitutionId,
      other_institution_name: fee.otherInstitutionName,
      fees_taken_down: result.rolledBack.filter((other) => other.sourceDocumentId === fee.sourceDocumentId).length,
    },
  }));
  try {
    await inSavepoint(db, async (scope) => {
      await recordFeedback(scope, lessons);
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.other_bank_document_rolled_back', 'completed',
          ${`Archived ${result.rolledBack.length} fee(s) read from another institution's website or a host that does not name this bank`},
          ${JSON.stringify({
            batch_id: options.batchId,
            rolled_back: result.rolledBack.length,
            documents: documents.size,
            links_cleared: result.linksCleared,
            samples: result.rolledBack.slice(0, 20).map((fee) => ({
              fee_published_id: fee.feePublishedId,
              institution_id: fee.institutionId,
              document_url: fee.documentUrl,
              other_institution_id: fee.otherInstitutionId,
              kind: fee.kind,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("other-bank document lesson/event failed:", error);
  }
  return result;
}
