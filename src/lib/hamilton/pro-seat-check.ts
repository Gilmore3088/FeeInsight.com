import { sql } from "@/lib/data-store/connection";
import {
  getDefaultPeerSets,
  getSavedPeerSets,
  savePeerSet,
  setDefaultPeerSet,
} from "@/lib/data-store/saved-peers";
import {
  createInstitutionWorkspaceInvitation,
  getActiveInstitutionMembership,
  getInstitutionWorkspaceSeatUsage,
  grantInstitutionWorkspaceMembership,
} from "@/lib/hamilton/institution-membership";
import { pickActivePeerSet, resolveHamiltonPeerIndex } from "@/lib/hamilton/peer-index";
import {
  acceptSignedWorkspaceInvite,
  buildWorkspaceInvitePath,
  inviteLinksConfigured,
  signWorkspaceInviteToken,
  verifyWorkspaceInviteToken,
} from "@/lib/hamilton/workspace-invite-link";

/**
 * Atlas's end-to-end check of team seats and custom peer groups, run on prod with two test
 * accounts and never a customer's or James's own. It takes the same code paths a bank does:
 *
 *   1. the owner holds a seat on the test bank's workspace (granted here as manual_admin);
 *   2. the owner invites the teammate: a pending invitation and a signed link;
 *   3. the teammate accepts that link (acceptSignedWorkspaceInvite, the /workspace-invite path);
 *   4. the owner saves a team peer group and picks "Use for all charts";
 *   5. Hamilton's peer resolver, for both people, follows that group.
 *
 * Nothing is emailed: the link is built and accepted here, never sent. Running it again reuses
 * the seats and the group it made, so it can run any number of times.
 */
export const SEAT_CHECK = {
  /** Cinfed Federal Credit Union (OH): the bank the journey test account already uses. */
  institutionId: 6561,
  ownerEmail: "jlgilmore2+feeinsight-journey-20260817@gmail.com",
  teammateEmail: "jlgilmore2+feeinsight-journey-20260817-b@gmail.com",
  peerSetName: "Seat check: Ohio credit unions",
  peerFilters: { charter_type: "credit_union", states: ["OH"] },
} as const;

interface TestUser {
  id: number;
  email: string;
  username: string;
  role: string;
}

export interface ProSeatCheckPerson {
  userId: number;
  label: string | null;
  source: string;
  peerSetId: string | null;
  categories: number;
  follows: boolean;
}

export interface ProSeatCheckResult {
  dryRun: boolean;
  institutionId: number;
  owner: { userId: number; seat: "existing" | "granted" | "missing" };
  teammate: {
    userId: number;
    invitationId: number | null;
    invitePath: string | null;
    tamperedLinkRefused: boolean | null;
    accept: string;
    seat: boolean;
    savedBank: number | null;
  };
  seatsUsed: number;
  peerSet: { id: number | null; created: boolean; isDefault: boolean };
  hamilton: { owner: ProSeatCheckPerson | null; teammate: ProSeatCheckPerson | null };
  passed: boolean;
  problems: string[];
}

async function loadTestUser(email: string): Promise<TestUser | null> {
  const rows = await sql`
    SELECT id, email, username, role FROM users WHERE LOWER(email) = ${email.toLowerCase()} AND is_active = TRUE LIMIT 1
  ` as Record<string, unknown>[];
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    email: String(row.email ?? ""),
    username: String(row.username ?? row.email ?? ""),
    role: String(row.role ?? ""),
  };
}

async function savedBank(userId: number): Promise<number | null> {
  const rows = await sql`
    SELECT selected_institution_id FROM hamilton_workspace_contexts WHERE user_id = ${userId} LIMIT 1
  ` as { selected_institution_id: number | string | null }[];
  const value = rows[0]?.selected_institution_id;
  return value == null ? null : Number(value);
}

async function hamiltonFor(userId: number, institutionId: number, setId: number | null): Promise<ProSeatCheckPerson> {
  const context = await resolveHamiltonPeerIndex({ userId, institutionId });
  return {
    userId,
    label: context.label,
    source: context.source,
    peerSetId: context.peerSetId,
    categories: context.entries.length,
    follows: setId !== null && context.source === "saved-peer-set" && context.peerSetId === String(setId),
  };
}

