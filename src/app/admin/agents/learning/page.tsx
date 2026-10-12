export const dynamic = "force-dynamic";

import Link from "next/link";
import { unstable_cache } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { formatAdminDateTime } from "@/lib/admin-time";
import {
  STAGE_AGENT,
  STAGE_ORDER,
  getMethodScorecard,
  groupMethods,
  METHOD_OUTCOME_GROUPS,
  type MethodGroup,
  type MethodOutcomeGroup,
  type MethodRow,
} from "@/lib/data-store/method-scorecard";
import { Unreadable } from "../../room-hub";

// A 7-day scan of the attempt log takes about a quarter second; ten minutes old is fresh enough.
const getCachedScorecard = unstable_cache(() => getMethodScorecard(7), ["admin", "method-scorecard", "outcome-breakdown-v2"], { revalidate: 600 });

const OUTCOME_STYLES: Record<MethodOutcomeGroup, { label: string; bar: string; text: string }> = {
  worked: { label: "worked", bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  nothing: { label: "nothing found / unchanged", bar: "bg-gray-300 dark:bg-white/25", text: "" },
  held: { label: "held / flagged", bar: "bg-amber-400", text: "text-amber-700 dark:text-amber-400" },
  nextStep: { label: "needs another step", bar: "bg-sky-400", text: "text-sky-700 dark:text-sky-400" },
  failed: { label: "errors", bar: "bg-red-500", text: "text-red-700 dark:text-red-400" },
};

const OUTCOME_LABELS: Record<string, string> = {
  ok: "Result produced or check passed", ok_partial: "Partial result", low_yield: "Low yield",
  unchanged: "Already up to date", no_candidates: "No candidates", empty: "Empty result",
  rejected: "Rejected by checks", evidence_mismatch: "Evidence disagreed", wrong_document: "Wrong document",
  scanned_pdf: "Scanned PDF (needs OCR)", js_required: "JavaScript required", unsupported_format: "Unsupported format",
  too_large: "Document too large", blocked_bot: "Website blocked automation", budget_blocked: "Budget blocked",
  invalid_url: "Invalid URL", http_403: "Access denied (401 / 403)", http_404: "Page not found (404)",
  http_410: "Page gone (410)", http_429: "Rate limited (429)", http_5xx: "Website server error (5xx)",
  http_other: "Other HTTP error", timeout: "Timed out", network_error: "Network error", parse_error: "Parse error",
};

const ACCESS_METHOD_NAMES: Record<string, string> = {
  "read.html": "HTML document access", "read.pdf": "PDF document access", "read.text": "Text document access",
  "read.unknown": "Document access or unsupported format", "read.docx": "Word access or unsupported format",
  "read.document_access": "Document access", "read.table_rows": "Table rows recorded",
};

function methodName(strategy: string): string {
  if (ACCESS_METHOD_NAMES[strategy]) return ACCESS_METHOD_NAMES[strategy];
  const bare = strategy.replace(/^[a-z]+\./, "").replace(/^family\./, "").replace(/_/g, " ");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

function outcomeCount(row: MethodRow, group: MethodOutcomeGroup): number {
  return group === "worked" ? row.ok : row[group];
}

function share(row: MethodRow, group: MethodOutcomeGroup): number {
  return row.attempts > 0 ? outcomeCount(row, group) / row.attempts : 0;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function OutcomeBar({ row }: { row: MethodRow }) {
  if (row.score && row.score.decided > 0) {
    const correct = row.score.correct / row.score.decided;
    return (
      <div className="flex h-2 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]" role="presentation">
        <div className="h-full bg-emerald-500" style={{ width: `${correct * 100}%` }} />
        <div className="h-full bg-red-500" style={{ width: `${(1 - correct) * 100}%` }} />
      </div>
    );
  }
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]" role="presentation">
      {METHOD_OUTCOME_GROUPS.map((group) => (
        <div key={group} className={`h-full ${OUTCOME_STYLES[group].bar}`} style={{ width: `${share(row, group) * 100}%` }} />
      ))}
    </div>
  );
}

function money(value: number): string {
  return value > 0 && value < 0.01 ? "<$0.01" : `$${value.toFixed(2)}`;
}

function OutcomeDetails({ row }: { row: MethodRow }) {
  return (
    <details className="mt-1 text-[11px] text-gray-500">
      <summary className="cursor-pointer">Outcome counts</summary>
      <ul className="mt-1 space-y-0.5">
        {Object.entries(row.outcomes).sort((a, b) => b[1] - a[1]).map(([outcome, count]) => {
          const label = row.score && outcome === "ok" ? "Met 95% accuracy bar"
            : row.score && outcome === "evidence_mismatch" ? "Below 95% accuracy bar"
              : OUTCOME_LABELS[outcome] ?? outcome.replace(/_/g, " ");
          return <li key={outcome}>{label}: {count.toLocaleString("en-US")}</li>;
        })}
      </ul>
    </details>
  );
}

/** The Learning screen: for every agent, which methods worked this week and which didn't. */
export default async function LearningPage() {
  await requireAuth("view");
  let scorecard: Awaited<ReturnType<typeof getMethodScorecard>> | null = null;
  try {
    scorecard = await getCachedScorecard();
  } catch (error) {
    console.error("Learning scorecard failed", error);
  }
  const groups = scorecard ? groupMethods(scorecard.rows) : new Map<string, MethodGroup[]>();
  const stages = STAGE_ORDER.filter((stage) => groups.has(stage));

  return (
    <div className="space-y-8 pb-10">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-gray-500">Agents · Learning</p>
        <h1 className="admin-display-title mt-2">Which methods are working</h1>
        <p className="admin-lede mt-1">
          Every method each agent tried in the last 7 days, from the attempt log the agents read before choosing what to try next.
          Known permanent document and guessed-path failures are skipped for the same input and method version; changed content or a new version can be tried again.
          Temporary network and website errors can be retried.
          Linked pages follow their normal retry windows; new path knowledge allows guessed paths to be tried again.
        </p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
          {METHOD_OUTCOME_GROUPS.map((group) => (
            <span key={group}><span aria-hidden="true" className={`mr-1 inline-block size-2 rounded-full ${OUTCOME_STYLES[group].bar}`} />{OUTCOME_STYLES[group].label}</span>
          ))}
        </p>
        <p className="mt-2 text-[11px] text-gray-500">Worked means output was produced or a check passed. Holds and disagreements describe the input; they do not establish whether the decision was correct. Verdict scores measure accuracy against answer keys.</p>
        {scorecard ? <p className="mt-2 text-[11px] text-gray-500">Read {formatAdminDateTime(scorecard.readAt)}</p> : null}
      </header>

      {!scorecard ? <Unreadable what="The attempt log" /> : null}
      {scorecard && stages.length === 0 ? <p className="text-sm text-gray-500">No attempts were logged in the last 7 days.</p> : null}

      {stages.map((stage) => {
        const owner = STAGE_AGENT[stage] ?? { agent: "atlas", name: stage, job: "" };
        const methods = groups.get(stage)!;
        return (
          <section key={stage} aria-label={`${owner.name}: ${owner.job}`} className="admin-card px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                {owner.name} <span className="font-normal text-gray-500">· {owner.job}</span>
              </p>
              <Link href={`/admin/${owner.agent === "atlas" ? "atlas/details" : owner.agent}`} prefetch={false} className="text-xs font-semibold text-[var(--brand-primary)]">
                Open {owner.name}
              </Link>
            </div>
            <ul className="mt-3 space-y-3">
              {methods.map((method) => {
                const current = method.current;
                const score = current.score;
                return (
                  <li key={method.strategy} className="grid grid-cols-1 gap-x-4 gap-y-1 xl:grid-cols-[minmax(0,12rem)_minmax(10rem,1fr)_minmax(0,18rem)]">
                    <p className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
                      {methodName(method.strategy)}{" "}
                      <span className="rounded bg-black/[0.05] px-1 font-mono text-[10px] font-medium text-gray-600 dark:bg-white/[0.08] dark:text-gray-300">
                        v{current.version}
                      </span>
                    </p>
                    <div className="min-w-0 self-center">
                      <OutcomeBar row={current} />
                      {method.strategy === "publish.guard_requeue" ? <p className="mt-1 text-[11px] text-gray-500">Previously rejected fees checked again; those still rejected remain blocked.</p> : null}
                      {method.strategy === "read.table_rows" ? <p className="mt-1 text-[11px] text-gray-500">Successful table-row outputs only; documents with no rows do not log this method.</p> : null}
                      {method.strategy === "read.document_access" ? <p className="mt-1 text-[11px] text-gray-500">Could not obtain the document, before a reader ran.</p>
                        : ACCESS_METHOD_NAMES[method.strategy] && method.strategy !== "read.table_rows" ? <p className="mt-1 text-[11px] text-gray-500">Document access and format outcomes; these do not measure reader accuracy.</p> : null}
                      {method.older.length > 0 ? (
                        <p className="mt-1 text-[11px] text-gray-500">
                          Earlier: {method.older.slice(0, 3).map((row) => row.score && row.score.decided > 0
                            ? `v${row.version} ${pct(row.score.correct / row.score.decided)} correct of ${row.score.decided.toLocaleString("en-US")} verdicts`
                            : `v${row.version} ${pct(share(row, "worked"))} worked of ${row.attempts.toLocaleString("en-US")}`).join(" · ")}
                        </p>
                      ) : null}
                      <OutcomeDetails row={current} />
                    </div>
                    <p className="min-w-0 text-xs tabular-nums text-gray-600 dark:text-gray-300 xl:text-right">
                      {score ? (
                        <>
                          <span className="font-semibold">{score.decided > 0 ? pct(score.correct / score.decided) : "—"} correct</span>
                          <span className="block text-[11px] text-gray-500">{score.correct.toLocaleString("en-US")} of {score.decided.toLocaleString("en-US")} decided verdicts</span>
                          <span className="block text-[11px] text-gray-500">95% bar: {score.passedChunks} of {score.chunks} scored batches passed</span>
                          {score.holdoutDecided > 0 ? <span className="block text-[11px] text-gray-500">Holdout: {pct(score.holdoutCorrect / score.holdoutDecided)} correct ({score.holdoutCorrect} of {score.holdoutDecided})</span> : null}
                        </>
                      ) : (
                        <>
                          {METHOD_OUTCOME_GROUPS.filter((group) => outcomeCount(current, group) > 0).map((group, index) => (
                            <span key={group}>{index > 0 ? " · " : ""}<span className={`font-semibold ${OUTCOME_STYLES[group].text}`}>{pct(share(current, group))}</span> {OUTCOME_STYLES[group].label}</span>
                          ))}
                          <span className="block text-[11px] text-gray-500">of {current.attempts.toLocaleString("en-US")} tries</span>
                        </>
                      )}
                      {current.costUsd > 0 ? (
                        <span className="block text-[11px] text-gray-500">
                          {money(current.costUsd)} spent
                          {current.ok > 0 ? ` · ${money(current.costUsd / current.ok)} per result / passed check` : ""}
                        </span>
                      ) : null}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
