import type { AccuracyHistory } from "@/lib/agents/deming/accuracy-history";
import { ACCURACY_DAILY_SAMPLE, ACCURACY_WEEKLY_MIN_SCORABLE, accuracyStatusLabel, formatAccuracyBound } from "@/lib/agents/deming/accuracy-measure";

const pct = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(2)}%`;

export function AccuracyHistoryPanel({ history }: { history: AccuracyHistory | null }) {
  return (
    <section className="admin-card space-y-2 p-4" aria-labelledby="accuracy-history-heading">
      <h2 id="accuracy-history-heading" className="text-sm font-semibold text-gray-900 dark:text-gray-100">Stored-copy diagnostic, week by week</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Checks published dollar fees against our stored documents. This does not measure missing fees or independently verify the bank&apos;s current page.
        Weeks start Monday (UTC). Each scoring series stays separate; repeated fees count once, using their newest result.
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">Launch accuracy comes from the separate weekly live batch of 50 whole institutions, including missing categories. This automated status cannot satisfy that launch gate or require additional manual checks.</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {ACCURACY_DAILY_SAMPLE.toLocaleString("en-US")} fees requested per day; at least {ACCURACY_WEEKLY_MIN_SCORABLE.toLocaleString("en-US")} unique scorable fees and a 95% lower bound of 99.5% are required to mark the target met.
        Unknowns remain visible and cannot pass. Fees sharing a source may have correlated errors; this fee-level interval is not an independent certification.
      </p>
      {history == null ? <p className="text-xs text-amber-700 dark:text-amber-400">Audit history could not be read.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Persisted weekly audit estimates, scoring changes, sample sizes and confidence intervals.</caption>
            <thead>
              <tr className="text-gray-500 dark:text-gray-400">
                {["Week of (UTC)", "Scoring series", "Scorable / unknown", "Estimate", "95% interval", "99.5% target"].map((label) => <th key={label} scope="col" className="whitespace-nowrap py-2 pr-4 font-medium">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {history.weeks.map((week) => (
                <tr key={`${week.weekStart}:${week.series ?? "legacy"}`} className="border-t border-gray-100 align-top dark:border-white/[0.06]">
                  <th scope="row" className="whitespace-nowrap py-2 pr-4 font-normal tabular-nums">{week.weekStart}{week.partial ? " (so far)" : ""}</th>
                  <td className="py-2 pr-4">
                    {week.audits === 0 ? "No audit" : week.series ?? "Legacy — versions unknown"}
                    {week.scoringChanged && <span className="block text-amber-700 dark:text-amber-400">Scoring changed — new series</span>}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{week.audits ? `${week.scorable.toLocaleString("en-US")} / ${week.unknown == null ? "unknown" : week.unknown.toLocaleString("en-US")}` : "—"}</td>
                  <td className="py-2 pr-4 tabular-nums">{pct(week.accuracy)}</td>
                  <td className="whitespace-nowrap py-2 pr-4 tabular-nums">{week.range ? `${formatAccuracyBound(week.range.low, "low")}–${formatAccuracyBound(week.range.high, "high")}` : "—"}</td>
                  <td className="py-2 pr-4">{week.audits ? accuracyStatusLabel(week) : "No evidence"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {history?.legacySnapshots?.length ? (
        <details className="text-xs text-gray-500 dark:text-gray-400">
          <summary className="cursor-pointer">Legacy rolling snapshots (versions and individual audit dates unavailable)</summary>
          <p className="mt-1">These overlapping totals cannot be summed into calendar weeks or used to claim the target met.</p>
          <ul className="mt-1 space-y-1">
            {history.legacySnapshots.map((snapshot) => <li key={snapshot.asOf}>{snapshot.asOf}: {snapshot.right.toLocaleString("en-US")}/{snapshot.scorable.toLocaleString("en-US")} ({pct(snapshot.accuracy)}), no confidence claim.</li>)}
          </ul>
        </details>
      ) : null}
      <p className="text-[10px] text-gray-500 dark:text-gray-400">Series: reporting protocol · audit · category guard · source check · name check. Legacy receipts remain visible; their unknown versions and repeated units cannot support a confidence claim.</p>
    </section>
  );
}
