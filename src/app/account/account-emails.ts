import { sql } from "@/lib/data-store/connection";
import type { AccountEmailKind } from "./email-kinds";

/**
 * Which Pro emails are on for this user, read from the columns the stop links set.
 * Null when they can't be read, so the page hides the switches instead of guessing.
 */
export async function getAccountEmails(userId: number): Promise<Record<AccountEmailKind, boolean> | null> {
  try {
    const rows = await sql<{ watchlist_off: string | null; digest_off: string | null }[]>`
      SELECT to_jsonb(u.*) ->> 'watchlist_alerts_off_at' AS watchlist_off,
             to_jsonb(u.*) ->> 'pro_digest_off_at' AS digest_off
        FROM users u
       WHERE u.id = ${userId}`;
    const row = rows[0];
    if (!row) return null;
    return { watchlist_alerts: row.watchlist_off == null, pro_digest: row.digest_off == null };
  } catch {
    return null;
  }
}
