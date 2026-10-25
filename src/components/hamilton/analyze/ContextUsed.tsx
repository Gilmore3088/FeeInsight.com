import type { AskContextUsed } from "@/lib/hamilton/workspace/types";
import { contextRows } from "@/lib/hamilton/workspace/workbench";

/**
 * The context an answer used (#1895): institution, peers and fee, each with where it came from.
 * It sits on the answer so the reader sees what Hamilton took as given; follow-ups keep it.
 */
export function ContextUsed({ context }: { context: AskContextUsed }) {
  const rows = contextRows(context);
  return (
    <section aria-label="Context this answer used" className="rounded-lg border border-warm-300 bg-warm-50 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-warm-600">Context used</p>
      <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="min-w-0">
            <dt className="text-xs text-warm-600">{row.label}</dt>
            <dd className="text-sm font-medium text-warm-900">{row.value}</dd>
            {row.note ? <dd className="text-xs text-warm-600">{row.note}</dd> : null}
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-warm-600">Follow-ups keep this context. To research another institution, change it in Settings.</p>
    </section>
  );
}
