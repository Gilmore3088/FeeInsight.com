"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { sql, withTransaction } from "@/lib/data-store/connection";
import { getHamiltonInstitutionContext } from "@/lib/hamilton/institution-context";
import { setHamiltonWorkspaceContext } from "@/lib/hamilton/workspace-context";
import { adoptInstitution } from "@/lib/hamilton/adopt-institution";
import {
  getActiveInstitutionMembership,
  getInstitutionWorkspaceSeatUsage,
  createInstitutionWorkspaceInvitation,
  grantInstitutionWorkspaceMembership,
  revokeInstitutionWorkspaceInvitation,
  revokeInstitutionWorkspaceMembership,
  type InstitutionWorkspaceMembershipRole,
} from "@/lib/hamilton/institution-membership";
import { hasOpenSeat, seatLimitMessage } from "@/lib/hamilton/workspace-seats";
import {
  getSavedPeerSets,
  savePeerSet,
  deletePeerSet,
} from "@/lib/data-store/saved-peers";

export type WorkspaceInstitutionState = {
  success: boolean;
  error?: string;
  institutionId?: number;
  institutionName?: string;
};

export type InstitutionClaimReviewStatus = "pending" | "accepted" | "rejected" | "needs_info";

export type InstitutionClaimState = {
  id: number;
  institutionId: number;
  reviewStatus: InstitutionClaimReviewStatus;
  resolution: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
};

export type InstitutionClaimActionState = {
  success: boolean;
  error?: string;
  message?: string;
  claim?: InstitutionClaimState;
};

export type WorkspaceAccessActionState = {
  success: boolean;
  error?: string;
  message?: string;
};

const WorkspaceInstitutionSchema = z.object({
  institution_id: z.coerce.number().int().positive(),
});

export async function updateWorkspaceInstitution(
  _prev: WorkspaceInstitutionState,
  formData: FormData,
): Promise<WorkspaceInstitutionState> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }
  if (!canAccessPremium(user)) {
    return { success: false, error: "An active Hamilton subscription is required." };
  }

  const parsed = WorkspaceInstitutionSchema.safeParse({
    institution_id: formData.get("institution_id"),
  });
  if (!parsed.success) {
    return { success: false, error: "Enter a valid institution ID." };
  }

  const institution = await adoptInstitution({
    userId: user.id,
    institutionId: parsed.data.institution_id,
    setWorkspace: true,
    source: "manual",
    intent: "settings",
  });
  if (!institution) {
    return { success: false, error: "Institution not found." };
  }

  revalidatePath("/pro");
  revalidatePath("/pro/settings");

  return {
    success: true,
    institutionId: institution.id,
    institutionName: institution.name,
  };
}

const InstitutionClaimSchema = z.object({
  institution_id: z.coerce.number().int().positive(),
  claim_notes: z.string().trim().max(2_000).optional(),
});

function mapClaimRow(row: Record<string, unknown>): InstitutionClaimState {
  return {
    id: Number(row.id),
    institutionId: Number(row.institution_id),
    reviewStatus: String(row.review_status ?? "pending") as InstitutionClaimReviewStatus,
    resolution: row.resolution ? String(row.resolution) : null,
    reviewNotes: row.review_notes ? String(row.review_notes) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
  };
}

