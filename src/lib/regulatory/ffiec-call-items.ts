import { strFromU8 } from "fflate";
import { cells } from "./ffiec";

/**
 * Call-report detail lines read from the FFIEC bulk file beyond RIAD H032. Pure: no DB access.
 *
 * Every code below was written from the FFIEC 031/041/051 instructions, not read from a live
 * file, so none is trusted on its own. The bulk files carry two header rows: MDRM codes, then
 * the item description. A line loads only when its code is in a file AND that file's
 * description matches what the line should be; otherwise the run reports it as missing or
 * mismatched and nothing is written for it. Banks with foreign offices (031) report some
 * lines with the RCFD prefix and others with RCON, so balance-sheet lines try RCFD first.
 */

export type FfiecItemUnit = "thousands" | "count";
export type FfiecItemBasis = "ytd" | "point_in_time";

export interface FfiecItemDefinition {
  key: string;
  /** Codes to try in order; the first one a bank filed a value under is used. */
  codes: readonly string[];
  schedule: string;
  unit: FfiecItemUnit;
  basis: FfiecItemBasis;
  /** Every pattern must match the file's description of the column. */
  describedBy: readonly RegExp[];
  /** No pattern may match it (keeps a charge-off column from passing as a recovery). */
  notDescribedBy?: readonly RegExp[];
}

const RECOVERY = /RECOVER/i;
/** RI-E item 1 codes as remembered from the instructions; the description check picks the line. */
const RIE_CANDIDATES = ["RIADC013", "RIADC014", "RIADC015", "RIADC016", "RIADF555", "RIADT047", "RIADF556", "RIADF557"] as const;
const CHARGE_OFF_ONLY = /^(?!.*RECOVER).*CHARGE-?\s?OFF/i;

