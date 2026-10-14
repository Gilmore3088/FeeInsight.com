/**
 * Dependency-leaf entry point for shared report rendering primitives.
 *
 * Template implementations import this module; external consumers may use the public index.
 *   import { wrapReport, coverPage, hamiltonNarrativeBlock } from "@/lib/report-templates/primitives";
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
  columnChart,
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
  releaseList,
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
  ColumnChartProps,
  ColumnChartColumn,
  ReleaseListGroup,
  ReleaseListItem,
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

