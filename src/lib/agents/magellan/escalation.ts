import { sql } from "@/lib/data-store/connection";
import { assetTierSql } from "@/lib/agents/state-expert/memory";

import { MISS_COOLDOWN_DAYS, TRANSIENT_PAID_OUTCOMES } from "./cooldowns";

type SqlTag = typeof sql;

/**
 * Magellan's escalation ladder for an institution with no fee link (#1032). James's
 * rule (2026-10-12): never abandon an institution, but stop paying every month for one
 * that publishes nothing online.
 *
 * 1. All free finders (`discovery.ts`, then `rescue_status = 'dead'` with the current
 *    method version).
 * 2. Paid search for the fee schedule (`paid-find.ts`, rung `schedule`).
 * 3. After one paid miss: paid search for a Truth in Savings disclosure or an account
 *    agreement that lists fees (rung `disclosure`).
 * 4. After `NOT_ONLINE_AFTER_MISSES` paid misses on the same website: "not published
 *    online", dated by the last miss. No paid search for `NOT_ONLINE_RETRY_DAYS`; then
 *    the ladder starts again, alternating the two paid rungs.
 *
 * The state is derived from the attempt log (`pipeline_attempts`), so it needs no new
 * column: a paid web-search miss is a `discover.paid_web_search` attempt whose outcome is
 * neither `ok` nor transient. Misses count only since the last paid find and only on the
 * current website (`detail.website_url`, recorded from #1032 on; older rows count as the
 * current site), so a new website restarts the ladder at once. A submitted or found fee
 * link takes the institution off the paid list entirely.
 */

/** Paid misses on the same website before an institution is "not published online". */
export const NOT_ONLINE_AFTER_MISSES = 2;
/** Days "not published online" holds before the paid ladder runs again (90 to 180 asked). */
export const NOT_ONLINE_RETRY_DAYS = 120;

export type PaidRung = "schedule" | "disclosure";

/** The paid rung for an institution with this many paid misses since its last find. */
export function paidRung(misses: number): PaidRung {
  return Math.max(0, Math.floor(misses)) % 2 === 0 ? "schedule" : "disclosure";
}

/** True while the institution is "not published online" and its retry is not yet due. */
export function notOnlineHeld(misses: number, lastMissAt: Date | null, now: Date): boolean {
  if (misses < NOT_ONLINE_AFTER_MISSES || !lastMissAt) return false;
  return lastMissAt.getTime() >= now.getTime() - NOT_ONLINE_RETRY_DAYS * 24 * 60 * 60 * 1000;
}

/** `PAID_FIND_STRATEGY.strategy` in paid-find.ts (imported from there would be circular). */
export const PAID_WEB_SEARCH = "discover.paid_web_search";

/**
 * The ladder's per-institution counts in SQL, for `inst` (institution_sources): adds
 * `ladder.misses` and `ladder.last_miss_at`. The two arguments are the placeholders
 * bound to the paid web-search strategy and the transient outcomes. `paid-find.ts`
 * selectBanks and the state lane scheduler's `paid_due` repeat this join in their
 * tagged templates; keep the three the same.
 */
export function paidLadderSql(strategyParam: string, transientParam: string): string {
  return `LEFT JOIN LATERAL (
      SELECT count(*)::int AS misses, max(pa.created_at) AS last_miss_at
        FROM pipeline_attempts pa
       WHERE pa.institution_id = inst.id
         AND pa.stage = 'discover'
         AND pa.strategy = ${strategyParam}
         AND pa.outcome <> 'ok'
         AND pa.outcome <> ALL(${transientParam}::text[])
         AND COALESCE(pa.detail->>'website_url', inst.website_url) = inst.website_url
         AND pa.created_at > COALESCE((
           SELECT max(found.created_at) FROM pipeline_attempts found
            WHERE found.institution_id = inst.id
              AND found.stage = 'discover'
              AND found.strategy = ${strategyParam}
              AND found.outcome = 'ok'
         ), '-infinity'::timestamptz)
    ) ladder ON true`;
}

