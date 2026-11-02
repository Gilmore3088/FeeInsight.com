/**
 * The Hamilton dashboard kit (Command center redesign, Nov 2026). Client components take plain,
 * serialisable props (formats are named strings, not functions); data is read on the server.
 */
export { DashboardCard } from "./DashboardCard";
export { KpiCard, type KpiCardProps, type KpiTone } from "./KpiCard";
export { Sparkline } from "./Sparkline";
export { TrendChart, yearOnYear, type TrendSeries } from "./TrendChart";
export {
  FeePositionChart,
  countPositions,
  furthestAbove,
  medianGap,
  sortFeeRows,
  type FeePositionCounts,
  type FeePositionDatum,
  type FeePositionFilter,
  type FeePositionSort,
} from "./FeePositionChart";
export { PositionDonut, donutArcs, type DonutPosition } from "./PositionDonut";
export { SegmentedControl, type SegmentOption } from "./SegmentedControl";
export { FilterChips, type FilterChipOption } from "./FilterChips";
export { SortableTable, sortRows, columnExtremes, type SortableColumn, type SortableRow, type SortDirection } from "./SortableTable";
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
