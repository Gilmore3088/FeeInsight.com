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
 *   Ch3: Fee Income in Call Reports ->
 *   Ch4: Data Coverage ->
 *   Ch5: What to Watch ->
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
  chapterDivider,
  hamiltonNarrativeBlock,
  compactTable,
  footnote,
  pageBreak,
  pullQuote,
  insightCardRow,
  comparisonChart,
  layoutAnalytical,
  layoutStatement,
  dataFramework,
  PALETTE,
} from "../index";

import type { DerivedAnalytics, NationalQuarterlyPayload } from "@/lib/report-assemblers/national-quarterly";
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

  const formattedDate = new Date(data.report_date).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // ── Cover ──────────────────────────────────────────────────────────────────
  const cover = coverPage({
    title: `National Fee Index, ${data.quarter}`,
    subtitle: `${data.total_institutions.toLocaleString()} institutions with published fees \u2014 ${d.categories_with_data_count} fee categories`,
    report_date: formattedDate,
    series: `National Quarterly Report \u2014 ${data.quarter}`,
  });

  // ── Table of Contents ──────────────────────────────────────────────────────
  const toc = tableOfContents([
    {
      title: "The Quarter in Figures",
      description: "Headline medians, charter comparison and call-report income",
      page: 3,
      sectionLabel: "Executive Summary",
    },
    {
      number: "01",
      title: "Where Prices Cluster and Where They Spread",
      description: "Spread around the national median, by fee",
      page: 4,
      sectionLabel: "Core Analysis",
    },
    {
      number: "02",
      title: "Banks and Credit Unions",
      description: "Medians by charter where both publish the fee",
      page: 5,
    },
    {
      number: "03",
      title: "Fee Income in Call Reports",
      description: "FDIC and NCUA service-charge income",
      page: 6,
    },
    {
      number: "04",
      title: "Data Coverage",
      description: "How much of each category is published",
      page: 7,
    },
    {
      number: "05",
      title: "What to Watch",
      description: "Questions the next quarters of data can settle",
      page: 8,
    },
    {
      title: "Methodology",
      description: "Data sources, computation methods, and maturity definitions",
      page: 9,
      sectionLabel: "Data",
    },
    {
      title: "Full Category Index",
      description: "Complete national benchmark data for all tracked fee categories",
      page: 10,
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
    d.avg_iqr_spread_pct !== null
      ? {
          number: `${d.avg_iqr_spread_pct.toFixed(0)}%`,
          insight: "Average spread of the middle half",
          supporting: `Across ${d.total_priced_categories} priced categories, as a share of each median.`,
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

    econSections.push(
      `<div style="margin: 32px 0; padding: 24px 28px; background: ${PALETTE.sectionBg}; border-radius: 8px; border-left: 4px solid ${PALETTE.accent};">`,
      `<h3 style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: ${PALETTE.accent}; margin: 0 0 16px 0;">Economic Environment \u2014 ${data.fred.as_of || data.quarter}</h3>`,
      statCardRow(econCards),
      `</div>`,
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
        `Federal Reserve Beige Book \u2014 ${t.district_name} (${t.theme_category.replace(/_/g, " ")})`
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
    ? econSections.join("\n")
    : "";

  // ── Ch1: The Illusion of Fee Differentiation ──────────────────────────────
  const tightestBars = d.tightest_spreads.slice(0, 10).map((s) => ({
    label: s.display_name,
    value: s.spread_pct,
    displayValue: `${s.spread_pct.toFixed(1)}%`,
  }));

  const ch1 = [
    pageBreak(),
    chapterDivider("01", "Where Prices Cluster and Where They Spread"),
    horizontalBarChart({
      bars: tightestBars,
      title: "Fees with the narrowest middle half (spread as % of median)",
      source: `Bank Fee Index \u2014 ${data.total_institutions.toLocaleString()} institutions`,
    }),
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
    pageBreak(),
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

  // ── Ch3: Fee Income in Call Reports ─────────────────────────────────────
  // Call reports give one service-charge line per institution, not income by fee
  // category, so this chapter ranks no category by revenue.
  const ch3Sections: string[] = [
    pageBreak(),
    chapterDivider("03", "Fee Income in Call Reports"),
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
    pageBreak(),
    chapterDivider("04", "Data Coverage"),
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
    pageBreak(),
    chapterDivider("05", "What to Watch"),
    statCardRow([
      {
        label: "Avg Price Spread",
        value: d.avg_iqr_spread_pct !== null ? `${d.avg_iqr_spread_pct.toFixed(0)}%` : "\u2014",
        source: "IQR as % of median",
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
    pageBreak(),
    footnote(methodologyText),
  ].join("\n");

  // ── Appendix ──────────────────────────────────────────────────────────────
  // No pageBreak() here — methodology flows directly into appendix to avoid blank pages.
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
    layoutAnalytical(ch3),
    layoutAnalytical(ch4),
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
