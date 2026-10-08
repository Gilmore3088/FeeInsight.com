import { recordAttempt } from "@/lib/agents/learning/attempts";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import type { sql } from "@/lib/data-store/connection";

import { recordDiscoveryResult } from "./discovery";
import { looksLikePdfUrl } from "./find-validate";
import { urlIdentity } from "./finders";
import { isArticleLink, onBankDomain } from "./link-coverage";

type SqlTag = typeof sql;

/**
 * Keeps paid search answers that were thrown away only because the bank's site refused our
 * check (HTTP 403).
 *
 * Until 7 Oct 2026 (07:13) the paid web search dropped an answer whose fee-page check came
 * back 403, and the paid schedule search still did: the model had found the bank's own fee
 * schedule ("overdraft $35.00, NSF $35.00" for Independence Bank's /fee-schedule/), we paid
 * for the search, and the bank kept no link. A 403 is not a monthly-retry outcome, so those
 * banks were never searched again: 53 had no fee link at all on 8 Oct, Synchrony and
 * Desert Financial among them. This pass stores each such answer once, at no cost: as the
 * main link when the bank has none, otherwise as a consumer companion. The plain fetch
 * then meets the same 403 and the paid fetch (`blocked-fetch.ts`) stores the page;
 * Rosetta rules on what it says. Only answers on the bank's own site, never an article.
 */
export const KEEP_REFUSED_ANSWER_STRATEGY = { strategy: "discover.keep_refused_answer", version: 1 } as const;
const KEEP_LIMIT = 25;
/** Below a checked answer: the page was never seen by our fetcher. */
const REFUSED_ANSWER_CONFIDENCE = 0.75;
/** The paid finders whose answers this keeps (named here so this module does not import them). */
const PAID_SEARCH_STRATEGIES = ["discover.paid_web_search", "discover.paid_schedule_search"];
const ANSWER_DAYS = 60;
/** Answers that name a page other than a fee schedule (a CRA public file, an About page, a rates page). */
const NOT_A_SCHEDULE = /(cra[-_]|public[-_]?file|privacy|careers|\/about(-us)?\/?$|\/resources\/?$|rates\.php)/i;

interface RefusedAnswerRow {
  attempt_id: number | string;
  institution_id: number | string;
  strategy: string;
  url: string;
  institution_name: string;
  state_code: string | null;
  website_url: string | null;
  fee_schedule_url: string | null;
  known_urls: string[] | null;
}

export interface KeepRefusedAnswersResult {
  checked: number;
  kept: number;
  asMainLink: number;
  asCompanion: number;
  dryRun: boolean;
  samples: Array<{ institutionId: number; url: string; as: "main_link" | "companion" }>;
}

