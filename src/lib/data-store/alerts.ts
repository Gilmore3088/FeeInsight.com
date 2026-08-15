import { sql } from "./connection";

export interface AlertSubscription {
  id: number;
  user_id: number;
  institution_id: number;
  institution_name: string;
  fee_categories: string[] | null;
  is_active: boolean;
  created_at: string;
}

export async function getAlertSubscriptions(userId: number): Promise<AlertSubscription[]> {
  const rows = await sql`
    SELECT a.id, a.user_id, a.institution_id, a.fee_categories,
           a.is_active, a.created_at,
           ct.institution_name
    FROM institution_fee_alert_subscriptions a
    JOIN institution_sources ct ON ct.id = a.institution_id
    WHERE a.user_id = ${userId} AND a.is_active = TRUE
    ORDER BY ct.institution_name
  `;
  return [...rows] as unknown as AlertSubscription[];
}

export interface SavedInstitutionFee {
  institution_id: number;
  institution_name: string;
  state_code: string | null;
  /** The institution's published amount for the category, or null if it publishes none. */
  amount: number | null;
}

/**
 * A signed-in reader's saved institutions, with their published amount for one fee.
 *
 * Powers the registered-consumer tier on guide pages: "here is what *your* bank charges
 * for the fee you are reading about." Additive personalisation only — no guide prose is
 * ever gated behind having an account.
 */
export async function getSavedInstitutionFees(
  userId: number,
  feeCategory: string,
  limit = 3,
): Promise<SavedInstitutionFee[]> {
  const rows = await sql`
    SELECT a.institution_id,
           ct.institution_name,
           ct.state_code,
           f.amount
    FROM institution_fee_alert_subscriptions a
    JOIN institution_sources ct ON ct.id = a.institution_id
    LEFT JOIN LATERAL (
      SELECT ef.amount
      FROM published_fee_catalog ef
      WHERE ef.institution_id = a.institution_id
        AND ef.fee_category = ${feeCategory}
        AND ef.review_status = 'approved'
        AND ef.amount IS NOT NULL
      ORDER BY ef.amount ASC
      LIMIT 1
    ) f ON TRUE
    WHERE a.user_id = ${userId} AND a.is_active = TRUE
    ORDER BY ct.institution_name
    LIMIT ${Math.max(1, Math.min(10, limit))}
  `;
  return [...rows].map((row) => {
    const r = row as unknown as SavedInstitutionFee;
    return {
      institution_id: Number(r.institution_id),
      institution_name: r.institution_name,
      state_code: r.state_code,
      amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
    };
  });
}

export async function addAlertSubscription(
  userId: number,
  institutionId: number,
  feeCategories?: string[],
): Promise<{ id: number }> {
  const [row] = await sql`
    SELECT upsert_institution_fee_alert_subscription(
      ${userId},
      ${institutionId},
      ${feeCategories || null}
    ) as id
  `;
  return { id: Number(row.id) };
}

export async function removeAlertSubscription(
  userId: number,
  institutionId: number,
): Promise<boolean> {
  const [row] = await sql`
    SELECT deactivate_institution_fee_alert_subscription(
      ${userId},
      ${institutionId}
    ) as affected_count
  `;
  return Number(row.affected_count) > 0;
}

export async function getAlertSubscriptionCount(userId: number): Promise<number> {
  const [row] = await sql`
    SELECT COUNT(*) as cnt FROM institution_fee_alert_subscriptions
    WHERE user_id = ${userId} AND is_active = TRUE
  `;
  return Number(row.cnt);
}
