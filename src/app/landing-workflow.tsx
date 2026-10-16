import { LocalCompetitors, competitorColumns } from "@/components/hamilton/benchmark/LocalCompetitors";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { ProductFrame } from "@/components/marketing/product-frame";
import { TrackLink } from "@/components/track-link";
import type { ReportLine } from "@/lib/custom-report/analysis";
import type { MarketReport } from "@/lib/custom-report/report-data";
import type { MarketFeeLine } from "@/lib/data-store/custom-report-market";
import type { BriefingLocalMarket } from "@/lib/hamilton/workspace/types";
import { PRODUCT_NAME, REPORT_OFFER } from "@/lib/constants";
import { MarketReportBody, placeLabel } from "./market-report/report-body";
import { POSITION_TEXT, feeMoney, lineName, readOnLabel, shortInstitutionName } from "./for-institutions/board-math";
import { buildCompetitorBoard } from "./for-institutions/pro-view";
import { verifiedSourceQuote } from "./for-institutions/sample-sources";
import { SampleTabs } from "./landing-sample-tabs";
import { DISPLAY_H2, SAMPLE_REPORT_HREF, SANS, SECTION_INNER, TEXT_LINK } from "./landing-shared";

/** Competitors in the Compare screen: all of them on a wide screen, the largest few on a phone. */
const WIDE_ROWS = 8;
const PHONE_ROWS = 5;
const PHONE_COLUMNS = 2;
/** Named competitors opened under the finding. */
const EVIDENCE_PEERS = 3;
const FULL_EXAMPLE = "Open full example";

/**
 * The sample institution's market as Hamilton's Research screen holds it (`BriefingLocalMarket`),
 * built from the same live sample report, so the Compare screen, the finding and the report
 * carry one institution, one competitor set and one set of figures.
 */
export function workflowMarket(report: MarketReport, rows = WIDE_ROWS): BriefingLocalMarket | null {
  const { data, analysis } = report;
  if (!data.market) return null;
  const own: Record<string, number> = {};
  for (const line of analysis.lines) if (line.own) own[line.key] = line.own.amount;
  const competitors = analysis.named.slice(0, rows).map((c) => ({
    institutionId: c.institution_id,
    name: shortInstitutionName(c.institution_name),
    own: false,
    marketDeposits: c.market_deposits,
    values: c.fees,
  }));
  if (competitors.length === 0) return null;
  return {
    info: {
      basis: data.market.basis,
      places: data.market.places.map(placeLabel),
      sodYear: data.market.sod_year,
      institutions: analysis.readiness.competitorsInMarket,
      source: { label: "FDIC Summary of Deposits" },
    },
    rows: [
      {
        institutionId: data.subject.institution_id,
        name: data.subject.institution_name,
        own: true,
        marketDeposits: data.subject.market_deposits,
        values: own,
      },
      ...competitors,
    ],
  };
}

/** Lines the report does not compare (too few local competitors publish them) stay off the screen. */
function notComparedKeys(report: MarketReport): string[] {
  return report.analysis.lines.filter((l) => !l.comparable).map((l) => l.key);
}

/** The finding the demo opens: the line furthest outside the local range, as /for-institutions leads. */
type FindingLine = ReportLine & { own: NonNullable<ReportLine["own"]>; peers: NonNullable<ReportLine["peers"]> };

export function workflowFinding(report: MarketReport): {
  line: FindingLine;
  quote: string | null;
  peers: { name: string; amount: number; evidence: MarketFeeLine; quote: string | null }[];
} | null {
  const leadKey = buildCompetitorBoard(report)?.leadKey;
  const line = report.analysis.lines.find((l) => l.key === leadKey);
  if (!line?.own || !line.peers) return null;
  const peers = report.analysis.named
    .filter((c) => c.sources[line.key])
    .slice(0, EVIDENCE_PEERS)
    .map((c) => {
      const evidence = c.sources[line.key];
      return {
        name: shortInstitutionName(c.institution_name),
        amount: evidence.amount,
        evidence,
        quote: verifiedSourceQuote({ key: line.key, own: evidence }),
      };
    });
  return { line: line as FindingLine, quote: verifiedSourceQuote(line), peers };
}

function gapText(amount: number, own: number): string {
  const gap = Math.round((amount - own) * 100) / 100;
  if (gap === 0) return "same";
  return `${feeMoney(Math.abs(gap))} ${gap < 0 ? "less" : "more"}`;
}

function SourceLine({ quote, readOn, href }: { quote: string | null; readOn: string | null; href: string | null }) {
  const read = readOnLabel(readOn);
  return (
    <>
      {quote ? (
        <blockquote className="font-mono text-[13px] leading-relaxed text-ink-soft">&ldquo;{quote}&rdquo;</blockquote>
      ) : null}
      <p className="mt-1.5 text-[13px] text-ink-muted">
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
    </>
  );
}

