import { buildRuleTracker, ruleMatches, SOURCE_AGENCY, type RuleTracker, type TrackedRule } from "@/lib/regulatory/rule-tracker";
import { RECENT_RULE_DAYS } from "@/lib/regulatory/rule-tracker";
import { sql } from "./connection";

/**
 * The Federal view's rulemaking tracker, read from the rows registry-federal-register stores
 * in reg_tracker_items (source "federal_register"). Rows land only while that step runs live;
 * with none stored the tracker comes back empty and the page shows the releases alone.
 */

const dateStr = (value: unknown): string | null => {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

export async function getFederalRuleTracker(opts: { now: Date; q?: string; source?: string }): Promise<RuleTracker> {
  const today = opts.now.toISOString().slice(0, 10);
  const recentFrom = new Date(opts.now.getTime() - RECENT_RULE_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = (await sql`
    SELECT external_id, kind, title, abstract, agencies, published_on, comments_close_on, effective_on,
           url, dockets, cfr_parts, topics
      FROM reg_tracker_items
     WHERE source = 'federal_register'
       AND kind IN ('proposed_rule', 'final_rule')
       AND (comments_close_on >= ${today}::date OR effective_on > ${today}::date OR published_on >= ${recentFrom}::date)
     ORDER BY published_on DESC
     LIMIT 500
  `.catch(() => [])) as Array<Record<string, unknown>>;

  const agency = opts.source ? SOURCE_AGENCY[opts.source] : undefined;
  const rules: TrackedRule[] = rows
    .map((r) => ({
      id: String(r.external_id),
      kind: String(r.kind) === "final_rule" ? ("final_rule" as const) : ("proposed_rule" as const),
      title: String(r.title),
      abstract: r.abstract ? String(r.abstract) : null,
      agencies: strings(r.agencies),
      published_on: dateStr(r.published_on),
      comments_close_on: dateStr(r.comments_close_on),
      effective_on: dateStr(r.effective_on),
      url: r.url ? String(r.url) : null,
      dockets: strings(r.dockets),
      cfr_parts: strings(r.cfr_parts),
      topics: strings(r.topics),
    }))
    .filter((rule) => ruleMatches(rule, opts.q) && (!agency || rule.agencies.includes(agency)));
  return buildRuleTracker(rules, today);
}
