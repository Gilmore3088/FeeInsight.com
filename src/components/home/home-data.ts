import type { FeeCategorySummary } from "@/lib/data-store/fees";
import type { PublicSnapshot } from "@/lib/public-stats";

/** One fee's national spread, read from the Bank Fee Index snapshot. */
export interface NationalFee {
  key: string;
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  institutions: number;
}

/** Everything the homepage shows that comes from live data. Labels never read "0" on a failed read. */
export interface HomeData {
  institutionsLabel: string;
  observationsLabel: string;
  categoriesLabel: string;
  statesLabel: string;
  freshnessLabel: string;
  refreshedOn: string | null;
  /** National rows for the sizzle and the Every fee table, in display order; missing fees are left out. */
  nationalFees: NationalFee[];
}

/** The fees the homepage shows, in order, with their reader-facing names. */
export const HOME_FEES: readonly { key: string; label: string }[] = [
  { key: "overdraft", label: "Overdraft" },
  { key: "nsf", label: "NSF" },
  { key: "monthly_maintenance", label: "Monthly maintenance" },
];

function toNationalFee(row: FeeCategorySummary, label: string): NationalFee | null {
  const { min_amount, p25_amount, median_amount, p75_amount, max_amount } = row;
  if (
    min_amount == null ||
    p25_amount == null ||
    median_amount == null ||
    p75_amount == null ||
    max_amount == null
  ) {
    return null;
  }
  return {
    key: row.fee_category,
    label,
    min: min_amount,
    q1: p25_amount,
    median: median_amount,
    q3: p75_amount,
    max: max_amount,
    institutions: row.institution_count,
  };
}

export function buildHomeData(snapshot: PublicSnapshot): HomeData {
  const { summary, categories } = snapshot;
  const byKey = new Map(categories.map((row) => [row.fee_category, row]));
  const nationalFees = HOME_FEES.flatMap(({ key, label }) => {
    const row = byKey.get(key);
    const fee = row ? toNationalFee(row, label) : null;
    return fee ? [fee] : [];
  });
  return {
    institutionsLabel: summary.institutionsLabel,
    observationsLabel: summary.observationsLabel,
    categoriesLabel: summary.categoriesLabel,
    statesLabel: summary.statesLabel,
    freshnessLabel: summary.freshnessLabel,
    refreshedOn: summary.refreshedOn,
    nationalFees,
  };
}

export function formatFee(value: number): string {
  return `$${value.toFixed(2)}`;
}
