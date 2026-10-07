/**
 * Team seats for an institution workspace. Pure helpers only (no database import), so the
 * settings page's client component can show the same count the server enforces.
 *
 * A seat is a person: an active member, or an email with a pending, unexpired invitation.
 * The owner holds one of the seats. A member who also has a pending invitation counts once.
 * The server-side count is `getInstitutionWorkspaceSeatUsage` in `institution-membership.ts`.
 */

/** Logins per institution account, the owner included. */
export const WORKSPACE_SEAT_LIMIT = 5;

interface SeatMember {
  userId: number;
  userEmail: string | null;
}

interface SeatInvitation {
  email: string;
  status?: string;
  expiresAt?: string;
}

function seatKeyForMember(member: SeatMember): string {
  return member.userEmail ? member.userEmail.trim().toLowerCase() : `user:${member.userId}`;
}

/** Seats in use: distinct active members plus pending, unexpired invitations. */
export function countWorkspaceSeats(
  members: SeatMember[],
  invitations: SeatInvitation[],
  now: Date = new Date(),
): number {
  const seats = new Set(members.map(seatKeyForMember));
  for (const invitation of invitations) {
    if (invitation.status && invitation.status !== "pending") continue;
    if (invitation.expiresAt && new Date(invitation.expiresAt).getTime() <= now.getTime()) continue;
    seats.add(invitation.email.trim().toLowerCase());
  }
  return seats.size;
}

/** True when one more person can be added without passing the limit. */
export function hasOpenSeat(used: number, limit: number = WORKSPACE_SEAT_LIMIT): boolean {
  return used < limit;
}

export function seatLimitMessage(limit: number = WORKSPACE_SEAT_LIMIT): string {
  return `All ${limit} seats on this institution account are in use. Remove someone or cancel an invite to add another person.`;
}
