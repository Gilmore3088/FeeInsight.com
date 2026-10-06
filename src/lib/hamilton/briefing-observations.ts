/**
 * This month's "things worth your attention", built from the Hamilton engine's Briefing (PR 170):
 * fees far from their peer group, competitors in the bank's state that changed a fee it charges,
 * and a large move in its service charge income. Overdraft, Hamilton's flagship, always leads when
 * the bank publishes it. Deterministic and neutral: it says what is unusual, never what to do.
 */
import { STRONG_INSTITUTION_COUNT } from "@/lib/data-store/maturity";
import type { Briefing, FeeResearch, Observation } from "./workspace/types";

export interface AttentionItem {
  id: string;
  /** Null for items about the whole schedule, such as service charge income. */
  feeCategory: string | null;
  headline: string;
  facts: string[];
  /** A caution about the evidence, such as a small peer group. */
  note: string | null;
}

/** Display names carry abbreviations like "Overdraft (OD)"; prose reads better without them. */
export function plainFeeName(displayName: string): string {
  return displayName.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export function money(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** Overdraft is Hamilton's flagship: when the bank publishes it, it always leads the Briefing. */
export const FLAGSHIP_FEE = "overdraft";

const SMALL_GROUP_NOTE = "A small peer group, so read with care.";

function plainText(text: string): string {
  return text.replace(/\s*\([A-Z]{2,6}\)/g, "");
}

function fromObservation(o: Observation): AttentionItem {
  return {
    id: o.id,
    feeCategory: o.feeCategory,
    headline: plainText(o.headline),
    facts: o.facts.map((f) => plainText(f.text)),
    note: null,
  };
}

/** Overdraft's place among its peers when the engine didn't flag it as unusual. */
function overdraftItem(research: FeeResearch): AttentionItem | null {
  if (research.current == null || !research.band) return null;
  const current = research.current;
  const amounts = research.peers.map((p) => p.amount);
  const more = amounts.filter((a) => a > current + 0.005).length;
  const less = amounts.filter((a) => a < current - 0.005).length;
  const same = amounts.length - more - less;
  const { median, p25, p75, n } = research.band;
  return {
    id: `position:${research.feeCategory}`,
    feeCategory: research.feeCategory,
    headline: `Your overdraft fee is ${money(current)}; the median of ${n} peers is ${money(median)}.`,
    facts: [
      `${research.peerLabel}: middle half ${money(p25)} to ${money(p75)}.`,
      `${more} charge more, ${same} the same and ${less} less.`,
    ],
    note: n < STRONG_INSTITUTION_COUNT ? SMALL_GROUP_NOTE : null,
  };
}

export function buildAttentionItems(
  briefing: Briefing | null,
  overdraft: FeeResearch | null,
  limit = 4,
): AttentionItem[] {
  if (!briefing) return [];
  const flagged = briefing.observations.find((o) => o.feeCategory === FLAGSHIP_FEE && o.kind === "market_position");
  const lead = flagged ? fromObservation(flagged) : overdraft ? overdraftItem(overdraft) : null;
  const rest = briefing.observations.filter((o) => o !== flagged).map(fromObservation);
  return [...(lead ? [lead] : []), ...rest].slice(0, limit);
}
