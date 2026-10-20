/**
 * The one report look: every report, study, briefing, answer exhibit and alert reads its
 * colours, type and chart marks from here (README.md in this folder has the rules).
 * The palette is the Fee Insight brand tokens (src/brand/tokens/tokens.json, light theme):
 * Oxford Navy ink on warm paper, with brick as the one accent. Hex values come from
 * src/brand/tokens/tokens.ts; never retype them here.
 */

import { colors } from "@/brand/tokens/tokens";

const T = colors.light;

/** Blend `hex` over `base` at `amount` (0 to 1) and return a solid hex. Used for tints the tokens don't name. */
function mix(hex: string, base: string, amount: number): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = rgb(hex);
  const b = rgb(base);
  return `#${a
    .map((v, i) => Math.round(v * amount + b[i] * (1 - amount)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function alpha(hex: string, amount: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${amount})`;
}

/**
 * Key names are kept from the earlier palette so older imports compile; `terra*` is now brick.
 * ink -> ink, inkSoft -> muted, paper/cream -> surface-0, sand -> paper, rule -> surface-200,
 * rule2 -> border, terra -> brick, terraDeep -> brick-ink, terraSoft -> brick-tint,
 * good -> below-market.
 */
export const RD = {
  ink: T.ink,
  ink2: T.ink,
  inkSoft: T.muted,
  /** Tertiary text: source lines, captions. */
  muted: T["control-border"],
  rule: T["surface-200"],
  rule2: T.border,
  paper: T["surface-0"],
  cream: T["surface-0"],
  sand: T.paper,
  terra: T.brick,
  terraText: T.brick,
  terraDeep: T["brick-ink"],
  terraSoft: T["brick-tint"],
  /** Middle-half band: brick at about 16%. */
  band: alpha(T.brick, 0.16),
  /** Bars and dots that are context, not the subject: the in-range grey, lightened. */
  context: mix(T["in-range"], T["surface-0"], 0.4),
  noData: T.border,
  /** A change for the better for the reader (used sparingly, never for a price direction). */
  good: T["below-market"],
  /** Six steps, light to dark, for choropleths: brick-tint through brick to brick-ink. */
  ramp: [
    T["brick-tint"],
    mix(T.brick, T["brick-tint"], 0.35),
    mix(T.brick, T["brick-tint"], 0.7),
    T.brick,
    mix(T["brick-ink"], T.brick, 0.5),
    T["brick-ink"],
  ],
  /** Five steps, far lower to far higher than a price: below-market green, context grey, brick. */
  diverging: [
    T["below-market"],
    mix(T["below-market"], T["surface-0"], 0.45),
    mix(T["in-range"], T["surface-0"], 0.4),
    mix(T.brick, T["surface-0"], 0.45),
    T.brick,
  ],
  /**
   * Named institutions after the subject (brick): ink first, then three muted hues. Anything
   * past the fourth is context grey and goes in a legend, never a fifth colour. Blue and
   * purple are categorical only; the brand tokens name no third and fourth series hue.
   */
  series: [T.ink, "#4F7CAC", T["below-market"], "#8A6FA8"],
} as const;

/** Geist for everything, Geist Mono for figures (the site's fonts, src/app/layout.tsx). */
export const RD_FONTS = {
  /** Titles and headlines. Geist, heavier weight; the brand has no serif. */
  display: '"Geist", "Inter", "Helvetica Neue", system-ui, sans-serif',
  /** Deprecated alias of `display`, kept for chart code that still asks for `font: "serif"`. Geist, not a serif. */
  serif: '"Geist", "Inter", "Helvetica Neue", system-ui, sans-serif',
  sans: '"Geist", "Inter", "Helvetica Neue", system-ui, sans-serif',
  mono: '"Geist Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
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

/** The same palette under the names the React-PDF briefing uses (src/components/hamilton/reports). */
export const RD_PDF = {
  textPrimary: RD.ink,
  textSecondary: RD.inkSoft,
  textTertiary: RD.muted,
  accent: RD.terraText,
  surface: RD.cream,
  surfaceElevated: RD.sand,
  borderDark: RD.rule2,
} as const;

/** React-PDF chart marks: the bank in brick, peers' middle half as a light brick band, context bars grey. */
export const RD_PDF_CHART = {
  ink: RD.ink,
  muted: RD.inkSoft,
  faint: RD.muted,
  accent: RD.terra,
  band: mix(T.brick, T["surface-0"], 0.16),
  bar: RD.context,
  rule: RD.rule2,
} as const;
