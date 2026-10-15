import { HAMILTON_MODES, type HamiltonMode } from "@/lib/constants";
import { HAMILTON_WIRE_NAV } from "@/lib/hamilton/navigation";

export { HAMILTON_CANONICAL, HAMILTON_MODES, type HamiltonMode } from "@/lib/constants";

type HamiltonTab = HamiltonMode | typeof HAMILTON_WIRE_NAV.label;

/**
 * One line per Hamilton tab, in the workspace's own order: the four modes, then the Regulatory
 * Wire (site v3 brief 03, Pillar 3). The labels come from code, so the page and the workspace
 * never disagree. Monitoring stays at "once its schedule is re-read"; Hamilton never picks a price.
 */
const TAB_LINES: Record<HamiltonTab, string> = {
  "This month": "The few fees worth a look now, and what changed in your market.",
  "My fees": "Your market, your state, your Fed district, your peer group and the nation, with competitors named.",
  "Try a price":
    "Any amount side by side, including $0, its effect on fee income from your own figures, and the notice it needs.",
  Reports: "A CEO one-pager, a pricing committee packet or a board brief, with every figure cited.",
  "Regulatory Wire": "Federal and watched-state items.",
};

export const HAMILTON_TABS: { label: HamiltonTab; line: string }[] = [...HAMILTON_MODES, HAMILTON_WIRE_NAV.label].map(
  (label) => ({ label, line: TAB_LINES[label] }),
);
