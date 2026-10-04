/**
 * Pure HTML component builder functions for report templates.
 *
 * All functions are pure: given the same inputs they return the same HTML string.
 * No side effects, no async operations, no AI calls.
 * All user-provided strings pass through escapeHtml to prevent XSS.
 */

import { PALETTE } from "./styles";
import { RESEARCH_IMPRINT, SITE_NAME } from "@/lib/constants";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Cover Page ────────────────────────────────────────────────────────────────

export interface CoverPageProps {
  title: string;
  subtitle: string;
  report_date: string;
  series?: string;           // e.g., "National Fee Index — Q1 2026"
  confidentiality?: string;  // e.g., "Prepared exclusively for [Client]"
}

/**
 * Full visual cover with title, subtitle, date, and issuer block.
 * Per D-03: titles should state the conclusion, not the topic.
 */
export function coverPage(props: CoverPageProps): string {
  return `
<div class="report-cover">
  <div class="report-cover-inner">
    <div class="report-cover-label">${escapeHtml(props.series ?? RESEARCH_IMPRINT)}</div>
    <h1 class="report-cover-title">${escapeHtml(props.title)}</h1>
    <div class="report-cover-subtitle">${escapeHtml(props.subtitle)}</div>
    <div class="report-cover-meta">
      <span>${SITE_NAME}</span>
      <span>${escapeHtml(props.report_date)}</span>
      ${props.confidentiality ? `<span>${escapeHtml(props.confidentiality)}</span>` : ""}
    </div>
  </div>
</div>`;
}

// ─── Section Header ────────────────────────────────────────────────────────────

export interface SectionHeaderProps {
  label: string;        // e.g., "Findings" — terracotta small caps above heading
  title: string;        // Conclusion-first heading per D-03
  subheading?: string;  // Optional italic subheading for additional context
}

/**
 * Terracotta label + Newsreader heading + optional italic subheading.
 * Use conclusion-first titles per D-03: "Montana overdraft fees run 23% above national median"
 * not "Overdraft Fee Analysis".
 */
export function sectionHeader(props: SectionHeaderProps): string {
  return `
<div class="report-section-header">
  <div class="report-section-label">${escapeHtml(props.label)}</div>
  <h2 class="report-heading">${escapeHtml(props.title)}</h2>
  ${props.subheading ? `<div class="report-subheading">${escapeHtml(props.subheading)}</div>` : ""}
</div>`;
}

// ─── Data Table ────────────────────────────────────────────────────────────────

export interface DataTableColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  format?: "amount" | "percent" | "integer" | "text";
}

export interface DataTableProps {
  columns: DataTableColumn[];
  rows: Array<Record<string, string | number | null>>;
  caption?: string;
}

function formatCell(val: string | number | null | undefined, fmt?: string): string {
  if (val === null || val === undefined) return "\u2014"; // em dash for missing values
  if (fmt === "amount" && typeof val === "number") return `$${val.toFixed(2)}`;
  if (fmt === "percent" && typeof val === "number") {
    const sign = val > 0 ? "+" : "";
    return `${sign}${val.toFixed(1)}%`;
  }
  if (fmt === "integer" && typeof val === "number") return val.toLocaleString();
  return escapeHtml(String(val));
}

/**
 * Full-width data table with warm styling matching brief-generator.ts visual language.
 * Null values render as "—" (em dash). Positive percent values get "+" prefix.
 */
