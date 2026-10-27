import {
  KNOX_FOUND_TARGET,
  KNOX_RIGHT_TARGET,
  KNOX_TARGET_MIN_BANKS,
  knoxTargetVerdict,
  type GoalScorecard,
  type KnoxAnswerKeyScore,
} from "@/lib/agents/goal-scorecard";

const n = (value: number) => value.toLocaleString("en-US");
const pct = (value: number | null) => (value == null ? "—" : `${(value * 100).toFixed(1)}%`);

/** Plain words for the reasons the answer-key eligibility check leaves a bank out (`answer-key-eligibility.ts`). */
const EXCLUSION_WORDS: Record<string, string> = {
  key_line_not_in_reference: "a key line is no longer in the bank's document",
  reference_source_superseded: "the bank has a newer document",
  consumer_scope_unproven: "not shown to be the consumer schedule",
  key_line_consumer_scope_unproven: "a key line not shown to be a consumer fee",
  reference_bytes_changed: "the document has changed",
  reference_main_text_changed: "the document's text has changed",
  reference_unreadable: "the document could not be read",
  legacy_not_current: "an old schedule",
  newer_consumer_schedule: "a newer consumer schedule exists",
  business_document: "a business schedule",
  not_priced_schedule: "not a priced fee schedule",
};
const exclusionWords = (reason: string) => EXCLUSION_WORDS[reason] ?? reason.replaceAll("_", " ");

const TOO_FEW = `Too few banks to judge against the target (fewer than ${KNOX_TARGET_MIN_BANKS})`;

function Measure({ label, value, target, part, whole, banks }: { label: string; value: number | null; target: number; part: number; whole: number; banks: number }) {
  const verdict = knoxTargetVerdict(value, target, banks);
  const tone = verdict === "met" ? "text-emerald-600" : verdict === "not_met" ? "text-amber-700 dark:text-amber-400" : "text-gray-500";
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
        {pct(value)}
        <span className={`ml-2 text-xs font-semibold ${tone}`}>
          target {pct(target)}{verdict === "met" ? ", met" : verdict === "not_met" ? ", not met" : ""}
        </span>
      </p>
      <p className="text-xs text-gray-500">{n(part)} of {n(whole)}</p>
      {verdict === "too_few_banks" ? <p className="text-xs text-gray-500">{TOO_FEW}.</p> : null}
    </div>
  );
}

function Cohort({ score }: { score: KnoxAnswerKeyScore }) {
  if (score.eligibleBanks == null || score.confirmedBanks == null) return null;
  return (
    <p className="mt-2 text-xs text-gray-700 dark:text-gray-300">
      {n(score.eligibleBanks)} of {n(score.confirmedBanks)} answer-key banks are eligible references (key still current).
      {score.topExclusions.length > 0
        ? ` Most often left out because ${score.topExclusions.map((entry) => `${exclusionWords(entry.reason)} (${n(entry.count)})`).join(", ")}.`
        : ""}
    </p>
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
              <Measure label="Found" value={score.recall} target={KNOX_FOUND_TARGET} part={score.found} whole={score.expected} banks={score.banks} />
              <Measure label="Right" value={score.precision} target={KNOX_RIGHT_TARGET} part={score.right} whole={score.reads} banks={score.banks} />
            </div>
            <Cohort score={score} />
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
            The same banks and documents, split by the specialist each Knox line is credited to (its <code>knox_specialist:</code> flag; no flag is the rules pass, and the paid pass is its own row). A read two specialists both stored counts for each of them, so the rows can add up to more than Knox&apos;s total. Found is out of every key fee on these banks, so a specialist for one family of fees finds a small share by design; the 85% target is for Knox as a whole. Found only it: key fees no other specialist&apos;s line matched. The 90% target applies to each specialist&apos;s right share, and a share under it is marked only when the specialist read from at least {KNOX_TARGET_MIN_BANKS} banks.
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
                    <td className={`py-1 text-right tabular-nums ${knoxTargetVerdict(row.precision, KNOX_RIGHT_TARGET, row.banks) === "not_met" ? "font-semibold text-amber-700 dark:text-amber-400" : ""}`}>{pct(row.precision)}</td>
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
