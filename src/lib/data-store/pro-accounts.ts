import { sql } from "./connection";

/**
 * Hamilton Pro accounts: every user with the premium role or a subscription status
 * other than none. "Stripe customer" only says a Stripe record exists; payments
 * themselves live in Stripe and are not read here.
 */

export interface ProAccount {
  id: number;
  name: string;
  email: string | null;
  institution: string | null;
  role: string;
  status: string;
  hasStripeCustomer: boolean;
  pastDueSince: string | null;
  createdAt: string;
  isActive: boolean;
}

export async function getProAccounts(): Promise<ProAccount[]> {
  const rows = await sql`
    SELECT id, COALESCE(NULLIF(display_name, ''), username) AS name, email, institution_name,
           role, COALESCE(subscription_status, 'none') AS status,
           stripe_customer_id IS NOT NULL AS has_stripe, past_due_since, created_at, is_active
      FROM users
     WHERE role = 'premium' OR COALESCE(subscription_status, 'none') <> 'none'
     ORDER BY created_at DESC
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name ?? ""),
    email: row.email ? String(row.email) : null,
    institution: row.institution_name ? String(row.institution_name) : null,
    role: String(row.role),
    status: String(row.status),
    hasStripeCustomer: Boolean(row.has_stripe),
    pastDueSince: row.past_due_since ? new Date(row.past_due_since as string | Date).toISOString() : null,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    isActive: Boolean(row.is_active),
  }));
}
