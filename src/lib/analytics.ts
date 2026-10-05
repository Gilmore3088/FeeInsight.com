/**
 * Thin, dependency-free event tracking. Sends to Plausible when its script is
 * loaded (NEXT_PUBLIC_PLAUSIBLE_DOMAIN set). Before the script arrives, the root
 * layout installs the standard queue shim (`window.plausible.q`), so early events
 * are buffered and flushed by the script instead of dropped. Without the domain
 * configured there is no shim and this is a no-op. Safe on the server.
 */
export type AnalyticsEvent =
  | "create_account"
  | "request_report"
  | "see_sample_report"
  | "newsletter_signup"
  | "lead_capture_view"
  | "lead_capture_submit"
  | "lead_capture_success"
  | "lead_capture_error"
  | "checkout_start"
  | "upgrade_click"
  | "book_walkthrough"
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
  const plausible = window.plausible;
  if (typeof plausible !== "function") return;
  try {
    plausible(event, props ? { props } : undefined);
  } catch {
    // Analytics must never break the page.
  }
}
