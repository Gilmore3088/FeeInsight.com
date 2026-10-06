/**
 * Report template palette, typography, and inline CSS constants.
 *
 * All color references in REPORT_CSS use PALETTE interpolation to ensure
 * consistency if the palette changes. Reports are standalone HTML files
 * rendered by Playwright to PDF — no Next.js CSS variables available.
 */

export const PALETTE = {
  text: "#1A1815",           // warm black — all body copy
  textSecondary: "#7A7062",  // secondary text
  textMuted: "#A09788",      // labels, captions, footnotes
  background: "#FDFBF8",     // cream page background
  sectionBg: "#F5EFE6",      // alternating section background
  accent: "#C44B2E",         // terracotta — section labels, highlights
  accentLight: "#FDF0ED",    // terracotta tint — callout backgrounds
  border: "#E8DFD1",         // warm border — cards, tables
  borderLight: "#F0E8DC",    // lighter border — table rows
  textDark2: "#2D2A26",      // heading level 2
  textDark3: "#3D3830",      // heading level 3
} as const;

export const TYPOGRAPHY = {
  // Newsreader loads via @import in REPORT_CSS — fallback for pre-load
  serif: '"Newsreader", "Georgia", "Times New Roman", serif',
  sans: '"Inter", "Helvetica Neue", system-ui, -apple-system, sans-serif',
  mono: '"JetBrains Mono", "Courier New", monospace',
} as const;

export const REPORT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500;1,600&display=swap');

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: ${TYPOGRAPHY.sans};
  color: ${PALETTE.text};
  background: ${PALETTE.background};
  line-height: 1.6;
  max-width: 800px;
  margin: 0 auto;
  padding: 48px 32px;
}

/* Headings never leave one word on its own line; body text avoids orphan words. */
h1, h2, h3, h4,
.report-cover-title, .report-heading, .chapter-title, .chapter-divider-title, .playbook-heading {
  text-wrap: balance;
}

p, li, .report-narrative, .finding-detail, .figure-finding-detail, .footnote {
  text-wrap: pretty;
}

/* Cover page */
.report-cover {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${PALETTE.background};
  border-bottom: 3px solid ${PALETTE.accent};
  padding: 80px 48px;
  margin: -48px -32px 48px;
}

.report-cover-inner {
  max-width: 600px;
  width: 100%;
}

.report-cover-label {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: ${PALETTE.accent};
  margin-bottom: 24px;
}

.report-cover-title {
  font-family: ${TYPOGRAPHY.serif};
  font-size: 40px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: ${PALETTE.text};
  margin-bottom: 16px;
}

.report-cover-subtitle {
  font-family: ${TYPOGRAPHY.serif};
  font-size: 18px;
  font-weight: 400;
  font-style: italic;
  color: ${PALETTE.textSecondary};
  margin-bottom: 40px;
  line-height: 1.5;
}

