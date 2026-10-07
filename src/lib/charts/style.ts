/**
 * One chart style for reports, PDFs and in-app answers, in the brand colours (globals.css).
 * The marks mean the same thing everywhere:
 * - the institution being looked at, or banks: terra (filled)
 * - credit unions: hollow ink ring
 * - a median: a dark tick
 * - the middle half of a peer group: a terra band at low opacity
 * - other institutions or context bars: warm grey
 * Labels sit on the marks (direct labels), numbers use tabular figures.
 */
export const CHART = {
  ink: "#1A1815",
  inkSoft: "#5A5347",
  muted: "#A09788",
  rule: "#EDE5D8",
  rule2: "#E0D7C9",
  paper: "#FFFFFF",
  terra: "#C44B2E",
  terraText: "#A93D25",
  terraSoft: "#FDF0ED",
  /** Middle-half band: terra at about 16%. */
  band: "rgba(196,75,46,0.16)",
  context: "#C4B89F",
  noData: "#E0D7C9",
  /** Six steps, light to dark, for fee choropleths. */
  ramp: ["#F6DDD3", "#EDB8A5", "#E09276", "#CF6A4C", "#A93D25", "#7A2817"],
} as const;

export const CHART_FONTS = {
  serif: '"Newsreader", Georgia, "Times New Roman", serif',
  sans: '"Geist", "Inter", "Helvetica Neue", system-ui, sans-serif',
  mono: '"Geist Mono", "JetBrains Mono", ui-monospace, monospace',
} as const;
