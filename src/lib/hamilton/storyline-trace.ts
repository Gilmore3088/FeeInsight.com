/**
 * Whether Hamilton's reading in a board brief states only numbers its saved storyline holds
 * (gate G9). A storyline memo's binding ties a sentence only to a fee record, so a sentence stating
 * a call report figure, or the bank's NSF or transfer fee from the structure table, sits under
 * "Hamilton's reading, not tied to a fee record" although the answer's exhibits print each of those
 * figures with its source. When every number in every reading sentence appears among the saved
 * storyline's figures, the brief labels the box as Hamilton's commentary on those exhibits instead.
 *
 * This is a gate on that one note, never a source line: it matches numbers only, so it says
 * nothing about whose figure a number is, its direction or its period, and the brief never prints a
 * source beside a sentence from it. Pure: reads only the saved answer.
 */
import { formatDollarsInWords, formatFeeAmount } from "@/lib/format";
import { extractFigures } from "./figure-check";
import { blankDates } from "./traced-figures";
import type { Fact } from "./workspace/types";
import type { Storyline } from "./workspace/storyline-types";

/** The box label when every number in it appears in the saved storyline. */
export const COMMENTARY_LABEL = "Hamilton's commentary";
/** Under that box. */
export const COMMENTARY_NOTE =
  "Hamilton wrote these sentences from the answer and exhibits above. Their figures appear in those exhibits, with their sources; the sentences themselves are Hamilton's reading.";
/** The brief's limit in place of the reading limit when the commentary label is used. */
export const COMMENTARY_LIMIT =
  "Hamilton's commentary is its own reading of the exhibits. Its figures appear in them, but whether each sentence gives a figure the right institution, fee, period or direction was not checked one by one.";

const fee = (n: number) => formatFeeAmount(n) ?? `$${n}`;
const sized = (text: string, n?: number) => (n ? `${text} (${n})` : text);
const factText = (f: Fact) => sized(f.text, f.sampleSize);

/** Every figure a saved storyline states, as text: key figures, facts, exhibit titles and exhibit data. */
export function storylineTexts(story: Storyline): string[] {
  const out: string[] = [
    ...story.keyFigures.map((k) => sized(`${k.label} ${k.value}`, k.n)),
    ...[...story.situation, ...story.complication, ...story.lenses.finance, ...story.lenses.market, ...story.watch].map(factText),
    ...(story.options ?? []).flatMap((o) => o.consequences.map(factText)),
  ];
  for (const item of story.exhibits) {
    const x = item.exhibit;
    out.push(item.actionTitle);
    if (item.takeaway) out.push(factText(item.takeaway));
    switch (x.kind) {
      case "fee_position":
        if (x.own !== null) out.push(fee(x.own));
        out.push(`${fee(x.band.median)} ${x.band.n} ${fee(x.band.p25)} ${fee(x.band.p75)}`);
        for (const m of x.markers) out.push(`${fee(m.value)} (${m.n})`);
        break;
      case "competitor_range":
        if (x.own !== null) out.push(fee(x.own));
        for (const i of [...x.items, ...(x.rest ?? [])]) out.push(fee(i.amount));
        break;
      case "structure_matrix":
        for (const row of x.rows) for (const cell of row.cells) if (cell !== null) out.push(cell);
        break;
      case "money_at_stake":
        for (const r of x.rows) out.push(`${formatDollarsInWords(r.low)} ${formatDollarsInWords(r.high)}`);
        break;
      case "archetype_map":
        for (const a of x.archetypes) out.push(`${a.rule} ${a.count}`);
        break;
      default:
        break;
    }
  }
  return out;
}

type Num = { kind: "usd" | "pct"; value: number; tolerance: number } | { kind: "number"; value: number };

/** The numbers a text states: its $ and % figures, and every other number outside a date. */
function numbersIn(text: string): Num[] {
  const figures = extractFigures(text);
  const spans = figures.map((f) => [f.index, f.index + f.raw.length] as const);
  const out: Num[] = figures.map((f) => ({ kind: f.kind, value: f.value, tolerance: f.tolerance }));
  for (const run of blankDates(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const at = run.index ?? 0;
    if (spans.some(([s, e]) => at >= s && at < e)) continue;
    out.push({ kind: "number", value: Number(run[0].replace(/,/g, "")) });
  }
  return out;
}

/**
 * True when there is reading and every number in it appears among the saved storyline's figures.
 * False with no storyline, no reading, or any number the storyline does not state.
 */
export function readingFiguresInStoryline(sentences: readonly string[], story: Storyline | null | undefined): boolean {
  if (!story || sentences.length === 0) return false;
  const held = storylineTexts(story).flatMap(numbersIn);
  return sentences.every((sentence) => numbersIn(sentence).every((n) => held.some((h) => n.kind === "number"
    ? h.kind === "number" && h.value === n.value
    : h.kind === n.kind && Math.abs(h.value - n.value) <= n.tolerance)));
}
