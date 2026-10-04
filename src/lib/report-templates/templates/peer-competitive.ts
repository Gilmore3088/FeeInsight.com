/**
 * Peer Competitive Benchmarking Report Template
 *
 * Pure function: (data, narratives) => HTML per D-15.
 * No AI calls inside this template — narratives are pre-computed and injected.
 * Rigid section order enforces brand consistency per D-14.
 *
 * Section order (always, no exceptions):
 *   1. Cover page
 *   2. Executive Summary (Hamilton narrative, no table)
 *   3. Page break
 *   4. Featured Fees (Hamilton narrative + data table)
 *   5. Extended Fees (data table only — efficiency, no Hamilton call)
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
import type { PeerCompetitiveData, GenerateSectionOutput } from "../../hamilton/types";
import { HAMILTON_ATTRIBUTION, SITE_DOMAIN, SITE_NAME } from "@/lib/constants";

export interface PeerCompetitiveReportInput {
  data: PeerCompetitiveData;
  /**
   * Pre-generated Hamilton narratives.
   * Caller runs generateSection() before calling this template.
   * Template is pure: (data, narratives) => HTML per D-15.
   */
  narratives: {
    executive_summary: GenerateSectionOutput;
    featured_fees: GenerateSectionOutput;
  };
}

const FEATURED_TABLE_COLUMNS = [
  { key: "display_name", label: "Fee Category", align: "left" as const },
  { key: "peer_median", label: "Peer Median", align: "right" as const, format: "amount" as const },
  { key: "p25_amount", label: "P25", align: "right" as const, format: "amount" as const },
  { key: "p75_amount", label: "P75", align: "right" as const, format: "amount" as const },
  { key: "national_median", label: "National", align: "right" as const, format: "amount" as const },
  { key: "delta_pct", label: "Delta", align: "right" as const, format: "percent" as const },
  { key: "peer_count", label: "n", align: "right" as const, format: "integer" as const },
];

type CategoryRow = PeerCompetitiveData["categories"][number];

function toTableRow(c: CategoryRow): Record<string, string | number | null> {
  return {
    display_name: c.display_name,
    peer_median: c.peer_median,
    p25_amount: c.p25_amount,
    p75_amount: c.p75_amount,
    national_median: c.national_median,
    delta_pct: c.delta_pct,
    peer_count: c.peer_count,
  };
}

export function renderPeerCompetitiveReport(input: PeerCompetitiveReportInput): string {
  const { data, narratives } = input;

  const featuredCategories = data.categories.filter((c) => c.is_featured);
  const extendedCategories = data.categories.filter((c) => !c.is_featured);

  // Section 1: Cover page
  const cover = coverPage({
    title: data.title,
    subtitle: data.subtitle,
    report_date: new Date(data.report_date).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    series: "Peer Competitive Intelligence",
  });

  // Section 2: Executive Summary (Hamilton narrative, no table)
  const execSummary = [
    sectionHeader({
      label: "Executive Summary",
      title: "Competitive Fee Position at a Glance",
    }),
    hamiltonNarrativeBlock(narratives.executive_summary.narrative),
  ].join("\n");

  // Section 3: Page break before data-heavy sections
  const break1 = pageBreak();

  // Section 4: Featured Fees — Hamilton narrative + data table
  const observationCaption = `${data.total_peer_institutions.toLocaleString()} peer institutions — ${data.total_observations.toLocaleString()} observations`;

  const featuredSection = [
    sectionHeader({
      label: "Featured Fees",
      title: "Core Fee Comparison — Peer vs. National Benchmark",
    }),
    hamiltonNarrativeBlock(narratives.featured_fees.narrative),
    dataTable({
      columns: FEATURED_TABLE_COLUMNS,
      rows: featuredCategories.map(toTableRow),
      caption: observationCaption,
    }),
  ].join("\n");

  // Section 5: Extended fees — data table only (no Hamilton call for efficiency)
  const extendedSection =
    extendedCategories.length > 0
      ? [
          sectionHeader({
            label: "Extended Coverage",
            title: "Full Fee Schedule — Category Breakdown",
          }),
          dataTable({
            columns: FEATURED_TABLE_COLUMNS,
            rows: extendedCategories.map(toTableRow),
            caption:
              "Extended fee categories — smaller peer samples may limit statistical confidence",
          }),
        ].join("\n")
      : "";

  // Section 6: Methodology footnote
  const methodologyText = [
    `Peer median computed from ${data.total_observations.toLocaleString()} fee observations across`,
    `${data.total_peer_institutions.toLocaleString()} institutions matching the selected segment filters.`,
    `National median includes all tracked institutions regardless of segment.`,
    `Delta represents the percentage difference between peer and national medians.`,
    `Data includes approved, staged, and pending observations with maturity classification.`,
    `${SITE_NAME} — ${SITE_DOMAIN} — Generated ${data.report_date}`,
  ].join(" ");

  const body = [cover, execSummary, break1, featuredSection, extendedSection, footnote(methodologyText)]
    .filter(Boolean)
    .join("\n\n");

  return wrapReport(body, {
    title: data.title,
    author: HAMILTON_ATTRIBUTION,
    date: data.report_date,
  });
}
