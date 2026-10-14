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
 * what just became final. One row per rule, its dates in their own columns at desktop width;
 * the Federal Register's own summary folds under the row. Every word under a rule comes from
 * the Federal Register document, never from a model.
 */

/** "Regulation O" and "Docket No. R-1896" already name themselves; a bare id gets "Docket". */
function docketLabel(docket: string): string {
  return /docket|regulation/i.test(docket) ? docket : `Docket ${docket}`;
}

function DateCell({ label, value, active, now, empty = "Not set" }: { label: string; value: string | null; active: boolean; now: Date; empty?: string }) {
  const d = formatWireDate(value, now);
  return (
    <div className="min-w-0">
      <p className={`text-[9px] font-bold uppercase tracking-[0.08em] text-warm-600 md:hidden`} style={SANS}>
        {label}
      </p>
      <p className={`text-[13px] [font-variant-numeric:tabular-nums] ${active ? "font-semibold text-[#A93D25]" : "text-warm-700"}`}>
        {d ? <time dateTime={d.iso}>{d.absolute}</time> : <span className="text-warm-500">{empty}</span>}
      </p>
    </div>
  );
}

const ROW_GRID = "md:grid md:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_9.5rem] md:items-start md:gap-x-5";

function RuleRow({ rule, now }: { rule: TrackedRuleView; now: Date }) {
  const deadline = deadlinePhrase(rule);
  const proposed = rule.kind === "proposed_rule";
  const published = formatWireDate(rule.published_on, now);
  const refs = [...rule.dockets.map(docketLabel), ...rule.cfr_parts];
  return (
    <li className={`px-4 py-3 ${ROW_GRID}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]" style={SANS}>
          {rule.agencies
            .filter((agency) => agency !== "Treasury Department" || rule.agencies.length === 1)
            .map((agency) => (
              <span key={agency} className="rounded bg-warm-900 px-1.5 py-0.5 font-bold uppercase tracking-wider text-white">
                {agency}
              </span>
            ))}
          {rule.topics.map((topic) => (
            <span key={topic} className="rounded-full border border-[#A93D25]/40 px-2 py-0.5 font-medium text-[#A93D25]">
              {RULE_TOPIC_LABELS[topic] ?? topic}
            </span>
          ))}
        </div>
        <h4 className="mt-1 text-[15px] font-medium leading-snug text-warm-900">
          {rule.url ? (
            <a href={rule.url} target="_blank" rel="noopener noreferrer" className="text-warm-900 no-underline hover:text-[#A93D25]">
              {rule.title}
            </a>
          ) : (
            rule.title
          )}
        </h4>
        {rule.abstract || refs.length > 0 || published ? (
          <details className="group mt-1 text-[12px] text-warm-600">
            <summary className="cursor-pointer list-none select-none text-[11px] font-medium text-warm-600 hover:text-[#A93D25] [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Summary and references ▸</span>
              <span className="hidden group-open:inline">Hide ▾</span>
            </summary>
            {rule.abstract ? <p className="mt-1.5 max-w-3xl leading-relaxed text-warm-700">{rule.abstract}</p> : null}
            <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
              {published ? <span>Published <time dateTime={published.iso}>{published.absolute}</time></span> : null}
              {refs.length > 0 ? <span>{refs.join(" · ")}</span> : null}
              {rule.url ? (
                <a href={rule.url} target="_blank" rel="noopener noreferrer" className="font-medium text-[#A93D25] no-underline hover:underline">
                  Federal Register document →
                </a>
              ) : null}
            </p>
          </details>
        ) : null}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 md:contents">
        <DateCell
          label={proposed ? "Comments close" : "Comment period"}
          value={proposed ? rule.comments_close_on : null}
          active={rule.stage === "comment_open"}
          now={now}
          empty={proposed ? "Not set" : "Closed"}
        />
        <DateCell label="Takes effect" value={rule.effective_on} active={rule.stage === "final_not_yet_effective"} now={now} />
        <div className="min-w-0 self-start md:text-right">
          {deadline ? (
            <span className="inline-block rounded-full bg-[#A93D25] px-2 py-0.5 text-[10px] font-semibold text-white" style={SANS}>
              {deadline}
            </span>
          ) : (
            <span className="text-[11px] text-warm-600" style={SANS}>
              {RULE_KIND_LABELS[rule.kind]}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function RuleGroup({ title, note, rules, now }: { title: string; note: string; rules: TrackedRuleView[]; now: Date }) {
  if (rules.length === 0) return null;
  return (
    <section className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-[15px] font-semibold text-warm-900" style={SANS}>
          {title} <span className="font-normal text-warm-600">({rules.length})</span>
        </h3>
        <p className="text-[11px] text-warm-600">{note}</p>
      </div>
      <div className="mt-2 overflow-hidden rounded-xl border border-warm-200 bg-white/80">
        <div className={`hidden border-b border-warm-200 bg-warm-100/60 px-4 py-1.5 ${ROW_GRID}`} aria-hidden="true">
          {["Rule", "Comments close", "Takes effect", ""].map((h) => (
            <span key={h || "status"} className={LABEL} style={SANS}>
              {h}
            </span>
          ))}
        </div>
        <ol className="divide-y divide-warm-200/70">
          {rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} now={now} />
          ))}
        </ol>
      </div>
    </section>
  );
}

export function RuleTrackerSection({ tracker, now }: { tracker: RuleTracker; now: Date }) {
  if (tracker.open.length + tracker.upcoming.length + tracker.recent.length === 0) return null;
  return (
    <section aria-labelledby="rulemaking-heading" className="mt-6">
      <h2 id="rulemaking-heading" className={LABEL} style={SANS}>
        Rulemaking tracker · from the Federal Register
      </h2>
      <RuleGroup title="Open for comment" note="Nearest deadline first" rules={tracker.open} now={now} />
      <RuleGroup title="Final rules not yet in effect" note="Nearest effective date first" rules={tracker.upcoming} now={now} />
      <RuleGroup title="Recently final or closed" note="Last 90 days, newest first" rules={tracker.recent} now={now} />
    </section>
  );
}
