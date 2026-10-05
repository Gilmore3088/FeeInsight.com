/**
 * Event tracking entry point for funnel events (button clicks, form submits).
 * No analytics provider is wired in yet, so this records nothing; call sites stay
 * so a provider can be connected here in one place. Safe on the server.
 */
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
  | "upgrade_click"
  | "book_walkthrough"
  | "hosted_report_view"
  | "hosted_report_request"
  | "contact_sales"
  | "fee_alert_save"
  | "fee_alert_signup"
  | "fee_alert_remove";

export type AnalyticsProps = Record<string, string | number | boolean>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function trackEvent(event: AnalyticsEvent, props?: AnalyticsProps): void {
  // Intentionally empty until an analytics provider is connected.
}
