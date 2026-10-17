import Link from "next/link";
import type { SavedOutputNotice } from "@/lib/saved-output-corrections";

/**
 * H03-T09: shown above a saved answer or report when fee data it used changed after it was
 * saved. The saved output is left exactly as it was; the reader chooses whether to make a new one.
 */
export function SavedChangeNotice({
  notice,
  askAgainHref,
  actionLabel = "Ask again with current data",
}: {
  notice: SavedOutputNotice;
  askAgainHref: string | null;
  actionLabel?: string;
}) {
  return (
    <div
      role="note"
      className="mx-auto mb-6 max-w-5xl rounded-md border border-[var(--fi-control-border)] bg-[var(--fi-brick-tint)] px-4 py-3 text-sm text-[var(--fi-ink)]"
    >
      <p>{notice.text}</p>
      {askAgainHref && (
        <p className="mt-1">
          <Link className="font-medium text-[var(--fi-brick-ink)] underline" href={askAgainHref}>
            {actionLabel}
          </Link>
        </p>
      )}
    </div>
  );
}