export function dataTable(props: DataTableProps): string {
  const headers = props.columns
    .map((c) => `<th style="text-align:${c.align ?? "left"}">${escapeHtml(c.label)}</th>`)
    .join("");

  const rows = props.rows
    .map((row) => {
      const cells = props.columns
        .map((c) => {
          const val = row[c.key] ?? null;
          return `<td style="text-align:${c.align ?? "left"}">${formatCell(val, c.format)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `
<div class="report-table-wrapper">
  ${props.caption ? `<div class="report-table-caption">${escapeHtml(props.caption)}</div>` : ""}
  <table class="report-table">
    <thead><tr>${headers}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

// ─── Chart Container ───────────────────────────────────────────────────────────

export interface ChartContainerProps {
  caption: string;
  src?: string;     // base64 data URI or path — omit for placeholder
  alt?: string;
  width?: string;   // CSS width, default "100%"
}

/**
 * Placeholder for Matplotlib-generated chart images.
 * When src is provided, renders the image. When omitted, renders a dashed placeholder.
 * src is only embedded from server-side code; no user-controlled src input in this plan's scope.
 */
export function chartContainer(props: ChartContainerProps): string {
  if (props.src) {
    return `
<figure class="chart-container">
  <img src="${props.src}" alt="${escapeHtml(props.alt ?? props.caption)}" style="width:${props.width ?? "100%"};height:auto;" />
  <figcaption class="chart-caption">${escapeHtml(props.caption)}</figcaption>
</figure>`;
  }
  return `
<figure class="chart-container chart-placeholder">
  <div class="chart-placeholder-inner">Chart: ${escapeHtml(props.caption)}</div>
  <figcaption class="chart-caption">${escapeHtml(props.caption)}</figcaption>
</figure>`;
}

// ─── Pull Quote ────────────────────────────────────────────────────────────────

/**
 * Large Newsreader italic text with terracotta left border.
 * Use for the single most important finding in a section.
 * Optional attribution renders as a cite element below the quote.
 */
export function pullQuote(text: string, attribution?: string): string {
  const attr = attribution
    ? `<cite style="display: block; margin-top: 8px; font-size: 11px; font-style: normal; color: #6b7280;">\u2014 ${escapeHtml(attribution)}</cite>`
    : "";
  return `<blockquote class="report-pull-quote">${escapeHtml(text)}${attr}</blockquote>`;
}

// ─── Footnote ──────────────────────────────────────────────────────────────────

/**
 * Small muted text below a section with top border rule.
 * Use for methodology notes, data sources, limitations.
 */
export function footnote(text: string): string {
  return `<footer class="footnote">${escapeHtml(text)}</footer>`;
}

// ─── Hamilton Narrative Block ──────────────────────────────────────────────────

/**
 * Wraps Hamilton's AI-generated prose with a subtle terracotta left rule.
 * escapeHtml applied defensively — generated prose should be plain text
 * but this prevents XSS if the prose is ever served in a browser frame.
 */
export function hamiltonNarrativeBlock(prose: string): string {
  return `<div class="hamilton-block"><p class="report-narrative">${escapeHtml(prose)}</p></div>`;
}

// ─── Page Break ───────────────────────────────────────────────────────────────

/**
 * Print-only page break. Has no visual effect in browser; forces new page in PDF.
 */
export function pageBreak(): string {
  return `<div class="page-break"></div>`;
}

// ─── Stat Card Row ─────────────────────────────────────────────────────────────

export interface StatCard {
  label: string;
  value: string;
  delta?: string;
  deltaColor?: "positive" | "negative" | "neutral";
  source?: string;
}

/**
 * Renders 2-3 stat cards in a responsive CSS grid.
 * Use for key metrics at the top of a section.
 */
export function statCardRow(cards: StatCard[]): string {
  const cardHtml = cards
    .map((card) => {
      const deltaClass = card.deltaColor ? ` delta-${card.deltaColor}` : "";
      return `
  <div class="stat-card">
    <div class="stat-card-label">${escapeHtml(card.label)}</div>
    <div class="stat-card-value">${escapeHtml(card.value)}</div>
    ${card.delta ? `<div class="stat-card-delta${deltaClass}">${escapeHtml(card.delta)}</div>` : ""}
    ${card.source ? `<div class="stat-card-source">${escapeHtml(card.source)}</div>` : ""}
  </div>`;
    })
    .join("");

  return `<div class="stat-cards">${cardHtml}\n</div>`;
}

// ─── Key Finding ───────────────────────────────────────────────────────────────

/**
 * Terracotta-bordered callout box for a single critical finding.
 * Use sparingly — one per section maximum.
 */
export function keyFinding(text: string, label?: string): string {
  return `
<div class="key-finding">
  ${label ? `<div class="key-finding-label">${escapeHtml(label)}</div>` : ""}
  <div class="key-finding-text">${escapeHtml(text)}</div>
</div>`;
}

// ─── Horizontal Bar Chart ──────────────────────────────────────────────────────

export interface BarChartBar {
  label: string;
  value: number;
  displayValue?: string;
}

export interface HorizontalBarChartProps {
  bars: BarChartBar[];
  title?: string;
  source?: string;
}

/**
 * CSS-only horizontal bar chart (no SVG). Bar widths are calculated as a
 * percentage of the maximum value. Bars decrease in opacity from top to bottom.
 */
export function horizontalBarChart(props: HorizontalBarChartProps): string {
  const maxValue = Math.max(...props.bars.map((b) => b.value));
  const barHtml = props.bars
    .map((bar, i) => {
      const widthPct = maxValue > 0 ? (bar.value / maxValue) * 100 : 0;
      const opacity = 1 - i * (0.6 / Math.max(props.bars.length - 1, 1));
      const display = bar.displayValue ?? String(bar.value);
      return `
  <div class="h-bar-row">
    <div class="h-bar-label">${escapeHtml(bar.label)}</div>
    <div class="h-bar-track">
      <div class="h-bar-fill" style="width:${widthPct.toFixed(1)}%;opacity:${opacity.toFixed(2)};"></div>
    </div>
    <div class="h-bar-value">${escapeHtml(display)}</div>
  </div>`;
    })
    .join("");

  return `
<div class="h-bar-chart">
  ${props.title ? `<div class="h-bar-title">${escapeHtml(props.title)}</div>` : ""}
  ${barHtml}
  ${props.source ? `<div class="h-bar-source">${escapeHtml(props.source)}</div>` : ""}
</div>`;
}

// ─── Two Column ────────────────────────────────────────────────────────────────

/**
 * CSS grid wrapper for a two-column layout.
 * ratio defaults to "1.2fr 1fr" for a slightly wider left column.
 * Left and right are pre-rendered HTML strings.
 */
export function twoColumn(left: string, right: string, ratio = "1.2fr 1fr"): string {
  return `
<div class="two-column" style="grid-template-columns:${ratio};">
  <div class="two-column-left">${left}</div>
  <div class="two-column-right">${right}</div>
</div>`;
}

// ─── Chapter Divider ───────────────────────────────────────────────────────────

/**
 * Full-width chapter opener with terracotta accent number and large heading.
 * Use at the start of major report sections.
 */
export function chapterDivider(number: string, title: string): string {
  return `
<div class="chapter-divider">
  <div class="chapter-number">${escapeHtml(number)}</div>
  <h2 class="chapter-title">${escapeHtml(title)}</h2>
</div>`;
}

// ─── Table of Contents ─────────────────────────────────────────────────────────

export interface TocEntry {
  number?: string;       // "01", "02" etc — omit for exec summary, playbook, appendix
  title: string;
  description: string;   // subtitle line
  page: number;
  sectionLabel?: string; // "Core Analysis", "Strategy", "Data" — renders as group header
}

/**
 * Single-page table of contents with proper hierarchy.
 * Section group labels are small/muted/bold (not uppercase).
 * Numbered entries show large light numbers left of the text column.
 * Dotted leaders connect titles to page numbers.
 */
export function tableOfContents(chapters: TocEntry[]): string {
  const entries = chapters
    .map((ch) => {
      const parts: string[] = [];

      // Section group label (e.g., "Core Analysis")
      if (ch.sectionLabel) {
        parts.push(`<div class="toc-section-label">${escapeHtml(ch.sectionLabel)}</div>`);
      }

      const pageStr = String(ch.page).padStart(2, "0");

      if (ch.number) {
        // Numbered chapter entry with large number
        parts.push(`
    <div class="toc-entry toc-entry-numbered">
      <div class="toc-chapter-num">${escapeHtml(ch.number)}</div>
      <div class="toc-entry-body">
        <div class="toc-entry-title-row">
          <span class="toc-entry-title">${escapeHtml(ch.title)}</span>
          <span class="toc-leader"></span>
          <span class="toc-entry-page">${escapeHtml(pageStr)}</span>
        </div>
        <div class="toc-entry-desc">${escapeHtml(ch.description)}</div>
      </div>
    </div>`);
      } else {
        // Non-numbered entry (exec summary, playbook, methodology, appendix)
        parts.push(`
    <div class="toc-entry">
      <div class="toc-entry-body">
        <div class="toc-entry-title-row">
          <span class="toc-entry-title">${escapeHtml(ch.title)}</span>
          <span class="toc-leader"></span>
          <span class="toc-entry-page">${escapeHtml(pageStr)}</span>
        </div>
        <div class="toc-entry-desc">${escapeHtml(ch.description)}</div>
      </div>
    </div>`);
      }

      return parts.join("\n");
    })
    .join("");

  return `<nav class="toc">${entries}\n</nav>`;
}

// ─── Compact Table ─────────────────────────────────────────────────────────────

/**
 * Same as dataTable but uses the "compact-table" CSS class for tighter spacing.
 * Use inside sidebar panels or when vertical space is limited.
 */
export function compactTable(props: DataTableProps): string {
  const headers = props.columns
    .map((c) => `<th style="text-align:${c.align ?? "left"}">${escapeHtml(c.label)}</th>`)
    .join("");

  const rows = props.rows
    .map((row) => {
      const cells = props.columns
        .map((c) => {
          const val = row[c.key] ?? null;
          return `<td style="text-align:${c.align ?? "left"}">${formatCell(val, c.format)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `
<div class="report-table-wrapper">
  ${props.caption ? `<div class="report-table-caption">${escapeHtml(props.caption)}</div>` : ""}
  <table class="compact-table">
    <thead><tr>${headers}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

// ─── Trend Indicator ───────────────────────────────────────────────────────────

/**
 * Inline colored up/down/flat indicator for a numeric change value.
 * Values with abs(value) > 0.5 render as up or down; otherwise flat.
 * format: 'percent' adds % suffix; 'amount' adds $ prefix.
 */
export function trendIndicator(value: number, format: "percent" | "amount" = "percent"): string {
  const absVal = Math.abs(value);
  const isUp = value > 0.5;
  const isDown = value < -0.5;

  let displayVal: string;
  if (format === "amount") {
    displayVal = `$${absVal.toFixed(2)}`;
  } else {
    displayVal = `${absVal.toFixed(1)}%`;
  }

  if (isUp) {
    return `<span class="trend-indicator trend-up">\u25b2 ${displayVal}</span>`;
  }
  if (isDown) {
    return `<span class="trend-indicator trend-down">\u25bc ${displayVal}</span>`;
  }
  return `<span class="trend-indicator trend-flat">\u2014 ${displayVal}</span>`;
}

// ─── Numbered Findings ─────────────────────────────────────────────────────────

export interface NumberedFinding {
  number: string;
  title: string;
  detail: string;
}

/**
 * Ordered list of key findings with a prominent number, bold title, and
 * supporting detail paragraph. Use for executive summary sections.
 */
export function numberedFindings(findings: NumberedFinding[]): string {
  const items = findings
    .map(
      (f) => `
  <div class="numbered-finding">
    <div class="finding-number">${escapeHtml(f.number)}</div>
    <div class="finding-body">
      <div class="finding-title">${escapeHtml(f.title)}</div>
      <div class="finding-detail">${escapeHtml(f.detail)}</div>
    </div>
  </div>`,
    )
    .join("");

  return `<div class="numbered-findings">${items}\n</div>`;
}

// ─── So What Box ──────────────────────────────────────────────────────────────

/**
 * Dark-background strategic implication callout.
 * Visually distinct from keyFinding — signals "what this means for you".
 */
export function soWhatBox(implication: string, label?: string): string {
  return `
<div class="so-what-box">
  <div class="so-what-label">${escapeHtml(label ?? "SO WHAT")}</div>
  <div class="so-what-text">${escapeHtml(implication)}</div>
</div>`;
}

// ─── Insight Card ─────────────────────────────────────────────────────────────

export interface InsightCardProps {
  number: string;       // e.g., "85%"
  insight: string;      // e.g., "of fees fall within tight ranges"
  supporting: string;   // e.g., "Pricing is commoditized across the full fee catalog"
}

/**
 * Large number + 1 sentence + supporting metric. For exec summary "5 Truths" cards.
 */
export function insightCard(props: InsightCardProps): string {
  return `
<div class="insight-card">
  <div class="insight-card-number">${escapeHtml(props.number)}</div>
  <div class="insight-card-insight">${escapeHtml(props.insight)}</div>
  <div class="insight-card-supporting">${escapeHtml(props.supporting)}</div>
</div>`;
}

/**
 * Wraps multiple insight cards in a responsive grid row.
 */
export function insightCardRow(cards: InsightCardProps[]): string {
  return `<div class="insight-cards">${cards.map((c) => insightCard(c)).join("")}\n</div>`;
}

// ─── Comparison Chart ─────────────────────────────────────────────────────────

export interface ComparisonChartBar {
  label: string;       // fee category name
  leftValue: number;   // bank median
  rightValue: number;  // CU median
  leftDisplay?: string;
  rightDisplay?: string;
}

export interface ComparisonChartProps {
  bars: ComparisonChartBar[];
  leftLabel: string;   // "Banks"
  rightLabel: string;  // "Credit Unions"
  title?: string;
  source?: string;
}

/**
 * Butterfly/tornado chart comparing two segments side-by-side.
 * Left bars extend right-to-left, right bars extend left-to-right.
 */
export function comparisonChart(props: ComparisonChartProps): string {
  const maxValue = Math.max(
    ...props.bars.map((b) => Math.max(b.leftValue, b.rightValue))
  );

  const rowsHtml = props.bars
    .map((bar) => {
      const leftPct = maxValue > 0 ? (bar.leftValue / maxValue) * 100 : 0;
      const rightPct = maxValue > 0 ? (bar.rightValue / maxValue) * 100 : 0;
      const leftDisplay = bar.leftDisplay ?? `$${bar.leftValue.toFixed(2)}`;
      const rightDisplay = bar.rightDisplay ?? `$${bar.rightValue.toFixed(2)}`;
      return `
  <div class="comp-row">
    <div class="comp-left-value">${escapeHtml(leftDisplay)}</div>
    <div class="comp-left-track">
      <div class="comp-left-bar" style="width:${leftPct.toFixed(1)}%;"></div>
    </div>
    <div class="comp-label">${escapeHtml(bar.label)}</div>
    <div class="comp-right-track">
      <div class="comp-right-bar" style="width:${rightPct.toFixed(1)}%;"></div>
    </div>
    <div class="comp-right-value">${escapeHtml(rightDisplay)}</div>
  </div>`;
    })
    .join("");

  return `
<div class="comparison-chart">
  ${props.title ? `<div class="comparison-chart-title">${escapeHtml(props.title)}</div>` : ""}
  <div class="comparison-chart-header">
    <span>${escapeHtml(props.leftLabel)}</span>
    <span>${escapeHtml(props.rightLabel)}</span>
  </div>
  ${rowsHtml}
  ${props.source ? `<div class="comparison-chart-source">${escapeHtml(props.source)}</div>` : ""}
</div>`;
}

// ─── Playbook ─────────────────────────────────────────────────────────────────

export interface PlaybookSegment {
  title: string;              // e.g., "If You Are a Bank"
  recommendations: string[];  // bullet points
}

/**
 * 3-segment recommendation section with grid layout.
 */
export function playbook(segments: PlaybookSegment[]): string {
  const segmentsHtml = segments
    .map((seg) => {
      const items = seg.recommendations
        .map((r) => `<li>${escapeHtml(r)}</li>`)
        .join("");
      return `
  <div class="playbook-segment">
    <div class="playbook-title">${escapeHtml(seg.title)}</div>
    <ul class="playbook-list">${items}</ul>
  </div>`;
    })
    .join("");

  return `
<div class="playbook">
  <h2 class="playbook-heading">What Winning Institutions Will Do Next</h2>
  <div class="playbook-segments">${segmentsHtml}\n  </div>
</div>`;
}

// ─── Layout Wrappers ──────────────────────────────────────────────────────────

/**
 * Layout A: Analytical (left-aligned) — Chapters 1-4.
 * Default text alignment, data-forward presentation.
 */
export function layoutAnalytical(content: string): string {
  return `<div class="layout-analytical">${content}</div>`;
}

/**
 * Layout B: Statement (centered) — Executive Summary, Chapter 5, Playbook.
 * Centered stat cards, chapter dividers, and insight card rows.
 * Body text remains left-aligned for readability.
 */
export function layoutStatement(content: string): string {
  return `<div class="layout-statement">${content}</div>`;
}

// ─── Revenue Concentration Pyramid ────────────────────────────────────────────

export interface RevenuePyramidTier {
  label: string;
  description: string;
  widthPct: number;   // bar width as percentage (e.g. 30, 55, 90)
}

/**
 * Simple HTML/CSS pyramid showing revenue concentration across fee tiers.
 * Top tier is narrowest (highest impact), bottom is widest (long tail).
 */
export function revenuePyramid(tiers: RevenuePyramidTier[]): string {
  const tiersHtml = tiers
    .map((tier, i) => `
  <div class="pyramid-tier pyramid-tier-${i + 1}">
    <div class="pyramid-bar" style="width:${tier.widthPct}%;">
      <span class="pyramid-label">${escapeHtml(tier.label)}</span>
    </div>
    <span class="pyramid-desc">${escapeHtml(tier.description)}</span>
  </div>`)
    .join("");

  return `<div class="revenue-pyramid">${tiersHtml}\n</div>`;
}

// ─── Data Framework Block ─────────────────────────────────────────────────────

/**
 * Styled callout block explaining the data methodology.
 * Cream background with terracotta left border.
 */
export function dataFramework(title: string, body: string): string {
  return `
<div class="data-framework">
  <div class="data-framework-title">${escapeHtml(title)}</div>
  <div class="data-framework-body">${escapeHtml(body)}</div>
</div>`;
}

// Keep PALETTE accessible to any component that needs inline style overrides
export { PALETTE };
