import type { ReactNode } from "react";

/**
 * The product window every homepage exhibit sits in (site v3 brief 06 §1.7): a title bar naming
 * the product and the exhibit drawn from the real brand components underneath. No browser dots
 * (James, Oct 16): the title says which product it is, the frame stays plain.
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
        <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{label}</span>
        {aside ? <span className="ml-auto flex shrink-0 items-center gap-2 text-[12px] text-ink-muted">{aside}</span> : null}
      </div>
      <div className={`relative ${bodyClassName}`}>{children}</div>
    </div>
  );
}
