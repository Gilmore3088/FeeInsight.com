/**
 * The one-line findings and labels of a Competitive Fee Position Report. Pure: every figure
 * comes from the report's own analysis (src/lib/custom-report/analysis.ts), so the findings,
 * the exhibits and the CSV always agree. A median or the middle 50% is a figure computed from
 * competitors' fees, never a price anyone charges, and the wording keeps it so. Several prices
 * for one fee follow the shared rule (src/lib/fee-representative.ts): the range is shown, and
 * the value compared is labelled.
 */
import { MIN_LOCAL_PEERS_PER_LINE, isIncomplete, positionCounts, type ReportLine } from "@/lib/custom-report/analysis";
import { isScopeProblem } from "@/lib/custom-report/evidence";
import type { CheckingLineupView } from "@/lib/custom-report/checking-lineup";
import { shareLabel, type RevenueContext } from "@/lib/custom-report/revenue-context";
import { HIGHEST_TIER_CATEGORIES } from "@/lib/fee-institution-value";
import { comparedAtText, priceRangeText } from "@/lib/fee-representative";
import { countyLabel } from "@/lib/geo/counties";

export { EXTRA_BLOCK_ROW, EXTRA_ROW, ROWS_SHOWN } from "./rows";

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

type Compared = ReportLine & { own: NonNullable<ReportLine["own"]>; peers: NonNullable<ReportLine["peers"]> };

export function comparedLines(lines: ReportLine[]): Compared[] {
  return lines.filter((l): l is Compared => l.comparable && !!l.own && !!l.peers);
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const word = (n: number) => WORDS[n] ?? String(n);
const capital = (text: string) => text[0].toUpperCase() + text.slice(1);

// "Overdraft (OD)" reads as "overdraft" inside a sentence; acronyms keep their case.
const inSentence = (label: string) => label.replace(/\s*\([^)]*\)/g, "").replace(/\b[A-Z][a-z]+/g, (w) => w.toLowerCase());

/** The report's opening finding: "Two of nine compared fees sit above the local middle 50%; six sit inside it and one below." */
export function headlineFinding(lines: ReportLine[]): string {
  const { above, inside, below } = positionCounts(lines);
  const total = above + inside + below;
  if (total === 0) return "Too few local competitors publish these fees for a comparison yet.";
  if (inside === total) return total === 1 ? "The one compared fee sits inside the local middle 50%." : `All ${word(total)} compared fees sit inside the local middle 50%.`;
  const lead = `${capital(word(above))} of ${word(total)} compared fees ${above === 1 ? "sits" : "sit"} above the local middle 50%`;
  return `${lead}; ${word(inside)} ${inside === 1 ? "sits" : "sit"} inside it and ${word(below)} below.${incompleteTail(lines)}`;
}

/** " Monthly maintenance rests on incomplete inputs." after a count that includes such a line. */
export function incompleteTail(lines: ReportLine[]): string {
  const open = comparedLines(lines).filter(isIncomplete).map((l) => l.label);
  if (open.length === 0) return "";
  return ` ${join(open)} ${open.length === 1 ? "rests" : "rest"} on incomplete inputs.`;
}

/**
 * The position in words for a compared line: "Below", or "Below, on incomplete inputs" while the
 * comparison is missing one of the institution's own published records, so it never reads as settled.
 */
export function positionWord(line: Pick<ReportLine, "position" | "incomplete">): string {
  const base = line.position === "above_market" ? "Above" : line.position === "in_market" ? "Inside" : "Below";
  return isIncomplete(line) ? `${base}, on incomplete inputs` : base;
}

/** Every amount the institution states for the fee, the compared one included. */
export function amountsOf(own: { amount: number; tiers?: { amount: number }[] }): number[] {
  return own.tiers && own.tiers.length > 1 ? own.tiers.map((t) => t.amount) : [own.amount];
}

/** "$7.95 to $8.95, depending on account", or the one price. */
export function priceText(own: { amount: number; tiers?: { amount: number }[] }): string {
  return priceRangeText(amountsOf(own)) ?? money(own.amount);
}

/** "Compared at $8.45, the middle of its prices"; null for a single price. */
export function comparedAt(key: string, own: { amount: number; tiers?: { amount: number }[] }): string | null {
  return comparedAtText({ value: own.amount, amounts: amountsOf(own), highestTier: HIGHEST_TIER_CATEGORIES.has(key) });
}

