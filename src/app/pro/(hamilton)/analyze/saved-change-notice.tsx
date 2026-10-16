import Link from "next/link";
import type { SavedOutputNotice } from "@/lib/saved-output-corrections";

/**
 * H03-T09: shown above a saved answer when this institution's fee data changed after it was
 * saved. The saved answer is left exactly as it was; the reader chooses whether to ask again.
 */
export function SavedChangeNotice({ notice, askAgainHref }: { notice: SavedOutputNotice; askAgainHref: string | null }) {
  return (
    <div
      role="note"
      className="mx-auto mb-6 max-w-5xl rounded-md border border-[var(--fi-control-border)] bg-[var(--fi-brick-tint)] px-4 py-3 text-sm text-[var(--fi-ink)]"
    >
      <p>{notice.text}</p>
      {askAgainHref && (
        <p className="mt-1">
          <Link className="font-medium text-[var(--fi-brick-ink)] underline" href={askAgainHref}>
            Ask again with current data
          </Link>
        </p>
      )}
    </div>
  );
}
