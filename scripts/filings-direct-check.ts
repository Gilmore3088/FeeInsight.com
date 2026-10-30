/**
 * Read-only audit (#1925, gate G3/D3): Hamilton's shown quarterly financials against the
 * regulators' own bulk files, not our stored copy of them. Logic: src/lib/hamilton/filings-direct-check.ts.
 *
 * Two steps, because the production read runs through the read-only SQL tool, never from here:
 *   npx tsx scripts/filings-direct-check.ts sql <per-charter> <seed> <from YYYY-MM-DD> [id,id,...]
 *       prints one SELECT; save its single `found` value as found.json
 *   npx tsx scripts/filings-direct-check.ts check <found.json> <filings-dir>
 *       <filings-dir>/ffiec/*.zip: FFIEC CDR "Call Reports -- Single Period" bulk zips (all schedules)
 *       <filings-dir>/ncua/*.zip:  NCUA 5300 quarterly zips (call-report-data-YYYY-MM.zip)
 *       prints per-metric counts and every mismatch. Writes nothing.
 * Load one quarter before the first you want checked, so its year-to-date lines can be made quarters.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { toFinancialHistoryRow } from "@/lib/data-store/financial";
import { unzipSchedules } from "@/lib/regulatory/ffiec";
import {
  directCheckReport,
  directCheckSql,
  ffiecFileDate,
  formatDirectReport,
  readFfiecQuarter,
  readNcuaQuarter,
  type DirectSubject,
  type Filings,
} from "@/lib/hamilton/filings-direct-check";

const FFIEC_SCHEDULES = /Schedule (RC|RCK|RCR\w*|RI)\s+\d{8}(\(\d+ of \d+\))?\.txt$/i;

const zips = (dir: string) => {
  try {
    return readdirSync(dir).filter((f) => /\.zip$/i.test(f)).sort().map((f) => join(dir, f));
  } catch {
    return [];
  }
};

async function loadFfiec(dir: string): Promise<Filings> {
  const out: Filings = new Map();
  for (const path of zips(dir)) {
    const files = await unzipSchedules(new Uint8Array(readFileSync(path)), FFIEC_SCHEDULES);
    const date = Object.keys(files).map(ffiecFileDate).find(Boolean);
    if (!date) throw new Error(`${path}: no dated schedule file`);
    const { quarter, conflicts } = readFfiecQuarter(files);
    if (conflicts.length > 0) console.error(`${path}: ${conflicts.length} conflicting values, first: ${conflicts[0]}`);
    out.set(date, quarter);
    console.error(`FFIEC ${date}: ${quarter.size} filers from ${Object.keys(files).length} schedule files`);
  }
  return out;
}

function loadNcua(dir: string): Filings {
  const out: Filings = new Map();
  for (const path of zips(dir)) {
    const files = unzipSync(new Uint8Array(readFileSync(path)), { filter: (f) => /(^|\/)fs220[a-z0-9_]*\.txt$/i.test(f.name) });
    const { quarter, reportDate, conflicts } = readNcuaQuarter(files);
    if (!reportDate) throw new Error(`${path}: no CYCLE_DATE`);
    if (conflicts.length > 0) console.error(`${path}: ${conflicts.length} conflicting values, first: ${conflicts[0]}`);
    out.set(reportDate, quarter);
    console.error(`NCUA ${reportDate}: ${quarter.size} credit unions from ${Object.keys(files).length} files`);
  }
  return out;
}

interface FoundSubject {
  institution_id: number;
  charter: "bank" | "credit_union";
  filer_id: string;
  name?: string;
  rows: Record<string, unknown>[];
}

export function subjectsFromFound(found: { subjects: FoundSubject[] }): DirectSubject[] {
  return found.subjects.map((s) => ({
    institutionId: Number(s.institution_id),
    charter: s.charter,
    filerId: String(s.filer_id),
    name: s.name,
    rows: s.rows.map(toFinancialHistoryRow),
    nsfRevenue: Object.fromEntries(s.rows.map((r) => [String(r.report_date), r.nsf_revenue == null ? null : Number(r.nsf_revenue)])),
  }));
}

async function main(argv: string[]) {
  const [cmd, ...args] = argv;
  if (cmd === "sql") {
    const [perCharter = "12", seed = "1925", from = "2023-01-01", ids = ""] = args;
    console.log(directCheckSql({ perCharter: Number(perCharter), seed, from, extraIds: ids.split(",").filter(Boolean).map(Number) }));
    return;
  }
  if (cmd === "check" && args.length === 2) {
    const raw = JSON.parse(readFileSync(args[0], "utf8"));
    const found = raw.found ?? raw;
    const subjects = subjectsFromFound(typeof found === "string" ? JSON.parse(found) : found);
    const report = directCheckReport(subjects, await loadFfiec(join(args[1], "ffiec")), loadNcua(join(args[1], "ncua")));
    console.log(formatDirectReport(report));
    return;
  }
  console.error("usage: filings-direct-check.ts sql <per-charter> <seed> <from> [ids] | check <found.json> <filings-dir>");
  process.exitCode = 2;
}

if (process.argv[1]?.endsWith("filings-direct-check.ts")) void main(process.argv.slice(2));
