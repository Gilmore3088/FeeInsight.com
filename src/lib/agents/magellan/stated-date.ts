import type { sql } from "@/lib/data-store/connection";
import { EDITION_SCAN_CHARS, editionStarts, effectiveDate } from "@/lib/agents/hamilton/schedule-edition";

type SqlTag = typeof sql;

/**
 * A schedule's own date, kept apart from when it was read (#1878).
 *
 * A fetch date says when Magellan last asked for a page, not how old the schedule is: a fee PDF
 * named "...-2022.pdf" fetched yesterday still prices 2022. Public pages only showed the read
 * date, which made an old schedule look current. This pass reads the date the document states
 * from its stored text (`agent_source_texts`), records it on the document
 * (`source_documents.stated_date`, `stated_date_basis`, `stated_date_version`; migration
 * 20270110000077) and marks a schedule dated more than `STALE_STATED_MONTHS` ago for the
 * freshness search (`discovery.ts`, `selectStaleCandidates`), which looks for a newer schedule
 * and replaces the bank's link only when a different page passes the fee-page check.
 *
 * Deterministic, no provider. The date is the latest one the opening `STATED_DATE_SCAN_CHARS`
 * characters state:
 *   - `effective_statement`: an "Effective ..." date, read by Hamilton's own readers in
 *     `hamilton/schedule-edition.ts`, so there is one rule: the latest `effectiveDate()` anywhere in
 *     the window, or the edition `editionStarts()` reads (the heading, then the schedule's own
 *     edition line past a web page's menu, #2573/#2605), whichever is later; the words around that
 *     "effective" are kept as evidence;
 *   - `printed_date`: a "Revised ...", "Rev. ..." or "Updated ..." date printed on it;
 *   - `url_year`: without either, the latest year 2000-2029 its address names (only the year is
 *     known, stored as 1 January; it counts as old only once the whole year is);
 *   - `none`: nothing found (the date stays null).
 * The latest date wins, so a schedule that announces a later change or prints a later revision
 * counts as newer: the rule can call a schedule current that is old, never the reverse.
 *
 * Before the migration is applied the columns do not exist: `statedDateColumnsReady` is false, the
 * pass reads and writes nothing (`schema_ready: false` in the step detail) and the freshness search
 * leaves out its stated-date arm, so either can merge and run first.
 */
export const STATED_DATE_VERSION = 1;
/** How much of each stored text is read for its date: as far as Hamilton reads an edition line. */
export const STATED_DATE_SCAN_CHARS = EDITION_SCAN_CHARS;
/** A schedule dated longer ago than this is sent to the freshness search. */
export const STALE_STATED_MONTHS = 24;
/** Documents dated per discover step. */
export const STATED_DATES_PER_STEP = 200;
export const STATED_DATE_EVENT = "magellan.stated_dates";

export type StatedDateBasis = "effective_statement" | "printed_date" | "url_year" | "none";

export interface StatedDate {
  /** YYYY-MM-DD, or null when the document states none. */
  date: string | null;
  basis: StatedDateBasis;
  /** The words the date was read from ("Effective January 1, 2022"), or the address's year. */
  evidence: string | null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A real calendar day as YYYY-MM-DD (a two-digit year is 20xx), or null. */
export function calendarDate(year: number, month: number, day: number): string | null {
  if (year < 100) year += 2000;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCMonth() !== month - 1) return null; // "February 31"
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthOf(word: string | undefined): number {
  return word ? MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1 : 0;
}

/** "Revised 03/2021", "Rev. 1/15/2022", "Updated: January 2023", "Last updated March 3, 2024". */
const PRINTED =
  /\b(?:revised|rev\.|updated)\s*(?:on|date)?\s*:?\s*(?:([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})|(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})|(\d{1,2})[/.-](\d{4})|([a-z]{3,9})\.?,?\s+(\d{4}))(?!\d)/gi;

/** A year in the address ("/2022-fee-schedule.pdf", "/uploads/2021/05/"), as the freshness search reads it. */
const URL_YEAR = /(?:^|[^0-9])(20[0-2][0-9])(?=[^0-9]|$)/g;

interface Found {
  date: string;
  evidence: string;
}

function evidenceOf(match: string): string {
  return match.replace(/\s+/g, " ").trim().slice(0, 120);
}

/** A YYYY-MM-DD string that is a real calendar day ("2023-02-31" is not). */
function realDay(iso: string | null): string | null {
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  return calendarDate(year, month, day) === iso ? iso : null;
}

/** The words of the first "effective" in `head` that dates `date` (it was read by Hamilton's readers). */
function effectiveEvidence(head: string, date: string): string {
  for (const m of head.matchAll(/effective/gi)) {
    const words = head.slice(m.index ?? 0, (m.index ?? 0) + 80).split(/\n|\.\s/)[0];
    if (effectiveDate(words) === date || editionStarts(words, false) === date) return evidenceOf(words);
  }
  return `Effective ${date}`;
}

