import type { FinancialSource } from "./financial-sources";

export type FinancialCharter = "bank" | "credit_union";

/** A regulator is selected from canonical institution identity, never from a name. */
export function financialSourceForCharter(charter: unknown): FinancialSource | null {
  return charter === "bank" ? "fdic" : charter === "credit_union" ? "ncua" : null;
}

/** SQL fragments use internal identifiers only; reject interpolated expressions. */
export function canonicalFinancialSourceSql(financialAlias: string, institutionAlias: string): string {
  if (![financialAlias, institutionAlias].every((alias) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(alias))) {
    throw new Error("Financial source predicates require simple SQL aliases");
  }
  return `((${institutionAlias}.charter_type = 'bank' AND ${financialAlias}.source = 'fdic') OR (${institutionAlias}.charter_type = 'credit_union' AND ${financialAlias}.source = 'ncua'))`;
}

export function financialMeasureDefinition(source: FinancialSource) {
  if (source !== "fdic" && source !== "ncua") throw new Error("Unknown financial source");
  return source === "ncua" ? {
    source: "ncua" as const,
    charter_type: "credit_union" as const,
    publisher: "NCUA (5300 call report)",
    measure: "broad_credit_union_fee_income",
    definition: "NCUA 5300 broad member-service and membership fee income; not bank deposit service charges or overdraft-only income",
    source_period_basis: "year_to_date" as const,
    period_basis: "standalone_quarter" as const,
    unit: "thousands of dollars" as const,
  } : {
    source: "fdic" as const,
    charter_type: "bank" as const,
    publisher: "FDIC call report",
    measure: "deposit_service_charge_income",
    definition: "Bank service charges on deposit accounts; not the broader NCUA fee-income measure",
    source_period_basis: "standalone_quarter" as const,
    period_basis: "standalone_quarter" as const,
    unit: "thousands of dollars" as const,
  };
}

export interface FinancialPeerComparison {
  source: FinancialSource;
  charter_type: FinancialCharter;
  publisher: string;
  measure: string;
  definition: string;
  source_period_basis: "year_to_date" | "standalone_quarter";
  period_basis: "standalone_quarter";
  unit: "thousands of dollars";
  report_date: string;
  size_criterion: { kind: "reported_assets"; tier: string; minimum_usd_inclusive: number; maximum_usd_exclusive: number | null };
  subject_included: boolean;
  eligible_count: number;
  reported_count: number;
  ratio_reported_count: number;
  minimum_median_count: number;
  ratio_definition: string;
  ratio_period_basis: "year_to_date" | "standalone_quarter";
  limitations: string[];
}

export function financialPeerComparison(input: {
  source: FinancialSource;
  reportDate: string;
  tier: string;
  minimumAssetsUsd: number;
  maximumAssetsUsd: number;
  subjectIncluded: boolean;
  eligibleCount: number;
  reportedCount: number;
  ratioReportedCount: number;
  minimumMedianCount: number;
}): FinancialPeerComparison {
  return {
    ...financialMeasureDefinition(input.source),
    report_date: input.reportDate,
    size_criterion: {
      kind: "reported_assets",
      tier: input.tier,
      minimum_usd_inclusive: input.minimumAssetsUsd,
      maximum_usd_exclusive: Number.isFinite(input.maximumAssetsUsd) ? input.maximumAssetsUsd : null,
    },
    subject_included: input.subjectIncluded,
    eligible_count: input.eligibleCount,
    reported_count: input.reportedCount,
    ratio_reported_count: input.ratioReportedCount,
    minimum_median_count: input.minimumMedianCount,
    ratio_definition: input.source === "ncua" ? "Year-to-date broad credit-union fee income divided by year-to-date total revenue" : "Quarterly deposit service charges divided by quarterly total revenue",
    ratio_period_basis: input.source === "ncua" ? "year_to_date" : "standalone_quarter",
    limitations: [
      "Eligible count covers same-date filings with reported assets in this numeric range; institutions without that filing cannot be counted.",
      "Income ranks and medians use only positive, computable single-quarter income; ratio medians additionally require a reported ratio.",
      "A same-date cross-section is not a constant historical cohort and is not merger-adjusted.",
      "Bank deposit service charges and broad credit-union fee income are different measures and are never combined in this comparison.",
    ],
  };
}

/** Runtime boundary for adapters that otherwise discard the reader's comparison lineage. */
export function validFinancialPeerComparison(value: unknown): value is FinancialPeerComparison {
  if (!value || typeof value !== "object") return false;
  const comparison = value as Record<string, unknown>;
  const source = comparison.source;
  if ((source !== "fdic" && source !== "ncua") || financialSourceForCharter(comparison.charter_type) !== source) return false;
  const definition = financialMeasureDefinition(source);
  if (comparison.measure !== definition.measure || comparison.period_basis !== "standalone_quarter"
    || comparison.source_period_basis !== definition.source_period_basis || comparison.unit !== "thousands of dollars"
    || comparison.ratio_period_basis !== (source === "ncua" ? "year_to_date" : "standalone_quarter")
    || typeof comparison.report_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(comparison.report_date)
    || Number.isNaN(Date.parse(comparison.report_date))
    || typeof comparison.subject_included !== "boolean") return false;
  for (const key of ["publisher", "definition", "ratio_definition"]) {
    if (typeof comparison[key] !== "string" || !(comparison[key] as string).trim()) return false;
  }
  for (const key of ["eligible_count", "reported_count", "ratio_reported_count", "minimum_median_count"]) {
    if (!Number.isSafeInteger(comparison[key]) || Number(comparison[key]) < 0) return false;
  }
  if (Number(comparison.minimum_median_count) < 5 || Number(comparison.ratio_reported_count) > Number(comparison.reported_count)
    || Number(comparison.reported_count) > Number(comparison.eligible_count)) return false;
  const size = comparison.size_criterion as Record<string, unknown> | null;
  if (!size || size.kind !== "reported_assets" || typeof size.tier !== "string" || !size.tier
    || typeof size.minimum_usd_inclusive !== "number" || !Number.isFinite(size.minimum_usd_inclusive) || size.minimum_usd_inclusive < 0
    || (size.maximum_usd_exclusive !== null && (typeof size.maximum_usd_exclusive !== "number"
      || !Number.isFinite(size.maximum_usd_exclusive) || size.maximum_usd_exclusive <= size.minimum_usd_inclusive))) return false;
  return Array.isArray(comparison.limitations) && comparison.limitations.every((limit) => typeof limit === "string");
}
