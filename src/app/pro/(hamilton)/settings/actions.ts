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
  revokeInstitutionWorkspaceInvitation,
  revokeInstitutionWorkspaceMembership,
} from "@/lib/hamilton/institution-membership";
import { hasOpenSeat, seatLimitMessage } from "@/lib/hamilton/workspace-seats";
import {
  INVITE_SECRET_MISSING_MESSAGE,
  buildWorkspaceInvitePath,
  inviteLinksConfigured,
} from "@/lib/hamilton/workspace-invite-link";
import {
  getSavedPeerSets,
  savePeerSet,
  deletePeerSet,
  updatePeerSet,
  setDefaultPeerSet,
  getPeerSetWorkspace,
  getPeerInstitutionNames,
  type SavedPeerSet,
} from "@/lib/data-store/saved-peers";
import { getPeerGroupCounts, type PeerGroupCount } from "@/lib/data-store/fee-index";
import { parseSavedPeerSetFilters } from "@/lib/hamilton/peer-index";
import { STATE_NAMES } from "@/lib/us-states";

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
  /** Signed /workspace-invite path for a new invitation; the page adds its own origin. */
  inviteLink?: string;
  inviteEmail?: string;
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
  | { kind: "invited"; email: string; inviteLink: string }
  | { kind: "failed"; error: string };

/**
 * Invites a person to an institution account. Every grant is an invitation, an existing
 * account included: the seat becomes active only when the invitee opens the signed invite
 * link while signed in with the invited email (`acceptSignedWorkspaceInvite`). Nothing is
 * emailed; the owner copies the link this returns. A seat on a paid institution account
 * gives Pro access, so nobody pays to accept. At most WORKSPACE_SEAT_LIMIT people per
 * institution (the owner included); the count and the write run under one per-institution
 * lock so two invites cannot both take the last seat.
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
  // Fail closed before anything is saved: an invite nobody can accept is no use.
  if (!inviteLinksConfigured()) {
    return { success: false, error: INVITE_SECRET_MISSING_MESSAGE };
  }

  const { institution, error } = await getHamiltonInstitutionContext(parsed.data.institution_id);
  if (!institution) return { success: false, error: error ?? "Institution not found." };

  const canManage = await canManageSelectedInstitution(user.id, institution.id, user.role);
  if (!canManage) {
    return { success: false, error: "Only institution owners or admins can manage workspace access." };
  }

  const ownEmail = (user.email ?? user.username ?? "").trim().toLowerCase();
  if (ownEmail && ownEmail === parsed.data.email) {
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
      if (!invitation) return { kind: "failed", error: "Workspace invitation could not be saved." };
      const inviteLink = buildWorkspaceInvitePath({
        invitationId: invitation.id,
        email: invitation.email,
        institutionId: invitation.institutionId,
      });
      if (!inviteLink) throw new Error(INVITE_SECRET_MISSING_MESSAGE);
      return { kind: "invited", email: invitation.email, inviteLink };
    });
  } catch (e) {
    console.error("grantWorkspaceAccess failed:", e);
    return { success: false, error: "Workspace access could not be saved. Try again." };
  }

  if (outcome.kind === "full") return { success: false, error: seatLimitMessage(outcome.limit) };
  if (outcome.kind === "failed") return { success: false, error: outcome.error };

  revalidatePath("/pro/settings");
  return {
    success: true,
    message: `Invite saved for ${outcome.email} (${role}). Copy the invite link and send it to them. They open it while signed in with ${outcome.email}, or create a free account with that email first; they don't pay for a seat.`,
    inviteLink: outcome.inviteLink,
    inviteEmail: outcome.email,
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

/** The asset tiers institution_sources.asset_size_tier holds (src/lib/regulatory/fdic.ts). */
const PEER_SET_ASSET_TIERS = [
  "community_small",
  "community_mid",
  "community_large",
  "regional",
  "large_regional",
  "super_regional",
] as const;

const MAX_SAVED_PEER_SETS = 10;
const MAX_CHOSEN_PEERS = 50;

const PeerSetSchema = z
  .object({
    name: z.string().trim().min(1, "Give the peer group a name.").max(100),
    mode: z.enum(["filters", "institutions"]),
    charter_type: z.enum(["bank", "credit_union"]).nullable(),
    asset_tiers: z.array(z.enum(PEER_SET_ASSET_TIERS)).optional(),
    fed_districts: z.array(z.coerce.number().int().min(1).max(12)).optional(),
    states: z
      .array(z.string().trim().toUpperCase().refine((code) => code in STATE_NAMES, "Pick states from the list."))
      .optional(),
    institution_ids: z
      .array(z.coerce.number().int().positive())
      .max(MAX_CHOSEN_PEERS, `Choose up to ${MAX_CHOSEN_PEERS} institutions.`)
      .optional(),
  })
  .refine((v) => v.mode !== "institutions" || (v.institution_ids?.length ?? 0) > 0, {
    message: "Choose at least one institution.",
  });

export type PeerSetActionResult = {
  success: boolean;
  error?: string;
  id?: number;
  peerSet?: SavedPeerSet;
  count?: PeerGroupCount | null;
  institutionNames?: Record<number, string>;
};