/** The latest "Effective ..." date, by Hamilton's `effectiveDate()` and `editionStarts()`; null when none. */
function effectiveStatement(head: string): Found | null {
  const dates = [effectiveDate(head), editionStarts(head)].map(realDay).filter((d): d is string => d != null);
  if (dates.length === 0) return null;
  const date = dates.sort().at(-1)!;
  return { date, evidence: effectiveEvidence(head, date) };
}

function printedDates(head: string): Found[] {
  const found: Found[] = [];
  for (const m of head.matchAll(PRINTED)) {
    let date: string | null = null;
    if (m[1]) date = calendarDate(Number(m[3]), monthOf(m[1]), Number(m[2]));
    else if (m[4]) date = calendarDate(Number(m[6]), Number(m[4]), Number(m[5]));
    else if (m[7]) date = calendarDate(Number(m[8]), Number(m[7]), 1);
    else if (m[9]) date = calendarDate(Number(m[10]), monthOf(m[9]), 1);
    if (date) found.push({ date, evidence: evidenceOf(m[0]) });
  }
  return found;
}

/** The latest year 2000-2029 the address names, up to `thisYear`; null when none. */
export function urlYear(url: string | null | undefined, thisYear: number): number | null {
  if (!url) return null;
  let address = url;
  try {
    address = decodeURIComponent(url);
  } catch {
    // keep the raw address
  }
  const years = [...address.matchAll(URL_YEAR)].map((m) => Number(m[1])).filter((year) => year <= thisYear);
  return years.length > 0 ? Math.max(...years) : null;
}

function latest(found: Found[]): Found | null {
  return found.reduce<Found | null>((best, item) => (best == null || item.date > best.date ? item : best), null);
}

/** The date a document states (see the file comment). Pure. */
export function readStatedDate(text: string | null | undefined, url: string | null | undefined, now = new Date()): StatedDate {
  const head = (text ?? "").slice(0, STATED_DATE_SCAN_CHARS);
  const effective = effectiveStatement(head);
  const printed = latest(printedDates(head));
  if (effective && (!printed || effective.date >= printed.date)) {
    return { date: effective.date, basis: "effective_statement", evidence: effective.evidence };
  }
  if (printed) return { date: printed.date, basis: "printed_date", evidence: printed.evidence };
  const year = urlYear(url, now.getUTCFullYear());
  if (year != null) return { date: `${year}-01-01`, basis: "url_year", evidence: String(year) };
  return { date: null, basis: "none", evidence: null };
}

/** The day `STALE_STATED_MONTHS` before `now` (UTC), YYYY-MM-DD: a schedule dated before it is old. */
export function staleBefore(now = new Date()): string {
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - STALE_STATED_MONTHS, now.getUTCDate()));
  return at.toISOString().slice(0, 10);
}

/** True when the stated date is more than `STALE_STATED_MONTHS` old; a year from the address counts from its last day. */
export function isStaleStatedDate(stated: Pick<StatedDate, "date" | "basis">, now = new Date()): boolean {
  if (!stated.date) return false;
  const last = stated.basis === "url_year" ? `${stated.date.slice(0, 4)}-12-31` : stated.date;
  return last < staleBefore(now);
}

/**
 * The same rule in SQL, for a `source_documents` row aliased `stated_doc`. Only for use once
 * `statedDateColumnsReady` is true.
 */
export function statedDateStaleSql(db: SqlTag, now = new Date()) {
  return db`(
    stated_doc.stated_date_version = ${STATED_DATE_VERSION}
    AND stated_doc.stated_date IS NOT NULL
    AND (CASE WHEN stated_doc.stated_date_basis = 'url_year'
              THEN make_date(extract(year FROM stated_doc.stated_date)::int, 12, 31)
              ELSE stated_doc.stated_date END) < ${staleBefore(now)}::date
  )`;
}

const readyCache = new WeakMap<object, true>();

/** True once migration 20270110000077's three columns exist. Only a positive answer is cached. */
export async function statedDateColumnsReady(db: SqlTag): Promise<boolean> {
  if (readyCache.get(db)) return true;
  try {
    const [row] = await db<Array<{ ready: boolean }>>`
      SELECT COUNT(*) = 3 AS ready
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'source_documents'
         AND column_name IN ('stated_date', 'stated_date_basis', 'stated_date_version')
    `;
    const ready = row?.ready === true;
    if (ready) readyCache.set(db, true);
    return ready;
  } catch {
    return false;
  }
}

interface DocumentRow {
  id: number | string;
  institution_id: number | string;
  document_url: string | null;
  live_fees: number | string;
  head: string | null;
}

export interface StatedDateSample {
  source_document_id: number;
  institution_id: number;
  document_url: string | null;
  stated_date: string | null;
  basis: StatedDateBasis;
  evidence: string | null;
  live_fees: number;
}

