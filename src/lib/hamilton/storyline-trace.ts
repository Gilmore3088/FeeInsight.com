/**
 * Hamilton's reading sentences in a board brief, traced to the saved storyline they were written
 * from (gate G9). A storyline memo's binding ties a sentence only to a fee record, so a sentence
 * stating a call report figure, or the bank's NSF or transfer fee from the structure table, sat
 * under "Hamilton's reading, not tied to a fee record" although the answer carries each of those
 * figures with its source. Here a sentence is traced when every number in it matches a figure the
 * saved storyline states, from a statement that names the same institution when it names one; the
 * sources of those statements are printed beside it. Numbers only: the wording is not checked, and a
 * sentence with any number the storyline does not hold stays Hamilton's reading. Pure: reads only the
 * saved answer.
 */
import { formatDollarsInWords, formatFeeAmount } from "@/lib/format";
import { extractFigures, type NarrativeFigure } from "./figure-check";
import { blankDates } from "./traced-figures";
import { sourcesLine } from "./brief-exhibits";
import type { Fact, SourceRef } from "./workspace/types";
import type { Storyline } from "./workspace/storyline-types";

/** A reading sentence whose every number the saved storyline states, with the sources it states them from. */
export interface TracedReading {
  sentence: string;
  sources: string[];
}

/** Over the traced sentences, in the PDF and on screen. */
export const TRACED_READING_LABEL = "Hamilton's commentary, with each figure's source";
/** Under the traced sentences. */
export const TRACED_READING_NOTE =
  "Hamilton wrote these sentences from the answer above. Each number in them matches a figure the saved answer states from the source named; the wording around the numbers was not checked one by one.";

/** The brief's limit when some reading sentences were traced. */
export const TRACED_READING_LIMIT =
  "Some of Hamilton's sentences are printed with the source of each figure in them. Their numbers were matched to the saved answer's figures; their wording was not checked one by one.";

interface Statement {
  text: string;
  sources: readonly SourceRef[];
  /** A named institution other than the research institution; a sentence must name it too. */
  institution?: string;
  /** Every figure in it is the research institution's own (its fee, its filing). */
  own?: boolean;
}

const fee = (n: number) => formatFeeAmount(n) ?? `$${n}`;
const sized = (text: string, n?: number) => (n ? `${text} (${n} institutions)` : text);
const fact = (f: Fact): Statement => ({ text: sized(f.text, f.sampleSize), sources: [f.source] });

/** Every sourced figure a saved storyline states: its key figures, facts, exhibit titles and exhibit data. */
export function storylineStatements(story: Storyline, subjects: readonly string[] = subjectNames(story)): Statement[] {
  const out: Statement[] = [
    // A key figure is the institution's own when its label is ("Your overdraft fee", "<bank>'s overdraft fee").
    ...story.keyFigures.map((k) => ({ text: sized(`${k.label} ${k.value}`, k.n), sources: [k.source], own: ownLabelled(k.label, subjects) })),
    ...[...story.situation, ...story.complication, ...story.lenses.finance, ...story.lenses.market, ...story.watch].map(fact),
    ...(story.options ?? []).flatMap((o) => o.consequences.map(fact)),
  ];
  for (const item of story.exhibits) {
    const x = item.exhibit;
    const sources = x.sources;
    out.push({ text: item.actionTitle, sources });
    if (item.takeaway) out.push(fact(item.takeaway));
    switch (x.kind) {
      case "fee_position":
        if (x.own !== null) out.push({ text: `${x.ownLabel} ${fee(x.own)}`, sources, own: true });
        out.push({ text: `Peer median ${fee(x.band.median)} of ${x.band.n} peers; middle half ${fee(x.band.p25)} to ${fee(x.band.p75)}`, sources });
        for (const m of x.markers) out.push({ text: `${m.label} ${fee(m.value)} (${m.n} institutions)`, sources });
        break;
      case "competitor_range":
        if (x.own !== null) out.push({ text: `${x.ownLabel} ${fee(x.own)}`, sources, own: true });
        for (const i of [...x.items, ...(x.rest ?? [])]) out.push({ text: `${i.name} ${fee(i.amount)}`, sources, institution: i.name });
        break;
      case "structure_matrix":
        for (const row of x.rows) {
          row.cells.forEach((cell, c) => {
            if (cell !== null) out.push({ text: `${row.name} ${x.columns[c] ?? ""} ${cell}`, sources, ...(row.own ? { own: true } : { institution: row.name }) });
          });
        }
        break;
      case "money_at_stake":
        for (const r of x.rows) out.push({ text: `${r.label} ${formatDollarsInWords(r.low)} ${r.high !== r.low ? formatDollarsInWords(r.high) : ""}`, sources, own: true });
        break;
      case "archetype_map":
        for (const a of x.archetypes) out.push({ text: `${a.label}: ${a.rule}, ${a.count} institutions`, sources });
        break;
      default:
        break;
    }
  }
  return out;
}

