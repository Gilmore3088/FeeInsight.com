import { sql } from "./connection";
import { knoxReasonGroup, type KnoxReasonGroup } from "@/lib/knox-reasons";

export interface KnoxRejectionRow {
  message_id: string;
  created_at: string;
  correlation_id: string;
  fee_verified_id: number | null;
  /** payload.reason, a single stored string (older shape); prod rows carry payload.reasons. */
  reason: string | null;
  /** The interpreted group (`knoxReasonGroup`), computed in SQL so filters page correctly. */
  reason_group: KnoxReasonGroup;
  confidence: number | null;
  payload: Record<string, unknown>;
  round_number: number;
  state: string;
  fee_name: string | null;
  amount: number | null;
  amount_kind: string | null;
  rate_percent: number | null;
  rate_basis: string | null;
  rate_min_amount: number | null;
  rate_max_amount: number | null;
  frequency: string | null;
  institution_id: number | null;
  institution_name: string | null;
  state_code: string | null;
  canonical_fee_key: string | null;
  review_decision: "confirm" | "override" | null;
  reviewed_at: string | null;
  reviewer_username: string | null;
}

export interface KnoxRejectionDetail extends KnoxRejectionRow {
  source_url: string | null;
  extraction_confidence: number | null;
  document_r2_key: string | null;
  variant_type: string | null;
  review_status: string | null;
  verified_at: string | null;
  fee_raw_id: number | null;
  fee_raw_conditions: string | null;
  fee_raw_name: string | null;
  fee_raw_amount: number | null;
  raw_source: string | null;
  raw_source_url: string | null;
  raw_created_at: string | null;
  raw_agent_event_id: string | null;
  raw_event_agent: string | null;
  raw_event_action: string | null;
  verified_by_agent_event_id: string | null;
  verified_event_agent: string | null;
  verified_event_tool: string | null;
  source_document_id: number | null;
  document_url: string | null;
  document_content_type: string | null;
  document_crawled_at: string | null;
  source_text_id: number | null;
  source_text_document_type: string | null;
  source_text_char_count: number | null;
  source_text: string | null;
  institution_city: string | null;
  institution_website_url: string | null;
  institution_charter_type: string | null;
  institution_cert_number: string | null;
  institution_rssd_id: string | null;
  institution_ncua_charter_id: string | null;
  darwin_accept_message_id: string | null;
  darwin_accept_at: string | null;
  live_fee_published_id: number | null;
  review_note: string | null;
  promoted_fee_published_id: number | null;
}

export interface KnoxReviewCounts {
  pending: number;
  confirmed: number;
  overridden: number;
  total: number;
}

type ReviewFilter = "pending" | "confirmed" | "overridden" | "all";

// Per-instance TTL cache for the layout-level badge query.
//
// Every admin page render triggers a layout render, which called this on
// every request — wasteful at scale. 30-second TTL drops per-request DB
// hits to one per cache window per serverless instance.
//
// Caveats (documented per 2026-04-19 code-review MAJOR-3):
// - clearKnoxReviewCountsCache() only clears the invoking instance. Other
//   Vercel serverless instances surface stale badges until their own TTL
//   expires. This is BEST-EFFORT invalidation — cross-instance staleness
//   is bounded by the 30s TTL, not eliminated.
// - Promise-dedupe (_inFlight) collapses concurrent cold-cache requests
//   into a single DB call to avoid thundering-herd on first admin render.
const CACHE_TTL_MS = 30_000;
let _knoxCountsCache: { value: KnoxReviewCounts; expiresAt: number } | null = null;
let _inFlight: Promise<KnoxReviewCounts> | null = null;

export function clearKnoxReviewCountsCache(): void {
  _knoxCountsCache = null;
}

/**
 * Count Knox rejection messages grouped by human-review status.
 * - pending   : no knox_overrides row for this rejection_msg_id
 * - confirmed : knox_overrides.decision = 'confirm'
 * - overridden: knox_overrides.decision = 'override'
 *
 * Cached for 30s per instance (best-effort cross-instance invalidation).
 * Concurrent cold-cache callers share a single in-flight promise.
 */
