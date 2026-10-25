/**
 * What an added finding carries into a report on screen (#1899): its chart, figures, method,
 * sources, dates and limits, as the server built them (report-finding-evidence.ts). The PDF prints
 * the same fields (PdfDocument.tsx, PdfAddedFindingEvidence). Site tokens only, like ReportOutput.
 */
import {
  FINDING_EVIDENCE_LABELS,
  findingChartCaption,
  readAddedFindingEvidence,
  type FindingRangeChart,
} from "@/lib/hamilton/report-finding-evidence";

/** One scale for the chart: every mark, padded so none sits on the edge. */
function scale(chart: FindingRangeChart): (value: number) => number {
  const values = [chart.median, chart.p25, chart.p75, chart.subject, chart.current ?? null].filter((v): v is number => typeof v === "number");
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = hi > lo ? (hi - lo) * 0.18 : Math.max(hi * 0.25, 1);
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  return (value) => Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

function FindingRange({ chart }: { chart: FindingRangeChart }) {
  const x = scale(chart);
  const band = chart.p25 !== null && chart.p75 !== null ? { left: x(chart.p25), width: Math.max(x(chart.p75) - x(chart.p25), 1.5) } : null;
  return (
    <div role="img" aria-label={findingChartCaption(chart)} className="relative h-7 w-full max-w-md">
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-warm-300" />
      {band ? <div className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full bg-warm-200" style={{ left: `${band.left}%`, width: `${band.width}%` }} /> : null}
      <div className="absolute top-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-warm-900" style={{ left: `${x(chart.median)}%` }} />
      {typeof chart.current === "number" ? (
        <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-warm-600 bg-white" style={{ left: `${x(chart.current)}%` }} />
      ) : null}
      {chart.subject !== null ? (
        <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-terra ring-2 ring-white" style={{ left: `${x(chart.subject)}%` }} />
      ) : null}
    </div>
  );
}

export function AddedFindingEvidenceBlock({ value }: { value: unknown }) {
  const evidence = readAddedFindingEvidence(value);
  if (!evidence) return null;
  const { chart } = evidence;
  return (
    <div className="mt-3 space-y-2 rounded-md border border-warm-200 bg-warm-50 p-3 text-xs leading-relaxed text-warm-700">
      {chart ? (
        <figure className="m-0">
          <FindingRange chart={chart} />
          <figcaption className="mt-1 text-warm-600">
            {findingChartCaption(chart)}{" "}
            <span className="text-warm-500">Dot: {chart.subjectLabel.toLowerCase() === "tested" ? "tested" : `${chart.subjectLabel}'s`} fee.{typeof chart.current === "number" ? " Ring: current fee." : ""} Line: peer group median.{chart.p25 !== null && chart.p75 !== null ? " Shaded: middle half of the peer group." : ""}</span>
          </figcaption>
        </figure>
      ) : null}
      {evidence.figures.length ? (
        <div>
          <p className="font-semibold text-warm-800">{FINDING_EVIDENCE_LABELS.figures}</p>
          <ul className="mt-1 space-y-0.5">
            {evidence.figures.map((f, i) => <li key={i}>{f.label}: {f.value}{f.note ? ` (${f.note})` : ""}</li>)}
          </ul>
        </div>
      ) : null}
      <p><span className="font-semibold text-warm-800">{FINDING_EVIDENCE_LABELS.method}: </span>{evidence.method}</p>
      <div>
        <p className="font-semibold text-warm-800">{FINDING_EVIDENCE_LABELS.sources}</p>
        <ul className="mt-1 space-y-0.5">
          {evidence.sources.map((s, i) => <li key={i}>{s.label}: {s.detail}</li>)}
        </ul>
      </div>
      <p><span className="font-semibold text-warm-800">{FINDING_EVIDENCE_LABELS.dates}: </span>{evidence.dates}</p>
      {evidence.limitations.length ? (
        <div>
          <p className="font-semibold text-warm-800">{FINDING_EVIDENCE_LABELS.limits}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {evidence.limitations.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
