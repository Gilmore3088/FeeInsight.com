/**
 * States whose report James is waiting to review. Their state lane runs right after a
 * failed-lane retry and ahead of routine passes, and refreshLanePriorities gives them
 * REPORT_REQUEST_PRIORITY, because work other agents queued for the state (Knox re-reads,
 * Magellan re-searches) waits on that lane (coordinator, 2026-10-07: Tennessee's lane sat
 * queued for over 7 hours behind higher-scored states). Remove a state once its report
 * is reviewed.
 */
export const REPORT_REVIEW_STATES: readonly string[] = ["TN"];
