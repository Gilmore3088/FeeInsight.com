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

  const measured = rows
    .filter((row) => row.amount > 0)
    .map((row) => {
      const inState = row.state !== null && stateGroup !== null;
      const band = (inState ? row.state : row.nation) as MarketBand | null;
      if (!band || band.median <= 0) return null;
      const diff = row.amount - band.median;
      return {
        row,
        band,
        group: inState ? `${band.institutions.toLocaleString("en-US")} ${stateGroup}` : `${band.institutions.toLocaleString("en-US")} U.S. institutions`,
        barLabel: inState ? (stateCode ?? "State") : "U.S.",
        diff,
        share: Math.abs(diff) / band.median,
        position: positionIn(row.amount, band),
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  const feeFinding = (m: (typeof measured)[number]): Finding => ({
    key: `fee-${m.row.category}`,
    label: m.row.label,
    figure: m.position === "within" ? money(m.row.amount) : signed(m.diff),
    tone: m.position,
    text:
      m.position === "within"
        ? `Its ${m.row.label.toLowerCase()} fee, ${money(m.row.amount)}, sits inside the middle half of ${m.group}.`
        : `Its ${m.row.label.toLowerCase()} fee is ${money(m.row.amount)}, ${money(Math.abs(m.diff))} ${m.diff > 0 ? "above" : "below"} the ${money(m.band.median)} median of ${m.group}.`,
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

  const outside = measured.filter((m) => m.position !== "within").sort((a, b) => b.share - a.share);
  const topAbove = outside.find((m) => m.position === "above");
  const topBelow = outside.find((m) => m.position === "below");
  for (const m of [topAbove, topBelow]) if (m) take(feeFinding(m), m.row.category);
  for (const m of outside) if (!used.has(m.row.category) && findings.length < 2) take(feeFinding(m), m.row.category);

  if (peerRank && peerGroup) {
    const line = peerRank.lines.find((l) => !used.has(l.key) && l.peers > 0 && l.own > 0) ?? null;
    if (line) {
      const share = (line.lower + line.same / 2) / line.peers;
      take(
        {
          key: `rank-${line.key}`,
          label: line.key === "overdraft" ? "Overdraft among peers" : "Maintenance among peers",
          figure: `${line.higher} of ${line.peers}`,
          tone: share < 0.25 ? "below" : share > 0.75 ? "above" : "within",
          text: `Of ${line.peers} ${peerGroup} that publish a ${PEER_LABEL[line.key] ?? line.key} fee, ${line.higher} charge more than its ${money(line.own)} and ${line.lower} charge less.`,
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
