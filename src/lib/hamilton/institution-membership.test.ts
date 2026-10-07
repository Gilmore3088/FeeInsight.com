import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state: {
    sqlCalls: Array<{ text: string; values: unknown[] }>;
    queuedRows: unknown[][];
  } = {
    sqlCalls: [],
    queuedRows: [],
  };

  const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    state.sqlCalls.push({ text: strings.join("?"), values });
    return Promise.resolve(state.queuedRows.shift() ?? []);
  });

  return { state, sqlMock };
});

vi.mock("@/lib/data-store/connection", () => ({
  sql: mocks.sqlMock,
}));

import {
  acceptWorkspaceInvitation,
  getWorkspaceInvitationForAccept,
  createInstitutionWorkspaceInvitation,
  getPendingInstitutionWorkspaceInvitations,
  getPendingWorkspaceInvitationsForEmail,
  getInstitutionWorkspaceMembers,
  getInstitutionWorkspaceSeatUsage,
  getUserInstitutionClaimHistory,
  grantInstitutionWorkspaceMembership,
  revokeInstitutionWorkspaceInvitation,
  revokeInstitutionWorkspaceMembership,
} from "./institution-membership";

describe("institution workspace memberships", () => {
  beforeEach(() => {
    mocks.state.sqlCalls.length = 0;
    mocks.state.queuedRows.length = 0;
    mocks.sqlMock.mockClear();
  });

  it("grants or refreshes active workspace ownership from an accepted claim", async () => {
    mocks.state.queuedRows.push([
      {
        id: 42,
        institution_id: 2945,
        institution_name: "Hamilton Bank",
        city: "New York",
        state_code: "NY",
        user_id: 7,
        membership_role: "owner",
        membership_status: "active",
        source: "claim",
        claim_id: 11,
        granted_by_user_id: 2,
        granted_at: "2026-08-15T09:00:00.000Z",
        notes: "Verified bank email domain.",
      },
    ]);

    const membership = await grantInstitutionWorkspaceMembership({
      institutionId: 2945,
      userId: 7,
      claimId: 11,
      grantedByUserId: 2,
      notes: "Verified bank email domain.",
    });

    expect(membership).toMatchObject({
      id: 42,
      institutionId: 2945,
      institutionName: "Hamilton Bank",
      userId: 7,
      role: "owner",
      status: "active",
      source: "claim",
      claimId: 11,
    });
    expect(mocks.state.sqlCalls[0].text).toContain("ON CONFLICT");
    expect(mocks.state.sqlCalls[0].values.slice(0, 7)).toEqual([
      2945,
      7,
      "owner",
      "claim",
      11,
      2,
      expect.any(Date),
    ]);
  });

  it("maps user claim history for Account claim-status display", async () => {
    mocks.state.queuedRows.push([
      {
        id: 101,
        institution_id: 8109,
        institution_name: "Community Credit Union",
        review_status: "accepted",
        resolution: "verified_claim",
        review_notes: "Confirmed.",
        created_at: "2026-08-14T09:00:00.000Z",
        updated_at: "2026-08-15T09:00:00.000Z",
        reviewed_at: "2026-08-15T09:00:00.000Z",
      },
    ]);

    const history = await getUserInstitutionClaimHistory(7, 5);

    expect(history).toEqual([
      {
        id: 101,
        institutionId: 8109,
        institutionName: "Community Credit Union",
        reviewStatus: "accepted",
        resolution: "verified_claim",
        reviewNotes: "Confirmed.",
        createdAt: "2026-08-14T09:00:00.000Z",
        updatedAt: "2026-08-15T09:00:00.000Z",
        reviewedAt: "2026-08-15T09:00:00.000Z",
      },
    ]);
    expect(mocks.state.sqlCalls[0].values).toEqual([7, 5]);
  });

  it("lists active workspace members for delegated access management", async () => {
    mocks.state.queuedRows.push([
      {
        id: 51,
        institution_id: 2945,
        institution_name: "Hamilton Bank",
        city: "New York",
        state_code: "NY",
        user_id: 8,
        user_display_name: "Analyst User",
        user_email: "analyst@example.com",
        membership_role: "analyst",
        membership_status: "active",
        source: "delegated",
        claim_id: null,
        granted_by_user_id: 7,
        granted_at: "2026-08-15T10:00:00.000Z",
        notes: "Competitive review support.",
      },
    ]);

    const members = await getInstitutionWorkspaceMembers(2945);

    expect(members[0]).toMatchObject({
      id: 51,
      institutionId: 2945,
      userId: 8,
      userDisplayName: "Analyst User",
      userEmail: "analyst@example.com",
      role: "analyst",
      source: "delegated",
    });
    expect(mocks.state.sqlCalls[0].text).toContain("JOIN users");
    expect(mocks.state.sqlCalls[0].values).toEqual([2945]);
  });

  it("revokes active workspace membership without deleting audit history", async () => {
    mocks.state.queuedRows.push([
      {
        id: 51,
        institution_id: 2945,
        institution_name: "Hamilton Bank",
        city: "New York",
        state_code: "NY",
        user_id: 8,
        user_display_name: "Analyst User",
        user_email: "analyst@example.com",
        membership_role: "analyst",
        membership_status: "revoked",
        source: "delegated",
        claim_id: null,
        granted_by_user_id: 7,
        granted_at: "2026-08-15T10:00:00.000Z",
        notes: "Competitive review support.",
      },
    ]);

    const revoked = await revokeInstitutionWorkspaceMembership({
      membershipId: 51,
      revokedByUserId: 7,
    });

    expect(revoked).toMatchObject({
      id: 51,
      status: "revoked",
      userEmail: "analyst@example.com",
    });
    expect(mocks.state.sqlCalls[0].text).toContain("membership_status = 'revoked'");
    expect(mocks.state.sqlCalls[0].values).toEqual([7, 51]);
  });

  it("queues pending workspace invitations for emails without active Pro access", async () => {
    mocks.state.queuedRows.push([
      {
        id: 91,
        institution_id: 2945,
        institution_name: "Hamilton Bank",
        city: "New York",
        state_code: "NY",
        email: "analyst@example.com",
        invited_role: "analyst",
        invitation_status: "pending",
        invited_by_user_id: 7,
        invited_by_display_name: "Owner User",
        invited_by_email: "owner@example.com",
        accepted_by_user_id: null,
        revoked_by_user_id: null,
        expires_at: "2026-09-15T10:00:00.000Z",
        accepted_at: null,
        revoked_at: null,
        notes: "Competitive review support.",
        created_at: "2026-08-15T10:00:00.000Z",
        updated_at: "2026-08-15T10:00:00.000Z",
      },
    ]);

    const invitation = await createInstitutionWorkspaceInvitation({
      institutionId: 2945,
      email: "Analyst@Example.com",
      role: "analyst",
      invitedByUserId: 7,
      notes: "Competitive review support.",
    });

    expect(invitation).toMatchObject({
      id: 91,
      institutionId: 2945,
      email: "analyst@example.com",
      role: "analyst",
      status: "pending",
    });
    expect(mocks.state.sqlCalls[0].text).toContain("ON CONFLICT");
    expect(mocks.state.sqlCalls[0].values).toEqual([
      2945,
      2945,
      2945,
      "analyst@example.com",
      "analyst",
      7,
      expect.any(Date),
      "Competitive review support.",
      "analyst@example.com",
      5,
    ]);
  });

  it("queues an invitation only while a seat is open, in the same statement as the insert", async () => {
    // A full workspace inserts no row, so the guarded insert returns nothing.
    mocks.state.queuedRows.push([]);

    const invitation = await createInstitutionWorkspaceInvitation({
      institutionId: 2945,
      email: "sixth@example.com",
      role: "viewer",
      invitedByUserId: 7,
    });

    expect(invitation).toBeNull();
    const { text } = mocks.state.sqlCalls[0];
    expect(text).toContain("WITH seats AS");
    expect(text).toContain("iwm.membership_status = 'active'");
    expect(text).toContain("iwi.invitation_status = 'pending'");
    expect(text).toContain("iwi.expires_at > NOW()");
    expect(text).toContain("(SELECT COUNT(*) FROM seats) <");
    expect(text).toContain("EXISTS (SELECT 1 FROM seats WHERE seat_key =");
  });

  it("counts seats from active members plus pending, unexpired invitations", async () => {
    mocks.state.queuedRows.push([{ used: 4, email_holds_seat: false }]);

    const usage = await getInstitutionWorkspaceSeatUsage({
      institutionId: 2945,
      email: " New@Example.com ",
    });

    expect(usage).toEqual({ used: 4, limit: 5, emailHoldsSeat: false });
    const { text, values } = mocks.state.sqlCalls[0];
    expect(text).toContain("UNION");
    expect(text).toContain("iwi.expires_at > NOW()");
    expect(values).toEqual([2945, 2945, "new@example.com"]);
  });

  it("reports when the email already holds a seat", async () => {
    mocks.state.queuedRows.push([{ used: "5", email_holds_seat: true }]);

    expect(await getInstitutionWorkspaceSeatUsage({ institutionId: 2945, email: "a@example.com" })).toEqual({
      used: 5,
      limit: 5,
      emailHoldsSeat: true,
    });
  });

  it("lists pending workspace invitations for an institution", async () => {
    mocks.state.queuedRows.push([
      {
        id: 91,
        institution_id: 2945,
        institution_name: "Hamilton Bank",
        city: "New York",
        state_code: "NY",
        email: "analyst@example.com",
        invited_role: "analyst",
        invitation_status: "pending",
        invited_by_user_id: 7,
        invited_by_display_name: "Owner User",
        invited_by_email: "owner@example.com",
        accepted_by_user_id: null,
        revoked_by_user_id: null,
        expires_at: "2026-09-15T10:00:00.000Z",
        accepted_at: null,
        revoked_at: null,
        notes: "Competitive review support.",
        created_at: "2026-08-15T10:00:00.000Z",
        updated_at: "2026-08-15T10:00:00.000Z",
      },
    ]);

    const invitations = await getPendingInstitutionWorkspaceInvitations(2945);

    expect(invitations[0]).toMatchObject({
      id: 91,
      email: "analyst@example.com",
      role: "analyst",
      status: "pending",
    });
    expect(mocks.state.sqlCalls[0].text).toContain("invitation_status = 'pending'");
    expect(mocks.state.sqlCalls[0].values).toEqual([2945]);
  });

  it("lists pending workspace invitations for a matching recipient email", async () => {
    mocks.state.queuedRows.push([
      {
        id: 91,
        institution_id: 2945,
        institution_name: "Hamilton Bank",
        city: "New York",
        state_code: "NY",
        email: "analyst@example.com",
        invited_role: "analyst",
        invitation_status: "pending",
        invited_by_user_id: 7,
        invited_by_display_name: "Owner User",
        invited_by_email: "owner@example.com",
        accepted_by_user_id: null,
        revoked_by_user_id: null,
        expires_at: "2026-09-15T10:00:00.000Z",
        accepted_at: null,
        revoked_at: null,
        notes: "Competitive review support.",
        created_at: "2026-08-15T10:00:00.000Z",
        updated_at: "2026-08-15T10:00:00.000Z",
      },
    ]);

    const invitations = await getPendingWorkspaceInvitationsForEmail("Analyst@Example.com", 5);

    expect(invitations[0]).toMatchObject({
      id: 91,
      institutionId: 2945,
      institutionName: "Hamilton Bank",
      email: "analyst@example.com",
      role: "analyst",
      status: "pending",
    });
    expect(mocks.state.sqlCalls[0].text).toContain("iwi.email = ?");
    expect(mocks.state.sqlCalls[0].values).toEqual(["analyst@example.com", 5]);
  });

  it("revokes pending workspace invitations without deleting audit history", async () => {
    mocks.state.queuedRows.push([
      {
        id: 91,
        institution_id: 2945,
        institution_name: "Hamilton Bank",
        city: "New York",
        state_code: "NY",
        email: "analyst@example.com",
        invited_role: "analyst",
        invitation_status: "revoked",
        invited_by_user_id: 7,
        invited_by_display_name: "Owner User",
        invited_by_email: "owner@example.com",
        accepted_by_user_id: null,
        revoked_by_user_id: 7,
        expires_at: "2026-09-15T10:00:00.000Z",
        accepted_at: null,
        revoked_at: "2026-08-15T11:00:00.000Z",
        notes: "Competitive review support.",
        created_at: "2026-08-15T10:00:00.000Z",
        updated_at: "2026-08-15T11:00:00.000Z",
      },
    ]);

    const revoked = await revokeInstitutionWorkspaceInvitation({
      invitationId: 91,
      institutionId: 2945,
      revokedByUserId: 7,
    });

    expect(revoked).toMatchObject({
      id: 91,
      status: "revoked",
      email: "analyst@example.com",
    });
    expect(mocks.state.sqlCalls[0].text).toContain("invitation_status = 'revoked'");
    expect(mocks.state.sqlCalls[0].values).toEqual([7, 91, 2945]);
  });

  it("accepts one invitation only while it is pending, unexpired and for this exact email", async () => {
    mocks.state.queuedRows.push(
      [
        {
          id: 91,
          institution_id: 2945,
          invited_role: "analyst",
          invited_by_user_id: 7,
          notes: "Competitive review support.",
        },
      ],
      [
        {
          id: 51,
          institution_id: 2945,
          institution_name: "Hamilton Bank",
          city: "New York",
          state_code: "NY",
          user_id: 8,
          membership_role: "analyst",
          membership_status: "active",
          source: "delegated",
          claim_id: null,
          granted_by_user_id: 7,
          granted_at: "2026-08-15T10:00:00.000Z",
          notes: "Competitive review support.",
        },
      ],
    );

    const membership = await acceptWorkspaceInvitation({
      invitationId: 91,
      userId: 8,
      email: "Analyst@Example.com",
    });

    expect(membership).toMatchObject({ id: 51, institutionId: 2945, userId: 8, role: "analyst", source: "delegated" });
    const update = mocks.state.sqlCalls[0];
    expect(update.text).toContain("invitation_status = 'accepted'");
    expect(update.text).toContain("invitation_status = 'pending'");
    expect(update.text).toContain("expires_at > NOW()");
    expect(update.values).toEqual([8, 91, "analyst@example.com"]);
    expect(mocks.state.sqlCalls[1].text).toContain("INSERT INTO institution_workspace_memberships");
  });

  it("grants nothing when the invitation is no longer pending", async () => {
    mocks.state.queuedRows.push([]);

    const membership = await acceptWorkspaceInvitation({ invitationId: 91, userId: 8, email: "a@example.com" });

    expect(membership).toBeNull();
    expect(mocks.state.sqlCalls).toHaveLength(1);
  });

  it("reads one invitation for the accept flow with a row lock and the database's expiry judgement", async () => {
    mocks.state.queuedRows.push([
      {
        id: 91,
        institution_id: 2945,
        email: "a@example.com",
        invited_role: "viewer",
        invitation_status: "pending",
        expired: true,
        accepted_by_user_id: null,
      },
    ]);

    expect(await getWorkspaceInvitationForAccept(91)).toEqual({
      id: 91,
      institutionId: 2945,
      email: "a@example.com",
      role: "viewer",
      status: "pending",
      expired: true,
      acceptedByUserId: null,
    });
    expect(mocks.state.sqlCalls[0].text).toContain("FOR UPDATE");
  });
});
