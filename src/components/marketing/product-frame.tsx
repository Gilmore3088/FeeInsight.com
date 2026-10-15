import type { ReactNode } from "react";

/**
 * The product window every homepage exhibit sits in (site v3 brief 06 §1.7): a title bar,
 * a soft shadow and the exhibit drawn from the real brand components underneath. The
 * exhibit carries the point; the frame only says "this is the product".
 */
export function ProductFrame({
  label,
  aside,
  children,
  className,
  bodyClassName = "",
}: {
  label: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div
      className={[
        "fi-window relative min-w-0 overflow-hidden rounded-2xl border border-border bg-surface-0",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center gap-3 border-b border-border bg-paper/70 px-4 py-2.5">
        <span aria-hidden className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
        </span>
        <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{label}</span>
        {aside ? <span className="ml-auto flex shrink-0 items-center gap-2 text-[12px] text-ink-muted">{aside}</span> : null}
      </div>
      <div className={`relative ${bodyClassName}`}>{children}</div>
    </div>
  );
}
