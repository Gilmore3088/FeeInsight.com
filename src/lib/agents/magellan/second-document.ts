import type { sql } from "@/lib/data-store/connection";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { classifyFetchFailure, type AttemptOutcome } from "@/lib/agents/learning/outcomes";

import { fetchWithTimeout, validateFeeCandidate } from "./find-validate";
import {
  hubPages,
  MIN_LINK_SCORE,
  pageLinks,
  scoreLink,
  urlIdentity,
  type LinkCandidate,
  type PageLink,
  type TrailEntry,
} from "./finders";

type SqlTag = typeof sql;
type Fetcher = typeof fetch;

/**
 * Pass 2, second-document finder. A live bank whose published fees cover fewer than
 * THIN_BANK_CATEGORY_LIMIT categories often keeps the rest in another document: a
 * business fee schedule, or an "other services" / miscellaneous fee list. This looks
 * for one on the homepage, the stored fee page and one hop of hub pages, validates it
 * with the same fee-page check, and stores it in `institution_additional_sources`
 * (never replacing the bank's fee link). Runs inside the `discover` step after the
 * main search, with whatever time the step has left, and logs every bank it checks.
 */

export const SECOND_DOCUMENT_FINDER = { strategy: "discover.second_document", version: 1 } as const;
export const THIN_BANK_CATEGORY_LIMIT = 5;
export const SECOND_DOCUMENT_BANKS_PER_STEP = 5;
const MAX_CANDIDATES = 3;
const MAX_HUBS = 2;
const RECHECK_DAYS = 30;

export type AdditionalDocumentRole = "business" | "other_services" | "consumer_supplement";

const BUSINESS = /\b(business|commercial|corporate|treasury management)\b/;
const OTHER_SERVICES = /\b(other services|other fees|miscellaneous|additional services|general fees|service fees|common fees)\b/;

export function additionalDocumentRole(text: string): AdditionalDocumentRole {
  const lower = text.toLowerCase().replace(/[-_]+/g, " ");
  if (BUSINESS.test(lower)) return "business";
  if (OTHER_SERVICES.test(lower)) return "other_services";
  return "consumer_supplement";
}

/** A link that may be another fee document: fee words plus, ideally, a business/other-services label. */
export function secondDocumentCandidates(links: PageLink[], foundOn: string | null, exclude: Set<string>): LinkCandidate[] {
  return links
    .filter((link) => !exclude.has(urlIdentity(link.url)))
    .map((link) => {
      const scored = scoreLink(link.url, link.label, "homepage_link", foundOn);
      const lower = `${link.label} ${link.url}`.toLowerCase().replace(/[-_]+/g, " ");
      const feeWord = /\b(fees?|charges?|pricing)\b/.test(lower);
      const specific = BUSINESS.test(lower) || OTHER_SERVICES.test(lower);
      return { ...scored, score: Math.min(0.98, scored.score + (feeWord && specific ? 0.2 : 0)) };
    })
    .filter((candidate) => candidate.score >= MIN_LINK_SCORE)
    .sort((a, b) => b.score - a.score);
}

const readyCache = new WeakMap<object, boolean>();

/** True once the `institution_additional_sources` migration is applied (positive answer cached). */
export async function additionalSourcesReady(db: SqlTag): Promise<boolean> {
  if (readyCache.get(db)) return true;
  const [row] = await db`SELECT to_regclass('public.institution_additional_sources') IS NOT NULL AS ready`;
  const ready = row?.ready === true;
  if (ready) readyCache.set(db, true);
  return ready;
}

interface ThinBankRow {
  id: number | string;
  institution_name: string;
  state_code: string | null;
  website_url: string;
  fee_schedule_url: string;
  categories: number | string;
}

export interface SecondDocumentResult {
  institutionId: number;
  categories: number;
  outcome: AttemptOutcome;
  url: string | null;
  role: AdditionalDocumentRole | null;
  documentType: string | null;
  reason: string;
  fetches: number;
}

export interface RunSecondDocumentFindResult {
  /** "schema_pending" until the migration is applied; "no_attempt_log" without the learning core. */
  status: "ran" | "schema_pending" | "no_attempt_log" | "out_of_time";
  checked: number;
  found: number;
  results: SecondDocumentResult[];
}

