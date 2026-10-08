/**
 * Pro regulatory watch, in the shared report look (src/lib/report-design): three headline figures, a
 * timeline of public enforcement actions against the largest local competitors, the
 * institution's most-watched fees against the local market, and federal rule changes on
 * those fees when the tracker has any. Every item is a public record reported as fact.
 */
import { Exhibit, ReportDesign, ReportHeader, type RdLegendItem } from "@/components/report-design";
import { formatCompactDollars } from "@/lib/format";
import { RD } from "@/lib/report-design/tokens";
import { enforcementAgencyLabel, enforcementAgencyList } from "@/lib/regulatory/state-enforcement";
import type { ActionTheme, RegulatoryWatch, WatchFeeTie, WatchPeerAction, WatchRuleChange, WatchState } from "@/lib/data-store/regulatory-watch";
import { WATCH_ACTION_YEARS } from "@/lib/data-store/regulatory-watch";


export const THEME: Record<ActionTheme, { label: string; color: string }> = {
  consumer: { label: "Consumer law, UDAP, fees", color: RD.terraText },
  bsa_aml: { label: "BSA/AML and sanctions", color: RD.series[1] },
  governance: { label: "Governance and controls", color: RD.series[2] },
  other: { label: "Other", color: RD.series[3] },
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
    `${enforcementAgencyLabel(a.agency)} ${a.action_type ?? "enforcement action"}`,
    a.start_date ? fullDate(a.start_date) : null,
    a.against_holding_company ? `against the holding company, ${a.party_name}` : null,
    a.penalty_amount !== null ? `penalty ${formatCompactDollars(a.penalty_amount)}` : null,
    a.termination_date ? `ended ${fullDate(a.termination_date)}` : a.no_end_date_on_file ? "no end date on file" : null,
    a.subject,
  ]
    .filter(Boolean)
    .join(" · ");
}

const linkStyle = { color: "inherit", textDecoration: "underline", textDecorationColor: RD.rule2, textUnderlineOffset: 2 } as const;

