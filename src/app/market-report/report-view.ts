/**
 * The one-line findings under each section of a Competitive Fee Position Report. Pure: every
 * figure comes from the report's own analysis (src/lib/custom-report/analysis.ts), so the
 * findings, the exhibits and the CSV always agree. A median or the middle 50% is a figure
 * computed from competitors' fees, never a price anyone charges, and the wording keeps it so.
 */
import { MIN_LOCAL_PEERS_PER_LINE, positionCounts, type ReportLine } from "@/lib/custom-report/analysis";

/** Rows each long exhibit shows before "Show all". */
export const ROWS_SHOWN = 5;

/** Classes for a row past the first ROWS_SHOWN inside <ShowAll>: hidden until opened, always printed. */
export const EXTRA_ROW = "hidden group-data-[open=true]/all:table-row print:table-row";
export const EXTRA_GRID_ROW = "hidden group-data-[open=true]/all:grid print:grid";

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

type Compared = ReportLine & { own: NonNullable<ReportLine["own"]>; peers: NonNullable<ReportLine["peers"]> };

export function comparedLines(lines: ReportLine[]): Compared[] {
  return lines.filter((l): l is Compared => l.comparable && !!l.own && !!l.peers);
}

// "Overdraft (OD)" reads as "overdraft" inside a sentence; acronyms keep their case.
const inSentence = (label: string) => label.replace(/\s*\([^)]*\)/g, "").replace(/\b[A-Z][a-z]+/g, (w) => w.toLowerCase());

/** "Of Capital City Bank's 9 compared fees, 2 sit above the local middle 50%, 6 inside it and 1 below it." */
export function positionFinding(name: string, lines: ReportLine[]): string {
  const { above, inside, below } = positionCounts(lines);
  const total = above + inside + below;
  if (total === 0) return `None of ${name}'s fees can be compared with local competitors yet.`;
  if (inside === total) return `All ${total} of ${name}'s compared fees sit inside the local middle 50%.`;
  return `Of ${name}'s ${total} compared fees, ${above} ${above === 1 ? "sits" : "sit"} above the local middle 50%, ${inside} inside it and ${below} below it.`;
}

/**
 * The fee furthest from its local median, in dollars, the order the fee-by-fee table uses. When
 * every fee sits inside the middle 50% it says that instead. Never a forced headline.
 */
export function widestGapFinding(name: string, lines: ReportLine[]): string {
  const compared = comparedLines(lines);
  if (compared.length === 0) return `Too few local competitors publish ${name}'s fees for a comparison.`;
  if (compared.every((l) => l.position === "in_market")) return `Every compared fee sits inside the local middle 50%.`;
  const lead = [...compared].sort((a, b) => Math.abs(b.own.amount - b.peers.median) - Math.abs(a.own.amount - a.peers.median))[0];
  return `The widest gap is ${inSentence(lead.label)}: ${money(lead.own.amount)} at ${name} against a local median of ${money(lead.peers.median)} across ${lead.peers.n} competitors.`;
}

/** The fees left out of the comparison, said once under the table rather than on every row. */
export function leftOutNote(name: string, lines: ReportLine[]): string | null {
  const notFound = lines.filter((l) => !l.own && (l.peers?.n ?? 0) >= MIN_LOCAL_PEERS_PER_LINE).map((l) => l.label);
  const thin = lines.filter((l) => !l.comparable && !notFound.includes(l.label)).map((l) => l.label);
  const parts: string[] = [];
  if (thin.length > 0) {
    parts.push(`Not compared, because fewer than ${MIN_LOCAL_PEERS_PER_LINE} local competitors publish them: ${thin.join(", ")}.`);
  }
  if (notFound.length > 0) parts.push(`Not found on ${name}'s published schedule: ${notFound.join(", ")}.`);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * The spread of named competitors' published fees on the first fee in the table, beside the
 * institution's own; null when fewer than two of them publish it.
 */
export function namedFinding(
  name: string,
  line: { key: string; label: string } | undefined,
  own: number | undefined,
  competitors: { fees: Record<string, number> }[],
): string | null {
  if (!line) return null;
  const amounts = competitors.map((c) => c.fees[line.key]).filter((v): v is number => typeof v === "number");
  if (amounts.length < 2) return null;
  const lo = Math.min(...amounts);
  const hi = Math.max(...amounts);
  const range = lo === hi ? `all ${money(lo)}` : `${money(lo)} to ${money(hi)}`;
  const mine = own === undefined ? "" : `; ${name}'s is ${money(own)}`;
  return `On ${inSentence(line.label)}, the ${amounts.length} named competitors that publish it list ${range}${mine}.`;
}
