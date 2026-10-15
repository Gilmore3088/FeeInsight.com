/**
 * How a Pro buyer's own institution is linked (James, 2026-10-15, #1405): at Pro signup the buyer
 * names their bank or credit union and proves it with their business email. There is no claim for
 * the buyer to file:
 * - checkout for a bank or credit union needs a work address, not a personal one;
 * - the link (the owner membership that makes Hamilton treat the bank as theirs) is made once the
 *   email is confirmed and its domain matches the bank's website;
 * - any other case waits for an admin check in the Data Trust queue, while Pro itself works at once.
 * Researching any institution is separate and never needs a link.
 */
import type { sql as sqlClient } from "@/lib/data-store/connection";
import { baseDomain, emailDomain } from "@/lib/pro-plan-watch";

type Db = typeof sqlClient;

/** Personal mailbox providers: an address here never proves employment at a bank. */
export const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com", "outlook.com", "hotmail.com",
  "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com",
  "pm.me", "gmx.com", "gmx.us", "mail.com", "zoho.com", "yandex.com", "fastmail.com", "hey.com",
  "comcast.net", "att.net", "sbcglobal.net", "verizon.net", "bellsouth.net", "cox.net", "charter.net",
  "earthlink.net", "frontier.com", "optonline.net", "windstream.net", "centurylink.net", "q.com",
]);

/** True for an address at a personal mailbox provider (or with no usable domain). */
export function isPersonalEmail(email: string | null | undefined): boolean {
  const domain = emailDomain(email);
  return domain === null || PERSONAL_EMAIL_DOMAINS.has(domain);
}

/** True when the email's domain is the institution website's domain ("jane@mail.firstbank.com" and "www.firstbank.com"). */
export function emailMatchesWebsite(email: string | null | undefined, websiteUrl: string | null | undefined): boolean {
  const mail = emailDomain(email);
  const site = baseDomain(websiteUrl);
  return mail !== null && site !== null && !PERSONAL_EMAIL_DOMAINS.has(mail) && mail === site;
}

/** The buyer-facing line when checkout for a bank or credit union is started with a personal address. */
export function personalEmailCheckoutError(contactEmail: string): string {
  return `Pro for a bank or credit union needs your work email, so we can link your institution. Sign in with your work address, or email ${contactEmail}.`;
}

/**
 * Links the user to each institution they named at Pro signup whose website matches their
 * confirmed email: the open request is marked verified and the owner membership granted. Returns
 * the institution ids linked. Requests that don't match stay open for the admin check.
 */
export async function linkVerifiedInstitutions(db: Db, userId: number): Promise<number[]> {
  const candidates = await db<Array<{ claim_id: number; institution_id: number; review_status: string; email: string | null; website_url: string | null }>>`
    SELECT c.id AS claim_id, c.institution_id, c.review_status, u.email, s.website_url
      FROM institution_claims c
      JOIN users u ON u.id = c.claimant_user_id
      JOIN institution_sources s ON s.id = c.institution_id
     WHERE c.claimant_user_id = ${userId}
       AND c.review_status IN ('pending', 'needs_info')
       AND u.email_confirmed_at IS NOT NULL
  `;
  const linked: number[] = [];
  for (const row of candidates) {
    if (!emailMatchesWebsite(row.email, row.website_url)) continue;
    const domain = emailDomain(row.email);
    const updated = await db<Array<{ id: number }>>`
      UPDATE institution_claims
         SET review_status = 'accepted', reviewed_at = NOW(), resolution = 'verified_claim',
             -- No person reviewed it: the buyer's own confirmed inbox is the proof, so they stand as reviewer.
             reviewer_id = ${userId},
             review_notes = ${`Verified automatically: confirmed email at @${domain} matches the institution's website.`},
             updated_at = NOW()
       WHERE id = ${row.claim_id} AND review_status IN ('pending', 'needs_info')
      RETURNING id
    `;
    if (updated.length === 0) continue;
    await db`
      INSERT INTO institution_claim_events (claim_id, actor_user_id, event_type, previous_status, new_status, notes, metadata)
      VALUES (${row.claim_id}, ${userId}, 'accepted', ${row.review_status}, 'accepted',
              ${`Verified by confirmed email at @${domain}.`},
              ${db.json({ institution_id: row.institution_id, source: "email_domain", email_domain: domain })})
    `;
    await db`
      INSERT INTO institution_workspace_memberships (
        institution_id, user_id, membership_role, membership_status, source, claim_id, granted_at, notes, created_at, updated_at
      ) VALUES (
        ${row.institution_id}, ${userId}, 'owner', 'active', 'claim', ${row.claim_id}, NOW(),
        ${`Linked at Pro signup by confirmed email at @${domain}.`}, NOW(), NOW()
      )
      ON CONFLICT (institution_id, user_id) WHERE membership_status = 'active' DO NOTHING
    `;
    linked.push(row.institution_id);
  }
  return linked;
}

/** The institution a Pro buyer named at signup that is not linked yet, for Settings. */
export interface PendingInstitutionLink {
  institutionName: string;
  emailConfirmed: boolean;
}

/** The newest open link request, or null; a failed read shows nothing. */
export async function getPendingInstitutionLink(db: Db, userId: number): Promise<PendingInstitutionLink | null> {
  try {
    const [row] = await db<Array<{ institution_name: string; confirmed: string | null }>>`
      SELECT s.institution_name, to_jsonb(u.*) ->> 'email_confirmed_at' AS confirmed
        FROM institution_claims c
        JOIN institution_sources s ON s.id = c.institution_id
        JOIN users u ON u.id = c.claimant_user_id
       WHERE c.claimant_user_id = ${userId}
         AND c.review_status IN ('pending', 'needs_info')
       ORDER BY c.updated_at DESC, c.id DESC
       LIMIT 1
    `;
    return row ? { institutionName: row.institution_name, emailConfirmed: Boolean(row.confirmed) } : null;
  } catch {
    return null;
  }
}
