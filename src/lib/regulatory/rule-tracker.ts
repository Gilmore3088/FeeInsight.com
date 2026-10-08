import { trackerStage, type TrackerStage } from "./federal-register";

/**
 * The Federal view's rulemaking tracker: the banking regulators' proposed and final rules
 * from the Federal Register (reg_tracker_items source "federal_register"), sorted into what
 * a bank has to act on. Pure, so the grouping and day counts are tested without a database.
 */

export interface TrackedRule {
  id: string;
  kind: "proposed_rule" | "final_rule";
  title: string;
  /** The Federal Register's own summary of the document, never a model's. */
  abstract: string | null;
  agencies: string[];
  published_on: string | null;
  comments_close_on: string | null;
  effective_on: string | null;
  url: string | null;
  dockets: string[];
  cfr_parts: string[];
  /** Fee topics from the title, abstract and CFR parts (overdraft_nsf, fees, deposit_disclosure, ...). */
  topics: string[];
}

export interface TrackedRuleView extends TrackedRule {
  stage: TrackerStage;
  /** Days from today to the comment deadline (open) or the effective date (not yet in effect). */
  days_left: number | null;
}

export interface RuleTracker {
  /** Proposed rules still taking comments, nearest deadline first. */
  open: TrackedRuleView[];
  /** Final rules not yet in effect, nearest effective date first. */
  upcoming: TrackedRuleView[];
  /** Rules published in the last RECENT_RULE_DAYS that are past those stages, newest first. */
  recent: TrackedRuleView[];
  /** Rules in all three lists that touch a fee topic. */
  fee_related: number;
}

export const RECENT_RULE_DAYS = 90;
export const RECENT_RULE_LIMIT = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

export const RULE_KIND_LABELS: Record<TrackedRule["kind"], string> = {
  proposed_rule: "Proposed rule",
  final_rule: "Final rule",
};

export const RULE_TOPIC_LABELS: Record<string, string> = {
  overdraft_nsf: "Overdraft and NSF",
  fees: "Fees",
  deposit_disclosure: "Deposit disclosures",
  electronic_transfers: "Electronic transfers",
  funds_availability: "Funds availability",
};

/** "Comments close in 12 days", "Takes effect tomorrow": the one deadline that matters for a rule. */
export function deadlinePhrase(rule: Pick<TrackedRuleView, "stage" | "days_left">): string | null {
  const n = rule.days_left;
  if (n == null) return null;
  const when = n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
  if (rule.stage === "comment_open") return n === 0 ? "Comments close today" : `Comments close ${when}`;
  if (rule.stage === "final_not_yet_effective") return `Takes effect ${when}`;
  return null;
}

export function buildRuleTracker(rules: TrackedRule[], today: string): RuleTracker {
  const recentFrom = new Date(Date.parse(`${today}T00:00:00Z`) - RECENT_RULE_DAYS * DAY_MS).toISOString().slice(0, 10);
  const open: TrackedRuleView[] = [];
  const upcoming: TrackedRuleView[] = [];
  const recent: TrackedRuleView[] = [];
  for (const rule of rules) {
    const stage = trackerStage(rule, today);
    if (stage === "comment_open") {
      open.push({ ...rule, stage, days_left: rule.comments_close_on ? daysBetween(today, rule.comments_close_on) : null });
    } else if (stage === "final_not_yet_effective") {
      upcoming.push({ ...rule, stage, days_left: rule.effective_on ? daysBetween(today, rule.effective_on) : null });
    } else if (rule.published_on && rule.published_on >= recentFrom) {
      recent.push({ ...rule, stage, days_left: null });
    }
  }
  const byDays = (a: TrackedRuleView, b: TrackedRuleView) => (a.days_left ?? 0) - (b.days_left ?? 0);
  open.sort(byDays);
  upcoming.sort(byDays);
  recent.sort((a, b) => String(b.published_on).localeCompare(String(a.published_on)));
  const shownRecent = recent.slice(0, RECENT_RULE_LIMIT);
  const fee_related = [...open, ...upcoming, ...shownRecent].filter((rule) => rule.topics.length > 0).length;
  return { open, upcoming, recent: shownRecent, fee_related };
}

/** Search applies to the rule's title, summary and docket, the same words a user would type. */
export function ruleMatches(rule: TrackedRule, q: string | null | undefined): boolean {
  const text = (q ?? "").trim().toLowerCase();
  if (!text) return true;
  return [rule.title, rule.abstract ?? "", ...rule.dockets, ...rule.agencies].some((part) => part.toLowerCase().includes(text));
}

/** The Wire's source filter keys (FED, FDIC, OCC, CFPB) as Federal Register agency names. */
export const SOURCE_AGENCY: Record<string, string> = {
  FED: "Federal Reserve",
  FDIC: "FDIC",
  OCC: "OCC",
  CFPB: "CFPB",
};
