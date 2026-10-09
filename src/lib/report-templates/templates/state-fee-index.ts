/**
 * State Index Report — HTML Template
 *
 * Pure function: (StateReportData) => HTML string. Mirrors the approved public state report
 * (/research/state/[code]) for print: key findings, everyday fee ranges against national,
 * position against national, banks against credit unions, coverage, the full table and a
 * source line. No model calls and no written narrative: every number comes from
 * buildStateReportData, and a section with no data says so instead of showing anything.
 */

import {
  wrapReport,
  coverPage,
  reportSection,
  figureFindings,
  emptyNotice,
  dataTable,
  compactTable,
  comparisonChart,
  statCardRow,
  footnote,
  escapeHtml,
} from "../primitives";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { HAMILTON_ATTRIBUTION, PRODUCT_NAME, SITE_DOMAIN, SITE_NAME } from "@/lib/constants";
import type { StateReportData } from "@/lib/research-report/state-report-data";
import type { DevelopmentsBlock, FeeChangesBlock, StateRegulatorRef } from "@/lib/report-assemblers/developments";
import { feeChangesContent, stateDevelopmentsContent } from "./developments";
import {
  charterExhibit,
  countyMapSection,
  economySection,
  feeLadderSection,
  holdersSection,
  type StateReportVisuals,
} from "./state-exhibits";
import { regulatoryExtras } from "./regulatory-section";
import type { StateNews } from "@/lib/data-store/state-news";
import type { RegulatoryContext } from "@/lib/report-assemblers/regulatory-context";
import {
  POSITION_AXIS_MAX_PCT,
  STATE_FINDING_MIN_INSTITUTIONS,
  formatDelta,
  positionAxis,
  type StateComparison,
} from "@/lib/research-report/state-findings";

export interface StateFeeIndexReportInput {
  data: StateReportData;
  /** ISO date (YYYY-MM-DD) the report was generated. */
  generatedAt: string;
  /**
   * Fee changes and agency releases for the report window. Left out (no sections) when
   * not loaded; a field that is null means its read failed, and the section says so.
   */
  context?: {
    feeChanges: FeeChangesBlock | null;
    developments: DevelopmentsBlock | null;
    regulator: StateRegulatorRef | null;
    /** CFPB complaints, fee-change rules and the district's Beige Book line. */
    regulatory?: RegulatoryContext | null;
    /** The state's regulator posts, fee bills and press coverage; absent means not read. */
    stateNews?: StateNews | null;
  };
  /** County map, fee ladder, deposit holders and economy. Left out (no sections) when not loaded. */
  visuals?: StateReportVisuals;
}

/** Differences under this (in percent) read as "in line", as on the public page. */
const IN_LINE_PCT = 1;

function longDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function range(p25: number | null, p75: number | null): string {
  return p25 != null && p75 != null ? `${formatAmount(p25)} to ${formatAmount(p75)}` : "Not available";
}

function vsNational(delta: number | null): string {
  if (delta == null) return "No national median";
  return Math.abs(delta) < IN_LINE_PCT ? "in line" : formatDelta(delta);
}

function formatCount(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString("en-US");
}

function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

function source(asOf: string | null, text: string): string {
  const date = asOf ? ` Data as of ${asOf}.` : "";
  return `<div class="exhibit-source">${escapeHtml(text + date)}</div>`;
}

// ─── Sections ──────────────────────────────────────────────────────────────────

function findingsSection(data: StateReportData): string {
  const content =
    data.findings.length > 0
      ? figureFindings(data.findings)
      : emptyNotice(
          `Not enough ${data.stateName} institutions have verified fees yet for a headline finding. A finding needs at least ${STATE_FINDING_MIN_INSTITUTIONS} institutions behind the state median.`,
        );
  return reportSection(
    { label: "Key findings", title: `What ${data.stateName} institutions charge` },
    content + source(data.asOf, `Each finding counts fees with at least ${STATE_FINDING_MIN_INSTITUTIONS} ${data.stateName} institutions behind the median.`),
    "findings",
  );
}

