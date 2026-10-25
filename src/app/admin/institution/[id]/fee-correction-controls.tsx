"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { correctFee, dismissConflict, reverseCorrection } from "./actions";
import {
  CORRECTION_CATEGORIES,
  CORRECTION_FREQUENCIES,
  MAX_CONDITIONS,
  MAX_CORRECTION_REASON,
  MAX_EXCERPT,
  MAX_LOCATION,
  categoryLabel,
  type FeeCorrectionConflict,
  type FeeCorrectionVersion,
  type FeeValues,
} from "@/lib/fee-correction-rules";
import { FEE_ERROR_CAUSES, FEE_ERROR_CAUSE_LABELS, suggestCorrectionCause, type FeeErrorCause } from "@/lib/fee-error-cause";

export interface CorrectableFee {
  id: number;
  feeName: string;
  amount: number | null;
  category: string | null;
  frequency: string | null;
  conditions: string | null;
  sourceUrl: string | null;
  sourceDocumentId: number | null;
}

export interface SourceDocumentOption {
  id: number;
  url: string | null;
  crawledAt: string;
}

const BUTTON =
  "rounded border border-gray-300 px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-50 " +
  "dark:border-white/[0.12] dark:text-gray-300 dark:hover:bg-white/[0.06]";
const PRIMARY =
  "rounded bg-gray-900 px-3 py-1 text-[11px] font-medium text-white hover:bg-gray-700 disabled:opacity-50 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:bg-white dark:text-gray-900";
const INPUT = "mt-1 w-full rounded border border-gray-300 p-1.5 text-xs dark:border-white/[0.12] dark:bg-transparent";
const LABEL = "mt-3 block text-xs font-medium text-gray-700 dark:text-gray-300";

function money(amount: number | null): string {
  return amount == null ? "varies" : `$${amount.toFixed(2)}`;
}

function frequencyLabel(frequency: string | null): string {
  return frequency ? frequency.replace(/_/g, " ") : "not stated";
}

function newKey(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return random.replace(/[^A-Za-z0-9_-]/g, "");
}