export async function runProSeatCheck(options: { dryRun?: boolean } = {}): Promise<ProSeatCheckResult> {
  const dryRun = options.dryRun === true;
  const institutionId = SEAT_CHECK.institutionId;
  const problems: string[] = [];

  const [owner, teammate] = await Promise.all([
    loadTestUser(SEAT_CHECK.ownerEmail),
    loadTestUser(SEAT_CHECK.teammateEmail),
  ]);
  if (!owner || !teammate) {
    throw new Error(`Seat check test account missing: ${!owner ? SEAT_CHECK.ownerEmail : SEAT_CHECK.teammateEmail}.`);
  }
  // Admin accounts are real staff accounts; the check never touches one.
  if (owner.role === "admin" || teammate.role === "admin") {
    throw new Error("Seat check refuses to run on an admin account.");
  }

  // 1. The owner's seat.
  let ownerSeat: ProSeatCheckResult["owner"]["seat"] = "existing";
  const existingOwnerSeat = await getActiveInstitutionMembership({ userId: owner.id, institutionId });
  if (!existingOwnerSeat) {
    if (dryRun) {
      ownerSeat = "missing";
    } else {
      const granted = await grantInstitutionWorkspaceMembership({
        institutionId,
        userId: owner.id,
        role: "owner",
        source: "manual_admin",
        notes: "Atlas seat check: test account.",
      });
      ownerSeat = granted ? "granted" : "missing";
      if (!granted) problems.push("The owner's seat could not be granted.");
    }
  }

  // 2-3. Invite the teammate and accept the signed link, unless they already hold a seat.
  const teammateResult: ProSeatCheckResult["teammate"] = {
    userId: teammate.id,
    invitationId: null,
    invitePath: null,
    tamperedLinkRefused: null,
    accept: "skipped",
    seat: Boolean(await getActiveInstitutionMembership({ userId: teammate.id, institutionId })),
    savedBank: null,
  };
  if (teammateResult.seat) {
    teammateResult.accept = "already_member";
  } else if (!inviteLinksConfigured()) {
    teammateResult.accept = "not_configured";
    problems.push("BFI_COOKIE_SECRET is not set, so invite links can't be signed.");
  } else if (!dryRun && ownerSeat !== "missing") {
    const invitation = await createInstitutionWorkspaceInvitation({
      institutionId,
      email: teammate.email,
      role: "analyst",
      invitedByUserId: owner.id,
      notes: "Atlas seat check: test account, link never emailed.",
    });
    if (!invitation) {
      teammateResult.accept = "no_seat_left";
      problems.push("The invitation was refused: the workspace has no open seat.");
    } else {
      const identity = { invitationId: invitation.id, email: invitation.email, institutionId };
      const token = signWorkspaceInviteToken(identity) ?? "";
      teammateResult.invitationId = invitation.id;
      teammateResult.invitePath = buildWorkspaceInvitePath(identity);
      teammateResult.tamperedLinkRefused = !verifyWorkspaceInviteToken(
        { ...identity, institutionId: institutionId + 1 },
        token,
      );
      const accepted = await acceptSignedWorkspaceInvite({
        invitationId: invitation.id,
        token,
        user: { id: teammate.id, email: teammate.email, username: teammate.username },
      });
      teammateResult.accept = accepted.status;
      teammateResult.seat = accepted.status === "accepted" || accepted.status === "already_accepted";
      if (!teammateResult.seat) problems.push(`The teammate's invite link was not accepted (${accepted.status}).`);
    }
  }
  teammateResult.savedBank = await savedBank(teammate.id);
  if (teammateResult.seat && teammateResult.savedBank !== institutionId) {
    problems.push(`The teammate's saved bank is ${teammateResult.savedBank ?? "none"}, not the team's bank.`);
  }

  // 4. The team's peer group, used for all charts.
  const ownerKey = String(owner.id);
  const existingSet = (await getSavedPeerSets(ownerKey, institutionId)).find(
    (set) => set.institution_id === institutionId && set.name === SEAT_CHECK.peerSetName,
  );
  let setId = existingSet?.id ?? null;
  let created = false;
  if (!dryRun && setId === null && ownerSeat !== "missing") {
    setId = Number(await savePeerSet(
      SEAT_CHECK.peerSetName,
      { charter_type: SEAT_CHECK.peerFilters.charter_type, states: [...SEAT_CHECK.peerFilters.states] },
      ownerKey,
      institutionId,
    ));
    created = true;
  }
  if (!dryRun && setId !== null) {
    const changed = await setDefaultPeerSet({ id: setId, userId: ownerKey, institutionId });
    if (!changed) problems.push("The owner could not make the peer group the team's default.");
  }
  const defaults = await getDefaultPeerSets({ userId: ownerKey, institutionId });
  const active = pickActivePeerSet(defaults, institutionId);
  const isDefault = setId !== null && active?.id === setId;
  if (setId === null) problems.push("No team peer group was saved.");
  else if (!isDefault) problems.push("The team peer group is not the default for all charts.");

  // 5. Hamilton follows it, for the owner and the teammate.
  const hamilton = {
    owner: setId === null ? null : await hamiltonFor(owner.id, institutionId, setId),
    teammate: setId === null || !teammateResult.seat ? null : await hamiltonFor(teammate.id, institutionId, setId),
  };
  if (hamilton.owner && !hamilton.owner.follows) problems.push(`Hamilton shows "${hamilton.owner.label}" to the owner, not the team's group.`);
  if (hamilton.teammate && !hamilton.teammate.follows) problems.push(`Hamilton shows "${hamilton.teammate.label}" to the teammate, not the team's group.`);

  const usage = await getInstitutionWorkspaceSeatUsage({ institutionId, email: teammate.email });
  const passed = problems.length === 0
    && ownerSeat !== "missing"
    && teammateResult.seat
    && Boolean(hamilton.owner?.follows)
    && Boolean(hamilton.teammate?.follows);

  return {
    dryRun,
    institutionId,
    owner: { userId: owner.id, seat: ownerSeat },
    teammate: teammateResult,
    seatsUsed: usage.used,
    peerSet: { id: setId, created, isDefault },
    hamilton,
    passed,
    problems,
  };
}

export function summarizeProSeatCheck(result: ProSeatCheckResult): string {
  const prefix = result.dryRun ? "Dry run: " : "";
  if (result.passed) {
    return `${prefix}Team seats and peer groups work: ${result.seatsUsed} seat(s) on institution ${result.institutionId}, `
      + `teammate joined by signed link (${result.teammate.accept}), and Hamilton shows "${result.hamilton.owner?.label}" to both people.`;
  }
  return `${prefix}Seat check found ${result.problems.length} problem(s): ${result.problems.join(" ") || "nothing written in a dry run."}`;
}
