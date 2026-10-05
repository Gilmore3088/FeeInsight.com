/**
 * Hosted Competitive Fee Position reports.
 *
 * The finished reports live as self-contained HTML in Reports/studio/out/<institution_id>.html.
 * A prospect reaches theirs through an unguessable token (Reports/studio/hosted-reports.json),
 * and the anonymized sample lives in Reports/studio/sample/. Both are committed source, read
 * from disk at request time; next.config.ts traces the studio files into the server bundle.
 */
import fs from "node:fs";
import path from "node:path";
import hostedReportMap from "../../Reports/studio/hosted-reports.json";

export interface HostedReportEntry {
  institution_id: number;
  institution_name: string;
  /** ISO date (YYYY-MM-DD) the report was prepared. */
  prepared_on: string;
  /** ISO date (YYYY-MM-DD); the link stops resolving after this day. */
  expires_on: string;
}

export interface HostedReport extends HostedReportEntry {
  token: string;
}

export type HostedReportMap = Record<string, HostedReportEntry>;

interface LookupOptions {
  /** Override the committed token map (tests). */
  map?: HostedReportMap;
  /** Override "today" (tests). */
  now?: Date;
}

const TOKEN_PATTERN = /^[0-9a-f]{16}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STUDIO_DIR = path.join(process.cwd(), "Reports", "studio");
const SAMPLE_FILE = path.join(STUDIO_DIR, "sample", "sample-competitive-fee-position.html");

/** No one-word orphan lines; also covers reports rendered before the template had the rule. */
const WRAP_STYLES = `
<style data-fee-insight-wrap>
  h1, h2, h3, h4 { text-wrap: balance; }
  p, li, figcaption { text-wrap: pretty; }
</style>`;

