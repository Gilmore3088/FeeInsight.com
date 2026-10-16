/**
 * One name per coverage count, used everywhere a count appears, so "institutions"
 * never means two different things on two pages.
 */
export const COVERAGE_LABELS = {
  monitored: "Institutions monitored",
  institutions: "Institutions with published fees",
  observations: "Published fee entries",
  categories: "Fee categories with published fees",
} as const;
