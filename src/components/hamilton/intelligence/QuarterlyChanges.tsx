/**
 * What changed in the monthly briefing since last quarter (#1083): the `briefing-refresh` step
 * keeps one copy of each workspace's briefing a quarter, and this compares the two newest.
 * With one copy it says when the first comparison comes. Server component, no model call.
 */

import type { QuarterlyChanges as Changes } from "@/lib/hamilton/briefing-snapshots";
import { nextQuarter, quarterLabel } from "@/lib/hamilton/workspace/briefing-diff";
import { MemoSection, More } from "@/components/hamilton/memo/memo";

/** Changes shown before the rest fold under "More". */
const SHOWN = 6;

function ChangeList({ items }: { items: { text: string }[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, i) => (
        <li key={i} className="border-l-2 border-warm-200 pl-3 text-[15px] leading-relaxed text-warm-900">
          {item.text}
        </li>
      ))}
    </ul>
  );
}

export function QuarterlyChanges({ changes }: { changes: Changes | null }) {
  if (!changes) return null;
  if (changes.kind === "first") {
    return (
      <MemoSection title="Since last quarter">
        <p className="text-sm text-warm-700">
          Hamilton saved this briefing for {quarterLabel(changes.quarter)}. From {quarterLabel(nextQuarter(changes.quarter))}, this
          section lists what changed.
        </p>
      </MemoSection>
    );
  }
  const { diff } = changes;
  const from = quarterLabel(diff.fromQuarter);
  const to = quarterLabel(diff.toQuarter);
  if (diff.changes.length === 0) {
    return (
      <MemoSection title={`Since ${from}`} note={`Read against ${diff.peerLabel}.`}>
        <p className="text-sm text-warm-700">Nothing in this briefing changed between {from} and {to}.</p>
      </MemoSection>
    );
  }
  const rest = diff.changes.slice(SHOWN);
  return (
    <MemoSection title={`Since ${from}`} note={`${from} briefing compared with ${to}, both read against ${diff.peerLabel}.`}>
      <ChangeList items={diff.changes.slice(0, SHOWN)} />
      {rest.length > 0 ? (
        <More label={`${rest.length} more ${rest.length === 1 ? "change" : "changes"}`}>
          <ChangeList items={rest} />
        </More>
      ) : null}
    </MemoSection>
  );
}
