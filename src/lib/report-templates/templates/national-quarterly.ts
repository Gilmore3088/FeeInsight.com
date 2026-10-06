/**
 * National Quarterly Report — HTML Template (V3 Strategic Intelligence)
 *
 * Pure function: (input) => HTML string.
 * No async, no AI calls — narratives are pre-computed and injected.
 *
 * Chapter structure:
 *   Cover -> TOC -> The Quarter in Figures ->
 *   Ch1: Where Prices Cluster and Where They Spread ->
 *   Ch2: Banks and Credit Unions ->
 *   Ch3: District, Size and State ->
 *   Ch4: Fee Income in Call Reports ->
 *   Ch5: Data Coverage ->
 *   Economic Backdrop ->
 *   Ch6: What to Watch ->
 *   Methodology -> Appendix
 *
 * Every heading and card states a figure from the payload. There is no fixed thesis,
 * "so what" advice or playbook: Hamilton supports decisions and never tells an
 * institution what to charge (James, 2026-10-06).
 */

import {
  wrapReport,
  coverPage,
  tableOfContents,
  statCardRow,
  horizontalBarChart,
  columnChart,
  dataTable,
  twoColumn,
  chapterDivider,
  hamiltonNarrativeBlock,
  compactTable,
  footnote,
  pullQuote,
  insightCardRow,
  comparisonChart,
  layoutAnalytical,
  layoutStatement,
  dataFramework,
  escapeHtml,
} from "../index";

import {
  MIN_GROUP_INSTITUTIONS,
  REGIONAL_FEES,
  type DerivedAnalytics,
  type GroupRow,
  type NationalQuarterlyPayload,
} from "@/lib/report-assemblers/national-quarterly";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { developmentsContent, feeChangesContent } from "./developments";
import { regulatoryExtras } from "./regulatory-section";
import type { RegulatoryContext } from "@/lib/report-assemblers/regulatory-context";
import { HAMILTON_ATTRIBUTION, SITE_DOMAIN, SITE_NAME } from "@/lib/constants";

// ─── Input Type ────────────────────────────────────────────────────────────────

export interface NationalQuarterlyReportInput {
  data: NationalQuarterlyPayload;
  narratives: {
    executive_summary: { narrative: string };
    fee_differentiation: { narrative: string };
    banks_vs_credit_unions: { narrative: string };
    revenue_reality: { narrative: string };
    industry_blind_spot: { narrative: string };
    future_strategy: { narrative: string };
  };
  /** CFPB complaints and the fee-change rules for the developments chapter; omitted when not read. */
  regulatory?: RegulatoryContext | null;
}

// ─── Formatters ────────────────────────────────────────────────────────────────

function fmtFee(amount: number | null): string {
  if (amount === null) return "\u2014";
  return `$${amount.toFixed(2)}`;
}

/** Call-report income is reported in thousands of dollars. */
function fmtThousandsAsBillions(thousands: number): string {
  return `$${(thousands / 1_000_000).toFixed(1)}B`;
}

/** Thousands of dollars as $X.XB or $XXXM. */
function fmtThousandsShort(thousands: number): string {
  return thousands >= 1_000_000 ? fmtThousandsAsBillions(thousands) : `$${Math.round(thousands / 1_000)}M`;
}

/** "2026-Q2" -> "Q2 '26"; other labels pass through. */
function shortQuarter(q: string): string {
  const m = /^(\d{4})-?Q(\d)$/.exec(q);
  return m ? `Q${m[2]} '${m[1].slice(2)}` : q;
}

