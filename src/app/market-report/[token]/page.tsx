/**
 * /market-report/[token] — a Competitive Fee Position Report built on request from live
 * data: the institution against the competitors in its own FDIC branch counties.
 * Private (signed link, not indexed). Numbers are computed at view time from
 * published_fee_catalog; when the market no longer passes the readiness bar the page
 * says so instead of showing thin numbers.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportChrome, ReportChromeFooter } from "@/components/public/report-chrome";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/constants";
import { analyzeMarket, MIN_LOCAL_PEERS_PER_LINE, type LinePosition, type ReportLine } from "@/lib/custom-report/analysis";
import { FEE_LINE_LABELS } from "@/lib/custom-report/rules";
import { verifyReportToken } from "@/lib/custom-report/link";
import { getCustomReportMarketDataCached } from "@/lib/data-store/public-cached-reads";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };
const DATE = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export const metadata: Metadata = {
  title: "Competitive Fee Position Report",
  robots: { index: false, follow: false, nocache: true },
};

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

const POSITION_LABEL: Record<LinePosition, string> = {
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

function bookingHref(institutionName: string): string {
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Competitive Fee Position Report — ${institutionName}`)}`;
}

function PositionChip({ line }: { line: ReportLine }) {
  if (!line.position) return <span className="text-[12px] text-[#8A8173]">—</span>;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${POSITION_CLASS[line.position]}`}>
      {POSITION_LABEL[line.position]}
    </span>
  );
}

export default async function MarketReportPage({ params }: PageProps) {
  const { token } = await params;
  const verified = verifyReportToken(token);
  if (!verified) notFound();

  const data = await getCustomReportMarketDataCached(verified.institutionId);
  if (!data || !data.market) notFound();
  const analysis = analyzeMarket(data);
  const droppedCount = Object.values(data.dropped ?? {}).reduce((sum, n) => sum + (n ?? 0), 0);
  const name = data.subject.institution_name;
  const marketLabel = `${data.market.places[0]} area${data.market.county_fips.length > 1 ? ` (${data.market.county_fips.length} counties)` : ""}`;
  const comparable = analysis.lines.filter((l) => l.comparable);
  const tableKeys = comparable.slice(0, 6).map((l) => l.key);
  const ownFees = Object.fromEntries(analysis.lines.filter((l) => l.own).map((l) => [l.key, l.own!.amount]));

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <ReportChrome preparedFor={name} />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-10">
        <section className="flex flex-col gap-5 rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">Competitive Fee Position Report</p>
            <h1 className="mt-2 text-[1.5rem] leading-tight tracking-[-0.02em] text-[#1A1815] sm:text-[1.85rem]" style={SERIF}>
              {name} against its local market
            </h1>
            <p className="mt-2 text-[14px] text-[#5A5347]">
              {marketLabel} · verified fees for {analysis.readiness.competitorsWithData} of{" "}
              {analysis.readiness.competitorsInMarket} local competitors · prepared{" "}
              {DATE.format(verified.issuedOn)} by {SITE_NAME}
            </p>
          </div>
          <div className="flex flex-wrap gap-3 print:hidden">
            <PrintButton className="inline-flex items-center rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#A93D25]" />
            <a
              href={bookingHref(name)}
              className="inline-flex items-center rounded-md border border-[#D5CBBF] px-4 py-2.5 text-sm font-semibold text-[#1A1815] transition-colors hover:border-[#C44B2E] hover:text-[#A93D25]"
            >
              Book 15 minutes
            </a>
          </div>
        </section>

        {!analysis.readiness.ready ? (
          <section className="mt-8 rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6">
            <h2 className="text-xl text-[#1A1815]" style={SERIF}>
              This market is being refreshed
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#5A5347]">
              {analysis.readiness.reason} We only show a comparison when the local data supports it. We will email you
              when it is back; questions to{" "}
              <a href={bookingHref(name)} className="underline">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </section>
        ) : (
          <>
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
                <p className="mt-1 text-[13px] text-[#6B6255]">Largest local deposit holders first (FDIC Summary of Deposits, {data.market.sod_year}).</p>
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
                        {tableKeys.map((key) => (
                          <td key={key} className="py-2 pr-3 text-right tabular-nums">
                            {money(competitor.fees[key])}
                          </td>
                        ))}
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
                Your market is the {data.market.county_fips.length === 1 ? "county" : `${data.market.county_fips.length} counties`}{" "}
                {data.market.basis === "branch_counties" ? "holding most of your deposits" : "around your headquarters"} (FDIC
                Summary of Deposits, {data.market.sod_year}). Competitors are every bank with a branch there and every
                institution headquartered there. Each figure is a published, verified fee from the institution&apos;s own
                schedule; one representative amount per institution and fee line, with fee caps excluded. A figure is used only
                when a line of that institution&apos;s own stored schedule states that amount as the fee; amounts that are
                balance thresholds, depend on a balance band, or can&apos;t be found in the schedule are left out
                {droppedCount > 0 ? ` (${droppedCount} published figures in this market were left out this way)` : ""}.
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
                          {line.own!.updated_at ? `, read ${line.own!.updated_at}` : ""})
                        </>
                      )}
                    </li>
                  ))}
              </ul>
              <p className="mt-3">
                If a figure does not match your current schedule, reply to{" "}
                <a href={bookingHref(name)} className="underline">
                  {CONTACT_EMAIL}
                </a>{" "}
                and we will correct it. This link resolves until {DATE.format(verified.expiresOn)}.
              </p>
            </section>
          </>
        )}
      </main>
      <ReportChromeFooter />
    </div>
  );
}
