import { sql } from "@/lib/data-store/connection";
import { EmergencyStopActiveError } from "@/lib/automation-control";
import { ProviderBudgetBlockedError } from "@/lib/api-hardening/budget";
import { htmlToScoringText } from "@/lib/agents/learning/fee-page";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { classifyFetchFailure, type AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { PAID_PASS_MODELS, paidModelCall, paidResponseJson, type PaidMessageCreator } from "@/lib/agents/paid-pass";

import { fetchWithTimeout } from "./find-validate";

type SqlTag = typeof sql;
type Fetcher = typeof fetch;

/**
 * Institutions with no website are skipped by every finder: the FDIC registry step
 * fills `website_url` only when FDIC lists one and the NCUA step stores none (585 active
 * institutions on 2026-10-06, 510 of them credit unions; 45 in TX, 27 in CA). This step
 * asks the model, with its web search tool, for the institution's official website and
 * saves it only after opening the homepage and checking it names the institution plus
 * its city or its FDIC certificate / NCUA charter number. A domain another institution
 * already uses, a government or directory site, or a homepage that fails the check is
 * not saved; the candidate stays on the attempt (`detail.candidate_url`) for a person.
 *
 * It runs inside Magellan's paid step, under the same budget checks and caps.
 */

export const WEBSITE_FIND_STRATEGY = { strategy: "discover.website_search", version: 1 } as const;
/** Institutions one paid step searches for a website. */
export const WEBSITE_FIND_PER_RUN = 5;
const WEB_SEARCH_MAX_USES = 3;
const MAX_OUTPUT_TOKENS = 512;
/** Outcomes that do not count as this month's try (nothing was learned). */
const TRANSIENT_OUTCOMES = ["network_error", "timeout", "http_5xx", "http_429", "budget_blocked"];

/** Directories, social sites and regulators: never an institution's own website. */
const NOT_OWN_SITE = [
  "facebook.com", "linkedin.com", "twitter.com", "x.com", "instagram.com", "youtube.com", "yelp.com",
  "mapquest.com", "google.com", "bankrate.com", "wallethub.com", "nerdwallet.com", "creditunionsonline.com",
  "mycreditunion.gov", "ncua.gov", "fdic.gov", "wikipedia.org", "bbb.org", "yellowpages.com", "zoominfo.com",
  "bizapedia.com", "opencorporates.com", "banks.org", "usbanklocations.com", "bankbranchlocator.com",
  "depositaccounts.com", "creditunion.directory", "bankencyclopedia.com", "dnb.com", "indeed.com", "glassdoor.com",
];

/** Words in nearly every institution's name: they do not identify one. */
const GENERIC_NAME_WORDS = new Set(
  "the of and at in for bank banks banking national association na n a federal credit union cu fcu ssb fsb savings trust company co inc corp corporation state community".split(" "),
);

export interface WebsiteFindRow {
  id: number | string;
  institution_name: string;
  city: string | null;
  state_code: string | null;
  charter_type: string | null;
  cert_number: string | number | null;
}

interface WebsiteAnswer {
  url?: unknown;
  evidence?: unknown;
}

export interface HomepageCheck {
  ok: boolean;
  nameMatched: boolean;
  cityMatched: boolean;
  charterMatched: boolean;
  reason: string;
}

export interface WebsiteFindResult {
  selected: number;
  processed: number;
  saved: number;
  needsHuman: number;
  costMicrousd: number;
  budgetStopped: boolean;
  budgetReason: string | null;
  results: Array<Record<string, unknown>>;
}

function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/&amp;|&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

/** The name words that tell this institution apart ("Bosque", "Lipan", "Mct"). */
export function distinctiveNameWords(name: string): string[] {
  return normalize(name).trim().split(" ").filter((word) => word.length > 0 && !GENERIC_NAME_WORDS.has(word));
}

/**
 * A one-word name ("CALIFORNIA", "HAVEN": state charters whose stored name was cut short)
 * is too weak to tell a homepage apart; those go to a person without a paid search.
 */
export function nameTooShortToVerify(name: string): boolean {
  return normalize(name).trim().split(" ").filter(Boolean).length < 2;
}

/** The site's own origin ("https://www.example.com"), or null for an address that cannot be one. */
export function websiteOrigin(url: string): string | null {
  try {
    const parsed = new URL(url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    if (!host.includes(".") || host.endsWith(".gov") || host.endsWith(".mil")) return null;
    const bare = host.replace(/^www\./, "");
    if (NOT_OWN_SITE.some((site) => bare === site || bare.endsWith(`.${site}`))) return null;
    return `${parsed.protocol}//${host}`;
  } catch {
    return null;
  }
}

/**
 * Does this homepage belong to the institution? It must carry every distinctive word of
 * the name (all name words when none is distinctive) and either the city or the
 * FDIC certificate / NCUA charter number.
 */
export function checkHomepage(row: WebsiteFindRow, html: string): HomepageCheck {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const text = normalize(`${title}\n${htmlToScoringText(html)}`);
  const words = distinctiveNameWords(row.institution_name);
  const required = words.length > 0 ? words : normalize(row.institution_name).trim().split(" ");
  const nameMatched = required.length > 0 && required.every((word) => text.includes(` ${word} `));
  const city = row.city ? normalize(row.city).trim() : "";
  const cityMatched = city.length > 0 && text.includes(` ${city} `);
  const charter = row.cert_number == null ? "" : String(row.cert_number).trim();
  const charterMatched = /^\d{3,}$/.test(charter) && new RegExp(`(^|[^0-9])${charter}([^0-9]|$)`).test(text);
  const ok = nameMatched && (cityMatched || charterMatched);
  const reason = ok
    ? `Homepage names ${row.institution_name} and ${cityMatched ? `its city (${row.city})` : `its charter number ${charter}`}`
    : !nameMatched
      ? `Homepage does not name ${row.institution_name} (needs: ${required.join(", ")})`
      : `Homepage names the institution but neither its city (${row.city ?? "unknown"}) nor charter number ${charter || "unknown"}`;
  return { ok, nameMatched, cityMatched, charterMatched, reason };
}

export function websiteFindPrompt(row: WebsiteFindRow): string {
  const kind = row.charter_type === "credit_union" ? "credit union" : "bank";
  const id = row.cert_number
    ? row.charter_type === "credit_union" ? `NCUA charter number ${row.cert_number}` : `FDIC certificate number ${row.cert_number}`
    : null;
  return [
    `Find the official website of this ${kind}: the institution's own homepage, not a directory,`,
    "social media page, news article, regulator page or a different institution with a similar name.",
    "",
    `Name: ${row.institution_name}`,
    `Location: ${[row.city, row.state_code].filter(Boolean).join(", ") || "unknown"}`,
    ...(id ? [`Identifier: ${id}`] : []),
    "",
    "Rules:",
    "- Return the homepage address you saw in the search results; do not guess a domain.",
    "- If the institution has merged into another one, answer with url null and say so in evidence.",
    "- If you cannot find it, answer with url null.",
    "",
    "Answer with JSON only:",
    "{\"url\": string | null, \"evidence\": \"one short sentence\"}",
  ].join("\n");
}

async function selectRows(db: SqlTag, stateCode: string | null, limit: number): Promise<WebsiteFindRow[]> {
  return db<WebsiteFindRow[]>`
    SELECT inst.id, inst.institution_name, inst.city, inst.state_code, inst.charter_type, inst.cert_number
      FROM institution_sources inst
      LEFT JOIN institution_source_profiles profile ON profile.institution_id = inst.id
     WHERE COALESCE(inst.status, 'active') = 'active'
       AND (inst.website_url IS NULL OR btrim(inst.website_url) = '')
       AND (inst.fee_schedule_url IS NULL OR btrim(inst.fee_schedule_url) = '')
       AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode})
       AND COALESCE(profile.locked_by_correction, false) = false
       AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.institution_id = inst.id
            AND pa.stage = 'discover'
            AND pa.strategy = ${WEBSITE_FIND_STRATEGY.strategy}
            AND pa.created_at >= date_trunc('month', NOW())
            AND pa.outcome <> ALL(${TRANSIENT_OUTCOMES})
       )
     ORDER BY inst.asset_size DESC NULLS LAST, inst.id ASC
     LIMIT ${limit}
  `;
}

/** Another active institution already uses this host as its website. */
async function hostTaken(db: SqlTag, institutionId: number, origin: string): Promise<boolean> {
  const host = new URL(origin).hostname.replace(/^www\./, "");
  const [row] = await db<Array<{ taken: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM institution_sources other
       WHERE other.id <> ${institutionId}
         AND COALESCE(other.status, 'active') = 'active'
         AND other.website_url IS NOT NULL
         AND lower(regexp_replace(regexp_replace(other.website_url, '^https?://', ''), '^www\\.|[/:?#].*$', '', 'g')) = ${host}
    ) AS taken
  `;
  return row?.taken === true;
}

function budgetStop(error: unknown): string | null {
  if (error instanceof ProviderBudgetBlockedError) return error.message || error.reasonCode;
  if (error instanceof EmergencyStopActiveError) return error.message;
  return null;
}

/**
 * One paid website search per institution with no website, at most `limit` a run. A
 * dry run lists who would be searched and calls nothing.
 */
export async function runWebsiteFind(options: {
  runId: number;
  stepId?: number | null;
  stateCode?: string | null;
  limit?: number;
  dryRun?: boolean;
  db?: SqlTag;
  create?: PaidMessageCreator;
  fetchImpl?: Fetcher;
}): Promise<WebsiteFindResult> {
  const db = options.db ?? sql;
  const result: WebsiteFindResult = {
    selected: 0, processed: 0, saved: 0, needsHuman: 0, costMicrousd: 0, budgetStopped: false, budgetReason: null, results: [],
  };
  const limit = Math.max(1, Math.min(Math.floor(Number(options.limit ?? WEBSITE_FIND_PER_RUN)) || WEBSITE_FIND_PER_RUN, WEBSITE_FIND_PER_RUN));
  const rows = await selectRows(db, normalizeStateCode(options.stateCode ?? undefined), limit);
  result.selected = rows.length;
  if (options.dryRun) {
    result.results = rows.map((row) => ({ institution_id: Number(row.id), institution_name: row.institution_name, would_search_website: true }));
    return result;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const model = PAID_PASS_MODELS.find();
  for (const row of rows) {
    const institutionId = Number(row.id);
    const startedAt = Date.now();
    let costMicrousd = 0;
    let outcome: AttemptOutcome;
    let reason: string;
    let candidate: string | null = null;
    let saved: string | null = null;
    let answer: WebsiteAnswer | null = null;
    let check: HomepageCheck | null = null;

    if (nameTooShortToVerify(row.institution_name)) {
      result.processed += 1;
      result.needsHuman += 1;
      reason = `Stored name "${row.institution_name}" is too short to check a homepage against`;
      await recordAttempt(db, {
        institutionId,
        stage: "discover",
        strategy: WEBSITE_FIND_STRATEGY.strategy,
        version: WEBSITE_FIND_STRATEGY.version,
        fingerprint: null,
        outcome: "rejected",
        yieldCount: 0,
        costMicrousd: 0,
        durationMs: 0,
        runId: options.runId,
        stepId: options.stepId ?? null,
        detail: { pass: 3, saved_website: null, candidate_url: null, needs_human: true, reason },
      });
      result.results.push({ institution_id: institutionId, outcome: "rejected", website: null, candidate_url: null, cost_microusd: 0, reason, by: "website_search" });
      continue;
    }

    try {
      const call = await paidModelCall({
        agent: "magellan",
        operation: "website_find",
        runId: options.runId,
        create: options.create,
        metadata: { institution_id: institutionId, step_id: options.stepId ?? null },
        params: {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: WEB_SEARCH_MAX_USES }],
          messages: [{ role: "user", content: websiteFindPrompt(row) }],
        },
      });
      costMicrousd = call.costMicrousd;
      result.costMicrousd += costMicrousd;
      answer = paidResponseJson<WebsiteAnswer>(call.message);
      const proposed = typeof answer?.url === "string" ? answer.url.trim() : "";
      candidate = proposed || null;
      const origin = proposed ? websiteOrigin(proposed) : null;
      if (!proposed) {
        outcome = "no_candidates";
        reason = "Web search found no website";
      } else if (!origin) {
        outcome = "invalid_url";
        reason = `Answer is a directory, social, government or unreadable address: ${proposed}`;
      } else if (await hostTaken(db, institutionId, origin)) {
        outcome = "rejected";
        reason = `Another institution already uses ${new URL(origin).hostname}`;
      } else {
        try {
          const response = await fetchWithTimeout(fetchImpl, `${origin}/`);
          if (!response.ok) {
            outcome = classifyFetchFailure(response.status);
            reason = `Homepage returned HTTP ${response.status}: ${origin}`;
          } else {
            check = checkHomepage(row, await response.text());
            if (check.ok) {
              outcome = "ok";
              // Save where the homepage ended up after redirects.
              saved = websiteOrigin(response.url || origin) ?? origin;
              reason = check.reason;
            } else {
              outcome = "evidence_mismatch";
              reason = check.reason;
            }
          }
        } catch (error) {
          outcome = classifyFetchFailure(null, error);
          reason = `Homepage could not be opened: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    } catch (error) {
      const stopped = budgetStop(error);
      if (stopped) {
        result.budgetStopped = true;
        result.budgetReason = stopped;
        break;
      }
      outcome = classifyFetchFailure(null, error);
      reason = `Model call failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    result.processed += 1;
    if (saved) {
      result.saved += 1;
      // Only an empty website is filled, and never past a person's correction. The bank's
      // search state resets so free discovery searches the new site on its next step.
      await db`
        UPDATE institution_sources inst
           SET website_url = ${saved},
               rescue_status = 'pending',
               last_rescue_attempt_at = NULL
         WHERE inst.id = ${institutionId}
           AND (inst.website_url IS NULL OR btrim(inst.website_url) = '')
           AND NOT EXISTS (
             SELECT 1 FROM institution_source_profiles held
              WHERE held.institution_id = inst.id AND held.locked_by_correction IS TRUE
           )
      `;
    } else {
      result.needsHuman += 1;
    }
    await recordAttempt(db, {
      institutionId,
      stage: "discover",
      strategy: WEBSITE_FIND_STRATEGY.strategy,
      version: WEBSITE_FIND_STRATEGY.version,
      fingerprint: null,
      outcome,
      yieldCount: saved ? 1 : 0,
      costMicrousd,
      durationMs: Date.now() - startedAt,
      runId: options.runId,
      stepId: options.stepId ?? null,
      detail: {
        pass: 3,
        model,
        saved_website: saved,
        // A person reviews this when nothing was saved.
        candidate_url: candidate,
        needs_human: !saved,
        evidence: typeof answer?.evidence === "string" ? answer.evidence.slice(0, 300) : null,
        name_matched: check?.nameMatched ?? null,
        city_matched: check?.cityMatched ?? null,
        charter_matched: check?.charterMatched ?? null,
        reason,
      },
    });
    result.results.push({ institution_id: institutionId, outcome, website: saved, candidate_url: candidate, cost_microusd: costMicrousd, reason, by: "website_search" });
  }
  return result;
}