/**
 * The fee furthest from its local median, in dollars, the order the comparison uses. When every
 * fee sits inside the middle 50% it says that instead. Never a forced headline.
 */
export function widestGapFinding(name: string, lines: ReportLine[]): string {
  const compared = comparedLines(lines);
  if (compared.length === 0) return `Too few local competitors publish ${name}'s fees for a comparison.`;
  if (compared.every((l) => l.position === "in_market")) return `Every compared fee sits inside the local middle 50%.${incompleteTail(lines)}`;
  const lead = [...compared].sort((a, b) => Math.abs(b.own.amount - b.peers.median) - Math.abs(a.own.amount - a.peers.median))[0];
  const several = new Set(amountsOf(lead.own)).size > 1;
  const what = several ? `${name} is compared at ${money(lead.own.amount)}` : `${name}'s fee is ${money(lead.own.amount)}`;
  const qualifier = isIncomplete(lead) ? ", on incomplete inputs" : "";
  return `The widest gap is ${inSentence(lead.label)}: ${what}, against a local median of ${money(lead.peers.median)} across ${lead.peers.n} competitors${qualifier}.`;
}

/** The fees left out of the comparison, said once under the exhibit rather than on every row. */
export function leftOutNote(name: string, lines: ReportLine[]): string | null {
  // Left out because every record prices a different charge (an add-on, a withdrawal abroad).
  const otherCharge = lines
    .filter((l) => !l.own && l.ownExcluded && l.ownExcluded.excluded.length > 0 && l.ownExcluded.excluded.every((r) => isScopeProblem(r.problem)))
    .map((l) => l.label);
  const unsupported = lines.filter((l) => !l.own && l.ownExcluded && !otherCharge.includes(l.label)).map((l) => l.label);
  const notFound = lines
    .filter((l) => !l.own && !l.ownExcluded && (l.peers?.n ?? 0) >= MIN_LOCAL_PEERS_PER_LINE)
    .map((l) => l.label);
  const thin = lines
    .filter((l) => !l.comparable && !notFound.includes(l.label) && !unsupported.includes(l.label) && !otherCharge.includes(l.label))
    .map((l) => l.label);
  const parts: string[] = [];
  if (otherCharge.length > 0) {
    parts.push(`Not compared, because ${name}'s only prices on file are for a different charge (an add-on, or a withdrawal abroad): ${otherCharge.join(", ")}.`);
  }
  if (unsupported.length > 0) {
    parts.push(`Not compared, because the line quoted from ${name}'s schedule does not show the amount: ${unsupported.join(", ")}.`);
  }
  if (thin.length > 0) {
    parts.push(`Not compared, because fewer than ${MIN_LOCAL_PEERS_PER_LINE} local competitors publish them: ${thin.join(", ")}.`);
  }
  if (notFound.length > 0) parts.push(`Not found on ${name}'s published schedule: ${notFound.join(", ")}.`);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * The market's counties by name: "Leon, Gadsden and Wakulla counties, FL" when they share a
 * state, otherwise each county with its state. FIPS codes stored as numbers get their leading zero.
 */
export function countiesText(countyFips: string[]): string {
  const labels = countyFips.map((f) => countyLabel(String(f).padStart(5, "0"))).filter((l): l is string => Boolean(l));
  if (labels.length === 0) return countyFips.length === 1 ? "one county" : `${countyFips.length} counties`;
  const parts = labels.map((l) => /^(.*) County, ([A-Z]{2})$/.exec(l));
  const states = new Set(parts.map((p) => p?.[2] ?? null));
  const join = (list: string[]) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);
  if (states.size === 1 && parts.every(Boolean)) {
    const names = parts.map((p) => p![1]);
    return `${join(names)} ${names.length === 1 ? "County" : "counties"}, ${parts[0]![2]}`;
  }
  return join(labels);
}

/**
 * Who counts as identified, matching the market query (custom-report-market.ts): every bank with
 * a branch in the counties, and every institution headquartered in a city where one of those
 * branches sits.
 */
export function identifiedText(counties: string): string {
  return `every bank with a branch in ${counties} (FDIC Summary of Deposits), and every institution headquartered in a city where one of those branches sits.`;
}

