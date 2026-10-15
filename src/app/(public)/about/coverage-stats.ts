import { COVERAGE_LABELS, type PublicStatsSummary } from "@/lib/public-stats";

/**
 * The About page's coverage figures (#1179): the shared snapshot's counts under the shared
 * names, so "institutions" and "fees" mean the same thing here as on the homepage and /fees.
 */
export function aboutCoverageStats(
  summary: Pick<PublicStatsSummary, "institutionsLabel" | "observationsLabel" | "categoriesLabel" | "statesLabel">,
): { value: string; label: string }[] {
  return [
    { value: summary.institutionsLabel, label: COVERAGE_LABELS.institutions },
    { value: summary.observationsLabel, label: COVERAGE_LABELS.observations },
    { value: summary.categoriesLabel, label: COVERAGE_LABELS.categories },
    { value: summary.statesLabel, label: "States" },
  ];
}
