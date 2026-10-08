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

/** The institution a Pro checkout is priced for: its name and total assets (thousands). */
export interface ProPricingInstitution {
  id: number;
  name: string;
  city: string | null;
  stateCode: string | null;
  assetsThousands: number | null;
}

export async function getProPricingInstitution(id: number): Promise<ProPricingInstitution | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const [row] = await sql<
    Array<{ id: number | string; institution_name: string; city: string | null; state_code: string | null; asset_size: number | string | null }>
  >`
    SELECT id, institution_name, city, state_code, asset_size
      FROM institution_sources
     WHERE id = ${id}
  `;
  if (!row) return null;
  const assets = row.asset_size === null ? null : Number(row.asset_size);
  return {
    id: Number(row.id),
    name: row.institution_name,
    city: row.city,
    stateCode: row.state_code,
    assetsThousands: assets !== null && Number.isFinite(assets) ? assets : null,
  };
}

/** Active paid Pro users with a Stripe customer: the accounts the plan watch list checks. */
export interface PaidProUser {
  id: number;
  name: string;
  email: string | null;
  stripeCustomerId: string;
}

export async function getPaidProUsers(): Promise<PaidProUser[]> {
  const rows = await sql<Array<{ id: number | string; name: string | null; email: string | null; stripe_customer_id: string }>>`
    SELECT id, COALESCE(NULLIF(display_name, ''), username) AS name, email, stripe_customer_id
      FROM users
     WHERE subscription_status = 'active'
       AND stripe_customer_id IS NOT NULL
       AND role NOT IN ('admin', 'analyst')
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name ?? ""),
    email: row.email,
    stripeCustomerId: row.stripe_customer_id,
  }));
}

/** Name, website and total assets (thousands) for the given institutions. */
export async function getWatchInstitutions(
  ids: number[],
): Promise<Map<number, { id: number; name: string; websiteUrl: string | null; assetsThousands: number | null }>> {
  const valid = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (valid.length === 0) return new Map();
  const rows = await sql<
    Array<{ id: number | string; institution_name: string; website_url: string | null; asset_size: number | string | null }>
  >`
    SELECT id, institution_name, website_url, asset_size
      FROM institution_sources
     WHERE id = ANY(${valid})
  `;
  return new Map(
    rows.map((row) => {
      const assets = row.asset_size === null ? null : Number(row.asset_size);
      return [
        Number(row.id),
        {
          id: Number(row.id),
          name: row.institution_name,
          websiteUrl: row.website_url,
          assetsThousands: assets !== null && Number.isFinite(assets) ? assets : null,
        },
      ];
    }),
  );
}

/** Institutions each user ran Hamilton Pro requests on (agent_runs, run_kind pro_request). */
export async function getProRequestInstitutions(userIds: number[], days = 30): Promise<Map<number, number[]>> {
  const result = new Map<number, number[]>();
  if (userIds.length === 0) return result;
  const rows = await sql<Array<{ user_id: string; institution_id: string }>>`
    SELECT DISTINCT params_json->>'user_id' AS user_id, params_json->>'institution_id' AS institution_id
      FROM agent_runs
     WHERE run_kind = 'pro_request'
       AND started_at >= NOW() - make_interval(days => ${days})
       AND params_json->>'user_id' = ANY(${userIds.map(String)})
       AND params_json->>'institution_id' IS NOT NULL
  `;
  for (const row of rows) {
    const userId = Number(row.user_id);
    const institutionId = Number(row.institution_id);
    if (!Number.isSafeInteger(institutionId)) continue;
    result.set(userId, [...(result.get(userId) ?? []), institutionId]);
  }
  return result;
}
