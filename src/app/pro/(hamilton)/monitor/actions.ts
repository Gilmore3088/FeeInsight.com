"use server";

/**
 * Monitor Screen — Server Actions for watchlist mutations.
 * All mutations scoped to userId — no cross-user access possible.
 */

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { sql } from "@/lib/data-store/connection";
import { getHamiltonInstitutionContext, parseInstitutionId } from "@/lib/hamilton/institution-context";
import { createWatchlistEntryFromInstitution, type WatchlistEntry } from "@/lib/hamilton/monitor-data";
import { setHamiltonWorkspaceContext } from "@/lib/hamilton/workspace-context";

export type WatchlistActionResult =
  | { ok: true; entry?: WatchlistEntry; message?: string }
  | { ok: false; error: string };

/**
 * Add an institution to the user's watchlist.
 * Creates a watchlist row if one does not yet exist.
 * Deduplicates — adding an already-tracked institution is a no-op.
 */
export async function addToWatchlist(
  institutionId: string
): Promise<WatchlistActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in before changing your watchlist." };
  if (!canAccessPremium(user)) return { ok: false, error: "An active Hamilton subscription is required." };

  const parsedId = parseInstitutionId(institutionId);
  if (!parsedId) {
    return { ok: false, error: "Select a matched institution before watching it." };
  }

  const { institution, error } = await getHamiltonInstitutionContext(parsedId);
  if (!institution) {
    return { ok: false, error: error ?? "Institution not found." };
  }

  const normalizedId = String(institution.id);
  const entry = createWatchlistEntryFromInstitution(institution);

  const existing = await sql`
    SELECT id, institution_ids
    FROM hamilton_watchlists
    WHERE user_id = ${user.id}
    LIMIT 1
  `;

  if (existing.length === 0) {
    await sql`
      INSERT INTO hamilton_watchlists
        (
          user_id,
          institution_ids,
          fee_categories,
          regions,
          peer_set_ids,
          selected_source,
          selected_source_label
        )
      VALUES
        (
          ${user.id},
          ${JSON.stringify([normalizedId])}::jsonb,
          '[]'::jsonb,
          '[]'::jsonb,
          '[]'::jsonb,
          'watchlist',
          'Watchlist'
        )
    `;
  } else {
    const currentIds: string[] = Array.isArray(existing[0].institution_ids)
      ? (existing[0].institution_ids as unknown[]).map((id) => String(id))
      : [];

    if (currentIds.includes(normalizedId)) {
      await setHamiltonWorkspaceContext({
        userId: user.id,
        institutionId: institution.id,
        source: "watchlist",
        intent: "monitor",
      }).catch(() => {});
      revalidatePath("/pro/monitor");
      return { ok: true, entry, message: "Already tracking this institution." };
    }

    const updatedIds = [...currentIds, normalizedId];
    await sql`
      UPDATE hamilton_watchlists
      SET institution_ids = ${JSON.stringify(updatedIds)}::jsonb,
          selected_source = 'watchlist',
          selected_source_label = 'Watchlist',
          updated_at = NOW()
      WHERE user_id = ${user.id}
    `;
  }

  await setHamiltonWorkspaceContext({
    userId: user.id,
    institutionId: institution.id,
    source: "watchlist",
    intent: "monitor",
  }).catch(() => {});
  revalidatePath("/pro/monitor");
  return { ok: true, entry };
}

/**
 * Remove an institution from the user's watchlist.
 * No-op if the institution is not currently tracked.
 */
export async function removeFromWatchlist(
  institutionId: string
): Promise<WatchlistActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in before changing your watchlist." };
  if (!canAccessPremium(user)) return { ok: false, error: "An active Hamilton subscription is required." };

  const parsedId = parseInstitutionId(institutionId);
  if (!parsedId) {
    return { ok: false, error: "Invalid institution ID." };
  }

  const existing = await sql`
    SELECT institution_ids
    FROM hamilton_watchlists
    WHERE user_id = ${user.id}
    LIMIT 1
  `;

  if (existing.length === 0) return { ok: true };

  const currentIds: string[] = Array.isArray(existing[0].institution_ids)
    ? (existing[0].institution_ids as unknown[]).map((id) => String(id))
    : [];

  const updatedIds = currentIds.filter((id) => id !== String(parsedId));

  await sql`
    UPDATE hamilton_watchlists
    SET institution_ids = ${JSON.stringify(updatedIds)}::jsonb,
        updated_at = NOW()
    WHERE user_id = ${user.id}
  `;

  revalidatePath("/pro/monitor");
  return { ok: true };
}
