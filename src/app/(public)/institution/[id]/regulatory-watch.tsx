/**
 * Pro regulatory watch, drawn in the Hamilton exhibit style: three headline figures, a
 * timeline of public enforcement actions against the largest local competitors, the
 * institution's most-watched fees against the local market, and federal rule changes on
 * those fees when the tracker has any. Every item is a public record reported as fact.
 */
import { ExhibitFrame } from "@/components/hamilton/memo/exhibit-view";
import { SERIF } from "@/components/hamilton/memo/memo";
import { formatCompactDollars } from "@/lib/format";
import type { SourceRef } from "@/lib/hamilton/workspace/types";
import type { ActionTheme, RegulatoryWatch, WatchFeeTie, WatchPeerAction, WatchRuleChange } from "@/lib/data-store/regulatory-watch";
import { WATCH_ACTION_YEARS } from "@/lib/data-store/regulatory-watch";

const AGENCY_LABEL = { OCC: "OCC", FRB: "Federal Reserve" } as const;

export const THEME: Record<ActionTheme, { label: string; color: string }> = {
  consumer: { label: "Consumer law, UDAP, fees", color: "#A93D25" },
  bsa_aml: { label: "BSA/AML and sanctions", color: "#2F5C8A" },
  governance: { label: "Governance and controls", color: "#8A6A2F" },
  other: { label: "Other", color: "#6E5A8A" },
};

const STAGE_LABEL: Record<string, string> = {
  comment_open: "Open for comment",
  comment_closed: "Comment period closed",
  final_not_yet_effective: "Final, not yet in effect",
  in_effect: "In effect",
  introduced: "Introduced",
  in_committee: "In committee",
  passed_chamber: "Passed one chamber",
  passed_legislature: "Passed Congress",
  signed: "Signed into law",
};

