/**
 * The words of the quiet "where these figures came from" note under Hamilton's medians,
 * percentiles and counts (#1924 step 2). Built only from the figures' DatasetStamp: one short
 * line, the details behind it, and, when two figures on one screen come from different
 * stamps, why they can differ (stampDifferences). Pure and client-safe.
 */
import { countingLabel, datasetLabel, stampDifferences, toIsoTime, type DatasetStamp } from "@/lib/dataset-stamp";

/** A figure on screen and the stamp of the data behind it. */
export interface StampedFigure {
  /** What the screen calls the figure: "Texas", "U.S. median". */
  label: string;
  stamp: DatasetStamp;
}

export interface DatasetNoteWords {
  /** One line: source, read time, counting rule. */
  summary: string;
  /** The details behind the line, one per entry. */
  details: string[];
  /** The population filters, one per entry. */
  filters: string[];
  /** Why two figures can differ; null when every figure shares one stamp. */
  differences: { heading: string; lines: string[] } | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "18 Oct 2026 14:10 UTC": fixed format from the ISO string, the same on server and client. */
export function noteTime(iso: string | null): string {
  const at = toIsoTime(iso);
  if (!at) return "an unknown time";
  const day = Number(at.slice(8, 10));
  return `${day} ${MONTHS[Number(at.slice(5, 7)) - 1]} ${at.slice(0, 4)} ${at.slice(11, 16)} UTC`;
}

function readWords(stamp: DatasetStamp): string {
  return stamp.mode === "cached"
    ? `Snapshot of published fee schedules, computed ${noteTime(stamp.readAt)}`
    : `Published fee schedules, read live ${noteTime(stamp.readAt)}`;
}

const COUNTING_SHORT: Record<DatasetStamp["counting"], string> = {
  counted_once: "Institutions sharing one fee schedule count once.",
  per_charter: "Each charter counts on its own.",
};

/** The details for one stamp, without its filters. */
function detailLines(stamp: DatasetStamp): string[] {
  return [
    `Source: ${datasetLabel(stamp.dataset)}`,
    ...(stamp.derivedFrom ? [`Computed from: ${datasetLabel(stamp.derivedFrom)}`] : []),
    stamp.mode === "cached" ? `Snapshot computed: ${noteTime(stamp.readAt)}` : `Read live: ${noteTime(stamp.readAt)}`,
    ...(stamp.newestRecordAt ? [`Newest fee record: ${noteTime(stamp.newestRecordAt)}`] : []),
    `Method version: ${stamp.methodVersion}`,
    `Counting: ${countingLabel(stamp.counting)}`,
    `Data reference (for support): ${stamp.id}`,
  ];
}

/**
 * stampDifferences in the figures' own names: a filter only one figure has reads
 * "Only Texas: Institutions in Texas" rather than "added" or "removed".
 */
function differenceLines(a: StampedFigure, b: StampedFigure): string[] {
  return stampDifferences(a.stamp, b.stamp).map((line) => {
    if (line.startsWith("Filter added: ")) return `Only ${b.label}: ${line.slice("Filter added: ".length)}`;
    if (line.startsWith("Filter removed: ")) return `Only ${a.label}: ${line.slice("Filter removed: ".length)}`;
    return line;
  });
}

/**
 * The note for the figures on one screen. The first figure's stamp sets the line and details;
 * every other figure whose stamp differs adds why, against the first, each reason once (a filter
 * only the first figure has would otherwise repeat per figure). Null with no figures.
 */
export function datasetNoteWords(figures: readonly StampedFigure[]): DatasetNoteWords | null {
  const [first, ...rest] = figures;
  if (!first) return null;
  const others = rest.filter((f) => f.stamp.id !== first.stamp.id);
  const lines = [...new Set(others.flatMap((other) => differenceLines(first, other)))];
  const names = [first, ...others].map((f) => f.label);
  return {
    summary: `${readWords(first.stamp)}. ${COUNTING_SHORT[first.stamp.counting]}`,
    details: detailLines(first.stamp),
    filters: first.stamp.filters.map((f) => f.label),
    differences: lines.length > 0
      ? { heading: names.length === 2 ? `How ${names[0]} and ${names[1]} differ` : "Why these figures can differ", lines }
      : null,
  };
}
