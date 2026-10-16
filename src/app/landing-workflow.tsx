import type { ReactNode } from "react";
import { DEMO_REQUEST_NAV } from "@/components/nav-items";
import { SchedulePositionsChart } from "@/components/hamilton/analyze/schedule-answer";
import { ProductFrame } from "@/components/marketing/product-frame";
import { TrackLink } from "@/components/track-link";
import type { ReportLine } from "@/lib/custom-report/analysis";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { FEE_LINE_RULES } from "@/lib/custom-report/rules";
import type { MarketFeeLine } from "@/lib/data-store/custom-report-market";
import type { SchedulePosition } from "@/lib/hamilton/workspace/types";
import { REPORT_OFFER } from "@/lib/constants";
import { AtAGlance } from "./market-report/[token]/at-a-glance";
import { placeLabel } from "./market-report/report-body";
import { feeMoney, lineName, readOnLabel, shortInstitutionName } from "./for-institutions/board-math";
import { verifiedSourceQuote } from "./for-institutions/sample-sources";
import { SAMPLE_REPORT_HREF, TEXT_LINK } from "./landing-shared";

/** Named competitors shown beside the finding; the rest open on request. */
const SHOWN_PEERS = 3;
/** Report rows in the preview, the answer's fee among them; the full report has the rest. */
const EXCERPT_ROWS = 3;

type FindingLine = ReportLine & { own: NonNullable<ReportLine["own"]>; peers: NonNullable<ReportLine["peers"]> };

export interface WorkflowPeer {
  name: string;
  amount: number;
  evidence: MarketFeeLine;
  /** The schedule's words for this fee, or null when they don't plainly state this fee. */
  quote: string | null;
}

export interface WorkflowLead {
  name: string;
  line: FindingLine;
  /** The bank's fee less the local median. */
  gap: number;
  quote: string;
  /** Up to three named competitors whose own schedule plainly states the fee. */
  peers: WorkflowPeer[];
  /** Every named competitor with a figure for this fee, lowest first. */
  all: { name: string; amount: number }[];
}

/** "$75" for whole dollars, "$7.50" otherwise: the finding reads as a sentence, not a ledger. */
export function dollars(value: number): string {
  return Number.isInteger(value) ? `$${value}` : feeMoney(value);
}

/**
 * A verified quote the reader can trust at a glance: it passed the shared source check, and it
 * names nothing the fee line excludes ("incoming" in an outgoing-wire quote passes the check
 * when the cell states both, but it does not show the reader this fee).
 */
export function plainQuote(key: string, quote: string | null): string | null {
  if (!quote) return null;
  const rule = FEE_LINE_RULES.find((r) => r.key === key);
  if (rule?.exclude && new RegExp(rule.exclude.replace(/\\[mM]/g, "\\b"), "i").test(quote)) return null;
  return quote;
}

/**
 * The homepage's one finding: the comparable fee furthest from its local median (relative to
 * it) whose own schedule line plainly states it, preferring fees outside the local middle half.
 */
export function workflowLead(report: MarketReport | null): WorkflowLead | null {
  if (!report?.data.market || !report.analysis.readiness.ready) return null;
  const gapOf = (l: FindingLine) => Math.abs(l.own.amount - l.peers.median) / l.peers.median;
  const candidates = report.analysis.lines
    .filter((l): l is FindingLine => l.comparable && !!l.own && !!l.peers && l.peers.median > 0)
    .map((line) => ({ line, quote: plainQuote(line.key, verifiedSourceQuote(line)) }))
    .filter((c): c is { line: FindingLine; quote: string } => c.quote !== null)
    .sort((a, b) => {
      const outA = a.line.position === "in_market" ? 1 : 0;
      const outB = b.line.position === "in_market" ? 1 : 0;
      return outA - outB || gapOf(b.line) - gapOf(a.line);
    });
  const lead = candidates[0];
  if (!lead) return null;
  const { line, quote } = lead;
  const withFee = report.analysis.named.filter((c) => c.sources[line.key]);
  const peers = withFee
    .map((c) => {
      const evidence = c.sources[line.key];
      return {
        name: shortInstitutionName(c.institution_name),
        amount: evidence.amount,
        evidence,
        quote: plainQuote(line.key, verifiedSourceQuote({ key: line.key, own: evidence })),
      };
    })
    .filter((p) => p.quote !== null)
    .slice(0, SHOWN_PEERS);
  return {
    name: report.data.subject.institution_name,
    line,
    gap: Math.round((line.own.amount - line.peers.median) * 100) / 100,
    quote,
    peers,
    all: withFee
      .map((c) => ({ name: shortInstitutionName(c.institution_name), amount: c.sources[line.key].amount }))
      .sort((a, b) => a.amount - b.amount),
  };
}

