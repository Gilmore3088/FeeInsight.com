"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { sql, withTransaction } from "@/lib/data-store/connection";
import { getHamiltonInstitutionContext } from "@/lib/hamilton/institution-context";
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
import { resolveSavedPeerSetFilters, savedPeerSetDefinition } from "@/lib/hamilton/peer-index";
import { defaultPeerSetName } from "@/lib/hamilton/peer-set-name";
import { describePeerSet } from "@/lib/data-store/peer-sets";
import { getMarketInstitutionIds, type PeerMarket } from "@/lib/data-store/peer-markets";
import {
  CU_CHARTERS,
  MAX_NEAREST_PEER_COUNT,
  SAVED_PEER_REGULATORS,
  hasSavedPeerDimensions,
  type SavedPeerDimensions,
} from "@/lib/peer-set-dimensions";
import { STATE_NAMES } from "@/lib/us-states";

export type WorkspaceInstitutionState = {
  success: boolean;
  error?: string;
  institutionId?: number;
  institutionName?: string;
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

/** Blank stays blank; anything else must be a number. */
const optionalNumber = z.preprocess(
  (value) => (value === null || value === undefined || String(value).trim() === "" ? undefined : Number(String(value).replace(/[$,\s]/g, ""))),
  z.number({ message: "Enter total assets as a number, in $ millions (for example 500)." }).optional(),
);

const PeerSetSchema = z
  .object({
    name: z.string().trim().max(100),
    mode: z.enum(["filters", "institutions"]),
    charter_type: z.enum(["bank", "credit_union"]).nullable(),
    asset_tiers: z.array(z.enum(PEER_SET_ASSET_TIERS)).optional(),
    fed_districts: z.array(z.coerce.number().int().min(1).max(12)).optional(),
    states: z
      .array(z.string().trim().toUpperCase().refine((code) => code in STATE_NAMES, "Choose states from the list."))
      .optional(),
    institution_ids: z
      .array(z.coerce.number().int().positive())
      .max(MAX_CHOSEN_PEERS, `Choose up to ${MAX_CHOSEN_PEERS} institutions.`)
      .optional(),
    /** Total assets in millions of dollars, as typed in the form. */
    asset_min_m: optionalNumber.refine((v) => v === undefined || v >= 0, "Total assets can't be negative."),
    asset_max_m: optionalNumber.refine((v) => v === undefined || v >= 0, "Total assets can't be negative."),
    regulators: z.array(z.enum(SAVED_PEER_REGULATORS as [string, ...string[]], { message: "Choose regulators from the list." })).optional(),
    cu_charter: z.enum(CU_CHARTERS, { message: "Choose federal or state charter." }).nullable(),
    holding_company_rssd: z.string().trim().regex(/^\d{1,12}$/, "That holding company isn't on record. Clear the holding company box and save again.").nullable(),
    market_code: optionalNumber.refine((v) => v === undefined || (Number.isInteger(v) && v > 0), "Choose a metro market from the list."),
    nearest: z.preprocess(
      (value) => (value === null || value === undefined || String(value).trim() === "" ? undefined : Number(String(value).trim())),
      z.number({ message: `Closest in total assets takes a whole number from 1 to ${MAX_NEAREST_PEER_COUNT}.` }).optional(),
    ).refine(
      (v) => v === undefined || (Number.isInteger(v) && v >= 1 && v <= MAX_NEAREST_PEER_COUNT),
      `Closest in total assets takes a whole number from 1 to ${MAX_NEAREST_PEER_COUNT}.`,
    ),
  })
  .refine((v) => v.mode !== "institutions" || (v.institution_ids?.length ?? 0) > 0, {
    message: "Choose at least one institution.",
    path: ["institution_ids"],
  })
  .refine((v) => v.asset_min_m === undefined || v.asset_max_m === undefined || v.asset_min_m <= v.asset_max_m, {
    message: "The lowest total assets can't be more than the highest.",
    path: ["asset_min_m"],
  })
  .refine((v) => v.mode === "institutions" || !v.cu_charter || v.charter_type !== "bank", {
    message: 'Credit union charter works only for credit union groups. Choose "Credit unions only", or set charter to "Banks and credit unions".',
    path: ["cu_charter"],
  })
  .refine((v) => v.mode === "institutions" || !v.regulators?.includes("ncua") || v.charter_type !== "bank", {
    message: "NCUA regulates credit unions, not banks. Change the charter or the regulator.",
    path: ["regulators"],
  });

/** The form field an error belongs to, so the form can show it under that field. */
export type PeerSetField =
  | "name" | "states" | "asset_tiers" | "fed_districts" | "institution_ids" | "assets"
  | "regulators" | "cu_charter" | "holding_company_rssd" | "market_code" | "nearest";

function issueField(path: readonly PropertyKey[]): PeerSetField | undefined {
  const key = String(path[0] ?? "");
  if (key === "asset_min_m" || key === "asset_max_m") return "assets";
  const fields: PeerSetField[] = ["name", "states", "asset_tiers", "fed_districts", "institution_ids", "regulators", "cu_charter", "holding_company_rssd", "market_code", "nearest"];
  return (fields as string[]).includes(key) ? (key as PeerSetField) : undefined;
}

export type PeerSetActionResult = {
  success: boolean;
  error?: string;
  id?: number;
  peerSet?: SavedPeerSet;
  count?: PeerGroupCount | null;
  institutionNames?: Record<number, string>;
  /** The form field the error belongs to; absent for errors about the whole group. */
  field?: PeerSetField;
  /** Why the saved group has no peers right now, in plain words. */
  note?: string | null;
};

/** A name that fits the 100-character limit, cut between words. */
function shortName(text: string): string {
  if (text.length <= 100) return text;
  const cut = text.slice(0, 97);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 60 ? cut.lastIndexOf(" ") : 97)}...`;
}

/** The research subject the form was filled in for, when it names one. */
function formSubjectId(formData: FormData): number | null {
  const raw = formData.get("research_institution_id");
  return typeof raw === "string" && /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}

const formText = (formData: FormData, key: string): string | null => {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
};

async function parsePeerSetForm(formData: FormData) {
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
    asset_min_m: formText(formData, "asset_min_m"),
    asset_max_m: formText(formData, "asset_max_m"),
    regulators: formData.getAll("regulators").filter(Boolean) as string[],
    cu_charter: formText(formData, "cu_charter"),
    holding_company_rssd: formText(formData, "holding_company_rssd"),
    market_code: formText(formData, "market_code"),
    nearest: formText(formData, "nearest"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false as const, error: issue?.message ?? "Invalid input", field: issue ? issueField(issue.path) : undefined };
  }
  const v = parsed.data;
  if (v.mode === "institutions") {
    // Hand-picked peers are exactly those institutions, so the filters are not saved with them.
    const filters = { institution_ids: v.institution_ids };
    return { ok: true as const, name: v.name || defaultPeerSetName(filters), filters };
  }
  const advanced: SavedPeerDimensions = {};
  if (v.asset_min_m !== undefined) advanced.asset_min = Math.round(v.asset_min_m * 1_000_000);
  if (v.asset_max_m !== undefined) advanced.asset_max = Math.round(v.asset_max_m * 1_000_000);
  if (v.regulators?.length) advanced.regulators = [...new Set(v.regulators)] as SavedPeerDimensions["regulators"];
  if (v.cu_charter) advanced.cu_charter = v.cu_charter;
  if (v.holding_company_rssd) advanced.holding_company_rssd = v.holding_company_rssd;
  if (v.market_code !== undefined) advanced.market_code = v.market_code;
  if (v.nearest !== undefined) advanced.nearest = v.nearest;
  const filters = {
    charter_type: v.charter_type ?? undefined,
    asset_tiers: v.asset_tiers,
    fed_districts: v.fed_districts,
    states: [...new Set(v.states ?? [])],
    ...(hasSavedPeerDimensions(advanced) ? { advanced } : {}),
  };
  if (!filters.advanced) return { ok: true as const, name: v.name || defaultPeerSetName(filters), filters };

  // A metro must exist in the branch records, and names the group when it has no name.
  let market: PeerMarket | null = null;
  if (advanced.market_code !== undefined) {
    const loaded = await getMarketInstitutionIds(advanced.market_code).catch(() => undefined);
    if (loaded === undefined) return { ok: false as const, error: "Could not check that metro market. Try saving again.", field: "market_code" as const };
    if (!loaded) return { ok: false as const, error: "Choose a metro market from the list.", field: "market_code" as const };
    market = loaded.market;
  }
  const definition = savedPeerSetDefinition({
    tiers: filters.asset_tiers?.join(",") || null,
    districts: filters.fed_districts?.join(",") || null,
    charter_type: filters.charter_type ?? null,
    states: filters.states.length ? filters.states : null,
    institution_ids: null,
    advanced,
  });
  return { ok: true as const, name: v.name || shortName(describePeerSet(definition, market)), filters };
}

/** The workspace the user is working in, or null (personal sets). A lookup failure means personal. */
async function peerSetWorkspace(userId: number): Promise<{ institutionId: number; role: string } | null> {
  try {
    return await getPeerSetWorkspace(String(userId));
  } catch {
    return null;
  }
}

/** The set as saved, with a real count of the institutions it resolves to (the same path charts use). */
async function savedPeerSetResult(
  id: number,
  userId: number,
  workspaceId: number | null,
  subjectId: number | null = workspaceId,
): Promise<PeerSetActionResult> {
  try {
    const sets = await getSavedPeerSets(String(userId), workspaceId);
    const peerSet = sets.find((set) => set.id === id);
    if (!peerSet) return { success: true, id };
    const [resolved, names] = await Promise.all([
      resolveSavedPeerSetFilters(peerSet, subjectId),
      getPeerInstitutionNames(peerSet.institution_ids ?? []),
    ]);
    const count = resolved.filters
      ? await getPeerGroupCounts([resolved.filters], subjectId).then((c) => c[0] ?? null)
      : { institutions: 0, publishing: 0 };
    return { success: true, id, peerSet, count, institutionNames: Object.fromEntries(names), note: resolved.problem };
  } catch {
    return { success: true, id };
  }
}

export async function createPeerSet(formData: FormData): Promise<PeerSetActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };
  if (!canAccessPremium(user)) return { success: false, error: "An active Hamilton subscription is required." };

  // The displayed research subject may differ from the stored workspace. An explicit
  // empty subject is personal; sharing requires fresh membership of that exact subject.
  let workspace: { institutionId: number; role: string } | null;
  if (formData.has("research_institution_id")) {
    if (formData.get("research_institution_id") === "") {
      workspace = null;
    } else {
      const subject = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().positive().safe())
        .safeParse(formData.get("research_institution_id"));
      if (!subject.success) return { success: false, error: "Enter a valid research institution ID." };
      try {
        const membership = await getActiveInstitutionMembership({ userId: user.id, institutionId: subject.data });
        workspace = membership ? { institutionId: membership.institutionId, role: membership.role } : null;
      } catch {
        return { success: false, error: "Could not verify access to this institution. Try saving again." };
      }
    }
  } else {
    workspace = await peerSetWorkspace(user.id);
  }
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

  const parsed = await parsePeerSetForm(formData);
  if (!parsed.ok) return { success: false, error: parsed.error, field: parsed.field };

  const id = await savePeerSet(parsed.name, parsed.filters, String(user.id), workspaceId);

  revalidatePath("/pro/settings");
  return savedPeerSetResult(id, user.id, workspaceId, workspaceId ?? formSubjectId(formData));
}

export async function editPeerSet(id: number, formData: FormData): Promise<PeerSetActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };
  if (!canAccessPremium(user)) return { success: false, error: "An active Hamilton subscription is required." };
  if (!Number.isInteger(id) || id <= 0) return { success: false, error: "Peer group not found." };

  const parsed = await parsePeerSetForm(formData);
  if (!parsed.ok) return { success: false, error: parsed.error, field: parsed.field };

  const updated = await updatePeerSet(id, parsed.name, parsed.filters, String(user.id));
  if (!updated) return { success: false, error: "Peer group not found, or you can't change it." };

  revalidatePath("/pro/settings");
  const workspace = await peerSetWorkspace(user.id);
  const workspaceId = workspace?.institutionId ?? null;
  return savedPeerSetResult(id, user.id, workspaceId, formSubjectId(formData) ?? workspaceId);
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