export interface NotOnlineTierCount {
  tier: string;
  institutions: number;
}

/**
 * Institutions "not published online" today, per asset-size tier, for one state or all
 * states. Coverage gaps then separate "not found yet" from "not online". Read-only.
 */
export async function notPublishedOnlineCounts(db: SqlTag, stateCode: string | null): Promise<NotOnlineTierCount[]> {
  const rows = await db.unsafe<Array<{ tier: string; institutions: number | string }>>(
    `
      SELECT ${assetTierSql("inst")} AS tier, count(*)::int AS institutions
        FROM institution_sources inst
        ${paidLadderSql("$1", "$2")}
       WHERE COALESCE(inst.status, 'active') = 'active'
         AND NULLIF(btrim(inst.fee_schedule_url), '') IS NULL
         AND NULLIF(btrim(inst.website_url), '') IS NOT NULL
         AND ($3::text IS NULL OR upper(btrim(inst.state_code)) = $3)
         AND ladder.misses >= $4
         AND ladder.last_miss_at >= NOW() - make_interval(days => $5::int)
       GROUP BY 1
       ORDER BY 1
    `,
    [PAID_WEB_SEARCH, TRANSIENT_PAID_OUTCOMES, stateCode, NOT_ONLINE_AFTER_MISSES, NOT_ONLINE_RETRY_DAYS],
  );
  return rows.map((row) => ({ tier: String(row.tier), institutions: Number(row.institutions) }));
}

export interface NotOnlineStatus {
  /** "not published online" since this date (the last paid miss), or null when not. */
  since: string | null;
  /** Paid web-search misses on the current website since the last paid find. */
  misses: number;
  /** When the paid ladder runs again: the retry after "not online", else the miss cooldown. */
  nextPaidTryAfter: string | null;
  /** Rung the next paid web search takes. */
  nextRung: PaidRung;
  /** Discovery methods tried, newest first: strategy, attempts, last try, last outcome. */
  methods: Array<{ strategy: string; attempts: number; lastAt: string; lastOutcome: string }>;
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** One institution's place on the ladder, for its admin page. Read-only. */
export async function notOnlineStatus(db: SqlTag, institutionId: number, now: Date = new Date()): Promise<NotOnlineStatus | null> {
  const [row] = await db.unsafe<Array<{ misses: number | string | null; last_miss_at: unknown }>>(
    `
      SELECT ladder.misses, ladder.last_miss_at
        FROM institution_sources inst
        ${paidLadderSql("$1", "$2")}
       WHERE inst.id = $3
    `,
    [PAID_WEB_SEARCH, TRANSIENT_PAID_OUTCOMES, institutionId],
  );
  if (!row) return null;
  const methods = await db<Array<{ strategy: string; attempts: number | string; last_at: unknown; last_outcome: string }>>`
    SELECT DISTINCT ON (pa.strategy)
           pa.strategy,
           count(*) OVER (PARTITION BY pa.strategy)::int AS attempts,
           pa.created_at AS last_at,
           pa.outcome AS last_outcome
      FROM pipeline_attempts pa
     WHERE pa.institution_id = ${institutionId}
       AND pa.stage = 'discover'
     ORDER BY pa.strategy, pa.created_at DESC
  `;
  const misses = Number(row.misses ?? 0);
  const lastMiss = iso(row.last_miss_at);
  const lastMissAt = lastMiss ? new Date(lastMiss) : null;
  const held = notOnlineHeld(misses, lastMissAt, now);
  const waitDays = held ? NOT_ONLINE_RETRY_DAYS : MISS_COOLDOWN_DAYS;
  return {
    since: held ? lastMiss : null,
    misses,
    nextPaidTryAfter: lastMissAt ? new Date(lastMissAt.getTime() + waitDays * 24 * 60 * 60 * 1000).toISOString() : null,
    nextRung: paidRung(misses),
    methods: methods
      .map((method) => ({
        strategy: method.strategy,
        attempts: Number(method.attempts),
        lastAt: iso(method.last_at) ?? "",
        lastOutcome: method.last_outcome,
      }))
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
  };
}
