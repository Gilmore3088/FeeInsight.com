export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { formatAdminDateTime } from "@/lib/admin-time";
import { getDisplayName } from "@/lib/fee-taxonomy";
import {
  ANSWER_KEY_AMOUNT_KINDS,
  ANSWER_KEY_DOCUMENT_TYPES,
  answerKeySchemaReady,
  getAnswerKeyInstitution,
  listAnswerKeyInstitutions,
  VALID_ANSWER_KEY_CANONICAL_KEYS,
  type AnswerKeyFee,
} from "@/lib/data-store/answer-key";
import {
  addAnswerKeyFeeAction,
  confirmAnswerKeyAction,
  deleteAnswerKeyFeeAction,
  reopenAnswerKeyAction,
  saveAnswerKeyDocumentAction,
  saveAnswerKeyFeeAction,
} from "../actions";

const INPUT = "w-full rounded border border-gray-200 bg-transparent px-1.5 py-1 text-xs dark:border-white/[0.08]";
const CANONICAL_KEYS = [...VALID_ANSWER_KEY_CANONICAL_KEYS].sort();

function pct(value: number | null | undefined): string {
  return value == null ? "—" : `${(value * 100).toFixed(0)}%`;
}

function FeeRow({ fee, answerKeyId }: { fee: AnswerKeyFee; answerKeyId: number }) {
  const formId = `fee-${fee.id}`;
  const tone = fee.status === "confirmed"
    ? ""
    : fee.uncertain
      ? "bg-amber-50/70 dark:bg-amber-950/20"
      : "bg-blue-50/40 dark:bg-blue-950/10";
  return (
    <tr className={tone}>
      <td className="px-2 py-1.5 align-top">
        <form id={formId} action={saveAnswerKeyFeeAction}>
          <input type="hidden" name="fee_id" value={fee.id} />
          <input type="hidden" name="answer_key_id" value={answerKeyId} />
        </form>
        <input form={formId} name="canonical_key" defaultValue={fee.canonical_key} list="canonical-keys" className={INPUT} aria-label="Canonical key" />
        <span className="mt-0.5 block text-[10px] text-gray-400">{getDisplayName(fee.canonical_key)}</span>
      </td>
      <td className="w-24 px-2 py-1.5 align-top">
        <input form={formId} name="amount" defaultValue={fee.amount ?? ""} inputMode="decimal" className={`${INPUT} text-right tabular-nums`} aria-label="Amount" />
      </td>
      <td className="w-24 px-2 py-1.5 align-top">
        <select form={formId} name="amount_kind" defaultValue={fee.amount_kind} className={INPUT} aria-label="Amount kind">
          {ANSWER_KEY_AMOUNT_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
        </select>
      </td>
      <td className="w-28 px-2 py-1.5 align-top">
        <input form={formId} name="frequency" defaultValue={fee.frequency ?? ""} className={INPUT} aria-label="Frequency" />
      </td>
      <td className="px-2 py-1.5 align-top">
        <input form={formId} name="conditions" defaultValue={fee.conditions ?? ""} className={INPUT} aria-label="Conditions" />
      </td>
      <td className="px-2 py-1.5 align-top">
        <input form={formId} name="source_line" defaultValue={fee.source_line ?? ""} className={`${INPUT} font-mono`} aria-label="Source line" />
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 align-top text-xs">
        <button form={formId} type="submit" className="rounded border border-emerald-300 px-2 py-1 font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400">
          {fee.status === "confirmed" ? "Save" : "Confirm"}
        </button>
        <form action={deleteAnswerKeyFeeAction} className="ml-1 inline">
          <input type="hidden" name="fee_id" value={fee.id} />
          <input type="hidden" name="answer_key_id" value={answerKeyId} />
          <button type="submit" className="rounded px-1.5 py-1 text-gray-400 hover:text-red-600" aria-label="Delete fee row">✕</button>
        </form>
        <span className="mt-0.5 block text-[10px] text-gray-400">
          {fee.status === "confirmed" ? `ok ${fee.confirmed_by ?? ""}` : fee.uncertain ? "unsure" : "prefilled"}
        </span>
      </td>
    </tr>
  );
}

export default async function AnswerKeyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ message?: string }>;
}) {
  await requireAuth("view");
  const [{ id }, { message }] = await Promise.all([params, searchParams]);
  const answerKeyId = Number(id);
  if (!Number.isInteger(answerKeyId) || answerKeyId <= 0) notFound();
  if (!(await answerKeySchemaReady().catch(() => false))) notFound();
  const [entry, all] = await Promise.all([getAnswerKeyInstitution(answerKeyId), listAnswerKeyInstitutions()]);
  if (!entry) notFound();
  const { institution, fees } = entry;
  const index = all.findIndex((row) => row.id === answerKeyId);
  const nextUnconfirmed = [...all.slice(index + 1), ...all.slice(0, Math.max(index, 0))]
    .find((row) => row.status !== "confirmed" && row.id !== answerKeyId);
  const score = institution.score as (typeof institution.score & { missing?: string[]; extra?: string[] }) | null;

  return (
    <div className="space-y-5 pb-10">
      <datalist id="canonical-keys">
        {CANONICAL_KEYS.map((key) => <option key={key} value={key}>{getDisplayName(key)}</option>)}
      </datalist>

      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <Breadcrumbs items={[{ label: "Scoreboard", href: "/admin/scoreboard" }, { label: "Answer key", href: "/admin/answer-key" }, { label: institution.institution_name }]} />
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">{institution.institution_name}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            #{institution.institution_id} · {institution.state_code ?? "—"} · {institution.charter_type === "credit_union" ? "Credit union" : "Bank"}
            {institution.asset_size ? ` · $${Math.round(institution.asset_size / 1000).toLocaleString()}M assets` : ""}
            {" · "}
            <Link href={`/admin/institution/${institution.institution_id}`} className="text-[var(--brand-primary)]">pipeline view</Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {institution.status === "confirmed" ? (
            <form action={reopenAnswerKeyAction}>
              <input type="hidden" name="answer_key_id" value={answerKeyId} />
              <button type="submit" className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold dark:border-white/[0.08]">Reopen</button>
            </form>
          ) : null}
          <form action={confirmAnswerKeyAction}>
            <input type="hidden" name="answer_key_id" value={answerKeyId} />
            {nextUnconfirmed ? <input type="hidden" name="next_id" value={nextUnconfirmed.id} /> : null}
            <button type="submit" className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
              Confirm all{nextUnconfirmed ? " and next" : ""}
            </button>
          </form>
        </div>
      </header>

      {message ? (
        <p role="status" className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-200">{message}</p>
      ) : null}

      <section className="admin-card space-y-2 p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Fee document</h2>
          <span className="text-xs text-gray-500">
            {institution.status === "confirmed"
              ? `Confirmed by ${institution.confirmed_by ?? "—"} ${formatAdminDateTime(institution.confirmed_at)}`
              : `Prefilled${institution.prefill_source ? ` (${institution.prefill_source})` : ""}; not confirmed`}
          </span>
        </div>
        <form action={saveAnswerKeyDocumentAction} className="grid gap-2 md:grid-cols-[1fr_140px_200px_auto]">
          <input type="hidden" name="answer_key_id" value={answerKeyId} />
          <input name="document_url" defaultValue={institution.document_url} className={INPUT} aria-label="Document URL" />
          <select name="document_type" defaultValue={institution.document_type} className={INPUT} aria-label="Document type">
            {ANSWER_KEY_DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <input name="content_hash" defaultValue={institution.content_hash ?? ""} placeholder="content hash (optional)" className={`${INPUT} font-mono`} aria-label="Content hash" />
          <button type="submit" className="rounded border border-gray-200 px-2 py-1 text-xs font-semibold dark:border-white/[0.08]">Save document</button>
          <input name="notes" defaultValue={institution.notes ?? ""} placeholder="notes" className={`${INPUT} md:col-span-4`} aria-label="Notes" />
        </form>
        <a href={institution.document_url} target="_blank" rel="noreferrer" className="inline-block text-xs text-[var(--brand-primary)]">
          Open the document ↗
        </a>
      </section>

      {score ? (
        <section className="admin-card space-y-1 p-4 text-xs text-gray-600 dark:text-gray-300">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Latest score: precision {pct(score.precision)}, recall {pct(score.recall)}
          </h2>
          <p>
            {(["magellan", "rosetta", "knox", "darwin", "hamilton"] as const).map((stage) => {
              const result = score.stages?.[stage];
              const label = result?.right === true ? "right" : result?.right === false ? "wrong" : "n/a";
              const counts = result?.expected != null ? ` ${result.matched}/${result.expected}` : "";
              return <span key={stage} className="mr-3">{stage}: {label}{counts}</span>;
            })}
          </p>
          {score.missing?.length ? <p>Not published: {score.missing.join(", ")}</p> : null}
          {score.extra?.length ? <p>Published but not in the key: {score.extra.join(", ")}</p> : null}
        </section>
      ) : null}

      <section className="admin-card overflow-x-auto">
        <table className="w-full min-w-[900px] text-left">
          <thead className="text-[10px] uppercase tracking-wider text-gray-400">
            <tr>
              <th className="px-2 py-2">Category</th>
              <th className="px-2 py-2 text-right">Amount</th>
              <th className="px-2 py-2">Kind</th>
              <th className="px-2 py-2">Frequency</th>
              <th className="px-2 py-2">Conditions</th>
              <th className="px-2 py-2">Source line</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            {fees.map((fee) => <FeeRow key={fee.id} fee={fee} answerKeyId={answerKeyId} />)}
            <tr>
              <td className="px-2 py-1.5">
                <form id="fee-new" action={addAnswerKeyFeeAction}>
                  <input type="hidden" name="answer_key_id" value={answerKeyId} />
                </form>
                <input form="fee-new" name="canonical_key" list="canonical-keys" placeholder="add a fee…" className={INPUT} aria-label="New fee canonical key" />
              </td>
              <td className="px-2 py-1.5"><input form="fee-new" name="amount" inputMode="decimal" className={`${INPUT} text-right`} aria-label="New fee amount" /></td>
              <td className="px-2 py-1.5">
                <select form="fee-new" name="amount_kind" defaultValue="fixed" className={INPUT} aria-label="New fee amount kind">
                  {ANSWER_KEY_AMOUNT_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                </select>
              </td>
              <td className="px-2 py-1.5"><input form="fee-new" name="frequency" className={INPUT} aria-label="New fee frequency" /></td>
              <td className="px-2 py-1.5"><input form="fee-new" name="conditions" className={INPUT} aria-label="New fee conditions" /></td>
              <td className="px-2 py-1.5"><input form="fee-new" name="source_line" className={`${INPUT} font-mono`} aria-label="New fee source line" /></td>
              <td className="px-2 py-1.5">
                <button form="fee-new" type="submit" className="rounded border border-gray-200 px-2 py-1 text-xs font-semibold dark:border-white/[0.08]">Add</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <p className="text-xs text-gray-400">
        Amount kinds: fixed (must match within 1 cent), free ($0), varies (category only). Confirm saves the row and marks it checked by you; Confirm all marks the document and every row checked.
      </p>
    </div>
  );
}
