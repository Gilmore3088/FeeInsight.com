import type { ReportConfidence, ReportDecision, ReportExhibit, ReportSource } from "@/lib/hamilton/types";

const CONFIDENCE_STYLE: Record<ReportConfidence, { background: string; color: string }> = {
  High: { background: "var(--hamilton-accent-subtle)", color: "var(--hamilton-text-accent)" },
  Medium: { background: "var(--hamilton-surface-container-high)", color: "var(--hamilton-text-secondary)" },
  Low: { background: "var(--hamilton-error-container)", color: "var(--hamilton-on-error-container)" },
};

/** The answer page: one headline and the numbered decisions, each with its confidence. */
export function ReportAnswer({ headline, decisions, goal = null }: { headline: string; decisions: ReportDecision[]; goal?: string | null }) {
  return (
    <section aria-label="The answer" className="py-8 border-b" style={{ borderColor: "var(--hamilton-border)" }}>
      <div
        className="text-[11px] font-semibold uppercase tracking-wider mb-3"
        style={{ color: "var(--hamilton-text-accent)" }}
      >
        The answer{goal ? ` · Goal: ${goal}` : ""}
      </div>
      <p
        className="text-2xl leading-snug mb-6"
        style={{ fontFamily: "var(--hamilton-font-serif)", color: "var(--hamilton-text-primary)" }}
      >
        {headline}
      </p>
      <ol className="space-y-3">
        {decisions.map((decision, i) => (
          <li
            key={i}
            className="hamilton-card flex gap-4 p-4"
            style={{ backgroundColor: "var(--hamilton-surface-elevated)" }}
          >
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums"
              style={{ backgroundColor: "var(--hamilton-accent)", color: "var(--hamilton-on-primary)" }}
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-[15px] font-semibold leading-snug" style={{ color: "var(--hamilton-text-primary)" }}>
                  {decision.action}
                </p>
                {decision.confidence && (
                  <span
                    className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                    style={CONFIDENCE_STYLE[decision.confidence]}
                  >
                    {decision.confidence} confidence
                  </span>
                )}
              </div>
              {decision.why && (
                <p className="mt-1.5 text-[14px] leading-relaxed" style={{ color: "var(--hamilton-text-secondary)" }}>
                  {decision.why}
                </p>
              )}
              {decision.confidenceReason && (
                <p className="mt-1.5 text-[12px]" style={{ color: "var(--hamilton-text-tertiary)" }}>
                  {decision.confidenceReason}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A data exhibit: the title states the takeaway, the table carries the evidence. */
export function ReportExhibitTable({ exhibit, number }: { exhibit: ReportExhibit; number: number }) {
  return (
    <figure className="mb-8 last:mb-0">
      <figcaption className="mb-3">
        <div
          className="text-[11px] font-semibold uppercase tracking-wider mb-1"
          style={{ color: "var(--hamilton-text-tertiary)" }}
        >
          Exhibit {number}
        </div>
        <div
          className="text-[17px] font-semibold leading-snug"
          style={{ fontFamily: "var(--hamilton-font-serif)", color: "var(--hamilton-text-primary)" }}
        >
          {exhibit.title}
        </div>
        <div className="mt-1 text-[12px]" style={{ color: "var(--hamilton-text-secondary)" }}>
          {exhibit.subtitle}
        </div>
      </figcaption>
      <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--hamilton-border)" }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ backgroundColor: "var(--hamilton-surface-elevated)" }}>
              {exhibit.columns.map((column, i) => (
                <th
                  key={i}
                  scope="col"
                  className={`px-3 py-2 font-semibold ${i === 0 || i === exhibit.columns.length - 1 ? "text-left" : "text-right"}`}
                  style={{ color: "var(--hamilton-text-secondary)" }}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {exhibit.rows.map((row, r) => (
              <tr key={r} className="border-t" style={{ borderColor: "var(--hamilton-border)" }}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={`px-3 py-2 align-top ${c === 0 || c === row.length - 1 ? "text-left" : "text-right tabular-nums whitespace-nowrap"}`}
                    style={{
                      color: c === 1 ? "var(--hamilton-text-primary)" : "var(--hamilton-text-secondary)",
                      fontWeight: c === 0 || c === 1 ? 600 : 400,
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {exhibit.note && (
        <p className="mt-2 text-[12px]" style={{ color: "var(--hamilton-text-tertiary)" }}>
          {exhibit.note}
        </p>
      )}
    </figure>
  );
}

export function ReportSources({ sources }: { sources: ReportSource[] }) {
  return (
    <ul className="space-y-2">
      {sources.map((source, i) => (
        <li key={i} className="text-[13px] leading-relaxed" style={{ color: "var(--hamilton-text-secondary)" }}>
          <span className="font-semibold" style={{ color: "var(--hamilton-text-primary)" }}>
            {source.url ? (
              <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                {source.label}
              </a>
            ) : (
              source.label
            )}
          </span>
          {" "}· {source.detail}
        </li>
      ))}
    </ul>
  );
}
