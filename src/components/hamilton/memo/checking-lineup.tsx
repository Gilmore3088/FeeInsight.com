/**
 * My fees: the signed-in bank's checking account lineup against its local market, the same
 * comparison the Competitive Fee Position Report carries. Unknown figures read "not stated";
 * it describes the lineups and recommends nothing.
 */
import { PRODUCT_NAME } from "@/lib/constants";
import {
  NOT_STATED,
  lineupCoverageLine,
  lineupMeasures,
  lineupMoney,
  type CheckingLineupView,
} from "@/lib/custom-report/checking-lineup";

const MAX_PEER_ROWS = 10;
const DERIVED_MARK = "†";
const TH = "px-4 py-2 font-medium";
const NUM = "px-4 py-2 text-right [font-variant-numeric:tabular-nums]";

function Muted({ children }: { children: string }) {
  return children === NOT_STATED ? <span className="text-warm-600">{children}</span> : <>{children}</>;
}

export function CheckingLineupPanel({ name, lineup }: { name: string; lineup: CheckingLineupView }) {
  const measures = lineupMeasures(lineup);
  const own = lineup.subject.accountsList;
  const shownPeers = lineup.peerRows.slice(0, MAX_PEER_ROWS);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-warm-700">{lineupCoverageLine(lineup)}</p>
      <div className="overflow-x-auto rounded-lg border border-warm-300 bg-warm-50">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-warm-300 text-left text-xs uppercase tracking-[0.08em] text-warm-600">
              <th className={TH}>Measure</th>
              <th className={`${TH} text-right`}>{name}</th>
              <th className={`${TH} text-right`}>Local competitors</th>
            </tr>
          </thead>
          <tbody>
            {measures.map((m) => (
              <tr key={m.label} className="border-b border-warm-200 last:border-0">
                <td className="px-4 py-2 text-warm-900">{m.label}</td>
                <td className={`${NUM} text-warm-800`}><Muted>{m.yours}</Muted></td>
                <td className={`${NUM} text-warm-800`}><Muted>{m.market}</Muted></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {own.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-warm-300 bg-warm-50">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-warm-300 text-left text-xs uppercase tracking-[0.08em] text-warm-600">
                <th className={TH}>Account at {name}</th>
                <th className={`${TH} text-right`}>Monthly fee</th>
                <th className={`${TH} text-right`}>Balance to avoid it</th>
                <th className={TH}>Other way to avoid it</th>
              </tr>
            </thead>
            <tbody>
              {own.map((a, index) => (
                <tr key={`${a.feeName}-${index}`} className="border-b border-warm-200 align-top last:border-0">
                  <td className="px-4 py-2 text-warm-900">
                    {a.productName ?? <span className="text-warm-600">Name {NOT_STATED}</span>}
                    {a.productNameSource === "derived" ? DERIVED_MARK : ""}
                  </td>
                  <td className={`${NUM} text-warm-800`}>{lineupMoney(a.monthlyFee)}</td>
                  <td className={`${NUM} text-warm-800`}>
                    <Muted>{lineupMoney(a.minBalanceToAvoid)}</Muted>
                    {a.minBalanceSource === "derived" ? DERIVED_MARK : ""}
                  </td>
                  <td className="px-4 py-2 text-warm-800">
                    <Muted>{a.waiverText ?? NOT_STATED}</Muted>
                    {a.waiverSource === "derived" ? DERIVED_MARK : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-warm-700">No verified checking account monthly fee on {name}&apos;s published schedule yet.</p>
      )}

      {shownPeers.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-warm-300 bg-warm-50">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-warm-300 text-left text-xs uppercase tracking-[0.08em] text-warm-600">
                <th className={TH}>Competitor</th>
                <th className={`${TH} text-right`}>Accounts</th>
                <th className={`${TH} text-right`}>Lowest fee</th>
                <th className={`${TH} text-right`}>Median fee</th>
                <th className={`${TH} text-right`}>No-fee account</th>
                <th className={`${TH} text-right`}>Median balance to avoid</th>
              </tr>
            </thead>
            <tbody>
              {shownPeers.map((peer) => (
                <tr key={peer.institutionId} className="border-b border-warm-200 last:border-0">
                  <td className="px-4 py-2 text-warm-900">{peer.name}</td>
                  <td className={`${NUM} text-warm-800`}>{peer.summary.accounts}</td>
                  <td className={`${NUM} text-warm-800`}>{lineupMoney(peer.summary.lowestMonthlyFee)}</td>
                  <td className={`${NUM} text-warm-800`}>{lineupMoney(peer.summary.medianMonthlyFee)}</td>
                  <td className="px-4 py-2 text-right text-warm-800">{peer.summary.shareWithFreeAccount === 1 ? "Yes" : "No"}</td>
                  <td className={`${NUM} text-warm-800`}><Muted>{lineupMoney(peer.summary.medianMinBalanceToAvoid)}</Muted></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="text-xs leading-relaxed text-warm-600">
        {PRODUCT_NAME}: verified monthly maintenance fees on each institution&apos;s own published schedule, consumer checking
        only.
        {lineup.peerRows.length > shownPeers.length ? ` Showing ${shownPeers.length} of ${lineup.peerRows.length} competitors, largest deposits in ${name}'s market first.` : ""}
        {` "${NOT_STATED[0].toUpperCase() + NOT_STATED.slice(1)}" means the schedule does not state it; it is not a zero.`}
        {lineup.leftOut > 0
          ? ` ${lineup.leftOut.toLocaleString("en-US")} savings, money market, certificate, IRA or business ${lineup.leftOut === 1 ? "line is" : "lines are"} left out.`
          : ""}
        {lineup.anyDerived ? ` ${DERIVED_MARK} Read from the schedule line that states the fee rather than a stored field.` : ""}
      </p>
    </div>
  );
}
