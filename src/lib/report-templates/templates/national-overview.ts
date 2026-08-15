/**
 * National Fee Index Overview Report Template
 *
 * Pure function: (data, narratives) => HTML per D-15.
 * No AI calls inside this template — narratives are pre-computed and injected.
 * Rigid section order enforces brand consistency per D-14.
 *
 * Section order (always, no exceptions):
 *   1. Cover page
 *   2. Executive Summary (Hamilton narrative — overview of findings)
 *   3. Page break
 *   4. National Index Table (Hamilton narrative + 49-category data table)
 *   5. Charter Analysis (Hamilton narrative — only when charter_split data exists)
 *   6. Methodology footnote
 */

import {
  wrapReport,
  coverPage,
  sectionHeader,
  dataTable,
  hamiltonNarrativeBlock,
  footnote,
  pageBreak,
} from "../index";
import type { NationalOverviewData, GenerateSectionOutput } from "../../hamilton/types";
import { HAMILTON_ATTRIBUTION, SITE_DOMAIN, SITE_NAME } from "@/lib/constants";

export interface NationalOverviewReportInput {
  data: NationalOverviewData;
  narratives: {
    executive_summary: GenerateSectionOutput;
    national_index: GenerateSectionOutput;
    /** Optional — only populated when charter_split data exists in the source */
    charter_analysis?: GenerateSectionOutput;
  };
}

const NATIONAL_TABLE_COLUMNS = [
  { key: "display_name", label: "Fee Category", align: "left" as const },
  { key: "median_amount", label: "Median", align: "right" as const, format: "amount" as const },
  { key: "p25_amount", label: "P25", align: "right" as const, format: "amount" as const },
  { key: "p75_amount", label: "P75", align: "right" as const, format: "amount" as const },
  { key: "institution_count", label: "Institutions", align: "right" as const, format: "integer" as const },
  { key: "observation_count", label: "Observations", align: "right" as const, format: "integer" as const },
  { key: "maturity", label: "Maturity", align: "left" as const },
];

type NationalCategoryRow = NationalOverviewData["categories"][number];

function toNationalTableRow(c: NationalCategoryRow): Record<string, string | number | null> {
  return {
    display_name: c.display_name,
    median_amount: c.median_amount,
    p25_amount: c.p25_amount,
    p75_amount: c.p75_amount,
    institution_count: c.institution_count,
    observation_count: c.observation_count,
    maturity: c.maturity,
  };
}

export function renderNationalOverviewReport(input: NationalOverviewReportInput): string {
  const { data, narratives } = input;

  // Section 1: Cover page
  const cover = coverPage({
    title: "National Fee Index",
    subtitle: `Full Fee Catalog — ${data.total_institutions.toLocaleString()} Institutions`,
    report_date: new Date(data.report_date).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    }),
    series: "National Quarterly Report",
  });

  // Section 2: Executive Summary (Hamilton narrative, no table)
  const execSummary = [
    sectionHeader({
      label: "Executive Summary",
      title: "National Fee Landscape — Key Findings",
    }),
    hamiltonNarrativeBlock(narratives.executive_summary.narrative),
  ].join("\n");

  // Section 3: Page break before data-heavy sections
  const break1 = pageBreak();

  // Section 4: National Index Table — Hamilton narrative + full 49-category table
  const nationalTable = [
    sectionHeader({
      label: "National Fee Index",
      title: "49-Category Benchmark — Medians, Distributions, Coverage",
    }),
    hamiltonNarrativeBlock(narratives.national_index.narrative),
    dataTable({
      columns: NATIONAL_TABLE_COLUMNS,
      rows: data.categories.map(toNationalTableRow),
      caption: `${data.total_institutions.toLocaleString()} institutions — as of ${data.report_date}`,
    }),
  ].join("\n");

  // Section 5: Charter Analysis — only when charter_split data and narrative both exist
  const charterSection =
    data.charter_split && narratives.charter_analysis
      ? [
          sectionHeader({
            label: "Charter Analysis",
            title: "Banks vs. Credit Unions — Fee Philosophy Diverges",
          }),
          hamiltonNarrativeBlock(narratives.charter_analysis.narrative),
        ].join("\n")
      : "";

  // Section 6: Methodology footnote
  const methodologyText = [
    `National median computed from all non-rejected fee observations in the Bank Fee Index.`,
    `Maturity: "strong" = 10+ approved observations; "provisional" = 10+ total observations; "insufficient" = below threshold.`,
    `Data includes approved, staged, and pending observations.`,
    `${SITE_NAME} — ${SITE_DOMAIN} — Generated ${data.report_date}`,
  ].join(" ");

  const body = [
    cover,
    execSummary,
    break1,
    nationalTable,
    charterSection,
    footnote(methodologyText),
  ]
    .filter(Boolean)
    .join("\n\n");

  return wrapReport(body, {
    title: "National Fee Index",
    author: HAMILTON_ATTRIBUTION,
    date: data.report_date,
  });
}
