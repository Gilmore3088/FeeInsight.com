/**
 * State Fee Index Report — HTML template.
 *
 * Every figure comes from the state payload (the same reads as the public state
 * research page). Sections with no data are left out rather than shown empty.
 */

import {
  wrapReport,
  coverPage,
  chapterDivider,
  insightCardRow,
  numberedFindings,
  compactTable,
  comparisonChart,
  footnote,
  pageBreak,
} from "../index";
import type { InsightCardProps } from "../index";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { SITE_DOMAIN, SITE_NAME } from "@/lib/constants";
import type { StateIndexPayload } from "@/lib/report-assemblers/state-index";
import { renderRegulatorySection } from "./regulatory-section";
import { formatDelta, STATE_FINDING_MIN_INSTITUTIONS } from "@/app/(public)/research/state/[code]/state-findings";

export interface StateFeeIndexReportInput {
  payload: StateIndexPayload;
  generatedAt: string;
}

/** Fees shown in the position table: the ones with the most institutions behind them. */
const POSITION_ROWS = 15;
/** Charter pairs shown in the bank vs credit union chart. */
const CHARTER_ROWS = 10;

function figures(p: StateIndexPayload): InsightCardProps[] {
  const overdraft = p.comparisons.find((c) => c.fee_category === "overdraft");
  const cards: InsightCardProps[] = [
    {
      number: p.stats.institution_count.toLocaleString("en-US"),
      insight: "Institutions monitored",
      supporting: `${p.stats.bank_count.toLocaleString("en-US")} banks and ${p.stats.cu_count.toLocaleString("en-US")} credit unions headquartered in ${p.stateName}.`,
    },
    {
      number: p.verifiedInstitutions.toLocaleString("en-US"),
      insight: "With a verified fee schedule",
      supporting: `${p.verifiedFees.toLocaleString("en-US")} published fees behind the medians in this report.`,
    },
    {
      number: String(p.comparisons.length),
      insight: "Fee categories with a state median",
      supporting: "Each median follows the same statistics contract as the national index.",
    },
  ];
  if (overdraft) {
    cards.push({
      number: formatAmount(overdraft.median_amount),
      insight: "Median overdraft fee",
      supporting: `Across ${overdraft.institution_count} institutions; national median ${formatAmount(overdraft.national_median)}.`,
    });
  }
  return cards;
}

function positionSection(p: StateIndexPayload): string {
  const rows = p.comparisons.slice(0, POSITION_ROWS).map((c) => ({
    fee: getDisplayName(c.fee_category),
    state: formatAmount(c.median_amount),
    national: formatAmount(c.national_median),
    delta: c.delta_pct == null ? "-" : formatDelta(c.delta_pct),
    institutions: c.institution_count,
  }));
  if (rows.length === 0) return "";
  return [
    pageBreak(),
    chapterDivider("01", `Where ${p.stateName} Sits Against National`),
    compactTable({
      caption: `${p.stateName} median vs national median, most-reported fees first`,
      columns: [
        { key: "fee", label: "Fee", align: "left" },
        { key: "state", label: p.stateCode, align: "right" },
        { key: "national", label: "National", align: "right" },
        { key: "delta", label: "Difference", align: "right" },
        { key: "institutions", label: "Institutions", align: "right", format: "integer" },
      ],
      rows,
    }),
  ].join("\n");
}

function charterSection(p: StateIndexPayload): string {
  const bars = p.charterPairs.slice(0, CHARTER_ROWS).map((pair) => ({
    label: getDisplayName(pair.fee_category),
    leftValue: pair.bank_median_amount ?? 0,
    rightValue: pair.cu_median_amount ?? 0,
    leftDisplay: formatAmount(pair.bank_median_amount),
    rightDisplay: formatAmount(pair.cu_median_amount),
  }));
  if (bars.length === 0) return "";
  return [
    chapterDivider("02", "Banks and Credit Unions"),
    comparisonChart({
      bars,
      leftLabel: "Banks",
      rightLabel: "Credit unions",
      title: `${p.stateName} medians by charter, fees where both charters have a median`,
      source: `${p.verifiedBankInstitutions} banks and ${p.verifiedCuInstitutions} credit unions with verified schedules`,
    }),
  ].join("\n");
}

function fullIndexSection(p: StateIndexPayload): string {
  if (p.comparisons.length <= POSITION_ROWS) return "";
  return [
    pageBreak(),
    chapterDivider("A", "Full Category Index"),
    compactTable({
      columns: [
        { key: "fee", label: "Fee", align: "left" },
        { key: "p25", label: "P25", align: "right" },
        { key: "median", label: "Median", align: "right" },
        { key: "p75", label: "P75", align: "right" },
        { key: "national", label: "National", align: "right" },
        { key: "institutions", label: "Institutions", align: "right", format: "integer" },
      ],
      rows: p.comparisons.map((c) => ({
        fee: getDisplayName(c.fee_category),
        p25: formatAmount(c.p25_amount),
        median: formatAmount(c.median_amount),
        p75: formatAmount(c.p75_amount),
        national: formatAmount(c.national_median),
        institutions: c.institution_count,
      })),
    }),
  ].join("\n");
}

export function renderStateFeeIndexReport(input: StateFeeIndexReportInput): string {
  const { payload: p, generatedAt } = input;
  const title = `${p.stateName} Fee Index`;
  const district = p.district
    ? `Federal Reserve District ${p.district}${p.districtName ? ` (${p.districtName})` : ""}`
    : null;

  const findings = p.findings.map((f, i) => ({
    number: String(i + 1).padStart(2, "0"),
    title: `${f.figure} — ${f.headline}`,
    detail: f.detail,
  }));

  const body = [
    coverPage({
      title,
      subtitle: `${p.stateName} fees against the national index${district ? `, ${district}` : ""}`,
      report_date: generatedAt,
      series: `State Fee Index — ${p.stateCode}`,
    }),
    chapterDivider("", `${p.stateName} in Figures`),
    insightCardRow(figures(p)),
    findings.length > 0 ? numberedFindings(findings) : "",
    positionSection(p),
    charterSection(p),
    renderRegulatorySection(p.regulatory, { number: "03", place: p.stateName }),
    fullIndexSection(p),
    footnote(
      [
        `Medians come from published, verified fee schedules of institutions headquartered in ${p.stateName}.`,
        `A finding is stated only when at least ${STATE_FINDING_MIN_INSTITUTIONS} institutions stand behind the state median.`,
        `National medians are the ${SITE_NAME} national index on the same date.`,
        `${SITE_NAME} — ${SITE_DOMAIN} — Generated ${generatedAt}`,
      ].join(" "),
    ),
  ]
    .filter(Boolean)
    .join("\n");

  return wrapReport(body, { title, date: generatedAt });
}
