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
  if (policy === "verified-only") return "Verified fees only";
  if (policy === "source-diligence") return "Built for source review";
  return "Includes fees still in review";
}