export const FFIEC_CALL_ITEMS: readonly FfiecItemDefinition[] = [
  // Schedule RI Memoranda item 15: service charges on consumer deposit accounts ($1B+ banks).
  { key: "consumer_maintenance_charges_ytd", codes: ["RIADH033"], schedule: "RI", unit: "thousands", basis: "ytd", describedBy: [/MAINTENANCE|\bMAIN\b/i] },
  { key: "consumer_atm_fees_ytd", codes: ["RIADH034"], schedule: "RI", unit: "thousands", basis: "ytd", describedBy: [/ATM|AUTOMATED TELLER/i] },
  { key: "other_deposit_service_charges_ytd", codes: ["RIADH035"], schedule: "RI", unit: "thousands", basis: "ytd", describedBy: [/\bOTHER\b|\bALL\b/i, /SERVICE CHARGE|\bSE?RV CHAR\b|\bSEV CHAR\b/i] },
  // Schedule RI-E item 1: other noninterest income lines, filed by banks of every size but only
  // when a line passes the disclosure threshold (051 filers: December only). Absent means not
  // disclosed, never zero. Several codes are candidates; only one whose file description
  // matches loads.
  { key: "atm_income_ytd", codes: RIE_CANDIDATES, schedule: "RIE", unit: "thousands", basis: "ytd", describedBy: [/AUTOMATED TELLER|\bATM/i] },
  { key: "check_printing_income_ytd", codes: RIE_CANDIDATES, schedule: "RIE", unit: "thousands", basis: "ytd", describedBy: [/CHECK/i, /PRINT|SALE/i] },
  { key: "safe_deposit_rent_ytd", codes: RIE_CANDIDATES, schedule: "RIE", unit: "thousands", basis: "ytd", describedBy: [/SAFE DEPOSIT/i] },
  { key: "interchange_fees_ytd", codes: RIE_CANDIDATES, schedule: "RIE", unit: "thousands", basis: "ytd", describedBy: [/INTERCHANGE/i] },
  { key: "wire_transfer_income_ytd", codes: RIE_CANDIDATES, schedule: "RIE", unit: "thousands", basis: "ytd", describedBy: [/WIRE/i] },
  // Schedule RC-E Memoranda: deposits intended primarily for individuals ($1B+ banks), the base
  // for service-charge income per dollar of consumer deposits.
  // Each line loads as filed; a consumer transaction or savings total is a sum read at query
  // time. The 2026Q1 file abbreviates: "NONINTR TRN ACCTS INDIV HSHLD FMLY".
  {
    key: "consumer_noninterest_transaction_deposits",
    codes: ["RCONP753"],
    schedule: "RCE",
    unit: "thousands",
    basis: "point_in_time",
    describedBy: [/NONINTR|NONINTEREST/i, /\bTRN\b|TRANSACTION/i, /INDIV|HOUSEHOLD|HSHLD/i],
  },
  {
    key: "consumer_interest_transaction_deposits",
    codes: ["RCONP754"],
    schedule: "RCE",
    unit: "thousands",
    basis: "point_in_time",
    describedBy: [/\bINTR\b|INTEREST/i, /\bTRN\b|TRANSACTION/i, /INDIV|HOUSEHOLD|HSHLD/i],
    notDescribedBy: [/NONINTR|NONINTEREST/i],
  },
  {
    key: "consumer_money_market_deposits",
    codes: ["RCONP756"],
    schedule: "RCE",
    unit: "thousands",
    basis: "point_in_time",
    describedBy: [/MMDA|MONEY MARKET/i, /HOUSEHOLD|HSHLD/i],
    notDescribedBy: [/\bOTHE?R\b|CORP/i],
  },
  {
    key: "consumer_other_savings_deposits",
    codes: ["RCONP758"],
    schedule: "RCE",
    unit: "thousands",
    basis: "point_in_time",
    describedBy: [/SVGS|SAVINGS/i, /HOUSEHOLD|HSHLD/i],
    notDescribedBy: [/MMDA|MONEY MARKET|TIME/i],
  },
  // Schedule RC-O Memoranda item 1: deposit accounts (excluding retirement) by size.
  {
    key: "deposits_250k_or_less_amount",
    codes: ["RCONF049"],
    schedule: "RCO",
    unit: "thousands",
    basis: "point_in_time",
    describedBy: [/250,?000|250K/i, /LESS/i, /AMOUNT|\bAMT\b/i],
    notDescribedBy: [/NUMBER OF|\bNBR\b/i],
  },
  { key: "deposits_250k_or_less_count", codes: ["RCONF050"], schedule: "RCO", unit: "count", basis: "point_in_time", describedBy: [/250,?000|250K/i, /LESS/i, /NUMBER|\bNBR\b/i] },
  {
    key: "deposits_over_250k_amount",
    codes: ["RCONF051"],
    schedule: "RCO",
    unit: "thousands",
    basis: "point_in_time",
    describedBy: [/250,?000|250K/i, /MORE|GREATER|OVER|\bGT\b/i, /AMOUNT|\bAMT\b/i],
    notDescribedBy: [/NUMBER OF|\bNBR\b/i],
  },
  { key: "deposits_over_250k_count", codes: ["RCONF052"], schedule: "RCO", unit: "count", basis: "point_in_time", describedBy: [/250,?000|250K/i, /MORE|GREATER|OVER|\bGT\b/i, /NUMBER|\bNBR\b/i] },
  // Schedule RC-N item 9: total loans and leases by delinquency.
  { key: "loans_past_due_30_89", codes: ["RCFD1406", "RCON1406"], schedule: "RCN", unit: "thousands", basis: "point_in_time", describedBy: [/30/, /89/] },
  { key: "loans_past_due_90_plus", codes: ["RCFD1407", "RCON1407"], schedule: "RCN", unit: "thousands", basis: "point_in_time", describedBy: [/90/] },
  { key: "loans_nonaccrual", codes: ["RCFD1403", "RCON1403"], schedule: "RCN", unit: "thousands", basis: "point_in_time", describedBy: [/NONACCRUAL/i] },
  // Schedule RI-B Part I: charge-offs and recoveries, total and consumer loan types.
  { key: "charge_offs_total_ytd", codes: ["RIAD4635"], schedule: "RIBI", unit: "thousands", basis: "ytd", describedBy: [/CHARGE/i], notDescribedBy: [RECOVERY] },
  { key: "recoveries_total_ytd", codes: ["RIAD4605"], schedule: "RIBI", unit: "thousands", basis: "ytd", describedBy: [RECOVERY] },
  { key: "charge_offs_credit_card_ytd", codes: ["RIADB514"], schedule: "RIBI", unit: "thousands", basis: "ytd", describedBy: [/CREDIT CARD/i], notDescribedBy: [RECOVERY] },
  { key: "recoveries_credit_card_ytd", codes: ["RIADB515"], schedule: "RIBI", unit: "thousands", basis: "ytd", describedBy: [/CREDIT CARD/i], notDescribedBy: [CHARGE_OFF_ONLY] },
  { key: "charge_offs_auto_ytd", codes: ["RIADK129"], schedule: "RIBI", unit: "thousands", basis: "ytd", describedBy: [/AUTO/i], notDescribedBy: [RECOVERY] },
  { key: "recoveries_auto_ytd", codes: ["RIADK133"], schedule: "RIBI", unit: "thousands", basis: "ytd", describedBy: [/AUTO/i], notDescribedBy: [CHARGE_OFF_ONLY] },
  { key: "charge_offs_other_consumer_ytd", codes: ["RIADK205"], schedule: "RIBI", unit: "thousands", basis: "ytd", describedBy: [/OTHER CONSUMER|ALL OTHER/i], notDescribedBy: [RECOVERY] },
  { key: "recoveries_other_consumer_ytd", codes: ["RIADK206"], schedule: "RIBI", unit: "thousands", basis: "ytd", describedBy: [/OTHER CONSUMER|ALL OTHER/i], notDescribedBy: [CHARGE_OFF_ONLY] },
];

export const FFIEC_CALL_ITEM_SCHEDULES = [...new Set(FFIEC_CALL_ITEMS.map((item) => item.schedule))];