export async function getKnoxReviewCounts(): Promise<KnoxReviewCounts> {
  const now = Date.now();
  if (_knoxCountsCache && _knoxCountsCache.expiresAt > now) {
    return _knoxCountsCache.value;
  }
  if (_inFlight) return _inFlight;
  _inFlight = (async () => {
    try {
      const rows = await sql<{ bucket: string; cnt: string }[]>`
        SELECT
          CASE
            WHEN ko.decision IS NULL THEN 'pending'
            WHEN ko.decision = 'confirm' THEN 'confirmed'
            WHEN ko.decision = 'override' THEN 'overridden'
            ELSE 'other'
          END AS bucket,
          COUNT(*) AS cnt
        FROM agent_messages am
        LEFT JOIN knox_overrides ko ON ko.rejection_msg_id = am.message_id
        WHERE am.sender_agent = 'knox' AND am.intent = 'reject'
        GROUP BY 1
      `;
      const counts: KnoxReviewCounts = {
        pending: 0,
        confirmed: 0,
        overridden: 0,
        total: 0,
      };
      for (const r of rows) {
        const n = Number(r.cnt);
        if (r.bucket === "pending") counts.pending = n;
        else if (r.bucket === "confirmed") counts.confirmed = n;
        else if (r.bucket === "overridden") counts.overridden = n;
        counts.total += n;
      }
      _knoxCountsCache = { value: counts, expiresAt: Date.now() + CACHE_TTL_MS };
      return counts;
    } finally {
      _inFlight = null;
    }
  })();
  try {
    return await _inFlight;
  } catch (e) {
    console.error("getKnoxReviewCounts failed:", e);
    return { pending: 0, confirmed: 0, overridden: 0, total: 0 };
  }
}

// Parameterized filter fragments (MINOR-3). Returning a postgres.js tagged
// fragment instead of a raw string removes the `sql.unsafe()` footgun — a
// future refactor that accepted user input for `filter` can't escape the
// parser boundary. `all` returns a TRUE tautology so the WHERE stays valid.
function reviewStatusFragment(filter: ReviewFilter) {
  switch (filter) {
    case "pending":
      return sql`ko.id IS NULL`;
    case "confirmed":
      return sql`ko.decision = 'confirm'`;
    case "overridden":
      return sql`ko.decision = 'override'`;
    case "all":
    default:
      return sql`TRUE`;
  }
}

// The interpreted reason group is computed in SQL so a group filter pages and counts
// correctly. It mirrors knoxReasonGroup() in src/lib/knox-reasons.ts: the zero-amount
// check wins over the peer check; anything else is unrecognized. Keep the two in sync.
// Every prod reject stores payload.reasons (a JSON array of strings); payload.reason is
// read too for the older single-string shape.
function knoxReasonText() {
  return sql`(COALESCE(am.payload->'reasons', '[]'::jsonb)::text || ' ' || COALESCE(am.payload->>'reason', ''))`;
}

function knoxReasonGroupCase() {
  return sql`
    CASE
      WHEN ${knoxReasonText()} ~* 'amount=[0-9.]+ but fee_name has no free-fee wording' THEN 'zero_amount'
      WHEN ${knoxReasonText()} ~* 'amount=[0-9.]+ exceeds [0-9.]+x peer_median=[0-9.]+ [(]n=[0-9]+[)]' THEN 'above_peers'
      ELSE 'unrecognized'
    END
  `;
}

function reasonGroupFragment(group: KnoxReasonGroup | "all") {
  if (group === "all") return sql`TRUE`;
  return sql`(${knoxReasonGroupCase()}) = ${group}`;
}

/**
 * Rejections per interpreted reason group under a review-status filter, for the queue's
 * reason chips.
 */
export async function getKnoxReasonGroupCounts(
  filter: ReviewFilter = "pending",
): Promise<Record<KnoxReasonGroup, number>> {
  const counts: Record<KnoxReasonGroup, number> = { zero_amount: 0, above_peers: 0, unrecognized: 0 };
  try {
    const rows = await sql<{ reason_group: KnoxReasonGroup; cnt: string }[]>`
      SELECT (${knoxReasonGroupCase()})::text AS reason_group, COUNT(*) AS cnt
      FROM agent_messages am
      LEFT JOIN knox_overrides ko ON ko.rejection_msg_id = am.message_id
      WHERE am.sender_agent = 'knox'
        AND am.intent = 'reject'
        AND ${reviewStatusFragment(filter)}
      GROUP BY 1
    `;
    for (const row of rows) {
      if (row.reason_group in counts) counts[row.reason_group] = Number(row.cnt);
    }
  } catch (e) {
    console.error("getKnoxReasonGroupCounts failed:", e);
  }
  return counts;
}

