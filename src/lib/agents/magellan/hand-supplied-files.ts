/**
 * Pure helpers for schedules a person supplies by hand (`hand-supplied.ts`): the file-name
 * rule and the browser-hunt CSV. No database or server imports, so the admin page's browser
 * code uses the same rules as the server.
 *
 * A file is named `<institution_id>__<short-name>__consumer.pdf` (or `__business.pdf`). The CSV
 * is the browser hunt's sheet (template: coverage/browser-hunt-2026-10-17.csv), one row per
 * institution, with the columns in HUNT_CSV_COLUMNS.
 */

export const HUNT_CSV_COLUMNS = [
  "order",
  "tier",
  "institution_id",
  "institution",
  "state",
  "type",
  "assets_$B",
  "website",
  "link_on_file_(not_a_schedule)",
  "last_fetch_code",
  "status",
  "found_url",
  "file_name",
  "effective_date",
  "notes",
] as const;

export const HUNT_STATUSES = [
  "FOUND_PDF",
  "FOUND_PAGE",
  "ONLY_AGREEMENT",
  "NO_PUBLIC_SCHEDULE",
  "NOT_CONSUMER",
  "BLOCKED",
  "WRONG_SITE",
] as const;
export type HuntStatus = (typeof HUNT_STATUSES)[number];

/** Rows whose found_url is the schedule: only these become links or a file's source address. */
export const FOUND_STATUSES: ReadonlySet<string> = new Set<HuntStatus>(["FOUND_PDF", "FOUND_PAGE"]);

export type ScheduleAudience = "consumer" | "business";

export interface SuppliedFileName {
  institutionId: number;
  shortName: string;
  audience: ScheduleAudience;
}

// `102__townebank__consumer.pdf`; a browser's " (1)" on a second download is allowed. A name
// with no audience suffix is the consumer schedule, the browser hunt's default.
const FILE_NAME = /^(\d{1,9})__(.*?)(?:__(consumer|business))?(?:\s*\(\d+\))?\.pdf$/i;

/** The institution id, short name and audience in a supplied file's name; null when it does not follow the rule. */
export function parseSuppliedFileName(fileName: string): SuppliedFileName | null {
  const base = fileName.trim().split(/[\\/]/).pop() ?? "";
  const match = FILE_NAME.exec(base);
  if (!match) return null;
  const institutionId = Number(match[1]);
  if (!Number.isSafeInteger(institutionId) || institutionId < 1) return null;
  return {
    institutionId,
    shortName: match[2].replace(/__+$/, ""),
    audience: (match[3]?.toLowerCase() as ScheduleAudience | undefined) ?? "consumer",
  };
}

export interface HuntRow {
  /** 1-based line in the CSV, header included, so a report can name the line. */
  line: number;
  institutionId: number | null;
  institution: string;
  status: string;
  foundUrl: string;
  fileName: string;
  effectiveDate: string;
  notes: string;
}

/** RFC 4180 fields: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

export type ParsedHuntCsv = { ok: true; rows: HuntRow[] } | { ok: false; error: string };

/** The hunt sheet's rows. Needs at least institution_id, status and found_url in the header. */
export function parseHuntCsv(text: string): ParsedHuntCsv {
  const [header, ...body] = parseCsv(text);
  if (!header) return { ok: false, error: "The CSV is empty" };
  const names = header.map((cell) => cell.trim().toLowerCase());
  const column = (name: string) => names.indexOf(name);
  const missing = ["institution_id", "status", "found_url"].filter((name) => column(name) < 0);
  if (missing.length > 0) return { ok: false, error: `The CSV has no ${missing.join(", ")} column` };
  const cell = (cells: string[], name: string) => {
    const index = column(name);
    return index < 0 ? "" : (cells[index] ?? "").trim();
  };
  const rows = body.map((cells, index): HuntRow => {
    const rawId = cell(cells, "institution_id");
    const id = /^\d+$/.test(rawId) ? Number(rawId) : null;
    return {
      line: index + 2,
      institutionId: id != null && id > 0 ? id : null,
      institution: cell(cells, "institution"),
      status: cell(cells, "status").toUpperCase(),
      foundUrl: cell(cells, "found_url"),
      fileName: cell(cells, "file_name"),
      effectiveDate: cell(cells, "effective_date"),
      notes: cell(cells, "notes"),
    };
  });
  return { ok: true, rows };
}

const sameFile = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The CSV row that describes an uploaded file: the row naming it in file_name, else the one
 * FOUND row with a found_url for its institution (two such rows, consumer and business, need
 * file_name to tell them apart). Null when no row matches.
 */
export function huntRowForFile(rows: readonly HuntRow[], fileName: string): HuntRow | null {
  const named = rows.find((row) => row.fileName !== "" && sameFile(row.fileName, fileName));
  if (named) return named;
  const parsed = parseSuppliedFileName(fileName);
  if (!parsed) return null;
  const found = rows.filter(
    (row) => row.institutionId === parsed.institutionId && FOUND_STATUSES.has(row.status) && row.foundUrl !== "",
  );
  return found.length === 1 ? found[0] : null;
}

export type HuntRowPlan =
  | { kind: "link"; row: HuntRow }
  | { kind: "file"; row: HuntRow; fileName: string }
  | { kind: "skip"; row: HuntRow; reason: string };

/**
 * What the CSV import does with each row. A row with an uploaded file is loaded from the file
 * (its found_url becomes the document's source address); a FOUND row with a found_url and no
 * uploaded file becomes a hand-found link; every other row is skipped, with the reason.
 */
export function planHuntRows(rows: readonly HuntRow[], uploadedFileNames: readonly string[]): HuntRowPlan[] {
  const fileFor = new Map<HuntRow, string>();
  for (const fileName of uploadedFileNames) {
    const row = huntRowForFile(rows, fileName);
    if (row && !fileFor.has(row)) fileFor.set(row, fileName);
  }
  return rows.map((row): HuntRowPlan => {
    const fileName = fileFor.get(row);
    if (fileName) return { kind: "file", row, fileName };
    if (!FOUND_STATUSES.has(row.status)) {
      return { kind: "skip", row, reason: row.status ? `status ${row.status}` : "no status yet" };
    }
    if (row.foundUrl === "") return { kind: "skip", row, reason: `status ${row.status} with no found_url` };
    // A hand-found link is a consumer companion; a business schedule is not one.
    if (row.fileName !== "" && parseSuppliedFileName(row.fileName)?.audience === "business") {
      return { kind: "skip", row, reason: "business schedule: the index reads consumer schedules" };
    }
    if (row.institutionId == null) return { kind: "skip", row, reason: "no institution_id" };
    return { kind: "link", row };
  });
}