function signedPct(value: number | null): string | undefined {
  if (value === null) return undefined;
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}% YoY`;
}

/** Short column heads so the group name keeps its width. */
const SHORT_FEE_LABELS: Record<string, string> = {
  overdraft: "Overdraft",
  nsf: "NSF",
  monthly_maintenance: "Monthly",
  atm_non_network: "Other ATM",
  wire_domestic_outgoing: "Wire out",
};

/** One row per group, one column per headline fee; "\u2014" when too few institutions publish it. */
function groupTable(rows: GroupRow[], groupLabel: string, caption: string): string {
  return dataTable({
    columns: [
      { key: "label", label: groupLabel, align: "left" },
      ...REGIONAL_FEES.map((fee) => ({ key: fee, label: SHORT_FEE_LABELS[fee] ?? getDisplayName(fee), align: "right" as const, format: "amount" as const })),
      { key: "n", label: "OD filers", align: "right" as const, format: "integer" as const },
    ],
    rows: rows.map((r) => ({
      label: r.label,
      ...Object.fromEntries(REGIONAL_FEES.map((fee) => [fee, r.fees[fee]?.median ?? null])),
      n: r.fees.overdraft?.institutions ?? 0,
    })),
    caption,
  });
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** ", January 2026" from a YYYYMM release code; empty when unknown. */
function releaseLabel(code: string | undefined): string {
  const m = code ? /^(\d{4})(\d{2})$/.exec(code) : null;
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `, ${month} ${m[1]}` : "";
}

function fmtPct(value: number | null): string {
  if (value === null) return "\u2014";
  return `${value.toFixed(1)}%`;
}

// ─── Appendix Column Definitions ──────────────────────────────────────────────

const APPENDIX_COLUMNS = [
  { key: "display_name", label: "Fee Category", align: "left" as const },
  { key: "fee_family", label: "Family", align: "left" as const },
  { key: "median_amount", label: "Median", align: "right" as const, format: "amount" as const },
  { key: "p25_amount", label: "P25", align: "right" as const, format: "amount" as const },
  { key: "p75_amount", label: "P75", align: "right" as const, format: "amount" as const },
  { key: "institution_count", label: "N", align: "right" as const, format: "integer" as const },
  { key: "maturity_tier", label: "Maturity", align: "left" as const },
];

// ─── Renderer ──────────────────────────────────────────────────────────────────

export function renderNationalQuarterlyReport(input: NationalQuarterlyReportInput): string {
  const { data, narratives } = input;
  const d: DerivedAnalytics = data.derived;
  // Payloads stored before median_iqr_spread_pct existed fall back to the mean.
  const spreadPct = d.median_iqr_spread_pct ?? d.avg_iqr_spread_pct ?? null;
  // Payloads stored before the regional and income chapters lack these fields.
  const overdraftDistribution = data.overdraft_distribution ?? [];
  const regional = data.regional ?? { districts: [], sizes: [], states: [] };
  const incomeSeries = data.income_series ?? [];

  const formattedDate = new Date(data.report_date).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // ── Cover ──────────────────────────────────────────────────────────────────
  const cover = coverPage({
    title: `National Fee Index, ${data.quarter}`,
    subtitle: `${data.total_institutions.toLocaleString()} institutions with published fees \u2014 ${d.categories_with_data_count} fee categories. Fees as of ${formattedDate}${data.revenue ? `; call-report income through ${data.revenue.latest_quarter}` : ""}.`,
    report_date: formattedDate,
    series: `National Quarterly Report \u2014 ${data.quarter}`,
  });

  // ── Table of Contents ──────────────────────────────────────────────────────
  const toc = tableOfContents([
    {
      title: "The Quarter in Figures",
      description: "Headline medians, charter comparison and call-report income",
      sectionLabel: "Executive Summary",
    },
    {
      number: "01",
      title: "Where Prices Cluster and Where They Spread",
      description: "Spread around the national median, by fee",
      sectionLabel: "Core Analysis",
    },
    {
      number: "02",
      title: "Banks and Credit Unions",
      description: "Medians by charter where both publish the fee",
    },
    {
      number: "03",
      title: "District, Size and State",
      description: "Headline fee medians by Federal Reserve district, asset size and state",
    },
    {
      number: "04",
      title: "Fee Income in Call Reports",
      description: "Eight quarters of FDIC and NCUA service-charge income",
    },
    {
      number: "05",
      title: "Fee Changes at the Same Banks",
      description: "Price changes confirmed against each bank's own schedules",
    },
    {
      number: "06",
      title: "Regulatory and Industry Developments",
      description: "Federal Reserve, FDIC, OCC and CFPB releases from the last 90 days",
    },
    {
      number: "07",
      title: "Data Coverage",
      description: "How much of each category is published",
    },
    {
      title: "Economic Backdrop",
      description: "Rates, prices and Beige Book notes from the Federal Reserve",
    },
    {
      number: "08",
      title: "What to Watch",
      description: "Questions the next quarters of data can settle",
    },
    {
      title: "Methodology",
      description: "Data sources, computation methods, and maturity definitions",
      sectionLabel: "Data",
    },
    {
      title: "Full Category Index",
      description: "Complete national benchmark data for all tracked fee categories",
    },
  ]);

  // ── Executive Summary: the quarter in figures ─────────────────────────────
  const commoditizedPct = d.total_priced_categories > 0
    ? Math.round((d.commoditized_count / d.total_priced_categories) * 100)
    : 0;
  const byCategory = new Map(data.categories.map((c) => [c.fee_category, c]));
  const headlineCard = (key: string, label: string) => {
    const c = byCategory.get(key);
    if (!c || c.median_amount === null) return null;
    return {
      number: fmtFee(c.median_amount),
      insight: `${label} national median`,
      supporting: `Middle half ${fmtFee(c.p25_amount)} to ${fmtFee(c.p75_amount)}, from ${c.institution_count.toLocaleString()} institutions.`,
    };
  };
  const figures = [
    headlineCard("overdraft", "Overdraft"),
    headlineCard("nsf", "NSF / returned item"),
    d.comparable_count > 0
      ? {
          number: `${d.bank_higher_count} of ${d.comparable_count}`,
          insight: "Categories where banks' median is higher",
          supporting: `Credit unions' median is higher in ${d.cu_higher_count}; the rest are equal.`,
        }
      : null,
    data.revenue && data.revenue.total_service_charges > 0
      ? {
          number: fmtThousandsAsBillions(data.revenue.total_service_charges),
          insight: `Service-charge income, ${data.revenue.latest_quarter}`,
          supporting: data.revenue.yoy_change_pct !== null
            ? `${data.revenue.yoy_change_pct > 0 ? "+" : ""}${data.revenue.yoy_change_pct.toFixed(1)}% from a year earlier, FDIC and NCUA filings.`
            : "FDIC and NCUA filings.",
        }
      : null,
    spreadPct !== null
      ? {
          number: `${spreadPct.toFixed(0)}%`,
          insight: "Typical spread of the middle half",
          supporting: `Median across ${d.total_priced_categories} priced categories of each fee's middle half as a share of its median.`,
        }
      : null,
  ].filter((f): f is { number: string; insight: string; supporting: string } => f !== null);

  const execSummary = [
    chapterDivider("", "The Quarter in Figures"),
    insightCardRow(figures),
    hamiltonNarrativeBlock(narratives.executive_summary.narrative),
  ].join("\n");

  // ── Economic Context: Federal Data ──────────────────────────────────────────
  const econSections: string[] = [];

  if (data.fred && (data.fred.fed_funds_rate !== null || data.fred.unemployment_rate !== null)) {
    const econCards: Array<{ label: string; value: string; source?: string }> = [];
    if (data.fred.fed_funds_rate !== null) {
      econCards.push({ label: "Fed Funds Rate", value: `${data.fred.fed_funds_rate.toFixed(2)}%`, source: "Federal Reserve" });
    }
    if (data.fred.unemployment_rate !== null) {
      econCards.push({ label: "Unemployment", value: `${data.fred.unemployment_rate.toFixed(1)}%`, source: "Bureau of Labor Statistics" });
    }
    if (data.fred.cpi_yoy_pct !== null) {
      econCards.push({ label: "CPI YoY", value: `${data.fred.cpi_yoy_pct > 0 ? "+" : ""}${data.fred.cpi_yoy_pct.toFixed(1)}%`, source: "BLS Consumer Price Index" });
    }
    if (data.fred.consumer_sentiment !== null) {
      econCards.push({ label: "Consumer Sentiment", value: data.fred.consumer_sentiment.toFixed(1), source: "Univ. of Michigan" });
    }
    if (data.fred.gdp_growth_yoy_pct !== null) {
      econCards.push({
        label: "GDP Growth YoY",
        value: `${data.fred.gdp_growth_yoy_pct > 0 ? "+" : ""}${data.fred.gdp_growth_yoy_pct.toFixed(1)}%`,
        source: "Bureau of Economic Analysis",
      });
    }
    if (data.fred.personal_savings_rate !== null) {
      econCards.push({
        label: "Personal Savings Rate",
        value: `${data.fred.personal_savings_rate.toFixed(1)}%`,
        source: "Bureau of Economic Analysis",
      });
    }
    if (data.fred.bank_lending_standards !== null) {
      econCards.push({
        label: "Bank Lending Standards",
        value: `${data.fred.bank_lending_standards > 0 ? "+" : ""}${data.fred.bank_lending_standards.toFixed(1)}%`,
        source: "Federal Reserve Sr. Loan Officer Survey",
      });
    }

    // No wrapping box: the card rows keep together in print and a box would split from them.
    econSections.push(
      `<div class="h-bar-title">Economic indicators, as of ${escapeHtml(data.fred.as_of || data.quarter)}</div>`,
      statCardRow(econCards.slice(0, 3)),
      econCards.length > 3 ? statCardRow(econCards.slice(3, 6)) : "",
      econCards.length > 6 ? statCardRow(econCards.slice(6)) : "",
    );
  }

  if (data.district_headlines.length > 0) {
    const headlines = data.district_headlines
      .slice(0, 6)
      .map((dh) => `<li style="margin-bottom: 6px;"><strong>District ${dh.district}:</strong> ${dh.headline}</li>`)
      .join("\n");

    econSections.push(
      `<div style="margin: 24px 0; padding: 20px 28px; background: white; border: 1px solid #e5e7eb; border-radius: 8px;">`,
      `<h4 style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin: 0 0 12px 0;">Fed Beige Book \u2014 District Economic Narratives</h4>`,
      `<ul style="font-size: 13px; line-height: 1.6; color: #374151; margin: 0; padding-left: 18px;">${headlines}</ul>`,
      `</div>`,
    );
  }

  if (data.beige_themes && data.beige_themes.length > 0) {
    const themeQuotes = data.beige_themes
      .map((t) => pullQuote(
        t.summary.slice(0, 250) + (t.summary.length > 250 ? "..." : ""),
        `Federal Reserve Beige Book${releaseLabel(t.release_code)} \u2014 ${t.district_name} (${t.theme_category.replace(/_/g, " ")})`
      ))
      .join("\n");

    econSections.push(
      `<div style="margin: 24px 0;">`,
      `<h4 style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin: 0 0 16px 0;">Regional Economic Signals</h4>`,
      themeQuotes,
      `</div>`,
    );
  }

  const economicContext = econSections.length > 0
    ? [chapterDivider("", "Economic Backdrop"), ...econSections].join("\n")
    : "";

  // ── Ch1: The Illusion of Fee Differentiation ──────────────────────────────
  const tightestBars = d.tightest_spreads.slice(0, 10).map((s) => ({
    label: s.display_name,
    value: s.spread_pct,
    displayValue: `${s.spread_pct.toFixed(1)}%`,
  }));

  const ch1 = [
    chapterDivider("01", "Where Prices Cluster and Where They Spread"),
    horizontalBarChart({
      bars: tightestBars,
      title: "Fees with the narrowest middle half (spread as % of median)",
      source: `Bank Fee Index \u2014 ${data.total_institutions.toLocaleString()} institutions`,
    }),
    overdraftDistribution.length > 1
      ? columnChart({
          title: "How overdraft prices spread: institutions at each price",
          columns: overdraftDistribution.map((b) => ({
            label: b.label.replace(" to ", "\u2013"),
            segments: [{ label: "Institutions", value: b.count }],
            displayValue: b.count.toLocaleString(),
          })),
          source: `One price per institution (its highest tier where it has several). ${overdraftDistribution.reduce((n, b) => n + b.count, 0).toLocaleString()} institutions.`,
        })
      : "",
    hamiltonNarrativeBlock(narratives.fee_differentiation.narrative),
  ].join("\n");

  // ── Ch2: Banks vs Credit Unions — Two Models ─────────────────────────────
  const comparisonBars = data.categories
    .filter((c) => c.bank_count > 0 && c.cu_count > 0 && c.bank_median !== null && c.cu_median !== null)
    .sort((a, b) => Math.abs((b.bank_median ?? 0) - (b.cu_median ?? 0)) - Math.abs((a.bank_median ?? 0) - (a.cu_median ?? 0)))
    .slice(0, 8)
    .map((c) => ({
      label: c.display_name,
      leftValue: c.bank_median!,
      rightValue: c.cu_median!,
      leftDisplay: fmtFee(c.bank_median),
      rightDisplay: fmtFee(c.cu_median),
    }));

  const ch2 = [
    chapterDivider("02", "Banks and Credit Unions"),
    comparisonChart({
      bars: comparisonBars,
      leftLabel: "Banks",
      rightLabel: "Credit Unions",
      title: "Fee Medians by Charter Type",
      source: `${d.comparable_count} categories with both bank and CU data`,
    }),
    statCardRow([
      {
        label: "Bank median higher",
        value: String(d.bank_higher_count),
        source: "categories",
      },
      {
        label: "Credit union median higher",
        value: String(d.cu_higher_count),
        source: "categories",
      },
      {
        label: "Comparable Categories",
        value: String(d.comparable_count),
        source: "with both charter types",
      },
    ]),
    hamiltonNarrativeBlock(narratives.banks_vs_credit_unions.narrative),
  ].join("\n");

  // ── Ch3: District, Size and State ─────────────────────────────────────────
  const regionalSections: string[] = [chapterDivider("03", "District, Size and State")];
  const minNote = `Medians shown where at least ${MIN_GROUP_INSTITUTIONS} institutions publish the fee; \u2014 otherwise.`;
  if (regional.districts.length > 0) {
    regionalSections.push(groupTable(regional.districts, "Federal Reserve district", `Headline fee medians by Federal Reserve district. ${minNote}`));
  }
  if (regional.sizes.length > 0) {
    regionalSections.push(groupTable(regional.sizes, "Asset size", `Headline fee medians by asset size. ${minNote}`));
  }
  const stateOverdraft = regional.states
    .filter((r) => r.fees.overdraft?.median !== null && r.fees.overdraft?.median !== undefined)
    .map((r) => ({ label: r.label, median: r.fees.overdraft.median as number, n: r.fees.overdraft.institutions }))
    .sort((a, b) => b.median - a.median || b.n - a.n);
  if (stateOverdraft.length >= 10) {
    const stateTable = (rows: typeof stateOverdraft, caption: string) =>
      dataTable({
        columns: [
          { key: "label", label: "State", align: "left" },
          { key: "median", label: "Overdraft median", align: "right", format: "amount" },
          { key: "n", label: "Institutions", align: "right", format: "integer" },
        ],
        rows: rows.map((r) => ({ label: r.label, median: r.median, n: r.n })),
        caption,
      });
    regionalSections.push(
      twoColumn(
        stateTable(stateOverdraft.slice(0, 5), "Highest overdraft medians"),
        stateTable(stateOverdraft.slice(-5).reverse(), "Lowest overdraft medians"),
        "1fr 1fr",
      ),
      footnote(`${stateOverdraft.length} states have at least ${MIN_GROUP_INSTITUTIONS} institutions publishing an overdraft fee; the rest are left out of this ranking.`),
    );
  }
  if (regionalSections.length === 1) {
    regionalSections.push(footnote("District, size and state medians were not available when this report was built."));
  }
  const ch3Regional = regionalSections.join("\n");

  // ── Ch4: Fee Income in Call Reports ─────────────────────────────────────
  // Call reports give one service-charge line per institution, not income by fee
  // category, so this chapter ranks no category by revenue.
  const ch3Sections: string[] = [
    chapterDivider("04", "Fee Income in Call Reports"),
  ];

  if (data.revenue) {
    const revenueCards: Array<{ label: string; value: string; delta?: string; source?: string }> = [];

    if (data.revenue.total_service_charges > 0) {
      revenueCards.push({
        label: "Service-charge income",
        value: fmtThousandsAsBillions(data.revenue.total_service_charges),
        delta: data.revenue.yoy_change_pct !== null ? `${data.revenue.yoy_change_pct > 0 ? "+" : ""}${data.revenue.yoy_change_pct.toFixed(1)}% YoY` : undefined,
        source: data.revenue.latest_quarter,
      });
    }

    if (d.bank_revenue_share_pct !== null) {
      revenueCards.push({
        label: "Banks' share",
        value: `${d.bank_revenue_share_pct.toFixed(1)}%`,
        source: d.cu_revenue_share_pct !== null ? `credit unions ${d.cu_revenue_share_pct.toFixed(1)}%` : undefined,
      });
    }

    if (data.revenue.total_institutions > 0) {
      revenueCards.push({
        label: "Reporting institutions",
        value: data.revenue.total_institutions.toLocaleString(),
        source: "FDIC + NCUA filings",
      });
    }

    if (revenueCards.length > 0) {
      ch3Sections.push(statCardRow(revenueCards));
    }
  }

  // Oldest quarter on the left.
  const series = [...incomeSeries].reverse();
  if (series.length > 1) {
    ch3Sections.push(
      columnChart({
        title: "Service-charge income by quarter",
        columns: series.map((q) => ({
          label: shortQuarter(q.quarter),
          segments: [
            { label: "Banks (FDIC)", value: q.banks },
            { label: "Credit unions (NCUA)", value: q.credit_unions },
          ],
          displayValue: fmtThousandsShort(q.total),
          note: signedPct(q.yoy_change_pct),
        })),
        source: "FDIC call reports and NCUA 5300 filings; credit-union year-to-date income converted to the quarter.",
      }),
    );
  }

  ch3Sections.push(
    dataFramework(
      "What call reports can and cannot show",
      "FDIC call reports give each bank's quarterly service charges on deposit accounts; NCUA 5300 reports give each credit union's fee income, reported year to date and converted here to the quarter. Neither splits income by fee, so this report does not say which fees earn the most.",
    )
  );

  ch3Sections.push(hamiltonNarrativeBlock(narratives.revenue_reality.narrative));

  const ch3 = ch3Sections.join("\n");

  // ── Ch4: The Industry Blind Spot ──────────────────────────────────────────
  const ch4 = [
    chapterDivider("07", "Data Coverage"),
    statCardRow([
      {
        label: "Categories with Data",
        value: String(d.categories_with_data_count),
        source: `of ${data.categories.length} total`,
      },
      {
        label: "Strong Maturity",
        value: String(d.strong_maturity_count),
        source: "10+ approved observations",
      },
      {
        label: "Provisional",
        value: String(d.provisional_maturity_count),
        source: "10+ total observations",
      },
    ]),
    hamiltonNarrativeBlock(narratives.industry_blind_spot.narrative),
  ].join("\n");

  // ── Ch5: The Future of Fee Strategy ───────────────────────────────────────
  const ch5 = [
    chapterDivider("08", "What to Watch"),
    statCardRow([
      {
        label: "Typical price spread",
        value: spreadPct !== null ? `${spreadPct.toFixed(0)}%` : "\u2014",
        source: "middle half as % of median, median across fees",
      },
      {
        label: "Narrow middle half",
        value: `${commoditizedPct}%`,
        source: `${d.commoditized_count} of ${d.total_priced_categories} categories`,
      },
      {
        label: "Institutions with published fees",
        value: data.total_institutions.toLocaleString(),
        source: "national coverage",
      },
    ]),
    hamiltonNarrativeBlock(narratives.future_strategy.narrative),
  ].join("\n");

  // ── Fee changes and agency releases ──────────────────────────────────────
  // Payloads stored before these fields existed render the chapters' "not read" line.
  const changesChapter = [
    chapterDivider("05", "Fee Changes at the Same Banks"),
    feeChangesContent(data.fee_changes, { label: "U.S." }),
  ].join("\n");
  const developmentsChapter = [
    chapterDivider("06", "Regulatory and Industry Developments"),
    developmentsContent(data.developments, data.report_date),
    regulatoryExtras(input.regulatory, "the United States"),
  ].join("\n");

  // ── Methodology ───────────────────────────────────────────────────────────
  const methodologyText = [
    "National medians computed from live published fees (published_fee_catalog), one value per institution per fee.",
    `Maturity: "strong" = 10+ approved observations; "provisional" = 10+ total; "insufficient" = below threshold.`,
    "Charter split computed from charter_type field on institution_sources.",
    "IQR spread = (P75 - P25) / Median. Categories with median below $0.50 excluded from spread analysis.",
    "Service-charge income from FDIC call reports (quarterly) and NCUA 5300 filings (year to date, converted to the quarter); figures are reported in thousands of dollars.",
    `${SITE_NAME} — ${SITE_DOMAIN} — Generated ${data.report_date}`,
  ].join(" ");

  const methodology = [
    footnote(methodologyText),
  ].join("\n");

  // ── Appendix ──────────────────────────────────────────────────────────────
  // Chapters, methodology and appendix flow without forced page breaks, so no page is left
  // mostly blank; each chapter heading stays with its first block (base/styles.ts).
  // The compact table uses break-inside:auto so it flows across pages naturally.
  const appendix = [
    chapterDivider("A", "Full Category Index"),
    compactTable({
      columns: APPENDIX_COLUMNS,
      rows: data.categories.map((c) => ({
        display_name: c.display_name,
        fee_family: c.fee_family,
        median_amount: c.median_amount,
        p25_amount: c.p25_amount,
        p75_amount: c.p75_amount,
        institution_count: c.institution_count,
        maturity_tier: c.maturity_tier,
      })),
      caption: `All ${data.categories.length} fee categories \u2014 ${data.total_institutions.toLocaleString()} institutions \u2014 as of ${data.report_date}`,
    }),
  ].join("\n");

  // ── Assemble with layout wrappers ───────────────────────────────────────────
  // Layout A (analytical, left-aligned): Chapters 1-4
  // Layout B (statement, centered cards/headers): Exec Summary, Ch5, Playbook
  const body = [
    cover,
    toc,
    layoutStatement(execSummary),
    layoutAnalytical(ch1),
    layoutAnalytical(ch2),
    layoutAnalytical(ch3Regional),
    layoutAnalytical(ch3),
    layoutAnalytical(changesChapter),
    layoutAnalytical(developmentsChapter),
    layoutAnalytical(ch4),
    economicContext ? layoutAnalytical(economicContext) : "",
    layoutStatement(ch5),
    methodology,
    appendix,
  ]
    .filter(Boolean)
    .join("\n\n");

  return wrapReport(body, {
    title: `National Fee Index, ${data.quarter}`,
    author: HAMILTON_ATTRIBUTION,
    date: data.report_date,
  });
}
