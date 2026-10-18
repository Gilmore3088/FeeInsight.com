/**
 * The words of the quiet "where these figures came from" note under Hamilton's medians,
 * percentiles and counts (#1924 step 2). Built only from the figures' DatasetStamp: one short
 * line, the details behind it, and, when two figures on one screen come from different
 * stamps, why they can differ (stampDifferences). Pure and client-safe.
 */
import { countingLabel, datasetLabel, readDatasetStamp, stampDifferences, toIsoTime, type DatasetStamp } from "@/lib/dataset-stamp";

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
 * "Applies only to Texas: Institutions in Texas" rather than "added" or "removed".
 */
function differenceLines(a: StampedFigure, b: StampedFigure): string[] {
  return stampDifferences(a.stamp, b.stamp).map((line) => {
    if (line.startsWith("Filter added: ")) return `Applies only to ${b.label}: ${line.slice("Filter added: ".length)}`;
    if (line.startsWith("Filter removed: ")) return `Applies only to ${a.label}: ${line.slice("Filter removed: ".length)}`;
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

/**
 * Stamped figures read back from saved JSON, as saved: an entry that is not a label and a whole
 * stamp is dropped, and anything that is not a list (an older record with no stamps) gives none.
 */
export function readStampedFigures(value: unknown): StampedFigure[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const figure = entry as Partial<StampedFigure> | null;
    if (!figure || typeof figure !== "object" || typeof figure.label !== "string") return [];
    const stamp = readDatasetStamp(figure.stamp);
    return stamp ? [{ label: figure.label, stamp }] : [];
  });
}

/** The figures with each stamp once, in order: a second figure read from the same stamp adds nothing to the note. */
export function uniqueStampedFigures(figures: readonly (StampedFigure | null | undefined)[]): StampedFigure[] {
  const seen = new Set<string>();
  const out: StampedFigure[] = [];
  for (const f of figures) {
    if (!f || seen.has(f.stamp.id)) continue;
    seen.add(f.stamp.id);
    out.push(f);
  }
  return out;
}

/**
 * What a research tool hands the model beside index figures, so an answer can cite them: the
 * stamp's id, the note's one line, and the filters that set who is counted.
 */
export function datasetCitation(stamp: DatasetStamp): { stamp_id: string; summary: string; filters: string[] } {
  const words = datasetNoteWords([{ label: "figures", stamp }]);
  return { stamp_id: stamp.id, summary: words?.summary ?? "", filters: words?.filters ?? [] };
}

/** A label set mid-sentence: lower case first letter, except a proper name ("Fed district 6"). */
function lowerFirst(label: string): string {
  return /^Fed /.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * Difference lines as prose with one colon per sentence: every "Applies only to X: Y" for one
 * figure becomes "only X is limited to y and z". A filter the figure's own name already says
 * ("Fed district 6 (Atlanta)" limited to "Fed district 6") is left out; other lines stay as they are.
 */
function differenceProse(lines: readonly string[]): string[] {
  const limits = new Map<string, string[]>();
  const leavesOut = new Set<string>();
  const out: (string | { who: string })[] = [];
  for (const line of lines) {
    const match = /^Applies only to (.+?): (.+)$/.exec(line);
    if (!match) { out.push(line); continue; }
    const [, who, label] = match;
    if (!limits.has(who)) { limits.set(who, []); out.push({ who }); }
    // Leaving the bank out narrows a group by one; it is never what the group is limited to.
    if (label === LEFT_OUT_LABEL) { leavesOut.add(who); continue; }
    const what = groupWords(label);
    if (!who.toLowerCase().startsWith(what.toLowerCase())) limits.get(who)!.push(lowerFirst(what.replace(/ only$/, "")));
  }
  return out.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    const parts = limits.get(entry.who)!;
    const clauses = [
      ...(parts.length ? [`is limited to ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`}`] : []),
      ...(leavesOut.has(entry.who) ? ["leaves out the institution being compared"] : []),
    ];
    return clauses.length ? [`only ${entry.who} ${clauses.join(" and ")}`] : [];
  });
}

/** The label of the filter that leaves the compared institution out (research.ts excludeOwnFilter). */
const LEFT_OUT_LABEL = "The institution being compared left out";

/** A filter label in a sentence: a segment's "Segment: " prefix dropped, so a sentence keeps one colon. */
function groupWords(label: string): string {
  return label.replace(/^Segment: /, "");
}

/** Stamp filters that set a figure's group (peers, segment, the bank left out); the rest are the index's standard rules. */
const GROUP_FILTER = /^(peers|segment|exclude):/;

/**
 * The stamps as the sentences a printed document sets as prose (#1924 step 4): the note's line
 * (where the figures came from, when they were read, the counting rule), who is counted (the
 * group's own filters; the standard rules every figure shares are named, not listed), how the
 * reads differ, and the reference ids support can trace. `fullList` says where the reader finds
 * every filter ("open the saved answer for the full list"). Null without stamps.
 */
export function datasetPassage(figures: readonly StampedFigure[], fullList: string): string[] | null {
  const words = datasetNoteWords(figures);
  if (!words) return null;
  const [first] = figures;
  const own = first.stamp.filters.filter((f) => GROUP_FILTER.test(f.key));
  const group = own.filter((f) => !f.key.startsWith("exclude:")).map((f) => lowerFirst(groupWords(f.label)));
  const leftOut = own.some((f) => f.key.startsWith("exclude:")) ? "with the institution being compared left out, " : "";
  // With several reads, "who is counted" describes the first figure's, so it says whose.
  const whose = group.length && new Set(figures.map((f) => f.stamp.id)).size > 1 ? ` for ${first.label}` : "";
  const counted = group.length
    ? `Who is counted${whose}: ${group.join(", ")}, ${leftOut}under the index's standard rules (${fullList}).`
    : `Who is counted${whose}: all institutions${leftOut ? " except the institution being compared" : ""}, under the index's standard rules (${fullList}).`;
  const differ = words.differences ? `${words.differences.heading}: ${differenceProse(words.differences.lines).join("; ")}.` : null;
  const reference = `Data reference (for support): ${[...new Set(figures.map((f) => f.stamp.id))].join(", ")}.`;
  return [words.summary, counted, ...(differ ? [differ] : []), reference];
}