/** "36 institutions identified in Leon, Gadsden and Wakulla counties, FL; 30 publish fees this report can use." */
export function marketFinding(counties: string, identified: number, usable: number): string {
  return `${identified.toLocaleString("en-US")} institutions identified in ${counties}; ${usable.toLocaleString("en-US")} publish fees this report can use.`;
}

/**
 * How a line's local median is built, said beside the figure: one value per local competitor,
 * and which value. "Median of local competitors, each at the middle of its checking fees", so it
 * never reads as the checking lineup's median of every account pooled, and never calls a median
 * a price. The count sits on its own row beside it.
 */
export function medianMethod(key: string): string {
  if (key === "monthly_maintenance") return "Median of local competitors, each at the middle of its checking fees";
  if (HIGHEST_TIER_CATEGORIES.has(key)) return "Median of local competitors, each at its standard fee";
  if (key === "atm_non_network") return "Median of local competitors, each at its domestic fee";
  return "Median of local competitors, one fee each";
}

const WIRE_LINE = /^wire_/;
const join = (list: string[]) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);

/** "$1B-$10B" -> "$1B to $10B". */
export const bandText = (tier: string) => tier.replace(/\s*-\s*/, " to ");

/** One "Priorities for review" item and the report section it points to. */
export interface ReviewPriority {
  text: string;
  href: "#position" | "#lineup" | "#revenue";
}

/**
 * The short "Priorities for review" list after the opening finding: up to three things to look
 * into, each computed from this report's own figures and left out when its data is missing, each
 * linked to its section. They name where to look, never a price to change.
 *   - the fees above the local middle 50% ("Wires: investigate the two fees above the local middle 50%", James's verb);
 *   - checking, where account types and waiver conditions differ more than one fee shows;
 *   - deposit service charges (NCUA fee income for a credit union) as a share of revenue, a
 *     measure that scales with size, beside the dollar rank.
 */
export function reviewPriorities(
  lines: ReportLine[],
  context: { lineup?: CheckingLineupView | null; revenue?: RevenueContext | null } = {},
): ReviewPriority[] {
  const items: ReviewPriority[] = [];
  const compared = comparedLines(lines);

  const above = compared.filter((l) => l.position === "above_market");
  if (above.length > 0) {
    const count = above.length === 1 ? "the fee" : `the ${word(above.length)} fees`;
    let text: string;
    if (above.every((l) => WIRE_LINE.test(l.key))) {
      const which = above.map((l) => inSentence(l.label).replace(/\s*wire$/, ""));
      text = `Wires: investigate ${count} above the local middle 50% (${join(which)}).`;
    } else if (above.length === 1) {
      text = `${capital(inSentence(above[0].label))}: investigate the fee above the local middle 50%.`;
    } else {
      text = `Fees above the local middle 50%: investigate ${join(above.map((l) => inSentence(l.label)))}.`;
    }
    items.push({ text, href: "#position" });
  }

  const checking = compared.find((l) => l.key === "monthly_maintenance");
  const lineupPeers = context.lineup?.peersWithLineup ?? 0;
  if (checking || lineupPeers > 0) {
    const base = "Checking: compare equivalent account types and waiver conditions.";
    const count = (n: number) => `${n.toLocaleString("en-US")} local ${n === 1 ? "competitor" : "competitors"}`;
    items.push({ text: lineupPeers > 0 ? `${base} Lineups are on file for ${count(lineupPeers)}.` : base, href: lineupPeers > 0 ? "#lineup" : "#position" });
  }

  const revenue = context.revenue;
  const peer = revenue?.peer;
  if (revenue && peer) {
    // One comparison (#2353): same charter, filing, quarter and asset band, the institution included.
    const who = (n: number) => `${n.toLocaleString("en-US")} ${peer.charterLabel} with ${bandText(peer.tierLabel)} in assets, this one included`;
    // An NCUA share is year to date; an FDIC share is the quarter's.
    const base = revenue.source === "ncua" ? "revenue, year to date" : "revenue";
    const measure = revenue.measureLabel;
    const text =
      peer.feeShare != null && peer.peerMedianFeeShare != null
        ? `${measure}: ${shareLabel(peer.feeShare)} of ${base}, against a ${shareLabel(peer.peerMedianFeeShare)} median for ${who(peer.peerShareCount)}.`
        : `${measure}: rank ${peer.rank.toLocaleString("en-US")} in dollars of ${who(peer.count)}.`;
    items.push({ text, href: "#revenue" });
  }
  return items;
}
