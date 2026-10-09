import {
  deadlinePhrase,
  RULE_KIND_LABELS,
  RULE_TOPIC_LABELS,
  type RuleTracker,
  type TrackedRuleView,
} from "@/lib/regulatory/rule-tracker";
import { formatWireDate } from "@/lib/regulatory/wire";
import { LABEL, SANS } from "./wire-controls";

/**
 * The Federal view's rulemaking tracker: what is open for comment, what takes effect soon and
 * what just became final, each with its dates laid out and the Federal Register's own summary.
 * Every word under a rule comes from the Federal Register document, never from a model.
 */

function DateCell({ label, value, active, now, empty = "Not set" }: { label: string; value: string | null; active: boolean; now: Date; empty?: string }) {
  const d = formatWireDate(value, now);
  return (
    <div className={`min-w-0 rounded-md px-2 py-1.5 ${active ? "bg-[#A93D25]/10" : ""}`}>
      <p className={`text-[9px] font-bold uppercase tracking-[0.08em] ${active ? "text-[#A93D25]" : "text-warm-600"}`} style={SANS}>
        {label}
      </p>
      <p className={`mt-0.5 text-[12px] [font-variant-numeric:tabular-nums] ${active ? "font-semibold text-warm-900" : "text-warm-700"}`}>
        {d ? <time dateTime={d.iso}>{d.absolute}</time> : <span className="text-warm-600">{empty}</span>}
      </p>
    </div>
  );
}

function RuleCard({ rule, now }: { rule: TrackedRuleView; now: Date }) {
  const deadline = deadlinePhrase(rule);
  const proposed = rule.kind === "proposed_rule";
  return (
    <article className="rounded-xl border border-warm-200 bg-white/80 px-4 py-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[10px]" style={SANS}>
        {rule.agencies.map((agency) => (
          <span key={agency} className="rounded bg-warm-900 px-1.5 py-0.5 font-bold uppercase tracking-wider text-white">
            {agency}
          </span>
        ))}
        <span className="font-semibold uppercase tracking-wider text-warm-600">{RULE_KIND_LABELS[rule.kind]}</span>
        {rule.topics.map((topic) => (
          <span key={topic} className="rounded-full border border-[#A93D25]/40 px-2 py-0.5 font-medium text-[#A93D25]">
            {RULE_TOPIC_LABELS[topic] ?? topic}
          </span>
        ))}
        {deadline ? (
          <span className="ml-auto rounded-full bg-[#A93D25] px-2 py-0.5 font-semibold text-white">{deadline}</span>
        ) : null}
      </div>

      <h3 className="mt-2 text-[16px] font-medium leading-snug text-warm-900 sm:text-[17px]">
        {rule.url ? (
          <a href={rule.url} target="_blank" rel="noopener noreferrer" className="text-warm-900 no-underline hover:text-[#A93D25]">
            {rule.title}
          </a>
        ) : (
          rule.title
        )}
      </h3>

      {rule.abstract ? (
        <div className="mt-2">
          <p className={LABEL} style={SANS}>
            Federal Register summary
          </p>
          <p className="mt-1 line-clamp-4 text-[13px] leading-relaxed text-warm-700">{rule.abstract}</p>
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-3 gap-1 border-t border-warm-200/70 pt-2">
        <DateCell label="Published" value={rule.published_on} active={false} now={now} />
        <DateCell
          label={proposed ? "Comments close" : "Comment period"}
          value={proposed ? rule.comments_close_on : null}
          active={rule.stage === "comment_open"}
          now={now}
          empty={proposed ? "Not set" : "Closed"}
        />
        <DateCell label="Takes effect" value={rule.effective_on} active={rule.stage === "final_not_yet_effective"} now={now} />
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-warm-600">
        {rule.url ? (
          <a href={rule.url} target="_blank" rel="noopener noreferrer" className="font-medium text-[#A93D25] no-underline hover:underline">
            Read the Federal Register document →
          </a>
        ) : null}
        {rule.dockets.length > 0 ? <span>Docket {rule.dockets.join(", ")}</span> : null}
        {rule.cfr_parts.length > 0 ? <span>{rule.cfr_parts.join(", ")}</span> : null}
      </p>
    </article>
  );
}

function RuleGroup({ title, note, rules, now }: { title: string; note: string; rules: TrackedRuleView[]; now: Date }) {
  if (rules.length === 0) return null;
  return (
    <section className="mt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-[15px] font-semibold text-warm-900" style={SANS}>
          {title} <span className="font-normal text-warm-600">({rules.length})</span>
        </h3>
        <p className="text-[11px] text-warm-600">{note}</p>
      </div>
      <div className="mt-2 space-y-2.5">
        {rules.map((rule) => (
          <RuleCard key={rule.id} rule={rule} now={now} />
        ))}
      </div>
    </section>
  );
}

export function RuleTrackerSection({ tracker, now }: { tracker: RuleTracker; now: Date }) {
  if (tracker.open.length + tracker.upcoming.length + tracker.recent.length === 0) return null;
  return (
    <section aria-labelledby="rulemaking-heading" className="mt-6">
      <h2 id="rulemaking-heading" className={LABEL} style={SANS}>
        Rulemaking tracker
      </h2>
      <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-warm-600">
        Proposed and final rules from the CFPB, FDIC, OCC, Federal Reserve and NCUA, read from the Federal
        Register. Summaries are the Federal Register&apos;s own, not an interpretation.
      </p>
      <RuleGroup title="Open for comment" note="Nearest deadline first" rules={tracker.open} now={now} />
      <RuleGroup title="Final rules not yet in effect" note="Nearest effective date first" rules={tracker.upcoming} now={now} />
      <RuleGroup title="Recently final or closed" note="Last 90 days, newest first" rules={tracker.recent} now={now} />
    </section>
  );
}