function everydaySection(data: StateReportData, label: string): string {
  const rows = data.everyday.map((r) => ({
    fee: `${getDisplayName(r.fee_category)}${r.institution_count < STATE_FINDING_MIN_INSTITUTIONS ? " (small sample)" : ""}`,
    state_median: formatAmount(r.median_amount),
    state_range: range(r.p25_amount, r.p75_amount),
    national_median: r.national_median != null ? formatAmount(r.national_median) : "Not available",
    national_range: range(r.national_p25, r.national_p75),
    institutions: formatCount(r.institution_count),
  }));
  const content =
    rows.length > 0
      ? dataTable({
          columns: [
            { key: "fee", label: "Fee" },
            { key: "state_median", label: `${data.stateName} median`, align: "right" },
            { key: "state_range", label: `${data.stateName} middle half`, align: "right" },
            { key: "national_median", label: "National median", align: "right" },
            { key: "national_range", label: "National middle half", align: "right" },
            { key: "institutions", label: "Institutions", align: "right" },
          ],
          rows,
        })
      : emptyNotice(
          `Not enough ${data.stateName} institutions have verified everyday fees yet for a state median. Coverage grows with every monthly pass.`,
        );
  return reportSection(
    {
      label,
      title: `${data.stateName} against the national benchmark`,
      subheading: "The median, and the middle half of prices (25th to 75th percentile), in the state and nationally.",
    },
    content +
      source(
        data.asOf,
        `One value per institution; a state median needs at least 5 institutions. "Small sample" marks fewer than ${STATE_FINDING_MIN_INSTITUTIONS}.`,
      ),
    "benchmarks",
  );
}

function positionRow(r: StateComparison, axis: number): string {
  const d = r.delta_pct!;
  const inLine = Math.abs(d) < IN_LINE_PCT;
  const width = (Math.min(Math.abs(d), axis) / axis) * 50;
  const bar = inLine
    ? `<div class="position-dot"></div>`
    : `<div class="position-bar ${d > 0 ? "position-bar-up" : "position-bar-down"}" style="width:${width.toFixed(1)}%;"></div>`;
  const tone = inLine ? "position-flat" : d > 0 ? "position-up" : "position-down";
  const small = r.institution_count < STATE_FINDING_MIN_INSTITUTIONS ? ` <span class="position-small">small sample</span>` : "";
  return `
  <div class="position-row">
    <div class="position-label">${escapeHtml(getDisplayName(r.fee_category))}${small}</div>
    <div class="position-track"><div class="position-axis"></div>${bar}</div>
    <div class="position-value"><span class="${tone}">${escapeHtml(vsNational(d))}</span> · ${escapeHtml(formatAmount(r.median_amount))} vs ${escapeHtml(formatAmount(r.national_median))}</div>
  </div>`;
}

function positionSection(data: StateReportData, label: string): string {
  const rows = data.comparisons.filter((r) => r.delta_pct != null).sort((a, b) => b.delta_pct! - a.delta_pct!);
  if (rows.length === 0) {
    return reportSection(
      { label, title: `${data.stateName} against national medians` },
      emptyNotice(`No ${data.stateName} fee has both a state median and a national median yet, so there is nothing to compare.`),
      "position",
    );
  }
  const above = rows.filter((r) => r.delta_pct! >= IN_LINE_PCT).length;
  const below = rows.filter((r) => r.delta_pct! <= -IN_LINE_PCT).length;
  const axis = positionAxis(rows.map((r) => r.delta_pct!));
  const chart = `
<div class="position-chart">${rows.map((r) => positionRow(r, axis)).join("")}
  <div class="position-scale">
    <span></span>
    <span class="position-scale-axis"><span>Lower (−${axis}%)</span><span>National</span><span>Higher (+${axis}%)</span></span>
    <span></span>
  </div>
</div>`;
  return reportSection(
    {
      label,
      title: `${plural(above, "fee", "fees")} above national, ${formatCount(below)} below`,
      subheading: `Each bar is the ${data.stateName} median relative to the national median for the same fee.`,
    },
    chart +
      source(
        data.asOf,
        `Percent difference between the ${data.stateName} median and the national median. Gaps beyond ${POSITION_AXIS_MAX_PCT}% are pinned to the edge; differences under ${IN_LINE_PCT}% count as in line.`,
      ),
    "position",
  );
}

