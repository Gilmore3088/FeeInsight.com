"use client";

import { removeFromBasket, type ReportBasketItem } from "@/lib/hamilton/report-basket";
import { SERIF } from "@/components/hamilton/memo/memo";

const SOURCE_LABELS: Record<ReportBasketItem["source"], string> = {
  Position: "Position",
  Ask: "Ask",
  Test: "Test",
};

/**
 * The findings and tests a user added from Position, Ask and Test, shown on
 * the Report page with one action: write the board report from them.
 */
export function ReportBasketPanel({ items, onBuild }: { items: ReportBasketItem[]; onBuild: () => void }) {
  return (
    <section aria-label="Findings saved for your report" className="rounded-lg border border-warm-300 bg-warm-50 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl text-warm-900" style={SERIF}>
          {items.length === 1 ? "1 finding saved for your report" : `${items.length} findings saved for your report`}
        </h2>
        <button
          type="button"
          onClick={onBuild}
          className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark"
        >
          Write the report from these
        </button>
      </div>
      <ul className="mt-3 divide-y divide-warm-200">
        {items.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm text-pretty text-warm-900">{item.title}</p>
              {item.detail && <p className="mt-1 line-clamp-2 text-xs text-pretty text-warm-700">{item.detail}</p>}
              <p className="mt-1 text-xs text-warm-600">From {SOURCE_LABELS[item.source]}</p>
            </div>
            <button
              type="button"
              onClick={() => removeFromBasket(item.id)}
              className="shrink-0 text-xs text-warm-600 underline-offset-2 hover:text-warm-900 hover:underline"
              aria-label={`Remove ${item.title} from the report`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
