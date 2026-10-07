import { sql, withTransaction } from "@/lib/data-store/connection";
import { startAgentRun, type StartAgentRunResult } from "@/lib/agents/run-store";
import type {
  AgentRunStepDefinition,
  AgentRunTriggerSource,
} from "@/lib/agents/types";
import { normalizeStateCode, syncStateLaneProfiles } from "./state-lane-memory";
import { KNOX_EXTRACT_STRATEGY, KNOX_REEXTRACT_MAX_FEES } from "./knox/extract";
import { REREAD_MAX_KNOX_FEES, ROSETTA_READ_VERSION } from "./rosetta/read";
import { DARWIN_VERIFY_MAX_LIMIT, DARWIN_VERIFY_STRATEGY } from "./darwin/verify";
import { HAMILTON_PUBLISH_MAX_LIMIT } from "./hamilton/publish";
import { knoxFreeSignature, RULES_RECHECK_STRATEGY } from "./hamilton/rules-recheck";
import { SOURCE_CHECK_REASON, SOURCE_CHECK_STRATEGY } from "./hamilton/source-check";
import { MAGELLAN_STALE_LINK_REFETCH_DAYS } from "./magellan/fetch";
import { DISCOVERY_METHOD_VERSION } from "./magellan/discovery";
import { PAID_FIND_STRATEGY, PAID_PICK_STRATEGY, TRANSIENT_PAID_OUTCOMES } from "./magellan/paid-find";
import { WEBSITE_FIND_STRATEGY } from "./magellan/website-find";
import { HEADLINE_FEE_KEYS, MARKET_READY_MIN_RICH, RICH_MIN_CATEGORIES } from "@/lib/data-store/market-readiness";

/**
 * Documents a lane reads and extracts per run. Twice the agents' default, so a state's
 * re-read backlog drains in fewer runs. Each document is re-read at most once per
 * reader version, so a bigger batch does not download any document more often.
 */
export const STATE_LANE_DOCUMENT_BATCH = 50;
/**
 * States whose lanes read and extract a bigger batch per run. Texas re-reads and
 * re-extracts its ~358 stored documents under the current rules first (2026-10-05);
 * 100 while the database watch runs, 200 after a clean night. Capped by
 * ROSETTA_READ_MAX_LIMIT and KNOX_EXTRACT_MAX_LIMIT.
 */
export const STATE_LANE_DOCUMENT_BATCH_BY_STATE: Readonly<Record<string, number>> = { TX: 100 };
/**
 * Cadence. Each state gets one full pass a month (the state expert refreshes its memory,
 * Magellan discovers and fetches, every later step runs). The first full pass of each
 * calendar quarter is a re-check (`recheck: 'quarterly'` in the run params): discovery
 * re-validates every link and re-searches dead and needs-human banks. Between full
 * passes, a lane runs hourly catch-up passes only while the state has free work left
 * (documents to re-read or re-extract, raw rows Darwin has not decided); otherwise it
 * sleeps until next month. Windows are UTC calendar months and quarters.
 *
 * While a state still has a free-work backlog, its lane runs again this soon.
 */
export const STATE_LANE_BACKLOG_RETRY_MINUTES = 60;
/**
 * A lane with no backlog checks again this soon, even when its next full pass is weeks
 * away: a missed search becomes due again after 12 hours and a fee link goes stale after
 * a month, and a lane asleep until next month would leave both waiting.
 */
export const STATE_LANE_IDLE_RECHECK_HOURS = 12;

/**
 * Focus report markets (James, 2026-10-05: Texas and California). Their full passes look
 * for and fetch twice the default links (Magellan's maximum).
 */
export const FOCUS_STATE_LANE_PARAMS: Record<string, { discovery_limit: number; fetch_limit: number }> = {
  TX: { discovery_limit: 50, fetch_limit: 50 },
  CA: { discovery_limit: 50, fetch_limit: 50 },
};
/**
 * Bulk fill (James, 2026-10-05): every state runs a daily full pass instead of a monthly one
 * while more than this many of its active institutions still have no fee schedule link, then
 * falls back to the monthly refresh on its own. Only banks a search can still find count
 * (James, 2026-10-06): a website on file, not offline or manual-review, and not a dead end
 * (`dead` / `needs_human`, which the quarterly re-check searches again). Counting dead ends
 * kept 23 states on daily paid passes that could never turn off; on this count alone 5 do.
 * A state also stays daily while Magellan's paid steps have banks due this month: dead-end
 * banks the paid find has not tried (`discover-paid`), and institutions with no website the
 * website search has not tried. Both are monthly per bank, so the rule turns off on its own,
 * and the paid caps still bound the spend.
 */
export const DAILY_FULL_PASS_MISSING_LINKS = 50;

export type StateLaneRecheck = "quarterly";