function parsePeerSetForm(formData: FormData) {
  const mode = formData.get("mode") === "institutions" ? "institutions" : "filters";
  const ids = [...new Set(formData.getAll("institution_ids").filter(Boolean).map(Number))];
  const parsed = PeerSetSchema.safeParse({
    name: formData.get("name") ?? "",
    mode,
    charter_type: formData.get("charter_type") || null,
    asset_tiers: formData.getAll("asset_tiers").filter(Boolean) as string[],
    fed_districts: formData.getAll("fed_districts").filter(Boolean).map(Number),
    states: formData.getAll("states").filter(Boolean) as string[],
    institution_ids: ids,
  });
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const v = parsed.data;
  // Hand-picked peers are exactly those institutions, so the filters are not saved with them.
  const filters =
    v.mode === "institutions"
      ? { institution_ids: v.institution_ids }
      : {
          charter_type: v.charter_type ?? undefined,
          asset_tiers: v.asset_tiers,
          fed_districts: v.fed_districts,
          states: [...new Set(v.states ?? [])],
        };
  return { ok: true as const, name: v.name, filters };
}

/** The workspace the user is working in, or null (personal sets). A lookup failure means personal. */
async function peerSetWorkspace(userId: number): Promise<{ institutionId: number; role: string } | null> {
  try {
    return await getPeerSetWorkspace(String(userId));
  } catch {
    return null;
  }
}

/** The set as saved, with a real count of the institutions it resolves to. */
async function savedPeerSetResult(id: number, userId: number, workspaceId: number | null): Promise<PeerSetActionResult> {
  try {
    const sets = await getSavedPeerSets(String(userId), workspaceId);
    const peerSet = sets.find((set) => set.id === id);
    if (!peerSet) return { success: true, id };
    const [count, names] = await Promise.all([
      getPeerGroupCounts([parseSavedPeerSetFilters(peerSet)], workspaceId).then((c) => c[0] ?? null),
      getPeerInstitutionNames(peerSet.institution_ids ?? []),
    ]);
    return { success: true, id, peerSet, count, institutionNames: Object.fromEntries(names) };
  } catch {
    return { success: true, id };
  }
}

export async function createPeerSet(formData: FormData): Promise<PeerSetActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };
  if (!canAccessPremium(user)) return { success: false, error: "An active Hamilton subscription is required." };

  const workspace = await peerSetWorkspace(user.id);
  if (workspace?.role === "viewer") {
    return { success: false, error: "Viewers can use the team's peer groups but not add them." };
  }
  const workspaceId = workspace?.institutionId ?? null;
  const existing = await getSavedPeerSets(String(user.id), workspaceId);
  const inScope = existing.filter((set) =>
    workspaceId === null ? (set.institution_id ?? null) === null : set.institution_id === workspaceId,
  );
  if (inScope.length >= MAX_SAVED_PEER_SETS) {
    return { success: false, error: `You can save up to ${MAX_SAVED_PEER_SETS} peer groups. Remove one to add another.` };
  }

  const parsed = parsePeerSetForm(formData);
  if (!parsed.ok) return { success: false, error: parsed.error };

  const id = await savePeerSet(parsed.name, parsed.filters, String(user.id), workspaceId);

  revalidatePath("/pro/settings");
  return savedPeerSetResult(id, user.id, workspaceId);
}

export async function editPeerSet(id: number, formData: FormData): Promise<PeerSetActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };
  if (!canAccessPremium(user)) return { success: false, error: "An active Hamilton subscription is required." };
  if (!Number.isInteger(id) || id <= 0) return { success: false, error: "Peer group not found." };

  const parsed = parsePeerSetForm(formData);
  if (!parsed.ok) return { success: false, error: parsed.error };

  const updated = await updatePeerSet(id, parsed.name, parsed.filters, String(user.id));
  if (!updated) return { success: false, error: "Peer group not found, or you can't change it." };

  revalidatePath("/pro/settings");
  const workspace = await peerSetWorkspace(user.id);
  return savedPeerSetResult(id, user.id, workspace?.institutionId ?? null);
}

/**
 * "Use for all charts": make a set the default, or pass null to go back to automatic peers.
 * Charts use the team's default before a personal one, so picking a personal set (or
 * automatic) also clears the team's default when the user may change it.
 */
export async function setPeerSetForAllCharts(id: number | null): Promise<PeerSetActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };
  if (!canAccessPremium(user)) return { success: false, error: "An active Hamilton subscription is required." };
  if (id !== null && (!Number.isInteger(id) || id <= 0)) return { success: false, error: "Peer group not found." };

  const userId = String(user.id);
  const workspace = await peerSetWorkspace(user.id);
  const teamScope = workspace && workspace.role !== "viewer" ? workspace.institutionId : null;

  if (id === null) {
    await setDefaultPeerSet({ id: null, userId, institutionId: null });
    if (teamScope !== null) await setDefaultPeerSet({ id: null, userId, institutionId: teamScope });
  } else {
    const changed = await setDefaultPeerSet({ id, userId, institutionId: null });
    if (!changed) return { success: false, error: "Peer group not found, or you can't change it." };
    if (changed.institutionId === null && teamScope !== null) {
      await setDefaultPeerSet({ id: null, userId, institutionId: teamScope });
    }
  }

  revalidatePath("/pro", "layout");
  return { success: true, id: id ?? undefined };
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
