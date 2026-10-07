/**
 * The body of a Competitive Fee Position Report: the header card, the at-a-glance
 * table, findings, every fee line against the local market, named competitors with
 * the schedule each amount was read from, and sources and method. Shared by the
 * buyer's signed report (/market-report/[token]) and the public sample report, so the
 * sample always shows exactly what a buyer gets.
 */
import type { ReactNode } from "react";
import { SITE_NAME } from "@/lib/constants";
import {
  MIN_LOCAL_PEERS_PER_LINE,
  NAMED_WITHOUT_DEPOSITS,
  type LinePosition,
  type ReportLine,
} from "@/lib/custom-report/analysis";
import { FEE_LINE_LABELS } from "@/lib/custom-report/rules";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { AtAGlance, SinceBought } from "./[token]/at-a-glance";
import { HamiltonClose } from "./[token]/hamilton-close";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };
const DATE = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

export const POSITION_LABEL: Record<LinePosition, string> = {
  above_market: "Above local range",
  in_market: "Inside local range",
  below_market: "Below local range",
  free: "Free",
};

const POSITION_CLASS: Record<LinePosition, string> = {
  above_market: "bg-[#FBE9E4] text-[#A93D25]",
  in_market: "bg-[#EEF3EC] text-[#3D6B3A]",
  below_market: "bg-[#E8EEF6] text-[#2F5585]",
  free: "bg-[#E8EEF6] text-[#2F5585]",
};