type Wanted = ({ kind: "usd" | "pct"; value: number; tolerance: number } | { kind: "number"; value: number }) & {
  /** Stated as the research institution's own: "its $35 NSF fee", "Your $32 fee", "<bank>'s $10 transfer fee". */
  own?: boolean;
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The research institution's names in the saved storyline: each exhibit's own label. */
function subjectNames(story: Storyline): string[] {
  const labels = story.exhibits.flatMap((e) => ("ownLabel" in e.exhibit && typeof e.exhibit.ownLabel === "string" ? [e.exhibit.ownLabel] : []));
  return [...new Set(labels.filter((l) => l.trim()))];
}

function ownLabelled(label: string, subjects: readonly string[]): boolean {
  return /^(?:your|its|our)\b/i.test(label.trim()) || subjects.some((name) => label.trim().toLowerCase().startsWith(name.toLowerCase()));
}

/** True when a possessive naming the research institution stands right before the figure. */
function possessive(before: string, subjects: readonly string[]): boolean {
  const names = subjects.map((n) => `${escape(n)}['\u2019]s`).join("|");
  return new RegExp(`(?:\\b(?:your|its|our)${names ? `|${names}` : ""})\\s+$`, "i").test(before);
}

/** The numbers a text states: its $ and % figures, and every other number outside a date. */
function numbersIn(text: string, subjects: readonly string[], allOwn = false): Wanted[] {
  const figures = extractFigures(text);
  const spans = figures.map((f) => [f.index, f.index + f.raw.length] as const);
  const out: Wanted[] = figures.map((f: NarrativeFigure) => ({
    kind: f.kind, value: f.value, tolerance: f.tolerance, own: allOwn || possessive(text.slice(0, text.indexOf(f.raw, f.index)), subjects),
  }));
  for (const run of blankDates(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const at = run.index ?? 0;
    if (spans.some(([s, e]) => at >= s && at < e)) continue;
    out.push({ kind: "number", value: Number(run[0].replace(/,/g, "")) });
  }
  return out;
}

/** A figure stated as the institution's own is held only by a statement of its own figure. */
function holds(statement: Wanted[], wanted: Wanted): boolean {
  return statement.some((n) => (!wanted.own || n.own) && (wanted.kind === "number"
    ? n.kind === "number" && n.value === wanted.value
    : n.kind === wanted.kind && Math.abs(n.value - wanted.value) <= wanted.tolerance));
}

const NAME_SUFFIX = /,?\s+(?:national association|n\.\s?a\.?|inc\.?|fsb|ssb)$/i;
const GENERIC = new Set(["bank", "first", "the", "citizens", "community", "national", "federal", "credit", "union", "savings", "trust", "state", "united"]);

/** True when the sentence names the institution: its name, or a first word of its own ("PNC", "Pinnacle"). */
function names(sentence: string, institution: string): boolean {
  const name = institution.trim().replace(NAME_SUFFIX, "");
  const lower = sentence.toLowerCase();
  if (lower.includes(name.toLowerCase())) return true;
  const first = name.split(/\s+/)[0] ?? "";
  return first.length > 1 && !GENERIC.has(first.toLowerCase()) && new RegExp(`\\b${first.replace(/[^\w]/g, "")}\\b`, "i").test(sentence);
}

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z]{3,}/g) ?? []);

/** One reading sentence traced to the storyline's statements, or null when any number is not held. */
function traceSentence(sentence: string, statements: readonly Statement[], subjects: readonly string[]): TracedReading | null {
  const wanted = numbersIn(sentence, subjects);
  if (!wanted.length) return null;
  const said = words(sentence);
  const candidates = statements
    .filter((s) => !s.institution || names(sentence, s.institution))
    .map((s) => {
      const held = numbersIn(s.text, subjects, s.own);
      const overlap = [...words(s.text)].filter((w) => said.has(w)).length;
      return { s, covers: wanted.map((w) => holds(held, w)), overlap };
    });
  const open = new Set(wanted.keys());
  const chosen: Statement[] = [];
  while (open.size) {
    let best: (typeof candidates)[number] | null = null;
    let bestCount = 0;
    for (const c of candidates) {
      const count = [...open].filter((i) => c.covers[i]).length;
      if (count > bestCount || (count === bestCount && count > 0 && best && c.overlap > best.overlap)) {
        best = c;
        bestCount = count;
      }
    }
    if (!best || bestCount === 0) return null;
    for (const i of [...open]) if (best.covers[i]) open.delete(i);
    chosen.push(best.s);
  }
  const sources = [...new Set(chosen.map((s) => sourcesLine(s.sources)).filter(Boolean))];
  return sources.length ? { sentence, sources } : null;
}

/** The reading sentences split into those the saved storyline traces, with their sources, and the rest. */
export function traceReading(sentences: readonly string[], story: Storyline | null | undefined, subjectName?: string | null): { traced: TracedReading[]; untraced: string[] } {
  if (!story) return { traced: [], untraced: [...sentences] };
  const subjects = [...new Set([...subjectNames(story), ...(subjectName?.trim() ? [subjectName.trim()] : [])])];
  const statements = storylineStatements(story, subjects);
  const traced: TracedReading[] = [];
  const untraced: string[] = [];
  for (const sentence of sentences) {
    const line = traceSentence(sentence, statements, subjects);
    if (line) traced.push(line);
    else untraced.push(sentence);
  }
  return { traced, untraced };
}
