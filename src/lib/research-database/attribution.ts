export const RESEARCH_ATTRIBUTION_KEY = "fee-insight:research-origin";
const TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Browser-local report attribution; no personal data and no effect on authentication. */
export function researchAttribution(event: string, props: Record<string, string | number | boolean>, storage: Pick<Storage, "getItem" | "setItem">, now = Date.now()) {
  try {
    if (event === "research_report_view" && typeof props.report === "string") storage.setItem(RESEARCH_ATTRIBUTION_KEY, JSON.stringify({ report: props.report, at: now }));
    if (!["create_account", "checkout_complete", "research_analysis_complete", "upgrade_click"].includes(event)) return props;
    const origin = JSON.parse(storage.getItem(RESEARCH_ATTRIBUTION_KEY) ?? "null");
    if (typeof origin?.report !== "string" || typeof origin.at !== "number" || now - origin.at > TTL_MS || now < origin.at) return props;
    return { ...props, research_origin: origin.report };
  } catch { return props; }
}
