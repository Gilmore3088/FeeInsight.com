/**
 * The one form style for Fee Insight's utility pages: sign in, register, password, account,
 * billing, welcome, email preferences, invitations and legal. Built on the design system tokens
 * (src/brand): navy is the main action, brick is the accent (links, focus ring, errors), inputs
 * use the 3:1 control border, and every control is at least 44px tall for touch.
 *
 * Plain class strings, so client forms can import them without pulling in any page chrome.
 */

export const UTILITY_H1 =
  "text-[1.75rem] font-extrabold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[2rem]";
export const UTILITY_LEDE = "mt-2 text-[15px] leading-relaxed text-ink-soft";

/** A card that holds a form or a short message. */
export const UTILITY_CARD = "rounded-xl border border-border bg-surface-0 p-6 shadow-sm sm:p-7";
export const UTILITY_FORM = `${UTILITY_CARD} space-y-5`;

export const UTILITY_LABEL = "mb-1.5 block text-[13px] font-medium text-ink";
export const UTILITY_INPUT =
  "block min-h-11 w-full rounded-md border border-control-border bg-surface-0 px-3 text-[16px] text-ink placeholder:text-ink-muted sm:text-[15px] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brick disabled:opacity-60";
/** Inputs are 16px on phones so iOS does not zoom in on focus. Native selects keep the browser's arrow; only the box matches the inputs. */
export const UTILITY_SELECT = `${UTILITY_INPUT} pr-8`;
export const UTILITY_HINT = "mt-1.5 text-[12px] leading-snug text-ink-muted";

/** A group heading inside a form ("About your organization"). */
export const UTILITY_FIELDSET_TITLE = "text-[13px] font-semibold text-ink";

const BUTTON_BASE =
  "inline-flex min-h-11 items-center justify-center rounded-md px-5 text-[15px] font-semibold no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brick disabled:cursor-not-allowed disabled:opacity-50";

export type UtilityButtonVariant = "primary" | "secondary" | "brick";

/**
 * primary = navy, the page's main action; secondary = outlined, everything else;
 * brick = the accent, for the main action on a navy band where navy would disappear.
 */
export function utilityButton(variant: UtilityButtonVariant = "primary", options: { block?: boolean } = {}): string {
  const tone = {
    primary: "bg-ink text-on-ink hover:bg-ink/90",
    secondary: "border border-control-border bg-surface-0 text-ink hover:bg-surface-200",
    brick: "bg-brick text-on-brick hover:bg-brick-ink",
  }[variant];
  return [BUTTON_BASE, tone, options.block ? "w-full" : ""].filter(Boolean).join(" ");
}

/** The full-width submit button every form ends with. */
export const UTILITY_SUBMIT = utilityButton("primary", { block: true });

export const UTILITY_LINK = "font-medium text-brick underline-offset-2 hover:underline";
/** Quiet links under a form ("Back to sign in"). */
export const UTILITY_QUIET_LINK = "font-medium text-ink underline-offset-2 hover:underline";

export type UtilityNoticeTone = "error" | "success" | "info";

const NOTICE_TONE: Record<UtilityNoticeTone, string> = {
  error: "border-brick/30 bg-brick-tint/40 text-brick-ink",
  success: "border-below-market/30 bg-below-market/10 text-ink",
  info: "border-border bg-paper text-ink",
};

/** An inline message: a form error, a confirmation or a note. */
export function utilityNotice(tone: UtilityNoticeTone): string {
  return `rounded-md border px-3.5 py-2.5 text-[14px] leading-snug ${NOTICE_TONE[tone]}`;
}
