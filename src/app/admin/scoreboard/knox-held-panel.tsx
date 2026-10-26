import type { GoalScorecard } from "@/lib/agents/goal-scorecard";

const n = (value: number) => value.toLocaleString("en-US");

/**
 * Knox's held lines on the goal scorecard (#1102 item 4): the pile by reason and age, and the
 * lines that left it each week. Both come from the daily snapshot (`detail.goal`).
 */
export function KnoxHeldPanel({ goal }: { goal: GoalScorecard }) {
  if (goal.knoxHeld === undefined && goal.knoxHeldExits === undefined) {
    return <p className="admin-card p-4 text-xs text-gray-500">Knox&apos;s held lines appear with the next daily scoreboard, or press Score now.</p>;
  }
  const pile = goal.knoxHeld;
  const exits = goal.knoxHeldExits;
  return (
    <div className="admin-card space-y-3 overflow-x-auto p-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Knox&apos;s held lines, by reason and age</p>
        <p className="mt-1 text-xs text-gray-500">
          Lines Knox kept back from Darwin, by why it held them and how long ago it wrote them. Set-aside lines are kept and still counted. Owners and ways out are on /admin/knox.
        </p>
        {!pile ? (
          <p className="mt-2 text-xs text-gray-500">Could not be read.</p>
        ) : (
          <>
            <table className="mt-2 w-full text-left text-xs">
              <thead>
                <tr className="text-gray-400">
                  <th scope="col" className="py-1 pr-4 font-semibold">Reason</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">Lines</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">Set aside</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">Under 7 days</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">7–14 days</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">14–30 days</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">Over 30 days</th>
                  <th scope="col" className="py-1 font-semibold">Way out</th>
                </tr>
              </thead>
              <tbody>
                {pile.byReason.map((row) => (
                  <tr key={row.shape} className="border-t border-gray-100 dark:border-white/[0.06]">
                    <td className="py-1 pr-4">{row.label}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{n(row.count)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{n(row.setAside)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{n(row.ages.under7)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{n(row.ages.days7to14)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{n(row.ages.days14to30)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{n(row.ages.over30)}</td>
                    <td className={`py-1 ${row.hasExit ? "" : "font-semibold text-amber-700 dark:text-amber-400"}`}>{row.hasExit ? "Yes" : "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-700 dark:text-gray-300">
              {n(pile.total)} held, {n(pile.setAside)} of them set aside.
            </p>
            <p className="font-mono text-[10px] text-gray-400">query: {pile.query}</p>
          </>
        )}
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Lines leaving the held pile, week by week</p>
        <p className="mt-1 text-xs text-gray-500">
          From the counts each Knox extract step records in the run ledger. Weeks start Monday (UTC). Not counted: a held line that a new read of its document takes over, which the ledger does not count on its own. New held lines per week are not shown either: the ledger counts lines held per read, re-reads included, not new lines.
        </p>
        {!exits ? (
          <p className="mt-2 text-xs text-gray-500">Could not be read.</p>
        ) : (
          <>
            <table className="mt-2 w-full text-left text-xs">
              <thead>
                <tr className="text-gray-400">
                  <th scope="col" className="py-1 pr-4 font-semibold">Week of</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">Extract steps</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">Sent to Darwin</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">Re-read</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">Filed by name</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">Traced</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">Rates</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">Set aside</th>
                  <th scope="col" className="py-1 text-right font-semibold">Back on hold</th>
                </tr>
              </thead>
              <tbody>
                {exits.weeks.map((week) => (
                  <tr key={week.weekStart} className="border-t border-gray-100 dark:border-white/[0.06]">
                    <td className="py-1 pr-4 tabular-nums">{week.weekStart}{week.partial ? " (so far)" : ""}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{n(week.steps)}</td>
                    <td className="py-1 pr-4 text-right font-semibold tabular-nums">{week.steps === 0 ? "—" : n(week.toDarwin)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{week.steps === 0 ? "—" : n(week.heldRecheck)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{week.steps === 0 ? "—" : n(week.nameFiled)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{week.steps === 0 ? "—" : n(week.untraced)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{week.steps === 0 ? "—" : n(week.rates)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{week.steps === 0 ? "—" : n(week.setAside)}</td>
                    <td className="py-1 text-right tabular-nums">{week.steps === 0 ? "—" : n(week.backOnHold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="font-mono text-[10px] text-gray-400">query: {exits.query}</p>
          </>
        )}
      </div>
    </div>
  );
}
