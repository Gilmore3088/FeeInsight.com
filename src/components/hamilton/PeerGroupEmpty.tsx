import Link from "next/link";
import {
  choosePeerGroupHref,
  editPeerGroupHref,
  emptyPeerGroupMessage,
  type EmptyPeerGroup,
} from "@/lib/hamilton/peer-group-copy";

const ACTION =
  "inline-flex min-h-11 items-center rounded-md px-3.5 py-2 text-sm font-medium no-underline";
const PRIMARY = `${ACTION} bg-terra text-white hover:bg-terra-dark`;
const SECONDARY = `${ACTION} border border-warm-300 bg-warm-50 text-warm-800 hover:border-warm-500`;

/**
 * A saved peer group that matches no institutions: the empty result, said plainly, and the two
 * ways on. Nothing is computed against another group in its place.
 *
 * `onCompare` (client pages with a peer picker) moves the reader to that picker; otherwise
 * "Compare with another group" opens Settings' "Peer group for all charts". No database
 * imports, so server and client pages can both render it.
 */
export function PeerGroupEmpty({
  group,
  onCompare,
  compareHref,
}: {
  group: Pick<EmptyPeerGroup, "label" | "institutionId" | "institutionName" | "reason">;
  onCompare?: () => void;
  compareHref?: string;
}) {
  return (
    <div
      role="status"
      className="rounded-md border-l-2 border-terra bg-terra-soft px-3 py-3 text-sm leading-relaxed text-warm-800"
    >
      <p className="text-pretty break-words">{emptyPeerGroupMessage(group)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={editPeerGroupHref(group)} className={PRIMARY}>
          Edit this group
        </Link>
        {onCompare ? (
          <button type="button" onClick={onCompare} className={SECONDARY}>
            Compare with another group
          </button>
        ) : (
          <Link href={compareHref ?? choosePeerGroupHref(group)} className={SECONDARY}>
            Compare with another group
          </Link>
        )}
      </div>
    </div>
  );
}

/** The one context line under a saved group's results. Renders nothing without a line. */
export function PeerGroupLine({ line }: { line: string | null | undefined }) {
  if (!line) return null;
  return <p className="text-xs leading-relaxed text-warm-600 text-pretty break-words">{line}</p>;
}
