import type { IndexRow } from "@/lib/data-store";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { STATE_NAMES } from "@/lib/us-states";
import { countedAs, histogram, institutionsFor, statsFor } from "./(public)/fees/(index)/index-view";
import { CHARTERS, US, type Charter, type IndexCardData, type IndexCardFee, type IndexPick } from "./landing-index-view";

/**
 * The hero's Bank Fee Index card, worked out on the server with the explorer's own functions
 * (statsFor, institutionsFor, histogram on /fees), so a pick on the homepage shows the same
 * median, middle half, count and bars as the same pick on /fees. Every cell comes from the
 * fee's published rows; nothing is typed here.
 *
 * The card offers the Index's free fees only (the spotlight tier), every state with a
 * published row for one of them, and the three charter choices. Amounts are in cents so
 * the payload stays small.
 */

/** Cents, so a figure is an integer in the payload. */
const cents = (v: number) => Math.round(v * 100);

function cell(rows: IndexRow[], fee: string, charter: Charter): IndexPick {
  const stats = statsFor(rows, fee, null, charter);
  const n = stats.institution_count;
  if (stats.median_amount == null || stats.p25_amount == null || stats.p75_amount == null) return { n };
  const buckets = histogram(institutionsFor(rows, fee, null, charter));
  const even = buckets.filter((b) => b.min !== null && b.max !== null);
  const first = even[0];
  const step = first ? Math.round((first.max! + 0.01 - first.min!) * 100) : 100;
  return {
    n,
    median: cents(stats.median_amount),
    p25: cents(stats.p25_amount),
    p75: cents(stats.p75_amount),
    lo: first ? cents(first.min!) : 0,
    step,
    under: buckets[0]?.min === null,
    over: buckets[buckets.length - 1]?.max === null,
    counts: buckets.map((b) => b.total),
  };
}

/** Builds the card from each free fee's published rows (a fee whose read failed is left out). */
export function buildIndexCard(rowsByFee: Map<string, IndexRow[]>): IndexCardData {
  const fees: IndexCardFee[] = [];
  const cells: IndexCardData["cells"] = {};
  const stateCodes = new Set<string>();
  for (const [fee, rows] of rowsByFee) {
    if (rows.length === 0) continue;
    const words = countedAs(fee);
    fees.push({ key: fee, label: getDisplayName(fee), headline: words.headline, plural: words.labels });
    const byState = new Map<string, IndexRow[]>();
    for (const row of rows) {
      if (!row.state_code || !STATE_NAMES[row.state_code]) continue;
      const list = byState.get(row.state_code) ?? [];
      list.push(row);
      byState.set(row.state_code, list);
    }
    const places: Record<string, IndexPick[]> = { [US]: CHARTERS.map((c) => cell(rows, fee, c)) };
    for (const [code, list] of byState) {
      stateCodes.add(code);
      places[code] = CHARTERS.map((c) => cell(list, fee, c));
    }
    cells[fee] = places;
  }
  const states = [...stateCodes]
    .filter((code) => !["PR", "VI", "GU", "AS", "MP"].includes(code))
    .map((code) => ({ code, name: STATE_NAMES[code] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { fees, states, cells };
}

