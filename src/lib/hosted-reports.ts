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
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
  const map = options.map ?? (hostedReportMap as HostedReportMap);
  const entry = map[token];
  if (!entry) return null;
  if (isHostedReportExpired(entry, options.now)) return null;
  return { token, ...entry };
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
