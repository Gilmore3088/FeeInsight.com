/**
 * Chart colours and fonts, kept for existing imports. The values live in the shared report
 * design (src/lib/report-design/tokens.ts); new code imports from there.
 *
 * The marks mean the same thing everywhere:
 * - the institution being looked at, or banks: terra (filled)
 * - credit unions: hollow ink ring
 * - a median: a dark tick
 * - the middle half of a peer group: a terra band at low opacity
 * - other institutions or context bars: warm grey
 * Labels sit on the marks (direct labels), numbers use tabular figures.
 */
import { RD, RD_FONTS } from "@/lib/report-design/tokens";

export const CHART = RD;
export const CHART_FONTS = RD_FONTS;
