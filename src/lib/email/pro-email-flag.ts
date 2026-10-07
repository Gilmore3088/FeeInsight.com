/**
 * The switch for Pro emails: watchlist fee-change alerts and the Monday digest. Off unless
 * PRO_EMAILS_ENABLED is exactly "true", "1" or "on". While it is off, the runs still count
 * who would get each email and render it, but nothing is sent and no Pro reader's
 * high-water mark moves. The free fee-change alerts are not behind this switch.
 */
export function isProEmailSendingEnabled(): boolean {
  const value = (process.env.PRO_EMAILS_ENABLED || "").trim().toLowerCase();
  return value === "true" || value === "1" || value === "on";
}

export const PRO_EMAILS_OFF_REASON = "PRO_EMAILS_ENABLED is off, so Pro emails are counted and rendered but not sent.";
