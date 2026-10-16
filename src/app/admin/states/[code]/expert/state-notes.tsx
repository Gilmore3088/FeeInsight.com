import type { StateExpertNote } from "@/lib/data-store/state-expert-notes";

const KIND_LABELS: Record<string, string> = {
  document_type: "Document types",
  state_fee_rule: "State fee rule",
};

/** The expert's dated notes, newest first (the order the reader returns them in). */
export function StateNotes({ notes }: { notes: StateExpertNote[] }) {
  if (notes.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        No notes yet. The state-expert step adds one when it learns which documents are common here or finds a signed state fee bill.
      </p>
    );
  }
  return (
    <ol className="space-y-2 text-sm">
      {notes.map((note) => (
        <li key={note.id} className="border-t border-gray-100 pt-2 first:border-t-0 first:pt-0 dark:border-white/[0.04]">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-gray-400">
            <time dateTime={note.noteDate} className="tabular-nums">{note.noteDate}</time>
            <span className="font-semibold uppercase tracking-wider">{KIND_LABELS[note.kind] ?? note.kind}</span>
            {note.agentRunId != null ? <span>run {note.agentRunId}</span> : null}
          </div>
          <p className="text-gray-900 dark:text-gray-100">{note.note}</p>
          {note.sourceRef ? (
            <p className="text-[11px] text-gray-400">
              Source:{" "}
              {/^https?:\/\//.test(note.sourceRef) ? (
                <a href={note.sourceRef} className="hover:underline" rel="noreferrer" target="_blank">{note.sourceRef}</a>
              ) : (
                note.sourceRef
              )}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
