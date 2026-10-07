import type { sql } from "@/lib/data-store/connection";

export type SqlTag = typeof sql;

/**
 * The fees every price study measures: the most widely published dollar fees, plus
 * the monthly maintenance and out-of-network ATM fees consumers notice most. Fixed so a
 * study is comparable from one quarter to the next.
 */
export const STUDY_FEES = [
  "overdraft",
  "nsf",
  "monthly_maintenance",
  "stop_payment",
  "wire_domestic_outgoing",
  "atm_non_network",
  "card_replacement",
  "cashiers_check",
] as const;

export type StudyFee = (typeof STUDY_FEES)[number];

export type Charter = "bank" | "credit_union";

/** Asset bands for peer groups. `assetsThousands` is in thousands, as stored. */
export function assetBand(assetsThousands: number | null | undefined): string {
  const a = Number(assetsThousands ?? 0);
  if (!Number.isFinite(a) || a <= 0) return "size unknown";
  if (a < 100_000) return "under $100M";
  if (a < 1_000_000) return "$100M-$1B";
  if (a < 10_000_000) return "$1B-$10B";
  return "$10B+";
}

export function charterLabel(charter: Charter): string {
  return charter === "bank" ? "banks" : "credit unions";
}

export function peerGroupLabel(charter: Charter, band: string): string {
  return `${charterLabel(charter)} ${band}`;
}

/** Calendar quarter label for price studies: fee schedules are read as of this quarter. */
export function quarterLabel(now: Date): string {
  return `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
}

export interface InstitutionPrice {
  institutionId: number;
  charter: Charter;
  assetsThousands: number | null;
  fee: StudyFee;
  /** Median of the institution's live dollar amounts for this fee (caps and rates excluded). */
  amount: number;
}

/**
 * Each institution's live price for each study fee, from published_fee_catalog. An
 * institution with several amounts (account tiers) is represented by their median.
 */
export async function readInstitutionPrices(db: SqlTag): Promise<InstitutionPrice[]> {
  const rows = await db`
    SELECT f.institution_id, s.charter_type, s.asset_size, f.canonical_fee_key,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY f.amount)::float8 AS amount
      FROM published_fee_catalog f
      JOIN institution_sources s ON s.id = f.institution_id
     WHERE f.canonical_fee_key = ANY(${[...STUDY_FEES]}::text[])
       AND f.amount > 0
       AND COALESCE(f.is_fee_cap, false) = false
       AND COALESCE(f.amount_kind, 'dollar') <> 'rate'
       AND s.charter_type IN ('bank', 'credit_union')
     GROUP BY f.institution_id, s.charter_type, s.asset_size, f.canonical_fee_key
  `;
  return [...(rows as unknown as Array<Record<string, unknown>>)].map((r) => ({
    institutionId: Number(r.institution_id),
    charter: r.charter_type as Charter,
    assetsThousands: r.asset_size === null ? null : Number(r.asset_size),
    fee: r.canonical_fee_key as StudyFee,
    amount: Number(r.amount),
  }));
}

export interface StudySource {
  name: string;
  asOf: string | null;
}

export const FEE_SOURCE_NAME = "Bank Fee Index live published fees (published_fee_catalog)";
