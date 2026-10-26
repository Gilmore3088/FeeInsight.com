import { KNOX_FOUND_TARGET, KNOX_RIGHT_TARGET, type GoalScorecard } from "@/lib/agents/goal-scorecard";

const n = (value: number) => value.toLocaleString("en-US");
const pct = (value: number | null) => (value == null ? "—" : `${(value * 100).toFixed(1)}%`);

function Measure({ label, value, target, part, whole }: { label: string; value: number | null; target: number; part: number; whole: number }) {
  const met = value != null && value >= target;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
        {pct(value)}
        <span className={`ml-2 text-xs font-semibold ${value == null ? "text-gray-500" : met ? "text-emerald-600" : "text-amber-700 dark:text-amber-400"}`}>
          target {pct(target)}{value == null ? "" : met ? ", met" : ", not met"}
        </span>
      </p>
      <p className="text-xs text-gray-500">{n(part)} of {n(whole)}</p>
    </div>
  );
}

/**
 * Knox against its two targets on the answer key (#1098): the share of the key's fees it found and
 * the share of its reads that are right, counting only banks whose right document Rosetta read, and
 * the same two numbers for each specialist. From the daily snapshot (`detail.goal`).
 */
export function KnoxAnswerKeyPanel({ goal }: { goal: GoalScorecard }) {
  if (goal.knoxAnswerKey === undefined) {
    return <p className="admin-card p-4 text-xs text-gray-500">Knox&apos;s answer-key targets appear with the next daily scoreboard, or press Score now.</p>;
  }
  const score = goal.knoxAnswerKey;
  return (
    <div className="admin-card space-y-3 overflow-x-auto p-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Knox on the answer key, against its targets</p>
        <p className="mt-1 text-xs text-gray-500">
          Counts only answer-key banks whose right document Rosetta read, so a wrong or unread document is Magellan&apos;s or Rosetta&apos;s miss, not Knox&apos;s. Found is the share of the key&apos;s fees that a Knox line from that document matches (category and price). Right is the share of Knox&apos;s distinct reads from that document that are in the key. Targets set by James on Oct 12.
        </p>
        {!score ? (
          <p className="mt-2 text-xs text-gray-500">Could not be read.</p>
        ) : score.scoreRunId == null ? (
          <p className="mt-2 text-xs text-gray-500">No answer-key score yet at scorer v{score.scorerVersion}.</p>
        ) : score.referenceState != null && score.referenceState !== "measured" ? (
          <p className="mt-2 text-xs text-gray-500">
            Not measured: the newest answer-key score (run #{score.scoreRunId}, {score.scoredAt?.slice(0, 10) ?? "date unknown"}) had no eligible reference banks.
          </p>
        ) : (
          <>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Measure label="Found" value={score.recall} target={KNOX_FOUND_TARGET} part={score.found} whole={score.expected} />
              <Measure label="Right" value={score.precision} target={KNOX_RIGHT_TARGET} part={score.right} whole={score.reads} />
            </div>
            <p className="mt-2 text-xs text-gray-700 dark:text-gray-300">
              {n(score.banks)} {score.banks === 1 ? "bank" : "banks"} with the right document read, {n(score.expected)} key fees. From answer-key score run #{score.scoreRunId} (scorer v{score.scorerVersion}), {score.scoredAt?.slice(0, 10) ?? "date unknown"}.
            </p>
          </>
        )}
      </div>
      {score && score.scoreRunId != null && (score.referenceState == null || score.referenceState === "measured") ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Each Knox specialist on the answer key</p>
          <p className="mt-1 text-xs text-gray-500">
            The same banks and documents, split by the specialist each Knox line is credited to (its <code>knox_specialist:</code> flag; no flag is the rules pass, and the paid pass is its own row). Knox stores a fee once, under the first specialist that read it, so a fee two specialists read counts for the first. Found is out of every key fee on these banks, so a specialist for one family of fees finds a small share by design; the 85% target is for Knox as a whole. Found only it: key fees no other specialist&apos;s line matched. The 90% target applies to each specialist&apos;s right share.
          </p>
          {!score.bySpecialist ? (
            <p className="mt-2 text-xs text-gray-500">Specialist rows appear with the next answer-key score.</p>
          ) : score.bySpecialist.length === 0 ? (
            <p className="mt-2 text-xs text-gray-500">No Knox line was read from these documents.</p>
          ) : (
            <table className="mt-2 w-full text-left text-xs">
              <thead>
                <tr className="text-gray-400">
                  <th scope="col" className="py-1 pr-4 font-semibold">Specialist</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">Banks</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">Found</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">Share of key</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">Found only it</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">Reads</th>
                  <th scope="col" className="py-1 pr-4 text-right font-semibold">Right</th>
                  <th scope="col" className="py-1 text-right font-semibold">Right share</th>
                </tr>
              </thead>
              <tbody>
                {score.bySpecialist.map((row) => (
                  <tr key={row.strategy} className="border-t border-gray-100 dark:border-white/[0.06]">
                    <td className="py-1 pr-4 font-mono">{row.strategy}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{n(row.banks)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{n(row.found)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{pct(row.shareOfKey)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{n(row.foundOnly)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{n(row.reads)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{n(row.right)}</td>
                    <td className={`py-1 text-right tabular-nums ${row.precision != null && row.precision < KNOX_RIGHT_TARGET ? "font-semibold text-amber-700 dark:text-amber-400" : ""}`}>{pct(row.precision)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
      {score ? <p className="font-mono text-[10px] text-gray-400">query: {score.query}</p> : null}
    </div>
  );
}
