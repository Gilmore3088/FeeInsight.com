/**
 * The Index look (homepage v2): navy words and primary buttons, white and cloud surfaces,
 * one signal green. Colour tokens live in globals.css (`--color-index-*`); these are the
 * shared class strings so every control on the page has the same corners and focus ring.
 * Corners: 4px on controls, 8px on cards.
 */

/** Page width and gutter shared by every homepage section. */
export const CONTAINER = "mx-auto w-full max-w-6xl px-4 sm:px-6";

const BUTTON_BASE =
  "inline-flex min-h-11 items-center justify-center rounded-[4px] font-medium whitespace-nowrap " +
  "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2";
const BUTTON_SIZE = "px-5 text-[15px]";
const NAVY = "bg-index-navy text-white hover:bg-index-navy-soft";

/** The one green button in a screen view. */
export const BUTTON_GREEN = `${BUTTON_BASE} ${BUTTON_SIZE} bg-index-green text-white hover:bg-index-green-dark`;
/** Navy primary. */
export const BUTTON_NAVY = `${BUTTON_BASE} ${BUTTON_SIZE} ${NAVY}`;
/** The header's navy button: a size down so it fits beside the logo and menu on a phone. */
export const BUTTON_NAVY_COMPACT = `${BUTTON_BASE} ${NAVY} px-3 text-[13px] sm:px-4 sm:text-[14px]`;
/** Outlined secondary on light surfaces. */
export const BUTTON_OUTLINE = `${BUTTON_BASE} ${BUTTON_SIZE} border border-index-navy bg-white text-index-navy hover:bg-index-cloud`;
/** The green button on the navy band. */
export const BUTTON_GREEN_ON_DARK = `${BUTTON_BASE} ${BUTTON_SIZE} bg-index-green-bright text-index-navy hover:bg-white`;

/** Text input on a light surface. */
export const INPUT =
  "block min-h-11 w-full rounded-[4px] border border-index-line bg-white px-3 text-[15px] text-index-navy " +
  "placeholder:text-index-muted focus:border-index-navy focus:outline-none focus-visible:outline-2";
/** Text input on the navy band. */
export const INPUT_ON_DARK =
  "block min-h-11 w-full rounded-[4px] border border-white/30 bg-index-navy-soft px-3 text-[15px] text-white " +
  "placeholder:text-index-muted-dark focus:border-index-green-bright focus:outline-none";

export const LABEL = "block text-[14px] font-medium text-index-navy";
export const LABEL_ON_DARK = "block text-[14px] font-medium text-white";

/** Small uppercase overline; the source text stays sentence case. */
export const OVERLINE = "text-[12px] font-medium uppercase tracking-[0.12em] text-index-green";

export const H1 = "text-balance text-[2rem] font-semibold leading-[1.1] tracking-[-0.02em] text-index-navy sm:text-[2.75rem] lg:text-[3.25rem]";
export const H2 = "text-balance text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.015em] text-index-navy sm:text-[2.25rem]";
export const LEAD = "text-pretty text-[17px] leading-relaxed text-index-muted sm:text-[18px]";
