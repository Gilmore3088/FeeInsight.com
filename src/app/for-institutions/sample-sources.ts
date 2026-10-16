import type { ReportLine } from "@/lib/custom-report/analysis";
import { FEE_LINE_RULES } from "@/lib/custom-report/rules";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

/** A row of a stored schedule holds several printed cells ("Zipper Bags (Small) ... $4.00 | Outgoing International Wires ... $40.00/ea"). */
const CELL_BREAK = /\s*\|\s*|\n/;
/** Dot leaders between a fee's name and its price, shortened for display only. */
const LEADERS = /\s*(?:[.…·]\s?){2,}\s*/g;
/** One leader where cells meet or leaders run together after the cell breaks are joined. */
const JOINED_LEADERS = /(?:\s*…\s*){2,}/g;

/**
 * A verified run of schedule cells as a reader sees it: the cells joined by a leader, as the
 * printed schedule sets a name apart from its price ("Outgoing International Fee … $75"),
 * never by the stored row's pipe.
 */
export function displayQuote(run: string): string {
  return run
    .split(CELL_BREAK)
    .map((cell) => cell.trim())
    .filter(Boolean)
    .join(" … ")
    .replace(LEADERS, " … ")
    .replace(JOINED_LEADERS, " … ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SourcedFee {
  key: string;
  label: string;
  amount: number;
  /** The part of the bank's own schedule that states this fee, and only that part. */
  quote: string;
  /** The day the copy of the schedule that states the fee was saved. */
  readOn: string | null;
}

/**
 * The words of the bank's own schedule that state this fee, or null. A stored source row can
 * carry a neighbouring fee ("Zipper Bags (Small) ... $4.00" sits on the wire's row), so the
 * page never prints the row as is: it prints the shortest run of the row's cells that passes
 * the one shared source check (`checkFeeAgainstSource`) on its own, with the fee's own name,
 * amount and category. A row with no such run shows no source line.
 */
export function verifiedSourceQuote(line: Pick<ReportLine, "key" | "own">): string | null {
  const own = line.own;
  const rule = FEE_LINE_RULES.find((r) => r.key === line.key);
  if (!own || !rule || !own.source_line) return null;
  const cells = own.source_line.split(CELL_BREAK).map((cell) => cell.trim()).filter(Boolean);
  for (let width = 1; width <= cells.length; width += 1) {
    for (let start = 0; start + width <= cells.length; start += 1) {
      const run = cells.slice(start, start + width).join(" | ");
      if (checkFeeAgainstSource(run, own.fee_name, own.amount, rule.include).ok) {
        return displayQuote(run);
      }
    }
  }
  return null;
}

/** Every fee of the sample whose source line passes the shared check, in report order. */
export function sourcedFees(lines: ReportLine[], limit?: number): SourcedFee[] {
  const out: SourcedFee[] = [];
  for (const line of lines) {
    if (!line.own) continue;
    const quote = verifiedSourceQuote(line);
    if (!quote) continue;
    out.push({ key: line.key, label: line.label, amount: line.own.amount, quote, readOn: line.own.schedule_read_on });
    if (limit !== undefined && out.length >= limit) break;
  }
  return out;
}
