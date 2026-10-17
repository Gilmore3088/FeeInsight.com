import type { ReactNode } from "react";
import { Logo } from "@/brand/components";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { ProductFrame } from "@/components/marketing/product-frame";
import { TrackLink } from "@/components/track-link";
import type { ReportLine } from "@/lib/custom-report/analysis";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { REPORT_OFFER } from "@/lib/constants";
import { AtAGlance } from "./market-report/[token]/at-a-glance";
import { placeLabel } from "./market-report/report-body";
import { lineName, readOnLabel, shortInstitutionName } from "./for-institutions/board-math";
import type { ShowcaseAnswer } from "./landing-hamilton-answer";
import { HamiltonTabs, type HamiltonStep } from "./landing-hamilton-tabs";
import { DISPLAY_H2, SAMPLE_REPORT_HREF, SANS, SECTION_INNER } from "./landing-shared";
import { FeeEvidence, dollars, workflowLead, type WorkflowLead } from "./landing-workflow";

/** Fees in the market overview, the selected one always among them. */
const OVERVIEW_ROWS = 6;
/** Named competitors shown as chips; the count of the rest follows. */
const PEER_CHIPS = 6;
/** Named competitors listed beside Hamilton's answer; the rest open on request. */
const ANSWER_PEERS = 6;

type Compared = ReportLine & { own: NonNullable<ReportLine["own"]>; peers: NonNullable<ReportLine["peers"]> };

/**
 * One of the three restrained labels on the capture (James, Oct 17): Your institution, Named
 * peers, Inspectable sources.
 */
