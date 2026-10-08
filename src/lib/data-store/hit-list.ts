import { sql } from "./connection";
import { FINANCIAL_SOURCES } from "./financial-sources";
import { OPERATOR_SCHEDULE_STRATEGY } from "@/lib/agents/magellan/operator-schedules";

type SqlTag = typeof sql;

/**
 * The hit list (James, 8 Oct 2026: "a largest list of institutions we currently don't have
 * and I can work through that later"): active institutions the site does not show, largest
 * deposits first, each with why it is missing. A link pasted against a row is stored as a
 * hand-found schedule, which Atlas's priority path runs first (`priority-institutions.ts`).
 *
 * - `no_fees`: no live fees at all (the catalog's 3-fee-type bar hides the rest);
 * - `no_overdraft`: live, but no live overdraft fee.
 */
export type HitListView = "no_fees" | "no_overdraft";

export type HitListReason =
  | "link_waiting"
  | "no_link"
  | "blocked"
  | "not_a_schedule"
  | "read_thin"
  | "no_overdraft_read";

export const HIT_LIST_REASON_TEXT: Record<HitListReason, string> = {
  link_waiting: "Hand-found link added; runs on the next tick",
  no_link: "No fee schedule link found",
  blocked: "Site blocks our fetch",
  not_a_schedule: "Link on file is not a fee schedule",
  read_thin: "Read, but fewer than 3 fee types came through",
  no_overdraft_read: "Live, but no overdraft fee read",
};

export const HIT_LIST_DEFAULT_LIMIT = 200;
/** Fetch outcomes that mean the site refused us, not that the page was wrong. */
const BLOCKED_OUTCOMES = ["http_403", "blocked_bot", "http_429"];

export interface HitListRow {
  institutionId: number;
  name: string;
  stateCode: string | null;
  charterType: string | null;
  /** Thousands of dollars, from the latest FDIC or NCUA filing. */
  deposits: number | null;
  feeScheduleUrl: string | null;
  websiteUrl: string | null;
  liveFeeTypes: number;
  rawFees: number;
  documents: number;
  handLinkWaiting: boolean;
  blockedAttempts: number;
  okReads: number;
  lastTriedAt: string | null;
  reason: HitListReason;
}

export interface HitListFacts {
  view: HitListView;
  hasLink: boolean;
  handLinkWaiting: boolean;
  rawFees: number;
  blockedAttempts: number;
  okReads: number;
}

/** Why an institution is on the list, most actionable first. */
export function hitListReason(facts: HitListFacts): HitListReason {
  if (facts.handLinkWaiting) return "link_waiting";
  if (facts.view === "no_overdraft") return "no_overdraft_read";
  if (!facts.hasLink) return "no_link";
  if (facts.rawFees > 0) return "read_thin";
  if (facts.blockedAttempts > 0 && facts.okReads === 0) return "blocked";
  return "not_a_schedule";
}

export interface HitListOptions {
  db?: SqlTag;
  view?: HitListView;
  stateCode?: string | null;
  limit?: number;
}

export interface HitList {
  rows: HitListRow[];
  /** Every institution in the view, before the limit. */
  total: number;
}

