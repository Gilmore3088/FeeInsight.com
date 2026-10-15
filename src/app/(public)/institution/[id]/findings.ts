import { formatFeeAmount } from "@/lib/format";
import type { InstitutionPeerRank } from "@/lib/data-store/peer-fee-rank";
import { positionIn, type HeadlineRow, type MarketBand, type Position } from "./market-position";

/** One sentence the page leads with: a difference, the group it is measured against, and its source. */
export interface Finding {
  key: string;
  /** The fee or measure, e.g. "Overdraft". */
  label: string;
  /** The figure that carries the finding, e.g. "+$5" or "5 of 21". */
  figure: string;
  tone: Position;
  text: string;
  /** "71 Texas banks" or "the U.S. (1,204 institutions)". */
  comparedWith: string;
  sourceUrl: string | null;
  /** Drawn under the sentence when the finding is about one fee's place in a market. */
  bar: { band: MarketBand; amount: number; label: string } | null;
}

const FINDINGS_SHOWN = 3;
const money = (n: number) => formatFeeAmount(n) ?? `$${n.toFixed(2)}`;

function signed(diff: number): string {
  return `${diff > 0 ? "+" : "−"}${money(Math.abs(diff))}`;
}

/** "Overdraft (OD)" reads as "overdraft" inside a sentence; an acronym such as ATM keeps its capitals. */
const plain = (label: string) =>
  label
    .replace(/\s*\([^)]*\)/g, "")
    .split(" ")
    .map((word) => (/^[A-Z]{2,}$/.test(word.replace(/[^A-Za-z]/g, "")) ? word : word.toLowerCase()))
    .join(" ");
