import { accountRowCellsPricing, accountTableCells, type AccountTableCell } from "@/lib/custom-report/account-table";
import { detectFrequency, type ExtractionRulesResult } from "@/lib/agents/knox/rules";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";

/**
 * #1100 gap 3: Knox's account-table specialist. Pure. Reads each product's monthly fee from an
 * account comparison table (`custom-report/account-table.ts`, the same rule the source check
 * traces it with): "Monthly Service Fees | $0 | $5 | $10" under "Account | Great Checking |
 * Better Checking | Best Checking" is three monthly fees, one per product. The general rules read
 * at most the first cell of such a row, and the source check took the later columns' prices for
 * thresholds. A free cell is held as a $0 fee, as the other specialists hold free fees. Like them,
 * a read is kept only when Darwin's checks would accept it, so the category guard's exclusions
 * (business, savings, money market and club accounts) apply unchanged.
 */
export const KNOX_ACCOUNT_TABLE_STRATEGY = { strategy: "extract.account_table", version: 1 } as const;

export function extractAccountTableCandidates(text: string): ExtractionRulesResult {
  const result: ExtractionRulesResult = { candidates: [], held: [] };
  for (const cell of accountTableCells(text)) {
    const hint = "monthly_maintenance";
    if (!passesDarwinChecks(hint, cell.feeName, cell.amount)) continue;
    const stated = detectFrequency(cell.cell);
    const frequency = stated ?? (/\bmonthly\b/i.test(cell.label) ? "monthly" : null);
    const excerpt = cell.row.slice(0, 280);
    if (cell.amount === 0) {
      result.held.push({ shape: "zero", feeName: cell.feeName, amount: 0, amountMax: null, percent: null, frequency, canonicalHint: hint, excerpt });
      continue;
    }
    result.candidates.push({
      // v73 (#1100): the column's product is the account the fee belongs to.
      lineup: { productName: cell.product, minBalanceToAvoid: null, minOpeningDeposit: null, waiverText: null },
      feeName: cell.feeName,
      amount: cell.amount,
      frequency,
      canonicalHint: hint,
      confidence: 0.86,
      excerpt,
      waivable: /\bwaiv/i.test(cell.cell),
    });
  }
  return result;
}

/** The category an account table's monthly fee row states. */
const ACCOUNT_ROW_CATEGORY = "monthly_maintenance";

/**
 * v180 (backlog dry run 11): another specialist's read of an account table's monthly fee row that this
 * specialist reads by column. Pure. Each priced cell is its own column's value under the row's label, so:
 * - a monthly fee read (the row label's category) is dropped when this specialist reads a column at its
 *   price (the same fee under a name without its account), or when every cell printing its price states
 *   another fee: the row's label put on the wrong cell ("Monthly Service Fees" $5 from "$5 per paper
 *   statement if not enrolled ...", Community First National Bank);
 * - a read of another fee is dropped only when every cell printing its price is a column's monthly fee, so
 *   its own cell can only be that column's ("$6 if $300 minimum balance ... is not maintained" filed as a
 *   paper statement, named by the cell before it). When a cell that states another fee prints the price too
 *   ("$5 per paper statement ..." beside a "$5" column, review of #2978), that cell is the read's own and
 *   the read stays.
 */
export function accountRowRivalRead(
  read: { amount: number | null; canonicalHint: string | null; excerpt: string; strategy?: string },
  cells: readonly AccountTableCell[],
): boolean {
  if (read.amount == null || read.strategy === KNOX_ACCOUNT_TABLE_STRATEGY.strategy) return false;
  const probe = read.excerpt.replace(/\s+/g, " ").trim().slice(0, 40);
  if (probe.length < 12) return false;
  const rowCells = cells.filter((cell) => cell.row.startsWith(probe));
  if (rowCells.length === 0) return false;
  const cents = Math.round(read.amount * 100);
  if (cents === 0) return false;
  const sameCents = (fee: number | null) => fee != null && Math.round(fee * 100) === cents;
  const columnAtPrice = rowCells.some((cell) => sameCents(cell.amount));
  const pricing = accountRowCellsPricing(rowCells[0].row, read.amount);
  if (read.canonicalHint === ACCOUNT_ROW_CATEGORY) {
    return columnAtPrice || (pricing.length > 0 && pricing.every((fee) => !sameCents(fee)));
  }
  return columnAtPrice && pricing.length > 0 && pricing.every(sameCents);
}