/** Step 1: Hamilton's Research screen, cropped to the local competitors table. */
function CompareScreen({ report }: { report: MarketReport }) {
  const wide = workflowMarket(report, WIDE_ROWS);
  const phone = workflowMarket(report, PHONE_ROWS);
  if (!wide || !phone) return null;
  const skip = notComparedKeys(report);
  const finding = workflowFinding(report);
  // On a phone: the finding's fee and the next most published one, and no deposits column, so
  // the table reads at full size with no sideways scroll.
  const columns = competitorColumns(phone, skip);
  const lead = finding && columns.includes(finding.line.key) ? finding.line.key : columns[0];
  const keep = [lead, ...columns.filter((c) => c !== lead)].slice(0, PHONE_COLUMNS);
  const phoneSkip = report.analysis.lines.map((l) => l.key).filter((key) => !keep.includes(key));
  const phoneMarket = { ...phone, rows: phone.rows.map((r) => ({ ...r, marketDeposits: null })) };
  const name = report.data.subject.institution_name;
  return (
    <ProductFrame label="Hamilton · Research">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2.5 text-[13px] sm:px-6">
        <span>
          <span className="text-ink-muted">Your institution: </span>
          <strong className="text-ink">{name}</strong>
        </span>
        <span className="text-ink-muted">Market: {placeLabel(report.data.market!.places[0])} area</span>
      </div>
      <div className="p-4 sm:p-6">
        <div className="hidden sm:block">
          <LocalCompetitors market={wide} notCompared={skip} headingId="compare-wide" />
        </div>
        <div className="sm:hidden">
          <LocalCompetitors market={phoneMarket} notCompared={phoneSkip} headingId="compare-phone" />
        </div>
        {finding ? (
          <p className="mt-4 rounded-lg bg-paper px-4 py-3 text-[14px] text-ink" data-workflow-difference>
            <strong>{lineName(finding.line.label)}:</strong> {name} charges {feeMoney(finding.line.own.amount)}.{" "}
            {finding.line.chargingLess ?? 0} of {finding.line.peers.n} local competitors charge less; the local median is{" "}
            {feeMoney(finding.line.peers.median)}.
          </p>
        ) : null}
      </div>
    </ProductFrame>
  );
}

