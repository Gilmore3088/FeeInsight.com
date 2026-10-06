/**
 * Public entry point for the report template system.
 *
 * Import from here rather than from individual base files:
 *   import { wrapReport, coverPage, hamiltonNarrativeBlock } from "@/lib/report-templates";
 */

export { wrapReport } from "./base/layout";
export type { ReportMetadata } from "./base/layout";

export {
  coverPage,
  sectionHeader,
  dataTable,
  chartContainer,
  pullQuote,
  footnote,
  hamiltonNarrativeBlock,
  pageBreak,
  statCardRow,
  keyFinding,
  horizontalBarChart,
  twoColumn,
  chapterDivider,
  tableOfContents,
  compactTable,
  trendIndicator,
  numberedFindings,
  soWhatBox,
  insightCard,
  insightCardRow,
  comparisonChart,
  playbook,
  layoutAnalytical,
  layoutStatement,
  revenuePyramid,
  dataFramework,
  figureFindings,
  reportSection,
  emptyNotice,
  escapeHtml,
} from "./base/components";

export type {
  CoverPageProps,
  SectionHeaderProps,
  DataTableProps,
  DataTableColumn,
  ChartContainerProps,
  StatCard,
  BarChartBar,
  HorizontalBarChartProps,
  TocEntry,
  NumberedFinding,
  InsightCardProps,
  ComparisonChartProps,
  ComparisonChartBar,
  PlaybookSegment,
  RevenuePyramidTier,
  FigureFinding,
} from "./base/components";

export { PALETTE, TYPOGRAPHY, REPORT_CSS } from "./base/styles";

// ─── Report Templates ──────────────────────────────────────────────────────────

export { renderPeerCompetitiveReport } from "./templates/peer-competitive";
export type { PeerCompetitiveReportInput } from "./templates/peer-competitive";

export { renderNationalOverviewReport } from "./templates/national-overview";
export type { NationalOverviewReportInput } from "./templates/national-overview";

export { renderNationalQuarterlyReport } from "./templates/national-quarterly";
export type { NationalQuarterlyReportInput } from "./templates/national-quarterly";

export { renderStateFeeIndexReport } from "./templates/state-fee-index";
export type { StateFeeIndexReportInput } from "./templates/state-fee-index";

export { renderMonthlyPulseReport } from "./templates/monthly-pulse";
export type { MonthlyPulseReportInput } from "./templates/monthly-pulse";
