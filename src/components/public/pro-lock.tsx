import { Lock } from "lucide-react";

/**
 * Marks a link to a page that is fully behind Fee Insight Pro, so a reader knows before
 * clicking. The visible "Pro" is backed by a fuller label for screen readers.
 */
export function ProLock({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded bg-[#FFF0ED] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#A93D25] ${className}`}
    >
      <Lock className="h-2.5 w-2.5" aria-hidden="true" />
      Pro
      <span className="sr-only"> (requires Fee Insight Pro)</span>
    </span>
  );
}