function charterSection(data: StateReportData, label: string, designed: boolean): string {
  const pairs = data.charterPairs;
  if (pairs.length === 0) {
    return reportSection(
      { label, title: `${data.stateName} banks and credit unions` },
      emptyNotice(
        `Too few ${data.stateName} banks and credit unions publish the same fees yet for a charter comparison. A comparison needs a median for both charters.`,
      ),
      "charters",
    );
  }
  const cuCheaper = pairs.filter((p) => p.cu_median_amount! < p.bank_median_amount!).length;
  const chart = (designed ? charterExhibit(data) : null) ?? comparisonChart({
    bars: pairs.map((p) => ({
      label: getDisplayName(p.fee_category),
      leftValue: p.bank_median_amount!,
      rightValue: p.cu_median_amount!,
      leftDisplay: formatAmount(p.bank_median_amount),
      rightDisplay: formatAmount(p.cu_median_amount),
    })),
    leftLabel: "Banks",
    rightLabel: "Credit unions",
    title: `Median fee by charter, ${data.stateName}`,
  });
  return reportSection(
    {
      label,
      title: `${data.stateName} credit unions are lower on ${formatCount(cuCheaper)} of ${plural(pairs.length, "fee", "fees")}`,
      subheading: `Median price at ${data.stateName} banks and at ${data.stateName} credit unions for each fee where both charters have a median.`,
    },
    chart + source(data.asOf, "One value per institution; each charter median needs at least 5 institutions."),
    "charters",
  );
}

function coverageSection(data: StateReportData): string {
  const { monitored, verified } = data;
  const district = data.district != null && DISTRICT_NAMES[data.district] ? ` ${data.stateName} is in the ${DISTRICT_NAMES[data.district]} Federal Reserve district.` : "";
  return reportSection(
    { label: "Coverage", title: "Who is in the data" },
    statCardRow([
      { label: "Banks with verified fees", value: formatCount(verified.banks), source: `of ${formatCount(monitored.banks)} monitored` },
      {
        label: "Credit unions with verified fees",
        value: formatCount(verified.credit_unions),
        source: `of ${formatCount(monitored.credit_unions)} monitored`,
      },
      { label: "Verified fees", value: formatCount(verified.fees), source: `at ${plural(verified.institutions, "institution", "institutions")}` },
    ]) +
      source(
        data.asOf,
        `Monitored institutions are FDIC-insured banks and NCUA-insured credit unions headquartered in ${data.stateName}.${district}`,
      ),
    "coverage",
  );
}

function fullTableSection(data: StateReportData): string {
  if (data.comparisons.length === 0) return "";
  const hidden =
    data.hiddenCategoryCount > 0
      ? ` This report lists featured fees; ${plural(data.hiddenCategoryCount, "more category has", "more categories have")} a ${data.stateName} median in Hamilton Pro.`
      : "";
  return reportSection(
    { label: "Appendix · Full benchmark table", title: `Every fee with a ${data.stateName} median` },
    compactTable({
      columns: [
        { key: "fee", label: "Fee" },
        { key: "median", label: `${data.stateName} median`, align: "right" },
        { key: "range", label: "Middle half", align: "right" },
        { key: "national", label: "National median", align: "right" },
        { key: "delta", label: "vs national", align: "right" },
        { key: "n", label: "Institutions", align: "right" },
      ],
      rows: data.comparisons.map((r) => ({
        fee: getDisplayName(r.fee_category),
        median: formatAmount(r.median_amount),
        range: range(r.p25_amount, r.p75_amount),
        national: r.national_median != null ? formatAmount(r.national_median) : "Not available",
        delta: vsNational(r.delta_pct),
        n: formatCount(r.institution_count),
      })),
    }) + source(data.asOf, `Median and 25th to 75th percentile of one value per institution.${hidden}`),
    "table",
  );
}