export interface StatedDatePassResult {
  schema_ready: boolean;
  version: number;
  dry_run: boolean;
  /** Documents read this step. */
  read: number;
  /** Of those, how many state a date (any basis). */
  dated: number;
  by_basis: Record<StatedDateBasis, number>;
  /** Read this step and dated more than STALE_STATED_MONTHS ago. */
  stale: number;
  /** Live fees on those stale documents. */
  stale_live_fees: number;
  /** The day before which a schedule counts as old. */
  stale_before: string;
  /** Up to 10 stale documents with the words their date was read from. */
  stale_samples: StatedDateSample[];
}

function emptyResult(schemaReady: boolean, dryRun: boolean, now: Date): StatedDatePassResult {
  return {
    schema_ready: schemaReady,
    version: STATED_DATE_VERSION,
    dry_run: dryRun,
    read: 0,
    dated: 0,
    by_basis: { effective_statement: 0, printed_date: 0, url_year: 0, none: 0 },
    stale: 0,
    stale_live_fees: 0,
    stale_before: staleBefore(now),
    stale_samples: [],
  };
}

/**
 * Dates up to `limit` documents not yet dated at this version: documents live fees cite first,
 * then the other current copies, newest first. Each is read from its newest completed text. A dry
 * run reads and reports but writes nothing. One `magellan.stated_dates` run event records the
 * counts and the stale samples with their evidence. The freshness search picks up the stale ones.
 */
export async function runStatedDatePass(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun?: boolean; limit?: number; now?: Date },
): Promise<StatedDatePassResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun === true;
  if (!(await statedDateColumnsReady(db))) return emptyResult(false, dryRun, now);
  const limit = Math.max(0, Math.floor(options.limit ?? STATED_DATES_PER_STEP));
  const result = emptyResult(true, dryRun, now);
  if (limit === 0) return result;

  const rows = await db<DocumentRow[]>`
    -- magellan stated dates
    WITH live AS (
      SELECT c.source_document_id AS id, COUNT(*) AS live_fees
        FROM published_fee_catalog c
       WHERE c.source_document_id IS NOT NULL
       GROUP BY c.source_document_id
    )
    SELECT doc.id, doc.institution_id, doc.document_url,
           COALESCE(live.live_fees, 0) AS live_fees,
           txt.head
      FROM source_documents doc
      LEFT JOIN live ON live.id = doc.id
      JOIN LATERAL (
        SELECT left(t.normalized_text, ${STATED_DATE_SCAN_CHARS}) AS head
          FROM agent_source_texts t
         WHERE t.source_document_id = doc.id
           AND t.status = 'completed'
         ORDER BY t.id DESC
         LIMIT 1
      ) txt ON TRUE
     WHERE (doc.stated_date_version IS NULL OR doc.stated_date_version < ${STATED_DATE_VERSION})
       AND (
         live.id IS NOT NULL
         OR (doc.status = 'success' AND doc.duplicate_of_id IS NULL AND doc.superseded_by_id IS NULL)
       )
     ORDER BY (live.id IS NOT NULL) DESC, doc.id DESC
     LIMIT ${limit}
  `;

  const ids: number[] = [];
  const dates: string[] = [];
  const bases: string[] = [];
  for (const row of rows) {
    const stated = readStatedDate(row.head, row.document_url, now);
    const liveFees = Number(row.live_fees) || 0;
    result.read += 1;
    result.by_basis[stated.basis] += 1;
    if (stated.date) result.dated += 1;
    if (isStaleStatedDate(stated, now)) {
      result.stale += 1;
      result.stale_live_fees += liveFees;
      if (result.stale_samples.length < 10) {
        result.stale_samples.push({
          source_document_id: Number(row.id),
          institution_id: Number(row.institution_id),
          document_url: row.document_url,
          stated_date: stated.date,
          basis: stated.basis,
          evidence: stated.evidence,
          live_fees: liveFees,
        });
      }
    }
    ids.push(Number(row.id));
    dates.push(stated.date ?? "");
    bases.push(stated.basis);
  }

  if (!dryRun && ids.length > 0) {
    await db`
      UPDATE source_documents doc
         SET stated_date = NULLIF(u.stated_date, '')::date,
             stated_date_basis = u.basis,
             stated_date_version = ${STATED_DATE_VERSION}
        FROM unnest(${ids}::bigint[], ${dates}::text[], ${bases}::text[]) AS u(id, stated_date, basis)
       WHERE doc.id = u.id
    `;
  }

  if (result.read > 0) {
    await db`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, ${STATED_DATE_EVENT}, ${dryRun ? "skipped" : "completed"},
        ${`Magellan read the stated date of ${result.read} documents: ${result.dated} state one, ${result.stale} dated before ${result.stale_before} (${result.stale_live_fees} live fees)${dryRun ? " (dry run, nothing written)" : ""}.`},
        ${JSON.stringify({ ...result, protocol: `${STATED_DATE_EVENT}.v${STATED_DATE_VERSION}` })}::jsonb
      )
    `;
  }
  return result;
}
