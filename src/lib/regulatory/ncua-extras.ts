import { strFromU8, unzipSync } from "fflate";
import { parseCsv } from "./ncua";

/**
 * NCUA 5300 lines beyond the fixed columns of institution_financial_records: share and deposit
 * account counts, employees, shares over the insured limit and fee-income lines. Pure: reads a
 * downloaded quarterly zip, never writes to the database.
 *
 * No account code is written here from memory. The zip's account description file
 * (AcctDesc.txt: Account, AcctName, AcctDesc, TableName) names every ACCT_* column; a line is
 * read when NCUA's own name or description for it matches one of the topics below, and it is
 * stored under its NCUA code with NCUA's description. A topic that matches nothing is reported
 * in the run, and a zip without the description file loads nothing.
 */

export type NcuaExtraTopic = "account_counts" | "employees" | "uninsured_shares" | "fee_income";

interface TopicRule {
  topic: NcuaExtraTopic;
  matches: readonly RegExp[];
  excludes?: readonly RegExp[];
}

export const NCUA_EXTRA_TOPICS: readonly TopicRule[] = [
  {
    topic: "account_counts",
    matches: [/NUMBER OF|NO\.? OF|# OF/i, /SHARE|DEPOSIT|DRAFT|CERTIFICATE|IRA|MONEY MARKET|ACCOUNT/i],
    excludes: [/LOAN|LEASE|MEMBER|EMPLOYEE|BRANCH|OFFICE|ATM/i],
  },
  { topic: "employees", matches: [/EMPLOYEE/i, /NUMBER|NO\.?|FULL|PART/i], excludes: [/LOAN|BENEFIT|COMPENSATION|EXPENSE|SALAR/i] },
  { topic: "uninsured_shares", matches: [/UNINSURED|INSURED LIMIT|EXCEED(ING)? .*INSUR|IN EXCESS OF .*INSUR/i] },
  {
    topic: "fee_income",
    matches: [/FEE INCOME|INTERCHANGE|OVERDRAFT|NON-?SUFFICIENT|COURTESY PAY|SERVICE CHARGE|ATM FEE/i],
    excludes: [/EXPENSE|LOAN ORIGINATION|NUMBER OF/i],
  },
];

/** Most lines one quarter may read, so a loose description match cannot flood the table. */
export const NCUA_EXTRA_MAX_ACCOUNTS = 80;

export interface NcuaAccountDescription {
  code: string;
  name: string;
  description: string;
  table: string;
}

export interface NcuaExtraLine extends NcuaAccountDescription {
  topic: NcuaExtraTopic;
  unit: "dollars" | "count";
  basis: "ytd" | "point_in_time";
}

export interface NcuaExtraValue {
  charter: string;
  code: string;
  key: string;
  description: string;
  table: string;
  unit: "dollars" | "count";
  basis: "ytd" | "point_in_time";
  value: number;
}

export interface NcuaExtrasRead {
  hasDescriptionFile: boolean;
  descriptionFile: string | null;
  lines: NcuaExtraLine[];
  /** Lines chosen from the descriptions that no FS220 file carries. */
  linesNotInData: string[];
  topicsWithoutLines: NcuaExtraTopic[];
  truncatedLines: number;
  values: NcuaExtraValue[];
}

const DESCRIPTION_FILE = /(^|\/)acct-?desc[^/]*\.txt$/i;
const DATA_FILE = /(^|\/)fs220[a-z0-9_]*\.txt$/i;

function normalizeCode(raw: string): string {
  const code = raw.trim().toUpperCase();
  return code.startsWith("ACCT_") ? code : `ACCT_${code}`;
}

export function readNcuaAccountDescriptions(text: string): NcuaAccountDescription[] {
  return parseCsv(text)
    .map((row) => ({
      code: normalizeCode(row.ACCOUNT ?? row.ACCT ?? ""),
      name: row.ACCTNAME ?? row.ACCOUNTNAME ?? "",
      description: row.ACCTDESC ?? row.DESCRIPTION ?? "",
      table: row.TABLENAME ?? row.TABLE ?? "",
    }))
    .filter((row) => row.code !== "ACCT_");
}

export function topicOf(account: NcuaAccountDescription): NcuaExtraTopic | null {
  const text = `${account.name} ${account.description}`;
  for (const rule of NCUA_EXTRA_TOPICS) {
    if (rule.matches.every((re) => re.test(text)) && !(rule.excludes ?? []).some((re) => re.test(text))) return rule.topic;
  }
  return null;
}

export function chooseNcuaExtraLines(accounts: NcuaAccountDescription[]): { lines: NcuaExtraLine[]; truncated: number } {
  const seen = new Set<string>();
  const all: NcuaExtraLine[] = [];
  for (const account of accounts) {
    if (seen.has(account.code)) continue;
    const topic = topicOf(account);
    if (!topic) continue;
    seen.add(account.code);
    const count = topic === "account_counts" || topic === "employees";
    all.push({ ...account, topic, unit: count ? "count" : "dollars", basis: topic === "fee_income" ? "ytd" : "point_in_time" });
  }
  return { lines: all.slice(0, NCUA_EXTRA_MAX_ACCOUNTS), truncated: Math.max(0, all.length - NCUA_EXTRA_MAX_ACCOUNTS) };
}

export function readNcuaExtras(zip: Uint8Array): NcuaExtrasRead {
  const files = unzipSync(zip, { filter: (file) => DESCRIPTION_FILE.test(file.name) || DATA_FILE.test(file.name) });
  const descriptionFile = Object.keys(files).find((name) => DESCRIPTION_FILE.test(name)) ?? null;
  if (!descriptionFile) {
    return { hasDescriptionFile: false, descriptionFile: null, lines: [], linesNotInData: [], topicsWithoutLines: NCUA_EXTRA_TOPICS.map((t) => t.topic), truncatedLines: 0, values: [] };
  }
  const { lines, truncated } = chooseNcuaExtraLines(readNcuaAccountDescriptions(strFromU8(files[descriptionFile], true)));
  const wanted = new Map(lines.map((line) => [line.code, line]));
  const found = new Set<string>();
  const byCharter = new Map<string, Map<string, number>>();
  for (const name of Object.keys(files).filter((n) => DATA_FILE.test(n)).sort()) {
    const rows = parseCsv(strFromU8(files[name], true));
    for (const key of Object.keys(rows[0] ?? {})) if (wanted.has(key)) found.add(key);
    for (const row of rows) {
      const charter = row.CU_NUMBER;
      if (!charter) continue;
      for (const code of wanted.keys()) {
        const raw = row[code];
        if (raw === undefined || raw === "") continue;
        const value = Number(raw);
        if (!Number.isFinite(value)) continue;
        const mine = byCharter.get(charter) ?? new Map<string, number>();
        // A second file's blank or zero never overwrites a reported figure.
        if (!mine.has(code) || (mine.get(code) === 0 && value !== 0)) mine.set(code, value);
        byCharter.set(charter, mine);
      }
    }
  }
  const values: NcuaExtraValue[] = [];
  for (const [charter, mine] of byCharter) {
    for (const [code, value] of mine) {
      const line = wanted.get(code)!;
      values.push({ charter, code, key: code.toLowerCase(), description: line.description || line.name, table: line.table, unit: line.unit, basis: line.basis, value });
    }
  }
  const topics = new Set(lines.filter((l) => found.has(l.code)).map((l) => l.topic));
  return {
    hasDescriptionFile: true,
    descriptionFile,
    lines,
    linesNotInData: lines.filter((l) => !found.has(l.code)).map((l) => l.code),
    topicsWithoutLines: NCUA_EXTRA_TOPICS.map((t) => t.topic).filter((t) => !topics.has(t)),
    truncatedLines: truncated,
    values,
  };
}
