import { sql } from "@/lib/data-store/connection";
import { loadMarketLeaderIds } from "@/lib/data-store/market-leaders";
import { currentDeploy, startAgentRun } from "@/lib/agents/run-store";
import type { AgentRunStepDefinition } from "@/lib/agents/types";
import { DARWIN_VERIFY_MAX_LIMIT } from "@/lib/agents/darwin/verify";
import { HAMILTON_PUBLISH_MAX_LIMIT } from "@/lib/agents/hamilton/publish";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";

type SqlTag = typeof sql;

/**
 * The direct path for institutions that must not wait on their state's lane (James,
 * 2026-10-07: "A lot idle"; Chase and Citi first). Each gets its own run that fetches,
 * reads, extracts, verifies and publishes that one institution, so a schedule found by
 * hand goes live within a tick or two instead of after its state's next pass. Only free
 * steps run: the paid steps take a whole state, never one institution.
 *
 * The executor (`executeQueuedAgentRuns`) runs these right after runs already under way.
 */
export const PRIORITY_INSTITUTION_SOURCE = "atlas.priority_institution";
/** Priority runs queued or running at once; the rest wait for the next tick. */
export const PRIORITY_MAX_ACTIVE = 2;
/** A requested or hand-found institution runs again at most this often. */
export const PRIORITY_RETRY_HOURS = 24;
/** A large bank or market leader with no live overdraft fee runs again at most this often. */
export const PRIORITY_GAP_RETRY_DAYS = 7;
/**
 * A large bank or market leader with no live overdraft fee whose current page Knox's
 * current rules version has not read runs again after this many hours, inside the 7-day
 * window: a rules fix otherwise waited for the state's lane (2026-10-09: v57 reads Arvest's
 * $17 overdraft row, but 34 of the 35 $10B+ banks with no live overdraft fee sat in the
 * 7-day hold while AR and IN queued behind 8 and 30 starved lanes).
 */
export const PRIORITY_RULES_REREAD_HOURS = 6;
/**
 * A failure shared by at least this many runs in 24 hours is a break in our code, the
 * same bar as wakeLanesAfterRecovery. A priority run that failed on such a break, with no
 * failure of that step and reason since the current deploy went live, is presumed fixed
 * and does not hold its institution for the retry window: Tennessee's largest bank
 * (2877) failed on the 12:06 Oct 8 publish break and waited a full day after the 12:36 fix.
 */
export const PRIORITY_FIXED_BREAK_RUNS = 3;
/** $10B in assets; `asset_size` is in thousands. */
export const PRIORITY_MIN_ASSETS_THOUSANDS = 10_000_000;

export interface PriorityInstitutionRequest {
  institutionId: number;
  institutionName: string;
  reason: string;
}

const REPORT_GAP_MISREAD = "report-ready gap: schedule on file but fees misread (funnel/report-rule-gaps-2026-10-07.md)";

/**
 * Institutions a person asked to have read now. Names are prod's, for review only; the id
 * is what counts. An institution leaves the direct path on its own once it has run.
 */
