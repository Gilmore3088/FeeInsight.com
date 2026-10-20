/**
 * The institution a Pro buyer chose at checkout (Stripe metadata `institution_id`) becomes
 * their workspace bank and profile, and the link to it is recorded as an open request. Their
 * business email proves it (James, 2026-10-15, #1405): once the email is confirmed and its domain
 * matches the bank's website, the owner seat is granted with no review; otherwise the request
 * waits for an admin check, and Pro itself works meanwhile. A choice the user already made, or a
 * membership they already hold, is never overwritten.
 */
import type { sql as sqlClient } from "@/lib/data-store/connection";
import { linkVerifiedInstitutions } from "@/lib/pro-institution-link";

type Db = typeof sqlClient;

/**
 * `hamilton_workspace_contexts.last_intent` for a bank picked before paying (the welcome step).
 * It pre-fills /subscribe, and the bank paid for at checkout, or a team's bank on an invite,
 * replaces it; any later choice keeps its own intent and is never overwritten.
 */
export const PRE_CHECKOUT_INTENT = "before_pro_checkout";

/** A positive integer institution id from Stripe metadata, else null. */
export function paidInstitutionId(metadata: Record<string, string> | null | undefined): number | null {
  const id = Number(metadata?.institution_id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function anchorPaidInstitution(db: Db, params: { userId: number; institutionId: number; note: string }): Promise<void> {
  const { userId, institutionId, note } = params;

  // Workspace bank, unless the user already chose one after paying; a pick made before checkout
  // gives way to the bank actually paid for.
  await db`
    INSERT INTO hamilton_workspace_contexts (user_id, selected_institution_id, selected_source, last_intent, created_at, updated_at)
    SELECT ${userId}, s.id, 'profile', 'pro_checkout', NOW(), NOW()
      FROM institution_sources s
     WHERE s.id = ${institutionId}
    ON CONFLICT (user_id) DO UPDATE SET
      selected_institution_id = EXCLUDED.selected_institution_id,
      selected_source = EXCLUDED.selected_source,
      last_intent = EXCLUDED.last_intent,
      updated_at = NOW()
    WHERE hamilton_workspace_contexts.last_intent = ${PRE_CHECKOUT_INTENT}
  `;

  // Profile fields every screen reads, the same ones adoptInstitution sets, when still empty.
  await db`
    UPDATE users u
       SET institution_name = s.institution_name,
           institution_type = CASE WHEN s.charter_type IN ('bank', 'credit_union') THEN s.charter_type ELSE u.institution_type END,
           asset_tier       = s.asset_size_tier,
           state_code       = s.state_code,
           fed_district     = s.fed_district
      FROM institution_sources s
     WHERE u.id = ${userId}
       AND s.id = ${institutionId}
       AND (u.institution_name IS NULL OR u.institution_name = '')
  `;

  // The link request, open until the email proves it or an admin checks it, unless the user is already a member.
  const claims = await db<Array<{ id: number }>>`
    INSERT INTO institution_claims (institution_id, claimant_user_id, claimant_role, claim_notes, review_status, created_at, updated_at)
    SELECT ${institutionId}, ${userId}, COALESCE(NULLIF(u.job_role, ''), 'institution_employee'), ${note}, 'pending', NOW(), NOW()
      FROM users u
     WHERE u.id = ${userId}
       AND EXISTS (SELECT 1 FROM institution_sources s WHERE s.id = ${institutionId})
       AND NOT EXISTS (
         SELECT 1 FROM institution_workspace_memberships m
          WHERE m.institution_id = ${institutionId} AND m.user_id = ${userId} AND m.membership_status = 'active'
       )
    ON CONFLICT (institution_id, claimant_user_id) WHERE review_status IN ('pending', 'needs_info') DO NOTHING
    RETURNING id
  `;
  for (const claim of claims) {
    await db`
      INSERT INTO institution_claim_events (claim_id, actor_user_id, event_type, previous_status, new_status, notes, metadata)
      VALUES (${claim.id}, ${userId}, 'submitted', NULL, 'pending', ${note}, ${db.json({ institution_id: institutionId, source: "pro_checkout" })})
    `;
  }

  // The owner seat, only when the confirmed business email matches the bank's website.
  await linkVerifiedInstitutions(db, userId);
}

/**
 * The institution a signed-in buyer already chose, so /subscribe prices it without another
 * search (#1958): their linked institution, else the one waiting for the link check, else the
 * bank they saved (at the welcome step or in Settings). Null when there is none or the read
 * fails. Only a pre-fill: the page and checkout both re-read the institution for the tier.
 */
export async function chosenProInstitutionId(db: Db, userId: number | string): Promise<number | null> {
  // users.id is bigint, which postgres.js returns as a string ("26").
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  try {
    const [row] = await db<Array<{ institution_id: number | string | null }>>`
      SELECT COALESCE(
        (SELECT m.institution_id FROM institution_workspace_memberships m
          WHERE m.user_id = ${id} AND m.membership_status = 'active'
          ORDER BY m.granted_at DESC NULLS LAST, m.id DESC LIMIT 1),
        (SELECT c.institution_id FROM institution_claims c
          WHERE c.claimant_user_id = ${id} AND c.review_status IN ('pending', 'needs_info')
          ORDER BY c.updated_at DESC, c.id DESC LIMIT 1),
        (SELECT w.selected_institution_id FROM hamilton_workspace_contexts w WHERE w.user_id = ${id} LIMIT 1)
      ) AS institution_id
    `;
    const chosen = Number(row?.institution_id);
    return Number.isSafeInteger(chosen) && chosen > 0 ? chosen : null;
  } catch {
    return null;
  }
}