function methodologyLine(data: StateReportData, generatedAt: string): string {
  const { monitored, verified } = data;
  return [
    `Source: live verified fees from the ${PRODUCT_NAME} (published_fee_catalog), ${data.asOf ? `as of ${data.asOf}` : "refresh date not available"}.`,
    `${plural(verified.institutions, "institution", "institutions")} of ${formatCount(monitored.institutions)} monitored in ${data.stateName} have verified fees (${formatCount(verified.banks)} banks, ${formatCount(verified.credit_unions)} credit unions; ${plural(verified.fees, "fee", "fees")}).`,
    `Each institution counts once per fee. A median needs at least 5 institutions; a headline finding needs at least ${STATE_FINDING_MIN_INSTITUTIONS}.`,
    `National figures are the same statistic over every institution in the ${PRODUCT_NAME}.`,
    `Every figure is computed from the data; no text in this report is model-written.`,
    `${SITE_NAME}, ${SITE_DOMAIN}. Generated ${generatedAt}.`,
  ].join(" ");
}

function changesSection(data: StateReportData, context: NonNullable<StateFeeIndexReportInput["context"]>): string {
  return reportSection(
    { label: "Fee changes", title: `Price changes at ${data.stateName} institutions` },
    feeChangesContent(context.feeChanges, { stateCode: data.stateCode, label: data.stateName }),
  );
}

function developmentsSection(
  data: StateReportData,
  context: NonNullable<StateFeeIndexReportInput["context"]>,
  generatedAt: string,
): string {
  return reportSection(
    { label: "Regulatory developments", title: `Regulation and supervision affecting ${data.stateName} institutions` },
    [
      stateDevelopmentsContent(context.developments, data.stateName, context.regulator, generatedAt, context.stateNews),
      regulatoryExtras(context.regulatory, data.stateName),
    ].join("\n"),
  );
}

// ─── Renderer ──────────────────────────────────────────────────────────────────

export function renderStateFeeIndexReport(input: StateFeeIndexReportInput): string {
  const { data, generatedAt, context } = input;
  const title = `${data.stateName} Bank and Credit Union Fees`;

  const cover = coverPage({
    title,
    subtitle:
      data.verified.institutions > 0
        ? `What ${plural(data.verified.institutions, "institution", "institutions")} with verified fee schedules charge, compared with the national ${PRODUCT_NAME}`
        : `No ${data.stateName} institution has verified fees in the ${PRODUCT_NAME} yet`,
    report_date: longDate(generatedAt),
    series: `${PRODUCT_NAME} · State Report · ${data.stateCode}`,
  });

  let exhibits = 0;
  const label = (name: string) => `Exhibit ${++exhibits} · ${name}`;
  const visuals = input.visuals;

  const body = [
    cover,
    findingsSection(data),
    visuals ? countyMapSection(data, visuals, label("Overdraft by county")) : "",
    everydaySection(data, label("Everyday fees")),
    visuals ? feeLadderSection(data, visuals, label("Every institution")) : "",
    positionSection(data, label("Position vs national")),
    charterSection(data, label("Banks vs credit unions"), Boolean(visuals)),
    visuals ? holdersSection(data, visuals, label("Deposit holders")) : "",
    visuals ? economySection(data, visuals, label("Economy")) : "",
    context ? changesSection(data, context) : "",
    context ? developmentsSection(data, context, generatedAt) : "",
    coverageSection(data),
    fullTableSection(data),
    footnote(methodologyLine(data, generatedAt)),
  ]
    .filter(Boolean)
    .join("\n\n");

  return wrapReport(body, { title, author: HAMILTON_ATTRIBUTION, date: generatedAt });
}