export const PRIORITY_INSTITUTION_REQUESTS: readonly PriorityInstitutionRequest[] = [
  // $10B+ banks whose current page Knox v57 reads correctly (Arvest's $17 overdraft row, Old
  // National's monthly fee names), still unread at v57 while AR and IN lanes queue (2026-10-09).
  ...([
    [78, "Arvest Bank"],
    [41, "Old National Bank"],
  ] as const).map(([institutionId, institutionName]) => ({
    institutionId,
    institutionName,
    reason: "Knox v57 reads this bank's current page; its state lane is queued",
  })),
  // $10B+ banks Knox v62 reads differently: Northern Trust's wrapped $25 overdraft line, and the
  // 15 wrong live rows at Citizens Business Bank and ConnectOne (former-price column, business-only
  // footnote) that the rules re-check takes down once their run reads v62 (2026-10-09).
  ...([
    [25, "The Northern Trust Company"],
    [124, "Citizens Business Bank, National Association"],
    [135, "ConnectOne Bank"],
  ] as const).map(([institutionId, institutionName]) => ({
    institutionId,
    institutionName,
    reason: "Knox v62 reads this bank's current page; its state lane is queued",
  })),
  // Marketing's outreach batch (2026-10-08 18:20), first: each has 5+ local competitors with a
  // sourced overdraft fee, and its own current page prints an overdraft line Knox v42 reads.
  ...([
    [1223, "BankIowa"],
    [767, "Saco & Biddeford Savings Institution"],
    [4715, "Bluestone Federal Credit Union"],
    [8085, "Quantum Federal Credit Union"],
    [4522, "Los Angeles Federal Credit Union"],
    [3331, "The First State Bank of Rosemount"],
    [4779, "National Institutes Of Health Federal Credit Union"],
    // Wyoming top-10 bank: one $32 price for the paid and the returned item (Knox v43).
    [850, "Pinnacle Bank - Wyoming"],
    // State leaders whose pages print an overdraft line v35-v40 read, last read at v27-v36; their
    // state lanes sit queued, so a read-now run reads them sooner (2026-10-08 18:55).
    [400, "MVB Bank, Inc"],
    [599, "Starion Bank"],
    [348, "Stride Bank, National Association"],
    [424, "Guaranty Bank and Trust Company"],
    [7034, "Lighthouse Federal Credit Union"],
    [5579, "Arkansas Federal Credit Union"],
  ] as const).map(([institutionId, institutionName]) => ({
    institutionId,
    institutionName,
    reason: "Marketing outreach: market report needs this institution's overdraft fee",
  })),
  // Tennessee report (2026-10-07 06:50): 6 of the 7 largest TN deposit holders had no live
  // overdraft fee, so only 26% of TN branch deposits had one.
  ...([
    [37, "First Horizon Bank"],
    [47, "Pinnacle Bank"],
    [27, "Regions Bank"],
    [122, "FirstBank"],
    [5, "U.S. Bank National Association"],
    [251, "Wilson Bank and Trust"],
  ] as const).map(([institutionId, institutionName]) => ({
    institutionId,
    institutionName,
    reason: "Tennessee report: largest deposit holder with no live overdraft fee",
  })),
  {
    institutionId: 393,
    institutionName: "ACNB Bank",
    reason: "Adams County, PA market study: 61% of county deposits, no fee schedule on file",
  },
  // Tennessee report (2026-10-07 07:30): three more TN deposit leaders with no verified overdraft fee.
  ...([
    [19, "Fifth Third Bank, National Association"],
    [371, "SouthEast Bank"],
    [255, "SmartBank"],
  ] as const).map(([institutionId, institutionName]) => ({
    institutionId,
    institutionName,
    reason: "Tennessee report: deposit leader with no verified overdraft fee",
  })),
  { institutionId: 8109, institutionName: "Space Coast Federal Credit Union", reason: "Hamilton answer had only 5 fees; full schedule needed" },
  // Knox v63 reads its safe deposit box sizes off the return item line (doc 20570); its last read
  // was v33 and it has a live overdraft fee, so no re-read path reached it (2026-10-09).
  { institutionId: 8414, institutionName: "Peak Federal Credit Union", reason: "Knox v63 reads this credit union's current page; its last read was v33" },
  ...([
    [51, "First National Bank of Pennsylvania"],
    [156, "Amarillo National Bank"],
    [243, "Five Star Bank"],
    [278, "Alerus Financial, National Association"],
    [337, "Spencer Savings Bank, SLA"],
    [433, "NEXTIER BANK, NATIONAL ASSOCIATION"],
    [528, "Texas First Bank"],
    [563, "Think Mutual Bank"],
    [565, "Opportunity Bank of Montana"],
    [641, "FirstBank Southwest"],
    [724, "Community Bank"],
    [749, "CorTrust Bank National Association"],
    [757, "Pathfinder Bank"],
    [927, "Liberty Savings Bank, F.S.B."],
    [1037, "First Federal Savings and Loan Association of Greene Co"],
    [1068, "First National Bank and Trust Company of Weatherford"],
    [1104, "Colonial Savings, F.A."],
    [1195, "Mechanics Bank"],
    [1200, "Titan Bank, N.A."],
    [1411, "American State Bank"],
    [1680, "Coulee Bank"],
    [1718, "Cross County Savings Bank"],
    [1779, "The St. Henry Bank"],
    [1784, "Merchants Commercial Bank"],
    [1841, "Fulton Savings Bank"],
    [2279, "Farmers & Merchants Bank"],
    [2334, "Bank of Montana"],
    [2580, "Security First Bank of North Dakota"],
    [2606, "Cayuga Lake National Bank"],
    [2756, "BANKWEST"],
    [3005, "Gouverneur Savings and Loan Association"],
    [3262, "Bank of South Texas"],
    [5058, "Trunorth Federal Credit Union"],
    [5998, "Explorers Federal Credit Union"],
    [6358, "Minnesota Valley Federal Credit Union"],
    [6775, "St. Paul Federal Credit Union"],
    [6788, "Building Trades Federal Credit Union"],
    [7096, "City & County Federal Credit Union"],
    [7503, "Northwoods Federal Credit Union"],
    [8078, "Superior Choice Federal Credit Union"],
  ] as const).map(([institutionId, institutionName]) => ({ institutionId, institutionName, reason: REPORT_GAP_MISREAD })),
];

