export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { loadMarketSnapshot, marketLabel, SNAPSHOT_MIN_PEERS, type SnapshotFee, type SnapshotValue } from "@/lib/agents/growth/market-snapshot";
import { formatAbsoluteDate } from "@/lib/public-stats";
import { SnapshotTracker } from "./snapshot-tracker";

type PageProps = { params: Promise<{ id: string }> };

/**
 * The free market snapshot a prospect's first email links to (GTM plan, Oct 8): one
 * institution's published fees beside the other institutions in its local market, every figure
 * linked to the schedule it was read from, the same layout for every institution. A figure that
 * doesn't trace to its schedule's text is labeled unverified and left out of the local median.
 * Unlisted (noindex): reached from an email or the institution's page.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const snapshot = Number.isInteger(Number(id)) ? await loadMarketSnapshot(Number(id), { categories: ["overdraft"] }).catch(() => null) : null;
  if (!snapshot) return { title: "Market snapshot", robots: { index: false, follow: false } };
  return {
    title: `${snapshot.subject.name}: fees in the ${marketLabel(snapshot.subject)} market`,
    description: `${snapshot.subject.name}'s published fees beside local institutions, each figure linked to its fee schedule.`,
    robots: { index: false, follow: true },
  };
}

const money = (value: number) => (Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`);

function comparison(own: number, median: number): string {
  const gap = Math.round((own - median) * 100) / 100;
  if (gap === 0) return "the same as the local median";
  return `${money(Math.abs(gap))} ${gap > 0 ? "higher" : "lower"} than the local median`;
}

function SourceLink({ value, category }: { value: SnapshotValue; category: string }) {
  const read = value.readAt ? `read ${formatAbsoluteDate(value.readAt)}` : null;
  if (!value.documentUrl) return <span className="text-[#6B6358]">{read ?? "No link stored"}</span>;
  return (
    <a
      href={value.documentUrl}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-[#8A3B12] underline underline-offset-2"
      data-snapshot-event="source_click"
      data-snapshot-detail={category}
    >
      Schedule{read ? `, ${read}` : ""}
    </a>
  );
}

function Status({ value }: { value: SnapshotValue }) {
  return value.verified ? null : (
    <span className="mt-1 block w-fit border border-[#C9B79C] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#6B6358]">
      Unverified
    </span>
  );
}

function FeeSection({ fee, subjectName, names }: { fee: SnapshotFee; subjectName: string; names: Map<number, string> }) {
  const label = getDisplayName(fee.category);
  const own = fee.subject;
  return (
    <div className="space-y-3 px-4 py-4 sm:px-5">
      <p className="text-[15px] leading-relaxed">
        {own ? (
          <>
            <span className="font-semibold">{subjectName}</span>: {money(own.value)}
            <Status value={own} />
            {own.verified && fee.verifiedMedian !== null ? <>, {comparison(own.value, fee.verifiedMedian)}.</> : "."}
          </>
        ) : (
          <>{subjectName} has no {label.toLowerCase()} in the schedule we read.</>
        )}
      </p>
      <p className="text-sm text-[#4A443C]">
        {fee.verifiedMedian !== null
          ? `Local median across ${fee.verifiedPeerCount} verified institutions: ${money(fee.verifiedMedian)}.`
          : `Fewer than ${SNAPSHOT_MIN_PEERS} local institutions have a verified ${label.toLowerCase()}, so there is no local median.`}
      </p>
      {own && own.notes.length > 0 && <p className="text-xs text-[#6B6358]">{own.notes.join(" · ")}</p>}
      {own && (
        <p className="text-xs">
          <SourceLink value={own} category={fee.category} />
        </p>
      )}
      {fee.peers.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#E0D7C9] text-left text-xs uppercase tracking-wide text-[#6B6358]">
              <th className="py-2 pr-2 font-medium">Institution</th>
              <th className="py-2 pr-2 text-right font-medium">Fee</th>
              <th className="py-2 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {fee.peers.map((peer) => (
              <tr key={peer.institutionId} className="border-b border-[#EFE8DC] align-top">
                <td className="py-2 pr-2">
                  <Link
                    href={`/institution/${peer.institutionId}`}
                    className="hover:underline"
                    data-snapshot-event="competitor_click"
                    data-snapshot-detail={fee.category}
                  >
                    {names.get(peer.institutionId) ?? `Institution ${peer.institutionId}`}
                  </Link>
                  {peer.notes.length > 0 && <div className="mt-0.5 text-xs text-[#6B6358]">{peer.notes.join(" · ")}</div>}
                </td>
                <td className="whitespace-nowrap py-2 pr-2 text-right tabular-nums">
                  {money(peer.value)}
                  <Status value={peer} />
                </td>
                <td className="py-2 text-xs">
                  <SourceLink value={peer} category={fee.category} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default async function MarketSnapshotPage({ params }: PageProps) {
  const { id } = await params;
  const institutionId = Number(id);
  if (!Number.isInteger(institutionId) || institutionId <= 0) notFound();
  const snapshot = await loadMarketSnapshot(institutionId);
  if (!snapshot || !snapshot.subject.cbsaCode) notFound();

  const { subject } = snapshot;
  const market = marketLabel(subject);
  const names = new Map(snapshot.peers.map((peer) => [peer.id, peer.name]));
  const [lead, ...rest] = snapshot.fees;
  const reportHref = `/for-institutions?${new URLSearchParams({ institution: String(subject.id), name: subject.name, src: "snapshot" }).toString()}#report`;

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#1A1815]">
      <SnapshotTracker institutionId={subject.id} />
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <p className="text-xs font-medium uppercase tracking-wide text-[#8A3B12]">Free market snapshot</p>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">
          {subject.name}&apos;s fees in the {market} market
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[#4A443C]">
          Each fee sits beside the other institutions in the {subject.cbsaName ?? market} area that publish a fee schedule. Every figure
          links to the schedule it was read from. A figure marked unverified did not trace to its schedule&apos;s text, so it is left out of
          the local median.
        </p>

        <section className="mt-6 border border-[#E0D7C9] bg-white">
          <h2 className="border-b border-[#E0D7C9] px-4 py-3 text-lg font-semibold sm:px-5">{getDisplayName(lead.category)}</h2>
          <FeeSection fee={lead} subjectName={subject.name} names={names} />
        </section>

        <div className="mt-4 space-y-3">
          {rest.map((fee) => (
            <details key={fee.category} className="border border-[#E0D7C9] bg-white">
              <summary
                className="cursor-pointer px-4 py-3 text-base font-semibold sm:px-5"
                data-snapshot-event="fee_view"
                data-snapshot-detail={fee.category}
              >
                {getDisplayName(fee.category)}
                {fee.subject ? <span className="ml-2 font-normal text-[#4A443C]">{money(fee.subject.value)}</span> : null}
                <span className="float-right text-sm font-normal text-[#8A3B12]">Compare</span>
              </summary>
              <FeeSection fee={fee} subjectName={subject.name} names={names} />
            </details>
          ))}
        </div>

        <section className="mt-8 border-t border-[#E0D7C9] pt-6">
          <h2 className="text-lg font-semibold">The full competitive review</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-[#4A443C]">
            The market report covers every published fee for {subject.name} and its local competitors in one downloadable, cited report.
          </p>
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <Link
              href={reportHref}
              className="bg-[#1A1815] px-4 py-2 font-medium text-white"
              data-snapshot-event="report_click"
              data-snapshot-detail="market_report"
            >
              Request a market report
            </Link>
            <Link href="/methodology" className="self-center text-[#8A3B12] underline underline-offset-2">
              How fees are checked
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
