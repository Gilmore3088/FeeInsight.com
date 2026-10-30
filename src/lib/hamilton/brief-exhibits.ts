/**
 * A saved storyline answer's exhibits as the board brief's tables (gate G9). The brief printed the
 * exhibits' titles as sentences only, so a board saw none of the position chart, local range,
 * pricing groups, structure matrix or money at stake the answer screen shows. Each exhibit becomes
 * one table with the same figures, as saved: nothing is re-read or recomputed. Pure.
 */
import { formatDollarsInWords, formatFeeAmount } from "@/lib/format";
import { statedFeeText } from "@/lib/own-fee";
import { peerListFeeText } from "./peer-list-words";
import type { ReportExhibit } from "./types";
import type { Exhibit, SourceRef } from "./workspace/types";
import type { StoryExhibit, Storyline } from "./workspace/storyline-types";

/** A source date as a board reads it: "2026-10-12T00:00:00.000Z" -> "Oct 12, 2026"; anything else as saved. */
export function readerAsOf(asOf: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(asOf.trim());
  if (!m) return asOf;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const fee = (n: number | null | undefined): string => (n == null ? "Not listed" : formatFeeAmount(n) ?? `$${n}`);
const count = (n: number) => n.toLocaleString("en-US");

/** The exhibit's sources in a line: "Bank Fee Index, published fee schedules, as of Oct 18, 2026". */
export function sourcesLine(sources: readonly SourceRef[]): string {
  const seen = new Map<string, string[]>();
  for (const source of sources) {
    const dates = seen.get(source.label) ?? [];
    if (source.asOf && !dates.includes(source.asOf)) dates.push(source.asOf);
    seen.set(source.label, dates);
  }
  return [...seen].map(([label, dates]) => {
    const latest = [...dates].sort().at(-1);
    return latest ? `${label}, as of ${readerAsOf(latest)}` : label;
  }).join("; ");
}

/** One exhibit's columns and rows; null for a kind the brief does not table. */
function tableOf(x: Exhibit): { columns: string[]; rows: string[][] } | null {
  switch (x.kind) {
    case "fee_position":
      return {
        columns: ["Figure", "Amount", "Institutions"],
        rows: [
          ...(x.own !== null ? [[x.ownLabel, fee(x.own), "1"]] : []),
          ["Peer median", fee(x.band.median), count(x.band.n)],
          ["Peers' middle half", `${fee(x.band.p25)} to ${fee(x.band.p75)}`, count(x.band.n)],
          ...x.markers.filter((m) => m.scope !== "peer").map((m) => [m.label, fee(m.value), count(m.n)]),
        ],
      };
    case "competitor_range": {
      const items = [...x.items, ...(x.rest ?? [])];
      return {
        columns: ["Institution", "Fee", "Local deposits"],
        rows: [
          ...(x.own !== null ? [[x.ownLabel, fee(x.own), ""]] : []),
          ...items.map((i) => [i.name, statedFeeText(i.amount, i.several, (n) => fee(n)), i.deposits ? formatDollarsInWords(i.deposits) : ""]),
        ],
      };
    }
    case "trend":
      return {
        columns: ["Series", "Date", "Value"],
        rows: x.series.flatMap((s) => s.points.map((p) => [s.label, readerAsOf(p.date), x.unit === "percent" ? `${Number(p.value.toFixed(1))}%` : fee(p.value)])),
      };
    case "structure_matrix":
      return {
        columns: ["Institution", ...x.columns],
        rows: x.rows.map((r) => [r.name, ...r.cells.map((c) => c ?? "Not listed")]),
      };
    case "money_at_stake":
      return {
        columns: ["Measure", "Dollars a year"],
        rows: x.rows.map((r) => [r.label, r.low === r.high ? formatDollarsInWords(r.low) : `${formatDollarsInWords(r.low)} to ${formatDollarsInWords(r.high)}`]),
      };
    case "archetype_map":
      return {
        columns: ["Pricing group", "Rule", "Institutions", "Names"],
        rows: x.archetypes.map((a) => [`${a.label}${a.key === x.ownKey ? " (this institution)" : ""}`, a.rule, count(a.count), a.names.join(", ") || "None"]),
      };
    case "segment_table":
      return {
        columns: ["Institution", "Fee", "State"],
        rows: [
          ...(x.own !== null ? [[x.ownLabel, fee(x.own), ""]] : []),
          ...x.members.map((m) => [m.institutionName, fee(m.amount), m.stateCode ?? ""]),
        ],
      };
    case "change_timeline":
      return {
        columns: ["Date", "Institution", "From", "To"],
        rows: x.events.map((e) => [readerAsOf(e.date), e.institutionName, fee(e.from), fee(e.to)]),
      };
    case "peer_list":
      return {
        columns: ["Institution", x.feeLabel, "State"],
        rows: x.rows.map((r) => [r.institutionName, peerListFeeText(r, fee), r.stateCode ?? ""]),
      };
    default:
      return null;
  }
}

/** The fee schedules a competitor's fee comes from, when its exhibit names only the market's source. */
export const COMPETITOR_FEE_SOURCE = "Bank Fee Index, published fee schedules";
const MARKET_SOURCE = /summary of deposits/i;

/**
 * The exhibit's sources line, from "Source: " on. A local competitor table's fees come from published fee schedules; the
 * FDIC Summary of Deposits only sets the market and each competitor's local deposits, so it is
 * labelled as that and never stands as the fees' source.
 */
function exhibitSources(x: Exhibit): string {
  if (x.kind !== "competitor_range") {
    const line = sourcesLine(x.sources);
    return line ? `Source: ${line}` : "";
  }
  const market = x.sources.filter((s) => MARKET_SOURCE.test(s.label));
  const fees = x.sources.filter((s) => !MARKET_SOURCE.test(s.label));
  return `Sources: ${[
    `fees from ${fees.length ? sourcesLine(fees) : COMPETITOR_FEE_SOURCE}`,
    ...(market.length ? [`market and deposits from ${sourcesLine(market)}`] : []),
  ].join("; ")}`;
}

/** One storyline exhibit as a brief table: its point as the title, its chart's own title and sources beneath. */
export function storyExhibitTable(item: StoryExhibit): ReportExhibit | null {
  const table = tableOf(item.exhibit);
  if (!table || !table.rows.length) return null;
  const x = item.exhibit;
  const sources = exhibitSources(x);
  const unlisted = x.kind === "peer_list" && x.unlisted > 0
    ? `${count(x.unlisted)} more ${x.unlisted === 1 ? "peer in this group is" : "peers in this group are"} not shown.`
    : null;
  return {
    id: "answer_exhibit",
    title: item.actionTitle,
    subtitle: [x.title, sources || null].filter(Boolean).join(" · "),
    columns: table.columns,
    rows: table.rows,
    note: [x.note, unlisted].filter(Boolean).join(" ") || null,
  };
}

/** Every exhibit of a saved storyline, in its reading order, as brief tables. */
export function storyExhibitTables(story: Storyline | null | undefined): ReportExhibit[] {
  return (story?.exhibits ?? []).flatMap((item) => {
    const table = storyExhibitTable(item);
    return table ? [table] : [];
  });
}
