import type { FeeResearch, InstitutionFinancials, MarketIncome } from "@/lib/hamilton/workspace/types";
import { nationalIncomeFamily } from "@/lib/hamilton/workspace/national-income";
import { Exhibit, Figure, QuarterLines, fmtFiledThousands } from "@/components/hamilton/memo/memo";

function fmtYoy(pct: number | null, against = "the same quarter a year earlier"): string {
  if (pct == null) return `No ${against.replace(/^the /, "")} on file to compare`;
  if (pct === 0) return `Level with ${against}`;
  return `${pct > 0 ? "Up" : "Down"} ${Math.abs(pct).toFixed(1)}% on ${against}`;
}

const quarterLabel = (q: string) => q.replace("-", " ");
/** "2026-06-30" to "2026-Q2". */
const quarterOf = (isoDate: string) => `${isoDate.slice(0, 4)}-Q${Math.ceil(Number(isoDate.slice(5, 7)) / 3)}`;

export function FilingExhibits({
  own,
  national,
  revenueLine,
  name,
  credit,
}: {
  own: InstitutionFinancials | null;
  national: MarketIncome[];
  revenueLine: FeeResearch["revenueLine"];
  name: string;
  credit: boolean;
}) {
  const family = nationalIncomeFamily(national, credit ? "ncua" : "fdic");
  const kind = family?.kind ?? (credit ? "credit unions" : "banks");
  const ownOldest = own ? [...own.quarters].reverse() : [];
  const peer = own?.peerMedian ?? null;
  const peerByQuarter = new Map((peer?.quarters ?? []).map((q) => [q.quarterEnd, q.amount]));
  const peerLatest = own && peer ? (peer.quarters.find((q) => q.quarterEnd === own.quarterEnd && q.amount > 0) ?? null) : null;
  const scopedNational = family?.rows ?? [];
  const natOldest = [...scopedNational].reverse();
  const natLatest = scopedNational[0] ?? null;
  const natPrior = natLatest ? scopedNational.find((q) => q.quarter === `${Number(natLatest.quarter.slice(0, 4)) - 1}${natLatest.quarter.slice(4)}`) : null;
  const groupNow = natLatest?.total ?? null;
  const groupPrior = natPrior?.total ?? null;
  const groupYoy = groupNow != null && groupPrior ? Math.round(((groupNow - groupPrior) / groupPrior) * 1000) / 10 : null;
  return (
    <>
      {own && own.quarters.length > 0 ? (
        <Exhibit
          number={2}
          title={peer ? `${name}'s fee income each quarter, against its peers` : `${name}'s fee income each quarter`}
          source={`${own.sourceRef.label}${peer ? `; peer median from every filer that is ${peer.label.charAt(0).toLowerCase()}${peer.label.slice(1)}` : ""}. Each quarter stands alone; credit union year-to-date filings are split into quarters.`}
        >
          <div className="grid gap-6 lg:grid-cols-[1fr_15rem]">
            <QuarterLines
              quarters={ownOldest.map((q) => quarterOf(q.quarterEnd))}
              series={[
                { label: name, values: ownOldest.map((q) => q.amount / 1000), own: true },
                ...(peer
                  ? [{ label: `Median of ${peer.label.charAt(0).toLowerCase()}${peer.label.slice(1)}`, values: ownOldest.map((q) => { const m = peerByQuarter.get(q.quarterEnd); return m == null ? null : m / 1000; }) }]
                  : []),
              ]}
            />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
              <Figure label={`Latest quarter, ${quarterLabel(quarterOf(own.quarterEnd))}`} value={fmtFiledThousands(own.quarters[0].amount / 1000)} />
              {peerLatest ? (
                <Figure
                  label="Peer median, same quarter"
                  value={fmtFiledThousands(peerLatest.amount / 1000)}
                  note={`${peerLatest.institutions.toLocaleString("en-US")} filers; you're at ${(own.quarters[0].amount / peerLatest.amount).toFixed(1)}× the median`}
                />
              ) : null}
              {own.latestTtm != null ? (
                <Figure label="Last four quarters" value={fmtFiledThousands(own.latestTtm / 1000)} note={fmtYoy(own.yoyPct, "the four quarters before")} />
              ) : null}
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-warm-600">
            {revenueLine
              ? `${revenueLine.label}: ${fmtFiledThousands(revenueLine.annualIncome / 1000)} over the last four quarters${revenueLine.combinedWith ? `, reported together with ${revenueLine.combinedWith}` : ""}.`
              : credit
                ? "Overdraft and NSF income (5300 lines IS0048 and IS0049): not on the latest filings, so Fee Insight shows no older year in their place."
                : "Banks over $1 billion also report consumer overdraft and NSF income (RIAD H032). No current figure is on file, so it isn't shown."}
          </p>
        </Exhibit>
      ) : (
        <p className="text-sm text-warm-700">No call report figures on file for {name} yet.</p>
      )}
      {natLatest ? (
        <Exhibit number={3} title={`${family!.measureLabel}, ${kind} nationwide`} source={`${natLatest.sourceRef.label}. ${family!.definition.definition} Each quarter stands alone.`}>
          <div className="grid gap-6 lg:grid-cols-[1fr_15rem]">
            <QuarterLines
              quarters={natOldest.map((q) => q.quarter)}
              series={[
                { label: `All ${kind} on file`, values: natOldest.map((q) => q.total / 1000), own: true },
              ]}
            />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
              <Figure label={`All ${kind}, ${quarterLabel(natLatest.quarter)}`} value={fmtFiledThousands((groupNow ?? 0) / 1000)} note={fmtYoy(groupYoy)} />
              <Figure
                label={`Reporting ${kind}`}
                value={natLatest.institutions.toLocaleString("en-US")}
                note={`Same source and quarter; ${family!.source === "ncua" ? "NCUA 5300" : "FDIC call report"}`}
              />
            </div>
          </div>
        </Exhibit>
      ) : null}
    </>
  );
}
