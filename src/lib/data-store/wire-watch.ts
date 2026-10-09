import { sql } from "./connection";

/**
 * The states a Pro reader watches on the Regulatory Wire (reg_wire_watched_states,
 * migration 20270110000029). Every read and write is scoped to one user id; the caller (a
 * server action or a Pro page) has already checked that the user is signed in with Pro.
 */

/** Most states one reader can watch. */
export const MAX_WATCHED_STATES = 10;

export interface WatchedState {
  stateCode: string;
  createdAt: string | null;
  /** When the reader last opened My states (ISO); null before the first visit. */
  lastViewedAt: string | null;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The reader's watched states, alphabetical. Empty when none, or when the table is not there yet. */
export async function getWatchedStates(userId: number): Promise<WatchedState[]> {
  try {
    const rows = (await sql`
      SELECT state_code, created_at, last_viewed_at
        FROM reg_wire_watched_states
       WHERE user_id = ${userId}
       ORDER BY state_code
    `) as unknown as { state_code: string; created_at: unknown; last_viewed_at: unknown }[];
    return rows.map((r) => ({ stateCode: r.state_code, createdAt: iso(r.created_at), lastViewedAt: iso(r.last_viewed_at) }));
  } catch (error) {
    console.error("[wire-watch] watched states read failed", error);
    return [];
  }
}

export type WatchWriteResult = { ok: true } | { ok: false; reason: "limit" | "failed" };

/** Adds a state; watching one already watched is a no-op. */
export async function watchState(userId: number, stateCode: string): Promise<WatchWriteResult> {
  try {
    const [row] = (await sql`
      SELECT COUNT(*)::int AS n,
             BOOL_OR(state_code = ${stateCode}) AS has
        FROM reg_wire_watched_states
       WHERE user_id = ${userId}
    `) as unknown as { n: number; has: boolean | null }[];
    if (row?.has) return { ok: true };
    if (Number(row?.n ?? 0) >= MAX_WATCHED_STATES) return { ok: false, reason: "limit" };
    await sql`
      INSERT INTO reg_wire_watched_states (user_id, state_code)
      VALUES (${userId}, ${stateCode})
      ON CONFLICT (user_id, state_code) DO NOTHING
    `;
    return { ok: true };
  } catch (error) {
    console.error("[wire-watch] watch failed", error);
    return { ok: false, reason: "failed" };
  }
}

export async function unwatchState(userId: number, stateCode: string): Promise<WatchWriteResult> {
  try {
    await sql`DELETE FROM reg_wire_watched_states WHERE user_id = ${userId} AND state_code = ${stateCode}`;
    return { ok: true };
  } catch (error) {
    console.error("[wire-watch] unwatch failed", error);
    return { ok: false, reason: "failed" };
  }
}

/** Records that the reader opened My states now. A failure only loses the next "new" count. */
export async function markWatchedStatesViewed(userId: number, at: Date): Promise<void> {
  try {
    await sql`
      UPDATE reg_wire_watched_states SET last_viewed_at = ${at.toISOString()}::timestamptz
       WHERE user_id = ${userId}
    `;
  } catch (error) {
    console.error("[wire-watch] mark viewed failed", error);
  }
}

/** Watched states for many readers at once (the Monday digest). Readers who watch none are absent. */
export async function getWatchedStatesForUsers(userIds: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (userIds.length === 0) return out;
  const rows = (await sql`
    SELECT user_id, state_code
      FROM reg_wire_watched_states
     WHERE user_id = ANY(${userIds}::bigint[])
     ORDER BY user_id, state_code
  `) as unknown as { user_id: number | string; state_code: string }[];
  for (const row of rows) {
    const id = Number(row.user_id);
    const list = out.get(id) ?? [];
    list.push(row.state_code);
    out.set(id, list);
  }
  return out;
}
