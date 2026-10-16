import type { MarketReport } from "@/lib/custom-report/report-data";
import { placeLabel } from "@/app/market-report/report-body";
import { verifiedSourceQuote } from "./sample-sources";
import {
  MIN_MEDIAN_INSTITUTIONS,
  latestReadOn,
  leadLineKey,
  shortInstitutionName,
  type BoardLine,
  type BoardPeer,
  type CompetitorBoard,
} from "./board-math";

/** Fee lines the workspace exhibits offer, in the order a pricing committee asks about them. */
export const BOARD_LINE_ORDER = [
  "overdraft",
  "nsf",
  "monthly_maintenance",
  "stop_payment",
  "wire_domestic_outgoing",
  "wire_intl_outgoing",
  "card_replacement",
  "deposited_item_return",
  "paper_statement",
] as const;
export const BOARD_MAX_LINES = 6;

/**
 * The live sample report as the workspace's competitor view: each comparable fee line with the
 * institution's own fee and every local competitor that publishes it, by name. A line naming
 * fewer than MIN_MEDIAN_INSTITUTIONS competitors is left out, so no median rests on a thin
 * sample. Null when no line qualifies or there is no live sample.
 */
export function buildCompetitorBoard(report: MarketReport | null): CompetitorBoard | null {
  if (!report) return null;
  const { data, analysis } = report;
  const names = new Map<number, string>(data.competitors.map((c) => [c.institution_id, c.institution_name]));
  const rank = (key: string) => {
    const i = (BOARD_LINE_ORDER as readonly string[]).indexOf(key);
    return i < 0 ? BOARD_LINE_ORDER.length : i;
  };
  const lines: BoardLine[] = [];
  const readDates: (string | null)[] = [];
  for (const line of [...analysis.lines].sort((a, b) => rank(a.key) - rank(b.key))) {
    if (!line.comparable || !line.own || !line.peers || !line.position) continue;
    const peers: BoardPeer[] = [];
    for (const figure of line.peerFigures) {
      const name = names.get(figure.institution_id);
      if (name) peers.push({ id: figure.institution_id, name: shortInstitutionName(name), amount: figure.amount });
    }
    // The count ("N of M charge less") and the quartiles must rest on the same institutions: a
    // line shows only when every competitor behind the report's quartiles can be named here.
    if (peers.length !== line.peers.n || peers.length < MIN_MEDIAN_INSTITUTIONS) continue;
    readDates.push(line.own.schedule_read_on, ...line.peerFigures.map((figure) => figure.schedule_read_on));
    lines.push({
      key: line.key,
      // The sample report's own line name, without its qualifier: "Overdraft (per item)" reads "Overdraft".
      label: line.label.replace(/\s*\([^)]*\)$/, ""),
      own: line.own.amount,
      quote: verifiedSourceQuote(line),
      readOn: line.own.schedule_read_on,
      peers,
      median: line.peers.median,
      p25: line.peers.p25,
      p75: line.peers.p75,
      position: line.position,
    });
    if (lines.length >= BOARD_MAX_LINES) break;
  }
  if (lines.length === 0) return null;
  const market = data.market;
  const marketLabel =
    market && market.places.length > 0
      ? `${placeLabel(market.places[0])} area${market.county_fips.length > 1 ? ` (${market.county_fips.length} counties)` : ""}`
      : null;
  return {
    institutionName: data.subject.institution_name,
    marketLabel,
    competitorsWithData: analysis.readiness.competitorsWithData,
    lines,
    leadKey: leadLineKey(lines) ?? lines[0].key,
    readOn: latestReadOn(readDates),
  };
}
