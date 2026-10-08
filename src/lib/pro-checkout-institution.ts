/**
 * The institution a Pro buyer chose at checkout (Stripe metadata `institution_id`) becomes
 * their workspace bank and profile, and their claim to it is filed for review, so a new
 * subscriber lands on their own bank instead of an empty "Choose your bank" screen and never
 * has to file the claim by hand. A choice the user already made is never overwritten.
 */
import type { sql as sqlClient } from "@/lib/data-store/connection";

type Db = typeof sqlClient;

/** A positive integer institution id from Stripe metadata, else null. */
export function paidInstitutionId(metadata: Record<string, string> | null | undefined): number | null {
  const id = Number(metadata?.institution_id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function anchorPaidInstitution(db: Db, params: { userId: number; institutionId: number; note: string }): Promise<void> {
  const { userId, institutionId, note } = params;

  // Workspace bank, unless the user already chose one.
  await db`
    INSERT INTO hamilton_workspace_contexts (user_id, selected_institution_id, selected_source, created_at, updated_at)
    SELECT ${userId}, s.id, 'profile', NOW(), NOW()
      FROM institution_sources s
     WHERE s.id = ${institutionId}
    ON CONFLICT (user_id) DO NOTHING
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

  // The claim that unlocks team seats, filed for review unless one is open or already granted.
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
}
