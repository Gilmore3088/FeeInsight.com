/**
 * Thin event tracking. Every event goes to Vercel Analytics as a custom event (the
 * <Analytics /> component in the root layout is always mounted), and also to Plausible
 * when its script is configured (NEXT_PUBLIC_PLAUSIBLE_DOMAIN set; the root layout then
 * installs the standard queue shim so early events are buffered, not dropped).
 * Safe on the server, and never throws.
 */
import { track } from "@vercel/analytics";

export type AnalyticsEvent =
  | "create_account"
  /** A submitted report request (fires only after the server accepts it). */
  | "request_report"
  /** A click on a link that leads to the report request form. */
  | "request_report_click"
  | "see_sample_report"
  | "newsletter_signup"
  | "lead_capture_view"
  | "lead_capture_submit"
  | "lead_capture_success"
  | "lead_capture_error"
  | "checkout_start"
  /** The welcome page after Stripe returns with success=true. */
  | "checkout_complete"
  | "upgrade_click"
  | "book_walkthrough"
  | "hosted_report_view"
  | "hosted_report_request"
  | "contact_sales"
  | "fee_alert_save"
  | "fee_alert_signup"
  | "fee_alert_remove";

export type AnalyticsProps = Record<string, string | number | boolean>;

type PlausibleFn = ((event: string, options?: { props?: AnalyticsProps }) => void) & {
  /** Pre-load queue populated by the inline shim; drained by the Plausible script. */
  q?: IArguments[] | unknown[][];
};

declare global {
  interface Window {
    plausible?: PlausibleFn;
  }
}

/** Inline shim rendered by the root layout when Plausible is configured. */
export const PLAUSIBLE_QUEUE_SHIM =
  "window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)}";

export function trackEvent(event: AnalyticsEvent, props?: AnalyticsProps): void {
  if (typeof window === "undefined") return;
  try {
    track(event, props);
  } catch {
    // Analytics must never break the page.
  }
  const plausible = window.plausible;
  if (typeof plausible !== "function") return;
  try {
    plausible(event, props ? { props } : undefined);
  } catch {
    // Analytics must never break the page.
  }
}
