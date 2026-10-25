import type { sql } from "@/lib/data-store/connection";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { classifyFetchFailure, type AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { inSavepoint } from "@/lib/agents/savepoint";

import { fetchWithTimeout } from "./find-validate";
import { hostLabel, SHARED_CONTENT_HOST_PATTERN, urlHost } from "./other-bank-host";
import { looksLikeBotChallenge } from "./site-signals";
import { checkHomepage, distinctiveNameWords, type HomepageCheck } from "./website-find";

type SqlTag = typeof sql;
type Fetcher = typeof fetch;

/**
 * Whose website is it? (#1455). The registry seed (2026-02-15) stored another institution's
 * website for some institutions: 5756 Bluegrass Community FCU (Ashland KY) has
 * ukcreditunion.org, University of Kentucky FCU's (6729); 4884 Metrowest Community FCU has
 * stmaryscu.org, St. Mary's CU's (8298); 1903 First National Bank, Oldham SD has
 * firstnationalbanks.bank, First National Bank, Fort Pierre SD's (582, another holding company).
 * Every finder trusts the stored website, so Magellan kept finding the other institution's
 * schedule there (Oct 5-18), and the other-bank check (`otherInstitutionAtHost`) let it through
 * because the host was this bank's own website too. Darwin's document-owner check (#1489, #1741)
 * took the fees down after they went live; the website stayed wrong.
 *
 * Each discover step reviews up to `WEBSITE_OWNER_PER_STEP` active institutions whose website
 * host is also another active institution's website host, when the two are not one holding
 * company (shared sites inside one holding company are real, #1441). It opens the homepage once
 * and asks website search's own homepage check (`checkHomepage`: every distinctive name word,
 * plus the city or the charter number) of this institution and of each institution sharing the
 * host. The verdict is `other_institution` only on positive evidence: the homepage passes the
 * check for exactly one other institution and not for this one (or names one other's distinctive
 * words and none of this one's). Anything less (both pass, neither does, the homepage cannot be
 * read) flags nothing. A host whose name is this institution's own name or its holding company's
 * ("vallant.bank" for Pinnacle Bank, Elberton GA, held by Vallant Financial, renamed) is its own
 * without a homepage read, so a renamed bank's new domain is never handed away.
 *
 * A flagged website is not searched again (`websiteOwnedElsewhereSql`: the discovery selectors,
 * the companion finder and the paid schedule search skip it), does not count as the bank's own
 * host in the other-bank check, and goes to the website search (`website-find.ts`), which may
 * replace it with a homepage that names the institution and its city or charter number. Nothing
 * here changes a fee, a link or a website by itself.
 */
export const WEBSITE_OWNER_STRATEGY = { strategy: "discover.website_owner", version: 1 } as const;
export const WEBSITE_OTHER_INSTITUTION = "other_institution";
/** Websites one discover step reviews. */
export const WEBSITE_OWNER_PER_STEP = 5;
/** Time the review may take in a step (every homepage read shares it). */
export const WEBSITE_OWNER_BUDGET_MS = 15_000;
/** A judged website is reviewed again after this many days; an unread one after `UNREAD_RETRY_DAYS`. */
export const WEBSITE_OWNER_RECHECK_DAYS = 30;
export const WEBSITE_OWNER_UNREAD_RETRY_DAYS = 7;

export type WebsiteOwnerVerdict =
  /** The homepage names this institution (and maybe another too: `shared`). */
  | "own"
  | "shared"
  /** The host is this institution's or its holding company's name; not read. */
  | "host_names_own"
  /** Every institution on the host shares this one's holding company. */
  | "sibling"
  /** The homepage is another, unrelated institution's. */
  | "other_institution"
  | "unclear"
  | "unread";

export interface WebsiteOwnerInstitution {
  id: number | string;
  institution_name: string;
  city: string | null;
  state_code: string | null;
  cert_number: string | number | null;
  charter_type?: string | null;
  holding_company_rssd?: string | number | null;
  holding_company_name?: string | null;
}

export interface WebsiteOwnerJudgement {
  verdict: WebsiteOwnerVerdict;
  /** The institution whose website it is, for `other_institution`. */
  ownerId: number | null;
  ownerName: string | null;
  evidence: string;
  checks: Array<{ institution_id: number; name_matched: boolean; city_matched: boolean; charter_matched: boolean; ok: boolean }>;
}

/** Holding-company words that do not identify one ("Vallant Financial Inc" -> "vallant"). */
const HOLDING_WORDS = new Set(
  "financial bancorp bancorporation bancshares bankshares bcorp holding holdings group company companies corp corporation inc incorporated ltd llc mhc".split(" "),
);
/** Shortest name a host must spell out to count as the institution's own. */
const HOST_NAME_MIN_CHARS = 6;

function compact(words: string[]): string {
  return words.join("").replace(/[^a-z0-9]/g, "");
}

/** Do two institutions share a holding company (by RSSD, else by its name)? */
export function sameHoldingCompany(a: WebsiteOwnerInstitution, b: WebsiteOwnerInstitution): boolean {
  const rssdA = a.holding_company_rssd == null ? "" : String(a.holding_company_rssd).trim();
  const rssdB = b.holding_company_rssd == null ? "" : String(b.holding_company_rssd).trim();
  if (rssdA && rssdB && rssdA !== "0") return rssdA === rssdB;
  const nameA = (a.holding_company_name ?? "").trim().toLowerCase();
  const nameB = (b.holding_company_name ?? "").trim().toLowerCase();
  return nameA.length > 0 && nameA === nameB;
}

/**
 * Does the host spell out this institution's distinctive name, or its holding company's
 * ("pinnaclebank.com" for Pinnacle Bank, "vallant.bank" for a bank Vallant Financial holds)?
 */
export function hostNamesInstitution(host: string, institution: WebsiteOwnerInstitution): boolean {
  const label = hostLabel(host).replace(/[^a-z0-9]/g, "");
  const own = compact(distinctiveNameWords(institution.institution_name));
  const holding = compact(
    distinctiveNameWords(institution.holding_company_name ?? "").filter((word) => !HOLDING_WORDS.has(word)),
  );
  return [own, holding].some((name) => name.length >= HOST_NAME_MIN_CHARS && label.includes(name));
}

function checkRow(institution: WebsiteOwnerInstitution, check: HomepageCheck) {
  return {
    institution_id: Number(institution.id),
    name_matched: check.nameMatched,
    city_matched: check.cityMatched,
    charter_matched: check.charterMatched,
    ok: check.ok,
  };
}

/**
 * The verdict for one institution's website host shared with `sharers` (other active
 * institutions whose stored website has the same host). `html` is the homepage, or null when it
 * could not be read. Pure.
 */
export function judgeWebsiteOwner(input: {
  institution: WebsiteOwnerInstitution;
  host: string;
  sharers: ReadonlyArray<WebsiteOwnerInstitution>;
  html: string | null;
}): WebsiteOwnerJudgement {
  const { institution, host } = input;
  const none = { ownerId: null, ownerName: null, checks: [] };
  const unrelated = input.sharers.filter((other) => Number(other.id) !== Number(institution.id) && !sameHoldingCompany(institution, other));
  if (unrelated.length === 0) return { verdict: "sibling", evidence: `Every institution on ${host} shares the holding company`, ...none };
  if (hostNamesInstitution(host, institution) && !unrelated.some((other) => hostNamesInstitution(host, other))) {
    return { verdict: "host_names_own", evidence: `${host} spells out ${institution.institution_name} or its holding company`, ...none };
  }
  if (input.html == null) return { verdict: "unread", evidence: `${host} homepage could not be read`, ...none };
  const html = input.html;
  const homepageCheck = (row: WebsiteOwnerInstitution) => checkHomepage({ ...row, charter_type: row.charter_type ?? null }, html);
  const own = homepageCheck(institution);
  const others = unrelated.map((other) => ({ other, check: homepageCheck(other) }));
  const checks = [checkRow(institution, own), ...others.map(({ other, check }) => checkRow(other, check))];
  const passing = others.filter(({ check }) => check.ok);
  if (own.ok) {
    return {
      verdict: passing.length > 0 ? "shared" : "own",
      ownerId: null,
      ownerName: null,
      evidence: own.reason,
      checks,
    };
  }
  if (passing.length === 1) {
    const owner = passing[0].other;
    return {
      verdict: "other_institution",
      ownerId: Number(owner.id),
      ownerName: owner.institution_name,
      evidence: `${host} is ${owner.institution_name}'s website: ${passing[0].check.reason}; ${own.reason}`,
      checks,
    };
  }
  if (passing.length === 0 && !own.nameMatched) {
    const named = others.filter(({ check }) => check.nameMatched);
    if (named.length === 1) {
      const owner = named[0].other;
      return {
        verdict: "other_institution",
        ownerId: Number(owner.id),
        ownerName: owner.institution_name,
        evidence: `${host} names ${owner.institution_name} and not ${institution.institution_name}`,
        checks,
      };
    }
  }
  return { verdict: "unclear", ownerId: null, ownerName: null, evidence: `${host} homepage does not tell whose website it is; ${own.reason}`, checks };
}

interface ContestedRow extends WebsiteOwnerInstitution {
  website_url: string;
  host: string;
  sharers: WebsiteOwnerInstitution[] | string;
}

/**
 * Active institutions (in the state, when given) whose website host another active institution
 * also stores, outside one holding company, not reviewed at this version for this host lately.
 * Shared file hosts and hosts without a dot are left out.
 */
export async function selectContestedWebsites(db: SqlTag, stateCode: string | null, limit: number): Promise<ContestedRow[]> {
  const state = normalizeStateCode(stateCode ?? undefined);
  const rows = await db<ContestedRow[]>`
    -- websites another institution also stores (website owner review)
    WITH site AS (
      SELECT inst.id, inst.institution_name, inst.city, inst.state_code, inst.cert_number, inst.charter_type,
             inst.holding_company_rssd, inst.holding_company_name, inst.website_url,
             regexp_replace(lower(substring(inst.website_url from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/:?#]+)')), '^www\\.', '') AS host
        FROM institution_sources inst
       WHERE COALESCE(inst.status, 'active') = 'active'
         AND inst.website_url IS NOT NULL
         AND btrim(inst.website_url) <> ''
    )
    SELECT s.id, s.institution_name, s.city, s.state_code, s.cert_number, s.charter_type,
           s.holding_company_rssd, s.holding_company_name, s.website_url, s.host,
           json_agg(json_build_object(
             'id', o.id, 'institution_name', o.institution_name, 'city', o.city, 'state_code', o.state_code,
             'cert_number', o.cert_number, 'charter_type', o.charter_type,
             'holding_company_rssd', o.holding_company_rssd, 'holding_company_name', o.holding_company_name
           ) ORDER BY o.id) AS sharers
      FROM site s
      JOIN site o ON o.host = s.host AND o.id <> s.id
     WHERE s.host LIKE '%.%'
       AND s.host !~ ${SHARED_CONTENT_HOST_PATTERN}
       AND (${state}::text IS NULL OR upper(btrim(s.state_code)) = ${state})
       AND NOT (
         NULLIF(btrim(s.holding_company_rssd::text), '') IS NOT NULL
         AND btrim(s.holding_company_rssd::text) = btrim(COALESCE(o.holding_company_rssd::text, ''))
       )
       AND NOT EXISTS (
         SELECT 1 FROM institution_source_profiles held
          WHERE held.institution_id = s.id AND held.locked_by_correction IS TRUE
       )
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.institution_id = s.id
            AND pa.stage = 'discover'
            AND pa.strategy = ${WEBSITE_OWNER_STRATEGY.strategy}
            AND pa.strategy_version = ${WEBSITE_OWNER_STRATEGY.version}
            AND pa.detail ->> 'website_host' = s.host
            AND pa.created_at > NOW() - make_interval(days => CASE
                  WHEN pa.detail ->> 'verdict' = 'unread' THEN ${WEBSITE_OWNER_UNREAD_RETRY_DAYS}::int
                  ELSE ${WEBSITE_OWNER_RECHECK_DAYS}::int END)
       )
     GROUP BY s.id, s.institution_name, s.city, s.state_code, s.cert_number, s.charter_type,
              s.holding_company_rssd, s.holding_company_name, s.website_url, s.host
     ORDER BY s.id
     LIMIT ${limit}
  `;
  return Array.isArray(rows) ? rows : [];
}

export interface WebsiteOwnerReviewResult {
  checked: number;
  flagged: number;
  /** Live fees the flagged institutions hold from documents on the flagged site (read-only). */
  liveFeesOnFlaggedSites: number;
  verdicts: Partial<Record<WebsiteOwnerVerdict, number>>;
  dryRun: boolean;
  samples: Array<{
    institution_id: number;
    host: string;
    verdict: WebsiteOwnerVerdict;
    owner_id: number | null;
    live_fees_on_site: number | null;
    evidence: string;
  }>;
}

/** Live fees this institution holds from documents on `host` or its subdomains. */
async function liveFeesOnHost(db: SqlTag, institutionId: number, host: string): Promise<number> {
  const rows = await db<{ live: number | string }[]>`
    SELECT count(*) AS live
      FROM published_fee_catalog fee
      CROSS JOIN LATERAL (
        SELECT regexp_replace(lower(substring(COALESCE(fee.document_url, fee.source_url) from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/:?#]+)')), '^www\\.', '') AS host
      ) doc
     WHERE fee.institution_id = ${institutionId}
       AND (doc.host = ${host} OR doc.host LIKE ${`%.${host}`})
  `;
  return Number(rows?.[0]?.live ?? 0);
}

function sharersOf(row: ContestedRow): WebsiteOwnerInstitution[] {
  const value = typeof row.sharers === "string" ? (JSON.parse(row.sharers) as unknown) : row.sharers;
  return Array.isArray(value) ? (value as WebsiteOwnerInstitution[]) : [];
}

/** Reads the homepage; null (with the attempt outcome) when it cannot be read as the site. */
async function readHomepage(fetchImpl: Fetcher, websiteUrl: string): Promise<{ html: string | null; outcome: AttemptOutcome; status: string }> {
  const url = /^https?:\/\//i.test(websiteUrl.trim()) ? websiteUrl.trim() : `https://${websiteUrl.trim()}`;
  try {
    const response = await fetchWithTimeout(fetchImpl, url);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { html: null, outcome: classifyFetchFailure(response.status), status: `http_${response.status}` };
    }
    const html = await response.text();
    if (looksLikeBotChallenge(html)) return { html: null, outcome: "blocked_bot", status: "bot_challenge" };
    return { html, outcome: "ok", status: `http_${response.status}` };
  } catch (error) {
    return { html: null, outcome: classifyFetchFailure(null, error), status: error instanceof Error ? error.message.slice(0, 200) : "error" };
  }
}

