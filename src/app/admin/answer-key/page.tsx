export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { formatAdminDateTime } from "@/lib/admin-time";
import {
  answerKeySchemaReady,
  banksToCheck,
  getLatestAnswerKeyScoreRun,
  isPersonChecked,
  listAnswerKeyInstitutions,
  MACHINE_ANSWER_KEYERS,
  type AnswerKeyListRow,
} from "@/lib/data-store/answer-key";
import { importAnswerKeyAction } from "./actions";

function pct(value: number | null | undefined): string {
  return value == null ? "—" : `${(value * 100).toFixed(0)}%`;
}

const DOC_LABELS: Record<string, string> = {
  html: "HTML",
  text_pdf: "Text PDF",
  scanned_pdf: "Scanned PDF",
  js_page: "JS page",
};

function StageDots({ row }: { row: AnswerKeyListRow }) {
  if (!row.score) return <span className="text-gray-400">not scored</span>;
  const stages = ["magellan", "rosetta", "knox", "darwin", "hamilton"] as const;
  return (
    <span className="inline-flex gap-1" aria-label="Stage results">
      {stages.map((stage) => {
        const right = row.score?.stages?.[stage]?.right;
        const tone = right === true ? "bg-emerald-500" : right === false ? "bg-red-500" : "bg-gray-300 dark:bg-gray-600";
        return <span key={stage} title={`${stage}: ${right === true ? "right" : right === false ? "wrong or missing" : "n/a"}`} className={`h-2 w-2 rounded-full ${tone}`} />;
      })}
    </span>
  );
}

export default async function AnswerKeyPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  await requireAuth("view");
  const { message } = await searchParams;
  const ready = await answerKeySchemaReady().catch(() => false);
  const [rows, latest] = ready
    ? await Promise.all([listAnswerKeyInstitutions(), getLatestAnswerKeyScoreRun()])
    : [[] as AnswerKeyListRow[], null];
  const personChecked = rows.filter(isPersonChecked).length;
  const firstUnconfirmed = banksToCheck(rows)[0];

  return (
    <div className="space-y-6 pb-10">
      <header>
        <Breadcrumbs items={[{ label: "Crew", href: "/admin" }, { label: "Scoreboard", href: "/admin/scoreboard" }, { label: "Answer key" }]} />
        <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Answer key</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Hand-checked fee documents and fees. Atlas scores the pipeline against every confirmed bank each day.
        </p>
      </header>

      {message ? (
        <p role="status" className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-200">
          {message}
        </p>
      ) : null}

      {!ready ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
          The answer-key migration (20270106050000_answer_key_and_scoreboard.sql) is not applied yet.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <Stat label="Banks" value={rows.length.toLocaleString()} />
            <Stat label="Checked by a person" value={`${personChecked} of ${rows.length}`} />
            <Stat label="Precision (end to end)" value={pct(latest?.precision)} />
            <Stat label="Recall (end to end)" value={pct(latest?.recall)} />
          </div>

          {firstUnconfirmed ? (
            <Link
              href={`/admin/answer-key/${firstUnconfirmed.id}`}
              className="inline-flex rounded-md bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              Check the next bank (shortest first)
            </Link>
          ) : null}

          <div className="admin-card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="px-3 py-2">Institution</th>
                  <th className="px-3 py-2">Document</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Fees</th>
                  <th className="px-3 py-2">Stages</th>
                  <th className="px-3 py-2 text-right">Precision</th>
                  <th className="px-3 py-2 text-right">Recall</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2">
                      <Link href={`/admin/answer-key/${row.id}`} className="font-medium text-gray-900 hover:text-[var(--brand-primary)] dark:text-gray-100">
                        {row.institution_name}
                      </Link>
                      <span className="ml-2 text-xs text-gray-400">
                        {row.state_code ?? ""} {row.charter_type === "credit_union" ? "CU" : "Bank"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{DOC_LABELS[row.document_type] ?? row.document_type}</td>
                    <td className="px-3 py-2 text-xs">
                      {isPersonChecked(row) ? (
                        <span className="text-emerald-700 dark:text-emerald-400" title={row.confirmed_at ? `by ${row.confirmed_by} ${formatAdminDateTime(row.confirmed_at)}` : undefined}>
                          checked by {row.confirmed_by}
                        </span>
                      ) : row.status === "confirmed" && MACHINE_ANSWER_KEYERS.has(row.confirmed_by ?? "") ? (
                        <span className="text-amber-700 dark:text-amber-400">keyed by Claude, needs a person</span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400">
                          prefilled{row.uncertain_fee_count > 0 ? ` (${row.uncertain_fee_count} unsure)` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.fee_count}</td>
                    <td className="px-3 py-2"><StageDots row={row} /></td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(row.score?.precision)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(row.score?.recall)}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">
                      No answer-key banks yet. Import a prefill file below.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">
            Stage dots: Magellan, Rosetta, Knox, Darwin, Hamilton. Green is right, red is wrong or missing. Scores come from the latest Atlas score run{latest ? ` (${formatAdminDateTime(latest.scored_at)})` : ""}.
          </p>

          <section className="admin-card space-y-3 p-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Import a prefill file</h2>
            <p className="text-xs text-gray-500">
              Version 1 JSON: <code>{"{ version: 1, institutions: [{ institution_id, document_url, document_type, content_hash?, notes?, fees: [{ canonical_key, amount, amount_kind?, frequency?, conditions?, source_line?, uncertain? }] }] }"}</code>.
              The format is documented in <code>src/lib/data-store/answer-key.ts</code>. Confirmed banks are never overwritten; prefilled banks get their fee rows replaced.
            </p>
            <form action={importAnswerKeyAction} className="space-y-2">
              <input type="file" name="prefill_file" accept="application/json,.json" className="block text-xs" />
              <textarea
                name="prefill_json"
                rows={4}
                placeholder="…or paste the JSON here"
                className="w-full rounded-md border border-gray-200 bg-transparent p-2 font-mono text-xs dark:border-white/[0.08]"
              />
              <button type="submit" className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold hover:border-blue-300 dark:border-white/[0.08]">
                Import
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-card p-4">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
}
