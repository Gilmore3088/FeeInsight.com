/** Public report API. Templates must depend on primitives, never this barrel. */
export * from "./primitives";

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