export async function getHitList(options: HitListOptions = {}): Promise<HitList> {
  const db = options.db ?? sql;
  const view: HitListView = options.view === "no_overdraft" ? "no_overdraft" : "no_fees";
  const stateCode = options.stateCode && /^[A-Za-z]{2}$/.test(options.stateCode.trim()) ? options.stateCode.trim().toUpperCase() : null;
  const limit = Math.min(Math.max(Math.floor(options.limit ?? HIT_LIST_DEFAULT_LIMIT), 1), 1000);
  const sources = [...FINANCIAL_SOURCES];
  const rows = await db<
    Array<{
      id: number | string;
      institution_name: string;
      state_code: string | null;
      charter_type: string | null;
      deposits: number | string | null;
      fee_schedule_url: string | null;
      website_url: string | null;
      live_types: number | string;
      has_extra_link: boolean;
      hand_link_waiting: boolean;
      raw_fees: number | string;
      documents: number | string;
      blocked_attempts: number | string;
      ok_reads: number | string;
      last_tried_at: string | Date | null;
      total: number | string;
    }>
  >`
    -- hit list: largest institutions the site does not show
    WITH live AS (
      SELECT institution_id, count(DISTINCT canonical_fee_key)::int AS types,
             bool_or(canonical_fee_key = 'overdraft') AS has_overdraft
        FROM published_fee_catalog
       GROUP BY institution_id
    ),
    deposits AS (
      SELECT DISTINCT ON (f.institution_id) f.institution_id, f.total_deposits
        FROM institution_financial_records f
       WHERE f.source = ANY(${sources}::text[])
         AND f.total_deposits IS NOT NULL
       ORDER BY f.institution_id, f.report_date DESC
    ),
    scoped AS (
      SELECT inst.id, inst.institution_name, inst.state_code, inst.charter_type, inst.fee_schedule_url,
             inst.website_url, deposits.total_deposits AS deposits, COALESCE(live.types, 0) AS live_types,
             count(*) OVER () AS total
        FROM institution_sources inst
        LEFT JOIN live ON live.institution_id = inst.id
        LEFT JOIN deposits ON deposits.institution_id = inst.id
        LEFT JOIN institution_source_profiles profile ON profile.institution_id = inst.id
       WHERE COALESCE(inst.status, 'active') = 'active'
         AND COALESCE(inst.regulatory_status, 'active') <> 'inactive'
         AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
         AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode}::text)
         AND CASE WHEN ${view}::text = 'no_overdraft'
                  THEN live.institution_id IS NOT NULL AND NOT live.has_overdraft
                  ELSE live.institution_id IS NULL END
       ORDER BY deposits.total_deposits DESC NULLS LAST, inst.id ASC
       LIMIT ${limit}::int
    )
    SELECT scoped.*,
           EXISTS (
             SELECT 1 FROM institution_additional_sources ias
              WHERE ias.institution_id = scoped.id AND ias.status IN ('found', 'fetched') AND ias.document_role <> 'business'
           ) AS has_extra_link,
           EXISTS (
             SELECT 1 FROM institution_additional_sources hand
              WHERE hand.institution_id = scoped.id
                AND hand.found_by_strategy = ${OPERATOR_SCHEDULE_STRATEGY.strategy}
                AND hand.status = 'found'
                AND hand.last_fetched_at IS NULL
           ) AS hand_link_waiting,
           (SELECT count(*) FROM raw_fee_observations raw WHERE raw.institution_id = scoped.id) AS raw_fees,
           (SELECT count(*) FROM source_documents doc WHERE doc.institution_id = scoped.id) AS documents,
           (SELECT count(*) FROM pipeline_attempts pa
             WHERE pa.institution_id = scoped.id AND pa.stage IN ('discover', 'fetch')
               AND pa.outcome = ANY(${BLOCKED_OUTCOMES}::text[])
               AND pa.created_at > NOW() - interval '30 days') AS blocked_attempts,
           (SELECT count(*) FROM pipeline_attempts pa
             WHERE pa.institution_id = scoped.id AND pa.stage = 'read' AND pa.outcome = 'ok'
               AND pa.created_at > NOW() - interval '30 days') AS ok_reads,
           (SELECT max(pa.created_at) FROM pipeline_attempts pa WHERE pa.institution_id = scoped.id) AS last_tried_at
      FROM scoped
     ORDER BY scoped.deposits DESC NULLS LAST, scoped.id ASC
  `;
  const total = rows.length > 0 ? Number(rows[0].total) : 0;
  return {
    total,
    rows: rows.map((row) => {
      const hasLink = Boolean(row.fee_schedule_url && row.fee_schedule_url.trim()) || Boolean(row.has_extra_link);
      const facts: HitListFacts = {
        view,
        hasLink,
        handLinkWaiting: Boolean(row.hand_link_waiting),
        rawFees: Number(row.raw_fees),
        blockedAttempts: Number(row.blocked_attempts),
        okReads: Number(row.ok_reads),
      };
      const lastTried = row.last_tried_at == null ? null : new Date(row.last_tried_at).toISOString();
      return {
        institutionId: Number(row.id),
        name: String(row.institution_name),
        stateCode: row.state_code ? String(row.state_code).trim().toUpperCase() : null,
        charterType: row.charter_type,
        deposits: row.deposits == null ? null : Number(row.deposits),
        feeScheduleUrl: row.fee_schedule_url,
        websiteUrl: row.website_url,
        liveFeeTypes: Number(row.live_types),
        rawFees: facts.rawFees,
        documents: Number(row.documents),
        handLinkWaiting: facts.handLinkWaiting,
        blockedAttempts: facts.blockedAttempts,
        okReads: facts.okReads,
        lastTriedAt: lastTried,
        reason: hitListReason(facts),
      };
    }),
  };
}
