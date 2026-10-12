"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { holdFee, releaseFee } from "./actions";
import { MAX_HOLD_REASON, MIN_HOLD_REASON, type HeldFee } from "@/lib/fee-hold-rules";

function formatAmount(amount: number | null): string {
  if (amount === null) return "varies";
  return `$${amount.toFixed(2)}`;
}

const BUTTON =
  "rounded border border-gray-300 px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-50 " +
  "dark:border-white/[0.12] dark:text-gray-300 dark:hover:bg-white/[0.06]";

/** Hold one fee: a reason is required, and the fee leaves every customer-facing read. */
export function HoldFeeButton({
  feeId,
  feeName,
  amount,
  institutionName,
}: {
  feeId: number;
  feeName: string;
  amount: number | null;
  institutionName: string;
}) {
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setReason("");
    setError(null);
  }

  function submit() {
    if (reason.trim().length < MIN_HOLD_REASON) {
      setError(`Give a reason of at least ${MIN_HOLD_REASON} characters.`);
      return;
    }
    startTransition(async () => {
      const result = await holdFee(feeId, reason);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      close();
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className={BUTTON} onClick={() => setOpen(true)} aria-label={`Hold ${feeName}`}>
        Hold
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onKeyDown={(event) => event.key === "Escape" && !pending && close()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 text-left shadow-lg dark:border-white/[0.08] dark:bg-gray-900"
          >
            <h3 id={titleId} className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Hold this fee
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              {institutionName} · {feeName} · {formatAmount(amount)}
            </p>
            <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
              It leaves the public site, reports and Hamilton answers right away. Nothing is deleted, and
              it never shows as $0 or free. You can release it any time.
            </p>
            <label className="mt-4 block text-xs font-medium text-gray-700 dark:text-gray-300" htmlFor={`${titleId}-reason`}>
              Reason
            </label>
            <textarea
              id={`${titleId}-reason`}
              autoFocus
              value={reason}
              maxLength={MAX_HOLD_REASON}
              onChange={(event) => {
                setReason(event.target.value);
                setError(null);
              }}
              placeholder="Wrong category: escheat fee filed as a safe deposit box fee"
              className="mt-1 h-20 w-full rounded border border-gray-300 p-2 text-xs dark:border-white/[0.12] dark:bg-transparent"
            />
            {error && <p className="mt-1 text-xs text-red-600" role="alert">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={BUTTON} onClick={close} disabled={pending}>
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="rounded bg-gray-900 px-3 py-1 text-[11px] font-medium text-white hover:bg-gray-700 disabled:opacity-50 dark:bg-white dark:text-gray-900"
              >
                {pending ? "Holding…" : "Hold fee"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Fees on admin hold: out of every customer read, with who held them and why. */
export function HeldFeesTable({ fees, canRelease }: { fees: HeldFee[]; canRelease: boolean }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function release(feeId: number) {
    setPendingId(feeId);
    setError(null);
    startTransition(async () => {
      const result = await releaseFee(feeId);
      setPendingId(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="overflow-x-auto">
      {error && <p className="px-4 pt-2 text-xs text-red-600" role="alert">{error}</p>}
      <table className="admin-table w-full text-xs">
        <thead>
          <tr className="text-left">
            <th>Fee Name</th>
            <th className="text-right">Amount</th>
            <th>Held</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {fees.map((fee) => (
            <tr key={fee.feePublishedId} className="bg-amber-50/60 dark:bg-amber-900/10">
              <td className="font-medium text-amber-900 dark:text-amber-200">
                {fee.feeName}
                <p className="mt-0.5 text-[11px] font-normal text-amber-800/80 dark:text-amber-300/80">
                  {fee.canonicalFeeKey.replace(/_/g, " ")} · {fee.reason}
                  {fee.closedByCheck && " · Also taken down by a check; releasing keeps it down."}
                </p>
              </td>
              <td className="text-right tabular-nums text-amber-900 line-through dark:text-amber-200">
                {formatAmount(fee.amount)}
              </td>
              <td className="tabular-nums text-amber-800 dark:text-amber-300">
                {fee.heldBy ?? "Unknown"}, {fee.heldAt.slice(0, 16).replace("T", " ")} UTC
              </td>
              <td className="text-right">
                {canRelease && <button
                  type="button"
                  className={BUTTON}
                  disabled={pendingId === fee.feePublishedId}
                  onClick={() => release(fee.feePublishedId)}
                  aria-label={`Release ${fee.feeName}`}
                >
                  {pendingId === fee.feePublishedId ? "Releasing…" : "Release"}
                </button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
