import type { User } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { premiumGatePath } from "@/lib/team-billing";

/**
 * Who may read and who may start reports (James, 2026-10-20; #1999). After a subscription ends,
 * the account keeps read-only access to its own reports: it can view and download what it
 * already has, but it cannot start, re-run or regenerate one. Nobody reads another user's
 * report; only staff (admin) can read any report job.
 */

/** Shown when an account without an active subscription tries to start or re-run a report. */
export const REPORT_START_BLOCKED_MESSAGE =
  "Your Hamilton subscription isn't active, so you can't start or re-run a report. " +
  "Reports you already have are still yours to view and download. " +
  "To start a new one, subscribe at /subscribe.";

/** The owner and lifecycle state of a legacy report job (`report_jobs`). */
export interface ReportJobOwnership {
  user_id: number | string | null;
}

/**
 * Whether this user may read a report job's status or download it. The owner always may, with
 * or without a subscription (the download route still requires the job to be complete); an
 * admin may read any job, including cron jobs with no owner. Anyone else may not.
 */
export function canReadReportJob(user: User, job: ReportJobOwnership): boolean {
  if (user.role === "admin") return true;
  return job.user_id != null && Number(job.user_id) === Number(user.id);
}

/** Why a report can't be started, and where the account goes to fix it. */
export interface ReportStartRefusal {
  error: string;
  /** /subscribe, or the billing page for a lapsed payment or a lapsed team (premiumGatePath). */
  href: string;
}

/**
 * Null when the user may start or re-run a report; otherwise the message and the page that
 * fixes it. `returnTo` is where the subscribe page sends them back.
 */
export async function reportStartRefusal(
  user: User,
  returnTo: string,
): Promise<ReportStartRefusal | null> {
  if (canAccessPremium(user)) return null;
  const href = (await premiumGatePath(user, returnTo)) ?? "/subscribe";
  return { error: REPORT_START_BLOCKED_MESSAGE, href };
}
