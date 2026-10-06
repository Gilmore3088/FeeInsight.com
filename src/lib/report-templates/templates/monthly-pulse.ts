/**
 * Monthly Pulse Report — HTML Template
 *
 * Pure function: (payload, narratives) => HTML string.
 * No async, no AI calls — narratives are pre-computed and injected (D-11).
 *
 * Rigid section order (never reorder):
 *   1. Cover page
 *   2. Pulse Overview — Hamilton narrative (1-2 paragraphs, 250-word max per D-09)
 *   3. Movers Up table — conditional on movers_up.length > 0
 *   4. Movers Down table — conditional on movers_down.length > 0
 *   5. No-movement notice — when both movers lists are empty
 *   6. Methodology footnote
 *
 * Sections flow without forced page breaks so no page is left mostly blank; each
 * section heading stays with its table (print rules in base/styles.ts).
 */

import {
  wrapReport,
  coverPage,
  sectionHeader,
  dataTable,
  hamiltonNarrativeBlock,
  footnote,
} from "../index";
import type { MonthlyPulsePayload, PulseMover } from "../../report-assemblers/monthly-pulse";
import type { GenerateSectionOutput } from "../../hamilton/types";
import { HAMILTON_ATTRIBUTION, SITE_DOMAIN, SITE_NAME } from "@/lib/constants";

// ─── Input Type ────────────────────────────────────────────────────────────────

export interface MonthlyPulseReportInput {
  data: MonthlyPulsePayload;
  narratives: {
    /** 1-2 paragraphs only — Hamilton prompt must enforce 250-word max (D-09) */
    pulse_overview: GenerateSectionOutput;
  };
}

// ─── Table Column Definitions ──────────────────────────────────────────────────

const MOVERS_COLUMNS = [
  { key: "display_name", label: "Fee Category", align: "left" as const },
  { key: "current_median", label: "Current Median", align: "right" as const, format: "amount" as const },
  { key: "prior_median", label: "Prior Median", align: "right" as const, format: "amount" as const },
  { key: "change_pct", label: "Change", align: "right" as const, format: "percent" as const },
  { key: "current_institution_count", label: "Institutions", align: "right" as const, format: "integer" as const },
];

// ─── Row Converter ─────────────────────────────────────────────────────────────

function toMoverRow(m: PulseMover): Record<string, string | number | null> {
  return {
    display_name: m.display_name,
    current_median: m.current_median,
    prior_median: m.prior_median,
    change_pct: m.change_pct,
    current_institution_count: m.current_institution_count,
  };
}

// ─── Renderer ──────────────────────────────────────────────────────────────────

export function renderMonthlyPulseReport(input: MonthlyPulseReportInput): string {
  const { data, narratives } = input;
  const totalMovers = data.movers_up.length + data.movers_down.length;
  const hasMoversUp = data.movers_up.length > 0;
  const hasMoversDown = data.movers_down.length > 0;

  // Section 1: Cover page
  const cover = coverPage({
    title: "Monthly Fee Pulse",
    subtitle: `Market movement \u2014 ${data.period_label}`,
    report_date: new Date(data.report_date).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    series: "Monthly Pulse Report",
  });

  // Section 2: Pulse Overview — Hamilton narrative
  const overviewSection = [
    sectionHeader({
      label: "Monthly Movement",
      title: `Fee Markets in ${data.period_label}: ${totalMovers} ${totalMovers === 1 ? "Category" : "Categories"} Moved`,
    }),
    hamiltonNarrativeBlock(narratives.pulse_overview.narrative),
  ].join("\n");

  // Section 3: Movers Up — conditional
  const moversUpSection = hasMoversUp
    ? [
        sectionHeader({
          label: "Upward Movement",
          title: "Categories Moving Above Prior Month",
        }),
        dataTable({
          columns: MOVERS_COLUMNS,
          rows: data.movers_up.map(toMoverRow),
          caption: `${data.movers_up.length} ${data.movers_up.length === 1 ? "category" : "categories"} exceeded +5% threshold`,
        }),
      ].join("\n")
    : "";

  // Section 4: Movers Down — conditional
  const moversDownSection = hasMoversDown
    ? [
        sectionHeader({
          label: "Downward Movement",
          title: "Categories Moving Below Prior Month",
        }),
        dataTable({
          columns: MOVERS_COLUMNS,
          rows: data.movers_down.map(toMoverRow),
          caption: `${data.movers_down.length} ${data.movers_down.length === 1 ? "category" : "categories"} exceeded \u22125% threshold`,
        }),
      ].join("\n")
    : "";

  // Section 5: No-movement notice — when both lists are empty
  const stableMarketNotice =
    !hasMoversUp && !hasMoversDown
      ? `<p class="report-narrative">No fee categories exceeded the 5% movement threshold this period. The market is stable.</p>`
      : "";

  // Section 6: Methodology footnote
  const methodologyText = [
    "Movement computed by comparing current median to prior cached index snapshot.",
    "Categories shown only when change exceeds \u00b15% threshold.",
    "Medians from all non-rejected fee observations in the Bank Fee Index pipeline.",
    `${SITE_NAME} — ${SITE_DOMAIN} — Generated ${data.report_date}`,
  ].join(" ");

  const body = [
    cover,
    overviewSection,
    moversUpSection,
    moversDownSection,
    stableMarketNotice,
    footnote(methodologyText),
  ]
    .filter(Boolean)
    .join("\n\n");

  return wrapReport(body, {
    title: `Monthly Fee Pulse \u2014 ${data.period_label}`,
    author: HAMILTON_ATTRIBUTION,
    date: data.report_date,
  });
}
