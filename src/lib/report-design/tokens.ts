/**
 * The one report look: every report, study, briefing, answer exhibit and alert reads its
 * colours, type and chart marks from here (README.md in this folder has the rules).
 * The palette is the site's warm/terra palette (src/app/globals.css @theme).
 */

export const RD = {
  ink: "#1A1815",
  ink2: "#3D3830",
  inkSoft: "#5A5347",
  muted: "#A09788",
  rule: "#EDE5D8",
  rule2: "#E0D7C9",
  paper: "#FFFFFF",
  cream: "#FDFBF8",
  sand: "#F5EFE6",
  terra: "#C44B2E",
  terraText: "#A93D25",
  terraDeep: "#7A2817",
  terraSoft: "#FDF0ED",
  /** Middle-half band: terra at about 16%. */
  band: "rgba(196,75,46,0.16)",
  /** Bars and dots that are context, not the subject. */
  context: "#C4B89F",
  noData: "#E0D7C9",
  /** A change for the better for the reader (used sparingly, never for a price direction). */
  good: "#4F6B3A",
  /** Six steps, light to dark, for choropleths. */
  ramp: ["#F6DDD3", "#EDB8A5", "#E09276", "#CF6A4C", "#A93D25", "#7A2817"],
  /**
   * Named institutions after the subject (terra): ink first, then three muted hues. Anything
   * past the fourth is context grey and goes in a legend, never a fifth colour.
   */
  series: ["#1A1815", "#4F7CAC", "#6B8F5E", "#8A6FA8"],
} as const;

export const RD_FONTS = {
  serif: '"Newsreader", Georgia, "Times New Roman", serif',
  sans: '"Geist", "Inter", "Helvetica Neue", system-ui, sans-serif',
  mono: '"Geist Mono", "JetBrains Mono", ui-monospace, monospace',
} as const;

/** Type sizes in CSS px. Charts use `chart` (desktop) and `chartPhone` (the narrow drawing). */
export const RD_TYPE = {
  title: 34,
  titlePhone: 28,
  headline: 23,
  deck: 17,
  body: 15,
  hero: 30,
  label: 11,
  legend: 12,
  source: 11.5,
  chart: 11.5,
  chartPhone: 12.5,
} as const;

/** Below this width the narrow chart drawing replaces the wide one. */
export const RD_PHONE_MAX = 640;
/** The viewBox widths charts are drawn at. */
export const RD_CHART_WIDTH = { wide: 960, narrow: 400 } as const;