export type PriorityTier = "hand_found" | "paid_fetched" | "requested" | "overdraft_gap";
/** A document the paid fetch stored this long ago or less, still unread, gets a direct run. */
export const PAID_FETCH_READ_DAYS = 7;

export interface PriorityInstitutionRow {
  id: number;
  institution_name: string;
  state_code: string | null;
  tier: PriorityTier;
  /** Newest unfetched hand-found link (tier hand_found only); keys the run so a link added later the same day still runs. */
  hand_link_id: number | null;
  /** Newest unread document the paid fetch stored (tier paid_fetched only); keys the run the same way. */
  paid_document_id: number | null;
  /** Knox rules version the bank's current page has not been read by (tiers overdraft_gap and requested); keys the run. */
  rules_version: number | null;
}

/**
 * Institutions due for a direct run, best first:
 *  1. a fee schedule found by hand (Magellan's operator list) not yet fetched;
 *  2. a document Magellan's paid fetch, or a hand-found schedule fetched in another
 *     state's lane, stored that no reader has read yet: the paid step
 *     fetches blocked links for banks in every state, and the read step of a state run reads
 *     only that state, so Citizens' and Fifth Third's documents (7 Oct 2026) waited for their
 *     own state's lane;
 *  3. an institution on PRIORITY_INSTITUTION_REQUESTS;
 *  4. a $10B+ institution or state market leader with a fee link but no live overdraft fee;
 *     it waits PRIORITY_GAP_RETRY_DAYS between runs, or PRIORITY_RULES_REREAD_HOURS when
 *     Knox's current rules version has not read its current page.
 * Requests run in list order; otherwise larger institutions first within a tier. An institution with a priority run in flight,
 * or one started inside its retry window, is skipped, unless a hand-found link was added after that run started.
 */