async function selectThinBanks(db: SqlTag, stateCode: string | null, limit: number): Promise<ThinBankRow[]> {
  return db<ThinBankRow[]>`
    WITH thin AS (
      SELECT c.institution_id, count(DISTINCT c.fee_category)::int AS categories
        FROM published_fee_catalog c
        JOIN institution_sources scoped ON scoped.id = c.institution_id
       WHERE (${stateCode}::text IS NULL OR upper(btrim(scoped.state_code)) = ${stateCode})
       GROUP BY c.institution_id
      HAVING count(DISTINCT c.fee_category) < ${THIN_BANK_CATEGORY_LIMIT}
    )
    SELECT inst.id, inst.institution_name, inst.state_code, inst.website_url, inst.fee_schedule_url, thin.categories
      FROM thin
      JOIN institution_sources inst ON inst.id = thin.institution_id
     WHERE COALESCE(inst.status, 'active') = 'active'
       AND inst.website_url IS NOT NULL AND btrim(inst.website_url) <> ''
       AND inst.fee_schedule_url IS NOT NULL AND btrim(inst.fee_schedule_url) <> ''
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.institution_id = inst.id
            AND pa.stage = 'discover'
            AND pa.strategy = ${SECOND_DOCUMENT_FINDER.strategy}
            AND pa.strategy_version = ${SECOND_DOCUMENT_FINDER.version}
            AND pa.created_at > NOW() - make_interval(days => ${RECHECK_DAYS})
       )
     ORDER BY thin.categories ASC, inst.asset_size DESC NULLS LAST, inst.id ASC
     LIMIT ${limit}
  `;
}

async function knownDocumentUrls(db: SqlTag, institutionId: number): Promise<Set<string>> {
  const rows = await db`
    SELECT document_url AS url FROM source_documents
     WHERE institution_id = ${institutionId} AND document_url IS NOT NULL
    UNION
    SELECT url FROM institution_additional_sources WHERE institution_id = ${institutionId}
  `;
  return new Set(rows.map((row) => urlIdentity(String(row.url))));
}

function normalizeSite(value: string): URL | null {
  for (const candidate of [value.trim(), `https://${value.trim()}`]) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url;
    } catch {
      continue;
    }
  }
  return null;
}

async function searchBank(
  row: ThinBankRow,
  fetchImpl: Fetcher,
  known: Set<string>,
  deadline: number,
): Promise<SecondDocumentResult & { trail: TrailEntry[] }> {
  const institutionId = Number(row.id);
  const categories = Number(row.categories);
  const trail: TrailEntry[] = [];
  let fetches = 0;
  const done = (fields: Partial<SecondDocumentResult> & Pick<SecondDocumentResult, "outcome" | "reason">) => ({
    institutionId,
    categories,
    url: null,
    role: null,
    documentType: null,
    fetches,
    trail,
    ...fields,
  });

  const site = normalizeSite(row.website_url);
  if (!site) return done({ outcome: "invalid_url", reason: "Invalid website_url" });
  const exclude = new Set([...known, urlIdentity(row.fee_schedule_url)]);

  const openHtml = async (url: string, source: TrailEntry["source"]): Promise<string | null> => {
    fetches += 1;
    const entry: TrailEntry = { url, source, foundOn: null, label: "", score: 0, verdict: "" };
    trail.push(entry);
    try {
      const response = await fetchWithTimeout(fetchImpl, url);
      entry.verdict = `http_${response.status}`;
      if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) return null;
      return await response.text();
    } catch {
      entry.verdict = "fetch_failed";
      return null;
    }
  };

  const homepage = await openHtml(site.toString(), "homepage");
  if (homepage == null) {
    const status = Number(/^http_(\d+)$/.exec(trail[0]?.verdict ?? "")?.[1] ?? 0);
    return done({ outcome: classifyFetchFailure(status || null), reason: `Homepage ${trail[0]?.verdict ?? "failed"}` });
  }
  const links: PageLink[] = [...pageLinks(homepage, site)];
  // The stored fee page often links to its business or other-services companion.
  if (!/\.pdf($|\?)/i.test(row.fee_schedule_url) && Date.now() < deadline) {
    const feePage = await openHtml(row.fee_schedule_url, "known_link");
    if (feePage) links.push(...pageLinks(feePage, site));
  }
  for (const hub of hubPages(links, site, exclude, MAX_HUBS)) {
    if (Date.now() > deadline) break;
    const html = await openHtml(hub.url, "hub_page");
    if (html) links.push(...pageLinks(html, site));
  }

  const unique = [...new Map(links.map((link) => [urlIdentity(link.url), link])).values()];
  const candidates = secondDocumentCandidates(unique, null, exclude).slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) return done({ outcome: "no_candidates", reason: "No other fee documents linked" });

  let rejectedAny = false;
  for (const candidate of candidates) {
    if (Date.now() > deadline) return done({ outcome: "timeout", reason: "Out of time" });
    fetches += 1;
    const entry: TrailEntry = { url: candidate.url, source: candidate.source, foundOn: candidate.foundOn, label: candidate.label, score: Math.round(candidate.score * 100) / 100, verdict: "" };
    trail.push(entry);
    try {
      const validation = await validateFeeCandidate(candidate, fetchImpl);
      entry.verdict = validation.verdict;
      if (validation.ok) {
        return done({
          outcome: "ok",
          url: candidate.url,
          role: additionalDocumentRole(`${candidate.label} ${new URL(candidate.url).pathname}`),
          documentType: validation.documentType,
          reason: validation.reason,
        });
      }
      rejectedAny = rejectedAny || !validation.verdict.startsWith("http_");
    } catch {
      entry.verdict = "fetch_failed";
    }
  }
  return done({ outcome: rejectedAny ? "wrong_document" : "no_candidates", reason: "No candidate passed the fee-page check" });
}

