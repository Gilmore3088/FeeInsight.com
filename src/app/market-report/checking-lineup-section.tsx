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
  MIN_LINEUP_PEERS_FOR_MEDIAN,
  isNoFigure,
  noFeeAccountText,
  type CheckingLineupView,
} from "@/lib/custom-report/checking-lineup";
import { HubSection } from "@/app/(public)/research/district/[id]/district-hub";
import { Disclosure } from "./disclosure";
import { EXTRA_ROW, ROWS_SHOWN } from "./rows";
import { ShowAll } from "./show-all";

const DERIVED_MARK = "†";

function Muted({ children }: { children: string }) {
  return isNoFigure(children) ? <span className="text-ink-muted">{children}</span> : <>{children}</>;
}

/** A market cell: the figure, then how many competitors it rests on, on its own line. */
function MarketCell({ children }: { children: string }) {
  const [figure, count] = children.split(" · ");
  if (!count) return <Muted>{children}</Muted>;
  return (
    <>
      <Muted>{figure}</Muted>
      <span className="block text-[12px] text-ink-muted">{count}</span>
    </>
  );
}

/**
 * The line under the section title: how many checking accounts the institution lists, and how
 * many local competitors offer a no-fee one. When the market has no lineups on file it says so.
 */
export function lineupFinding(name: string, lineup: CheckingLineupView): string {
  const { subject, peersWithLineup } = lineup;
  const own =
    subject.accounts === 0
      ? `${name}'s published schedule shows no verified checking account monthly fee yet`
      : `${name} lists ${subject.accounts.toLocaleString("en-US")} checking ${subject.accounts === 1 ? "account" : "accounts"} with a monthly fee line`;
  if (peersWithLineup === 0) return `${own}, and no local competitor has a checking lineup on file yet.`;
  const free = lineup.peersWithFreeAccount;
  return `${own}; ${free.toLocaleString("en-US")} of the ${peersWithLineup.toLocaleString("en-US")} local competitors with a checking lineup on file ${free === 1 ? "lists" : "list"} a no-fee checking account in the schedules reviewed.`;
}