export async function getWorkspaceInstitutionClaimState(
  institutionId: number | null | undefined,
): Promise<InstitutionClaimState | null> {
  if (!institutionId) return null;
  const user = await getCurrentUser();
  if (!user) return null;

  try {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT id, institution_id, review_status, resolution, review_notes,
             created_at, updated_at, reviewed_at
      FROM institution_claims
      WHERE claimant_user_id = ${user.id}
        AND institution_id = ${institutionId}
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `;
    return rows[0] ? mapClaimRow(rows[0]) : null;
  } catch {
    return null;
  }
}

export async function requestInstitutionClaim(
  _prev: InstitutionClaimActionState,
  formData: FormData,
): Promise<InstitutionClaimActionState> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Sign in before requesting claim review." };
  }
  if (!canAccessPremium(user)) {
    return { success: false, error: "Upgrade to request authenticated institution claim review." };
  }

  const parsed = InstitutionClaimSchema.safeParse({
    institution_id: formData.get("institution_id"),
    claim_notes: formData.get("claim_notes") || undefined,
  });
  if (!parsed.success) {
    return { success: false, error: "Select a valid institution before requesting claim review." };
  }

  const { institution, error } = await getHamiltonInstitutionContext(parsed.data.institution_id);
  if (!institution) {
    return { success: false, error: error ?? "Institution not found." };
  }

  try {
    let claim: InstitutionClaimState | null = null;
    let wasResubmitted = false;
    let previousStatus: string | null = null;

    await withTransaction(async (tx) => {
      const existing = await tx<{ id: number; review_status: string }[]>`
        SELECT id, review_status
        FROM institution_claims
        WHERE institution_id = ${institution.id}
          AND claimant_user_id = ${user.id}
          AND review_status IN ('pending', 'needs_info')
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `;
      if (existing[0]) {
        wasResubmitted = true;
        previousStatus = existing[0].review_status;
      }

      const rows = await tx<Record<string, unknown>[]>`
        INSERT INTO institution_claims (
          institution_id,
          claimant_user_id,
          claimant_role,
          claim_notes,
          review_status,
          created_at,
          updated_at
        ) VALUES (
          ${institution.id},
          ${user.id},
          ${user.job_role || "institution_employee"},
          ${parsed.data.claim_notes || null},
          'pending',
          NOW(),
          NOW()
        )
        ON CONFLICT (institution_id, claimant_user_id)
        WHERE review_status IN ('pending', 'needs_info')
        DO UPDATE SET
          claimant_role = EXCLUDED.claimant_role,
          claim_notes = EXCLUDED.claim_notes,
          review_status = 'pending',
          reviewed_at = NULL,
          reviewer_id = NULL,
          review_notes = NULL,
          resolution = NULL,
          updated_at = NOW()
        RETURNING id, institution_id, review_status, resolution, review_notes,
                  created_at, updated_at, reviewed_at
      `;
      claim = rows[0] ? mapClaimRow(rows[0]) : null;

      if (claim) {
        await tx`
          INSERT INTO institution_claim_events (
            claim_id,
            actor_user_id,
            event_type,
            previous_status,
            new_status,
            notes,
            metadata
          ) VALUES (
            ${claim.id},
            ${user.id},
            ${wasResubmitted ? "resubmitted" : "submitted"},
            ${previousStatus},
            'pending',
            ${parsed.data.claim_notes || null},
            ${sql.json({
              institution_id: institution.id,
              claimant_role: user.job_role || "institution_employee",
              source: "hamilton_settings",
            })}
          )
        `;
      }
    });

    await setHamiltonWorkspaceContext({
      userId: user.id,
      institutionId: institution.id,
      source: "manual",
      intent: "claim-review",
    }).catch(() => {});

    revalidatePath("/admin/quality");
    revalidatePath("/pro/settings");
    revalidatePath(`/institution/${institution.id}`);

    return {
      success: true,
      message:
        wasResubmitted
          ? "Claim review request updated and returned to the pending queue."
          : "Claim review request submitted to the Data Trust queue.",
      claim: claim ?? undefined,
    };
  } catch (e) {
    console.error("requestInstitutionClaim failed:", e);
    return {
      success: false,
      error: "Claim queue is not available yet. Apply the latest migration and try again.",
    };
  }
}

const WorkspaceAccessGrantSchema = z.object({
  institution_id: z.coerce.number().int().positive(),
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  role: z.enum(["admin", "analyst", "viewer"]),
  notes: z.string().trim().max(1_000).optional(),
});

const WorkspaceAccessRevokeSchema = z.object({
  institution_id: z.coerce.number().int().positive(),
  membership_id: z.coerce.number().int().positive(),
});

const WorkspaceInvitationRevokeSchema = z.object({
  institution_id: z.coerce.number().int().positive(),
  invitation_id: z.coerce.number().int().positive(),
});

async function canManageSelectedInstitution(
  userId: number,
  institutionId: number,
  platformRole: string,
): Promise<boolean> {
  if (platformRole === "admin" || platformRole === "analyst") return true;
  const membership = await getActiveInstitutionMembership({
    userId,
    institutionId,
  }).catch(() => null);
  return membership?.role === "owner" || membership?.role === "admin";
}

type GrantOutcome =
  | { kind: "full"; limit: number }
  | { kind: "invited"; email: string }
  | { kind: "granted" }
  | { kind: "failed"; error: string };

/**
 * Adds a person to an institution account. Nothing is emailed: an invitation is saved, and
 * the owner copies the /workspace-invite link to the invitee. A seat on a paid institution
 * account gives the invitee Pro access, so nobody needs to pay to accept. At most
 * WORKSPACE_SEAT_LIMIT people per institution (the owner included); the count and the write
 * run under one per-institution lock so two invites cannot both take the last seat.
 */
export async function grantWorkspaceAccess(
  _prev: WorkspaceAccessActionState,
  formData: FormData,
): Promise<WorkspaceAccessActionState> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Sign in before managing workspace access." };
  if (!canAccessPremium(user)) {
    return { success: false, error: "Upgrade before managing workspace access." };
  }

  const parsed = WorkspaceAccessGrantSchema.safeParse({
    institution_id: formData.get("institution_id"),
    email: formData.get("email"),
    role: formData.get("role"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid workspace access request." };
  }

  const { institution, error } = await getHamiltonInstitutionContext(parsed.data.institution_id);
  if (!institution) return { success: false, error: error ?? "Institution not found." };

  const canManage = await canManageSelectedInstitution(user.id, institution.id, user.role);
  if (!canManage) {
    return { success: false, error: "Only institution owners or admins can manage workspace access." };
  }

  const granteeRows = await sql<Array<{
    id: number;
    display_name: string | null;
    email: string | null;
  }>>`
    SELECT id, display_name, email
    FROM users
    WHERE LOWER(email) = ${parsed.data.email}
      AND is_active = true
    LIMIT 1
  `;
  const grantee = granteeRows[0];
  if (grantee && grantee.id === user.id) {
    return { success: false, error: "Your own workspace role is managed through institution claim authority." };
  }

  const role = parsed.data.role;
  let outcome: GrantOutcome;
  try {
    outcome = await withTransaction(async (tx): Promise<GrantOutcome> => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('institution_workspace_seats'), ${institution.id})`;
      const seats = await getInstitutionWorkspaceSeatUsage(
        { institutionId: institution.id, email: parsed.data.email },
        tx,
      );
      if (!seats.emailHoldsSeat && !hasOpenSeat(seats.used, seats.limit)) {
        return { kind: "full", limit: seats.limit };
      }

      if (!grantee) {
        const invitation = await createInstitutionWorkspaceInvitation(
          {
            institutionId: institution.id,
            email: parsed.data.email,
            role,
            invitedByUserId: user.id,
            notes: parsed.data.notes || `Pending ${role} access from Hamilton Settings.`,
          },
          tx,
        );
        return invitation
          ? { kind: "invited", email: invitation.email }
          : { kind: "failed", error: "Workspace invitation could not be saved." };
      }

      const membership = await grantInstitutionWorkspaceMembership(
        {
          institutionId: institution.id,
          userId: grantee.id,
          role: role as InstitutionWorkspaceMembershipRole,
          source: "delegated",
          grantedByUserId: user.id,
          notes: parsed.data.notes || `Delegated ${role} access from Hamilton Settings.`,
        },
        tx,
      );
      return membership
        ? { kind: "granted" }
        : { kind: "failed", error: "Workspace access could not be granted." };
    });
  } catch (e) {
    console.error("grantWorkspaceAccess failed:", e);
    return { success: false, error: "Workspace access could not be saved. Try again." };
  }

  if (outcome.kind === "full") return { success: false, error: seatLimitMessage(outcome.limit) };
  if (outcome.kind === "failed") return { success: false, error: outcome.error };

  revalidatePath("/pro/settings");
  if (outcome.kind === "invited") {
    return {
      success: true,
      message: `Invite saved for ${outcome.email} (${role}). Copy the invite link and send it to them. They sign in or create a free account with ${outcome.email} to join; they don't pay for a seat.`,
    };
  }

  revalidatePath("/account");
  return {
    success: true,
    message: `${grantee?.display_name ?? grantee?.email ?? "User"} now has ${role} access to ${institution.name}.`,
  };
}