const article = (word: string) => `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;

const PEER_LABEL: Record<string, string> = { overdraft: "overdraft", monthly_maintenance: "monthly maintenance" };

/**
 * The three findings worth reading first, from the same live rows as the table: the fees furthest
 * above and below their market's median, then where it ranks among named peers, then its overall
 * spread. A $0 headline fee is never a finding (it is too often a waiver read as a fee); it stays
 * in the table with its source.
 */
export function buildFindings(input: {
  rows: HeadlineRow[];
  /** "Texas banks"; null when the state has too few institutions for a median. */
  stateGroup: string | null;
  stateCode: string | null;
  peerRank: InstitutionPeerRank | null;
  peerGroup: string | null;
  positionCounts: Record<Position, number>;
}): Finding[] {
  const { rows, stateGroup, stateCode, peerRank, peerGroup, positionCounts } = input;

  const measure = (row: HeadlineRow, scope: "state" | "nation") => {
    const band = scope === "state" ? (stateGroup !== null ? row.state : null) : row.nation;
    if (!band || band.median <= 0) return null;
    const diff = row.amount - band.median;
    const n = band.institutions.toLocaleString("en-US");
    return {
      row,
      band,
      scope,
      group: scope === "state" ? `${n} ${stateGroup}` : `${n} U.S. institutions`,
      barLabel: scope === "state" ? (stateCode ?? "State") : "U.S.",
      diff,
      share: Math.abs(diff) / band.median,
      position: positionIn(row.amount, band),
    };
  };
  type Measure = NonNullable<ReturnType<typeof measure>>;
  const priced = rows.filter((row) => row.amount > 0);
  const inState = priced.map((row) => measure(row, "state")).filter((m): m is Measure => m !== null);
  const inNation = priced.map((row) => measure(row, "nation")).filter((m): m is Measure => m !== null);
  // The home market speaks first; a fee the state calls ordinary can still stand out nationally.
  const measured = [...inState, ...inNation.filter((m) => !inState.some((s) => s.row.category === m.row.category))];

  const feeFinding = (m: Measure): Finding => {
    // A fee the state calls ordinary but the nation does not says both, so the card and the
    // state table below it never seem to disagree.
    const home = m.scope === "nation" ? inState.find((s) => s.row.category === m.row.category && s.position === "within") : undefined;
    const lead = `Its ${plain(m.row.label)} fee`;
    const text =
      m.position === "within"
        ? `${lead}, ${money(m.row.amount)}, sits inside the middle half of ${m.group}.`
        : home
          ? `${lead}, ${money(m.row.amount)}, is inside the middle half of ${home.group} but ${money(Math.abs(m.diff))} ${m.diff > 0 ? "above" : "below"} the ${money(m.band.median)} median of ${m.group}.`
          : `${lead} is ${money(m.row.amount)}, ${money(Math.abs(m.diff))} ${m.diff > 0 ? "above" : "below"} the ${money(m.band.median)} median of ${m.group}.`;
    return finding(m, text);
  };
  const finding = (m: Measure, text: string): Finding => ({
    key: `fee-${m.row.category}`,
    label: m.row.label,
    figure: m.position === "within" ? money(m.row.amount) : signed(m.diff),
    tone: m.position,
    text,
    comparedWith: m.group,
    sourceUrl: m.row.sourceUrl,
    bar: { band: m.band, amount: m.row.amount, label: m.barLabel },
  });

  const findings: Finding[] = [];
  const used = new Set<string>();
  const take = (finding: Finding, category?: string) => {
    if (findings.length >= FINDINGS_SHOWN) return;
    findings.push(finding);
    if (category) used.add(category);
  };

  const stateOutside = inState.filter((m) => m.position !== "within");
  const nationOutside = inNation.filter(
    (m) => m.position !== "within" && !stateOutside.some((s) => s.row.category === m.row.category),
  );
  const bySize = (x: Measure, y: Measure) => y.share - x.share;
  const outside = [...stateOutside.sort(bySize), ...nationOutside.sort(bySize)];
  const topAbove = outside.find((m) => m.position === "above");
  const topBelow = outside.find((m) => m.position === "below");
  for (const m of [topAbove, topBelow]) if (m) take(feeFinding(m), m.row.category);
  for (const m of outside) if (!used.has(m.row.category) && findings.length < 2) take(feeFinding(m), m.row.category);

  if (peerRank && peerGroup) {
    const toneOf = (l: (typeof peerRank.lines)[number]): Position => {
      const share = (l.lower + l.same / 2) / l.peers;
      return share < 0.25 ? "below" : share > 0.75 ? "above" : "within";
    };
    // A rank in the middle of its peers is not something that stands out.
    const line = peerRank.lines.find((l) => !used.has(l.key) && l.peers > 0 && l.own > 0 && toneOf(l) !== "within") ?? null;
    if (line) {
      const tone = toneOf(line);
      const fee = article(PEER_LABEL[line.key] ?? line.key);
      const split = [`${line.higher} charge more than its ${money(line.own)}`, line.same > 0 ? `${line.same} the same` : null, `${line.lower} less`]
        .filter(Boolean)
        .join(", ")
        .replace(/, ([^,]*)$/, " and $1");
      take(
        {
          key: `rank-${line.key}`,
          label: line.key === "overdraft" ? "Overdraft among peers" : "Maintenance among peers",
          figure: tone === "above" ? `Above ${line.lower}` : `Below ${line.higher}`,
          tone,
          text: `Of ${line.peers} ${peerGroup} that publish ${fee} fee, ${split}.`,
          comparedWith: `${line.peers} ${peerGroup}`,
          sourceUrl: null,
          bar: null,
        },
        line.key,
      );
    }
  }

  const benchmarked = positionCounts.below + positionCounts.within + positionCounts.above;
  if (benchmarked >= 5) {
    take({
      key: "spread",
      label: "Across its schedule",
      figure: `${positionCounts.above} of ${benchmarked}`,
      tone: positionCounts.above > positionCounts.below ? "above" : positionCounts.below > positionCounts.above ? "below" : "within",
      text: `${positionCounts.above} of its ${benchmarked} benchmarked fees sit above the U.S. middle half, ${positionCounts.below} below and ${positionCounts.within} inside.`,
      comparedWith: "the national index for each fee",
      sourceUrl: null,
      bar: null,
    });
  }

  for (const m of measured) if (!used.has(m.row.category)) take(feeFinding(m), m.row.category);
  return findings;
}