export const STATE_LANE_STEPS: AgentRunStepDefinition[] = [
  {
    key: "enhance",
    agent: "atlas",
    title: "Refresh state source memory and lane health",
  },
  {
    key: "state-expert",
    agent: "atlas",
    title: "State expert: refresh the state's memory (regulator, platforms, strategies, peer levels)",
  },
  {
    key: "discover",
    agent: "magellan",
    title: "Find and verify missing fee schedule URLs",
  },
  {
    key: "discover-paid",
    agent: "magellan",
    title: "Paid last pass: find fee schedules the free finders missed",
  },
  {
    key: "fetch",
    agent: "magellan",
    title: "Fetch state source documents",
  },
  {
    key: "read",
    agent: "rosetta",
    title: "Read PDFs, HTML, and queued OCR candidates",
    input: { read_limit: STATE_LANE_DOCUMENT_BATCH },
  },
  {
    key: "read-paid",
    agent: "rosetta",
    title: "Paid last pass: read scans and pages the free readers could not",
  },
  {
    key: "extract",
    agent: "knox",
    title: "Extract fee observations from normalized source text",
    input: { extract_limit: STATE_LANE_DOCUMENT_BATCH },
  },
  {
    key: "extract-paid",
    agent: "knox",
    title: "Paid last pass: extract fees the rules missed in dense documents",
  },
  {
    key: "classify",
    agent: "darwin",
    title: "Verify state raw fee observations",
    // Darwin's per-step maximum. At the default 100 a lane cleared about 75 fees per pass
    // while Knox re-extraction queued thousands an hour (2026-10-05: 16,471 waiting).
    // A 500-row pass takes seconds and lanes still run one at a time.
    input: { verify_limit: DARWIN_VERIFY_MAX_LIMIT },
  },
  {
    key: "verify-paid",
    agent: "darwin",
    title: "Paid last pass: Claude reviews only the fees Darwin's free checks disagree on",
  },
  {
    key: "publish",
    agent: "hamilton",
    title: "Publish verified state fee intelligence",
    // Hamilton's per-step maximum, matching Darwin's: at 100 a pass published a third of
    // what Darwin verified (PA 2026-10-05: 302 verified, 102 published).
    input: { publish_limit: HAMILTON_PUBLISH_MAX_LIMIT },
  },
  {
    key: "public-discovery",
    agent: "magellan",
    title: "Inventory and check state public discovery pages",
    input: { public_discovery_limit: 20 },
  },
  {
    key: "public-cluster",
    agent: "darwin",
    title: "Cluster state public discovery findings",
  },
  {
    key: "public-diagnose",
    agent: "hamilton",
    title: "Summarize state public discovery diagnosis",
  },
];

/**
 * Steps an hourly backlog run takes: search banks that are due a free search and still
 * have no fee link (James, 2026-10-05: free discovery is never held to the monthly
 * cadence), fetch fee links found since their bank's last fetch or last fetched over a
 * month ago (MAGELLAN_STALE_LINK_REFETCH_DAYS), then re-read,
 * re-extract, verify and publish the documents the state already has. Discovery's own
 * backoff (12 hours after a miss that may clear, a month or a quarter after a dead end)
 * keeps a bank from being searched more often than that. The paid find and
 * public-discovery steps stay on the state's full-pass cadence. Knox's paid pass runs
 * hourly too (James, 2026-10-06: close the 297 dense schedules the free team can't
 * read): it picks only dense texts the current free version read poorly and that no paid
 * attempt has read, at most PAID_PASS_ITEMS_PER_RUN a run, so it spends nothing once they
 * are read, and the Knox and global budget caps still stop it. A re-read downloads a
 * document that is not in the vault once per reader version; Knox, Darwin and Hamilton
 * work from stored rows only.
 */
export const STATE_LANE_BACKLOG_STEP_KEYS = ["discover", "fetch", "read", "extract", "extract-paid", "classify", "publish"] as const;
export const STATE_LANE_BACKLOG_STEPS: AgentRunStepDefinition[] = STATE_LANE_STEPS
  .filter((step) => (STATE_LANE_BACKLOG_STEP_KEYS as readonly string[]).includes(step.key))
  .map((step) => (step.key === "fetch" ? { ...step, title: "Fetch new and month-old fee links", input: { ...step.input, new_links_only: true } } : step));

export type StateLaneMode = "full" | "backlog";

/** The lane's steps, with the state's read and extract batch applied. */
export function stateLaneSteps(stateCode: string, mode: StateLaneMode): AgentRunStepDefinition[] {
  const steps = mode === "backlog" ? STATE_LANE_BACKLOG_STEPS : STATE_LANE_STEPS;
  const batch = STATE_LANE_DOCUMENT_BATCH_BY_STATE[stateCode];
  if (!batch) return steps;
  return steps.map((step) => {
    if (step.key === "read") return { ...step, input: { ...step.input, read_limit: batch } };
    if (step.key === "extract") return { ...step, input: { ...step.input, extract_limit: batch } };
    return step;
  });
}

export interface StateLaneStartInput {
  stateCode: string;
  triggeredBy: string;
  triggerSource?: AgentRunTriggerSource;
  source?: "atlas.state_lane_scheduler" | "admin.state_lane";
  limit?: number;
  /** Admin runs only: ask for a quarterly re-check pass. The scheduler decides its own. */
  recheck?: StateLaneRecheck | null;
  /** The scheduler's cadence check, when it already made one. */
  cadence?: StateLaneCadence;
}

export interface StateLaneStartResult extends StartAgentRunResult {
  stateCode: string;
  idempotencyKey: string;
  mode: StateLaneMode;
  recheck: StateLaneRecheck | null;
}

export interface DueStateLaneScheduleResult {
  selected: number;
  scheduled: number;
  reused: number;
  /** Lanes with no full pass due and no backlog: put to sleep until next month. */
  idle: number;
  failed: Array<{ stateCode: string; error: string }>;
  results: Array<{
    stateCode: string;
    runId: number;
    status: string;
    reused: boolean;
    idempotencyKey: string;
  }>;
}

/** Hourly window: one catch-up run per state per hour at most. */
export function hourWindowKey(date = new Date()): string {
  return date.toISOString().slice(0, 13);
}

