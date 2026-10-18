import { datasetNoteWords, type StampedFigure } from "@/lib/dataset-note";

/**
 * The quiet line under Hamilton's medians, percentiles and counts that says where they came
 * from (#1924): source, read time and counting rule, with the details, the filters that set
 * who is counted and, for figures from different reads, how they differ, on expand.
 * Renders nothing without a stamp.
 */
export function DatasetNote({ figures, className = "" }: { figures: readonly (StampedFigure | null | undefined)[]; className?: string }) {
  const words = datasetNoteWords(figures.filter((f): f is StampedFigure => !!f));
  if (!words) return null;
  return (
    <details className={`dataset-note text-xs text-warm-600 ${className}`.trim()}>
      <summary className="cursor-pointer">{words.summary}</summary>
      <div className="mt-2 flex flex-col gap-2 border-l border-warm-300 pl-3">
        <ul className="flex flex-col gap-0.5">
          {words.details.map((line) => <li key={line}>{line}</li>)}
        </ul>
        {words.filters.length > 0 ? (
          <div>
            <p className="font-medium text-warm-700">Who is counted</p>
            <ul className="mt-0.5 flex list-disc flex-col gap-0.5 pl-4">
              {words.filters.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
        ) : null}
        {words.differences ? (
          <div>
            <p className="font-medium text-warm-700">{words.differences.heading}</p>
            <ul className="mt-0.5 flex list-disc flex-col gap-0.5 pl-4">
              {words.differences.lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}