function Note({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-brick/40 bg-brick-tint px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-brick-ink" data-annotation="">
      {children}
    </span>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{children}</p>;
}

function marketLabel(report: MarketReport): string {
  const market = report.data.market!;
  return `${placeLabel(market.places[0])} area${market.county_fips.length > 1 ? ` (${market.county_fips.length} counties)` : ""}`;
}

/** The peer median, the local, state and national medians, in that order, as the answer gives them. */
const BENCHMARK_ORDER = [/^peer median/i, /^local (market|median)/i, /^(?!peer|national|local|fed|banks)[a-z ]+ median$/i, /^national median/i];

function keyBenchmarks(answer: ShowcaseAnswer): ShowcaseAnswer["benchmarks"] {
  return BENCHMARK_ORDER.flatMap((re) => answer.benchmarks.find((b) => re.test(b.label)) ?? []).filter(
    (b, i, all) => all.indexOf(b) === i,
  );
}

/** "Oct 16, 2026" from an ISO date. */
function dayLabel(iso: string): string {
  return readOnLabel(iso) ?? iso;
}

/**
 * Step 1: the institution's own workspace view. Its name, its market and the named competitors
 * it is compared with, then several fees side by side with the count behind each median. The
 * fee Hamilton's answer is about is marked and carries into the next two steps.
 */
function MarketOverview({ report, lead, peerGroup }: { report: MarketReport; lead: WorkflowLead; peerGroup: string | null }) {
  const { data, analysis } = report;
  const compared = analysis.lines.filter((l): l is Compared => l.comparable && !!l.own && !!l.peers);
  const rows = compared.slice(0, OVERVIEW_ROWS);
  if (!rows.some((l) => l.key === lead.line.key)) rows.splice(OVERVIEW_ROWS - 1, 1, lead.line);
  const named = [...analysis.named].sort((a, b) => (b.market_deposits ?? 0) - (a.market_deposits ?? 0));
  const read = readOnLabel(lead.line.own.schedule_read_on);
  return (
    <ProductFrame label="Hamilton · Market overview" aside={read ? <span className="max-sm:hidden">Fees read {read}</span> : undefined}>
      <div className="grid gap-6 p-5 sm:p-7" data-hamilton-overview="">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <Note>Your institution</Note>
            <p className="mt-2 text-[1.5rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[1.85rem]">{data.subject.institution_name}</p>
            <p className="mt-1 text-[14px] text-ink-muted">{marketLabel(report)}</p>
          </div>
          <div className="min-w-0 max-w-xl">
            <Note>Named peers</Note>
            <p className="mt-2 text-[14px] text-ink-soft">
              Compared with {analysis.readiness.competitorsWithData} local competitors that publish their fees, including
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Named local competitors">
              {named.slice(0, PEER_CHIPS).map((c, i) => (
                <li key={c.institution_id} className={`${i >= 3 ? "max-sm:hidden " : ""}rounded-md border border-border bg-paper px-2 py-1 text-[13px] text-ink`}>
                  {shortInstitutionName(c.institution_name)}
                </li>
              ))}
            </ul>
            {peerGroup ? <p className="mt-2 text-[13px] text-ink-muted">Peer group: {peerGroup}</p> : null}
          </div>
        </div>
        <div role="table" aria-label={`${data.subject.institution_name}'s fees against local competitors`} className="text-[14px]">
          <div role="row" className="sr-only grid-cols-[minmax(0,1.6fr)_5rem_6rem_7rem_6.5rem] gap-4 border-b border-border pb-2 text-[12px] font-medium text-ink-muted sm:not-sr-only sm:grid">
            <span role="columnheader">Fee</span>
            <span role="columnheader" className="text-right">Yours</span>
            <span role="columnheader" className="text-right">Local median</span>
            <span role="columnheader" className="text-right">Middle half</span>
            <span role="columnheader" className="text-right">Competitors</span>
          </div>
          {rows.map((l) => {
            const selected = l.key === lead.line.key;
            return (
              <div
                key={l.key}
                role="row"
                data-selected={selected ? "" : undefined}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 border-b border-border/60 py-2.5 last:border-0 sm:grid-cols-[minmax(0,1.6fr)_5rem_6rem_7rem_6.5rem] ${
                  selected ? "-mx-3 rounded-lg border-transparent bg-brick-tint/60 px-3 ring-1 ring-inset ring-brick/30" : ""
                }`}
              >
                <span role="cell" className={`text-ink ${selected ? "font-semibold" : ""}`}>
                  {lineName(l.label)}
                  {selected ? <span className="ml-2 text-[12px] font-semibold text-brick">In Hamilton&apos;s answer</span> : null}
                </span>
                <span role="cell" className="text-right [font-variant-numeric:tabular-nums] font-semibold text-ink">{dollars(l.own.amount)}</span>
                <span role="cell" className="col-span-2 [font-variant-numeric:tabular-nums] text-[13px] text-ink-muted sm:col-span-1 sm:text-right sm:text-[14px] sm:text-ink">
                  <span className="sm:hidden">Local median </span>
                  {dollars(l.peers.median)}
                  <span className="sm:hidden"> · {l.peers.n} competitors</span>
                </span>
                <span role="cell" className="text-right [font-variant-numeric:tabular-nums] text-ink-soft max-sm:sr-only">
                  {dollars(l.peers.p25)}–{dollars(l.peers.p75)}
                </span>
                <span role="cell" className="text-right [font-variant-numeric:tabular-nums] text-ink-soft max-sm:sr-only">{l.peers.n}</span>
              </div>
            );
          })}
        </div>
      </div>
    </ProductFrame>
  );
}

/**
 * Step 2, the main view: a real saved Hamilton answer about the selected fee, cropped to the
 * findings, the named competitors, the rules that apply, the sources and what the evidence
 * leaves out. The question is shown as it was asked.
 */
function AnswerView({ answer }: { answer: ShowcaseAnswer }) {
  const peers = answer.competitors;
  return (
    <ProductFrame label={`Hamilton · Ask · ${answer.institutionName}`} aside={<span className="max-sm:hidden">Saved answer · {dayLabel(answer.askedOn)}</span>}>
      <div className="border-b border-border bg-paper/60 px-5 py-4 sm:px-7" data-example-question="">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Ask Hamilton</p>
        <p className="mt-1.5 rounded-md border border-border bg-surface-0 px-3 py-2 text-[15px] leading-snug text-ink">{answer.question}</p>
        {answer.peerGroup ? <p className="mt-2 text-[13px] text-ink-muted">Peer group: {answer.peerGroup}</p> : null}
      </div>
      <div className="grid gap-8 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:gap-10" data-hamilton-answer="">
        <div className="min-w-0">
          <SectionLabel>Hamilton&apos;s view</SectionLabel>
          <p className="mt-2 text-[17px] leading-relaxed text-ink">{answer.view}</p>
          {answer.own !== null && answer.benchmarks.length > 0 ? (
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-border py-4 sm:grid-cols-5" data-answer-benchmarks="">
              <div>
                <dt className="text-[12px] text-ink-muted">{answer.institutionName}</dt>
                <dd className="[font-variant-numeric:tabular-nums] text-[1.4rem] font-semibold leading-tight text-brick">{dollars(answer.own)}</dd>
              </div>
              {keyBenchmarks(answer).map((b) => (
                <div key={b.label}>
                  <dt className="text-[12px] text-ink-muted">{b.label}</dt>
                  <dd className="[font-variant-numeric:tabular-nums] text-[1.4rem] font-semibold leading-tight text-ink">{dollars(b.value)}</dd>
                  {b.n !== null ? <dd className="text-[12px] text-ink-muted">{b.n.toLocaleString("en-US")} institutions</dd> : null}
                </div>
              ))}
            </dl>
          ) : null}
          <div className="mt-6">
            <SectionLabel>Findings</SectionLabel>
            <ol className="mt-2 space-y-2.5 text-[15px] leading-relaxed text-ink">
              {answer.findings.slice(0, 3).map((f, i) => (
                <li key={f} className="grid grid-cols-[1.5rem_minmax(0,1fr)]">
                  <span className="[font-variant-numeric:tabular-nums] text-[13px] font-semibold text-ink-muted">{i + 1}</span>
                  <span>{f}</span>
                </li>
              ))}
            </ol>
          </div>
          {answer.policy.length > 0 ? (
            <div className="mt-6" data-answer-policy="">
              <SectionLabel>Rules and guidance cited</SectionLabel>
              <ul className="mt-2 space-y-3 text-[15px] leading-relaxed text-ink">
                {answer.policy.slice(0, 1).map((p) => (
                  <li key={p.text}>
                    {p.text}
                    {p.source ? (
                      <span className="mt-0.5 block text-[13px] text-ink-muted">
                        {p.url ? (
                          <a href={p.url} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-2 hover:decoration-ink">
                            {p.source}
                          </a>
                        ) : (
                          p.source
                        )}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="min-w-0 space-y-7">
          {peers.length > 0 ? (
            <div data-answer-peers="">
              <Note>Named peers</Note>
              <div className="mt-2"><SectionLabel>Local competitors</SectionLabel></div>
              <ul className="mt-2 divide-y divide-border/70 text-[14px]">
                {peers.slice(0, ANSWER_PEERS).map((p) => (
                  <li key={p.name} className="flex items-baseline justify-between gap-3 py-2">
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noreferrer" className="min-w-0 text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
                        {shortInstitutionName(p.name)}
                      </a>
                    ) : (
                      <span className="min-w-0 text-ink">{shortInstitutionName(p.name)}</span>
                    )}
                    <span className="[font-variant-numeric:tabular-nums] font-semibold text-ink">{dollars(p.amount)}</span>
                  </li>
                ))}
              </ul>
              {peers.length > ANSWER_PEERS ? (
                <details className="mt-1">
                  <summary className="cursor-pointer list-none text-[13px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink [&::-webkit-details-marker]:hidden">
                    All {peers.length} named competitors
                  </summary>
                  <ul className="mt-2 divide-y divide-border/70 text-[14px]">
                    {peers.slice(ANSWER_PEERS).map((p) => (
                      <li key={p.name} className="flex items-baseline justify-between gap-3 py-2">
                        <span className="min-w-0 text-ink">{shortInstitutionName(p.name)}</span>
                        <span className="[font-variant-numeric:tabular-nums] font-semibold text-ink">{dollars(p.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {answer.competitorNote ? <p className="mt-2 text-[12px] text-ink-muted">{answer.competitorNote} Each name opens its published fee schedule.</p> : null}
            </div>
          ) : null}
          {answer.limitations.some((l) => !answer.view.includes(l)) ? (
            <div data-answer-limits="">
              <SectionLabel>What the evidence does not show</SectionLabel>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-ink-soft">
                {answer.limitations.filter((l) => !answer.view.includes(l)).slice(0, 2).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
      {answer.sources.length > 0 ? (
        <div className="border-t border-border bg-paper/50 px-5 py-4 sm:px-7" data-answer-sources="">
          <Note>Inspectable sources</Note>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-soft">
            {answer.sources.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </ProductFrame>
  );
}

/**
 * Step 3: the sample report's opening page beside a readable detail of the same fee. Hamilton
 * does not build this report from the answer, so it is labelled as a separate sample.
 */
function ReportView({ report, lead }: { report: MarketReport; lead: WorkflowLead }) {
  const { data, analysis } = report;
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2" data-workflow-report="">
      <ProductFrame label={`Separate sample report · ${REPORT_OFFER.name}`}>
        <div className="p-5 sm:p-7">
          <p className="text-[1.2rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[1.4rem]">
            {data.subject.institution_name} against its local market
          </p>
          <p className="mt-1 text-[13px] text-ink-muted">
            {marketLabel(report)} · {analysis.readiness.competitorsWithData} local competitors with published fees
          </p>
          <div className="[&>section]:mt-4 [&>section]:p-4 sm:[&>section]:p-5">
            <AtAGlance lines={analysis.lines} highlight={lead.line.key} limit={5} narrow />
          </div>
        </div>
      </ProductFrame>
      <ProductFrame label={`Detail · ${lineName(lead.line.label)}`} aside={<Note>Inspectable sources</Note>}>
        <FeeEvidence lead={lead} />
      </ProductFrame>
    </div>
  );
}

/**
 * Hamilton's own full-width section (James, Oct 17 04:08): what an institution brings, what
 * Hamilton does with it and what it leaves with, shown as one institution's real workspace in
 * three steps. The same fee carries through all three. The demonstration needs the live sample
 * report and the saved answer for the same institution, with the answer's fee in the report;
 * without them the section keeps its promise and its two actions and shows no stand-ins.
 */
export function LandingHamilton({ report, answer }: { report: MarketReport | null; answer: ShowcaseAnswer | null }) {
  const sameInstitution = report && answer && report.data.subject.institution_id === answer.institutionId;
  const found = sameInstitution && answer.feeKey ? workflowLead(report, answer.feeKey) : null;
  // The fee must read the same in all three steps; when the live report has moved since the
  // answer was saved, the demonstration is left out rather than showing two prices.
  const lead = found && answer && answer.own !== null && found.line.own.amount === answer.own ? found : null;
  const steps: HamiltonStep[] | null =
    report && answer && lead
      ? [
          {
            id: "compare",
            label: "Compare your market",
            lead: "Find the fees worth a closer look.",
            detail: "Compare your schedule with local competitors and institutions your size.",
            panel: <MarketOverview report={report} lead={lead} peerGroup={answer.peerGroup} />,
          },
          {
            id: "investigate",
            label: "Investigate a difference",
            lead: "Understand the comparison before acting on it.",
            detail: "Examine the institutions, policies and source documents behind the figures.",
            panel: <AnswerView answer={answer} />,
          },
          {
            id: "report",
            label: "Prepare your report",
            lead: "Bring the evidence to committee.",
            detail: "Review the findings and supporting sources in one document.",
            panel: <ReportView report={report} lead={lead} />,
          },
        ]
      : null;
  return (
    <section id="hamilton" aria-labelledby="hamilton-heading" className="scroll-mt-20 border-t border-border bg-paper">
      <div className={`${SECTION_INNER} py-16 sm:py-20`}>
        <div className="mx-auto max-w-3xl text-center">
          <h2 id="hamilton-heading" className="flex justify-center">
            <Logo mark="hamilton-wordmark" height={30} title="" />
            <span className="sr-only">Hamilton</span>
          </h2>
          <p className={`mt-5 ${DISPLAY_H2}`} style={SANS}>
            Your fees. Your competitors. Your next committee report.
          </p>
          <p className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-ink-soft">
            Hamilton brings your institution&apos;s fees, peer comparisons and supporting evidence into one workspace.
          </p>
        </div>
        {steps ? (
          <div className="mt-10 sm:mt-12">
            <HamiltonTabs steps={steps} />
          </div>
        ) : null}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3" data-hamilton-actions="">
          <TrackLink
            event="upgrade_click"
            eventProps={{ placement: "home_hamilton" }}
            href={PRO_PLANS_NAV.href}
            className="fi-btn fi-btn-primary min-h-11 justify-center whitespace-nowrap"
          >
            {PRO_PLANS_NAV.label}
          </TrackLink>
          <TrackLink
            event="sample_report_click"
            eventProps={{ placement: "home_hamilton" }}
            href={SAMPLE_REPORT_HREF}
            className="fi-btn fi-btn-secondary min-h-11 justify-center whitespace-nowrap"
          >
            Open the sample report
          </TrackLink>
        </div>
      </div>
    </section>
  );
}
