/**
 * Which fee categories a Regulatory Wire tracker topic bears on. The topics are the tags the
 * federal and state trackers write on reg_tracker_items (federal-register.ts TOPIC_KEYWORDS,
 * open-states.ts). Pure and client-safe, so the institution page's regulatory watch and
 * Hamilton's regulation answers read one map.
 */
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";

/** Topics about every deposit fee: fee rules in general, fee disclosure (Truth in Savings). */
export const ALL_FEE_TOPICS: ReadonlySet<string> = new Set(["fees", "deposit_disclosure"]);

/** Fee categories each tracker topic bears on. */
export const TOPIC_CATEGORIES: Record<string, readonly string[]> = {
  overdraft_nsf: FEE_FAMILIES["Overdraft & NSF"] ?? [],
  electronic_transfers: [...(FEE_FAMILIES["ATM & Card"] ?? []), "wire_intl_outgoing"],
  funds_availability: FEE_FAMILIES["Check Services"] ?? [],
};

/** True when an item tagged with these topics bears on this fee category. */
export function topicsBearOn(topics: readonly string[], feeCategory: string): boolean {
  return topics.some((topic) => ALL_FEE_TOPICS.has(topic) || (TOPIC_CATEGORIES[topic] ?? []).includes(feeCategory));
}
