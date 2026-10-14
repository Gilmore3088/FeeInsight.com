/**
 * The checking account lineup in a Competitive Fee Position Report: the institution's consumer
 * checking accounts against its local competitors' (lowest and median monthly fee, a no-fee
 * account, the balance that avoids the fee, a way to avoid it). Unknown figures read
 * "not stated". Market information only: it describes the lineups and recommends nothing.
 */
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import {
  NOT_STATED,
  lineupCoverageLine,
  lineupMeasures,
  lineupMoney,
  type CheckingLineupView,
} from "@/lib/custom-report/checking-lineup";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };
const MAX_PEER_ROWS = 10;
const DERIVED_MARK = "†";

function Muted({ children }: { children: string }) {
  return children === NOT_STATED ? <span className="text-[#8A8173]">{children}</span> : <>{children}</>;
}

export function CheckingLineupSection({ name, lineup, live }: { name: string; lineup: CheckingLineupView; live?: boolean }) {
  const measures = lineupMeasures(lineup);
  const shownPeers = lineup.peerRows.slice(0, MAX_PEER_ROWS);
  const own = lineup.subject.accountsList;
  return (
    <section className="mt-8 overflow-x-auto rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6" aria-labelledby="lineup-heading">
      <h2 id="lineup-heading" className="text-xl text-[#1A1815]" style={SERIF}>
        Checking account lineup
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-[#6B6255]">
        Every consumer checking account with a monthly fee line on each institution&apos;s published schedule.{" "}
        {lineupCoverageLine(lineup)}
        {live ? " These figures are live as of today." : ""}
      </p>

      <table className="mt-4 w-full min-w-[560px] text-left text-sm">
        <thead className="border-b border-[#E0D7C9] text-[11px] uppercase tracking-[0.08em] text-[#6B6255]">
          <tr>
            <th className="py-2 pr-3 font-semibold">Measure</th>
            <th className="py-2 pr-3 text-right font-semibold">{name}</th>
            <th className="py-2 text-right font-semibold">Local competitors</th>
          </tr>
        </thead>
        <tbody>
          {measures.map((m) => (
            <tr key={m.label} className="border-b border-[#EFE8DD] last:border-0">
              <td className="py-2 pr-3 text-[#1A1815]">{m.label}</td>
              <td className="py-2 pr-3 text-right tabular-nums"><Muted>{m.yours}</Muted></td>
              <td className="py-2 text-right tabular-nums"><Muted>{m.market}</Muted></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="mt-6 text-[15px] font-semibold text-[#1A1815]">{name}&apos;s accounts</h3>
      {own.length === 0 ? (
        <p className="mt-1 text-[13px] text-[#5A5347]">
          We have no verified checking account monthly fee on {name}&apos;s published schedule yet.
        </p>
      ) : (
        <table className="mt-2 w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-[#E0D7C9] text-[11px] uppercase tracking-[0.08em] text-[#6B6255]">
            <tr>
              <th className="py-2 pr-3 font-semibold">Account</th>
              <th className="py-2 pr-3 text-right font-semibold">Monthly fee</th>
              <th className="py-2 pr-3 text-right font-semibold">Balance to avoid it</th>
              <th className="py-2 font-semibold">Other way to avoid it</th>
            </tr>
          </thead>
          <tbody>
            {own.map((a, index) => (
              <tr key={`${a.feeName}-${index}`} className="border-b border-[#EFE8DD] align-top last:border-0">
                <td className="py-2 pr-3 text-[#1A1815]">
                  {a.productName ?? <span className="text-[#8A8173]">Name {NOT_STATED}</span>}
                  {a.productNameSource === "derived" ? DERIVED_MARK : ""}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{lineupMoney(a.monthlyFee)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  <Muted>{lineupMoney(a.minBalanceToAvoid)}</Muted>
                  {a.minBalanceSource === "derived" ? DERIVED_MARK : ""}
                </td>
                <td className="py-2 text-[13px]">
                  <Muted>{a.waiverText ?? NOT_STATED}</Muted>
                  {a.waiverSource === "derived" ? DERIVED_MARK : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {shownPeers.length > 0 && (
        <>
          <h3 className="mt-6 text-[15px] font-semibold text-[#1A1815]">Competitors with a checking lineup on file</h3>
          <table className="mt-2 w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-[#E0D7C9] text-[11px] uppercase tracking-[0.08em] text-[#6B6255]">
              <tr>
                <th className="py-2 pr-3 font-semibold">Institution</th>
                <th className="py-2 pr-3 text-right font-semibold">Accounts</th>
                <th className="py-2 pr-3 text-right font-semibold">Lowest fee</th>
                <th className="py-2 pr-3 text-right font-semibold">Median fee</th>
                <th className="py-2 pr-3 text-right font-semibold">No-fee account</th>
                <th className="py-2 text-right font-semibold">Median balance to avoid</th>
              </tr>
            </thead>
            <tbody>
              {shownPeers.map((peer) => (
                <tr key={peer.institutionId} className="border-b border-[#EFE8DD] last:border-0">
                  <td className="py-2 pr-3">
                    <a href={`/institution/${peer.institutionId}`} className="text-[#1A1815] underline-offset-2 hover:underline">
                      {peer.name}
                    </a>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{peer.summary.accounts}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{lineupMoney(peer.summary.lowestMonthlyFee)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{lineupMoney(peer.summary.medianMonthlyFee)}</td>
                  <td className="py-2 pr-3 text-right">{peer.summary.shareWithFreeAccount === 1 ? "Yes" : "No"}</td>
                  <td className="py-2 text-right tabular-nums"><Muted>{lineupMoney(peer.summary.medianMinBalanceToAvoid)}</Muted></td>
                </tr>
              ))}
            </tbody>
          </table>
          {lineup.peerRows.length > shownPeers.length && (
            <p className="mt-1 text-[12px] text-[#6B6255]">
              Showing {shownPeers.length} of {lineup.peerRows.length}, largest deposits in your market first.
            </p>
          )}
        </>
      )}

      <p className="mt-4 text-[12px] leading-relaxed text-[#6B6255]">
        Source: {PRODUCT_NAME} by {SITE_NAME}, from verified monthly maintenance fees on each institution&apos;s own
        published schedule. &ldquo;{NOT_STATED[0].toUpperCase() + NOT_STATED.slice(1)}&rdquo; means the schedule we hold
        does not state the figure; it is not a zero. Many schedules do not name each account or say how its fee is
        avoided, so medians rest only on the accounts that do.
        {lineup.leftOut > 0
          ? ` ${lineup.leftOut.toLocaleString("en-US")} monthly fee ${lineup.leftOut === 1 ? "line" : "lines"} in this market for savings, money market, certificate, IRA or business accounts ${lineup.leftOut === 1 ? "is" : "are"} left out.`
          : ""}
        {lineup.anyDerived ? ` ${DERIVED_MARK} Read from the schedule line that states the fee rather than a stored field.` : ""}
      </p>
    </section>
  );
}
