"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  addToBasket,
  readBasket,
  removeFromBasket,
  subscribeToBasket,
  type ReportBasketItem,
} from "@/lib/hamilton/report-basket";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";

const SERVER_SNAPSHOT: ReportBasketItem[] = [];

export function useReportBasket(): ReportBasketItem[] {
  return useSyncExternalStore(subscribeToBasket, readBasket, () => SERVER_SNAPSHOT);
}

interface AddToReportButtonProps {
  item: Omit<ReportBasketItem, "addedAt">;
  /** "button" for a CTA row, "link" for an inline text action */
  variant?: "button" | "link";
}

/**
 * "Add to report": drops a finding or a test into the report basket the
 * Report page builds the board brief from. Once added it says so and links
 * to the report.
 */
export function AddToReportButton({ item, variant = "button" }: AddToReportButtonProps) {
  const basket = useReportBasket();
  const added = basket.some((existing) => existing.id === item.id);
  const reportHref = hrefWithInstitutionContext("/pro/reports?from=basket", item.institutionId);

  if (variant === "link") {
    return added ? (
      <span className="inline-flex items-center gap-2 text-xs" style={{ color: "var(--hamilton-text-secondary)" }}>
        <span aria-hidden="true">✓</span> In your report
        <button
          type="button"
          onClick={() => removeFromBasket(item.id)}
          className="underline-offset-2 hover:underline"
          style={{ color: "var(--hamilton-text-tertiary)" }}
        >
          Remove
        </button>
      </span>
    ) : (
      <button
        type="button"
        onClick={() => addToBasket(item)}
        className="text-xs font-semibold underline-offset-2 hover:underline"
        style={{ color: "var(--hamilton-primary)" }}
      >
        + Add to report
      </button>
    );
  }

  return added ? (
    <span
      className="inline-flex items-center gap-3 rounded px-4 py-2.5 text-[11px] font-semibold border"
      style={{
        borderColor: "var(--hamilton-primary)",
        color: "var(--hamilton-primary)",
        backgroundColor: "var(--hamilton-surface-container-lowest, #ffffff)",
      }}
    >
      <span aria-hidden="true">✓</span> Added to report
      <Link href={reportHref} className="underline underline-offset-2" style={{ color: "var(--hamilton-primary)" }}>
        Open report ({basket.length})
      </Link>
    </span>
  ) : (
    <button
      type="button"
      onClick={() => addToBasket(item)}
      className="px-5 py-2.5 rounded text-[10px] uppercase tracking-widest font-bold border transition-colors hover:border-[color:var(--hamilton-primary)] hover:text-[color:var(--hamilton-primary)]"
      style={{
        borderColor: "var(--hamilton-outline-variant, #d8c2b8)",
        backgroundColor: "var(--hamilton-surface-container-lowest, #ffffff)",
        color: "var(--hamilton-text-secondary)",
      }}
    >
      + Add to report
    </button>
  );
}
