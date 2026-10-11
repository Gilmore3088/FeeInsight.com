import type { ReportArtifactMetadata } from "@/lib/hamilton/types";

/** Reader-facing names for every report type, including the four templates. */
export const REPORT_TYPE_LABELS: Record<string, string> = {
  quarterly_strategy: "Quarterly Strategy Report",
  peer_brief: "Peer Brief",
  monthly_pulse: "Monthly Pulse",
  state_index: "Regional Analysis",
  peer_benchmarking: "Peer Benchmarking",
  regional_landscape: "Regional Fee Landscape",
  category_deep_dive: "Category Deep Dive",
  competitive_positioning: "Competitive Positioning",
};

/** Never shows a raw key: unknown types read as words ("new_type" -> "New type"). */
export function reportTypeLabel(reportType: string): string {
  const known = REPORT_TYPE_LABELS[reportType];
  if (known) return known;
  const words = reportType.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What the evidence policy means for the reader, in their words. */
export function evidencePolicyLabel(policy: ReportArtifactMetadata["evidencePolicy"] | null | undefined): string {
  // Reports read published_fee_catalog, which holds only fees verified against the bank's own
  // schedule, so a "provisional-first" report has nothing still in review to include.
  if (policy === "source-diligence") return "Built for source review";
  return "Published, verified fees";
}

/**
 * Section headings shared by the on-screen report and its PDF, in plain banker language.
 * Hamilton shows the evidence; it never recommends a price, so no heading says it does.
 */
export const REPORT_SECTION_HEADINGS = {
  summary: "Summary",
  addedFindings: "Findings you added",
  snapshot: "Snapshot: research institution against its benchmark",
  rationale: "Why it matters",
  tradeoffs: "What each choice trades off",
  position: "For management to weigh",
  implementation: "If management makes a change",
} as const;
