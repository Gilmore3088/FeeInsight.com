/**
 * States whose report James is waiting to review. Their state lane runs right after a
 * failed-lane retry and ahead of routine passes, and refreshLanePriorities gives them
 * REPORT_REQUEST_PRIORITY, because work other agents queued for the state (Knox re-reads,
 * Magellan re-searches) waits on that lane (coordinator, 2026-10-07: Tennessee's lane sat
 * queued for over 7 hours behind higher-scored states). Each entry ends on its own after
 * `until` (#1117: the Tennessee boost had no end date); remove a state sooner once its
 * report is reviewed.
 */
export interface ReportReviewState {
  stateCode: string;
  /** The boost ends on its own after this day (UTC, inclusive). */
  until: string;
}

export const REPORT_REVIEW_REQUESTS: readonly ReportReviewState[] = [
  { stateCode: "TN", until: "2026-10-19" },
];

/** State codes whose report-review boost is still in force on `now`. */
export function reportReviewStates(
  now: Date = new Date(),
  requests: readonly ReportReviewState[] = REPORT_REVIEW_REQUESTS,
): string[] {
  const day = now.toISOString().slice(0, 10);
  return requests.filter((request) => day <= request.until).map((request) => request.stateCode.toUpperCase());
}