const DAY = 86_400_000;
const time = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const monthYear = (iso: string) =>
  new Date(time(iso)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const fullDate = (iso: string) =>
  new Date(time(iso)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const money = (v: number) => `$${v.toFixed(2)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The window the timeline draws: the last WATCH_ACTION_YEARS years up to the read date. */
export function timelineWindow(asOf: string | null, actions: readonly WatchPeerAction[]): { start: number; end: number } {
  const latest = actions.map((a) => a.start_date).filter((d): d is string => Boolean(d)).sort().pop();
  const end = time(asOf ?? latest ?? new Date().toISOString());
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - WATCH_ACTION_YEARS);
  return { start: start.getTime(), end };
}

/** One row per competitor, most recent action first. */
export function peerRows(actions: readonly WatchPeerAction[]): { peer_id: number; peer_name: string; actions: WatchPeerAction[] }[] {
  const rows = new Map<number, { peer_id: number; peer_name: string; actions: WatchPeerAction[] }>();
  for (const a of actions) {
    const row = rows.get(a.peer_id) ?? { peer_id: a.peer_id, peer_name: a.peer_name, actions: [] };
    row.actions.push(a);
    rows.set(a.peer_id, row);
  }
  const latest = (r: { actions: WatchPeerAction[] }) => r.actions.map((a) => a.start_date ?? "").sort().pop() ?? "";
  return [...rows.values()].sort((a, b) => latest(b).localeCompare(latest(a)) || a.peer_name.localeCompare(b.peer_name));
}

function shortBankName(name: string): string {
  return name
    .replace(/,?\s+(National Association|N\.\s?A\.)$/i, "")
    .replace(/,\s*$/, "")
    .trim();
}

function actionTitle(a: WatchPeerAction): string {
  return [
    `${AGENCY_LABEL[a.agency]} ${a.action_type ?? "enforcement action"}`,
    a.start_date ? fullDate(a.start_date) : null,
    a.against_holding_company ? `against the holding company, ${a.party_name}` : null,
    a.penalty_amount !== null ? `penalty ${formatCompactDollars(a.penalty_amount)}` : null,
    a.termination_date ? `ended ${fullDate(a.termination_date)}` : a.no_end_date_on_file ? "no end date on file" : null,
    a.subject,
  ]
    .filter(Boolean)
    .join(" · ");
}

function Figure({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-warm-200 bg-warm-50 px-4 py-3">
      <div className={`text-2xl leading-none tabular-nums ${accent ? "text-terra-text" : "text-warm-900"}`} style={SERIF}>
        {value}
      </div>
      <div className="mt-1.5 text-xs leading-snug text-warm-600">{label}</div>
    </div>
  );
}

function Marker({ action, left, maxPenalty }: { action: WatchPeerAction; left: number; maxPenalty: number }) {
  const color = THEME[action.theme].color;
  const ended = Boolean(action.termination_date);
  const isPenalty = action.penalty_amount !== null && action.penalty_amount > 0;
  const size = isPenalty ? 12 + 26 * Math.sqrt((action.penalty_amount as number) / (maxPenalty || 1)) : 12;
  const shape = isPenalty ? (
    <span
      className="block rounded-full"
      style={{ width: size, height: size, background: color, opacity: 0.85, boxShadow: "0 0 0 2px #fff" }}
    />
  ) : (
    <span
      className="block rotate-45"
      style={{ width: 11, height: 11, background: ended ? "#fff" : color, border: `2px solid ${color}`, boxShadow: "0 0 0 2px #fff" }}
    />
  );
  const body = (
    <span className="flex items-center gap-1.5" title={actionTitle(action)}>
      {shape}
      {isPenalty ? (
        <span className="whitespace-nowrap text-[11px] font-semibold tabular-nums" style={{ color }}>
          {formatCompactDollars(action.penalty_amount as number)}
        </span>
      ) : null}
    </span>
  );
  // Penalties sit on the line; orders ride just above so a same-day pair never hides one another.
  const style = { left: `${left}%`, top: isPenalty ? "50%" : "18%", transform: `translate(-${isPenalty ? size / 2 : 6}px, -50%)` };
  return (
    <span className="absolute" style={style}>
      {action.document_url ? (
        <a href={action.document_url} target="_blank" rel="noopener noreferrer" aria-label={actionTitle(action)}>
          {body}
        </a>
      ) : (
        <span aria-label={actionTitle(action)}>{body}</span>
      )}
    </span>
  );
}

function ActionTimeline({ watch }: { watch: RegulatoryWatch }) {
  const actions = watch.peer_actions.filter((a) => a.start_date);
  const { start, end } = timelineWindow(watch.as_of, actions);
  const at = (iso: string) => Math.min(Math.max(((time(iso) - start) / (end - start || DAY)) * 100, 0), 100);
  const rows = peerRows(actions);
  const maxPenalty = Math.max(0, ...actions.map((a) => a.penalty_amount ?? 0));
  const years: number[] = [];
  for (let y = new Date(start).getUTCFullYear() + 1; y <= new Date(end).getUTCFullYear(); y += 1) years.push(y);
  const themes = (Object.keys(THEME) as ActionTheme[]).filter((t) => actions.some((a) => a.theme === t));
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-warm-700">
        {themes.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: THEME[t].color }} />
            {THEME[t].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full bg-warm-500" /> Penalty, sized by amount
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rotate-45 bg-warm-500" /> Order or agreement (hollow once ended)
        </span>
      </div>
      <div className="space-y-0">
        {rows.map((row) => (
          <div key={row.peer_id} className="grid grid-cols-1 items-center gap-x-4 border-t border-warm-200 py-1 sm:grid-cols-[11rem_1fr]">
            <div className="truncate pt-1 text-[13px] font-medium text-warm-800 sm:pt-0" title={row.peer_name}>
              {shortBankName(row.peer_name)}
            </div>
            <div className="relative h-14">
              {years.map((y) => (
                <span key={y} className="absolute inset-y-0 w-px bg-warm-200" style={{ left: `${at(`${y}-01-01`)}%` }} />
              ))}
              <span className="absolute inset-x-0 top-1/2 h-px bg-warm-300" />
              {row.actions.map((a, i) => (
                <Marker key={i} action={a} left={at(a.start_date as string)} maxPenalty={maxPenalty} />
              ))}
            </div>
          </div>
        ))}
        <div className="grid grid-cols-1 gap-x-4 border-t border-warm-300 sm:grid-cols-[11rem_1fr]">
          <div className="hidden sm:block" />
          <div className="relative h-5 text-[11px] tabular-nums text-warm-600">
            {years.map((y) => (
              <span key={y} className="absolute top-1 -translate-x-1/2" style={{ left: `${at(`${y}-01-01`)}%` }}>
                {y}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FeeVsMarket({ fees }: { fees: readonly WatchFeeTie[] }) {
  const hi = Math.ceil(Math.max(...fees.flatMap((f) => [f.amount, f.market_median ?? 0])) * 1.15) || 1;
  const at = (v: number) => (v / hi) * 100;
  return (
    <div className="space-y-0">
      {fees.map((f) => {
        const median = f.market_median as number;
        const gap = Math.round((f.amount - median) * 100) / 100;
        const color = gap > 0 ? "#A93D25" : gap < 0 ? "#2F5C8A" : "#5A5347";
        const lo = Math.min(f.amount, median);
        return (
          <div key={f.fee_category} className="grid grid-cols-[1fr_auto] items-center gap-x-4 border-t border-warm-200 py-2 sm:grid-cols-[11rem_1fr_6.5rem]">
            <div className="text-[13px] font-medium text-warm-800">{f.display_name}</div>
            <div className="relative order-3 col-span-2 h-11 sm:order-none sm:col-span-1">
              <span className="absolute inset-x-0 top-[30px] h-px bg-warm-200" />
              <span className="absolute top-[28px] h-1 rounded-full" style={{ left: `${at(lo)}%`, width: `${Math.abs(at(f.amount) - at(median))}%`, background: color, opacity: 0.25 }} />
              <span className="absolute top-[21px] h-[18px] w-0.5 bg-warm-600" style={{ left: `${at(median)}%` }} title={`Local market median ${money(median)} (${f.market_count} competitors)`} />
              <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10px] tabular-nums text-warm-600" style={{ left: `${at(median)}%` }}>
                market {money(median)} · n={f.market_count}
              </span>
              <span className="absolute top-[30px] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${at(f.amount)}%`, background: color, boxShadow: "0 0 0 2px #fff" }} title={`Your fee ${money(f.amount)}`} />
            </div>
            <div className="text-right text-[13px] tabular-nums" style={{ color }}>
              <span className="font-semibold">{money(f.amount)}</span>{" "}
              <span className="text-[11px]">{gap === 0 ? "same" : `${gap > 0 ? "+" : "−"}${money(Math.abs(gap))}`}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RuleRow({ rule }: { rule: WatchRuleChange }) {
  const date = rule.effective_on ?? rule.comments_close_on ?? rule.published_on;
  const stage = rule.stage ? STAGE_LABEL[rule.stage] ?? rule.stage : null;
  return (
    <li className="grid gap-1 border-t border-warm-200 py-2.5 sm:grid-cols-[9rem_1fr]">
      <div className="flex flex-wrap items-center gap-1.5 sm:block">
        {stage ? <span className="inline-block rounded-full bg-terra-soft px-2 py-0.5 text-[11px] font-semibold text-terra-text">{stage}</span> : null}
        {date ? <div className="text-[11px] tabular-nums text-warm-600 sm:mt-1">{monthYear(date)}</div> : null}
      </div>
      <div>
        <div className="text-[13px] font-medium text-warm-900">
          {rule.url ? (
            <a href={rule.url} target="_blank" rel="noopener noreferrer" className="hover:text-terra-text hover:underline">
              {rule.title}
            </a>
          ) : (
            rule.title
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {rule.fees.map((f) => (
            <span key={f.fee_category} className="rounded border border-warm-200 bg-white px-1.5 py-0.5 text-[11px] text-warm-700">
              {f.display_name} {money(f.amount)}
            </span>
          ))}
          {rule.all_fees ? <span className="text-[11px] text-warm-600">and every other published fee</span> : null}
        </div>
      </div>
    </li>
  );
}

/** "Chicago, IL; Coral Gables, FL" -> "Chicago" for the headline; full places go in the source line. */
const firstCity = (places: readonly string[]) => places[0]?.split(",")[0]?.trim() ?? null;

export function RegulatoryWatchSection({ watch, exportHref }: { watch: RegulatoryWatch; exportHref?: string | null }) {
  const peersChecked = watch.market?.peers_checked ?? 0;
  const actions = watch.peer_actions;
  const peersWithActions = new Set(actions.map((a) => a.peer_id)).size;
  const penalties = actions.reduce((sum, a) => sum + (a.penalty_amount ?? 0), 0);
  const consumer = actions.filter((a) => a.theme === "consumer").length;
  const agencies = watch.agencies_loaded.map((a) => AGENCY_LABEL[a]).join(" and ") || "OCC and Federal Reserve";
  const city = firstCity(watch.market?.places ?? []);
  const span = timelineWindow(watch.as_of, actions);
  const since = monthYear(new Date(span.start).toISOString());
  const enforcementSource: SourceRef = { label: `${agencies} enforcement action lists`, asOf: watch.as_of };
  const depositsSource: SourceRef = { label: `FDIC Summary of Deposits (largest by deposits in ${watch.market?.places.slice(0, 2).join("; ") ?? "the local market"})` };
  const headline =
    peersChecked === 0
      ? "No local market is on file for this institution yet."
      : actions.length === 0
        ? `None of your ${peersChecked} largest ${city ? `${city} ` : ""}competitors has a federal enforcement action since ${since}.`
        : `${peersWithActions} of your ${peersChecked} largest ${city ? `${city} ` : ""}competitors drew federal enforcement since ${since}${
            consumer > 0 ? `; ${plural(consumer, "action")} concerned consumer law.` : ", none of it about consumer law."
          }`;
  let n = 0;
  return (
    <section className="rounded-xl border border-warm-300 bg-warm-100 p-4 sm:p-6">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terra-text">Regulatory watch</div>
      <h3 className="mt-1 text-xl leading-snug text-warm-900 sm:text-2xl" style={SERIF}>
        {headline}
      </h3>
      {peersChecked > 0 ? (
        <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          <Figure value={`${peersWithActions} of ${peersChecked}`} label="competitors with actions" />
          <Figure value={penalties > 0 ? formatCompactDollars(penalties) : "$0"} label="in penalties assessed" />
          <Figure value={String(consumer)} label={consumer === 1 ? "consumer-law action" : "consumer-law actions"} accent={consumer > 0} />
        </div>
      ) : null}
      <div className="mt-5 grid gap-5">
        {actions.length > 0 ? (
          <ExhibitFrame number={++n} title={`Federal enforcement against your largest local competitors, ${since} to now`} sources={[enforcementSource, depositsSource]} note="Each mark is one public action, placed on the date it began. Hover or tap a mark for the agency's subject and a link to the order. FDIC and NCUA orders are not included.">
            <ActionTimeline watch={watch} />
          </ExhibitFrame>
        ) : null}
        {watch.fee_focus.length > 0 ? (
          <ExhibitFrame number={++n} title="The fees consumer regulators watch most, against your market" sources={[{ label: "Bank Fee Index published fees", asOf: watch.as_of }, depositsSource]} note="Line: the median among your 40 largest local competitors that publish the fee (n of them shown; at least 3). Dot: your published fee.">
            <FeeVsMarket fees={watch.fee_focus} />
          </ExhibitFrame>
        ) : null}
        {watch.rule_changes.length > 0 ? (
          <ExhibitFrame number={++n} title="Federal rule changes on your fees" sources={[{ label: "Federal Register and Congress.gov" }]}>
            <ul>
              {watch.rule_changes.slice(0, 6).map((rule, i) => (
                <RuleRow key={i} rule={rule} />
              ))}
            </ul>
          </ExhibitFrame>
        ) : null}
      </div>
      {exportHref ? (
        <a href={exportHref} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-terra px-3.5 py-2 text-sm font-medium text-terra-text hover:bg-terra-soft">
          Download your fees and peer benchmarks (CSV)
        </a>
      ) : null}
    </section>
  );
}