export async function revokeWorkspaceAccess(
  _prev: WorkspaceAccessActionState,
  formData: FormData,
): Promise<WorkspaceAccessActionState> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Sign in before managing workspace access." };
  if (!canAccessPremium(user)) {
    return { success: false, error: "Upgrade before managing workspace access." };
  }

  const parsed = WorkspaceAccessRevokeSchema.safeParse({
    institution_id: formData.get("institution_id"),
    membership_id: formData.get("membership_id"),
  });
  if (!parsed.success) {
    return { success: false, error: "Invalid workspace member selection." };
  }

  const { institution, error } = await getHamiltonInstitutionContext(parsed.data.institution_id);
  if (!institution) return { success: false, error: error ?? "Institution not found." };

  const canManage = await canManageSelectedInstitution(user.id, institution.id, user.role);
  if (!canManage) {
    return { success: false, error: "Only institution owners or admins can revoke workspace access." };
  }

  const rows = await sql<Array<{ user_id: number; membership_role: string }>>`
    SELECT user_id, membership_role
    FROM institution_workspace_memberships
    WHERE id = ${parsed.data.membership_id}
      AND institution_id = ${institution.id}
      AND membership_status = 'active'
    LIMIT 1
  `;
  const target = rows[0];
  if (!target) return { success: false, error: "Active workspace membership not found." };
  if (target.user_id === user.id) {
    return { success: false, error: "You cannot revoke your own active workspace access here." };
  }
  if (target.membership_role === "owner" && user.role !== "admin") {
    return { success: false, error: "Only a platform admin can revoke owner workspace authority." };
  }

  const revoked = await revokeInstitutionWorkspaceMembership({
    membershipId: parsed.data.membership_id,
    revokedByUserId: user.id,
  });
  if (!revoked) return { success: false, error: "Workspace access could not be revoked." };

  revalidatePath("/pro/settings");
  revalidatePath("/account");

  return {
    success: true,
    message: `${revoked.userDisplayName ?? revoked.userEmail ?? "User"} no longer has ${revoked.role} access to ${institution.name}.`,
  };
}

