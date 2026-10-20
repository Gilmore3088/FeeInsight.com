import { sql } from "./connection";
import { institutionDisplayName } from "@/lib/institution-display-name";
import { PRO_INSTITUTION_MIN_FEES } from "./data-room";

/**
 * Pro accounts: every user with the premium role or a subscription status
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

/** Atlas's direct-run source (`PRIORITY_INSTITUTION_SOURCE` in agents/atlas/priority-institutions.ts). */
export const ATLAS_PRIORITY_RUN_SOURCE = "atlas.priority_institution";

/**
 * A Pro account's own institution and its live fees (#1078). One below PRO_INSTITUTION_MIN_FEES is
 * the gap Atlas runs first; `lastAtlasRunAt` is its newest direct run, so the admin view says when
 * the collection was last tried rather than only that fees are missing.
 */
export interface ProInstitutionCoverage {
  institutionId: number;
  name: string;
  members: number;
  liveFees: number;
  belowMinimum: boolean;
  lastAtlasRunAt: string | null;
  lastAtlasRunStatus: string | null;
}

export async function getProInstitutionCoverage(db: typeof sql = sql): Promise<ProInstitutionCoverage[]> {
  const rows = await db<
    Array<{ institution_id: number | string; institution_name: string | null; members: number; live_fees: number; run_at: string | Date | null; run_status: string | null }>
  >`
    SELECT pro.institution_id, inst.institution_name, COUNT(DISTINCT pro.user_id)::int AS members,
           (SELECT COUNT(*) FROM published_fee_catalog own WHERE own.institution_id = pro.institution_id)::int AS live_fees,
           run.started_at AS run_at, run.status AS run_status
      FROM institution_workspace_memberships pro
      LEFT JOIN institution_sources inst ON inst.id = pro.institution_id
      LEFT JOIN LATERAL (
        SELECT r.started_at, r.status FROM agent_runs r
         WHERE r.params_json->>'source' = ${ATLAS_PRIORITY_RUN_SOURCE}
           AND r.params_json->>'institution_id' = pro.institution_id::text
         ORDER BY r.started_at DESC NULLS LAST
         LIMIT 1
      ) run ON TRUE
     WHERE pro.membership_status = 'active'
     GROUP BY pro.institution_id, inst.institution_name, run.started_at, run.status
     ORDER BY live_fees ASC, inst.institution_name ASC
  `;
  return rows.map((row) => {
    const liveFees = Number(row.live_fees ?? 0);
    return {
      institutionId: Number(row.institution_id),
      name: row.institution_name ? institutionDisplayName(row.institution_name) : `Institution ${row.institution_id}`,
      members: Number(row.members ?? 0),
      liveFees,
      belowMinimum: liveFees < PRO_INSTITUTION_MIN_FEES,
      lastAtlasRunAt: row.run_at ? new Date(row.run_at).toISOString() : null,
      lastAtlasRunStatus: row.run_status ? String(row.run_status) : null,
    };
  });
}

/** The institution a Pro checkout is priced for: its name and total assets (thousands). */
export interface ProPricingInstitution {
  id: number;
  name: string;
  city: string | null;
  stateCode: string | null;
  assetsThousands: number | null;
  /**
   * The call report those assets come from: the newest FDIC or NCUA filing whose total assets
   * match the figure on file, so /subscribe can name the quarter behind the price (James, Oct 16).
   * Null when no filing matches.
   */
  assetsReport?: { reportDate: string; source: string } | null;
}

export async function getProPricingInstitution(id: number): Promise<ProPricingInstitution | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const [row] = await sql<
    Array<{
      id: number | string;
      institution_name: string;
      city: string | null;
      state_code: string | null;
      asset_size: number | string | null;
      report_date: string | null;
      report_source: string | null;
    }>
  >`
    SELECT s.id, s.institution_name, s.city, s.state_code, s.asset_size,
           f.report_date, f.source AS report_source
      FROM institution_sources s
      LEFT JOIN LATERAL (
        SELECT r.report_date, r.source
          FROM institution_financial_records r
         WHERE r.institution_id = s.id
           AND r.source IN ('fdic', 'ncua')
           AND r.total_assets = s.asset_size
         ORDER BY r.report_date DESC
         LIMIT 1
      ) f ON true
     WHERE s.id = ${id}
  `;
  if (!row) return null;
  const assets = row.asset_size === null ? null : Number(row.asset_size);
  return {
    id: Number(row.id),
    name: institutionDisplayName(row.institution_name),
    city: row.city,
    stateCode: row.state_code,
    assetsThousands: assets !== null && Number.isFinite(assets) ? assets : null,
    assetsReport: row.report_date && row.report_source ? { reportDate: String(row.report_date), source: row.report_source } : null,
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
          name: institutionDisplayName(row.institution_name),
          websiteUrl: row.website_url,
          assetsThousands: assets !== null && Number.isFinite(assets) ? assets : null,
        },
      ];
    }),
  );
}

/** Institutions each user ran Hamilton requests on (agent_runs, run_kind pro_request). */
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
