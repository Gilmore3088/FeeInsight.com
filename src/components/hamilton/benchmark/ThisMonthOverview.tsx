import type { BriefingOverview } from "@/lib/hamilton/briefing-observations";
import type { RevenueLine } from "@/lib/hamilton/workspace/types";
import { SERIF } from "@/components/hamilton/memo/memo";

function millions(n: number): string {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000).toLocaleString("en-US")}K`;
}

function quarterLabel(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-warm-300 bg-white/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-warm-600">{label}</p>
      <p className="mt-1.5 text-2xl leading-tight text-warm-900" style={SERIF}>
        {value}
      </p>
      <p className="mt-1 text-sm leading-snug text-warm-700">{note}</p>
    </div>
  );
}

/** The filed overdraft income line, labeled with its period and form. Describes; never prices. */
export function overdraftIncomeNote(line: RevenueLine): string {
  const what = line.combinedWith ? "Consumer overdraft and NSF fee income" : "Overdraft fee income";
  return `${what} was ${millions(line.annualIncome)} in the four quarters to ${quarterLabel(line.quarterEnd)}, the latest filed (${line.label.replace(/^.*\((.*)\)$/, "$1")}).`;
}

/**
 * The top of This month: what Hamilton is, then the month in three numbers (where the schedule
 * sits against its peers, fee changes nearby, and fee income). Describes; never says what to do.
 */
export function ThisMonthOverview({
  institutionName,
  peerLabel,
  overview,
  windowDays,
  overdraftIncome = null,
}: {
  institutionName: string;
  peerLabel: string;
  overview: BriefingOverview;
  windowDays: number;
  overdraftIncome?: RevenueLine | null;
}) {
  const { feesCompared, higher, inLine, lower, peerCount, stateLabel, feesChangedNearby, income } = overview;
  const place = stateLabel ?? "your state";
  return (
    <section aria-label="This month at a glance" className="flex flex-col gap-4">
      <p className="max-w-3xl text-pretty text-base leading-relaxed text-warm-800">
        Hamilton is {institutionName}&apos;s fee analyst. Each month it reads your published fee schedule against{" "}
        {peerCount > 0 ? `${peerCount.toLocaleString("en-US")} peer institutions` : "your peers"} ({peerLabel}), watches
        for fee changes in {place}, and tracks your fee income from your call report. It reports what it finds; it never
        says what to charge.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          label="Your fees against peers"
          value={feesCompared > 0 ? `${inLine} of ${feesCompared} in line` : "Not enough peers yet"}
          note={
            feesCompared > 0
              ? `${higher} higher and ${lower} lower than most peers.`
              : "Too few peers publish your fees to compare them."
          }
        />
        <Tile
          label={`Fee changes in ${place}`}
          value={feesChangedNearby === 0 ? "None confirmed" : `${feesChangedNearby} of your fees`}
          note={
            feesChangedNearby === 0
              ? `No institution in ${place} changed a fee you charge in the last ${windowDays} days.`
              : `changed at an institution in ${place} in the last ${windowDays} days.`
          }
        />
        <Tile
          label="Service charge income"
          value={income ? millions(income.latestTtm) : "No filing on file"}
          note={
            income
              ? `Four quarters to ${quarterLabel(income.quarterEnd)}${income.yoyPct == null ? "" : `, ${income.yoyPct >= 0 ? "up" : "down"} ${Math.abs(Math.round(income.yoyPct))}% on the year before`} (${income.source === "ncua" ? "NCUA 5300" : "FDIC call report"}).`
              : "Hamilton has no call report for this institution."
          }
        />
      </div>
      {overdraftIncome ? (
        <p className="max-w-3xl text-sm leading-snug text-warm-700">{overdraftIncomeNote(overdraftIncome)}</p>
      ) : null}
    </section>
  );
}
