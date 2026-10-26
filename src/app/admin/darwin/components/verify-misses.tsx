import { sql } from "@/lib/data-store/connection";
import { loadVerifyMissRows, summarizeVerifyMisses, VERIFY_MISS_CHECK_LABELS, VERIFY_MISS_LIMIT, type VerifyMissCheck, type VerifyMissResult } from "@/lib/agents/darwin/verify-misses";

/**
 * Fees Darwin passed that a person later found it should have stopped (#2057),
 * by the check that missed, with the newest lessons. The same read Darwin's verify step records on
 * its run ledger (`darwin.verify_misses`); it changes no fee.
 */
export async function VerifyMisses() {
  let result: VerifyMissResult | null;
  try {
    result = summarizeVerifyMisses(await loadVerifyMissRows(sql));
  } catch (error) {
    console.error("Darwin verify misses could not be read", error);
    result = null;
  }
  const checks = result ? Object.entries(result.missedByCheck).sort((a, b) => b[1] - a[1]) : [];
  return (
    <section aria-label="Verify misses" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Fees verify should have stopped, by check</h2>
        {result ? (
          <p className="text-xs text-gray-500">
            Newest {VERIFY_MISS_LIMIT.toLocaleString("en-US")} findings: {result.standing.toLocaleString("en-US")} standing · {result.withdrawn.toLocaleString("en-US")} withdrawn
          </p>
        ) : null}
      </div>
      {result == null ? (
        <p className="text-xs text-red-700 dark:text-red-300">The verify misses could not be read.</p>
      ) : result.standing === 0 ? (
        <p className="text-xs text-gray-500">{result.withdrawn > 0 ? "No hold or correction filed against verify is still standing." : "No hold or correction is filed against verify."}</p>
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {checks.map(([check, count]) => (
              <li key={check} className="admin-card space-y-1.5 p-4">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{VERIFY_MISS_CHECK_LABELS[check as VerifyMissCheck] ?? check}</p>
                <p className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                  {count.toLocaleString("en-US")} <span className="text-xs font-normal text-gray-500">missed</span>
                </p>
              </li>
            ))}
          </ul>
          <ul className="space-y-1">
            {result.lessons.slice(0, 5).map((lesson) => (
              <li key={lesson.feedbackId} className="text-xs text-gray-600 dark:text-gray-400">{lesson.lesson}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