/** Monthly window (UTC) for the full pass. */
export function monthWindowKey(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

/** Quarterly window (UTC) for the re-check pass, e.g. `2026-Q4`. */
export function quarterWindowKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

/** Start of the next UTC day: when a daily focus lane's next full pass is due. */
export function nextDayStart(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

/** Start of the next UTC calendar month: when an idle lane's next full pass is due. */
export function nextMonthStart(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

/**
 * Idempotency key for a lane run. Keys only dedupe runs that are still active, so the
 * window just has to cover one run: a full pass per state per month, a re-check per
 * quarter, a catch-up pass per hour.
 */
export function laneIdempotencyKey(
  stateCode: string,
  mode: StateLaneMode,
  recheck: StateLaneRecheck | null,
  date = new Date(),
): string {
  if (mode === "backlog") return `atlas:state-lane-backlog:${stateCode}:${hourWindowKey(date)}`;
  if (recheck === "quarterly") return `atlas:state-lane-recheck:${stateCode}:${quarterWindowKey(date)}`;
  return `atlas:state-lane:${stateCode}:${monthWindowKey(date)}`;
}

function boundedLaneLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 2;
  return Math.min(Math.max(Math.floor(parsed), 1), 10);
}

function isMissingStateLaneSchemaError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return message.includes("agent_state_lanes") ||
    message.includes("institution_source_profiles") ||
    message.includes("does not exist") ||
    message.includes("undefined_table");
}

/**
 * True when the state has completed texts Rosetta has not re-read with the current
 * reader, or Knox has not extracted with the current rules, that are still thin (the
 * same tests the read and extract steps select on). False when the attempt log is
 * missing, so a lane never loops on a schema it cannot check.
 */
export async function stateHasDocumentBacklog(stateCode: string): Promise<boolean> {
  try {
    const [row] = await sql<{ backlog: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
          FROM agent_source_texts adt
          JOIN institution_sources inst ON inst.id = adt.institution_id
         WHERE adt.status = 'completed'
           AND adt.char_count > 0
           AND upper(btrim(inst.state_code)) = ${stateCode}
           AND (
             (
               (SELECT COUNT(*) FROM raw_fee_observations fr
                 WHERE fr.source = 'knox'
                   AND fr.source_document_id = adt.source_document_id) < ${KNOX_REEXTRACT_MAX_FEES}
               AND NOT EXISTS (
                 SELECT 1 FROM pipeline_attempts pa
                  WHERE pa.stage = 'extract'
                    AND pa.institution_id = adt.institution_id
                    AND pa.input_fingerprint = adt.text_hash
                    AND pa.strategy = ${KNOX_EXTRACT_STRATEGY.strategy}
                    AND pa.strategy_version = ${KNOX_EXTRACT_STRATEGY.version}
               )
               -- Knox never extracts a text it already extracted under another document id
               -- (selectTextArtifacts). Without this, 1,506 such texts (2026-10-06) kept every
               -- lane awake hourly with nothing to do.
               AND NOT EXISTS (
                 SELECT 1
                   FROM agent_source_texts prior
                   JOIN raw_fee_observations prior_fr
                     ON prior_fr.source = 'knox'
                    AND prior_fr.source_document_id = prior.source_document_id
                  WHERE adt.text_hash IS NOT NULL
                    AND prior.institution_id = adt.institution_id
                    AND prior.text_hash = adt.text_hash
                    AND prior.id <> adt.id
               )
             )
             OR (
               (SELECT COUNT(*) FROM raw_fee_observations fr
                 WHERE fr.source = 'knox'
                   AND fr.source_document_id = adt.source_document_id
                   AND fr.outlier_flags ? 'needs_darwin_verification') < ${REREAD_MAX_KNOX_FEES}
               AND NOT EXISTS (
                 SELECT 1 FROM pipeline_attempts pa
                  WHERE pa.stage = 'read'
                    AND pa.institution_id = adt.institution_id
                    AND pa.input_fingerprint = adt.source_hash
                    AND pa.strategy_version >= ${ROSETTA_READ_VERSION}
               )
             )
           )
      ) OR EXISTS (
        -- A bank with no fee link that is due a free search: never searched, or a miss
        -- that may clear (pending, retry_after) last tried over 12 hours ago. Matches
        -- the first two cases of Magellan's selectCandidates, so a lane never loops on it.
        SELECT 1
          FROM institution_sources inst
          LEFT JOIN institution_source_profiles profile ON profile.institution_id = inst.id
         WHERE upper(btrim(inst.state_code)) = ${stateCode}
           AND COALESCE(inst.status, 'active') = 'active'
           AND NULLIF(btrim(inst.fee_schedule_url), '') IS NULL
           AND NULLIF(btrim(inst.website_url), '') IS NOT NULL
           AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
           AND COALESCE(profile.read_strategy, '') <> 'manual_review'
           AND (
             inst.last_rescue_attempt_at IS NULL
             OR (
               COALESCE(inst.rescue_status, 'pending') IN ('pending', 'retry_after')
               AND inst.last_rescue_attempt_at < NOW() - INTERVAL '12 hours'
             )
           )
      ) OR EXISTS (
        -- A fee link found after the bank's last fetch.
        SELECT 1
          FROM institution_sources inst
         WHERE upper(btrim(inst.state_code)) = ${stateCode}
           AND COALESCE(inst.status, 'active') = 'active'
           AND inst.rescue_status = 'rescued'
           AND inst.fee_schedule_url IS NOT NULL
           AND inst.last_rescue_attempt_at > COALESCE(inst.last_crawl_at, '-infinity'::timestamptz)
      ) OR EXISTS (
        -- A fee link last fetched over a month ago. Matches Magellan's backlog fetch
        -- selection; a fetch, failed or not, stamps last_crawl_at, so a lane never loops on it.
        SELECT 1
          FROM institution_sources inst
          LEFT JOIN institution_source_profiles profile ON profile.institution_id = inst.id
         WHERE upper(btrim(inst.state_code)) = ${stateCode}
           AND COALESCE(inst.status, 'active') = 'active'
           AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
           AND COALESCE(profile.read_strategy, '') <> 'manual_review'
           AND (
             profile.canonical_source_url IS NOT NULL
             OR NULLIF(btrim(inst.fee_schedule_url), '') IS NOT NULL
           )
           AND inst.last_crawl_at < NOW() - make_interval(days => ${MAGELLAN_STALE_LINK_REFETCH_DAYS})
      ) OR EXISTS (
        -- Raw rows Darwin has not decided under the current rules (the rows its
        -- verify step selects), so a large extraction drains hourly, not next month.
        SELECT 1
          FROM raw_fee_observations fr
          JOIN institution_sources inst ON inst.id = fr.institution_id
         WHERE fr.source = 'knox'
           AND fr.outlier_flags ? 'needs_darwin_verification'
           AND upper(btrim(inst.state_code)) = ${stateCode}
           AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
           AND NOT EXISTS (
             SELECT 1 FROM pipeline_attempts pa
              WHERE pa.input_fingerprint = 'raw:' || fr.fee_raw_id::text
                AND pa.strategy = ${DARWIN_VERIFY_STRATEGY.strategy}
                AND pa.strategy_version = ${DARWIN_VERIFY_STRATEGY.version}
           )
      ) AS backlog
    `;
    return Boolean(row?.backlog) || (await stateHasUncheckedLiveFees(stateCode));
  } catch (error) {
    console.error("stateHasDocumentBacklog failed:", error);
    return false;
  }
}

/**
 * Live fees Hamilton has not checked yet: an institution not source-checked since its
 * newest live fee, or a live Knox document not re-checked under today's rules. With a
 * state code, true when that state has any; without one, the states that do.
 */
function uncheckedLiveFeeStates(stateCode: string | null) {
  return sql<{ state_code: string }[]>`
    WITH live AS (
      SELECT fp.institution_id, upper(btrim(inst.state_code)) AS state_code, fr.source,
             fr.source_document_id, fr.outlier_flags, fp.rolled_back_at,
             MAX(fp.fee_published_id) OVER (PARTITION BY fp.institution_id) AS max_fee_id
        FROM published_fee_records fp
        JOIN institution_sources inst ON inst.id = fp.institution_id
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       -- Source-check takedowns count too: the source check re-checks and restores them.
       WHERE (fp.rolled_back_at IS NULL OR fp.rolled_back_reason LIKE ${`${SOURCE_CHECK_REASON}:%`})
         AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode}::text)
    )
    SELECT DISTINCT live.state_code
      FROM live
     WHERE NOT EXISTS (
             SELECT 1 FROM pipeline_attempts pa
              WHERE pa.input_fingerprint = 'v' || ${SOURCE_CHECK_STRATEGY.version}::text || ':' || live.max_fee_id::text
                AND pa.strategy = ${SOURCE_CHECK_STRATEGY.strategy}
                AND pa.institution_id = live.institution_id
           )
        OR (
          live.rolled_back_at IS NULL
          AND live.source = 'knox'
          AND live.source_document_id IS NOT NULL
          AND NOT (COALESCE(live.outlier_flags, '[]'::jsonb) ? 'knox_paid_extraction')
          AND NOT EXISTS (
            SELECT 1 FROM pipeline_attempts pa
             WHERE pa.input_fingerprint = ${knoxFreeSignature()}
               AND pa.strategy = ${RULES_RECHECK_STRATEGY.strategy}
               AND pa.strategy_version = ${RULES_RECHECK_STRATEGY.version}
               AND pa.institution_id = live.institution_id
               AND pa.source_document_id = live.source_document_id
          )
        )
     ${stateCode ? sql`LIMIT 1` : sql``}
  `;
}

export async function stateHasUncheckedLiveFees(stateCode: string): Promise<boolean> {
  try {
    return (await uncheckedLiveFeeStates(stateCode)).length > 0;
  } catch (error) {
    console.error("stateHasUncheckedLiveFees failed:", error);
    return false;
  }
}

/**
 * A rules fix or a new source rule must reach every live fee within hours, not at each
 * state's next monthly pass: wake sleeping lanes whose state has live fees Hamilton has
 * not checked, so their hourly backlog passes run the checks in small batches.
 */
export async function wakeLanesWithUncheckedLiveFees(): Promise<number> {
  try {
    const states = (await uncheckedLiveFeeStates(null)).map((row) => String(row.state_code));
    if (states.length === 0) return 0;
    const woken = await sql`
      UPDATE public.agent_state_lanes
         SET next_run_after = NOW(),
             updated_at = NOW()
       WHERE state_code = ANY(${states}::text[])
         AND next_run_after > NOW() + ${STATE_LANE_BACKLOG_RETRY_MINUTES} * INTERVAL '1 minute'
    `;
    return woken.count;
  } catch (error) {
    console.error("wakeLanesWithUncheckedLiveFees failed:", error);
    return 0;
  }
}

/**
 * A bank with no fee link that a search can still find: it has a website, is not marked
 * offline or manual-review, and its last search was not a dead end. Needs `inst`
 * (institution_sources) and `profile` (institution_source_profiles, LEFT JOIN).
 */
function findableBankSql() {
  return sql`
    NULLIF(btrim(inst.website_url), '') IS NOT NULL
    AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
    AND COALESCE(profile.read_strategy, '') <> 'manual_review'
    AND COALESCE(inst.rescue_status, 'pending') NOT IN ('dead', 'needs_human')
  `;
}

/** A due lane overdue by this long goes before every higher-priority lane, so no state starves. */
export const STATE_LANE_STARVATION_HOURS = 3;

/**
 * Schedule by where the work is (James, 2026-10-06). Each lane's priority_score is the
 * number of banks in its state with open work or a recent error: banks due a search,
 * fee links not fetched for MAGELLAN_STALE_LINK_REFETCH_DAYS, banks whose newest live fee
 * Hamilton has not source-checked, and banks with a source-check takedown in the last 7
 * days. Due lanes run highest score first (see scheduleDueStateLaneRuns). Deterministic
 * SQL, refreshed with the hourly nationwide sync. Returns the lanes updated.
 *
 * Report demand goes first (coordinator, 2026-10-06, from the funnel audit): a state with
 * an unpaid institution report request from the last REPORT_REQUEST_DAYS whose institution
 * fails James's report rule gets REPORT_REQUEST_PRIORITY, and a state whose bank market is
 * within NEAR_READY_GAP rich banks of ready gets NEAR_READY_BANK_PRIORITY plus 10 per rich
 * bank, so the closest market runs first. This only moves when a state runs; what the
 * state's steps then work on is unchanged.
 */
export const REPORT_REQUEST_DAYS = 30;
export const REPORT_REQUEST_PRIORITY = 2000;
export const NEAR_READY_GAP = 6;
export const NEAR_READY_BANK_PRIORITY = 2000;

export async function refreshLanePriorities(): Promise<number> {
  try {
    // postgres.js sends numbers untyped, so every number here carries a cast: an uncast
    // "${a} - ${b}" fails to plan ("operator is not unique: unknown - unknown").
    const updated = await sql`
      WITH due_search AS (
        SELECT upper(btrim(inst.state_code)) AS state_code, count(*)::int AS banks
          FROM public.institution_sources inst
          LEFT JOIN public.institution_source_profiles profile ON profile.institution_id = inst.id
         WHERE COALESCE(inst.status, 'active') = 'active'
           AND NULLIF(btrim(inst.fee_schedule_url), '') IS NULL
           AND ${findableBankSql()}
           AND (
             inst.last_rescue_attempt_at IS NULL
             OR inst.last_rescue_attempt_at < NOW() - INTERVAL '12 hours'
           )
         GROUP BY 1
      ),
      stale AS (
        SELECT upper(btrim(inst.state_code)) AS state_code, count(*)::int AS banks
          FROM public.institution_sources inst
         WHERE COALESCE(inst.status, 'active') = 'active'
           AND NULLIF(btrim(inst.fee_schedule_url), '') IS NOT NULL
           AND inst.last_crawl_at < NOW() - ${MAGELLAN_STALE_LINK_REFETCH_DAYS}::int * INTERVAL '1 day'
         GROUP BY 1
      ),
      newest AS (
        SELECT fp.institution_id, MAX(fp.fee_published_id) AS max_id
          FROM public.published_fee_records fp
         WHERE fp.rolled_back_at IS NULL
            OR fp.rolled_back_reason LIKE ${`${SOURCE_CHECK_REASON}:%`}
         GROUP BY fp.institution_id
      ),
      unchecked AS (
        SELECT upper(btrim(inst.state_code)) AS state_code, count(*)::int AS banks
          FROM newest
          JOIN public.institution_sources inst ON inst.id = newest.institution_id
         WHERE NOT EXISTS (
           SELECT 1 FROM public.pipeline_attempts pa
            WHERE pa.strategy = ${SOURCE_CHECK_STRATEGY.strategy}
              AND pa.institution_id = newest.institution_id
              AND pa.input_fingerprint = 'v' || ${SOURCE_CHECK_STRATEGY.version}::text || ':' || newest.max_id::text
         )
         GROUP BY 1
      ),
      takedowns AS (
        SELECT upper(btrim(inst.state_code)) AS state_code, count(DISTINCT fp.institution_id)::int AS banks
          FROM public.published_fee_records fp
          JOIN public.institution_sources inst ON inst.id = fp.institution_id
         WHERE fp.rolled_back_at > NOW() - INTERVAL '7 days'
           AND fp.rolled_back_reason LIKE ${`${SOURCE_CHECK_REASON}:%`}
         GROUP BY 1
      ),
      coverage AS (
        -- Headline categories live per institution: the count market-readiness.ts uses.
        SELECT institution_id, COUNT(DISTINCT canonical_fee_key)::int AS categories
          FROM public.published_fee_catalog
         WHERE canonical_fee_key = ANY(${[...HEADLINE_FEE_KEYS]}::text[])
         GROUP BY institution_id
      ),
      market AS (
        SELECT upper(btrim(inst.state_code)) AS state_code, inst.charter_type,
               count(*) FILTER (WHERE coverage.categories >= ${RICH_MIN_CATEGORIES}::int)::int AS rich
          FROM public.institution_sources inst
          LEFT JOIN coverage ON coverage.institution_id = inst.id
         WHERE inst.state_code IS NOT NULL AND inst.charter_type IS NOT NULL
         GROUP BY 1, 2
      ),
      near_ready AS (
        SELECT state_code, max(rich) AS rich
          FROM market
         WHERE charter_type = 'bank'
           AND rich < ${MARKET_READY_MIN_RICH}::int
           AND rich >= ${MARKET_READY_MIN_RICH}::int - ${NEAR_READY_GAP}::int
         GROUP BY 1
      ),
      requested AS (
        -- Report requests carry the institution in use_case ("institution_id=117"); the
        -- request counts while unpaid and the institution or its market fails the rule.
        SELECT DISTINCT upper(btrim(inst.state_code)) AS state_code
          FROM public.leads lead
          JOIN public.institution_sources inst
            ON inst.id = (substring(lead.use_case FROM 'institution_id=([0-9]+)'))::bigint
          LEFT JOIN coverage ON coverage.institution_id = inst.id
          LEFT JOIN market ON market.state_code = upper(btrim(inst.state_code))
                          AND market.charter_type = inst.charter_type
         WHERE 'report' = ANY(string_to_array(lead.source, ','))
           AND lead.created_at > NOW() - ${REPORT_REQUEST_DAYS}::int * INTERVAL '1 day'
           AND lead.paid_at IS NULL
           AND position('src=e2e-test' IN COALESCE(lead.use_case, '')) = 0
           AND (COALESCE(coverage.categories, 0) < ${RICH_MIN_CATEGORIES}::int
                OR COALESCE(market.rich, 0) < ${MARKET_READY_MIN_RICH}::int)
      ),
      score AS (
        SELECT lane.state_code,
               COALESCE(due_search.banks, 0) + COALESCE(stale.banks, 0)
                 + COALESCE(unchecked.banks, 0) + COALESCE(takedowns.banks, 0)
                 + CASE WHEN requested.state_code IS NOT NULL THEN ${REPORT_REQUEST_PRIORITY}::int ELSE 0 END
                 + CASE WHEN near_ready.state_code IS NOT NULL
                        THEN ${NEAR_READY_BANK_PRIORITY}::int + 10 * near_ready.rich ELSE 0 END AS priority
          FROM public.agent_state_lanes lane
          LEFT JOIN due_search ON due_search.state_code = lane.state_code
          LEFT JOIN stale ON stale.state_code = lane.state_code
          LEFT JOIN unchecked ON unchecked.state_code = lane.state_code
          LEFT JOIN takedowns ON takedowns.state_code = lane.state_code
          LEFT JOIN requested ON requested.state_code = lane.state_code
          LEFT JOIN near_ready ON near_ready.state_code = lane.state_code
      )
      UPDATE public.agent_state_lanes lane
         SET priority_score = score.priority,
             updated_at = NOW()
        FROM score
       WHERE lane.state_code = score.state_code
         AND lane.priority_score IS DISTINCT FROM score.priority
    `;
    return updated.count;
  } catch (error) {
    console.error("refreshLanePriorities failed:", error);
    return 0;
  }
}

export interface StateLaneCadence {
  /** No full pass started (and not failed) this UTC calendar month. */
  fullDue: boolean;
  /** No quarterly re-check pass started (and not failed) this UTC calendar quarter. */
  recheckDue: boolean;
  /** Focus state still missing many links: full passes are due daily, not monthly. */
  daily: boolean;
}

/**
 * Which passes a state is due. A full pass (with the state-expert step) that is queued,
 * running or completed this month counts; a failed or cancelled one does not, so the lane tries again. When the
 * check fails the lane takes a full pass (no re-check), the safe default.
 */
export async function stateLaneCadence(stateCode: string): Promise<StateLaneCadence> {
  try {
    const [row] = await sql<{
      full_this_month: boolean;
      full_today: boolean;
      recheck_this_quarter: boolean;
      missing_links: number;
      paid_find_due: number;
      website_find_due: number;
    }[]>`
      SELECT
        EXISTS (
          SELECT 1 FROM public.agent_runs run
           WHERE run.run_kind = 'workflow_lane'
             AND upper(btrim(run.state_code)) = ${stateCode}
             AND COALESCE(run.params_json->>'lane_mode', 'full') = 'full'
             AND run.status IN ('queued', 'running', 'cancel_requested', 'completed')
             AND run.started_at >= date_trunc('month', NOW(), 'UTC')
             -- Only a pass with the state-expert step counts: October 2026's passes ran
             -- before it existed, so discovery and state memory would wait for November.
             AND EXISTS (
               SELECT 1 FROM public.agent_run_steps step
                WHERE step.agent_run_id = run.id AND step.step_key = 'state-expert'
             )
        ) AS full_this_month,
        EXISTS (
          SELECT 1 FROM public.agent_runs run
           WHERE run.run_kind = 'workflow_lane'
             AND upper(btrim(run.state_code)) = ${stateCode}
             AND COALESCE(run.params_json->>'lane_mode', 'full') = 'full'
             AND run.status IN ('queued', 'running', 'cancel_requested', 'completed')
             AND run.started_at >= date_trunc('day', NOW(), 'UTC')
        ) AS full_today,
        (
          SELECT count(*)::int FROM public.institution_sources inst
            LEFT JOIN public.institution_source_profiles profile ON profile.institution_id = inst.id
           WHERE upper(btrim(inst.state_code)) = ${stateCode}
             AND COALESCE(inst.status, 'active') = 'active'
             AND NULLIF(btrim(inst.fee_schedule_url), '') IS NULL
             AND ${findableBankSql()}
        ) AS missing_links,
        -- Mirrors magellan/paid-find.ts selectBanks: dead-end banks the paid pick or paid
        -- web search has not tried this month after every free finder ran.
        (
          SELECT count(*)::int FROM public.institution_sources inst
            LEFT JOIN public.institution_source_profiles profile ON profile.institution_id = inst.id
           WHERE upper(btrim(inst.state_code)) = ${stateCode}
             AND COALESCE(inst.status, 'active') = 'active'
             AND NULLIF(btrim(inst.fee_schedule_url), '') IS NULL
             AND NULLIF(btrim(inst.website_url), '') IS NOT NULL
             AND inst.rescue_status = 'dead'
             AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
             AND COALESCE(profile.read_strategy, '') <> 'manual_review'
             AND COALESCE(profile.locked_by_correction, false) = false
             AND EXISTS (
               SELECT 1 FROM public.pipeline_attempts pa
                WHERE pa.institution_id = inst.id
                  AND pa.stage = 'discover'
                  AND pa.detail @> ${JSON.stringify({ method_version: DISCOVERY_METHOD_VERSION })}::jsonb
             )
             AND (
               SELECT count(DISTINCT pa.strategy) FROM public.pipeline_attempts pa
                WHERE pa.institution_id = inst.id
                  AND pa.stage = 'discover'
                  AND pa.strategy IN (${PAID_PICK_STRATEGY.strategy}, ${PAID_FIND_STRATEGY.strategy})
                  AND pa.created_at >= date_trunc('month', NOW())
                  AND pa.outcome <> ALL(${TRANSIENT_PAID_OUTCOMES}::text[])
             ) < 2
        ) AS paid_find_due,
        -- Mirrors magellan/website-find.ts selectRows: institutions with no website the
        -- website search has not tried this month.
        (
          SELECT count(*)::int FROM public.institution_sources inst
            LEFT JOIN public.institution_source_profiles profile ON profile.institution_id = inst.id
           WHERE upper(btrim(inst.state_code)) = ${stateCode}
             AND COALESCE(inst.status, 'active') = 'active'
             AND NULLIF(btrim(inst.fee_schedule_url), '') IS NULL
             AND NULLIF(btrim(inst.website_url), '') IS NULL
             AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
             AND COALESCE(profile.locked_by_correction, false) = false
             AND NOT EXISTS (
               SELECT 1 FROM public.pipeline_attempts pa
                WHERE pa.institution_id = inst.id
                  AND pa.stage = 'discover'
                  AND pa.strategy = ${WEBSITE_FIND_STRATEGY.strategy}
                  AND pa.created_at >= date_trunc('month', NOW())
                  AND pa.outcome <> ALL(${TRANSIENT_PAID_OUTCOMES}::text[])
             )
        ) AS website_find_due,
        EXISTS (
          SELECT 1 FROM public.agent_runs run
           WHERE run.run_kind = 'workflow_lane'
             AND upper(btrim(run.state_code)) = ${stateCode}
             AND COALESCE(run.params_json->>'lane_mode', 'full') = 'full'
             AND run.params_json->>'recheck' = 'quarterly'
             AND run.status IN ('queued', 'running', 'cancel_requested', 'completed')
             AND run.started_at >= date_trunc('quarter', NOW(), 'UTC')
        ) AS recheck_this_quarter
    `;
    const daily = Number(row?.missing_links ?? 0) > DAILY_FULL_PASS_MISSING_LINKS
      || Number(row?.paid_find_due ?? 0) > 0
      || Number(row?.website_find_due ?? 0) > 0;
    return {
      fullDue: daily ? !row?.full_today : !row?.full_this_month,
      recheckDue: !row?.recheck_this_quarter,
      daily,
    };
  } catch (error) {
    console.error("stateLaneCadence failed:", error);
    return { fullDue: true, recheckDue: false, daily: false };
  }
}

function nextFullPassAt(daily: boolean): string {
  return (daily ? nextDayStart() : nextMonthStart()).toISOString();
}

async function markLaneScheduled(
  stateCode: string,
  runId: number,
  backlog: boolean,
  daily: boolean,
): Promise<void> {
  await sql`
    UPDATE public.agent_state_lanes
       SET last_agent_run_id = ${runId},
           last_run_at = NOW(),
           next_run_after = CASE
             WHEN ${backlog} THEN NOW() + ${STATE_LANE_BACKLOG_RETRY_MINUTES} * INTERVAL '1 minute'
             ELSE LEAST(${nextFullPassAt(daily)}::timestamptz, NOW() + ${STATE_LANE_IDLE_RECHECK_HOURS} * INTERVAL '1 hour')
           END,
           lease_token = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
     WHERE state_code = ${stateCode}
  `;
}

/**
 * Nothing due and no backlog: the lane sleeps until its next full pass (next month, or
 * tomorrow for a daily state), or at most STATE_LANE_IDLE_RECHECK_HOURS.
 */
async function markLaneIdle(stateCode: string, daily: boolean): Promise<void> {
  await sql`
    UPDATE public.agent_state_lanes
       SET next_run_after = LEAST(${nextFullPassAt(daily)}::timestamptz, NOW() + ${STATE_LANE_IDLE_RECHECK_HOURS} * INTERVAL '1 hour'),
           lease_token = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
     WHERE state_code = ${stateCode}
  `;
}

async function markLaneLaunchBlocked(stateCode: string, runId: number): Promise<void> {
  await sql`
    UPDATE public.agent_state_lanes
       SET last_agent_run_id = ${runId},
           next_run_after = NOW() + INTERVAL '30 minutes',
           lease_token = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
     WHERE state_code = ${stateCode}
  `;
}

async function markLaneScheduleFailure(stateCode: string): Promise<void> {
  await sql`
    UPDATE public.agent_state_lanes
       SET failure_count = failure_count + 1,
           next_run_after = NOW() + INTERVAL '1 hour',
           lease_token = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
     WHERE state_code = ${stateCode}
  `;
}

export async function startStateLaneRun(
  input: StateLaneStartInput,
): Promise<StateLaneStartResult> {
  const stateCode = normalizeStateCode(input.stateCode);
  if (!stateCode) throw new Error("Invalid state code for state lane run");

  await syncStateLaneProfiles(sql, stateCode);
  // Only the scheduler starts backlog runs; a run an admin starts always crawls.
  const source = input.source ?? "atlas.state_lane_scheduler";
  const scheduled = source === "atlas.state_lane_scheduler";
  const cadence = scheduled ? input.cadence ?? (await stateLaneCadence(stateCode)) : null;
  const mode: StateLaneMode = cadence && !cadence.fullDue ? "backlog" : "full";
  const recheck: StateLaneRecheck | null = mode !== "full"
    ? null
    : cadence
      ? (cadence.recheckDue ? "quarterly" : null)
      : (input.recheck === "quarterly" ? "quarterly" : null);
  const idempotencyKey = laneIdempotencyKey(stateCode, mode, recheck);
  const parsedLimit = Number(input.limit);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(Math.floor(parsedLimit), 1), 500)
    : undefined;
  const result = await startAgentRun({
    agent: "atlas",
    kind: "workflow_lane",
    title: mode === "backlog"
      ? `Atlas ${stateCode} state lane backlog pass`
      : recheck
        ? `Atlas ${stateCode} state lane (quarterly re-check)`
        : `Atlas ${stateCode} state lane`,
    stateCode,
    params: {
      scope: "state",
      state_code: stateCode,
      limit,
      source,
      lane_mode: mode,
      ...(recheck ? { recheck } : {}),
      ...(mode === "full" ? FOCUS_STATE_LANE_PARAMS[stateCode] ?? {} : {}),
    },
    triggeredBy: input.triggeredBy,
    triggerSource: input.triggerSource ?? "schedule",
    idempotencyKey,
    steps: stateLaneSteps(stateCode, mode),
    summary: mode === "backlog"
      ? `Atlas backlog pass accepted for ${stateCode}: re-read, re-extract, verify and publish stored documents only. Discovery and fetch wait for the next full lane run.`
      : `Atlas state lane accepted for ${stateCode}${recheck ? " as the quarterly re-check: discovery re-validates every link and re-searches dead and needs-human banks" : ""}. All worker selectors are scoped to institution_sources.state_code.`,
  });
  if (result.run.status === "blocked") {
    await markLaneLaunchBlocked(stateCode, result.run.id);
  } else {
    await markLaneScheduled(
      stateCode,
      result.run.id,
      await stateHasDocumentBacklog(stateCode),
      cadence?.daily ?? false,
    );
  }
  return { ...result, stateCode, idempotencyKey, mode, recheck };
}

/**
 * The nationwide profile and lane sync scans every institution, which takes close to a
 * minute on the production database, so the 5-minute tick runs it only on the first
 * tick of each hour. Each lane still syncs its own state when it is launched and in its
 * enhance step.
 */
export function shouldRunNationwideLaneSync(now: Date = new Date()): boolean {
  return now.getUTCMinutes() < 5;
}

/** State lanes launched per 5-minute tick (36 an hour). Raised from 2 on 2026-10-06 after load checks. */
export const STATE_LANE_LIMIT_PER_TICK = 3;

/**
 * Lane runs allowed queued or running at once. The executor runs one step at a time and
 * finishes about six full passes an hour, so launching 3 lanes every tick (36 an hour)
 * left ~40 runs queued in launch order with a 1h40m wait, and the priority order never
 * applied (2026-10-07). With a short queue, each free slot goes to the highest-priority
 * due lane when it opens.
 */
export const MAX_ACTIVE_STATE_LANE_RUNS = 3;

export async function scheduleDueStateLaneRuns({
  limit = STATE_LANE_LIMIT_PER_TICK,
  triggeredBy = "atlas.scheduler",
  now = new Date(),
}: {
  limit?: number;
  triggeredBy?: string;
  now?: Date;
} = {}): Promise<DueStateLaneScheduleResult> {
  const safeLimit = boundedLaneLimit(limit);
  if (shouldRunNationwideLaneSync(now)) {
    await syncStateLaneProfiles(sql);
    await wakeLanesWithUncheckedLiveFees();
    await refreshLanePriorities();
  }

  const emptyResult: DueStateLaneScheduleResult = {
    selected: 0,
    scheduled: 0,
    reused: 0,
    idle: 0,
    failed: [],
    results: [],
  };
  let dueRows: Array<{ state_code: string }>;
  try {
    const [active] = await sql<{ runs: number }[]>`
      SELECT count(*)::int AS runs
        FROM public.agent_runs
       WHERE run_kind = 'workflow_lane'
         AND status IN ('queued', 'running', 'cancel_requested')
    `;
    const slots = Math.min(safeLimit, MAX_ACTIVE_STATE_LANE_RUNS - Number(active?.runs ?? 0));
    if (slots <= 0) return emptyResult;
    dueRows = await withTransaction(async (tx) => tx<{ state_code: string }[]>`
      WITH due AS (
        SELECT state_code
          FROM public.agent_state_lanes
         WHERE next_run_after <= NOW()
           AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
           -- One run per state at a time: a backlog lane waits for its previous run.
           AND NOT EXISTS (
             SELECT 1 FROM public.agent_runs active
              WHERE active.id = agent_state_lanes.last_agent_run_id
                AND active.status IN ('queued', 'running', 'cancel_requested')
           )
         -- Most open work first; a lane overdue STATE_LANE_STARVATION_HOURS goes ahead of all.
         ORDER BY (next_run_after < NOW() - ${STATE_LANE_STARVATION_HOURS} * INTERVAL '1 hour') DESC,
                  priority_score DESC, next_run_after ASC, state_code ASC
         LIMIT ${slots}
         FOR UPDATE SKIP LOCKED
      )
      UPDATE public.agent_state_lanes lane
         SET lease_token = gen_random_uuid(),
             lease_expires_at = NOW() + INTERVAL '15 minutes',
             updated_at = NOW()
        FROM due
       WHERE lane.state_code = due.state_code
      RETURNING lane.state_code
    `);
  } catch (error) {
    if (isMissingStateLaneSchemaError(error)) return emptyResult;
    throw error;
  }

  const output: DueStateLaneScheduleResult = {
    selected: dueRows.length,
    scheduled: 0,
    reused: 0,
    idle: 0,
    failed: [],
    results: [],
  };

  for (const row of dueRows) {
    const stateCode = String(row.state_code);
    try {
      const cadence = await stateLaneCadence(stateCode);
      if (!cadence.fullDue && !(await stateHasDocumentBacklog(stateCode))) {
        await markLaneIdle(stateCode, cadence.daily);
        output.idle += 1;
        continue;
      }
      const result = await startStateLaneRun({
        stateCode,
        triggeredBy,
        triggerSource: "schedule",
        source: "atlas.state_lane_scheduler",
        cadence,
      });
      output.scheduled += 1;
      if (result.reused) output.reused += 1;
      output.results.push({
        stateCode,
        runId: result.run.id,
        status: result.run.status,
        reused: result.reused,
        idempotencyKey: result.idempotencyKey,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.failed.push({ stateCode, error: message });
      await markLaneScheduleFailure(stateCode);
    }
  }

  return output;
}