export async function selectPriorityInstitutions(
  db: SqlTag,
  options: { limit: number; leaderIds: readonly number[]; deploy?: string | null },
): Promise<PriorityInstitutionRow[]> {
  const limit = Math.max(0, Math.floor(options.limit));
  const deploy = options.deploy === undefined ? currentDeploy() : options.deploy;
  if (limit === 0) return [];
  const requested = PRIORITY_INSTITUTION_REQUESTS.map((request) => request.institutionId);
  const leaders = [...options.leaderIds].map(Number);
  const rows = await db<
    Array<{
      id: number | string;
      institution_name: string;
      state_code: string | null;
      tier: number | string;
      hand_link_id: number | string | null;
      paid_document_id: number | string | null;
      rules_unread?: boolean | null;
    }>
  >`
    WITH candidates AS (
      SELECT inst.id, inst.institution_name, inst.state_code, inst.asset_size,
             hand_new.hand_link_id, hand_new.hand_found_at,
             paid_new.paid_document_id, paid_new.paid_at,
             -- A large bank's or leader's current page Knox's current rules version has not read yet.
             (COALESCE(inst.asset_size, 0) >= ${PRIORITY_MIN_ASSETS_THOUSANDS}::bigint OR inst.id = ANY(${leaders}::bigint[]))
             AND EXISTS (
               SELECT 1
                 FROM agent_source_texts unread_text
                 JOIN source_documents unread_doc ON unread_doc.id = unread_text.source_document_id
                WHERE unread_text.institution_id = inst.id
                  AND unread_text.status = 'completed'
                  AND unread_text.char_count > 0
                  AND unread_doc.superseded_by_id IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM pipeline_attempts rules_read
                     WHERE rules_read.stage = 'extract'
                       AND rules_read.institution_id = inst.id
                       AND rules_read.input_fingerprint = unread_text.text_hash
                       AND rules_read.strategy = ${KNOX_RULES_STRATEGY.strategy}::text
                       AND rules_read.strategy_version = ${KNOX_RULES_STRATEGY.version}::int
                  )
             ) AS rules_unread,
             CASE
               WHEN EXISTS (
                 SELECT 1 FROM institution_additional_sources hand
                  WHERE hand.institution_id = inst.id
                    AND hand.found_by_strategy = 'discover.operator_schedule'
                    AND hand.status = 'found'
                    AND hand.last_fetched_at IS NULL
               ) THEN 1
               WHEN paid_new.paid_document_id IS NOT NULL THEN 4
               WHEN inst.id = ANY(${requested}::bigint[]) THEN 2
               WHEN (COALESCE(inst.asset_size, 0) >= ${PRIORITY_MIN_ASSETS_THOUSANDS}::bigint
                     OR inst.id = ANY(${leaders}::bigint[]))
                AND (inst.fee_schedule_url IS NOT NULL OR EXISTS (
                      SELECT 1 FROM institution_additional_sources ias
                       WHERE ias.institution_id = inst.id
                         AND ias.status IN ('found', 'fetched')
                         AND ias.document_role <> 'business'
                    ))
                AND NOT EXISTS (
                      SELECT 1 FROM published_fee_catalog live
                       WHERE live.institution_id = inst.id
                         AND live.canonical_fee_key = 'overdraft'
                    ) THEN 3
             END AS tier
        FROM institution_sources inst
        LEFT JOIN LATERAL (
          SELECT MAX(hand.id) AS hand_link_id, MAX(hand.found_at) AS hand_found_at
            FROM institution_additional_sources hand
           WHERE hand.institution_id = inst.id
             AND hand.found_by_strategy = 'discover.operator_schedule'
             AND hand.status = 'found'
             AND hand.last_fetched_at IS NULL
        ) hand_new ON TRUE
        LEFT JOIN LATERAL (
          SELECT MAX(unread.document_id) AS paid_document_id, MAX(unread.stored_at) AS paid_at
            FROM (
              SELECT paid.source_document_id AS document_id, paid.created_at AS stored_at
                FROM pipeline_attempts paid
                JOIN source_documents doc ON doc.id = paid.source_document_id
               WHERE paid.institution_id = inst.id
                 AND paid.stage = 'fetch'
                 AND paid.strategy LIKE 'fetch.paid_web_fetch%'
                 AND paid.outcome = 'ok'
                 AND paid.created_at > NOW() - make_interval(days => ${PAID_FETCH_READ_DAYS}::int)
                 AND doc.status = 'success'
                 AND doc.superseded_by_id IS NULL
                 AND NOT EXISTS (SELECT 1 FROM agent_source_texts text WHERE text.source_document_id = doc.id)
              UNION ALL
              -- A hand-found schedule fetched by another state's lane (companion fetch takes
              -- them in any lane) is read only by its own state's lane: First United's
              -- (OK) fetched in the NC lane at 23:55 on 8 Oct 2026 and sat unread.
              SELECT hand_doc.id, hand_doc.crawled_at
                FROM institution_additional_sources hand
                JOIN source_documents hand_doc ON hand_doc.companion_source_id = hand.id
               WHERE hand.institution_id = inst.id
                 AND hand.found_by_strategy = 'discover.operator_schedule'
                 AND hand_doc.institution_id = inst.id
                 AND hand_doc.crawled_at > NOW() - make_interval(days => ${PAID_FETCH_READ_DAYS}::int)
                 AND hand_doc.status = 'success'
                 AND hand_doc.superseded_by_id IS NULL
                 AND NOT EXISTS (SELECT 1 FROM agent_source_texts text WHERE text.source_document_id = hand_doc.id)
            ) unread
        ) paid_new ON TRUE
       WHERE COALESCE(inst.status, 'active') = 'active'
          -- A bank whose own link went dormant is why its schedule was found by hand.
          OR (inst.status = 'dormant' AND EXISTS (
                SELECT 1 FROM institution_additional_sources hand
                 WHERE hand.institution_id = inst.id
                   AND hand.found_by_strategy = 'discover.operator_schedule'
              ))
    )
    SELECT c.id, c.institution_name, c.state_code, c.tier, c.hand_link_id, c.paid_document_id, c.rules_unread
      FROM candidates c
     WHERE c.tier IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM agent_runs r
          WHERE r.params_json->>'source' = ${PRIORITY_INSTITUTION_SOURCE}::text
            AND r.params_json->>'institution_id' = c.id::text
            AND (
              r.status IN ('queued', 'running', 'cancel_requested')
              OR (
                r.started_at > NOW() - CASE
                  WHEN c.tier = 3 THEN make_interval(days => ${PRIORITY_GAP_RETRY_DAYS}::int)
                  ELSE make_interval(hours => ${PRIORITY_RETRY_HOURS}::int)
                END
                -- A hand-found link or paid-fetched document added after the last run is new
                -- work, not a retry.
                AND (c.tier <> 1 OR c.hand_found_at IS NULL OR r.started_at >= c.hand_found_at)
                AND (c.tier <> 4 OR c.paid_at IS NULL OR r.started_at >= c.paid_at)
                -- A rules version that has not read the bank's current page is new work after
                -- PRIORITY_RULES_REREAD_HOURS, not the 7-day gap retry; once per version, since a
                -- page that version's run still left unread would otherwise come back every tick.
                -- The same holds for a request by name (Arvest and Old National waited a day on
                -- their request runs from before Knox v57, 9 Oct).
                AND (
                  c.tier NOT IN (2, 3)
                  OR NOT c.rules_unread
                  OR r.started_at > NOW() - make_interval(hours => ${PRIORITY_RULES_REREAD_HOURS}::int)
                  OR r.idempotency_key = ${"atlas:priority:"}::text || c.id::text || ${`:knox:${KNOX_RULES_STRATEGY.version}`}::text
                )
                -- A request by name is new work after an overdraft-gap run of the same bank
                -- (Bluestone FCU's 06:45 gap run held Marketing's 18:44 request for a day).
                AND (c.tier <> 2 OR r.params_json->>'tier' = 'requested')
                -- A run that failed on a break since fixed holds nothing: it reruns once
                -- under the new deploy (a second failure records that deploy and holds).
                AND NOT (
                  r.status = 'failed'
                  AND ${deploy}::text IS NOT NULL
                  AND EXISTS (
                    SELECT 1 FROM agent_run_steps step
                     WHERE step.agent_run_id = r.id
                       AND step.status = 'failed'
                       AND step.error_summary IS NOT NULL
                       AND (
                         SELECT COUNT(DISTINCT other.agent_run_id) FROM agent_run_steps other
                          WHERE other.step_key = step.step_key
                            AND other.error_summary = step.error_summary
                            AND other.status = 'failed'
                            AND other.completed_at > NOW() - INTERVAL '24 hours'
                       ) >= ${PRIORITY_FIXED_BREAK_RUNS}::int
                       AND NOT EXISTS (
                         SELECT 1 FROM agent_run_steps other
                           JOIN agent_run_events event ON event.step_id = other.id AND event.event_type = 'step.failed'
                          WHERE other.step_key = step.step_key
                            AND other.error_summary = step.error_summary
                            AND other.status = 'failed'
                            AND event.detail->>'deploy' = ${deploy}::text
                       )
                  )
                )
              )
            )
       )
     -- A request whose current page this Knox version has not read goes before paid-fetched
     -- pages, which otherwise kept the two direct-run places full all morning (9 Oct).
     ORDER BY CASE WHEN c.tier = 1 THEN 1 WHEN c.tier = 2 AND c.rules_unread THEN 2 WHEN c.tier = 4 THEN 3 WHEN c.tier = 2 THEN 4 ELSE 5 END ASC,
              CASE WHEN c.tier = 2 THEN array_position(${requested}::bigint[], c.id::bigint) END ASC NULLS LAST,
              COALESCE(c.asset_size, 0) DESC, c.id ASC
     LIMIT ${limit}::int
  `;
  const tiers: Record<number, PriorityTier> = { 1: "hand_found", 2: "requested", 3: "overdraft_gap", 4: "paid_fetched" };
  return rows.map((row) => ({
    id: Number(row.id),
    institution_name: String(row.institution_name),
    state_code: row.state_code ? String(row.state_code).trim().toUpperCase() : null,
    tier: tiers[Number(row.tier)] ?? "requested",
    hand_link_id: Number(row.tier) === 1 && row.hand_link_id != null ? Number(row.hand_link_id) : null,
    paid_document_id: Number(row.tier) === 4 && row.paid_document_id != null ? Number(row.paid_document_id) : null,
    rules_version: (Number(row.tier) === 3 || Number(row.tier) === 2) && row.rules_unread ? KNOX_RULES_STRATEGY.version : null,
  }));
}