export async function keepRefusedPaidAnswers(options: {
  db: SqlTag;
  runId: number;
  stepId?: number | null;
  dryRun?: boolean;
  limit?: number;
}): Promise<KeepRefusedAnswersResult> {
  const { db } = options;
  const dryRun = options.dryRun ?? false;
  const limit = Math.max(0, options.limit ?? KEEP_LIMIT);
  const result: KeepRefusedAnswersResult = { checked: 0, kept: 0, asMainLink: 0, asCompanion: 0, dryRun, samples: [] };
  if (limit === 0) return result;
  const rows = await db<RefusedAnswerRow[]>`
    -- paid answers refused by the bank's site
    SELECT answer.*
      FROM (
        SELECT DISTINCT ON (pa.institution_id, pa.detail->>'proposed_url')
               pa.id AS attempt_id,
               pa.institution_id,
               pa.strategy,
               pa.detail->>'proposed_url' AS url,
               inst.institution_name,
               inst.state_code,
               inst.website_url,
               inst.fee_schedule_url,
               inst.asset_size,
               ARRAY(
                 SELECT ias.url FROM institution_additional_sources ias WHERE ias.institution_id = inst.id
                 UNION ALL
                 SELECT doc.document_url FROM source_documents doc WHERE doc.institution_id = inst.id AND doc.document_url IS NOT NULL
               ) AS known_urls
          FROM pipeline_attempts pa
          JOIN institution_sources inst ON inst.id = pa.institution_id
          LEFT JOIN institution_source_profiles profile ON profile.institution_id = inst.id
         WHERE pa.stage = 'discover'
           AND pa.strategy = ANY(${PAID_SEARCH_STRATEGIES}::text[])
           AND pa.outcome = 'http_403'
           AND COALESCE(pa.detail->>'proposed_url', '') <> ''
           AND pa.created_at > NOW() - make_interval(days => ${ANSWER_DAYS}::int)
           AND COALESCE(inst.status, 'active') = 'active'
           AND COALESCE(profile.locked_by_correction, FALSE) IS FALSE
           AND COALESCE(profile.read_strategy, '') <> 'manual_review'
           AND NOT EXISTS (
             SELECT 1 FROM pipeline_attempts kept
              WHERE kept.institution_id = pa.institution_id
                AND kept.stage = 'discover'
                AND kept.strategy = ${KEEP_REFUSED_ANSWER_STRATEGY.strategy}
                AND kept.strategy_version = ${KEEP_REFUSED_ANSWER_STRATEGY.version}
                AND kept.input_fingerprint = pa.detail->>'proposed_url'
           )
         ORDER BY pa.institution_id, pa.detail->>'proposed_url', pa.id DESC
      ) answer
     ORDER BY answer.asset_size DESC NULLS LAST, answer.institution_id
     LIMIT ${limit}
  `;
  result.checked = rows.length;

  for (const row of rows) {
    const institutionId = Number(row.institution_id);
    const url = row.url.trim();
    const known = new Set([row.fee_schedule_url, ...(row.known_urls ?? [])].filter(Boolean).map((value) => urlIdentity(String(value))));
    const skip = !row.website_url || !onBankDomain(url, row.website_url)
      ? "answer is not on the bank's own site"
      : isArticleLink(url) || NOT_A_SCHEDULE.test(url)
        ? "answer names a page other than a fee schedule"
        : known.has(urlIdentity(url))
          ? "the bank already holds this page"
          : null;
    if (skip) {
      if (!dryRun) await logKeep(db, options, institutionId, row, "unchanged", { skipped: skip });
      continue;
    }
    const as = row.fee_schedule_url ? "companion" : "main_link";
    if (result.samples.length < 10) result.samples.push({ institutionId, url, as });
    result.kept += 1;
    if (as === "main_link") result.asMainLink += 1;
    else result.asCompanion += 1;
    if (dryRun) continue;

    const documentType = looksLikePdfUrl(url) ? "pdf" : "html";
    const reason = `Paid search answer the bank's site refused to show us (HTTP 403), kept for the paid fetch: ${url}`;
    if (as === "main_link") {
      await recordDiscoveryResult(db, {
        institutionId,
        institutionName: row.institution_name,
        stateCode: normalizeStateCode(row.state_code),
        outcome: "discovered",
        code: "found_paid_search",
        url,
        documentType,
        confidence: REFUSED_ANSWER_CONFIDENCE,
        reason,
        method: "magellan_paid_web_search",
        attemptedUrls: 1,
        foundBy: null,
        movedTo: null,
        platform: null,
        homepageHash: null,
        homepageBlocked: false,
        websiteRepair: null,
        finders: [],
        durationMs: 0,
        resumedFrom: null,
        resume: null,
      });
    } else {
      await db`
        INSERT INTO institution_additional_sources
          (institution_id, url, document_type, document_role, found_by_strategy, strategy_version, agent_run_id, reason)
        VALUES
          (${institutionId}, ${url}, ${documentType}, 'consumer_supplement', ${KEEP_REFUSED_ANSWER_STRATEGY.strategy},
           ${KEEP_REFUSED_ANSWER_STRATEGY.version}, ${options.runId}, ${reason})
        ON CONFLICT (institution_id, url) DO NOTHING
      `;
    }
    await logKeep(db, options, institutionId, row, "ok", { kept_as: as, document_type: documentType });
  }
  return result;
}

async function logKeep(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  institutionId: number,
  row: RefusedAnswerRow,
  outcome: "ok" | "unchanged",
  extra: Record<string, unknown>,
): Promise<void> {
  await recordAttempt(db, {
    institutionId,
    stage: "discover",
    strategy: KEEP_REFUSED_ANSWER_STRATEGY.strategy,
    version: KEEP_REFUSED_ANSWER_STRATEGY.version,
    fingerprint: row.url,
    outcome,
    yieldCount: outcome === "ok" ? 1 : 0,
    costMicrousd: 0,
    runId: options.runId,
    stepId: options.stepId ?? null,
    detail: { url: row.url, answer_attempt_id: Number(row.attempt_id), answered_by: row.strategy, verdict: "http_403", ...extra },
  });
}
