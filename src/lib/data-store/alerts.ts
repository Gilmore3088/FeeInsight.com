import { sql } from "./connection";
import { statsRowFilter } from "./fee-stats";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";
import { institutionDisplayName } from "@/lib/institution-display-name";

export interface AlertSubscription {
  id: number;
  user_id: number;
  institution_id: number;
  institution_name: string;
  /** Null means every fee the institution publishes. */
  fee_categories: string[] | null;
  is_active: boolean;
  created_at: string;
  last_alerted_at: string | null;
}

/** Most categories one saved institution can follow before it should just follow all. */
export const MAX_ALERT_CATEGORIES = 20;

const TAXONOMY = new Set(Object.values(FEE_FAMILIES).flat());

export type NormalizedAlertCategories =
  | { ok: true; categories: string[] | null }
  | { ok: false; error: string };

/**
 * Validates a requested category list: strings from the fee taxonomy only, trimmed and
 * de-duplicated, at most MAX_ALERT_CATEGORIES. Absent, null or empty means "all fees".
 */
export function normalizeAlertCategories(input: unknown): NormalizedAlertCategories {
  if (input === undefined || input === null) return { ok: true, categories: null };
  if (!Array.isArray(input) || input.some((value) => typeof value !== "string")) {
    return { ok: false, error: "fee_categories must be an array of strings" };
  }
  const categories = [...new Set((input as string[]).map((value) => value.trim()).filter(Boolean))];
  const unknown = categories.filter((value) => !TAXONOMY.has(value));
  if (unknown.length > 0) {
    return { ok: false, error: `Unknown fee categor${unknown.length === 1 ? "y" : "ies"}: ${unknown.join(", ")}` };
  }
  if (categories.length > MAX_ALERT_CATEGORIES) {
    return { ok: false, error: `Follow at most ${MAX_ALERT_CATEGORIES} fees, or follow all of them` };
  }
  return { ok: true, categories: categories.length > 0 ? categories : null };
}

/**
 * Saving a second fee for the same institution adds to what the reader already follows;
 * "all fees" on either side wins.
 */
export function mergeAlertCategories(
  existing: string[] | null | undefined,
  incoming: string[] | null,
  hasExisting: boolean,
): string[] | null {
  if (!hasExisting) return incoming;
  if (existing === null || existing === undefined || incoming === null) return null;
  return [...new Set([...existing, ...incoming])];
}

export async function getAlertSubscriptions(userId: number): Promise<AlertSubscription[]> {
  const rows = await sql`
    SELECT a.id, a.user_id, a.institution_id, a.fee_categories,
           a.is_active, a.created_at, a.last_alerted_at,
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
      SELECT CASE WHEN ${feeCategory} = 'overdraft' THEN MAX(ef.amount)
                  ELSE PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ef.amount) END AS amount
      FROM published_fee_catalog ef
      WHERE ef.institution_id = a.institution_id
        AND ef.fee_category = ${feeCategory}
        AND ef.review_status = 'approved'
        AND ef.amount IS NOT NULL
        AND ef.amount >= 0
        AND ${sql.unsafe(statsRowFilter("ef"))}
    ) f ON TRUE
    WHERE a.user_id = ${userId} AND a.is_active = TRUE
    ORDER BY ct.institution_name
    LIMIT ${Math.max(1, Math.min(10, limit))}
  `;
  return [...rows].map((row) => {
    const r = row as unknown as SavedInstitutionFee;
    return {
      institution_id: Number(r.institution_id),
      institution_name: institutionDisplayName(r.institution_name),
      state_code: r.state_code,
      amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
    };
  });
}

/** The reader's active subscription to one institution, if any. */
export async function getAlertSubscriptionForInstitution(
  userId: number,
  institutionId: number,
): Promise<{ id: number; fee_categories: string[] | null } | null> {
  const [row] = await sql`
    SELECT id, fee_categories
    FROM institution_fee_alert_subscriptions
    WHERE user_id = ${userId} AND institution_id = ${institutionId} AND is_active = TRUE
    LIMIT 1
  `;
  if (!row) return null;
  return { id: Number(row.id), fee_categories: (row.fee_categories as string[] | null) ?? null };
}

/**
 * Saves an institution for the reader, adding the given fees to any they already
 * follow there (see `mergeAlertCategories`). Null follows every fee.
 */
export async function addAlertSubscription(
  userId: number,
  institutionId: number,
  feeCategories: string[] | null = null,
): Promise<{ id: number; fee_categories: string[] | null }> {
  const existing = await getAlertSubscriptionForInstitution(userId, institutionId);
  const merged = mergeAlertCategories(existing?.fee_categories, feeCategories, existing !== null);
  return replaceAlertSubscription(userId, institutionId, merged);
}

/** Sets exactly which fees the reader follows at one institution (null = all). */
export async function replaceAlertSubscription(
  userId: number,
  institutionId: number,
  feeCategories: string[] | null,
): Promise<{ id: number; fee_categories: string[] | null }> {
  const [row] = await sql`
    SELECT upsert_institution_fee_alert_subscription(
      ${userId},
      ${institutionId},
      ${feeCategories}
    ) as id
  `;
  return { id: Number(row.id), fee_categories: feeCategories };
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