/** Free steps only, each scoped to the one institution through the run's params. */
export function priorityInstitutionSteps(institutionId: number): AgentRunStepDefinition[] {
  return [
    { key: "fetch", agent: "magellan", title: "Fetch the institution's fee documents", input: { institution_id: institutionId } },
    { key: "read", agent: "rosetta", title: "Read and normalize the fee documents" },
    { key: "extract", agent: "knox", title: "Extract fee observations" },
    { key: "classify", agent: "darwin", title: "Classify and verify extracted fees", input: { verify_limit: DARWIN_VERIFY_MAX_LIMIT } },
    { key: "publish", agent: "hamilton", title: "Publish verified fees", input: { publish_limit: HAMILTON_PUBLISH_MAX_LIMIT } },
  ];
}

const TIER_REASON: Record<PriorityTier, string> = {
  hand_found: "fee schedule found by hand, not yet fetched",
  paid_fetched: "document stored by the paid fetch or a hand-found link, not yet read",
  requested: "asked for by name",
  overdraft_gap: "$10B+ or market leader with no live overdraft fee",
};

export interface SchedulePriorityInstitutionRunsResult {
  active: number;
  selected: number;
  scheduled: number;
  reused: number;
  failed: Array<{ institutionId: number; error: string }>;
  runs: Array<{ institutionId: number; runId: number; tier: PriorityTier }>;
}

