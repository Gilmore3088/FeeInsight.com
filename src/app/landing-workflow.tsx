import type { ReactNode } from "react";
import { DEMO_REQUEST_NAV } from "@/components/nav-items";
import { ProductFrame } from "@/components/marketing/product-frame";
import { TrackLink } from "@/components/track-link";
import type { ReportLine } from "@/lib/custom-report/analysis";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { FEE_LINE_RULES } from "@/lib/custom-report/rules";
import type { MarketFeeLine } from "@/lib/data-store/custom-report-market";
import { REPORT_OFFER } from "@/lib/constants";
import { AtAGlance } from "./market-report/[token]/at-a-glance";
import { placeLabel } from "./market-report/place-label";
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
 * The answer: the finding in one line, the bank against the local median and three named
 * competitors as bars, then the schedule line that states the bank's fee. Checking the source is
 * part of trusting the comparison, so both sit in one card (James's notes of Oct 16).
 */
function Answer({ lead }: { lead: WorkflowLead }) {
  const { line } = lead;
  const rows = [
    { label: lead.name, amount: line.own.amount, kind: "own" as const },
    { label: "Local median", amount: line.peers.median, kind: "median" as const },
    ...lead.peers.map((p) => ({ label: p.name, amount: p.amount, kind: "peer" as const })),
  ];
  const hi = Math.max(...rows.map((r) => r.amount), line.peers.max) || 1;
  const gapWords =
    lead.gap === 0 ? "At the local median" : `${dollars(Math.abs(lead.gap))} ${lead.gap > 0 ? "above" : "below"} the local median`;
  return (
    <div className="p-5 sm:p-6" data-workflow-compare>
      <p className="text-[13px] font-semibold text-ink-muted">{lineName(line.label)}</p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[2.25rem] font-semibold leading-none text-ink">{dollars(line.own.amount)}</span>
        <span className="text-[15px] font-semibold text-ink">{gapWords}</span>
      </p>
      <p className="mt-2 text-[13px] text-ink-muted">
        Local median {dollars(line.peers.median)} · {line.peers.n} local competitors publish this fee · {line.chargingLess ?? 0} charge less
      </p>
      <ul className="mt-5 space-y-3" aria-label={`${lineName(line.label)}: ${lead.name} against its local market`}>
        {rows.map((row) => (
          <li key={`${row.kind}-${row.label}`} className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_3.75rem] items-center gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_4rem]">
            {/* Names wrap to a second line rather than being cut. */}
            <span className={`text-[14px] leading-snug ${row.kind === "peer" ? "text-ink-soft" : "font-semibold text-ink"}`}>{row.label}</span>
            <span className="relative h-3 rounded-full bg-paper">
              {/* The bank in the report's accent (as its At a glance marks it), the median in ink. */}
              <span
                className={`absolute inset-y-0 left-0 rounded-full ${row.kind === "own" ? "bg-brick" : row.kind === "median" ? "bg-ink" : "bg-ink-muted/50"}`}
                style={{ width: `${Math.max(2, (row.amount / hi) * 100)}%` }}
              />
            </span>
            <span className="text-right font-mono text-[14px] font-semibold text-ink">{dollars(row.amount)}</span>
          </li>
        ))}
      </ul>
      <figure className="mt-6 rounded-lg border border-border bg-paper px-4 py-4" data-workflow-evidence>
        <figcaption className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">From {lead.name}&apos;s fee schedule</figcaption>
        <blockquote className="mt-2 font-mono text-[14px] leading-relaxed text-ink">&ldquo;{marked(lead.quote)}&rdquo;</blockquote>
        <SourceNote readOn={line.own.schedule_read_on} href={line.own.source_url} />
      </figure>
      {lead.all.length > lead.peers.length || lead.peers.length > 0 ? (
        <details className="mt-5 border-t border-border pt-4" data-workflow-more>
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

/**
 * Hamilton's demonstration on the homepage (James's notes of Oct 16): a question a pricing team
 * asks, answered from the live sample report, with the schedule line behind it. The question sits
 * in the frame as Hamilton's Ask bar shows it, not as a chat bubble (James, 14:09 and 14:43).
 */
export function HamiltonAnswer({ lead }: { lead: WorkflowLead }) {
  const fee = lineName(lead.line.label).toLowerCase();
  return (
    <div className="flex min-w-0 flex-1 flex-col" data-hamilton-answer="">
      <ProductFrame label={`Hamilton · Sample answer · ${lead.name}`} className="flex flex-1 flex-col">
        <div className="border-b border-border bg-paper/60 px-5 py-4 sm:px-6" data-example-question>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Ask Hamilton</p>
          <p className="mt-1.5 rounded-md border border-border bg-surface-0 px-3 py-2 text-[15px] leading-snug text-ink">
            How does our {fee} fee compare with local competitors?
          </p>
        </div>
        <Answer lead={lead} />
      </ProductFrame>
    </div>
  );
}

/**
 * The report the answer becomes, kept compact: one short explanation that names the answer's fee,
 * then the report's own At a glance with that fee marked, and a link to the whole sample report.
 */
export function ReportPreview({ report, lead }: { report: MarketReport; lead: WorkflowLead }) {
  const { data, analysis } = report;
  const market = data.market!;
  const marketLabel = `${placeLabel(market.places[0])} area${market.county_fips.length > 1 ? ` (${market.county_fips.length} counties)` : ""}`;
  return (
    // One centered column: the report's own table needs about 700px to keep its columns.
    <div className="mx-auto grid max-w-3xl gap-8">
      <div className="text-center" data-report-intro="">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{REPORT_OFFER.name}</p>
        <h3 className="mt-3 text-[1.6rem] font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-[2rem]">
          The report your committee reads
        </h3>
        <p className="mx-auto mt-4 max-w-md text-[17px] leading-relaxed text-ink-soft">
          It sets each of your published fees against your local competitors, ties every figure to its source and marks the{" "}
          {lineName(lead.line.label).toLowerCase()} fee from the answer above.
        </p>
        <p className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
          <a href={SAMPLE_REPORT_HREF} className="fi-btn fi-btn-secondary min-h-11">
            Open the full report
          </a>
          <TrackLink event="contact_sales" eventProps={{ placement: "home_workspace_demo" }} href={DEMO_REQUEST_NAV.href} className={`text-[14px] ${TEXT_LINK}`}>
            {DEMO_REQUEST_NAV.standaloneLabel}
          </TrackLink>
        </p>
      </div>
      <div className="min-w-0">
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
      </div>
    </div>
  );
}