/** "Capital City Bank's outgoing international wire fee is $25 above the local median." */
export function findingSentence(lead: WorkflowLead): string {
  const fee = `${lead.name}'s ${lineName(lead.line.label).toLowerCase()} fee`;
  if (lead.gap === 0) return `${fee} matches the local median.`;
  return `${fee} is ${dollars(Math.abs(lead.gap))} ${lead.gap > 0 ? "above" : "below"} the local median.`;
}

function SourceNote({ readOn, href }: { readOn: string | null; href: string | null }) {
  const read = readOnLabel(readOn);
  return (
    <p className="mt-2 text-[13px] text-ink-muted">
      {read ? `Read ${read}` : "Read date not recorded"}
      {href ? (
        <>
          {" · "}
          <a href={href} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-2 hover:decoration-ink">
            Published schedule
          </a>
        </>
      ) : null}
    </p>
  );
}

/** Wraps the amounts in a quote in a highlight, as a marker would on the printed page. */
function marked(quote: string): ReactNode[] {
  return quote.split(/(\$\d[\d,]*(?:\.\d{2})?)/).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-[3px] bg-brick-tint px-0.5 text-ink">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

const MORE = "cursor-pointer list-none text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink [&::-webkit-details-marker]:hidden";

/**
 * The schedule line behind the answer's fee, and every competitor with its source on request.
 * Checking the source is part of trusting the comparison (James's notes of Oct 16).
 */
function Evidence({ lead }: { lead: WorkflowLead }) {
  const { line } = lead;
  return (
    <div className="border-t border-border p-5 sm:p-6" data-workflow-compare>
      <figure className="rounded-lg border border-border bg-paper px-4 py-4" data-workflow-evidence>
        <figcaption className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {lineName(line.label)}, from {lead.name}&apos;s fee schedule
        </figcaption>
        <blockquote className="mt-2 font-mono text-[14px] leading-relaxed text-ink">&ldquo;{marked(lead.quote)}&rdquo;</blockquote>
        <SourceNote readOn={line.own.schedule_read_on} href={line.own.source_url} />
      </figure>
      {lead.all.length > lead.peers.length || lead.peers.length > 0 ? (
        <details className="mt-5" data-workflow-more>
          <summary className={MORE}>Every competitor and its source</summary>
          <ul className="mt-3 space-y-4 text-[14px]">
            {lead.peers.map((p) => (
              <li key={p.name} data-workflow-peer>
                <p className="font-medium text-ink">
                  {p.name}: {dollars(p.amount)}
                </p>
                <p className="mt-1 font-mono text-[13px] text-ink-soft">&ldquo;{p.quote}&rdquo;</p>
                <SourceNote readOn={p.evidence.schedule_read_on} href={p.evidence.source_url} />
              </li>
            ))}
          </ul>
          {lead.all.length > lead.peers.length ? (
            <table className="mt-4 w-full text-[14px]">
              <thead>
                <tr className="border-b border-border text-left text-[12px] text-ink-muted">
                  <th scope="col" className="py-1.5 font-medium">All local competitors</th>
                  <th scope="col" className="py-1.5 text-right font-medium">{lineName(line.label)}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lead.all.map((c) => (
                  <tr key={c.name}>
                    <th scope="row" className="py-1.5 text-left font-normal text-ink">{c.name}</th>
                    <td className="py-1.5 text-right font-mono text-ink">{dollars(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

/** "Tallahassee, FL area (3 counties)". */
function marketLabelOf(report: MarketReport): string {
  const market = report.data.market!;
  return `${placeLabel(market.places[0])} area${market.county_fips.length > 1 ? ` (${market.county_fips.length} counties)` : ""}`;
}

/**
 * The sample report's comparable fees as Hamilton's own fee scorecard rows, furthest from the
 * local median first (the order the scorecard states). Within half a cent counts as "at".
 */
export function scorecardRows(report: MarketReport): SchedulePosition[] {
  const peerLabel = `local competitors, ${marketLabelOf(report)}`;
  return report.analysis.lines
    .filter((l): l is FindingLine => l.comparable && !!l.own && !!l.peers && l.peers.median > 0)
    .map((l) => {
      const diff = l.own.amount - l.peers.median;
      return {
        feeCategory: l.key,
        displayName: lineName(l.label),
        current: l.own.amount,
        peerMedian: l.peers.median,
        peerCount: l.peers.n,
        peerLabel,
        direction: Math.abs(diff) < 0.005 ? ("at" as const) : diff > 0 ? ("higher" as const) : ("lower" as const),
        band: { p25: l.peers.p25, p75: l.peers.p75 },
      };
    })
    .sort((a, b) => Math.abs(b.current - b.peerMedian) / b.peerMedian - Math.abs(a.current - a.peerMedian) / a.peerMedian);
}

/**
 * Hamilton on the homepage (James, Oct 16 14:09: "a screenshot of that info from the Hamilton
 * workstation", not a chat mock): Hamilton's own fee scorecard component, drawn from the live
 * sample report, then the schedule line behind the lead fee.
 */
export function HamiltonAnswer({ report, lead }: { report: MarketReport; lead: WorkflowLead }) {
  const rows = scorecardRows(report);
  return (
    <div className="min-w-0" data-hamilton-answer="">
      <ProductFrame label={`Ask Hamilton · ${lead.name} · Sample`}>
        {/* Cropped like a screenshot: the scorecard's summary and distance bars; the per-fee
            cards below them fade out, and the full scorecard is one click into Hamilton. */}
        <div className="relative max-h-[31rem] overflow-hidden p-3 sm:p-4 [&_section]:shadow-none" data-hamilton-scorecard>
          <SchedulePositionsChart rows={rows} />
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-surface-0 to-transparent" />
        </div>
        <Evidence lead={lead} />
      </ProductFrame>
    </div>
  );
}

/**
 * The report the answer becomes, kept compact: the report's own At a glance, its first rows with
 * the answer's fee marked, and a link to the whole sample report.
 */
export function ReportPreview({ report, lead }: { report: MarketReport; lead: WorkflowLead }) {
  const { data, analysis } = report;
  const marketLabel = marketLabelOf(report);
  return (
    <div className="mx-auto max-w-3xl">
      <ProductFrame label={`${REPORT_OFFER.name} · Sample`}>
        <div className="p-4 sm:p-6" data-workflow-report>
          <p className="text-[1.15rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[1.3rem]">
            {data.subject.institution_name} against its local market
          </p>
          <p className="mt-1 text-[13px] text-ink-muted">
            {marketLabel} · {analysis.readiness.competitorsWithData} local competitors with published fees
          </p>
          <div className="[&>section]:mt-4 [&>section]:p-4 sm:[&>section]:p-5">
            <AtAGlance lines={analysis.lines} highlight={lead.line.key} limit={EXCERPT_ROWS} />
          </div>
        </div>
      </ProductFrame>
      <p className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
        <a href={SAMPLE_REPORT_HREF} className="fi-btn fi-btn-secondary min-h-11">
          Open the full report
        </a>
        <TrackLink event="contact_sales" eventProps={{ placement: "home_workspace_demo" }} href={DEMO_REQUEST_NAV.href} className={`text-[14px] ${TEXT_LINK}`}>
          {DEMO_REQUEST_NAV.standaloneLabel}
        </TrackLink>
      </p>
    </div>
  );
}