export function CheckingLineupSection({ name, lineup, live }: { name: string; lineup: CheckingLineupView; live?: boolean }) {
  const measures = lineupMeasures(lineup);
  const shownPeers = lineup.peerRows;
  const own = lineup.subject.accountsList;
  return (
    <HubSection
      id="lineup"
      title="Checking account lineup"
      line={lineupFinding(name, lineup)}
      source={
        <>
          {PRODUCT_NAME} by {SITE_NAME}: every consumer checking account with a monthly fee line on each institution&apos;s
          own published schedule. {lineupCoverageLine(lineup)}
          {live ? " These figures are live as of today." : ""} &ldquo;{NOT_STATED[0].toUpperCase() + NOT_STATED.slice(1)}&rdquo;
          means the schedule on file does not state the figure; it is not a zero. &ldquo;None found&rdquo; means no no-fee
          checking account appears in the schedules reviewed; an institution may offer accounts its schedule does not list.
          A competitor median needs at least {MIN_LINEUP_PEERS_FOR_MEDIAN} competitors stating the figure. Many schedules do not name each account or
          say how its fee is avoided, so medians rest only on the accounts that do.
          {lineup.leftOut > 0
            ? ` ${lineup.leftOut.toLocaleString("en-US")} monthly fee ${lineup.leftOut === 1 ? "line" : "lines"} in this market for savings, money market, certificate, IRA or business accounts ${lineup.leftOut === 1 ? "is" : "are"} left out.`
            : ""}
          {lineup.anyDerived ? ` ${DERIVED_MARK} Read from the schedule line that states the fee rather than a stored field.` : ""}
        </>
      }
    >
      <figure className="min-w-0 max-w-5xl">
      <figcaption className="text-[14px] font-semibold text-ink">Checking accounts, {name} against local competitors</figcaption>
      <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[20rem] text-left text-sm">
        <thead className="border-b border-border text-[11px] uppercase tracking-[0.08em] text-ink-muted">
          <tr>
            <th className="py-2 pr-3 font-semibold">Measure</th>
            <th className="py-2 pr-3 text-right font-semibold">{name}</th>
            <th className="py-2 text-right font-semibold">Local competitors</th>
          </tr>
        </thead>
        <tbody>
          {measures.map((m) => (
            <tr key={m.label} className="border-b border-surface-200 last:border-0">
              <td className="py-2 pr-3 text-ink">{m.label}</td>
              <td className="py-2 pr-3 text-right tabular-nums"><Muted>{m.yours}</Muted></td>
              <td className="py-2 text-right tabular-nums"><MarketCell>{m.market}</MarketCell></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      </figure>

      {(own.length > 0 || shownPeers.length > 0) && (
      <div className="max-w-5xl">
      <Disclosure summary="Account by account">
      {own.length > 0 && (
        <>
      <h3 className="text-[15px] font-semibold text-ink">{name}&apos;s accounts</h3>
        <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[20rem] text-left text-sm">
          <thead className="border-b border-border text-[11px] uppercase tracking-[0.08em] text-ink-muted">
            <tr>
              <th className="py-2 pr-3 font-semibold">Account</th>
              <th className="py-2 pr-3 text-right font-semibold">Monthly fee</th>
              <th className="py-2 pr-3 text-right font-semibold">Balance to avoid it</th>
              <th className="hidden sm:table-cell print:table-cell py-2 font-semibold">Other way to avoid it</th>
            </tr>
          </thead>
          <tbody>
            {own.map((a, index) => (
              <tr key={`${a.feeName}-${index}`} className="border-b border-surface-200 align-top last:border-0">
                <td className="py-2 pr-3 text-ink">
                  {a.productName ?? <span className="text-ink-muted">Name {NOT_STATED}</span>}
                  {a.productNameSource === "derived" ? DERIVED_MARK : ""}
                  {/* Phones read the other way to avoid the fee under the account's name. */}
                  <span className="mt-0.5 block text-[12px] text-ink-muted sm:hidden print:hidden">
                    {a.waiverText ?? `Other way to avoid it: ${NOT_STATED}`}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{lineupMoney(a.monthlyFee)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  <Muted>{lineupMoney(a.minBalanceToAvoid)}</Muted>
                  {a.minBalanceSource === "derived" ? DERIVED_MARK : ""}
                </td>
                <td className="hidden sm:table-cell print:table-cell py-2 text-[13px]">
                  <Muted>{a.waiverText ?? NOT_STATED}</Muted>
                  {a.waiverSource === "derived" ? DERIVED_MARK : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        </>
      )}

      {shownPeers.length > 0 && (
        <>
          <h3 className="mt-6 text-[15px] font-semibold text-ink">Competitors with a checking lineup on file</h3>
          <ShowAll total={shownPeers.length} shown={ROWS_SHOWN} noun="competitors">
          <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[20rem] text-left text-sm">
            <thead className="border-b border-border text-[11px] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th className="py-2 pr-3 font-semibold">Institution</th>
                <th className="hidden sm:table-cell print:table-cell py-2 pr-3 text-right font-semibold">Accounts</th>
                <th className="py-2 pr-3 text-right font-semibold">Lowest fee</th>
                <th className="py-2 pr-3 text-right font-semibold">Median fee</th>
                <th className="hidden sm:table-cell print:table-cell py-2 pr-3 text-right font-semibold">No-fee account found</th>
                <th className="hidden sm:table-cell print:table-cell py-2 text-right font-semibold">Median balance to avoid</th>
              </tr>
            </thead>
            <tbody>
              {shownPeers.map((peer, index) => (
                <tr key={peer.institutionId} className={`border-b border-surface-200 last:border-0 ${index >= ROWS_SHOWN ? EXTRA_ROW : ""}`}>
                  <td className="py-1 pr-3">
                    <a href={`/institution/${peer.institutionId}`} className="flex min-h-11 items-center text-ink underline-offset-2 hover:underline sm:min-h-0 sm:py-1">
                      {peer.name}
                    </a>
                  </td>
                  <td className="hidden sm:table-cell print:table-cell py-2 pr-3 text-right tabular-nums">{peer.summary.accounts}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{lineupMoney(peer.summary.lowestMonthlyFee)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{lineupMoney(peer.summary.medianMonthlyFee)}</td>
                  <td className="hidden sm:table-cell print:table-cell py-2 pr-3 text-right"><Muted>{noFeeAccountText(peer.summary)}</Muted></td>
                  <td className="hidden sm:table-cell print:table-cell py-2 text-right tabular-nums"><Muted>{lineupMoney(peer.summary.medianMinBalanceToAvoid)}</Muted></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </ShowAll>
          <p className="mt-1 text-[12px] text-ink-muted sm:mx-0 sm:text-left">Largest deposits in the market first.</p>
        </>
      )}

      </Disclosure>
      </div>
      )}
    </HubSection>
  );
}