/** Step 2: one figure opened to the schedule that states it, beside the same fee at named competitors. */
function InspectScreen({ report }: { report: MarketReport }) {
  const finding = workflowFinding(report);
  if (!finding) return null;
  const { line, quote, peers } = finding;
  const name = report.data.subject.institution_name;
  return (
    <ProductFrame label={`${REPORT_OFFER.name} · Sources`}>
      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
        <div>
          <p className="text-[13px] font-semibold text-ink-muted">
            {name} · {lineName(line.label)}
          </p>
          <p className="mt-1 font-mono text-[2rem] font-semibold leading-none text-ink">{feeMoney(line.own.amount)}</p>
          <p className="mt-2 text-[14px] text-ink-soft">
            {line.position ? `${POSITION_TEXT[line.position]} · ` : ""}local median {feeMoney(line.peers.median)}, middle half{" "}
            {feeMoney(line.peers.p25)} to {feeMoney(line.peers.p75)}
          </p>
          <div className="mt-4 rounded-lg border border-border bg-paper px-4 py-3" data-workflow-evidence>
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">As the schedule states it</p>
            <SourceLine quote={quote} readOn={line.own.schedule_read_on} href={line.own.source_url} />
          </div>
        </div>
        {peers.length > 0 ? (
          <div>
            <p className="text-[13px] font-semibold text-ink-muted">The same fee at named competitors</p>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {peers.map((peer, i) => (
                <li key={peer.name}>
                  <details open={i === 0} className="group px-4 py-3" data-workflow-peer>
                    <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0 text-[14px] font-medium text-ink">
                        <span aria-hidden className="mr-1.5 inline-block text-ink-muted transition-transform group-open:rotate-90 motion-reduce:transition-none">
                          ›
                        </span>
                        {peer.name}
                      </span>
                      <span className="shrink-0 text-right text-[14px]">
                        <span className="font-mono font-semibold text-ink">{feeMoney(peer.amount)}</span>
                        <span className="ml-2 text-[12px] text-ink-muted">{gapText(peer.amount, line.own.amount)}</span>
                      </span>
                    </summary>
                    <div className="mt-2 pl-4">
                      <SourceLine quote={peer.quote} readOn={peer.evidence.schedule_read_on} href={peer.evidence.source_url} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </ProductFrame>
  );
}

/**
 * Step 3: the sample report itself, drawn by the renderer buyers get, cropped to its opening
 * (header, at a glance, what stands out, the fee table). The crop is a picture of the report:
 * its links stay inert, and "Open full example" opens the whole report.
 */
function ReportScreen({ report }: { report: MarketReport }) {
  return (
    <ProductFrame label={`${REPORT_OFFER.name} · Sample`}>
      <div className="relative max-h-[36rem] overflow-hidden sm:max-h-[56rem]" data-workflow-report>
        <div inert className="p-4 sm:p-6">
          <MarketReportBody
            report={report}
            eyebrow={REPORT_OFFER.name}
            titleAs="h2"
            preparedOn={new Date()}
            contactHref="/contact?source=sample_report"
            actions={null}
            correctionNote={null}
          />
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-surface-0 to-transparent" />
      </div>
      <div className="border-t border-border px-4 py-3 sm:px-6">
        <a href={SAMPLE_REPORT_HREF} className={`inline-flex min-h-11 items-center text-[14px] ${TEXT_LINK}`}>
          {FULL_EXAMPLE} →
        </a>
      </div>
    </ProductFrame>
  );
}

function Step({ title, line, children }: { title: string; line: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 max-sm:flex-col max-sm:items-center max-sm:text-center">
        <div className="max-w-xl">
          <h3 className="text-[1.5rem] !font-semibold leading-tight !tracking-[-0.02em] text-ink sm:text-[1.75rem]" style={SANS}>
            {title}
          </h3>
          <p className="mt-2 text-[16px] leading-relaxed text-ink-soft">{line}</p>
        </div>
        <a href={SAMPLE_REPORT_HREF} className={`text-[14px] ${TEXT_LINK}`}>
          {FULL_EXAMPLE}
        </a>
      </div>
      <div className="mt-5 sm:mt-6">{children}</div>
    </div>
  );
}

/**
 * The homepage's product section (James's notes of Oct 16): one sample institution through one
 * task, from comparing its fees to inspecting a finding to the report it produces. Every
 * screen is drawn by the product's own components from the live sample report, the same one
 * /reports/sample-competitive-fee-position shows; without that report the section is left out.
 */
export function LandingWorkflow({ report }: { report: MarketReport | null }) {
  if (!report?.data.market || !report.analysis.readiness.ready || !workflowMarket(report)) return null;
  const { subject } = report.data;
  const name = subject.institution_name;
  const where = [subject.city ? placeLabel(subject.city) : null, subject.state_code].filter(Boolean).join(", ");
  const finding = workflowFinding(report);
  const tabs = [
    {
      key: "compare",
      label: "1. Compare",
      panel: (
        <Step title="Compare your fees" line={`${name}'s market, its named competitors and the fees each one publishes.`}>
          <CompareScreen report={report} />
        </Step>
      ),
    },
    finding
      ? {
          key: "inspect",
          label: "2. Inspect",
          panel: (
            <Step
              title="Inspect a finding"
              line={`Open ${name}'s ${lineName(finding.line.label).toLowerCase()} fee to the schedule wording, the published source and the date it was read.`}
            >
              <InspectScreen report={report} />
            </Step>
          ),
        }
      : null,
    {
      key: "report",
      label: "3. Report",
      panel: (
        <Step title="Share the report" line="The report that comparison produces, with findings, the comparison table and a source for every figure.">
          <ReportScreen report={report} />
        </Step>
      ),
    },
  ].filter((tab) => tab !== null);

  return (
    <section id="see-it-work" aria-labelledby="workflow-heading" className="bg-paper">
      <div className={`${SECTION_INNER} pb-14 pt-6 sm:pb-20 sm:pt-10`}>
        <div className="max-w-2xl max-sm:mx-auto max-sm:text-center">
          <h2 id="workflow-heading" className={DISPLAY_H2} style={SANS}>
            One institution, start to finish
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-ink-soft" data-workflow-sample>
            Sample institution: {name}
            {where ? `, ${where}` : ""}, with live figures from the {PRODUCT_NAME}.
          </p>
        </div>
        <div className="mt-8">
          <SampleTabs tabs={tabs} label="Steps" />
        </div>
        <p className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3 max-sm:justify-center">
          <TrackLink
            event="upgrade_click"
            eventProps={{ placement: "home_workspace" }}
            href={PRO_PLANS_NAV.href}
            className="fi-btn fi-btn-secondary min-h-11"
          >
            {PRO_PLANS_NAV.label}
          </TrackLink>
          <TrackLink
            event="contact_sales"
            eventProps={{ placement: "home_workspace_demo" }}
            href={DEMO_REQUEST_NAV.href}
            className={`text-[14px] ${TEXT_LINK}`}
          >
            {DEMO_REQUEST_NAV.label}
          </TrackLink>
        </p>
      </div>
    </section>
  );
}
