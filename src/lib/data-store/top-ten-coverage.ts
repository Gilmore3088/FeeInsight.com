import { sql } from "./connection";
import { getMarketLeaders, type MarketLeader } from "./market-leaders";

type SqlTag = typeof sql;

/**
 * Top 10 per state coverage: the ten largest institutions by in-state deposits in each of the
 * 50 states and DC (510 slots, the market-leaders deposit ranking), and how many of those slots
 * show live fees. One shared count, so the admin page, Magellan and the coordinator stop
 * producing different numbers by hand. A bank in several states' top 10 counts once per slot.
 */
export const TOP_TEN_PER_STATE = 10;

export const STATES_AND_DC = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
  "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;

export interface LiveFacts {
  types: number;
  hasOverdraft: boolean;
}

export interface TopTenSlot {
  stateCode: string;
  rank: number;
}

export interface TopTenCoverage {
  slots: number;
  /** Slots whose institution has at least one live fee. */
  live: number;
  /** Slots whose institution has a live overdraft fee. */
  liveOverdraft: number;
  /** Institutions holding a slot with nothing live, each with every slot it holds. */
  missing: Map<number, TopTenSlot[]>;
}

/** Pure: count the 50-state-plus-DC top-10 slots against what is live. */
export function summarizeTopTen(leaders: MarketLeader[], live: Map<number, LiveFacts>): TopTenCoverage {
  const states = new Set<string>(STATES_AND_DC);
  const slots = leaders.filter((l) => l.deposit_rank <= TOP_TEN_PER_STATE && states.has(l.state_code));
  const missing = new Map<number, TopTenSlot[]>();
  let liveCount = 0;
  let liveOverdraft = 0;
  for (const slot of slots) {
    const facts = live.get(slot.institution_id);
    if (facts && facts.types > 0) {
      liveCount += 1;
      if (facts.hasOverdraft) liveOverdraft += 1;
    } else {
      const held = missing.get(slot.institution_id) ?? [];
      held.push({ stateCode: slot.state_code, rank: slot.deposit_rank });
      missing.set(slot.institution_id, held);
    }
  }
  return { slots: slots.length, live: liveCount, liveOverdraft, missing };
}

export async function getTopTenCoverage(db: SqlTag = sql): Promise<TopTenCoverage> {
  const leaders = await getMarketLeaders({ db, perState: TOP_TEN_PER_STATE });
  const ids = [...new Set(leaders.map((l) => l.institution_id))];
  const rows =
    ids.length === 0
      ? []
      : await db<Array<{ institution_id: number | string; types: number | string; has_overdraft: boolean }>>`
          -- top 10 per state: live fees for the slot holders
          SELECT institution_id, count(DISTINCT canonical_fee_key)::int AS types,
                 bool_or(canonical_fee_key = 'overdraft') AS has_overdraft
            FROM published_fee_catalog
           WHERE institution_id = ANY(${ids}::bigint[])
           GROUP BY institution_id
        `;
  const live = new Map<number, LiveFacts>(
    rows.map((row) => [Number(row.institution_id), { types: Number(row.types), hasOverdraft: Boolean(row.has_overdraft) }]),
  );
  return summarizeTopTen(leaders, live);
}
