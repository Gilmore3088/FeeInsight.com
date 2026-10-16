import { accountTableCells } from "@/lib/custom-report/account-table";
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