export async function revokeWorkspaceInvitation(
  _prev: WorkspaceAccessActionState,
  formData: FormData,
): Promise<WorkspaceAccessActionState> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Sign in before managing workspace invitations." };
  if (!canAccessPremium(user)) {
    return { success: false, error: "Upgrade before managing workspace invitations." };
  }

  const parsed = WorkspaceInvitationRevokeSchema.safeParse({
    institution_id: formData.get("institution_id"),
    invitation_id: formData.get("invitation_id"),
  });
  if (!parsed.success) {
    return { success: false, error: "Invalid workspace invitation selection." };
  }

  const { institution, error } = await getHamiltonInstitutionContext(parsed.data.institution_id);
  if (!institution) return { success: false, error: error ?? "Institution not found." };

  const canManage = await canManageSelectedInstitution(user.id, institution.id, user.role);
  if (!canManage) {
    return { success: false, error: "Only institution owners or admins can revoke workspace invitations." };
  }

  const revoked = await revokeInstitutionWorkspaceInvitation({
    invitationId: parsed.data.invitation_id,
    institutionId: institution.id,
    revokedByUserId: user.id,
  });
  if (!revoked) return { success: false, error: "Pending workspace invitation not found." };

  revalidatePath("/pro/settings");

  return {
    success: true,
    message: `${revoked.email} no longer has a pending ${revoked.role} invitation for ${institution.name}.`,
  };
}

