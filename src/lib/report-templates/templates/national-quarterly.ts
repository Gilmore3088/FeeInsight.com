/**
 * National Quarterly Report — HTML Template (V3 Strategic Intelligence)
 *
 * Pure function: (input) => HTML string.
 * No async, no AI calls — narratives are pre-computed and injected.
 *
 * V3 Chapter Structure:
 *   Cover -> TOC -> Executive Summary ("5 Truths") ->
 *   Ch1: The Illusion of Fee Differentiation ->
 *   Ch2: Banks vs Credit Unions: Two Models ->
 *   Ch3: Where the Money Actually Comes From ->
 *   Ch4: The Industry Blind Spot ->
 *   Ch5: The Future of Fee Strategy ->
 *   Playbook -> Methodology -> Appendix
 */

import {
  wrapReport,
  coverPage,
  tableOfContents,
  statCardRow,
  keyFinding,
  horizontalBarChart,
  chapterDivider,
  hamiltonNarrativeBlock,
  compactTable,
  footnote,
  soWhatBox,
  pullQuote,
  insightCardRow,
  comparisonChart,
  playbook,
  layoutAnalytical,
  layoutStatement,
  revenuePyramid,
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

function fmtBillions(amount: number): string {
  return `$${(amount / 1_000_000_000).toFixed(1)}B`;
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
    title: "The Death of Fee-Based Differentiation",
    subtitle: `${data.total_institutions.toLocaleString()} Institutions \u2014 Full Fee Catalog \u2014 National Benchmark Analysis`,
    report_date: formattedDate,
    series: `National Quarterly Report \u2014 ${data.quarter}`,
  });

  // ── Table of Contents ──────────────────────────────────────────────────────
  // No page numbers: chapters flow rather than each starting a new page, so a fixed
  // number would point at the wrong page.
  const toc = tableOfContents([
    {
      title: "5 Truths About Banking Fees",
      description: "A structural shift in how banks generate fee revenue",
      sectionLabel: "Executive Summary",
    },
    {
      number: "01",
      title: "The Illusion of Fee Differentiation",
      description: "Why pricing no longer drives advantage",
      sectionLabel: "Core Analysis",
    },
    {
      number: "02",
      title: "Banks vs Credit Unions: Two Models",
      description: "Convenience vs penalty economics",
    },
    {
      number: "03",
      title: "Where the Money Actually Comes From",
      description: "Revenue concentration + national data",
    },
    {
      number: "04",
      title: "The Industry Blind Spot",
      description: "Why pricing lacks benchmark context",
    },
    {
      number: "05",
      title: "The Future of Fee Strategy",
      description: "Behavior, bundling, and segmentation",
    },
    {
      title: "What Winning Institutions Do Next",
      description: "Actionable recommendations by charter type",
      sectionLabel: "Strategy",
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

  // ── Executive Summary: "5 Truths About Banking Fees" ──────────────────────
  const commoditizedPct = d.total_priced_categories > 0
    ? Math.round((d.commoditized_count / d.total_priced_categories) * 100)
    : 0;

  // Build 5 Truths as individual insight cards — each: bold claim, proof stat, arrow implication
  const fiveTruths = [
    {
      number: `${commoditizedPct}%`,
      insight: "Pricing is not a competitive advantage",
      supporting: `${d.commoditized_count} of ${d.total_priced_categories} categories cluster within narrow IQR ranges. Competing on price alone is ineffective.`,
    },
    {
      number: String(d.bank_higher_count),
      insight: "Credit unions win perception, not pricing",
      supporting: `Banks charge more in ${d.bank_higher_count} of ${d.comparable_count} comparable categories, yet CUs carry higher penalty exposure. Fee strategy must align with customer behavior.`,
    },
    {
      number: d.bank_revenue_share_pct !== null ? `${d.bank_revenue_share_pct.toFixed(0)}%` : "\u2014",
      insight: "Revenue visibility is broken",
      supporting: d.bank_revenue_share_pct !== null
        ? `Banks hold ${d.bank_revenue_share_pct.toFixed(0)}% of fee revenue, yet no standardized benchmarking exists. Institutions are pricing without context.`
        : "No standardized fee revenue benchmarking exists. Institutions are pricing without context.",
    },
    {
      number: String(d.strong_maturity_count),
      insight: "Fee income is concentrated",
      supporting: `Only ${d.strong_maturity_count} categories have strong data maturity out of ${d.total_priced_categories}. Optimization must focus on high-impact fees.`,
    },
    {
      number: d.avg_iqr_spread_pct !== null ? `${d.avg_iqr_spread_pct.toFixed(0)}%` : "\u2014",
      insight: "Behavior beats pricing",
      supporting: `Average IQR spread of ${d.avg_iqr_spread_pct !== null ? d.avg_iqr_spread_pct.toFixed(0) + "%" : "N/A"} confirms static fee schedules cannot capture value. Future advantage = segmentation + behavior.`,
    },
  ];

  const execSummary = [
    chapterDivider("", "5 Truths About Banking Fees in 2026"),
    insightCardRow(fiveTruths),
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
    chapterDivider("01", "The Illusion of Fee Differentiation"),
    horizontalBarChart({
      bars: tightestBars,
      title: "Top 10 Functionally Undifferentiated Fees (Smallest IQR Spread)",
      source: `Bank Fee Index \u2014 ${data.total_institutions.toLocaleString()} institutions`,
    }),
    hamiltonNarrativeBlock(narratives.fee_differentiation.narrative),
    soWhatBox("Stop competing on price alone. Differences exist but are too small to influence customer choice. Differentiation must come from experience, packaging, and targeting."),
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
    chapterDivider("02", "Banks vs Credit Unions: Two Models"),
    comparisonChart({
      bars: comparisonBars,
      leftLabel: "Banks",
      rightLabel: "Credit Unions",
      title: "Fee Medians by Charter Type",
      source: `${d.comparable_count} categories with both bank and CU data`,
    }),
    statCardRow([
      {
        label: "Banks Charge More",
        value: String(d.bank_higher_count),
        source: "categories",
      },
      {
        label: "CUs Charge More",
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
    soWhatBox("Banks monetize convenience; credit unions monetize penalties. Neither model is sustainable without intentional fee architecture."),
  ].join("\n");

  // ── Ch3: Where the Money Actually Comes From ─────────────────────────────
  // Revenue proxy model: estimate impact from fee prevalence and median amount.
  const revenueProxy = data.categories
    .filter((c) => c.median_amount !== null && c.median_amount > 0 && c.institution_count > 0)
    .map((c) => ({
      display_name: c.display_name,
      median: c.median_amount!,
      institutions: c.institution_count,
      estimated_impact: c.median_amount! * c.institution_count,
    }))
    .sort((a, b) => b.estimated_impact - a.estimated_impact);

  const primaryDriverNames = revenueProxy.slice(0, 3).map((r) => r.display_name).join(" / ");
  const secondaryDriverNames = revenueProxy.slice(3, 8).map((r) => r.display_name).join(", ");
  const longTailCount = Math.max(revenueProxy.length - 8, 0);

  const ch3Sections: string[] = [
    chapterDivider("03", "Where the Money Actually Comes From"),
  ];

  // Revenue concentration pyramid — always shown
  ch3Sections.push(
    revenuePyramid([
      {
        label: primaryDriverNames,
        description: "Primary Revenue Drivers",
        widthPct: 30,
      },
      {
        label: secondaryDriverNames,
        description: "Secondary Drivers",
        widthPct: 55,
      },
      {
        label: `${longTailCount} Other Categories`,
        description: "Long Tail -- Minimal Revenue",
        widthPct: 90,
      },
    ])
  );

  if (data.revenue) {
    // Real revenue data path — filter out $0 values
    const revenueCards: Array<{ label: string; value: string; delta?: string; source?: string }> = [];

    if (data.revenue.total_service_charges > 0) {
      revenueCards.push({
        label: "Total Service Charges",
        value: fmtBillions(data.revenue.total_service_charges),
        delta: data.revenue.yoy_change_pct !== null ? `${data.revenue.yoy_change_pct > 0 ? "+" : ""}${data.revenue.yoy_change_pct.toFixed(1)}% YoY` : undefined,
        source: data.revenue.latest_quarter,
      });
    }

    if (d.revenue_per_institution !== null && d.revenue_per_institution > 0) {
      revenueCards.push({
        label: "Revenue per Institution",
        value: `$${(d.revenue_per_institution / 1_000_000).toFixed(1)}M`,
        source: `${data.revenue.total_institutions.toLocaleString()} reporting institutions`,
      });
    }

    if (data.revenue.total_institutions > 0) {
      revenueCards.push({
        label: "Reporting Institutions",
        value: data.revenue.total_institutions.toLocaleString(),
        source: "FDIC + NCUA filings",
      });
    }

    if (revenueCards.length > 0) {
      ch3Sections.push(statCardRow(revenueCards));
    }
  }

  // Revenue contribution bar chart (proxy ranking) — after pyramid
  ch3Sections.push(
    horizontalBarChart({
      bars: revenueProxy.slice(0, 8).map((r) => ({
        label: r.display_name,
        value: r.estimated_impact,
        displayValue: `$${r.median.toFixed(2)} \u00d7 ${r.institutions.toLocaleString()}`,
      })),
      title: "Estimated Revenue Contribution (Median x Institution Count)",
      source: `Bank Fee Index \u2014 ${data.total_institutions.toLocaleString()} institutions`,
    })
  );

  // National Data Framework block
  ch3Sections.push(
    dataFramework(
      "National Fee Revenue Framework",
      `This analysis integrates FDIC Call Report service charge data, NCUA 5300 credit union filings, and observed pricing across ${data.total_institutions.toLocaleString()} institutions. Because fee revenue is not reported at the category level, this report models revenue concentration using median fee amounts, institutional prevalence, and regulatory reporting totals.`,
    )
  );

  ch3Sections.push(hamiltonNarrativeBlock(narratives.revenue_reality.narrative));

  ch3Sections.push(
    keyFinding(
      "Most institutions optimize pricing across every category they publish \u2014 but revenue is driven by fewer than 5.",
      "Key Finding",
    )
  );

  ch3Sections.push(soWhatBox("Focus optimization on high-impact categories. Stop over-analyzing low-impact fees."));

  const ch3 = ch3Sections.join("\n");

  // ── Ch4: The Industry Blind Spot ──────────────────────────────────────────
  const ch4 = [
    chapterDivider("04", "The Industry Blind Spot"),
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
    soWhatBox("No institution can benchmark fee revenue nationally today. This is the competitive blind spot the Bank Fee Index exists to close."),
  ].join("\n");

  // ── Ch5: The Future of Fee Strategy ───────────────────────────────────────
  const ch5 = [
    chapterDivider("05", "The Future of Fee Strategy"),
    statCardRow([
      {
        label: "Avg Price Spread",
        value: d.avg_iqr_spread_pct !== null ? `${d.avg_iqr_spread_pct.toFixed(0)}%` : "\u2014",
        source: "IQR as % of median",
      },
      {
        label: "Effectively Commoditized",
        value: `${commoditizedPct}%`,
        source: `${d.commoditized_count} of ${d.total_priced_categories} categories`,
      },
      {
        label: "Institutions Tracked",
        value: data.total_institutions.toLocaleString(),
        source: "national coverage",
      },
    ]),
    hamiltonNarrativeBlock(narratives.future_strategy.narrative),
    soWhatBox("Future revenue growth comes from behavior design, bundling, and segmentation — not static price sheets."),
  ].join("\n");

  // ── Playbook ──────────────────────────────────────────────────────────────
  const playbookSection = [
    playbook([
      {
        title: "If You Are a Bank",
        recommendations: [
          "Monetize convenience fees where you hold pricing power (wires, specialized services)",
          "Reduce reliance on penalty fees — regulatory and reputational risk is growing",
          "Build fee bundles that align price with customer segment behavior",
        ],
      },
      {
        title: "If You Are a Credit Union",
        recommendations: [
          "Rebalance penalty fee exposure — NSF and overdraft concentration creates regulatory vulnerability",
          "Expand digital and convenience monetization (mobile, instant transfers)",
          "Leverage member data for behavior-based fee strategies",
        ],
      },
      {
        title: "If You Are Behind",
        recommendations: [
          "Stop benchmarking on price alone — your peers are already effectively commoditized",
          "Start with segmentation: know which customers generate fee revenue and why",
          "Invest in behavioral pricing models before competitors capture the advantage",
        ],
      },
    ]),
  ].join("\n");

  // ── Methodology ───────────────────────────────────────────────────────────
  const methodologyText = [
    "National medians computed from all non-rejected fee observations in the Bank Fee Index pipeline.",
    `Maturity: "strong" = 10+ approved observations; "provisional" = 10+ total; "insufficient" = below threshold.`,
    "Charter split computed from charter_type field on institution_sources.",
    "IQR spread = (P75 - P25) / Median. Categories with median below $0.50 excluded from spread analysis.",
    "Revenue data sourced from FDIC Call Reports and NCUA 5300 filings.",
    `${SITE_NAME} — ${SITE_DOMAIN} — Generated ${data.report_date}`,
  ].join(" ");

  const methodology = [
    footnote(methodologyText),
  ].join("\n");

  // ── Appendix ──────────────────────────────────────────────────────────────
  // Chapters, methodology and appendix all flow: no forced page breaks after the table of
  // contents, so no page is left mostly blank. Each chapter heading stays with its first
  // block (print rules in base/styles.ts), and the compact table splits between rows.
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
    layoutStatement(playbookSection),
    methodology,
    appendix,
  ]
    .filter(Boolean)
    .join("\n\n");

  return wrapReport(body, {
    title: "The Death of Fee-Based Differentiation",
    author: HAMILTON_ATTRIBUTION,
    date: data.report_date,
  });
}
