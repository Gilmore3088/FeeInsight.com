import {
  formatMeasure,
  moveTone,
  type MeasureResult,
  type Move,
  type MonthlyReview,
} from "@/lib/agents/deming/monthly-review";

const ARROW: Record<Move, string> = { up: "↑", down: "↓", flat: "→", unknown: "·" };
const TONE_CLASS = {
  good: "text-emerald-700 dark:text-emerald-400",
  bad: "text-red-700 dark:text-red-400",
  neutral: "text-gray-500",
} as const;
const REPO = "https://github.com/Gilmore3088/FeeInsight.com";

function Compared({ row, before, move, label }: { row: MeasureResult; before: number | null; move: Move; label: string }) {
  const tone = moveTone(move, row.better);
  return (
    <span className="block tabular-nums">
      <span className={`font-semibold ${TONE_CLASS[tone]}`} aria-label={`${label}: ${move}`}>
        {ARROW[move]}
      </span>{" "}
      <span className="text-gray-600 dark:text-gray-400">{formatMeasure(before, row.unit)}</span>
    </span>
  );
}

/**
 * The monthly agent review (#1107): one card per agent, this month against last month and against
 * the 2026-10-12 review's figure. Arrows are green when the move is the good way, red when not. A
 * measure past its limit is marked ALARM; one that could not be read shows "unknown", never 0.
 */
export function MonthlyReviewSection({ review, failed }: { review: MonthlyReview | null; failed: boolean }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="monthly-review-title">
      <div>
        <h2 id="monthly-review-title" className="text-base font-bold text-gray-900 dark:text-gray-100">
          Monthly review{review ? `, ${review.month}` : ""}
        </h2>
        <p className="text-xs text-gray-500">
          The measures from the {review?.baselineDate ?? "2026-10-12"} agent reviews, re-read on the 1st of each month (UTC).
          Each row shows this month, then last month and the review&apos;s own figure with the direction of the move. Green is
          better, red is worse. A row marked ALARM moved the wrong way past its limit and belongs on that agent&apos;s tracker.
        </p>
      </div>
      {failed ? <p className="text-sm text-red-700 dark:text-red-400">The monthly review could not be read.</p> : null}
      {!failed && !review ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">No monthly review has run yet. The first runs on the 1st of the month with the daily scoreboard.</p>
      ) : null}
      {review ? (
        <>
          {review.alarms.length > 0 ? (
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">
              {review.alarms.length} {review.alarms.length === 1 ? "measure" : "measures"} past {review.alarms.length === 1 ? "its" : "their"} limit.
            </p>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-400">No measure moved the wrong way past its limit.</p>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {review.agents.map((page) => (
              <div key={page.agent} className="admin-card min-w-0 px-4 py-4" id={`monthly-${page.agent}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{page.name}</span>
                  <a className="text-xs text-gray-500 underline" href={`${REPO}/issues/${page.tracker}`}>
                    Tracker #{page.tracker}
                  </a>
                </div>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[11px] text-gray-500">
                        <th scope="col" className="py-1 pr-2 font-medium">Measure</th>
                        <th scope="col" className="py-1 pr-2 text-right font-medium">{review.month}</th>
                        <th scope="col" className="py-1 pr-2 text-right font-medium">{review.lastMonth ?? "Last month"}</th>
                        <th scope="col" className="py-1 text-right font-medium">{review.baselineDate}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.measures.map((row) => (
                        <tr key={row.key} className="border-t border-black/[0.05] align-top dark:border-white/[0.06]">
                          <td className="py-1.5 pr-2">
                            <span className={`block ${row.alarm ? "font-semibold text-red-700 dark:text-red-400" : "text-gray-800 dark:text-gray-200"}`}>
                              {row.alarm ? "ALARM: " : ""}
                              {row.label}
                            </span>
                            {row.error ? <span className="block text-[11px] text-gray-500">Unknown: {row.error}</span> : null}
                            {row.baselineNote ? <span className="block text-[11px] text-gray-400">{row.baselineNote}</span> : null}
                          </td>
                          <td className="py-1.5 pr-2 text-right font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                            {formatMeasure(row.value, row.unit)}
                          </td>
                          <td className="py-1.5 pr-2 text-right">
                            <Compared row={row} before={row.lastMonth} move={row.vsLastMonth} label="Since last month" />
                          </td>
                          <td className="py-1.5 text-right">
                            {row.baseline == null ? (
                              <span className="text-gray-400">not stated</span>
                            ) : (
                              <Compared row={row} before={row.baseline} move={row.vsBaseline} label={`Since ${review.baselineDate}`} />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 font-mono text-[10px] text-gray-400">{page.review}</p>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
