import { sql } from "@/lib/data-store/connection";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";

export type InstitutionWorkspaceMembershipRole = "owner" | "admin" | "analyst" | "viewer";
export type InstitutionWorkspaceMembershipStatus = "active" | "revoked";
export type InstitutionWorkspaceMembershipSource = "claim" | "manual_admin" | "delegated" | "import";
export type InstitutionWorkspaceInvitationRole = "admin" | "analyst" | "viewer";
export type InstitutionWorkspaceInvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface InstitutionWorkspaceMembership {
  id: number;
  institutionId: number;
  institutionName: string;
  city: string | null;
  stateCode: string | null;
  userId: number;
  userDisplayName: string | null;
  userEmail: string | null;
  role: InstitutionWorkspaceMembershipRole;
  status: InstitutionWorkspaceMembershipStatus;
  source: InstitutionWorkspaceMembershipSource;
  claimId: number | null;
  grantedByUserId: number | null;
  grantedAt: string;
  notes: string | null;
}

export interface InstitutionClaimHistoryEntry {
  id: number;
  institutionId: number;
  institutionName: string;
  reviewStatus: string;
  resolution: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
}

export interface InstitutionWorkspaceInvitation {
  id: number;
  institutionId: number;
  institutionName: string;
  city: string | null;
  stateCode: string | null;
  email: string;
  role: InstitutionWorkspaceInvitationRole;
  status: InstitutionWorkspaceInvitationStatus;
  invitedByUserId: number;
  invitedByDisplayName: string | null;
  invitedByEmail: string | null;
  acceptedByUserId: number | null;
  revokedByUserId: number | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

type SqlClient = typeof sql;

function mapMembershipRow(row: Record<string, unknown>): InstitutionWorkspaceMembership {
  return {
    id: Number(row.id),
    institutionId: Number(row.institution_id),
    institutionName: String(row.institution_name),
    city: row.city ? String(row.city) : null,
    stateCode: row.state_code ? String(row.state_code) : null,
    userId: Number(row.user_id),
    userDisplayName: row.user_display_name ? String(row.user_display_name) : null,
    userEmail: row.user_email ? String(row.user_email) : null,
    role: String(row.membership_role) as InstitutionWorkspaceMembershipRole,
    status: String(row.membership_status) as InstitutionWorkspaceMembershipStatus,
    source: String(row.source) as InstitutionWorkspaceMembershipSource,
    claimId: row.claim_id == null ? null : Number(row.claim_id),
    grantedByUserId: row.granted_by_user_id == null ? null : Number(row.granted_by_user_id),
    grantedAt: String(row.granted_at),
    notes: row.notes ? String(row.notes) : null,
  };
}

function mapInvitationRow(row: Record<string, unknown>): InstitutionWorkspaceInvitation {
  return {
    id: Number(row.id),
    institutionId: Number(row.institution_id),
    institutionName: String(row.institution_name),
    city: row.city ? String(row.city) : null,
    stateCode: row.state_code ? String(row.state_code) : null,
    email: String(row.email),
    role: String(row.invited_role) as InstitutionWorkspaceInvitationRole,
    status: String(row.invitation_status) as InstitutionWorkspaceInvitationStatus,
    invitedByUserId: Number(row.invited_by_user_id),
    invitedByDisplayName: row.invited_by_display_name ? String(row.invited_by_display_name) : null,
    invitedByEmail: row.invited_by_email ? String(row.invited_by_email) : null,
    acceptedByUserId: row.accepted_by_user_id == null ? null : Number(row.accepted_by_user_id),
    revokedByUserId: row.revoked_by_user_id == null ? null : Number(row.revoked_by_user_id),
    expiresAt: String(row.expires_at),
    acceptedAt: row.accepted_at ? String(row.accepted_at) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    notes: row.notes ? String(row.notes) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function grantInstitutionWorkspaceMembership(
  params: {
    institutionId: number;
    userId: number;
    role?: InstitutionWorkspaceMembershipRole;
    source?: InstitutionWorkspaceMembershipSource;
    claimId?: number | null;
    grantedByUserId?: number | null;
    grantedAt?: string | Date | null;
    notes?: string | null;
  },
  db: SqlClient = sql,
): Promise<InstitutionWorkspaceMembership | null> {
  const rows = await db<Record<string, unknown>[]>`
    INSERT INTO institution_workspace_memberships (
      institution_id,
      user_id,
      membership_role,
      membership_status,
      source,
      claim_id,
      granted_by_user_id,
      granted_at,
      notes,
      created_at,
      updated_at
    ) VALUES (
      ${params.institutionId},
      ${params.userId},
      ${params.role ?? "owner"},
      'active',
      ${params.source ?? "claim"},
      ${params.claimId ?? null},
      ${params.grantedByUserId ?? null},
      ${params.grantedAt ?? new Date()},
      ${params.notes ?? null},
      NOW(),
      NOW()
    )
    ON CONFLICT (institution_id, user_id)
    WHERE membership_status = 'active'
    DO UPDATE SET
      membership_role = EXCLUDED.membership_role,
      source = EXCLUDED.source,
      claim_id = COALESCE(EXCLUDED.claim_id, institution_workspace_memberships.claim_id),
      granted_by_user_id = EXCLUDED.granted_by_user_id,
      granted_at = EXCLUDED.granted_at,
      notes = EXCLUDED.notes,
      updated_at = NOW()
    RETURNING
      id,
      institution_id,
      (
        SELECT institution_name
        FROM institution_sources
        WHERE id = institution_workspace_memberships.institution_id
      ) AS institution_name,
      (
        SELECT city
        FROM institution_sources
        WHERE id = institution_workspace_memberships.institution_id
      ) AS city,
      (
        SELECT state_code
        FROM institution_sources
        WHERE id = institution_workspace_memberships.institution_id
      ) AS state_code,
      user_id,
      membership_role,
      membership_status,
      source,
      claim_id,
      granted_by_user_id,
      granted_at,
      notes
  `;

  return rows[0] ? mapMembershipRow(rows[0]) : null;
}

export async function getActiveInstitutionMembership(
  params: {
    userId: number;
    institutionId: number;
  },
): Promise<InstitutionWorkspaceMembership | null> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT
      iwm.id,
      iwm.institution_id,
      inst.institution_name,
      inst.city,
      inst.state_code,
      iwm.user_id,
      iwm.membership_role,
      iwm.membership_status,
      iwm.source,
      iwm.claim_id,
      iwm.granted_by_user_id,
      iwm.granted_at,
      iwm.notes
    FROM institution_workspace_memberships iwm
    JOIN institution_sources inst ON inst.id = iwm.institution_id
    WHERE iwm.user_id = ${params.userId}
      AND iwm.institution_id = ${params.institutionId}
      AND iwm.membership_status = 'active'
    ORDER BY iwm.granted_at DESC, iwm.id DESC
    LIMIT 1
  `;

  return rows[0] ? mapMembershipRow(rows[0]) : null;
}

export async function getInstitutionWorkspaceMembers(
  institutionId: number,
): Promise<InstitutionWorkspaceMembership[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT
      iwm.id,
      iwm.institution_id,
      inst.institution_name,
      inst.city,
      inst.state_code,
      iwm.user_id,
      u.display_name AS user_display_name,
      u.email AS user_email,
      iwm.membership_role,
      iwm.membership_status,
      iwm.source,
      iwm.claim_id,
      iwm.granted_by_user_id,
      iwm.granted_at,
      iwm.notes
    FROM institution_workspace_memberships iwm
    JOIN institution_sources inst ON inst.id = iwm.institution_id
    JOIN users u ON u.id = iwm.user_id
    WHERE iwm.institution_id = ${institutionId}
      AND iwm.membership_status = 'active'
    ORDER BY
      CASE iwm.membership_role
        WHEN 'owner' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'analyst' THEN 3
        ELSE 4
      END,
      iwm.granted_at DESC,
      iwm.id DESC
  `;

  return rows.map(mapMembershipRow);
}

export async function getUserInstitutionMemberships(
  userId: number,
): Promise<InstitutionWorkspaceMembership[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT
      iwm.id,
      iwm.institution_id,
      inst.institution_name,
      inst.city,
      inst.state_code,
      iwm.user_id,
      NULL::text AS user_display_name,
      NULL::text AS user_email,
      iwm.membership_role,
      iwm.membership_status,
      iwm.source,
      iwm.claim_id,
      iwm.granted_by_user_id,
      iwm.granted_at,
      iwm.notes
    FROM institution_workspace_memberships iwm
    JOIN institution_sources inst ON inst.id = iwm.institution_id
    WHERE iwm.user_id = ${userId}
      AND iwm.membership_status = 'active'
    ORDER BY iwm.granted_at DESC, iwm.id DESC
  `;

  return rows.map(mapMembershipRow);
}

export async function revokeInstitutionWorkspaceMembership(
  params: {
    membershipId: number;
    revokedByUserId: number;
  },
  db: SqlClient = sql,
): Promise<InstitutionWorkspaceMembership | null> {
  const rows = await db<Record<string, unknown>[]>`
    UPDATE institution_workspace_memberships
       SET membership_status = 'revoked',
           revoked_by_user_id = ${params.revokedByUserId},
           revoked_at = NOW(),
           updated_at = NOW()
     WHERE id = ${params.membershipId}
       AND membership_status = 'active'
    RETURNING
      id,
      institution_id,
      (
        SELECT institution_name
        FROM institution_sources
        WHERE id = institution_workspace_memberships.institution_id
      ) AS institution_name,
      (
        SELECT city
        FROM institution_sources
        WHERE id = institution_workspace_memberships.institution_id
      ) AS city,
      (
        SELECT state_code
        FROM institution_sources
        WHERE id = institution_workspace_memberships.institution_id
      ) AS state_code,
      user_id,
      (
        SELECT display_name
        FROM users
        WHERE id = institution_workspace_memberships.user_id
      ) AS user_display_name,
      (
        SELECT email
        FROM users
        WHERE id = institution_workspace_memberships.user_id
      ) AS user_email,
      membership_role,
      membership_status,
      source,
      claim_id,
      granted_by_user_id,
      granted_at,
      notes
  `;

  return rows[0] ? mapMembershipRow(rows[0]) : null;
}

export async function createInstitutionWorkspaceInvitation(
  params: {
    institutionId: number;
    email: string;
    role: InstitutionWorkspaceInvitationRole;
    invitedByUserId: number;
    expiresAt?: string | Date | null;
    notes?: string | null;
  },
  db: SqlClient = sql,
): Promise<InstitutionWorkspaceInvitation | null> {
  const normalizedEmail = params.email.trim().toLowerCase();
  // The seat cap is checked in the same statement as the insert: a new email is queued only
  // while fewer than WORKSPACE_SEAT_LIMIT seats are in use; an email that already holds a
  // seat (a member, or a pending invite being refreshed) never needs a new one. A full
  // workspace inserts nothing and this returns null.
  const rows = await db<Record<string, unknown>[]>`
    WITH seats AS (
      SELECT COALESCE(LOWER(u.email), 'user:' || u.id::text) AS seat_key
        FROM institution_workspace_memberships iwm
        JOIN users u ON u.id = iwm.user_id
       WHERE iwm.institution_id = ${params.institutionId}
         AND iwm.membership_status = 'active'
      UNION
      SELECT iwi.email AS seat_key
        FROM institution_workspace_invitations iwi
       WHERE iwi.institution_id = ${params.institutionId}
         AND iwi.invitation_status = 'pending'
         AND iwi.expires_at > NOW()
    )
    INSERT INTO institution_workspace_invitations (
      institution_id,
      email,
      invited_role,
      invitation_status,
      invited_by_user_id,
      expires_at,
      notes,
      created_at,
      updated_at
    )
    SELECT
      ${params.institutionId},
      ${normalizedEmail},
      ${params.role},
      'pending',
      ${params.invitedByUserId},
      ${params.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)},
      ${params.notes ?? null},
      NOW(),
      NOW()
    WHERE EXISTS (SELECT 1 FROM seats WHERE seat_key = ${normalizedEmail})
       OR (SELECT COUNT(*) FROM seats) < ${WORKSPACE_SEAT_LIMIT}
    ON CONFLICT (institution_id, email)
    WHERE invitation_status = 'pending'
    DO UPDATE SET
      invited_role = EXCLUDED.invited_role,
      invited_by_user_id = EXCLUDED.invited_by_user_id,
      expires_at = EXCLUDED.expires_at,
      notes = EXCLUDED.notes,
      updated_at = NOW()
    RETURNING
      id,
      institution_id,
      (
        SELECT institution_name
        FROM institution_sources
        WHERE id = institution_workspace_invitations.institution_id
      ) AS institution_name,
      (
        SELECT city
        FROM institution_sources
        WHERE id = institution_workspace_invitations.institution_id
      ) AS city,
      (
        SELECT state_code
        FROM institution_sources
        WHERE id = institution_workspace_invitations.institution_id
      ) AS state_code,
      email,
      invited_role,
      invitation_status,
      invited_by_user_id,
      (
        SELECT display_name
        FROM users
        WHERE id = institution_workspace_invitations.invited_by_user_id
      ) AS invited_by_display_name,
      (
        SELECT email
        FROM users
        WHERE id = institution_workspace_invitations.invited_by_user_id
      ) AS invited_by_email,
      accepted_by_user_id,
      revoked_by_user_id,
      expires_at,
      accepted_at,
      revoked_at,
      notes,
      created_at,
      updated_at
  `;

  return rows[0] ? mapInvitationRow(rows[0]) : null;
}

export interface InstitutionWorkspaceSeatUsage {
  /** Distinct people holding a seat: active members plus pending, unexpired invitations. */
  used: number;
  limit: number;
  /** True when `email` already holds a seat, so adding it again takes no new seat. */
  emailHoldsSeat: boolean;
}

/**
 * Seats in use on an institution workspace, in one query. Same rule as the guarded insert
 * in `createInstitutionWorkspaceInvitation` and `countWorkspaceSeats` in workspace-seats.ts.
 */
export async function getInstitutionWorkspaceSeatUsage(
  params: { institutionId: number; email?: string | null },
  db: SqlClient = sql,
): Promise<InstitutionWorkspaceSeatUsage> {
  const normalizedEmail = params.email?.trim().toLowerCase() || null;
  const rows = await db<Array<{ used: number | string; email_holds_seat: boolean }>>`
    WITH seats AS (
      SELECT COALESCE(LOWER(u.email), 'user:' || u.id::text) AS seat_key
        FROM institution_workspace_memberships iwm
        JOIN users u ON u.id = iwm.user_id
       WHERE iwm.institution_id = ${params.institutionId}
         AND iwm.membership_status = 'active'
      UNION
      SELECT iwi.email AS seat_key
        FROM institution_workspace_invitations iwi
       WHERE iwi.institution_id = ${params.institutionId}
         AND iwi.invitation_status = 'pending'
         AND iwi.expires_at > NOW()
    )
    SELECT COUNT(*)::int AS used,
           COALESCE(BOOL_OR(seat_key = ${normalizedEmail}), false) AS email_holds_seat
      FROM seats
  `;
  const row = rows[0];
  return {
    used: Number(row?.used ?? 0),
    limit: WORKSPACE_SEAT_LIMIT,
    emailHoldsSeat: row?.email_holds_seat === true,
  };
}

export async function getPendingInstitutionWorkspaceInvitations(
  institutionId: number,
): Promise<InstitutionWorkspaceInvitation[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT
      iwi.id,
      iwi.institution_id,
      inst.institution_name,
      inst.city,
      inst.state_code,
      iwi.email,
      iwi.invited_role,
      iwi.invitation_status,
      iwi.invited_by_user_id,
      inviter.display_name AS invited_by_display_name,
      inviter.email AS invited_by_email,
      iwi.accepted_by_user_id,
      iwi.revoked_by_user_id,
      iwi.expires_at,
      iwi.accepted_at,
      iwi.revoked_at,
      iwi.notes,
      iwi.created_at,
      iwi.updated_at
    FROM institution_workspace_invitations iwi
    JOIN institution_sources inst ON inst.id = iwi.institution_id
    JOIN users inviter ON inviter.id = iwi.invited_by_user_id
    WHERE iwi.institution_id = ${institutionId}
      AND iwi.invitation_status = 'pending'
      AND iwi.expires_at > NOW()
    ORDER BY iwi.created_at DESC, iwi.id DESC
  `;

  return rows.map(mapInvitationRow);
}

export async function getPendingWorkspaceInvitationsForEmail(
  email: string | null | undefined,
  limit = 10,
): Promise<InstitutionWorkspaceInvitation[]> {
  if (!email) return [];
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return [];
  const safeLimit = Math.min(25, Math.max(1, Math.floor(limit)));

  const rows = await sql<Record<string, unknown>[]>`
    SELECT
      iwi.id,
      iwi.institution_id,
      inst.institution_name,
      inst.city,
      inst.state_code,
      iwi.email,
      iwi.invited_role,
      iwi.invitation_status,
      iwi.invited_by_user_id,
      inviter.display_name AS invited_by_display_name,
      inviter.email AS invited_by_email,
      iwi.accepted_by_user_id,
      iwi.revoked_by_user_id,
      iwi.expires_at,
      iwi.accepted_at,
      iwi.revoked_at,
      iwi.notes,
      iwi.created_at,
      iwi.updated_at
    FROM institution_workspace_invitations iwi
    JOIN institution_sources inst ON inst.id = iwi.institution_id
    JOIN users inviter ON inviter.id = iwi.invited_by_user_id
    WHERE iwi.email = ${normalizedEmail}
      AND iwi.invitation_status = 'pending'
      AND iwi.expires_at > NOW()
    ORDER BY iwi.created_at DESC, iwi.id DESC
    LIMIT ${safeLimit}
  `;

  return rows.map(mapInvitationRow);
}

export async function revokeInstitutionWorkspaceInvitation(
  params: {
    invitationId: number;
    institutionId: number;
    revokedByUserId: number;
  },
  db: SqlClient = sql,
): Promise<InstitutionWorkspaceInvitation | null> {
  const rows = await db<Record<string, unknown>[]>`
    UPDATE institution_workspace_invitations
       SET invitation_status = 'revoked',
           revoked_by_user_id = ${params.revokedByUserId},
           revoked_at = NOW(),
           updated_at = NOW()
     WHERE id = ${params.invitationId}
       AND institution_id = ${params.institutionId}
       AND invitation_status = 'pending'
    RETURNING
      id,
      institution_id,
      (
        SELECT institution_name
        FROM institution_sources
        WHERE id = institution_workspace_invitations.institution_id
      ) AS institution_name,
      (
        SELECT city
        FROM institution_sources
        WHERE id = institution_workspace_invitations.institution_id
      ) AS city,
      (
        SELECT state_code
        FROM institution_sources
        WHERE id = institution_workspace_invitations.institution_id
      ) AS state_code,
      email,
      invited_role,
      invitation_status,
      invited_by_user_id,
      (
        SELECT display_name
        FROM users
        WHERE id = institution_workspace_invitations.invited_by_user_id
      ) AS invited_by_display_name,
      (
        SELECT email
        FROM users
        WHERE id = institution_workspace_invitations.invited_by_user_id
      ) AS invited_by_email,
      accepted_by_user_id,
      revoked_by_user_id,
      expires_at,
      accepted_at,
      revoked_at,
      notes,
      created_at,
      updated_at
  `;

  return rows[0] ? mapInvitationRow(rows[0]) : null;
}

export interface WorkspaceInvitationForAccept {
  id: number;
  institutionId: number;
  email: string;
  role: InstitutionWorkspaceInvitationRole;
  status: InstitutionWorkspaceInvitationStatus;
  /** expires_at is at or before NOW(), judged by the database clock. */
  expired: boolean;
  acceptedByUserId: number | null;
}

/**
 * One invitation by id, for the signed-link accept flow. Locks the row when called inside
 * a transaction, so two visits cannot both accept it.
 */
export async function getWorkspaceInvitationForAccept(
  invitationId: number,
  db: SqlClient = sql,
): Promise<WorkspaceInvitationForAccept | null> {
  const rows = await db<Record<string, unknown>[]>`
    SELECT id, institution_id, email, invited_role, invitation_status,
           (expires_at <= NOW()) AS expired, accepted_by_user_id
      FROM institution_workspace_invitations
     WHERE id = ${invitationId}
     FOR UPDATE
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    institutionId: Number(row.institution_id),
    email: String(row.email),
    role: String(row.invited_role) as InstitutionWorkspaceInvitationRole,
    status: String(row.invitation_status) as InstitutionWorkspaceInvitationStatus,
    expired: row.expired === true,
    acceptedByUserId: row.accepted_by_user_id == null ? null : Number(row.accepted_by_user_id),
  };
}

/**
 * Accepts one invitation for one user and grants the delegated membership. The update only
 * matches a pending, unexpired invitation for exactly this email, so an expired, revoked or
 * already-used invite, or another person's, accepts nothing and returns null. Callers check
 * the signed link first (`acceptSignedWorkspaceInvite`); nothing accepts invitations by
 * email alone.
 */
export async function acceptWorkspaceInvitation(
  params: { invitationId: number; userId: number; email: string },
  db: SqlClient = sql,
): Promise<InstitutionWorkspaceMembership | null> {
  const normalizedEmail = params.email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const acceptedRows = await db<Record<string, unknown>[]>`
    UPDATE institution_workspace_invitations
       SET invitation_status = 'accepted',
           accepted_by_user_id = ${params.userId},
           accepted_at = NOW(),
           updated_at = NOW()
     WHERE id = ${params.invitationId}
       AND email = ${normalizedEmail}
       AND invitation_status = 'pending'
       AND expires_at > NOW()
    RETURNING id, institution_id, invited_role, invited_by_user_id, notes
  `;
  const accepted = acceptedRows[0];
  if (!accepted) return null;

  return grantInstitutionWorkspaceMembership(
    {
      institutionId: Number(accepted.institution_id),
      userId: params.userId,
      role: String(accepted.invited_role) as InstitutionWorkspaceMembershipRole,
      source: "delegated",
      grantedByUserId: Number(accepted.invited_by_user_id),
      notes: accepted.notes ? String(accepted.notes) : "Accepted workspace invitation link.",
    },
    db,
  );
}

export async function getUserInstitutionClaimHistory(
  userId: number,
  limit = 8,
): Promise<InstitutionClaimHistoryEntry[]> {
  const safeLimit = Math.min(25, Math.max(1, Math.floor(limit)));
  const rows = await sql<Record<string, unknown>[]>`
    SELECT
      ic.id,
      ic.institution_id,
      inst.institution_name,
      ic.review_status,
      ic.resolution,
      ic.review_notes,
      ic.created_at,
      ic.updated_at,
      ic.reviewed_at
    FROM institution_claims ic
    JOIN institution_sources inst ON inst.id = ic.institution_id
    WHERE ic.claimant_user_id = ${userId}
    ORDER BY ic.updated_at DESC, ic.id DESC
    LIMIT ${safeLimit}
  `;

  return rows.map((row) => ({
    id: Number(row.id),
    institutionId: Number(row.institution_id),
    institutionName: String(row.institution_name),
    reviewStatus: String(row.review_status ?? "pending"),
    resolution: row.resolution ? String(row.resolution) : null,
    reviewNotes: row.review_notes ? String(row.review_notes) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
  }));
}
