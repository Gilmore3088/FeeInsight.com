import type { ReactNode } from "react";
import { formatWireDate } from "@/lib/regulatory/wire";
import {
  ACTION_TYPE_LABELS,
  type RelatedItem,
  type ResearchNote,
  type TimelineEntry,
} from "@/lib/regulatory/wire-research";

/**
 * The research panel under a wire item: a native <details>, so it opens without client
 * JavaScript. It keeps three things apart, each labelled:
 *  - what an AI model wrote from the source text (the summary and the type of action),
 *  - what the source itself states (dates, each checked against the source text in code),
 *  - one sentence of interpretation, never a requirement.
 * Related items and a bill's timeline are deterministic (no model). The source document is
 * always the authority, and the panel says so.
 */

const KIND_LABEL: Record<RelatedItem["kind"], string> = {
  release: "Release",
  rule: "Federal Register",
  bill: "Bill",
  press: "Press",
};

function day(value: string | null, now: Date): string | null {
  return formatWireDate(value, now)?.absolute ?? null;
}

function MiniLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-600" style={{ fontFamily: "var(--hamilton-font-sans)" }}>
      {children}
    </p>
  );
}

function RelatedList({ items, now }: { items: RelatedItem[]; now: Date }) {
  return (
    <ul className="mt-1.5 space-y-2">
      {items.map((item) => {
        const when = day(item.date, now);
        const official = item.kind !== "press";
        const title = (
          <span className={`text-[13px] leading-snug ${official ? "text-warm-900" : "text-warm-700"}`}>{item.title}</span>
        );
        return (
          <li key={`${item.kind}:${item.key}`} className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px]">
              <span
                className={`rounded px-1 py-px font-bold uppercase tracking-wider ${
                  official ? "bg-warm-800 text-white" : "border border-dashed border-warm-500 text-warm-700"
                }`}
              >
                {KIND_LABEL[item.kind]}
              </span>
              {item.source ? <span className="font-semibold text-warm-700">{item.source}</span> : null}
              {when ? <span className="text-warm-600">{when}</span> : null}
            </span>
            <span className="mt-0.5 block break-words">
              {item.url && /^https?:\/\//i.test(item.url) ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="underline decoration-warm-300 underline-offset-2 hover:text-[#A93D25]">
                  {title}
                </a>
              ) : (
                title
              )}
            </span>
            <span className="block text-[11px] text-warm-600">{item.reason}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Timeline({ entries, now }: { entries: TimelineEntry[]; now: Date }) {
  return (
    <ol className="mt-1.5 space-y-1.5 border-l-2 border-warm-200 pl-3">
      {entries.map((entry, i) => (
        <li key={`${entry.label}-${i}`} className="relative text-[12px] leading-snug">
          <span
            aria-hidden="true"
            className={`absolute -left-[17px] top-[5px] h-2 w-2 rounded-full ${entry.current ? "bg-[#C44B2E]" : "bg-warm-400"}`}
          />
          <span className={entry.current ? "font-semibold text-warm-900" : "text-warm-700"}>{entry.label}</span>
          <span className="text-warm-600"> · {day(entry.date, now) ?? "date not recorded"}</span>
          {entry.current ? <span className="text-warm-600"> (latest recorded action)</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function ResearchPanel({
  note,
  related,
  timeline,
  press = false,
  example = false,
  now,
  open = false,
}: {
  note: ResearchNote | null;
  related: RelatedItem[];
  /** Bills: the dated steps stored for the bill. */
  timeline?: TimelineEntry[];
  /** Press stories are never summarised; their panel shows only what they are linked to. */
  press?: boolean;
  /** Preview only: the note was written by hand, not by the model. Never set from data. */
  example?: boolean;
  now: Date;
  /** Preview only: render the panel open. */
  open?: boolean;
}) {
  const hasTimeline = Boolean(timeline && timeline.length > 0);
  if (press && related.length === 0) return null;
  if (!note && related.length === 0 && !hasTimeline) return null;

  const ok = note?.status === "ok" && Boolean(note.summary);
  const deadline = ok ? day(note!.commentDeadline, now) : null;
  const effective = ok ? day(note!.effectiveDate, now) : null;
  const written = note?.createdAt ? day(note.createdAt, now) : null;
  const ex = example ? "EXAMPLE · " : "";

  const teaser: string[] = [];
  if (ok) teaser.push(example ? "Example summary" : "AI summary");
  if (deadline) teaser.push(`Comment deadline ${deadline}`);
  else if (effective) teaser.push(`Effective ${effective}`);
  if (related.length > 0) teaser.push(`${related.length} related`);
  if (hasTimeline && !ok) teaser.push("Timeline");

  return (
    <details open={open || undefined} className="group mt-0.5 border-t border-dashed border-warm-200">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-2 text-[11px] text-warm-600 marker:hidden hover:text-warm-900 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block text-[9px] text-[#A93D25] transition-transform group-open:rotate-90">
          ▶
        </span>
        <span className="font-semibold uppercase tracking-[0.08em] text-warm-700">Research</span>
        {teaser.length > 0 ? <span className="min-w-0 truncate">{teaser.join(" · ")}</span> : null}
      </summary>

      <div className="space-y-3.5 pb-3.5 pl-0 sm:pl-4">
        {press ? null : ok ? (
          <section aria-label="AI summary" className="rounded-lg border border-warm-200 bg-warm-100/60 px-3 py-2.5">
            <MiniLabel>{ex}AI summary of the source text</MiniLabel>
            <p className="mt-1 text-[13px] leading-relaxed text-warm-900">{note!.summary}</p>
            {note!.actionType ? (
              <p className="mt-1.5 text-[12px] text-warm-700">
                <span className="text-warm-600">Type of action:</span>{" "}
                <span className="font-semibold">{ACTION_TYPE_LABELS[note!.actionType]}</span>
              </p>
            ) : null}
            <p className="mt-1.5 text-[10px] leading-relaxed text-warm-600">
              {example
                ? "Written by hand for this preview from the headline only. Not model output."
                : `Written by an AI model (${note!.model ?? "model not recorded"}) from the page's own text${written ? ` on ${written}` : ""}. It can be wrong; the source document is what counts.`}
            </p>
          </section>
        ) : note && note.status !== "ok" ? (
          <p className="text-[12px] text-warm-600">
            {note.status === "source_unreadable"
              ? "No summary: the source page could not be read as text (a PDF, a blocked page or an empty page)."
              : "No summary: the model's answer did not pass the checks, so nothing was kept."}
          </p>
        ) : (
          <p className="text-[12px] text-warm-600">Summary not written yet.</p>
        )}

        {deadline || effective ? (
          <section aria-label="Dates stated in the source">
            <MiniLabel>{ex}Dates stated in the source</MiniLabel>
            <p className="mt-1 flex flex-wrap gap-1.5">
              {deadline ? (
                <span className="rounded border border-[#C44B2E]/40 bg-white px-2 py-0.5 text-[12px] font-semibold text-[#A93D25] [font-variant-numeric:tabular-nums]">
                  Comment deadline {deadline}
                </span>
              ) : null}
              {effective ? (
                <span className="rounded border border-warm-300 bg-white px-2 py-0.5 text-[12px] font-semibold text-warm-900 [font-variant-numeric:tabular-nums]">
                  Effective {effective}
                </span>
              ) : null}
            </p>
            <p className="mt-1 text-[10px] text-warm-600">
              {example ? "From the headline itself." : "Each date was checked against the source text; a date the text does not state is never shown."}
            </p>
          </section>
        ) : null}

        {ok && note!.whyItMatters ? (
          <section aria-label="Why it may matter" className="border-l-2 border-[#C44B2E]/50 pl-3">
            <MiniLabel>{ex}Why it may matter (interpretation, not a requirement)</MiniLabel>
            <p className="mt-1 text-[13px] italic leading-relaxed text-warm-700">{note!.whyItMatters}</p>
          </section>
        ) : null}

        {hasTimeline ? (
          <section aria-label="Bill timeline">
            <MiniLabel>Bill timeline</MiniLabel>
            <Timeline entries={timeline!} now={now} />
            <p className="mt-1 text-[10px] text-warm-600">From Open States: the introduction and the latest action are the dated steps stored.</p>
          </section>
        ) : null}

        {related.length > 0 ? (
          <section aria-label="Related">
            <MiniLabel>{press ? "The bill this story covers" : "Related developments"}</MiniLabel>
            <RelatedList items={related} now={now} />
            <p className="mt-1 text-[10px] text-warm-600">Linked by a shared docket, rule name, institution or bill number, not by AI.</p>
          </section>
        ) : null}

        {note?.sourceUrl && /^https?:\/\//i.test(note.sourceUrl) ? (
          <p className="text-[11px]">
            <a href={note.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#A93D25] underline-offset-2 hover:underline">
              Read the source document ↗
            </a>
            <span className="text-warm-600"> · the official text is the requirement; this panel is not legal advice.</span>
          </p>
        ) : null}
      </div>
    </details>
  );
}
