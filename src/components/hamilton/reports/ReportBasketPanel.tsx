"use client";

import { removeFromBasket, type ReportBasketItem } from "@/lib/hamilton/report-basket";

const SOURCE_LABELS: Record<ReportBasketItem["source"], string> = {
  Position: "Position",
  Ask: "Ask",
  Test: "Test",
};

/**
 * The findings and tests a user added from Position, Ask and Test, shown on
 * the Report page with one action: build the board brief from them.
 */
export function ReportBasketPanel({ items, onBuild }: { items: ReportBasketItem[]; onBuild: () => void }) {
  return (
    <section
      aria-label="Your report basket"
      className="mb-10 rounded-xl border p-5"
      style={{
        borderColor: "var(--hamilton-primary)",
        backgroundColor: "var(--hamilton-surface-container-lowest, #ffffff)",
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-balance" style={{ color: "var(--hamilton-text-primary)" }}>
          {items.length === 1 ? "1 finding ready for your brief" : `${items.length} findings ready for your brief`}
        </h2>
        <button
          type="button"
          onClick={onBuild}
          className="burnished-cta px-5 py-2.5 rounded text-[10px] uppercase tracking-widest font-bold text-white"
        >
          Build the brief from these
        </button>
      </div>
      <ul className="mt-4 divide-y" style={{ borderColor: "var(--hamilton-border)" }}>
        {items.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-4 py-3" style={{ borderColor: "var(--hamilton-border)" }}>
            <div className="min-w-0">
              <span
                className="mr-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                style={{ backgroundColor: "var(--hamilton-accent-subtle)", color: "var(--hamilton-text-accent)" }}
              >
                {SOURCE_LABELS[item.source]}
              </span>
              <span className="text-sm text-pretty" style={{ color: "var(--hamilton-text-primary)" }}>
                {item.title}
              </span>
              {item.detail && (
                <p className="mt-1 line-clamp-2 text-xs text-pretty" style={{ color: "var(--hamilton-text-secondary)" }}>
                  {item.detail}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => removeFromBasket(item.id)}
              className="shrink-0 text-xs underline-offset-2 hover:underline"
              style={{ color: "var(--hamilton-text-tertiary)" }}
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