/** Screen-only styles so the print-designed report reads as pages inside the site. */
const SCREEN_STYLES = `${WRAP_STYLES}
<style data-fee-insight-embed>
  @media screen {
    body { background: #FDFBF8; }
    .page { padding: 0.75in 0.85in 0.8in; border-bottom: 1px solid #E0D7C9; }
    .bleed { border-bottom: 1px solid #E0D7C9; }
  }
</style>`;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "2026-08-16" -> "Aug 16, 2026" (calendar date, no timezone shift). */
export function formatReportDate(isoDate: string): string {
  if (!ISO_DATE_PATTERN.test(isoDate)) return isoDate;
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** True when the entry's last valid day is before today (UTC calendar dates). */
export function isHostedReportExpired(entry: HostedReportEntry, now: Date = new Date()): boolean {
  if (!ISO_DATE_PATTERN.test(entry.expires_on)) return true;
  return toIsoDate(now) > entry.expires_on;
}

/** Resolve a token to its report record; null when unknown, malformed, or expired. */
export function getHostedReport(token: string, options: LookupOptions = {}): HostedReport | null {
  const lookup = lookupHostedReport(token, options);
  return lookup.state === "ok" ? lookup.report : null;
}

/** Like getHostedReport, but tells an expired link (offer a fresh report) from an unknown one. */
export function lookupHostedReport(
  token: string,
  options: LookupOptions = {},
): { state: "ok" | "expired"; report: HostedReport } | { state: "missing" } {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return { state: "missing" };
  const map = options.map ?? (hostedReportMap as HostedReportMap);
  const entry = map[token];
  if (!entry) return { state: "missing" };
  const report = { token, ...entry };
  return { state: isHostedReportExpired(entry, options.now) ? "expired" : "ok", report };
}

/** The free request form, prefilled for this institution; the request enters the lead loop. */
export function hostedReportRequestHref(report: HostedReportEntry, src: "hosted_report" | "hosted_report_expired"): string {
  const params = new URLSearchParams({
    institution: String(report.institution_id),
    name: report.institution_name,
    src,
  });
  return `/for-institutions?${params.toString()}#report`;
}

/** Read the finished report HTML for an institution; null when no report exists. */
export function readHostedReportHtml(institutionId: number): string | null {
  if (!Number.isInteger(institutionId) || institutionId <= 0) return null;
  const file = path.join(STUDIO_DIR, "out", `${institutionId}.html`);
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

/** Read the anonymized sample report HTML. */
export function readSampleReportHtml(): string {
  return fs.readFileSync(SAMPLE_FILE, "utf8");
}

/** Add screen-only page styling so the report can be embedded in an iframe srcDoc. */
export function prepareReportForEmbed(html: string): string {
  const marker = "</head>";
  const at = html.indexOf(marker);
  if (at === -1) return `${SCREEN_STYLES}${html}`;
  return `${html.slice(0, at)}${SCREEN_STYLES}\n${html.slice(at)}`;
}

/** Add an auto-print hook so a "Download PDF" link opens the browser's print dialog. */
export function prepareReportForPrint(html: string): string {
  const script =
    "<script>window.addEventListener('load',function(){" +
    "var go=function(){window.print();};" +
    "(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(go,go);" +
    "});</script>";
  const head = html.indexOf("</head>");
  const styled = head === -1 ? `${WRAP_STYLES}${html}` : `${html.slice(0, head)}${WRAP_STYLES}\n${html.slice(head)}`;
  const marker = "</body>";
  const at = styled.lastIndexOf(marker);
  if (at === -1) return `${styled}${script}`;
  return `${styled.slice(0, at)}${script}\n${styled.slice(at)}`;
}

export interface ReportFinding {
  stat: string;
  statLabel: string;
  headline: string;
  body: string;
}

export interface ReportExecutiveSummary {
  findings: ReportFinding[];
  /** The "Net position" closing paragraph. */
  narrative: string | null;
}

const FINDING_PATTERN =
  /<div class="finding">\s*<div class="num"[^>]*>([\s\S]*?)<small>([\s\S]*?)<\/small><\/div>\s*<p><b>([\s\S]*?)<\/b>([\s\S]*?)<\/p>\s*<\/div>/g;
const NARRATIVE_PATTERN = /<p class="narrative drop">([\s\S]*?)<\/p>/;

function decodeText(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull the executive summary (three findings + net position) out of a finished
 * report so pages can render it as native HTML outside the iframe.
 */
export function extractExecutiveSummary(html: string): ReportExecutiveSummary {
  const findings: ReportFinding[] = [];
  for (const match of html.matchAll(FINDING_PATTERN)) {
    findings.push({
      stat: decodeText(match[1]),
      statLabel: decodeText(match[2]),
      headline: decodeText(match[3]),
      body: decodeText(match[4]),
    });
  }
  const narrativeMatch = NARRATIVE_PATTERN.exec(html);
  const narrative = narrativeMatch ? decodeText(narrativeMatch[1]) : null;
  return { findings, narrative: narrative || null };
}

export type PositionStatus = "above" | "inside" | "below";

export interface ReportPositionRow {
  category: string;
  you: number;
  p25: number;
  median: number;
  p75: number;
  peers: number;
  percentile: number;
  status: PositionStatus;
}

export interface ReportPositionMap {
  rows: ReportPositionRow[];
  /** Number of institutions in the peer cohort, when the report states it. */
  cohortSize: number | null;
}

const POSITION_TABLE_PATTERN = /<table class="position"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/;
const POSITION_ROW_PATTERN = /<tr>([\s\S]*?)<\/tr>/g;
const POSITION_CELL_PATTERN = /<td[^>]*>([\s\S]*?)<\/td>/g;
const CATEGORY_PATTERN = /<span class="cat">([\s\S]*?)<\/span>/;
const PERCENTILE_PATTERN = /\bP(\d{1,3})\b/;
const COHORT_PATTERN = /Compared with (\d+) (?:banks|credit unions|institutions)/;

function parseMoney(text: string): number | null {
  const match = /\$([\d,]+(?:\.\d+)?)/.exec(text);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

/**
 * Pull the ranked lines of the position map (§ 02) out of a finished report: the
 * institution's published amount against the peer quartiles. Lines the report could
 * not rank (too few peers, fee not in the published schedule) are left out, exactly
 * as the report leaves them unranked.
 */
export function extractPositionMap(html: string): ReportPositionMap {
  const cohortMatch = COHORT_PATTERN.exec(html);
  const cohortSize = cohortMatch ? Number(cohortMatch[1]) : null;
  const table = POSITION_TABLE_PATTERN.exec(html);
  if (!table) return { rows: [], cohortSize };

  const rows: ReportPositionRow[] = [];
  for (const rowMatch of table[1].matchAll(POSITION_ROW_PATTERN)) {
    const cells = [...rowMatch[1].matchAll(POSITION_CELL_PATTERN)].map((m) => m[1]);
    if (cells.length < 7) continue;
    const categoryMatch = CATEGORY_PATTERN.exec(cells[0]);
    const percentileMatch = PERCENTILE_PATTERN.exec(decodeText(cells[6]));
    const you = parseMoney(cells[1]);
    const p25 = parseMoney(cells[2]);
    const median = parseMoney(cells[3]);
    const p75 = parseMoney(cells[4]);
    const peers = Number(decodeText(cells[5]));
    if (!categoryMatch || !percentileMatch || you === null || p25 === null || median === null || p75 === null) {
      continue;
    }
    rows.push({
      category: decodeText(categoryMatch[1]),
      you,
      p25,
      median,
      p75,
      peers: Number.isFinite(peers) ? peers : 0,
      percentile: Number(percentileMatch[1]),
      status: you > p75 ? "above" : you < p25 ? "below" : "inside",
    });
  }
  return { rows, cohortSize };
}