export const KNOX_REVIEWS_PAGE_SIZE = 25;

export interface ListKnoxRejectionsArgs {
  filter?: ReviewFilter;
  reasonGroup?: KnoxReasonGroup | "all";
  page?: number;
  pageSize?: number;
}

export interface ListKnoxRejectionsResult {
  rows: KnoxRejectionRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Paginated list of Knox rejections for the review queue.
 *
 * JSON extraction:
 *   payload->'reasons'            — array of Knox check results (prod shape)
 *   payload->>'reason'            — single free-text reason (older shape)
 *   payload->>'confidence'        — numeric in 0..1 (optional)
 *   payload->>'fee_verified_id'   — BIGINT stringified
 */
export async function listKnoxRejections(
  args: ListKnoxRejectionsArgs = {}
): Promise<ListKnoxRejectionsResult> {
  const filter = args.filter ?? "pending";
  const reasonGroup = args.reasonGroup ?? "all";
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, args.pageSize ?? KNOX_REVIEWS_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  try {
    const statusFragment = reviewStatusFragment(filter);
    const reasonFragment = reasonGroupFragment(reasonGroup);

    // Get total FIRST with the same filters applied so pagination
    // matches reality. Previously the reason filter only ran post-LIMIT
    // in JS, producing sparse pages and wrong totals (bug_007).
    const countRows = await sql<{ cnt: string }[]>`
      SELECT COUNT(*) AS cnt
      FROM agent_messages am
      LEFT JOIN knox_overrides ko ON ko.rejection_msg_id = am.message_id
      WHERE am.sender_agent = 'knox'
        AND am.intent = 'reject'
        AND ${statusFragment}
        AND ${reasonFragment}
    `;
    const total = Number(countRows[0]?.cnt ?? 0);

    const rows = await sql<KnoxRejectionRow[]>`
      SELECT
        am.message_id,
        am.created_at,
        am.correlation_id,
        NULLIF(am.payload->>'fee_verified_id','')::bigint AS fee_verified_id,
        am.payload->>'reason' AS reason,
        NULLIF(am.payload->>'confidence','')::numeric AS confidence,
        am.payload,
        am.round_number,
        am.state,
        fv.fee_name,
        fv.amount,
        fv.amount_kind,
        fv.rate_percent,
        fv.rate_basis,
        fv.rate_min_amount,
        fv.rate_max_amount,
        fv.frequency,
        fv.institution_id,
        ct.institution_name,
        ct.state_code,
        fv.canonical_fee_key,
        ko.decision AS review_decision,
        ko.created_at AS reviewed_at,
        u.username AS reviewer_username,
        (${knoxReasonGroupCase()})::text AS reason_group
      FROM agent_messages am
      LEFT JOIN knox_overrides ko ON ko.rejection_msg_id = am.message_id
      LEFT JOIN users u ON u.id = ko.reviewer_id
      LEFT JOIN verified_fee_observations fv
             ON fv.fee_verified_id = NULLIF(am.payload->>'fee_verified_id','')::bigint
      LEFT JOIN institution_sources ct ON ct.id = fv.institution_id
      WHERE am.sender_agent = 'knox'
        AND am.intent = 'reject'
        AND ${statusFragment}
        AND ${reasonFragment}
      ORDER BY am.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return { rows, total, page, pageSize };
  } catch (e) {
    console.error("listKnoxRejections failed:", e);
    return { rows: [], total: 0, page, pageSize };
  }
}

/**
 * Fetch a single rejection with the evidence a reviewer needs: the fee as Darwin verified
 * it, the raw observation Knox extracted, the source document and its stored text, the
 * institution's identity, and the lineage events.
 */
export async function getKnoxRejectionById(
  messageId: string
): Promise<KnoxRejectionDetail | null> {
  try {
    const rows = await sql<Omit<KnoxRejectionDetail, "reason_group">[]>`
      SELECT
        am.message_id,
        am.created_at,
        am.correlation_id,
        NULLIF(am.payload->>'fee_verified_id','')::bigint AS fee_verified_id,
        am.payload->>'reason' AS reason,
        NULLIF(am.payload->>'confidence','')::numeric AS confidence,
        am.payload,
        am.round_number,
        am.state,
        fv.fee_name,
        fv.amount,
        fv.amount_kind,
        fv.rate_percent,
        fv.rate_basis,
        fv.rate_min_amount,
        fv.rate_max_amount,
        fv.frequency,
        fv.institution_id,
        ct.institution_name,
        ct.state_code,
        ct.city AS institution_city,
        ct.website_url AS institution_website_url,
        ct.charter_type AS institution_charter_type,
        ct.cert_number AS institution_cert_number,
        ct.rssd_id AS institution_rssd_id,
        ct.ncua_charter_id AS institution_ncua_charter_id,
        fv.canonical_fee_key,
        fv.source_url,
        fv.extraction_confidence,
        fv.document_r2_key,
        fv.variant_type,
        fv.review_status,
        fv.created_at AS verified_at,
        fv.fee_raw_id,
        fv.verified_by_agent_event_id,
        ve.agent_name AS verified_event_agent,
        ve.tool_name AS verified_event_tool,
        fr.conditions AS fee_raw_conditions,
        fr.fee_name   AS fee_raw_name,
        fr.amount     AS fee_raw_amount,
        fr.source     AS raw_source,
        fr.source_url AS raw_source_url,
        fr.created_at AS raw_created_at,
        fr.agent_event_id AS raw_agent_event_id,
        re.agent_name AS raw_event_agent,
        re.action AS raw_event_action,
        fr.source_document_id,
        sd.document_url,
        sd.content_type AS document_content_type,
        sd.crawled_at AS document_crawled_at,
        st.id AS source_text_id,
        st.document_type AS source_text_document_type,
        st.char_count AS source_text_char_count,
        st.normalized_text AS source_text,
        ko.decision AS review_decision,
        ko.created_at AS reviewed_at,
        ko.note AS review_note,
        ko.promoted_fee_published_id,
        u.username AS reviewer_username,
        da.message_id::text AS darwin_accept_message_id,
        da.created_at AS darwin_accept_at,
        (
          SELECT fp.fee_published_id
            FROM published_fee_records fp
           WHERE fp.lineage_ref = fv.fee_verified_id
             AND fp.rolled_back_at IS NULL
           ORDER BY fp.fee_published_id DESC
           LIMIT 1
        ) AS live_fee_published_id
      FROM agent_messages am
      LEFT JOIN knox_overrides ko ON ko.rejection_msg_id = am.message_id
      LEFT JOIN users u ON u.id = ko.reviewer_id
      LEFT JOIN verified_fee_observations fv
             ON fv.fee_verified_id = NULLIF(am.payload->>'fee_verified_id','')::bigint
      LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
      LEFT JOIN institution_sources ct ON ct.id = fv.institution_id
      LEFT JOIN source_documents sd ON sd.id = fr.source_document_id
      LEFT JOIN LATERAL (
        SELECT t.id, t.document_type, t.char_count, t.normalized_text
          FROM agent_source_texts t
         WHERE t.source_document_id = fr.source_document_id
           AND t.normalized_text IS NOT NULL
         ORDER BY t.updated_at DESC NULLS LAST, t.id DESC
         LIMIT 1
      ) st ON TRUE
      LEFT JOIN LATERAL (
        SELECT e.agent_name, e.action
          FROM agent_events e
         WHERE e.event_id = fr.agent_event_id
         LIMIT 1
      ) re ON TRUE
      LEFT JOIN LATERAL (
        SELECT e.agent_name, e.tool_name
          FROM agent_events e
         WHERE e.event_id = fv.verified_by_agent_event_id
         LIMIT 1
      ) ve ON TRUE
      LEFT JOIN LATERAL (
        SELECT am2.message_id, am2.created_at
          FROM agent_messages am2
         WHERE am2.sender_agent = 'darwin'
           AND am2.intent = 'accept'
           AND am2.payload->>'fee_verified_id' = am.payload->>'fee_verified_id'
         ORDER BY am2.created_at DESC
         LIMIT 1
      ) da ON TRUE
      WHERE am.message_id = ${messageId}
        AND am.sender_agent = 'knox'
        AND am.intent = 'reject'
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return { ...rows[0], reason_group: knoxReasonGroup(rows[0].payload) };
  } catch (e) {
    console.error("getKnoxRejectionById failed:", e);
    return null;
  }
}