export async function runSecondDocumentFind(options: {
  db: SqlTag;
  fetchImpl: Fetcher;
  runId: number;
  stepId?: number | null;
  stateCode?: string | null;
  limit?: number;
  deadline: number;
  dryRun?: boolean;
  learning: boolean;
}): Promise<RunSecondDocumentFindResult> {
  const empty = (status: RunSecondDocumentFindResult["status"]): RunSecondDocumentFindResult => ({ status, checked: 0, found: 0, results: [] });
  if (!options.learning) return empty("no_attempt_log");
  if (Date.now() > options.deadline) return empty("out_of_time");
  if (!(await additionalSourcesReady(options.db))) return empty("schema_pending");

  const db = options.db;
  const rows = await selectThinBanks(db, normalizeStateCode(options.stateCode ?? undefined), options.limit ?? SECOND_DOCUMENT_BANKS_PER_STEP);
  const results: SecondDocumentResult[] = [];
  for (const row of rows) {
    if (Date.now() > options.deadline) break;
    const startedAt = Date.now();
    const institutionId = Number(row.id);
    const known = await knownDocumentUrls(db, institutionId);
    const result = await searchBank(row, options.fetchImpl, known, options.deadline);
    const { trail, ...summary } = result;
    results.push(summary);
    if (options.dryRun) continue;
    if (result.outcome === "ok" && result.url) {
      await db`
        INSERT INTO institution_additional_sources
          (institution_id, url, document_type, document_role, found_by_strategy, strategy_version, agent_run_id, reason)
        VALUES
          (${institutionId}, ${result.url}, ${result.documentType}, ${result.role}, ${SECOND_DOCUMENT_FINDER.strategy},
           ${SECOND_DOCUMENT_FINDER.version}, ${options.runId}, ${result.reason})
        ON CONFLICT (institution_id, url) DO NOTHING
      `;
    }
    await recordAttempt(db, {
      institutionId,
      stage: "discover",
      strategy: SECOND_DOCUMENT_FINDER.strategy,
      version: SECOND_DOCUMENT_FINDER.version,
      fingerprint: row.fee_schedule_url,
      outcome: result.outcome,
      yieldCount: result.url ? 1 : 0,
      costMicrousd: 0,
      durationMs: Date.now() - startedAt,
      runId: options.runId,
      stepId: options.stepId ?? null,
      detail: {
        pass: 2,
        url: result.url,
        role: result.role,
        document_type: result.documentType,
        published_categories: result.categories,
        reason: result.reason,
        pages_fetched: result.fetches,
        trail: trail.slice(0, 40),
      },
    });
  }
  return { status: "ran", checked: results.length, found: results.filter((result) => result.url).length, results };
}
