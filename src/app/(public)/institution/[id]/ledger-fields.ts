import { NCUA_ACCOUNTS } from "@/lib/regulatory/ncua";
import type { Ledger, LedgerMetric, LedgerQuarter, LedgerSource } from "./quarterly-ledger";

/**
 * The source fields behind each overview measure, by filing. Server-only: it reads the NCUA
 * account map from the 5300 client, which the browser bundle has no need for.
 */

export interface FieldNote {
  source: LedgerSource;
  /** "FFIEC call report", "FDIC BankFind (call report data)", "NCUA 5300 call report". */
  sourceName: string;
  fields: string;
  calculation: string;
}

export const SOURCE_NAMES: Record<LedgerSource, string> = {
  ffiec: "FFIEC call report (bulk data)",
  fdic: "FDIC BankFind Suite (call report data)",
  ncua: "NCUA 5300 call report",
};

/** BankFind's quarterly fields, as read by src/lib/regulatory/fdic.ts. */
const FDIC_FIELDS: Record<LedgerMetric, string> = {
  assets: "ASSET",
  deposits: "DEP",
  revenue: "NIMQ + NONIIQ",
  serviceCharges: "ISERCHGQ",
  netIncome: "NETINCQ",
  roaPct: "ROAQ",
  sharePct: "ISERCHGQ / (NIMQ + NONIIQ)",
};

const ACCT = (code: string) => code.replace(/^ACCT_/, "Account ");
const NCUA_FIELDS: Record<LedgerMetric, string> = {
  assets: ACCT(NCUA_ACCOUNTS.total_assets),
  deposits: ACCT(NCUA_ACCOUNTS.total_deposits),
  revenue: `${ACCT(NCUA_ACCOUNTS.interest_income_ytd)} + ${ACCT(NCUA_ACCOUNTS.noninterest_income_ytd)}`,
  serviceCharges: ACCT(NCUA_ACCOUNTS.fee_income_ytd),
  netIncome: ACCT(NCUA_ACCOUNTS.net_income_ytd),
  roaPct: `${ACCT(NCUA_ACCOUNTS.net_income_ytd)} annualized / ${ACCT(NCUA_ACCOUNTS.total_assets)}`,
  sharePct: `${ACCT(NCUA_ACCOUNTS.fee_income_ytd)} / (${ACCT(NCUA_ACCOUNTS.interest_income_ytd)} + ${ACCT(NCUA_ACCOUNTS.noninterest_income_ytd)})`,
};

const STOCKS = new Set<LedgerMetric>(["assets", "deposits"]);

/** Which fields stand behind a metric for each source it draws on, in the order used. */
export function fieldNotes(ledger: Ledger, metric: LedgerMetric, quarters: LedgerQuarter[] = ledger.quarters): FieldNote[] {
  const used = new Set(quarters.map((q) => q.values[metric]?.source).filter((s): s is LedgerSource => Boolean(s)));
  const notes: FieldNote[] = [];
  for (const source of ["ffiec", "fdic", "ncua"] as const) {
    if (!used.has(source)) continue;
    let fields: string;
    if (source === "ffiec") {
      const codes =
        metric === "sharePct"
          ? [...(ledger.ffiecCodes.serviceCharges ?? []), ...(ledger.ffiecCodes.revenue ?? [])]
          : (ledger.ffiecCodes[metric] ?? []);
      fields =
        metric === "revenue" && codes.length === 2
          ? `${codes[0]} + ${codes[1]}`
          : metric === "sharePct" && codes.length === 3
            ? `${codes[0]} / (${codes[1]} + ${codes[2]})`
            : codes.join(" or ");
    } else {
      fields = source === "fdic" ? FDIC_FIELDS[metric] : NCUA_FIELDS[metric];
    }
    const calculation = STOCKS.has(metric)
      ? "Point in time, at quarter end"
      : metric === "roaPct"
        ? source === "fdic"
          ? "As reported, one quarter annualized"
          : "Year to date, annualized"
        : source === "fdic"
          ? "One quarter, as reported"
          : "Standalone quarter: year to date less the prior quarter (Q1 as filed)";
    notes.push({ source, sourceName: SOURCE_NAMES[source], fields, calculation });
  }
  return notes;
}
