/**
 * Exhibits that whole-schedule and "why" answers add to the fee storyline, so those answers
 * carry their own figures into the storyline (and into the memo written over it), not only
 * into the short answer. Pure.
 */

import { formatFeeAmount } from "@/lib/format";
import { MAX_STORY_EXHIBITS } from "./storyline";
import type { IncomeSplitData, StoryExhibit } from "./storyline-types";
import type { AskResponse, SchedulePosition, SourceRef } from "./types";
import { withSchedule, type ScheduleOverview } from "./schedule";
import { withIncomeSplit, type IncomeExplanation, type IncomeSplit } from "./why";

const money = (n: number): string => formatFeeAmount(Math.round(n * 100) / 100) ?? `$${n.toFixed(2)}`;

function quarterLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Every compared fee against its peer median, furthest first. */
export function scheduleExhibit(positions: readonly SchedulePosition[], feesAsOf: string | null): StoryExhibit | null {
  if (positions.length === 0) return null;
  const higher = positions.filter((p) => p.direction === "higher").length;
  const lower = positions.filter((p) => p.direction === "lower").length;
  const source: SourceRef = { label: "Fees on each institution's own published schedule (verified, live)", table: "published_fee_catalog", asOf: feesAsOf };
  return {
    id: "schedule-overview",
    actionTitle: `Of your ${positions.length} compared fees, ${higher} ${higher === 1 ? "sits" : "sit"} higher than the peer median and ${lower} lower.`,
    exhibit: {
      kind: "structure_matrix",
      title: "Every fee against its peer median",
      columns: ["Yours", "Peer median", "Peers", "Against median"],
      rows: positions.map((p) => ({
        name: p.displayName,
        cells: [
          money(p.current),
          money(p.peerMedian),
          String(p.peerCount),
          p.direction === "at" ? "At median" : `${money(Math.abs(p.current - p.peerMedian))} ${p.direction}`,
        ],
      })),
      sources: [source],
    },
  };
}

/** The split as numbers: the price part is the peer median at the bank's prices, the rest is everything else. */
export function incomeSplitData(split: IncomeSplit): IncomeSplitData {
  const ratio = split.priceGap === null ? 1 : 1 + split.priceGap;
  const atYourPrices = split.peerMedian * ratio;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    unit: "per_1000_deposits",
    own: split.own,
    peerMedian: split.peerMedian,
    peerLabel: split.peerLabel,
    n: split.peers,
    priceIndex: split.priceGap === null ? null : Math.round(100 * ratio),
    priceExplained: round(atYourPrices - split.peerMedian),
    otherExplained: round(split.own - atYourPrices),
    quarterEnd: split.quarterEnd,
  };
}

/** The bank's fee income against peers of its size, and what its prices explain of the gap. */
export function incomeExhibit(split: IncomeSplit): StoryExhibit {
  const gap = `${Math.round(Math.abs(split.incomeGap) * 100)}%`;
  const near = Math.abs(Math.log(1 + split.incomeGap)) < Math.log(1.05);
  const actionTitle = near
    ? `Your fee income per $1,000 of deposits sits about at the median of ${split.peers.toLocaleString("en-US")} peers.`
    : split.priceShare !== null
      ? `Price explains about ${split.priceShare}% of your ${gap} fee income gap with peers.`
      : `Your fee income is ${gap} ${split.incomeGap > 0 ? "higher" : "lower"} than peers, and price does not explain it.`;
  const source: SourceRef = {
    label: "FDIC call reports and NCUA 5300 reports, service charges on deposit accounts and total deposits",
    table: "institution_financial_records",
    asOf: split.quarterEnd,
  };
  return {
    id: "income-split",
    actionTitle,
    exhibit: {
      kind: "structure_matrix",
      title: "Fee income and price against peers",
      columns: ["Yours", "Peer median"],
      rows: [
        { name: "Service charges per $1,000 of deposits, last four quarters", cells: [money(split.own), money(split.peerMedian)] },
        ...(split.priceGap === null
          ? []
          : [{ name: `Published prices, ${split.priceFees} fees (peer median = 100)`, cells: [String(Math.round(100 * (1 + split.priceGap))), "100"] }]),
      ],
      sources: [source, { label: "Fees on each institution's own published schedule (verified, live)", table: "published_fee_catalog" }],
      note: "How often fees are charged and which ones are shown together.",
      incomeSplit: incomeSplitData(split),
    },
    takeaway: {
      text: `${money(split.own)} per $1,000 of deposits against a ${money(split.peerMedian)} median, four quarters to ${quarterLabel(split.quarterEnd)}.`,
      source,
      sampleSize: split.peers,
    },
  };
}

/** Puts the exhibits first in the answer's storyline, keeping at most five and renumbering. */
export function withStoryExhibits(response: AskResponse, extra: readonly (StoryExhibit | null)[]): AskResponse {
  const story = response.answer?.storyline;
  const add = extra.filter((e): e is StoryExhibit => e !== null);
  if (!story || !response.answer || add.length === 0) return response;
  const exhibits = [...add, ...story.exhibits.filter((e) => !add.some((a) => a.id === e.id))]
    .slice(0, MAX_STORY_EXHIBITS)
    .map((e, i) => ({ ...e, number: i + 1 }));
  return { ...response, answer: { ...response.answer, storyline: { ...story, exhibits } } };
}

export interface IncomeWhy {
  split: IncomeSplit;
  explained: IncomeExplanation;
  /** The fee furthest from its peer median, answered in detail when the question named none. */
  top: string | null;
}

/**
 * The whole-schedule overview and the income split, in the short answer and as exhibits leading
 * the storyline, so the memo written over the storyline carries them too.
 */
export function withDepth(built: AskResponse, schedule: ScheduleOverview | null, why: IncomeWhy | null, feesAsOf: string | null): AskResponse {
  let response = schedule ? withSchedule(built, schedule) : built;
  if (why) response = withIncomeSplit(response, why.explained);
  return withStoryExhibits(response, [why ? incomeExhibit(why.split) : null, schedule ? scheduleExhibit(schedule.positions, feesAsOf) : null]);
}
