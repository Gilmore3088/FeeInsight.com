import { discontinuedLines, withoutDiscontinuedLines, type DiscontinuedLine } from "@/lib/custom-report/discontinued-rows";

/**
 * Knox's pre-extract flag for discontinued account tables (#2070). A schedule keeps tables for
 * accounts the bank no longer opens ("Legacy Accounts", "Grandfathered Checking Account Types:", "$5.00
 * (this account no longer offered)"). Before this, Knox read their rows like any other, the self-check
 * refused each one after the read (`discontinuedRow`, rules v113), and the refused reads were held as
 * untraced lines, which count toward the reading-error report Rosetta acts on (`untraced-read-error.ts`).
 *
 * Now Knox finds those rows in the whole text before any specialist reads it
 * (`discontinuedLines`, the same heading and row rules as the shared check, so it flags only rows the
 * shared check refuses for every fee they price) and reports them on each document's attempt detail
 * (`discontinued_rows`) and on the extract step (`discontinued_rows_flagged`).
 *
 * Switch: `KNOX_DISCONTINUED_TABLES_LIVE`, off by default. Off, Knox only flags and counts; the text it
 * reads is unchanged, so extraction writes exactly what it wrote before. On, the flagged rows are left
 * out of the text before any specialist reads it, so they are neither read nor held. Turning it on
 * changes new reads only; it takes no live fee down (Darwin's live re-check of these fees is the
 * shared source check, v26, already running), and it reaches stored texts only when the Knox rules
 * version next moves. That bump belongs to the switch-on PR, with James's yes.
 */
export const KNOX_DISCONTINUED_TABLES_SWITCH = "KNOX_DISCONTINUED_TABLES_LIVE";

/** The switch reads on for "1" or "true", allowing for stray spaces, quotes and capitals. */
export function discontinuedTablesLive(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const raw = env[KNOX_DISCONTINUED_TABLES_SWITCH];
  if (raw == null) return false;
  const value = raw.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase();
  return value === "1" || value === "true";
}

export interface DiscontinuedTableFlag {
  /** Price rows flagged as a discontinued account's. */
  flagged: number;
  /** Rows left out of the text the specialists read (0 with the switch off). */
  removed: number;
  /** The legacy section headings the flagged rows sit under, each once. */
  headings: string[];
  /** Rows flagged by a marker on the row itself. */
  rowMarkers: number;
}

/**
 * The text Knox's specialists read, and the flag. Pure: `live` defaults to the switch.
 */
export function flagDiscontinuedTables(text: string, live: boolean = discontinuedTablesLive()): { text: string; flag: DiscontinuedTableFlag; lines: DiscontinuedLine[] } {
  const lines = discontinuedLines(text);
  const flag: DiscontinuedTableFlag = {
    flagged: lines.length,
    removed: live ? lines.length : 0,
    headings: [...new Set(lines.flatMap((line) => (line.heading ? [line.heading.trim()] : [])))],
    rowMarkers: lines.filter((line) => line.why === "row_marker").length,
  };
  return { text: live && lines.length > 0 ? withoutDiscontinuedLines(text, lines) : text, flag, lines };
}
