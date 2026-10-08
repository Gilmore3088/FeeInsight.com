"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { sql } from "@/lib/data-store/connection";
import type { AccountEmailKind } from "./email-kinds";

/**
 * Turns one of the signed-in user's Pro emails on or off. The same columns the one-click
 * unsubscribe links set (`/api/alerts/unsubscribe`), so the account page can also turn an
 * email back on after a stop link was used. Scoped to the session's numeric user id.
 */
export async function setAccountEmail(
  kind: AccountEmailKind,
  on: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in again to change your emails." };

  try {
    if (kind === "watchlist_alerts") {
      if (on) await sql`UPDATE users SET watchlist_alerts_off_at = NULL WHERE id = ${user.id}`;
      else await sql`UPDATE users SET watchlist_alerts_off_at = COALESCE(watchlist_alerts_off_at, NOW()) WHERE id = ${user.id}`;
    } else if (kind === "pro_digest") {
      if (on) await sql`UPDATE users SET pro_digest_off_at = NULL WHERE id = ${user.id}`;
      else await sql`UPDATE users SET pro_digest_off_at = COALESCE(pro_digest_off_at, NOW()) WHERE id = ${user.id}`;
    } else {
      return { ok: false, error: "Unknown email." };
    }
  } catch {
    return { ok: false, error: "That didn't save. Try again." };
  }
  revalidatePath("/account");
  return { ok: true };
}