/** Fills free direct-path slots (up to PRIORITY_MAX_ACTIVE). Called once per tick. */
export async function schedulePriorityInstitutionRuns(
  options: { db?: SqlTag; now?: Date; maxActive?: number } = {},
): Promise<SchedulePriorityInstitutionRunsResult> {
  const db = options.db ?? sql;
  const maxActive = options.maxActive ?? PRIORITY_MAX_ACTIVE;
  const [{ active }] = await db<Array<{ active: number | string }>>`
    SELECT COUNT(*)::int AS active
      FROM agent_runs
     WHERE params_json->>'source' = ${PRIORITY_INSTITUTION_SOURCE}::text
       AND status IN ('queued', 'running', 'cancel_requested')
  `;
  const activeCount = Number(active);
  const result: SchedulePriorityInstitutionRunsResult = {
    active: activeCount,
    selected: 0,
    scheduled: 0,
    reused: 0,
    failed: [],
    runs: [],
  };
  const open = maxActive - activeCount;
  if (open <= 0) return result;

  const leaderIds = await loadMarketLeaderIds(db);
  const picks = await selectPriorityInstitutions(db, { limit: open, leaderIds });
  result.selected = picks.length;
  const day = (options.now ?? new Date()).toISOString().slice(0, 10);
  for (const pick of picks) {
    try {
      const started = await startAgentRun({
        agent: "atlas",
        kind: "manual_repair",
        title: `Read now: ${pick.institution_name}`,
        stateCode: pick.state_code ?? undefined,
        params: {
          source: PRIORITY_INSTITUTION_SOURCE,
          institution_id: pick.id,
          tier: pick.tier,
          reason:
            PRIORITY_INSTITUTION_REQUESTS.find((request) => request.institutionId === pick.id)?.reason ??
            TIER_REASON[pick.tier],
        },
        triggeredBy: "api.admin.agents.tick",
        triggerSource: "schedule",
        idempotencyKey:
          pick.hand_link_id != null
            ? `atlas:priority:${pick.id}:hand:${pick.hand_link_id}`
            : pick.paid_document_id != null
              ? `atlas:priority:${pick.id}:paid:${pick.paid_document_id}`
              : pick.rules_version != null
                ? `atlas:priority:${pick.id}:knox:${pick.rules_version}`
                : `atlas:priority:${pick.id}:${day}`,
        steps: priorityInstitutionSteps(pick.id),
        summary: `Direct run for one institution (${TIER_REASON[pick.tier]}).`,
      });
      if (started.reused) result.reused += 1;
      else result.scheduled += 1;
      result.runs.push({ institutionId: pick.id, runId: started.run.id, tier: pick.tier });
    } catch (error) {
      result.failed.push({ institutionId: pick.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