function Marker({ action, left, maxPenalty }: { action: WatchPeerAction; left: number; maxPenalty: number }) {
  const color = THEME[action.theme].color;
  const ended = Boolean(action.termination_date);
  const isPenalty = action.penalty_amount !== null && action.penalty_amount > 0;
  const size = isPenalty ? 12 + 26 * Math.sqrt((action.penalty_amount as number) / (maxPenalty || 1)) : 12;
  const halo = `0 0 0 2px ${RD.paper}`;
  const shape = isPenalty ? (
    <span style={{ display: "block", width: size, height: size, borderRadius: "50%", background: color, opacity: 0.85, boxShadow: halo }} />
  ) : (
    <span style={{ display: "block", width: 11, height: 11, transform: "rotate(45deg)", background: ended ? RD.paper : color, border: `2px solid ${color}`, boxShadow: halo }} />
  );
  const body = (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }} title={actionTitle(action)}>
      {shape}
      {isPenalty ? (
        <span style={{ whiteSpace: "nowrap", fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums", color }}>
          {formatCompactDollars(action.penalty_amount as number)}
        </span>
      ) : null}
    </span>
  );
  // Penalties sit on the line; orders ride just above so a same-day pair never hides one another.
  const style = { position: "absolute", left: `${left}%`, top: isPenalty ? "50%" : "18%", transform: `translate(-${isPenalty ? size / 2 : 6}px, -50%)` } as const;
  return (
    <span style={style}>
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

function timelineLegend(actions: readonly WatchPeerAction[]): RdLegendItem[] {
  return [
    ...(Object.keys(THEME) as ActionTheme[]).filter((t) => actions.some((a) => a.theme === t)).map((t) => ({ label: THEME[t].label, color: THEME[t].color, mark: "dot" as const })),
    { label: "Circle: a penalty, sized by amount" },
    { label: "Diamond: an order or agreement, hollow once ended" },
  ];
}

const ROW = "grid grid-cols-1 items-center gap-x-4 sm:grid-cols-[11rem_1fr]";

function ActionTimeline({ watch }: { watch: RegulatoryWatch }) {
  const actions = watch.peer_actions.filter((a) => a.start_date);
  const { start, end } = timelineWindow(watch.as_of, actions);
  const at = (iso: string) => Math.min(Math.max(((time(iso) - start) / (end - start || DAY)) * 100, 0), 100);
  const rows = peerRows(actions);
  const maxPenalty = Math.max(0, ...actions.map((a) => a.penalty_amount ?? 0));
  const years: number[] = [];
  for (let y = new Date(start).getUTCFullYear() + 1; y <= new Date(end).getUTCFullYear(); y += 1) years.push(y);
  return (
    <div>
      {rows.map((row) => (
        <div key={row.peer_id} className={`${ROW} py-1`} style={{ borderTop: `1px solid ${RD.rule}` }}>
          <div className="truncate pt-1 sm:pt-0" style={{ fontSize: 13, fontWeight: 500, color: RD.ink2 }} title={row.peer_name}>
            {shortBankName(row.peer_name)}
          </div>
          <div className="relative h-14">
            {years.map((y) => (
              <span key={y} className="absolute inset-y-0 w-px" style={{ left: `${at(`${y}-01-01`)}%`, background: RD.rule }} />
            ))}
            <span className="absolute inset-x-0 top-1/2 h-px" style={{ background: RD.rule2 }} />
            {row.actions.map((a, i) => (
              <Marker key={i} action={a} left={at(a.start_date as string)} maxPenalty={maxPenalty} />
            ))}
          </div>
        </div>
      ))}
      <div className={ROW} style={{ borderTop: `1px solid ${RD.rule2}` }}>
        <div className="hidden sm:block" />
        <div className="relative h-5" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", color: RD.inkSoft }}>
          {years.map((y) => (
            <span key={y} className="absolute top-1 -translate-x-1/2" style={{ left: `${at(`${y}-01-01`)}%` }}>
              {y}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Higher than the market reads terra, lower reads blue (RD.series[1]), level reads soft ink. */
const gapColor = (gap: number) => (gap > 0 ? RD.terraText : gap < 0 ? RD.series[1] : RD.inkSoft);

function FeeVsMarket({ fees }: { fees: readonly WatchFeeTie[] }) {
  const hi = Math.ceil(Math.max(...fees.flatMap((f) => [f.amount, f.market_median ?? 0])) * 1.15) || 1;
  const at = (v: number) => (v / hi) * 100;
  return (
    <div>
      {fees.map((f) => {
        const median = f.market_median as number;
        const gap = Math.round((f.amount - median) * 100) / 100;
        const color = gapColor(gap);
        const lo = Math.min(f.amount, median);
        return (
          <div key={f.fee_category} className="grid grid-cols-[1fr_auto] items-center gap-x-4 py-2 sm:grid-cols-[11rem_1fr_6.5rem]" style={{ borderTop: `1px solid ${RD.rule}` }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: RD.ink2 }}>{f.display_name}</div>
            <div className="relative order-3 col-span-2 h-11 sm:order-none sm:col-span-1">
              <span className="absolute inset-x-0 top-[30px] h-px" style={{ background: RD.rule }} />
              <span className="absolute top-[28px] h-1 rounded-full" style={{ left: `${at(lo)}%`, width: `${Math.abs(at(f.amount) - at(median))}%`, background: color, opacity: 0.25 }} />
              <span className="absolute top-[21px] h-[18px] w-0.5" style={{ left: `${at(median)}%`, background: RD.ink }} title={`Local market median ${money(median)} (${f.market_count} competitors)`} />
              <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: `${at(median)}%`, fontSize: 10, fontVariantNumeric: "tabular-nums", color: RD.inkSoft }}>
                market {money(median)} · n={f.market_count}
              </span>
              <span className="absolute top-[30px] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${at(f.amount)}%`, background: color, boxShadow: `0 0 0 2px ${RD.paper}` }} title={`Your fee ${money(f.amount)}`} />
            </div>
            <div className="text-right" style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color }}>
              <span style={{ fontWeight: 600 }}>{money(f.amount)}</span>{" "}
              <span style={{ fontSize: 11 }}>{gap === 0 ? "same" : `${gap > 0 ? "+" : "−"}${money(Math.abs(gap))}`}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const FEE_LEGEND: RdLegendItem[] = [
  { label: "Your published fee", mark: "dot", color: RD.inkSoft },
  { label: "Market median", mark: "tick", color: RD.ink },
  { label: "Higher than the market", mark: "dot", color: RD.terraText },
  { label: "Lower than the market", mark: "dot", color: RD.series[1] },
];

function RuleTable({ rules, heading }: { rules: readonly WatchRuleChange[]; heading: string }) {
  return (
    <div className="rd-table-wrap">
      <table className="rd-table">
        <thead>
          <tr>
            <th>Stage</th>
            <th>Date</th>
            <th>{heading}</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule, i) => {
            const date = rule.effective_on ?? rule.comments_close_on ?? rule.published_on;
            return (
              <tr key={i}>
                <td style={{ color: RD.terraText, fontWeight: 600, whiteSpace: "nowrap" }}>{rule.stage ? STAGE_LABEL[rule.stage] ?? rule.stage : ""}</td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>{date ? monthYear(date) : ""}</td>
                <td>
                  {rule.url ? (
                    <a href={rule.url} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                      {rule.title}
                    </a>
                  ) : (
                    rule.title
                  )}
                  <FeeChips fees={rule.fees} allFees={rule.all_fees} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const LAW_TOPIC: Record<string, string> = {
  overdraft_nsf: "Overdraft and NSF",
  dormancy: "Dormant accounts",
  check_cashing: "Check cashing",
  returned_item: "Returned items",
  fee_change_notice: "Fee disclosure",
  basic_account: "Basic account",
  garnishment_legal_process: "Legal process",
  atm: "ATM",
  payee_returned_check: "Returned checks",
  other: "Other",
};

const small = { fontSize: 11.5, color: RD.inkSoft } as const;

function FeeChips({ fees, allFees }: { fees: readonly WatchFeeTie[]; allFees: boolean }) {
  if (fees.length === 0 && !allFees) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span style={small}>{allFees && fees.length === 0 ? "Covers every fee you publish" : "Your fees:"}</span>
      {fees.map((f) => (
        <span key={f.fee_category} style={{ ...small, color: RD.ink2, border: `1px solid ${RD.rule2}`, background: RD.paper, borderRadius: 3, padding: "1px 6px" }}>
          {f.display_name} <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", color: RD.ink }}>{money(f.amount)}</span>
        </span>
      ))}
      {allFees && fees.length > 0 ? <span style={small}>and every other fee you publish</span> : null}
    </div>
  );
}

function StateExhibit({ state, number }: { state: WatchState; number: number }) {
  const sources = [
    ...(state.laws.length > 0 ? [`${state.state_name} statutes (official text)`] : []),
    ...(state.bills.length > 0 ? [state.bills_tracked ? "Open States legislative data" : `${state.state_name} legislature`] : []),
  ];
  return (
    <Exhibit
      exhibit={{
        key: "state",
        label: `Exhibit ${number} · ${state.state_name}`,
        title: `${state.state_name}: state law and bills on your fees`,
        sub: state.laws_reviewed ? null : "Draft for legal review: these citations come from research not yet reviewed by counsel, and customers will not see them until that review is done.",
        source: `Source: ${sources.join("; ")}.`,
      }}
    >
      {state.supervisor ? (
        <p style={{ fontSize: 13.5, color: RD.inkSoft, margin: "0 0 10px" }}>
          Your charter supervisor:{" "}
          {state.supervisor.website ? (
            <a href={state.supervisor.website} target="_blank" rel="noopener noreferrer" style={{ ...linkStyle, color: RD.ink, fontWeight: 500 }}>
              {state.supervisor.agency}
            </a>
          ) : (
            <span style={{ color: RD.ink, fontWeight: 500 }}>{state.supervisor.agency}</span>
          )}
        </p>
      ) : null}
      {state.laws.length > 0 ? (
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="rd-label" style={{ color: RD.inkSoft }}>State law in force</span>
            {!state.laws_reviewed ? (
              <span className="rd-label" style={{ border: `1px solid ${RD.terra}`, borderRadius: 999, padding: "1px 8px", fontSize: 10 }}>Not yet legally reviewed</span>
            ) : null}
          </div>
          <div className="rd-table-wrap">
            <table className="rd-table">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Law</th>
                </tr>
              </thead>
              <tbody>
                {state.laws.map((law) => (
                  <tr key={law.id}>
                    <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{LAW_TOPIC[law.topic] ?? law.topic}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{law.name}</div>
                      <div style={small}>
                        {law.url ? (
                          <a href={law.url} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                            {law.citation}
                          </a>
                        ) : (
                          law.citation
                        )}
                      </div>
                      <p style={{ margin: "4px 0 0", color: RD.ink2 }}>{law.summary}</p>
                      <FeeChips fees={law.fees} allFees={law.all_fees} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {state.bills.length > 0 ? (
        <div className={state.laws.length > 0 ? "mt-4" : undefined}>
          <div className="rd-label mb-1" style={{ color: RD.inkSoft }}>Bills in the legislature</div>
          <RuleTable rules={state.bills} heading="Bill" />
        </div>
      ) : null}
    </Exhibit>
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
  const agencies = enforcementAgencyList(watch.agencies_loaded) || "OCC and Federal Reserve";
  const city = firstCity(watch.market?.places ?? []);
  const span = timelineWindow(watch.as_of, actions);
  const since = monthYear(new Date(span.start).toISOString());
  const asOf = watch.as_of ? ` Data as of ${fullDate(watch.as_of)}.` : "";
  const deposits = `FDIC Summary of Deposits (largest by deposits in ${watch.market?.places.slice(0, 2).join("; ") ?? "the local market"})`;
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
    <ReportDesign>
      <ReportHeader
        eyebrow="Regulatory watch"
        title={headline}
        heroes={
          peersChecked > 0
            ? [
                { figure: `${peersWithActions} of ${peersChecked}`, label: "competitors with actions" },
                { figure: penalties > 0 ? formatCompactDollars(penalties) : "$0", label: "in penalties assessed" },
                { figure: String(consumer), label: consumer === 1 ? "consumer-law action" : "consumer-law actions" },
              ]
            : []
        }
      />
      {actions.length > 0 ? (
        <Exhibit
          exhibit={{
            key: "enforcement",
            label: `Exhibit ${++n} · Enforcement`,
            title: `Federal enforcement against your largest local competitors, ${since} to now`,
            sub: "Each mark is one public action, placed on the date it began. Hover or tap a mark for the agency's subject and a link to the order. FDIC and NCUA orders are not included.",
            legend: timelineLegend(actions),
            source: `Source: ${agencies} enforcement action lists; ${deposits}.${asOf}`,
          }}
        >
          <ActionTimeline watch={watch} />
        </Exhibit>
      ) : null}
      {watch.fee_focus.length > 0 ? (
        <Exhibit
          exhibit={{
            key: "fees",
            label: `Exhibit ${++n} · Fees`,
            title: "The fees consumer regulators watch most, against your market",
            sub: "Tick: the median among your 40 largest local competitors that publish the fee (n of them shown; at least 3). Dot: your published fee.",
            legend: FEE_LEGEND,
            source: `Source: Bank Fee Index published fees; ${deposits}.${asOf}`,
          }}
        >
          <FeeVsMarket fees={watch.fee_focus} />
        </Exhibit>
      ) : null}
      {watch.state && (watch.state.laws.length > 0 || watch.state.bills.length > 0) ? <StateExhibit state={watch.state} number={++n} /> : null}
      {watch.rule_changes.length > 0 ? (
        <Exhibit exhibit={{ key: "rules", label: `Exhibit ${++n} · Rules`, title: "Federal rule changes on your fees", source: "Source: Federal Register and Congress.gov." }}>
          <RuleTable rules={watch.rule_changes.slice(0, 6)} heading="Rule or bill" />
        </Exhibit>
      ) : null}
      {exportHref ? (
        <a
          href={exportHref}
          className="mt-5 inline-flex items-center gap-2 rounded px-3.5 py-2"
          style={{ border: `1px solid ${RD.terra}`, color: RD.terraText, fontSize: 14, fontWeight: 500, textDecoration: "none" }}
        >
          Download your fees and peer benchmarks (CSV)
        </a>
      ) : null}
    </ReportDesign>
  );
}