function PositionChip({ line }: { line: ReportLine }) {
  if (!line.position) return <span className="text-[12px] text-[#8A8173]">—</span>;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${POSITION_CLASS[line.position]}`}>
      {POSITION_LABEL[line.position]}
    </span>
  );
}

export interface MarketReportBodyProps {
  report: MarketReport;
  /** Small label over the title. */
  eyebrow: string;
  preparedOn: Date;
  /** Buttons in the header card (print, CSV, contact). */
  actions: ReactNode;
  /** Where "tell us" and "send us a question" links go. */
  contactHref: string;
  /** The closing line of sources and method: who to tell about a wrong figure. */
  correctionNote: ReactNode;
}

export function MarketReportBody({ report, eyebrow, preparedOn, actions, contactHref, correctionNote }: MarketReportBodyProps) {
  const { data, analysis, savedAt, sinceBought } = report;
  const market = data.market!;
  const droppedCount = Object.values(data.dropped ?? {}).reduce((sum, n) => sum + (n ?? 0), 0);
  const name = data.subject.institution_name;
  const marketLabel = `${market.places[0]} area${market.county_fips.length > 1 ? ` (${market.county_fips.length} counties)` : ""}`;
  const comparable = analysis.lines.filter((l) => l.comparable);
  const tableKeys = comparable.slice(0, 6).map((l) => l.key);
  const ownFees = Object.fromEntries(analysis.lines.filter((l) => l.own).map((l) => [l.key, l.own!.amount]));
  const competitorName = new Map(data.competitors.map((c) => [c.institution_id, c.institution_name]));

  return (
    <>
      <section className="flex flex-col gap-5 rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">{eyebrow}</p>
          <h1 className="mt-2 text-[1.5rem] leading-tight tracking-[-0.02em] text-[#1A1815] sm:text-[1.85rem]" style={SERIF}>
            {name} against its local market
          </h1>
          <p className="mt-2 text-[14px] text-[#5A5347]">
            {marketLabel} · verified fees for {analysis.readiness.competitorsWithData} of{" "}
            {analysis.readiness.competitorsInMarket} local competitors · prepared{" "}
            {DATE.format(preparedOn)} by {SITE_NAME}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 print:hidden">{actions}</div>
      </section>

      {!analysis.readiness.ready ? (
        <section className="mt-8 rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6">
          <h2 className="text-xl text-[#1A1815]" style={SERIF}>
            This market is being refreshed
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[#5A5347]">
            {analysis.readiness.reason} We only show a comparison when the local data supports it.{" "}
            <a href={contactHref} className="underline">
              Send us a question
            </a>
            .
          </p>
        </section>
      ) : (
        <>
          {savedAt && (
            <p className="mt-6 rounded-md border border-[#E0D7C9] bg-[#FDFBF8] px-4 py-3 text-sm text-[#5A5347]" role="status">
              These figures are the ones saved on {DATE.format(new Date(savedAt))}, when this report was bought. Our live
              data for your market is being refreshed; the report switches back to live figures once it passes our checks
              again.
            </p>
          )}
          <AtAGlance lines={analysis.lines} />
          {sinceBought && <SinceBought savedAt={sinceBought.savedAt} changes={sinceBought.changes} />}
          <section className="mt-8 rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6" aria-labelledby="findings-heading">
            <h2 id="findings-heading" className="text-xl text-[#1A1815]" style={SERIF}>
              What stands out
            </h2>
            <ul className="mt-3 space-y-2 text-[15px] leading-relaxed text-[#1A1815]">
              {analysis.findings.map((finding) => (
                <li key={finding} className="flex gap-2">
                  <span className="text-[#A93D25]">●</span>
                  {finding}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-8 overflow-x-auto rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6" aria-labelledby="lines-heading">
            <h2 id="lines-heading" className="text-xl text-[#1A1815]" style={SERIF}>
              Your fees against local competitors
            </h2>
            <p className="mt-1 text-[13px] text-[#6B6255]">
              A line is compared only when at least {MIN_LOCAL_PEERS_PER_LINE} local competitors publish it.
            </p>
            <table className="mt-4 w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-[#E0D7C9] text-[11px] uppercase tracking-[0.08em] text-[#6B6255]">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Fee</th>
                  <th className="py-2 pr-3 text-right font-semibold">Yours</th>
                  <th className="py-2 pr-3 text-right font-semibold">Local median</th>
                  <th className="py-2 pr-3 text-right font-semibold">Middle half</th>
                  <th className="py-2 pr-3 text-right font-semibold">Competitors</th>
                  <th className="py-2 pr-3 text-right font-semibold">Charging less</th>
                  <th className="py-2 font-semibold">Position</th>
                </tr>
              </thead>
              <tbody>
                {analysis.lines.map((line) => (
                  <tr key={line.key} className="border-b border-[#EFE8DD] last:border-0">
                    <td className="py-2 pr-3 text-[#1A1815]">{line.label}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {line.own ? money(line.own.amount) : "Not found"}
                      {line.own?.tiers && line.own.tiers.length > 1 && (
                        <span className="block text-[11px] text-[#8A8173]">
                          tiered: {line.own.tiers.map((tier) => money(tier.amount)).join(" / ")}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{line.comparable ? money(line.peers?.median) : "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {line.comparable && line.peers ? `${money(line.peers.p25)}–${money(line.peers.p75)}` : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{line.peers?.n ?? 0}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {line.chargingLess !== null && line.peers ? `${line.chargingLess} of ${line.peers.n}` : "—"}
                    </td>
                    <td className="py-2">
                      {line.comparable ? <PositionChip line={line} /> : <span className="text-[12px] text-[#8A8173]">Not enough local data</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {analysis.named.length > 0 && (
            <section className="mt-8 overflow-x-auto rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6" aria-labelledby="named-heading">
              <h2 id="named-heading" className="text-xl text-[#1A1815]" style={SERIF}>
                Named competitors, same lines
              </h2>
              <p className="mt-1 text-[13px] text-[#6B6255]">
                Banks by deposits held in your market (FDIC Summary of Deposits, {market.sod_year}), then up to{" "}
                {NAMED_WITHOUT_DEPOSITS} credit unions, which the Summary of Deposits does not cover, chosen by how many of
                your fees they publish. Each amount links to the schedule it was read from.
              </p>
              <table className="mt-4 w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-[#E0D7C9] text-[11px] uppercase tracking-[0.08em] text-[#6B6255]">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">Institution</th>
                    {tableKeys.map((key) => (
                      <th key={key} className="py-2 pr-3 text-right font-semibold">
                        {FEE_LINE_LABELS[key]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[#EFE8DD] bg-[#FBF3EF] font-semibold">
                    <td className="py-2 pr-3">{name}</td>
                    {tableKeys.map((key) => (
                      <td key={key} className="py-2 pr-3 text-right tabular-nums">
                        {money(ownFees[key])}
                      </td>
                    ))}
                  </tr>
                  {analysis.named.map((competitor) => (
                    <tr key={competitor.institution_id} className="border-b border-[#EFE8DD] last:border-0">
                      <td className="py-2 pr-3">
                        <a href={`/institution/${competitor.institution_id}`} className="text-[#1A1815] underline-offset-2 hover:underline">
                          {competitor.institution_name}
                        </a>
                        {competitor.city && <span className="text-[12px] text-[#8A8173]"> · {competitor.city}</span>}
                      </td>
                      {tableKeys.map((key) => {
                        const source = competitor.sources[key];
                        return (
                          <td key={key} className="py-2 pr-3 text-right tabular-nums">
                            {source?.source_url ? (
                              <a
                                href={source.source_url}
                                title={`“${source.source_line}”`}
                                className="underline decoration-[#D5CBBF] underline-offset-2 hover:decoration-[#A93D25]"
                                rel="noopener noreferrer"
                                target="_blank"
                              >
                                {money(competitor.fees[key])}
                              </a>
                            ) : (
                              money(competitor.fees[key])
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="mt-8 rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6 text-[13px] leading-relaxed text-[#5A5347]" aria-labelledby="method-heading">
            <h2 id="method-heading" className="text-lg text-[#1A1815]" style={SERIF}>
              Sources and method
            </h2>
            <p className="mt-2">
              Your market is the {market.county_fips.length === 1 ? "county" : `${market.county_fips.length} counties`}{" "}
              {market.basis === "branch_counties" ? "holding most of your deposits" : "around your headquarters"} (FDIC
              Summary of Deposits, {market.sod_year}). Competitors are every bank with a branch there and every
              institution headquartered there. Each figure is a published, verified fee from the institution&apos;s own
              schedule; one representative amount per institution and fee line, with fee caps excluded. A figure is used only
              when a line of that institution&apos;s own stored schedule states that amount as the fee; amounts that are
              balance thresholds, depend on a balance band, or can&apos;t be found in the schedule are left out
              {droppedCount > 0 ? ` (${droppedCount} published figures in this market were left out this way)` : ""}.
              When a schedule lists several versions of a fee, the comparison uses the standard consumer version (not an
              online, business or other special variant); if several still remain, it uses the lowest monthly maintenance
              fee and the highest amount for every other fee. &ldquo;Read&rdquo; dates are the day we saved the copy of the
              schedule that states the fee.
            </p>
            <ul className="mt-3 space-y-1">
              {analysis.lines
                .filter((line) => line.own)
                .map((line) => (
                  <li key={line.key}>
                    {line.label}: {money(line.own!.amount)}, as your schedule states it: “{line.own!.source_line}”
                    {line.own!.tiers && line.own!.tiers.length > 1 && (
                      <>
                        {" "}
                        Your schedule states {line.own!.tiers.length} amounts for this fee (
                        {line.own!.tiers.map((tier) => `${money(tier.amount)}: “${tier.source_line}”`).join("; ")}); the
                        comparison uses {money(line.own!.amount)}.
                      </>
                    )}
                    {line.own!.source_url && (
                      <>
                        {" "}
                        (
                        <a href={line.own!.source_url} className="underline" rel="noopener noreferrer" target="_blank">
                          source
                        </a>
                        {line.own!.schedule_read_on ? `, read ${line.own!.schedule_read_on}` : ""})
                      </>
                    )}
                  </li>
                ))}
            </ul>
            <details className="mt-4 rounded-md border border-[#E0D7C9] bg-white/60 p-3">
              <summary className="cursor-pointer font-semibold text-[#1A1815]">
                Every competitor figure behind the local numbers, with its source
              </summary>
              {comparable.map((line) => (
                <div key={line.key} className="mt-4 overflow-x-auto">
                  <h3 className="text-[13px] font-semibold text-[#1A1815]">
                    {line.label} ({line.peerFigures.length} competitors)
                  </h3>
                  <table className="mt-1 w-full min-w-[640px] text-left text-[12px]">
                    <tbody>
                      {line.peerFigures.map((figure) => (
                        <tr key={figure.institution_id} className="border-b border-[#EFE8DD] last:border-0 align-top">
                          <td className="py-1 pr-3 text-[#1A1815]">{competitorName.get(figure.institution_id) ?? `Institution ${figure.institution_id}`}</td>
                          <td className="py-1 pr-3 text-right tabular-nums text-[#1A1815]">{money(figure.amount)}</td>
                          <td className="py-1 pr-3">“{figure.source_line}”</td>
                          <td className="whitespace-nowrap py-1">
                            {figure.source_url ? (
                              <a href={figure.source_url} className="underline" rel="noopener noreferrer" target="_blank">
                                source
                              </a>
                            ) : (
                              "stored copy"
                            )}
                            {figure.schedule_read_on ? `, read ${figure.schedule_read_on}` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </details>
            <p className="mt-3">{correctionNote}</p>
          </section>
          <HamiltonClose competitors={analysis.readiness.competitorsWithData} />
        </>
      )}
    </>
  );
}