const VERDICT_OUTCOME: Record<WebsiteOwnerVerdict, AttemptOutcome> = {
  own: "ok",
  shared: "ok",
  host_names_own: "ok",
  sibling: "ok",
  other_institution: "rejected",
  unclear: "unchanged",
  unread: "network_error",
};

/**
 * The discover step's website-owner review: up to `limit` contested websites in the state, each
 * homepage read once, one `discover.website_owner` attempt per institution (detail
 * `website_host`, `verdict`, `owner_id`, the name checks) and one `magellan.website_owner` run
 * event when any is reviewed. A dry run reads and writes nothing.
 */
export async function reviewWebsiteOwners(options: {
  db: SqlTag;
  fetchImpl: Fetcher;
  runId: number;
  stepId?: number | null;
  stateCode?: string | null;
  dryRun?: boolean;
  limit?: number;
  budgetMs?: number;
}): Promise<WebsiteOwnerReviewResult> {
  const dryRun = options.dryRun ?? false;
  const result: WebsiteOwnerReviewResult = { checked: 0, flagged: 0, liveFeesOnFlaggedSites: 0, verdicts: {}, dryRun, samples: [] };
  if (dryRun) return result;
  const { db } = options;
  const deadline = Date.now() + (options.budgetMs ?? WEBSITE_OWNER_BUDGET_MS);
  const rows = await selectContestedWebsites(db, options.stateCode ?? null, Math.max(0, options.limit ?? WEBSITE_OWNER_PER_STEP));
  for (const row of rows) {
    if (Date.now() > deadline) break;
    const startedAt = Date.now();
    const host = row.host || urlHost(row.website_url) || "";
    const sharers = sharersOf(row);
    // Only read the homepage when the host alone does not settle it.
    let judgement = judgeWebsiteOwner({ institution: row, host, sharers, html: null });
    let read: { outcome: AttemptOutcome; status: string } | null = null;
    if (judgement.verdict === "unread") {
      const homepage = await readHomepage(options.fetchImpl, row.website_url);
      read = homepage;
      judgement = judgeWebsiteOwner({ institution: row, host, sharers, html: homepage.html });
    }
    const outcome = judgement.verdict === "unread" ? (read?.outcome ?? "network_error") : VERDICT_OUTCOME[judgement.verdict];
    result.checked += 1;
    result.verdicts[judgement.verdict] = (result.verdicts[judgement.verdict] ?? 0) + 1;
    if (judgement.verdict === WEBSITE_OTHER_INSTITUTION) result.flagged += 1;
    const institutionId = Number(row.id);
    // Read-only: live fees already read from the flagged site. Nothing here takes them down;
    // Darwin's document-owner check judges each document (#1489).
    const liveFeesOnSite = judgement.verdict === WEBSITE_OTHER_INSTITUTION ? await liveFeesOnHost(db, institutionId, host) : null;
    if (liveFeesOnSite) result.liveFeesOnFlaggedSites += liveFeesOnSite;
    await recordAttempt(db, {
      institutionId,
      stage: "discover",
      strategy: WEBSITE_OWNER_STRATEGY.strategy,
      version: WEBSITE_OWNER_STRATEGY.version,
      fingerprint: null,
      outcome,
      yieldCount: 0,
      costMicrousd: 0,
      durationMs: Date.now() - startedAt,
      runId: options.runId,
      stepId: options.stepId ?? null,
      foldIntoPlaybook: false,
      detail: {
        website_url: row.website_url,
        website_host: host,
        verdict: judgement.verdict,
        owner_id: judgement.ownerId,
        owner_name: judgement.ownerName,
        sharer_ids: sharers.map((sharer) => Number(sharer.id)),
        checks: judgement.checks,
        homepage: read?.status ?? null,
        live_fees_on_site: liveFeesOnSite,
        evidence: judgement.evidence.slice(0, 500),
      },
    });
    if (result.samples.length < 10) {
      result.samples.push({
        institution_id: institutionId, host, verdict: judgement.verdict, owner_id: judgement.ownerId,
        live_fees_on_site: liveFeesOnSite, evidence: judgement.evidence.slice(0, 300),
      });
    }
  }
  if (result.checked > 0) await recordReviewEvent(db, options.runId, options.stepId ?? null, result);
  return result;
}

async function recordReviewEvent(db: SqlTag, runId: number, stepId: number | null, result: WebsiteOwnerReviewResult): Promise<void> {
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${runId}, ${stepId}, 'magellan.website_owner', 'info',
        ${`Reviewed ${result.checked} website(s) another institution also stores; ${result.flagged} belong to another institution and are no longer searched`},
        ${JSON.stringify({ checked: result.checked, flagged: result.flagged, live_fees_on_flagged_sites: result.liveFeesOnFlaggedSites, verdicts: result.verdicts, samples: result.samples })}::jsonb
      )
    `);
  } catch (error) {
    console.error("recordReviewEvent failed:", error);
  }
}
