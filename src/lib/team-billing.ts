import { redirect } from "next/navigation";
import type { User } from "@/lib/auth";
import { canAccessPremium, isPaymentLapsed, PAST_DUE_GRACE_DAYS } from "@/lib/access";
import { sql } from "@/lib/data-store/connection";
import { subscribeReason } from "@/lib/subscribe-reason";

type SqlClient = typeof sql;

/** Where a seat member lands when their team owner's payment has lapsed (James, 2026-10-20; #1999). */
export const TEAM_BILLING_PATH = "/account/team-billing";
export const BILLING_ISSUE_PATH = "/account/billing-issue";

/** The team whose owner's payment lapsed, as far as it is known. */
export interface LapsedTeam {
  ownerName: string | null;
  ownerEmail: string | null;
  teamName: string | null;
}

function known(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * One query: is this user an active, non-owner member of an institution workspace whose active
 * owner is past due beyond the grace window? The mirror of `hasWorkspaceSeat` in auth.ts: an
 * unknown past-due start counts as in grace there, so it never counts as lapsed here. Any error
 * returns null, so the caller falls back to /subscribe as before.
 */
export async function findLapsedTeam(userId: number, db: SqlClient = sql): Promise<LapsedTeam | null> {
  try {
    const rows = await db<Array<{ owner_name: unknown; owner_email: unknown; team_name: unknown }>>`
      SELECT owner_user.display_name AS owner_name,
             owner_user.email AS owner_email,
             inst.institution_name AS team_name
        FROM institution_workspace_memberships seat
        JOIN institution_workspace_memberships owner_seat
          ON owner_seat.institution_id = seat.institution_id
         AND owner_seat.membership_role = 'owner'
         AND owner_seat.membership_status = 'active'
        JOIN users owner_user
          ON owner_user.id = owner_seat.user_id
         AND owner_user.is_active = true
        LEFT JOIN institution_sources inst ON inst.id = seat.institution_id
       WHERE seat.user_id = ${userId}
         AND seat.membership_status = 'active'
         AND seat.membership_role <> 'owner'
         AND owner_user.id <> ${userId}
         AND owner_user.subscription_status = 'past_due'
         AND to_jsonb(owner_user.*) ->> 'past_due_since' IS NOT NULL
         AND (to_jsonb(owner_user.*) ->> 'past_due_since')::timestamptz
               <= NOW() - make_interval(days => ${PAST_DUE_GRACE_DAYS})
       ORDER BY seat.institution_id
       LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return { ownerName: known(row.owner_name), ownerEmail: known(row.owner_email), teamName: known(row.team_name) };
  } catch (error) {
    console.error(`[team-billing] lapsed team lookup failed for user ${userId}:`, error);
    return null;
  }
}

interface GateOptions {
  lookup?: (userId: number) => Promise<LapsedTeam | null>;
  now?: Date;
}

/**
 * Where a Pro page sends someone without premium access, or null when they have it. The lapsed
 * owner fixes their own card at /account/billing-issue; a seat member whose owner lapsed can't,
 * so they get the team-billing page instead of /subscribe (James, 2026-10-20; #1999).
 */
export async function premiumGatePath(
  user: User | null,
  returnTo: string,
  { lookup = findLapsedTeam, now = new Date() }: GateOptions = {},
): Promise<string | null> {
  const from = encodeURIComponent(returnTo);
  if (!user) return `/login?from=${from}`;
  if (isPaymentLapsed(user, now)) return BILLING_ISSUE_PATH;
  if (canAccessPremium(user)) return null;
  if (await lookup(user.id)) return TEAM_BILLING_PATH;
  return `/subscribe?from=${from}&reason=${subscribeReason(user)}`;
}

/** Redirects a Pro page's visitor who lacks premium access to `premiumGatePath`; returns otherwise. */
export async function redirectWithoutPremium(user: User | null, returnTo: string): Promise<void> {
  const gate = await premiumGatePath(user, returnTo);
  if (gate) redirect(gate);
}

export interface TeamBillingContact {
  /** Who to ask: the owner's name, or "your team's owner". */
  who: string;
  /** The team (institution) name, when known. */
  team: string | null;
  href: string;
  linkLabel: string;
}

/** The contact line on the team-billing page: the owner when known, otherwise us. */
export function teamBillingContact(team: LapsedTeam, fallbackEmail: string): TeamBillingContact {
  const who = team.ownerName ?? "your team's owner";
  if (team.ownerEmail) {
    return {
      who,
      team: team.teamName,
      href: `mailto:${team.ownerEmail}`,
      linkLabel: `Email ${team.ownerName ?? team.ownerEmail}`,
    };
  }
  return { who, team: team.teamName, href: `mailto:${fallbackEmail}`, linkLabel: "Email us" };
}
