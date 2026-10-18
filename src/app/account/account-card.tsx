import type { ReactNode } from "react";

/** One section of the account page: a heading, an optional one-line note, then the body. */
export function AccountCard({
  id,
  title,
  note,
  action,
  compact = false,
  children,
}: {
  id: string;
  title: string;
  note?: ReactNode;
  action?: ReactNode;
  /** Side-column settings: a smaller heading and tighter padding. */
  compact?: boolean;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={`scroll-mt-24 rounded-xl border border-border bg-surface-0 shadow-sm ${compact ? "p-4" : "p-5"}`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={headingId}
            className={`${compact ? "text-[17px]" : "text-[19px]"} font-bold leading-tight text-ink`}
            style={{ fontFamily: "var(--fi-font-sans)" }}
          >
            {title}
          </h2>
          {note && <p className="mt-1 text-[13px] text-ink-muted">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
