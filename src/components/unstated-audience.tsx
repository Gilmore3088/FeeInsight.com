import Link from "next/link";
import { UNSTATED_AUDIENCE_FOOTNOTE } from "@/lib/fee-audience";

/**
 * The asterisk on a fee or benchmark that a row with no stated audience contributes to
 * (#1058). Screen readers hear the footnote, not "star".
 */
export function UnstatedAudienceMark({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span title={UNSTATED_AUDIENCE_FOOTNOTE}>
      <span aria-hidden="true">*</span>
      <span className="sr-only"> (audience not stated, treated as personal)</span>
    </span>
  );
}

/** The footnote the asterisk points to, with the methodology section that explains it. */
export function UnstatedAudienceFootnote({ show = true, className = "" }: { show?: boolean; className?: string }) {
  if (!show) return null;
  return (
    <p className={`text-[11px] leading-relaxed text-ink-muted ${className}`}>
      <span aria-hidden="true">* </span>
      {UNSTATED_AUDIENCE_FOOTNOTE}{" "}
      <Link href="/methodology#audience" className="font-medium text-ink underline underline-offset-2 hover:text-ink-soft">
        How audience is decided
      </Link>
    </p>
  );
}

/** True when a shown median rests on at least one row with no stated audience: the asterisk test. */
export function medianHasUnstatedAudience(
  summary: { median_amount?: number | null; unstated_audience_institution_count?: number } | null | undefined,
): boolean {
  return summary?.median_amount != null && hasUnstatedAudience(summary);
}

/** True when a benchmark rests on at least one row with no stated audience. */
export function hasUnstatedAudience(summary: { unstated_audience_institution_count?: number } | null | undefined): boolean {
  return (summary?.unstated_audience_institution_count ?? 0) > 0;
}