// ─── Peer Set Management (SET-02) ─────────────────────────────────────────────

const PeerSetSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  charter_type: z.enum(["bank", "credit_union"]).nullable(),
  asset_tiers: z.array(z.enum(["a", "b", "c", "d", "e", "f"])).optional(),
  fed_districts: z.array(z.coerce.number().int().min(1).max(12)).optional(),
});

const MAX_SAVED_PEER_SETS = 10;

export async function createPeerSet(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };
  if (!canAccessPremium(user)) return { success: false, error: "An active Hamilton subscription is required." };
  const existing = await getSavedPeerSets(String(user.id));
  if (existing.length >= MAX_SAVED_PEER_SETS) {
    return { success: false, error: `You can save up to ${MAX_SAVED_PEER_SETS} peer sets. Remove one to add another.` };
  }

  const raw = {
    name: formData.get("name"),
    charter_type: formData.get("charter_type") || null,
    asset_tiers: formData.getAll("asset_tiers").filter(Boolean) as string[],
    fed_districts: formData.getAll("fed_districts").filter(Boolean).map(Number),
  };

  const parsed = PeerSetSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const id = await savePeerSet(
    parsed.data.name,
    {
      charter_type: parsed.data.charter_type ?? undefined,
      asset_tiers: parsed.data.asset_tiers,
      fed_districts: parsed.data.fed_districts,
    },
    String(user.id)
  );

  revalidatePath("/pro/settings");
  return { success: true, id };
}

export async function removePeerSet(id: number) {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };
  if (!canAccessPremium(user)) return { success: false, error: "An active Hamilton subscription is required." };

  await deletePeerSet(id, String(user.id));
  revalidatePath("/pro/settings");
  return { success: true };
}

// ─── Intelligence Snapshot (SET-05) ───────────────────────────────────────────

export interface IntelligenceSnapshot {
  tier: string;
  savedAnalyses: number;
  savedScenarios: number;
  lastActivity: string | null;
}

export async function getIntelligenceSnapshot(): Promise<IntelligenceSnapshot> {
  const user = await getCurrentUser();
  if (!user) return { tier: "Unknown", savedAnalyses: 0, savedScenarios: 0, lastActivity: null };

  let savedAnalyses = 0;
  let savedScenarios = 0;
  let lastActivity: string | null = null;

  try {
    const aRows = await sql`
      SELECT COUNT(*)::int as count FROM hamilton_saved_analyses
      WHERE user_id = ${user.id} AND status = 'active'
    `;
    savedAnalyses = aRows[0]?.count ?? 0;
  } catch { /* table may not exist yet */ }

  try {
    const sRows = await sql`
      SELECT COUNT(*)::int as count FROM hamilton_scenarios
      WHERE user_id = ${user.id} AND status = 'active'
    `;
    savedScenarios = sRows[0]?.count ?? 0;
  } catch { /* table may not exist yet */ }

  try {
    const lRows = await sql`
      SELECT MAX(updated_at) as last_active FROM hamilton_saved_analyses
      WHERE user_id = ${user.id}
    `;
    lastActivity = lRows[0]?.last_active ? String(lRows[0].last_active) : null;
  } catch { /* table may not exist yet */ }

  return {
    tier: user.role === "admin" ? "Admin" : "Professional",
    savedAnalyses,
    savedScenarios,
    lastActivity,
  };
}
