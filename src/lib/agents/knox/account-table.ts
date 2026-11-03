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

/**
 * v180 (backlog dry run 11): another specialist's read of an account table's monthly fee row that this
 * specialist reads by column. Each priced cell is its own column's value under the row's label, so a
 * read at a price this specialist reads from a column is that column's monthly fee under another name
 * (Community First National Bank's "$6 if $300 minimum balance ... is not maintained" filed as a paper
 * statement, named by the cell before it), and a monthly fee read at a price printed only in cells
 * that state another fee is the row's label on the wrong cell ("Monthly Service Fees" $5 from "$5 per
 * paper statement if not enrolled ..."). A read of another fee at a cell's own price (the paper
 * statement's $5) is that cell's own read and stays. Pure.
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
  if (rowCells.some((cell) => cell.amount > 0 && Math.round(cell.amount * 100) === cents)) return true;
  if (read.canonicalHint !== "monthly_maintenance" || cents === 0) return false;
  const pricing = accountRowCellsPricing(rowCells[0].row, read.amount);
  return pricing.length > 0 && pricing.every((fee) => fee == null || Math.round(fee * 100) !== cents);
}
