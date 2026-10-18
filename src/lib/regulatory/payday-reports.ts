import { layoutPageText, type PdfTextItem } from "@/lib/agents/rosetta/pdf-layout";
import { findListLinks } from "./designation-lists";
import { publishedNumber, type AreaFetch, type AreaStat } from "./economy";

/**
 * State regulators' annual payday and small-dollar lending reports: the price of the
 * alternative to overdraft (average fee per loan, APR, loans per borrower, repeat borrowing),
 * one value per state and report year in area_statistics. Pure: reads PDF text, never writes.
 *
 * The reports are PDFs whose tables were not visible from the sandbox this was written in, so
 * nothing is read by position. Each metric is a labelled figure: a line whose label matches the
 * metric's pattern followed by exactly one number. A label found on two lines, a line carrying
 * several numbers (a table row across years or products), or no label at all leaves the metric
 * out and names it in the run detail. Nothing is derived (no average computed from totals).
 *
 * Wired: Washington DFI (annual payday lending report, linked from its reports page) and the
 * Texas OCCC credit access business annual report (file URLs confirmed by search). Not wired,
 * because no report file could be confirmed: California DFPI (deferred deposit transactions),
 * Florida OFR (deferred presentment), Colorado, Illinois and others.
 */

export interface PaydayReportSource {
  state: string;
  title: string;
  /** Page linking each year's report (searched for a PDF naming the year). */
  indexUrl: string | null;
  linkHint: RegExp;
  /** Report files by data year, confirmed by search; tried before the index page. */
  knownUrls: Record<string, string>;
  firstYear: number;
}

export const PAYDAY_REPORT_SOURCES: readonly PaydayReportSource[] = [
  {
    state: "WA",
    title: "Washington DFI payday lending report",
    indexUrl: "https://dfi.wa.gov/reports/payday-lending-reports",
    linkHint: /payday|pdl/i,
    knownUrls: {
      "2024": "https://dfi.wa.gov/sites/default/files/reports/2024-payday-loan-report.pdf",
      "2023": "https://dfi.wa.gov/sites/default/files/reports/2023-payday-lending-report.pdf",
      "2018": "https://dfi.wa.gov/sites/default/files/reports/2018-pdl-report.pdf",
    },
    firstYear: 2018,
  },
  {
    state: "TX",
    title: "Texas OCCC credit access business annual report",
    indexUrl: null,
    linkHint: /annual|cab/i,
    knownUrls: {
      "2025": "https://occc.texas.gov/wp-content/uploads/2026/03/2025_Annual_State.pdf",
      "2024": "https://occc.texas.gov/sites/default/files/2025-11/2024_Formatted_11.06.2025.pdf",
      "2023": "https://occc.texas.gov/sites/default/files/2024-05/2023_formatted.pdf",
      "2022": "https://occc.texas.gov/wp-content/uploads/2025/11/cab-annual-2022.pdf",
      "2020": "https://occc.texas.gov/sites/default/files/uploads/industry-reporting/cab-annual-2020.pdf",
      "2019": "https://occc.texas.gov/sites/default/files/uploads/reports/cab-annual-2019.pdf",
      "2018": "https://occc.texas.gov/sites/default/files/uploads/reports/cab-annual-2018.pdf",
    },
    firstYear: 2018,
  },
];

export function paydayPartitionKey(state: string, year: string | number): string {
  return `${state}-${year}`;
}

export function parsePaydayPartition(key: string): { source: PaydayReportSource; year: string } | null {
  const m = /^([A-Z]{2})-(\d{4})$/.exec(key);
  const source = m ? PAYDAY_REPORT_SOURCES.find((s) => s.state === m[1]) : undefined;
  return source && m ? { source, year: m[2] } : null;
}

/** Report years newest first: the last complete year back to the first year, per state. */
export function paydayPartitionKeys(now: Date): string[] {
  const out: string[] = [];
  for (let y = now.getUTCFullYear() - 1; y >= 2018; y -= 1) {
    for (const s of PAYDAY_REPORT_SOURCES) if (y >= s.firstYear) out.push(paydayPartitionKey(s.state, y));
  }
  return out;
}

