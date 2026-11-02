/**
 * The Hamilton dashboard kit (Command center redesign, Nov 2026). Client components take plain,
 * serialisable props (formats are named strings, not functions); data is read on the server.
 */
export { DashboardCard } from "./DashboardCard";
export { KpiCard, type KpiCardProps, type KpiTone } from "./KpiCard";
export { Sparkline } from "./Sparkline";
export { TrendChart } from "./TrendChart";
export { FeePositionChart } from "./FeePositionChart";
export { PositionDonut } from "./PositionDonut";
export { SegmentedControl, type SegmentOption } from "./SegmentedControl";
export { FilterChips, type FilterChipOption } from "./FilterChips";
export { SortableTable } from "./SortableTable";
export { PriceHistogram, type HistogramBin } from "./PriceHistogram";
export { StateTileMap, type StateTile } from "./StateTileMap";
// Pure helpers and shapes, callable from server components.
export {
  columnExtremes,
  countPositions,
  donutArcs,
  furthestAbove,
  LABEL_SORT_KEY,
  medianGap,
  pageOf,
  sortFeeRows,
  sortRows,
  trendPoints,
  yearOnYear,
  type DonutPosition,
  type FeePositionCounts,
  type FeePositionDatum,
  type FeePositionFilter,
  type FeePositionSort,
  type SortableColumn,
  type SortableRow,
  type SortDirection,
  type TrendSeries,
} from "./kit-math";
export {
  DASH,
  feePosition,
  formatFigure,
  quarterLabel,
  shortQuarterLabel,
  signedMoney,
  POSITION_LABEL,
  POSITION_MARK,
  type FeePosition,
  type FigureFormat,
} from "./format";