export type FfiecColumnStatus = "loaded" | "not_in_file" | "description_mismatch" | "no_description" | "ambiguous";

export interface FfiecColumnCheck {
  key: string;
  code: string;
  status: FfiecColumnStatus;
  file: string | null;
  description: string | null;
}

export interface FfiecItemValue {
  rssd: string;
  key: string;
  code: string;
  description: string;
  schedule: string;
  unit: FfiecItemUnit;
  basis: FfiecItemBasis;
  value: number;
}

export interface FfiecItemRead {
  files: string[];
  columns: FfiecColumnCheck[];
  values: FfiecItemValue[];
  /** Banks whose card + auto + other consumer charge-offs exceed total charge-offs: a sign two codes are swapped. */
  chargeOffPartsOverTotal: number;
}

export function describes(item: FfiecItemDefinition, description: string): boolean {
  return item.describedBy.every((re) => re.test(description)) && !(item.notDescribedBy ?? []).some((re) => re.test(description));
}

interface Column {
  file: string;
  at: number;
  description: string;
}

/** Read every defined line for every bank; blank cells are left out, never read as zero. */
export function readFfiecCallItems(
  files: Record<string, Uint8Array>,
  items: readonly FfiecItemDefinition[] = FFIEC_CALL_ITEMS,
): FfiecItemRead {
  const names = Object.keys(files).sort();
  const parsed = names.map((name) => {
    const lines = strFromU8(files[name], true).split(/\r?\n/);
    const header = cells(lines[0] ?? "").map((h) => h.toUpperCase());
    const descriptions = cells(lines[1] ?? "");
    return { name, lines, header, descriptions, rssdAt: header.indexOf("IDRSSD") };
  });

  const columns: FfiecColumnCheck[] = [];
  // Accepted columns per line ("key:code"); a code shared by candidate lists loads only for
  // the line its description matches.
  const accepted = new Map<string, Column>();
  for (const item of items) {
    const matched: FfiecColumnCheck[] = [];
    for (const code of item.codes) {
      const file = parsed.find((f) => f.rssdAt >= 0 && f.header.includes(code));
      if (!file) {
        columns.push({ key: item.key, code, status: "not_in_file", file: null, description: null });
        continue;
      }
      const at = file.header.indexOf(code);
      const description = (file.descriptions[at] ?? "").trim();
      const status: FfiecColumnStatus = description === "" ? "no_description" : describes(item, description) ? "loaded" : "description_mismatch";
      const check: FfiecColumnCheck = { key: item.key, code, status, file: file.name, description: description || null };
      columns.push(check);
      if (status === "loaded") {
        matched.push(check);
        accepted.set(`${item.key}:${code}`, { file: file.name, at, description });
      }
    }
    // Two different lines both fitting one description (not an RCFD/RCON pair) is ambiguous: load neither.
    const bases = new Set(matched.map((c) => c.code.slice(4)));
    if (matched.length > 1 && bases.size > 1) {
      for (const check of matched) {
        check.status = "ambiguous";
        accepted.delete(`${item.key}:${check.code}`);
      }
    }
  }

  const byFile = new Map(parsed.map((f) => [f.name, f]));
  const cellValue = (column: Column, rssd: string, rows: Map<string, Map<string, string[]>>): number | null => {
    const raw = rows.get(column.file)?.get(rssd)?.[column.at];
    if (raw === undefined || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  // Rows by file and RSSD, only for files that hold an accepted column.
  const rows = new Map<string, Map<string, string[]>>();
  const rssds = new Set<string>();
  for (const name of new Set([...accepted.values()].map((c) => c.file))) {
    const file = byFile.get(name)!;
    const map = new Map<string, string[]>();
    for (const line of file.lines.slice(1)) {
      const row = cells(line);
      const rssd = row[file.rssdAt];
      if (!rssd || !/^\d+$/.test(rssd)) continue;
      map.set(rssd, row);
      rssds.add(rssd);
    }
    rows.set(name, map);
  }

  const values: FfiecItemValue[] = [];
  let chargeOffPartsOverTotal = 0;
  for (const rssd of [...rssds].sort()) {
    const mine = new Map<string, number>();
    for (const item of items) {
      for (const code of item.codes) {
        const column = accepted.get(`${item.key}:${code}`);
        if (!column) continue;
        const value = cellValue(column, rssd, rows);
        if (value === null) continue;
        mine.set(item.key, value);
        values.push({ rssd, key: item.key, code, description: column.description, schedule: item.schedule, unit: item.unit, basis: item.basis, value });
        break;
      }
    }
    const total = mine.get("charge_offs_total_ytd");
    const parts = ["charge_offs_credit_card_ytd", "charge_offs_auto_ytd", "charge_offs_other_consumer_ytd"]
      .map((key) => mine.get(key) ?? 0)
      .reduce((a, b) => a + b, 0);
    if (total !== undefined && parts > total) chargeOffPartsOverTotal += 1;
  }
  return { files: names, columns, values, chargeOffPartsOverTotal };
}