/** The year's report among the index page's PDF links: exactly one link naming the year, else none. */
export function findPaydayReportLink(html: string, source: PaydayReportSource, year: string): string[] {
  if (!source.indexUrl) return [];
  return findListLinks(html, /href="([^"]+\.pdf(?:\?[^"]*)?)"/gi, source.indexUrl).filter((u) => {
    const name = decodeURIComponent(u.split("/").pop() ?? "");
    return source.linkHint.test(name) && (name.match(/20\d{2}/g) ?? ([] as string[])).includes(year);
  });
}

export interface PaydayMetric {
  key: string;
  label: RegExp;
  unit: "count" | "dollars" | "percent" | "ratio";
}

/** Labels from memory of how state reports word these figures; matched case-insensitively per line. */
export const PAYDAY_METRICS: readonly PaydayMetric[] = [
  { key: "payday_loans_made", label: /\b(total )?(number of )?(small |payday |deferred deposit )?loans (made|originated|issued)\b/i, unit: "count" },
  { key: "payday_loan_volume", label: /\btotal (dollar )?(amount|volume) of (small |payday |deferred deposit )?loans\b/i, unit: "dollars" },
  { key: "payday_avg_loan_amount", label: /\baverage (loan amount|amount (of|per) (a )?loan|loan size)\b/i, unit: "dollars" },
  { key: "payday_total_fees", label: /\btotal (fees|finance charges)( (collected|charged|paid))?\b/i, unit: "dollars" },
  { key: "payday_avg_fee_per_loan", label: /\baverage (fee|finance charge)s? (per|for each|on a) loan\b/i, unit: "dollars" },
  { key: "payday_avg_apr", label: /\baverage (annual percentage rate|apr)\b/i, unit: "percent" },
  { key: "payday_borrowers", label: /\b(number of|unique|total) (individual )?(borrowers|consumers)\b/i, unit: "count" },
  { key: "payday_loans_per_borrower", label: /\baverage (number of )?loans per (borrower|consumer)\b/i, unit: "ratio" },
  { key: "payday_repeat_borrower_share", label: /\b(percent|percentage|share) of (borrowers|consumers) (who|with|taking|that took) .*(more than one|repeat|multiple|two or more|\d+ or more) loans?\b/i, unit: "percent" },
];

const NUMBER = /\$?\s?-?\d[\d,]*(?:\.\d+)?\s?%?/g;

/** Numbers on a line after the label's end; years (1990-2039 standing alone) are not figures. */
export function figuresAfter(line: string, labelEnd: number): string[] {
  return (line.slice(labelEnd).match(NUMBER) ?? [])
    .map((s) => s.trim())
    .filter((s) => !/^(19[9]\d|20[0-3]\d)$/.test(s.replace(/[$%\s]/g, "")) || /[$%,.]/.test(s));
}

export interface PaydayRead {
  stats: AreaStat[];
  /** Metrics not found, ambiguous or unreadable, with why. */
  missing: Record<string, "not_found" | "label_on_several_lines" | "several_numbers_on_line" | "no_number_after_label" | "unreadable_number">;
}

/** Labelled figures from a report's text lines. */
export function readPaydayFigures(text: string, state: string, year: string, url: string | null): PaydayRead {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const stats: AreaStat[] = [];
  const missing: PaydayRead["missing"] = {};
  for (const metric of PAYDAY_METRICS) {
    const hits = lines.map((line) => ({ line, m: metric.label.exec(line) })).filter((h) => h.m);
    if (hits.length === 0) {
      missing[metric.key] = "not_found";
      continue;
    }
    if (hits.length > 1) {
      missing[metric.key] = "label_on_several_lines";
      continue;
    }
    const { line, m } = hits[0];
    const figures = figuresAfter(line, m!.index + m![0].length);
    if (figures.length === 0) {
      missing[metric.key] = "no_number_after_label";
      continue;
    }
    if (figures.length > 1) {
      missing[metric.key] = "several_numbers_on_line";
      continue;
    }
    const cell = figures[0];
    const value = publishedNumber(cell.replace(/[$%\s]/g, ""));
    if (value === null || (metric.unit === "percent" && !/%/.test(cell) && !/percent|apr/i.test(m![0]))) {
      missing[metric.key] = "unreadable_number";
      continue;
    }
    stats.push({
      geo_type: "state",
      geo_code: state,
      geo_name: null,
      state_code: state,
      period: year,
      series_key: metric.key,
      value,
      unit: metric.unit,
      note: null,
      raw: { line: line.slice(0, 300), figure: cell, url },
    });
  }
  return { stats, missing };
}

export function paydayFetch(read: PaydayRead, url: string | null): AreaFetch {
  const missingFields = Object.entries(read.missing).map(([k, why]) => `${k} (${why})`);
  return {
    url,
    rows: read.stats,
    missingFields,
    skipped: {},
    emptyReason: read.stats.length ? null : "No labelled figure could be read without ambiguity",
  };
}

/** PDF text with lines rebuilt from item positions (Rosetta's layout), so a label and its figure stay together. */
export async function paydayPdfText(bytes: Uint8Array, maxPages = 80): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const pages: string[] = [];
    const total = Math.min(Number(pdf.numPages ?? 0), maxPages);
    for (let p = 1; p <= total; p += 1) {
      const content = await (await pdf.getPage(p)).getTextContent();
      const items: PdfTextItem[] = [];
      for (const item of content.items) if ("str" in item) items.push(item as PdfTextItem);
      pages.push(layoutPageText(items));
    }
    return pages.join("\n");
  } finally {
    await pdf.destroy?.();
  }
}