function documentLabel(doc: SourceDocumentOption): string {
  return `#${doc.id} · ${doc.crawledAt}${doc.url ? ` · ${doc.url.replace(/^https?:\/\//, "").slice(0, 60)}` : ""}`;
}

function initialForm(f: CorrectableFee) {
  return {
    canonicalFeeKey: f.category ?? "",
    feeName: f.feeName,
    amount: f.amount == null ? "" : f.amount.toFixed(2),
    frequency: f.frequency ?? "",
    conditions: f.conditions ?? "",
    sourceDocumentId: f.sourceDocumentId == null ? "" : String(f.sourceDocumentId),
    sourceExcerpt: "",
    sourceLocation: "",
    reason: "",
    /** Empty until the operator picks one; until then the form shows the suggested cause. */
    cause: "",
  };
}

type CorrectionForm = ReturnType<typeof initialForm>;

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-0.5 text-[11px] text-red-600" role="alert">{message}</p> : null;
}

function Dialog({ titleId, children, onEscape }: { titleId: string; children: React.ReactNode; onEscape: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onKeyDown={(event) => event.key === "Escape" && onEscape()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-gray-200 bg-white p-5 text-left shadow-lg dark:border-white/[0.08] dark:bg-gray-900"
      >
        {children}
      </div>
    </div>
  );
}

function BeforeAfter({ before, after }: { before: FeeValues; after: FeeValues }) {
  const rows: Array<[string, string, string]> = [
    ["Fee type", categoryLabel(before.canonicalFeeKey), categoryLabel(after.canonicalFeeKey)],
    ["Name", before.feeName, after.feeName],
    ["Amount", money(before.amount), money(after.amount)],
    ["Frequency", frequencyLabel(before.frequency), frequencyLabel(after.frequency)],
    ["Conditions", before.conditions || "none", after.conditions || "none"],
  ];
  return (
    <table className="admin-table mt-3 w-full text-xs">
      <thead>
        <tr className="text-left">
          <th></th>
          <th>Live now</th>
          <th>After</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, from, to]) => (
          <tr key={label}>
            <td className="text-gray-500">{label}</td>
            <td className={from !== to ? "text-gray-500 line-through" : ""}>{from}</td>
            <td className={from !== to ? "font-medium text-gray-900 dark:text-gray-100" : ""}>{to}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Correct one live fee (admin only): the current value and its source beside the form, then a
 * before/after review before anything is saved. The server checks every field again and checks the
 * new value against the document's stored text.
 */
export function CorrectFeeButton({
  fee,
  expectedVersion,
  institutionName,
  documents,
}: {
  fee: CorrectableFee;
  expectedVersion: number;
  institutionName: string;
  documents: SourceDocumentOption[];
}) {
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [key, setKey] = useState("");
  const [form, setForm] = useState(() => initialForm(fee));
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function start() {
    setForm(initialForm(fee));
    setKey(newKey());
    setStep("edit");
    setErrors({});
    setError(null);
    setOpen(true);
  }

  function close() {
    if (pending) return;
    setOpen(false);
  }

  function set(field: keyof CorrectionForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setError(null);
  }

  const before: FeeValues = {
    canonicalFeeKey: fee.category ?? "",
    feeName: fee.feeName,
    amount: fee.amount,
    frequency: fee.frequency,
    conditions: fee.conditions,
  };
  const parsedAmount = Number(form.amount.replace(/[$,\s]/g, ""));
  const after: FeeValues = {
    canonicalFeeKey: form.canonicalFeeKey,
    feeName: form.feeName.trim(),
    amount: Number.isFinite(parsedAmount) && form.amount.trim() !== "" ? parsedAmount : null,
    frequency: form.frequency || null,
    conditions: form.conditions.trim() || null,
  };

  const suggestedCause = suggestCorrectionCause({
    liveSourceDocumentId: fee.sourceDocumentId,
    sourceDocumentId: form.sourceDocumentId ? Number(form.sourceDocumentId) : null,
    beforeCategory: before.canonicalFeeKey || null,
    afterCategory: after.canonicalFeeKey || null,
    beforeAmount: before.amount,
    afterAmount: after.amount,
  });
  const cause: FeeErrorCause = (form.cause as FeeErrorCause) || suggestedCause;

  function review() {
    const missing: Partial<Record<string, string>> = {};
    if (!form.sourceDocumentId) missing.sourceDocumentId = "Choose the source document.";
    if (form.sourceExcerpt.trim().length === 0) missing.sourceExcerpt = "Paste the schedule's own words for this fee.";
    if (form.sourceLocation.trim().length === 0) missing.sourceLocation = "Say where it sits in the document.";
    if (form.reason.trim().length === 0) missing.reason = "Give a reason.";
    if (after.amount == null) missing.amount = "Give the amount.";
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return;
    }
    setStep("review");
  }

  function submit() {
    startTransition(async () => {
      const result = await correctFee({ ...form, cause, feePublishedId: fee.id, expectedVersion, idempotencyKey: key });
      if (!result.ok) {
        setError(result.error);
        if (result.errors) {
          setErrors(result.errors);
          setStep("edit");
        }
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className={BUTTON} onClick={start} aria-label={`Correct ${fee.feeName}`}>
        Correct
      </button>
      {open && (
        <Dialog titleId={titleId} onEscape={close}>
          <h3 id={titleId} className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {step === "edit" ? "Correct this fee" : "Check the change"}
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            {institutionName} · live now: {fee.feeName} · {money(fee.amount)} · {frequencyLabel(fee.frequency)}
            {fee.sourceUrl && (
              <>
                {" · "}
                <a href={fee.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">
                  source
                </a>
              </>
            )}
          </p>
          {step === "edit" ? (
            <div>
              <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
                The corrected value replaces this one everywhere right away, as a new version. The current value is kept
                in the history and can be restored. The new value must be stated in the source document you choose.
              </p>
              <label className={LABEL} htmlFor={`${titleId}-category`}>Fee type</label>
              <select id={`${titleId}-category`} className={INPUT} value={form.canonicalFeeKey} onChange={(e) => set("canonicalFeeKey", e.target.value)}>
                <option value="">Choose…</option>
                {CORRECTION_CATEGORIES.map((key) => (
                  <option key={key} value={key}>{categoryLabel(key)}</option>
                ))}
              </select>
              <FieldError message={errors.canonicalFeeKey} />
              <label className={LABEL} htmlFor={`${titleId}-name`}>Name, as the schedule prints it</label>
              <input id={`${titleId}-name`} className={INPUT} value={form.feeName} onChange={(e) => set("feeName", e.target.value)} />
              <FieldError message={errors.feeName} />
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className={LABEL} htmlFor={`${titleId}-amount`}>Amount ($)</label>
                  <input id={`${titleId}-amount`} inputMode="decimal" className={INPUT} value={form.amount} onChange={(e) => set("amount", e.target.value)} />
                  <FieldError message={errors.amount} />
                </div>
                <div className="flex-1">
                  <label className={LABEL} htmlFor={`${titleId}-frequency`}>Frequency</label>
                  <select id={`${titleId}-frequency`} className={INPUT} value={form.frequency} onChange={(e) => set("frequency", e.target.value)}>
                    <option value="">Not stated</option>
                    {CORRECTION_FREQUENCIES.map((value) => (
                      <option key={value} value={value}>{frequencyLabel(value)}</option>
                    ))}
                  </select>
                  <FieldError message={errors.frequency} />
                </div>
              </div>
              <label className={LABEL} htmlFor={`${titleId}-conditions`}>Conditions (optional)</label>
              <textarea id={`${titleId}-conditions`} maxLength={MAX_CONDITIONS} className={`${INPUT} h-14`} value={form.conditions} onChange={(e) => set("conditions", e.target.value)} />
              <FieldError message={errors.conditions} />
              <label className={LABEL} htmlFor={`${titleId}-doc`}>Source document</label>
              <select id={`${titleId}-doc`} className={INPUT} value={form.sourceDocumentId} onChange={(e) => set("sourceDocumentId", e.target.value)}>
                <option value="">Choose…</option>
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>{documentLabel(doc)}</option>
                ))}
              </select>
              <FieldError message={errors.sourceDocumentId} />
              <label className={LABEL} htmlFor={`${titleId}-excerpt`}>Excerpt from the document</label>
              <textarea
                id={`${titleId}-excerpt`}
                maxLength={MAX_EXCERPT}
                className={`${INPUT} h-16`}
                placeholder="Returned Item Fee | $30.00 per item"
                value={form.sourceExcerpt}
                onChange={(e) => set("sourceExcerpt", e.target.value)}
              />
              <FieldError message={errors.sourceExcerpt} />
              <label className={LABEL} htmlFor={`${titleId}-location`}>Where it sits</label>
              <input
                id={`${titleId}-location`}
                maxLength={MAX_LOCATION}
                className={INPUT}
                placeholder="Page 2, Business Accounts table, row 4"
                value={form.sourceLocation}
                onChange={(e) => set("sourceLocation", e.target.value)}
              />
              <FieldError message={errors.sourceLocation} />
              <label className={LABEL} htmlFor={`${titleId}-reason`}>Reason</label>
              <textarea
                id={`${titleId}-reason`}
                maxLength={MAX_CORRECTION_REASON}
                className={`${INPUT} h-14`}
                placeholder="Amount read from the consumer column; the business fee is $30"
                value={form.reason}
                onChange={(e) => set("reason", e.target.value)}
              />
              <FieldError message={errors.reason} />
              <label className={LABEL} htmlFor={`${titleId}-cause`}>What went wrong</label>
              <select id={`${titleId}-cause`} className={INPUT} value={cause} onChange={(e) => set("cause", e.target.value)}>
                {FEE_ERROR_CAUSES.map((value) => (
                  <option key={value} value={value}>{FEE_ERROR_CAUSE_LABELS[value]}</option>
                ))}
              </select>
              <p className="mt-0.5 text-[11px] text-gray-500">
                {form.cause ? "" : "Suggested from what you changed. "}This sends the error back to the step that made it, so that step learns from it.
              </p>
              <FieldError message={errors.cause} />
              {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className={BUTTON} onClick={close}>Cancel</button>
                <button type="button" className={PRIMARY} onClick={review}>Review change</button>
              </div>
            </div>
          ) : (
            <div>
              <BeforeAfter before={before} after={after} />
              <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
                Source: document #{form.sourceDocumentId}, {form.sourceLocation}
              </p>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">What went wrong: {FEE_ERROR_CAUSE_LABELS[cause]}</p>
              <blockquote className="mt-1 border-l-2 border-gray-300 pl-2 text-xs text-gray-700 dark:border-white/[0.2] dark:text-gray-300">
                {form.sourceExcerpt}
              </blockquote>
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">Reason: {form.reason}</p>
              {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className={BUTTON} onClick={() => setStep("edit")} disabled={pending}>Back</button>
                <button type="button" className={BUTTON} onClick={close} disabled={pending}>Cancel</button>
                <button type="button" className={PRIMARY} onClick={submit} disabled={pending}>
                  {pending ? "Publishing…" : "Publish correction"}
                </button>
              </div>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

function ReverseButton({ version }: { version: FeeCorrectionVersion }) {
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await reverseCorrection({
        feePublishedId: version.feePublishedId,
        expectedVersion: version.version,
        idempotencyKey: key,
        reason,
      });
      if (!result.ok) {
        setError(result.errors?.reason ?? result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        className={BUTTON}
        onClick={() => { setKey(newKey()); setReason(""); setError(null); setOpen(true); }}
        aria-label={`Reverse correction of ${version.after.feeName}`}
      >
        Reverse
      </button>
      {open && (
        <Dialog titleId={titleId} onEscape={() => !pending && setOpen(false)}>
          <h3 id={titleId} className="text-sm font-semibold text-gray-900 dark:text-gray-100">Reverse this correction</h3>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            This publishes the earlier value again as a new version. Nothing is deleted.
          </p>
          <BeforeAfter before={version.after} after={version.before} />
          <label className={LABEL} htmlFor={`${titleId}-reason`}>Reason</label>
          <textarea
            id={`${titleId}-reason`}
            autoFocus
            maxLength={MAX_CORRECTION_REASON}
            className={`${INPUT} h-14`}
            value={reason}
            onChange={(e) => { setReason(e.target.value); setError(null); }}
          />
          {error && <p className="mt-1 text-xs text-red-600" role="alert">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={BUTTON} onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
            <button type="button" className={PRIMARY} onClick={submit} disabled={pending}>
              {pending ? "Reversing…" : "Reverse correction"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function DismissConflictButton({ conflict }: { conflict: FeeCorrectionConflict }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = useId();

  function submit() {
    startTransition(async () => {
      const result = await dismissConflict(conflict.id, reason);
      if (!result.ok) {
        setError(result.error ?? "Could not dismiss.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return <button type="button" className={BUTTON} onClick={() => setOpen(true)}>Dismiss</button>;
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <label htmlFor={inputId} className="sr-only">Why the newer value is wrong</label>
      <input
        id={inputId}
        autoFocus
        className="w-48 rounded border border-gray-300 p-1 text-[11px] dark:border-white/[0.12] dark:bg-transparent"
        placeholder="Why the newer value is wrong"
        value={reason}
        onChange={(e) => { setReason(e.target.value); setError(null); }}
      />
      {error && <p className="text-[11px] text-red-600" role="alert">{error}</p>}
      <div className="flex gap-1">
        <button type="button" className={BUTTON} onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
        <button type="button" className={BUTTON} onClick={submit} disabled={pending}>{pending ? "Saving…" : "Dismiss"}</button>
      </div>
    </div>
  );
}

/** Correction history (every version) and newer-source conflicts waiting for an admin. */
export function CorrectionsPanel({
  history,
  conflicts,
  canCorrect,
}: {
  history: FeeCorrectionVersion[];
  conflicts: FeeCorrectionConflict[];
  canCorrect: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      {conflicts.length > 0 && (
        <div className="border-b border-gray-100 px-4 py-2 dark:border-white/[0.04]">
          <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
            A newer source disagrees ({conflicts.length}). Nothing was published from it. To accept it, correct the
            fee from that document; or dismiss it with a reason.
          </p>
          <table className="admin-table mt-1 w-full text-xs">
            <thead>
              <tr className="text-left">
                <th>Corrected value</th>
                <th>Newer source says</th>
                <th>Found</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((conflict) => (
                <tr key={conflict.id}>
                  <td>{conflict.current.feeName} · {money(conflict.current.amount)}</td>
                  <td className="font-medium">
                    {conflict.feeName} · {money(conflict.amount)}
                    <p className="text-[11px] font-normal text-gray-500">document #{conflict.sourceDocumentId ?? "unknown"} · {categoryLabel(conflict.canonicalFeeKey)}</p>
                  </td>
                  <td className="tabular-nums text-gray-500">{conflict.createdAt.slice(0, 16).replace("T", " ")} UTC</td>
                  <td className="text-right">{canCorrect && <DismissConflictButton conflict={conflict} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {history.length > 0 && (
        <table className="admin-table w-full text-xs">
          <thead>
            <tr className="text-left">
              <th>Fee</th>
              <th>Change</th>
              <th>Evidence and reason</th>
              <th>By</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {history.map((version) => (
              <tr key={version.id} className={version.status === "superseded" ? "text-gray-400" : ""}>
                <td className="font-medium">
                  {version.after.feeName}
                  <p className="text-[11px] font-normal text-gray-500">
                    v{version.version} · {version.action === "reverse" ? "reversal" : "correction"} · {version.status}
                  </p>
                </td>
                <td className="tabular-nums">
                  {money(version.before.amount)} {categoryLabel(version.before.canonicalFeeKey)} → {money(version.after.amount)}{" "}
                  {categoryLabel(version.after.canonicalFeeKey)}
                </td>
                <td className="max-w-xs">
                  {version.sourceExcerpt && <span className="italic">“{version.sourceExcerpt}”</span>}
                  {version.sourceLocation && <span> · {version.sourceLocation}</span>}
                  {version.sourceDocumentId != null && <span> · document #{version.sourceDocumentId}</span>}
                  <p className="text-[11px] text-gray-500">{version.reason}</p>
                </td>
                <td className="tabular-nums text-gray-500">
                  {version.actorName}, {version.createdAt.slice(0, 16).replace("T", " ")} UTC
                  {version.agentRunId != null && <p className="text-[11px]">run #{version.agentRunId}</p>}
                </td>
                <td className="text-right">
                  {canCorrect && version.status === "current" && <ReverseButton version={version} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