.report-cover-meta {
  display: flex;
  gap: 24px;
  font-family: ${TYPOGRAPHY.sans};
  font-size: 11px;
  color: ${PALETTE.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border-top: 1px solid ${PALETTE.border};
  padding-top: 16px;
}

/* Section container */
.report-section {
  padding: 40px 0;
  border-top: 1px solid ${PALETTE.border};
}

.report-section:first-of-type {
  border-top: none;
}

/* Section header */
.report-section-header {
  margin-bottom: 24px;
}

.report-section-label {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: ${PALETTE.accent};
  margin-bottom: 8px;
}

.report-heading {
  font-family: ${TYPOGRAPHY.serif};
  font-size: 24px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.01em;
  color: ${PALETTE.text};
  margin-bottom: 8px;
}

.report-subheading {
  font-family: ${TYPOGRAPHY.serif};
  font-size: 18px;
  font-weight: 400;
  font-style: italic;
  color: ${PALETTE.textDark2};
  line-height: 1.4;
}

/* Body narrative */
.report-narrative {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 15px;
  line-height: 1.75;
  color: ${PALETTE.text};
  margin-bottom: 16px;
}

.report-narrative:last-child {
  margin-bottom: 0;
}

/* Pull quote */
.report-pull-quote {
  font-family: ${TYPOGRAPHY.serif};
  font-size: 20px;
  font-weight: 400;
  font-style: italic;
  line-height: 1.5;
  color: ${PALETTE.text};
  background: ${PALETTE.accentLight};
  border-left: 4px solid ${PALETTE.accent};
  padding: 20px 24px;
  margin: 32px 0;
  border-radius: 0 4px 4px 0;
}

/* Hamilton narrative block */
.hamilton-block {
  border-left: 3px solid ${PALETTE.accent};
  padding-left: 20px;
  margin: 24px 0;
}

.hamilton-block .report-narrative {
  color: ${PALETTE.text};
}

/* Data table */
.report-table-wrapper {
  margin: 24px 0;
  overflow-x: auto;
}

.report-table-caption {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${PALETTE.textMuted};
  margin-bottom: 8px;
}

.report-table {
  width: 100%;
  border-collapse: collapse;
  font-family: ${TYPOGRAPHY.sans};
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.report-table thead tr {
  border-bottom: 1px solid ${PALETTE.border};
}

.report-table th {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${PALETTE.textMuted};
  font-weight: 600;
  padding: 7px 12px;
  text-align: left;
}

.report-table td {
  padding: 7px 12px;
  border-bottom: 1px solid ${PALETTE.borderLight};
  color: ${PALETTE.text};
}

.report-table tbody tr:last-child td {
  border-bottom: none;
}

/* Chart container */
.chart-container {
  margin: 24px 0;
}

.chart-container img {
  display: block;
  max-width: 100%;
  height: auto;
}

.chart-placeholder {
  border: 1px dashed ${PALETTE.border};
  border-radius: 4px;
  background: ${PALETTE.sectionBg};
}

.chart-placeholder-inner {
  padding: 48px 24px;
  text-align: center;
  font-family: ${TYPOGRAPHY.sans};
  font-size: 12px;
  color: ${PALETTE.textMuted};
  font-style: italic;
}

.chart-caption {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 11px;
  color: ${PALETTE.textMuted};
  margin-top: 8px;
  font-style: italic;
}

/* Footnote */
.footnote {
  margin-top: 40px;
  padding-top: 16px;
  border-top: 1px solid ${PALETTE.borderLight};
  font-family: ${TYPOGRAPHY.sans};
  font-size: 11px;
  color: ${PALETTE.textMuted};
  font-style: italic;
  line-height: 1.6;
}

/* Page break (print) */
.page-break {
  page-break-after: always;
  break-after: page;
  height: 0;
  margin: 0;
  padding: 0;
}

/* Stat cards */
.stat-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 16px;
  margin: 24px 0;
}

.stat-card {
  background: ${PALETTE.sectionBg};
  border: 1px solid ${PALETTE.border};
  border-radius: 6px;
  padding: 20px 18px;
}

.stat-card-label {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: ${PALETTE.textSecondary};
  margin-bottom: 8px;
}

.stat-card-value {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 30px;
  font-weight: 700;
  line-height: 1;
  color: ${PALETTE.text};
  font-variant-numeric: tabular-nums;
  margin-bottom: 6px;
}

.stat-card-delta {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 10px;
  color: ${PALETTE.textSecondary};
  font-variant-numeric: tabular-nums;
}

.stat-delta-accent {
  color: ${PALETTE.accent};
}

.stat-card-source {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 10px;
  color: ${PALETTE.textMuted};
  margin-top: 6px;
  font-style: italic;
}

/* Key finding callout */
.key-finding {
  border-left: 3px solid ${PALETTE.accent};
  background: ${PALETTE.accentLight};
  border-radius: 0 4px 4px 0;
  padding: 14px 18px;
  margin: 20px 0;
}

.key-finding-label {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: ${PALETTE.accent};
  margin-bottom: 6px;
}

.key-finding-text {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 15px;
  font-weight: 500;
  color: ${PALETTE.text};
  line-height: 1.5;
}

/* Horizontal bar chart */
.h-bar-chart {
  margin: 24px 0;
}

.h-bar-title {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: ${PALETTE.textSecondary};
  margin-bottom: 12px;
}

.h-bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.h-bar-label {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 10px;
  color: ${PALETTE.textDark3};
  width: 140px;
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.h-bar-track {
  flex: 1;
  background: ${PALETTE.border};
  border-radius: 4px;
  height: 8px;
  overflow: hidden;
}

.h-bar-fill {
  height: 100%;
  background: ${PALETTE.accent};
  border-radius: 4px;
  transition: width 0.2s ease;
}

.h-bar-value {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 10px;
  color: ${PALETTE.textDark3};
  font-variant-numeric: tabular-nums;
  width: 48px;
  text-align: right;
  flex-shrink: 0;
}

.h-bar-source {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 9px;
  color: ${PALETTE.textMuted};
  margin-top: 10px;
  font-style: italic;
}

/* Column chart (stacked) */
.col-chart {
  margin: 24px 0;
  --col-seg-0: ${PALETTE.accent};
  --col-seg-1: #E3A98F;
  --col-seg-2: ${PALETTE.border};
}

.col-chart-legend {
  display: flex;
  gap: 16px;
  font-family: ${TYPOGRAPHY.sans};
  font-size: 9px;
  color: ${PALETTE.textDark3};
  margin-bottom: 10px;
}

.col-chart-legend i {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  margin-right: 5px;
  vertical-align: -1px;
}

.col-chart-cols {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  border-bottom: 1px solid ${PALETTE.border};
}

.col-chart-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
}

.col-chart-value {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 9px;
  font-weight: 600;
  color: ${PALETTE.textDark3};
  font-variant-numeric: tabular-nums;
  margin-bottom: 4px;
}

.col-chart-plot {
  height: 150px;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.col-chart-bar {
  width: 70%;
  display: flex;
  flex-direction: column;
  border-radius: 3px 3px 0 0;
  overflow: hidden;
}

.col-chart-seg {
  width: 100%;
}

.col-chart-label {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 9px;
  color: ${PALETTE.textDark3};
  margin-top: 6px;
  white-space: nowrap;
}

.col-chart-note {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 8px;
  color: ${PALETTE.textMuted};
  font-variant-numeric: tabular-nums;
}

/* Two-column layout */
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin: 24px 0;
}

/* Chapter divider */
.chapter-divider {
  border-top: 3px solid ${PALETTE.accent};
  padding-top: 24px;
  margin: 48px 0 32px;
}

.chapter-number,
.chapter-divider-number {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: ${PALETTE.accent};
  margin-bottom: 8px;
}

.chapter-title,
.chapter-divider-title {
  font-family: ${TYPOGRAPHY.serif};
  font-size: 24px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: ${PALETTE.text};
}

/* Table of contents — single page, compact, proper hierarchy */
.toc {
  max-width: 600px;
  margin: 0 auto;
  padding-top: 32px;
}

.toc-section-label {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 10px;
  font-weight: 700;
  color: ${PALETTE.textSecondary};
  margin-bottom: 4px;
  margin-top: 16px;
}

.toc-section-label:first-child {
  margin-top: 0;
}

.toc-entry {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 0;
}

.toc-entry-numbered {
  padding: 6px 0;
}

.toc-chapter-num {
  font-family: ${TYPOGRAPHY.serif};
  font-size: 28px;
  font-weight: 300;
  color: ${PALETTE.border};
  min-width: 36px;
  flex-shrink: 0;
  line-height: 1;
}

.toc-entry-body {
  flex: 1;
  min-width: 0;
}

.toc-entry-title-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.toc-entry-title {
  font-family: ${TYPOGRAPHY.serif};
  font-size: 14px;
  font-weight: 600;
  color: ${PALETTE.text};
  white-space: nowrap;
  flex-shrink: 0;
}

.toc-leader {
  flex: 1;
  border-bottom: 1px dotted ${PALETTE.textMuted};
  min-width: 20px;
  position: relative;
  top: -3px;
}

.toc-entry-page {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 13px;
  color: ${PALETTE.textMuted};
  min-width: 20px;
  text-align: right;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.toc-entry-desc {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 11px;
  color: ${PALETTE.textMuted};
  margin-top: 1px;
}

/* Compact table */
.compact-table {
  width: 100%;
  border-collapse: collapse;
  font-family: ${TYPOGRAPHY.sans};
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  break-inside: auto;
  page-break-inside: auto;
}

.compact-table thead tr {
  border-bottom: 1px solid ${PALETTE.border};
}

.compact-table th {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${PALETTE.textMuted};
  font-weight: 600;
  padding: 6px 12px;
  text-align: left;
}

.compact-table td {
  padding: 8px 12px;
  border-bottom: 1px solid ${PALETTE.borderLight};
  color: ${PALETTE.text};
}

.compact-table tbody tr {
  break-inside: avoid;
  page-break-inside: avoid;
}

.compact-table tbody tr:last-child td {
  border-bottom: none;
}

/* Trend indicators */
.trend-up {
  color: #16a34a;
}

.trend-down {
  color: ${PALETTE.accent};
}

.trend-flat {
  color: ${PALETTE.textSecondary};
}

/* Numbered findings list */
.numbered-findings {
  margin: 24px 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.finding {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.finding-number {
  font-family: ${TYPOGRAPHY.serif};
  font-size: 28px;
  font-weight: 600;
  color: ${PALETTE.accent};
  line-height: 1;
  min-width: 36px;
  flex-shrink: 0;
}

.finding-title {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 14px;
  font-weight: 700;
  color: ${PALETTE.text};
  margin-bottom: 4px;
}

.finding-detail {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 13px;
  color: ${PALETTE.textSecondary};
  line-height: 1.6;
}

/* So What Box */
.so-what-box {
  background: ${PALETTE.text};
  color: #fff;
  border-radius: 6px;
  padding: 18px 20px;
  margin: 24px 0;
}

.so-what-label {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: ${PALETTE.accent};
  margin-bottom: 6px;
}

.so-what-text {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 14px;
  font-weight: 500;
  line-height: 1.5;
  color: #fff;
}

/* Insight Cards */
.insight-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin: 24px 0;
}

.insight-card {
  background: ${PALETTE.sectionBg};
  border: 1px solid ${PALETTE.border};
  border-radius: 8px;
  padding: 24px 20px;
  text-align: center;
}

.insight-card-number {
  font-family: ${TYPOGRAPHY.serif};
  font-size: 36px;
  font-weight: 600;
  color: ${PALETTE.accent};
  line-height: 1;
  margin-bottom: 8px;
}

.insight-card-insight {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 15px;
  font-weight: 600;
  color: ${PALETTE.text};
  margin-bottom: 6px;
}

.insight-card-supporting {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 12px;
  color: ${PALETTE.textSecondary};
  font-style: italic;
}

/* Comparison Chart (butterfly/tornado) */
.comparison-chart {
  margin: 24px 0;
}

.comparison-chart-title {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: ${PALETTE.textSecondary};
  margin-bottom: 12px;
}

.comparison-chart-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-family: ${TYPOGRAPHY.sans};
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${PALETTE.textSecondary};
}

.comp-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
  height: 24px;
}

.comp-left-track {
  flex: 1;
  display: flex;
  justify-content: flex-end;
  height: 8px;
}

.comp-left-bar {
  height: 100%;
  background: ${PALETTE.accent};
  border-radius: 4px;
}

.comp-label {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 10px;
  color: ${PALETTE.textDark3};
  width: 120px;
  text-align: center;
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.comp-right-track {
  flex: 1;
  display: flex;
  justify-content: flex-start;
  height: 8px;
}

.comp-right-bar {
  height: 100%;
  background: #3B82F6;
  border-radius: 4px;
}

.comp-left-value {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 10px;
  color: ${PALETTE.textDark3};
  font-variant-numeric: tabular-nums;
  width: 48px;
  text-align: right;
  flex-shrink: 0;
}

.comp-right-value {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 10px;
  color: ${PALETTE.textDark3};
  font-variant-numeric: tabular-nums;
  width: 48px;
  text-align: left;
  flex-shrink: 0;
}

.comparison-chart-source {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 9px;
  color: ${PALETTE.textMuted};
  margin-top: 10px;
  font-style: italic;
}

/* Playbook */
.playbook {
  margin: 32px 0;
}

.playbook-heading {
  font-family: ${TYPOGRAPHY.serif};
  font-size: 20px;
  font-weight: 600;
  color: ${PALETTE.text};
  margin-bottom: 20px;
}

.playbook-segments {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin: 24px 0;
}

.playbook-segment {
  background: ${PALETTE.sectionBg};
  border: 1px solid ${PALETTE.border};
  border-radius: 6px;
  padding: 20px;
}

.playbook-title {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: ${PALETTE.accent};
  margin-bottom: 12px;
}

.playbook-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.playbook-list li {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 13px;
  color: ${PALETTE.text};
  line-height: 1.6;
  margin-bottom: 6px;
  padding-left: 12px;
  position: relative;
}

.playbook-list li::before {
  content: "\\2022";
  position: absolute;
  left: 0;
  color: ${PALETTE.accent};
}

/* Layout wrappers */
.layout-analytical {
  text-align: left;
}

.layout-statement {
  text-align: left;
}

.layout-statement .stat-cards {
  justify-content: center;
}

.layout-statement .chapter-divider {
  text-align: center;
}

.layout-statement .insight-cards {
  justify-content: center;
}

/* Revenue concentration pyramid */
.revenue-pyramid {
  max-width: 500px;
  margin: 24px auto;
}

.pyramid-tier {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.pyramid-bar {
  background: ${PALETTE.accent};
  height: 40px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  padding: 0 12px;
}

.pyramid-tier-1 .pyramid-bar {
  opacity: 1.0;
}

.pyramid-tier-2 .pyramid-bar {
  opacity: 0.6;
}

.pyramid-tier-3 .pyramid-bar {
  opacity: 0.3;
}

.pyramid-label {
  color: #fff;
  font-family: ${TYPOGRAPHY.sans};
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.pyramid-desc {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 11px;
  color: ${PALETTE.textSecondary};
  white-space: nowrap;
}

/* Data framework block */
.data-framework {
  background: ${PALETTE.sectionBg};
  border-left: 3px solid ${PALETTE.accent};
  padding: 20px 24px;
  border-radius: 0 8px 8px 0;
  margin: 20px 0;
}

.data-framework-title {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 11px;
  font-weight: 700;
  color: ${PALETTE.textDark3};
  margin-bottom: 6px;
}

.data-framework-body {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 12px;
  color: ${PALETTE.textSecondary};
  line-height: 1.7;
}

/* Figure-led findings (state report key findings) */
.figure-findings {
  margin: 8px 0 0;
}

.figure-finding {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 20px;
  align-items: baseline;
  padding: 16px 0;
  border-top: 1px solid ${PALETTE.borderLight};
}

.figure-finding:first-child {
  border-top: none;
  padding-top: 0;
}

.figure-finding-figure {
  font-family: ${TYPOGRAPHY.serif};
  font-size: 30px;
  font-weight: 600;
  line-height: 1;
  color: ${PALETTE.accent};
  font-variant-numeric: tabular-nums;
}

.figure-finding-headline {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 15px;
  font-weight: 700;
  color: ${PALETTE.text};
  margin-bottom: 4px;
}

.figure-finding-detail {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 13px;
  color: ${PALETTE.textSecondary};
  line-height: 1.6;
}

/* Position against national: diverging bars around the national median */
.position-chart {
  margin: 16px 0 0;
}

.position-row {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr) 190px;
  gap: 14px;
  align-items: center;
  padding: 5px 0;
}

.position-label {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 12px;
  font-weight: 600;
  color: ${PALETTE.text};
}

.position-small {
  font-weight: 400;
  font-size: 10px;
  color: ${PALETTE.textMuted};
}

.position-track {
  position: relative;
  height: 14px;
}

.position-axis {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  background: ${PALETTE.textMuted};
}

.position-bar {
  position: absolute;
  top: 3px;
  height: 8px;
}

.position-bar-up {
  left: 50%;
  background: ${PALETTE.accent};
  opacity: 0.75;
  border-radius: 0 4px 4px 0;
}

.position-bar-down {
  right: 50%;
  background: #7A7F3F;
  opacity: 0.75;
  border-radius: 4px 0 0 4px;
}

.position-dot {
  position: absolute;
  top: 3px;
  left: calc(50% - 4px);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${PALETTE.textMuted};
}

.position-value {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 11px;
  color: ${PALETTE.textDark3};
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.position-up { color: #A93D25; font-weight: 700; }
.position-down { color: #4F6B3A; font-weight: 700; }
.position-flat { color: ${PALETTE.textMuted}; font-weight: 700; }

.position-scale {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr) 190px;
  gap: 14px;
  margin-top: 6px;
  font-family: ${TYPOGRAPHY.sans};
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${PALETTE.textMuted};
}

.position-scale-axis {
  display: flex;
  justify-content: space-between;
}

/* Exhibit source line and empty-data statement */
.exhibit-source {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 10px;
  color: ${PALETTE.textMuted};
  margin-top: 10px;
  font-style: italic;
}

.report-empty {
  font-family: ${TYPOGRAPHY.sans};
  font-size: 13px;
  color: ${PALETTE.textSecondary};
  border: 1px dashed ${PALETTE.border};
  border-radius: 6px;
  padding: 16px 18px;
}

/*
 * Print. Rules that keep every page used:
 * - The page is white; the cream screen background would print as a box on each page.
 * - The cover is exactly one page and nothing else shares it.
 * - Headings and labels never end a page: each stays with the first block that follows.
 * - Sections flow; no rule forces a page break that would strand white space, except the
 *   cover and table of contents, and pageBreak() where a template asks for one.
 * - Small blocks (cards, callouts, chart rows) are not split; long tables split between
 *   rows and repeat their header row.
 */
@media print {
  @page {
    size: letter;
    margin: 18mm 16mm;
  }

  html,
  body {
    background: #fff;
  }

  body {
    padding: 0;
    max-width: none;
    margin: 0;
  }

  .report-cover {
    /* Letter content height is about 243mm at these margins; stay safely inside one page. */
    min-height: 0;
    height: 225mm;
    margin: 0;
    padding: 0 12mm;
    break-after: page;
    page-break-after: always;
    break-inside: avoid;
    overflow: hidden;
  }

  .toc {
    break-after: page;
    page-break-after: always;
  }

  .report-section {
    padding: 28px 0 0;
    border-top: none;
  }

  .report-section + .report-section {
    margin-top: 12px;
    border-top: 1px solid ${PALETTE.border};
  }

  /* Headings stay with what follows them. */
  h1, h2, h3, h4,
  .report-section-header,
  .report-section-label,
  .chapter-divider,
  .report-table-caption,
  .h-bar-title,
  .col-chart-legend,
  .comparison-chart-title,
  .comparison-chart-header,
  .playbook-heading {
    break-after: avoid;
    page-break-after: avoid;
  }

  .report-section-header,
  .chapter-divider {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .chapter-divider {
    margin-top: 32px;
  }

  .stat-cards,
  .h-bar-chart,
  .col-chart,
  .finding,
  .figure-finding,
  .position-row,
  .comp-row,
  .key-finding,
  .numbered-findings,
  .hamilton-block,
  .so-what-box,
  .insight-card,
  .comparison-chart,
  .playbook-segment,
  .data-framework,
  .revenue-pyramid,
  .report-pull-quote,
  .report-empty {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* Tables flow across pages between rows rather than jumping whole to the next page. */
  .report-table-wrapper {
    overflow: visible;
    break-inside: auto;
    page-break-inside: auto;
  }

  /* Figures stay on one line; the first (label) column takes the remaining width. */
  .report-table th,
  .report-table td {
    padding: 6px 8px;
  }

  .report-table td + td,
  .compact-table td + td {
    white-space: nowrap;
  }

  .report-table-wrapper.report-table-short {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .report-table thead,
  .compact-table thead {
    display: table-header-group;
  }

  .report-table tr,
  .compact-table tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .exhibit-source,
  .footnote {
    break-before: avoid;
    page-break-before: avoid;
  }
}
`;
