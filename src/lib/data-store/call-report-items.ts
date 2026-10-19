/**
 * Groupings shared by the institution aggregate readers (CRE concentration, SEC market value,
 * economy, industry events, payment networks): each grouping's SQL expression over
 * institution_sources aliased `s`, and the minimum group size below which a group gets no
 * figures.
 */

export const CALL_ITEM_GROUPS = ["national", "state", "district", "asset_tier", "charter", "metro"] as const;
export type CallItemGroup = (typeof CALL_ITEM_GROUPS)[number];
export const MIN_GROUP = 5;

/** SQL expression for each grouping, over institution_sources aliased `s`. */
export function groupExpression(group: CallItemGroup): string {
  switch (group) {
    case "national":
      return "'US'";
    case "state":
      return "s.state_code";
    case "district":
      return "s.fed_district::text";
    case "asset_tier":
      return "s.asset_size_tier";
    case "charter":
      return "s.charter_type";
    case "metro":
      return "s.cbsa_code";
  }
}
