/**
 * This month's "things worth your attention", built from the Hamilton engine's Briefing (PR 170):
 * fees far from their peer group, competitors in the bank's state that changed a fee it charges,
 * a large move in its service charge income, and where it sits in one of Hamilton's studies (kept
 * in the last place). Overdraft, Hamilton's flagship, always leads when the bank publishes it. Deterministic and neutral: it says what is unusual, never what to do.
 */
import { STRONG_INSTITUTION_COUNT } from "@/lib/data-store/maturity";
import { getDisplayName } from "@/lib/fee-taxonomy";
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

/** A fee's name as it reads mid-sentence: "Non-Network ATM" becomes "non-network ATM". */
export function proseFeeName(displayName: string): string {
  return plainFeeName(displayName)
    .split(" ")
    .map((w) => (/^[A-Z0-9]{2,5}$/.test(w) ? w : w.toLowerCase()))
    .join(" ");
}

function fromObservation(o: Observation): AttentionItem {
  // Study observations are already written in prose.
  if (o.kind === "study") return { id: o.id, feeCategory: o.feeCategory, headline: o.headline, facts: o.facts.map((f) => f.text), note: null };
  const display = o.feeCategory ? getDisplayName(o.feeCategory) : null;
  const prose = display ? proseFeeName(display) : null;
  const tidy = (text: string) => {
    let out = text;
    if (display && prose) {
      out = out.split(display).join(prose).split(plainFeeName(display)).join(prose);
      if (!/fee/i.test(prose)) out = out.replace(`Your ${prose} `, `Your ${prose} fee `).replace(`published ${prose}:`, `published ${prose} fee:`);
    }
    return plainText(out);
  };
  return {
    id: o.id,
    feeCategory: o.feeCategory,
    headline: tidy(o.headline),
    facts: o.facts.map((f) => tidy(f.text)),
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
  const rest = briefing.observations.filter((o) => o !== flagged);
  const items = [...(lead ? [lead] : []), ...rest.map(fromObservation)].slice(0, limit);
  // Every briefing places the bank in a study when it has one: it keeps the last place.
  const study = rest.find((o) => o.kind === "study");
  if (study && limit > 0 && !items.some((i) => i.id === study.id)) items.splice(Math.max(0, limit - 1), 1, fromObservation(study));
  return items;
}
