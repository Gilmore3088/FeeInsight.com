/**
 * The institution's standing figures, drawn as charts after an exported answer or report: fees
 * against peers, fee income, the state and Fed district economy, the local market and local
 * competitors. Server-side only (react-pdf). Starts on a new page.
 */
import { StyleSheet, Text, View } from "@react-pdf/renderer";
import type { AnswerBrief } from "@/lib/hamilton/answer-brief";
import type { IncomeSplit } from "@/lib/hamilton/workspace/why";
import { splitSentences } from "@/components/hamilton/analyze/parse-response";
import { CompetitorBars, DependenceTrendChart, FeeRangeChart, IncomeCompareBars, IncomeTrendChart, MarketShareBars, UnemploymentChart } from "./BriefCharts";
import { RD_PDF } from "@/lib/report-design/tokens";

const COLORS = RD_PDF;

const styles = StyleSheet.create({
  reportTypeBadge: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.accent,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  sectionHeading: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    marginBottom: 12,
    lineHeight: 1.3,
  },
  paragraph: {
    fontSize: 10.5,
    fontFamily: "Helvetica",
    color: COLORS.textPrimary,
    lineHeight: 1.6,
    marginBottom: 10,
  },
  // Sections are siblings, not wrapping Views: react-pdf moves a whole nested View holding an
  // unbreakable chart to the next page, leaving the page before it half empty.
  sectionRule: {
    marginTop: 18,
    marginBottom: 22,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderDark,
    borderBottomStyle: "solid",
  },
  briefTitle: {
    fontSize: 19,
    fontFamily: "Times-Bold",
    color: COLORS.textPrimary,
    marginBottom: 14,
  },
  table: {
    marginTop: 10,
  },
  studyItem: {
    marginTop: 10,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.accent,
    borderLeftStyle: "solid",
  },
  studyHeadline: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    lineHeight: 1.45,
    marginBottom: 3,
  },
  studyFact: {
    fontSize: 9,
    color: COLORS.textSecondary,
    lineHeight: 1.45,
  },
  tableSource: {
    fontSize: 7.5,
    color: COLORS.textTertiary,
    marginTop: 6,
    lineHeight: 1.4,
  },
  quote: {
    marginTop: 10,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: "#b45309",
    borderLeftStyle: "solid",
  },
  quoteLabel: {
    fontSize: 7.5,
    color: "#78716c",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  quoteText: {
    fontSize: 9.5,
    lineHeight: 1.5,
    color: "#1c1917",
    fontFamily: "Helvetica-Oblique",
  },
  tileRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 28,
  },
  tile: {
    flex: 1,
    backgroundColor: COLORS.surfaceElevated,
    padding: 12,
    borderRadius: 4,
  },
  tileLabel: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6,
    lineHeight: 1.3,
  },
  tileFigure: {
    fontSize: 20,
    fontFamily: "Times-Roman",
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  tileComparison: {
    fontSize: 8.5,
    fontFamily: "Helvetica",
    color: COLORS.textSecondary,
    lineHeight: 1.4,
  },
});

/** Fees drawn on the range chart, furthest from their medians first; the rest are counted under it. */
const RANGE_CHART_FEES = 12;

/** Income, price and the price share as key-figure tiles. */
function incomeFigures(split: IncomeSplit): { label: string; figure: string; comparison: string }[] {
  const pctOf = (gap: number) => `${Math.round(Math.abs(gap) * 100)}% ${gap < 0 ? "lower" : "higher"}`;
  const tiles = [
    {
      label: "Service charges per $1,000 of deposits",
      figure: `$${split.own.toFixed(2)}`,
      comparison: `vs $${split.peerMedian.toFixed(2)} median, ${split.peers.toLocaleString("en-US")} ${split.peerLabel}`,
    },
  ];
  if (split.priceGap !== null) {
    tiles.push({
      label: "Published prices against peer medians",
      figure: Math.abs(split.priceGap) < 0.01 ? "At median" : pctOf(split.priceGap),
      comparison: `average across ${split.priceFees} compared fees`,
    });
  }
  if (split.priceShare !== null) {
    tiles.push({
      label: "Share of the income gap from price",
      figure: `About ${split.priceShare}%`,
      comparison: split.priceShare >= 100 ? "price accounts for all of it" : "the rest is how often and which fees are charged",
    });
  }
  return tiles;
}

/** True when the brief has anything to draw. */
export function hasBriefContent(brief: AnswerBrief | null | undefined): brief is AnswerBrief {
  if (!brief) return false;
  const lines = brief.income ? splitSentences(brief.income.explained.shortAnswer) : [];
  return brief.positions.length > 0 || lines.length > 0 || Boolean(brief.financials && brief.financials.quarters.length > 0);
}

export function BriefPages({ brief, institutionName }: { brief: AnswerBrief; institutionName?: string }) {
  const subjectName = institutionName || "Research institution";
  const fin = brief.financials ?? null;
  const incomeLines = brief.income ? splitSentences(brief.income.explained.shortAnswer) : [];
  const economy = brief.context?.economy ?? null;
  const market = brief.context?.market ?? null;
  const localIncome = brief.context?.localIncome ?? null;
  const incomeTiles = brief.income ? incomeFigures(brief.income.split) : [];
  // The sentence after the income, price and share figures: what the split means. The tiles carry the figures.
  const incomeTakeaway = incomeLines.length > 3 ? incomeLines[3] : null;
  return (
    <View break>
      <Text style={styles.reportTypeBadge}>From the Bank Fee Index and call reports</Text>
      <Text style={styles.briefTitle}>{institutionName ? `${institutionName} at a glance` : "At a glance"}</Text>

      {brief.positions.length > 0 ? (
        <>
          <View wrap={false}>
            <Text style={styles.sectionHeading}>Where each fee sits against peers</Text>
            <FeeRangeChart positions={brief.positions.slice(0, RANGE_CHART_FEES)} bands={brief.bands} institutionName={subjectName} />
          </View>
          <Text style={styles.tableSource}>
            Published fee schedules, verified and live; each fee against the narrowest default peer group with enough institutions publishing it. Peer count in brackets.
            {brief.positions.length > RANGE_CHART_FEES ? ` The ${brief.positions.length - RANGE_CHART_FEES} other compared fees sit closer to their medians.` : ""}
            {brief.uncompared > 0 ? ` ${brief.uncompared} more ${brief.uncompared === 1 ? "fee has" : "fees have"} too few peers publishing to compare.` : ""}
          </Text>
          <View style={styles.sectionRule} />
        </>
      ) : null}

      {incomeLines.length > 0 || (fin && fin.quarters.length > 0) ? (
        <>
          <View wrap={false}>
            <Text style={styles.sectionHeading}>Fee income against peers</Text>
            {incomeTiles.length > 0 ? (
              <View style={styles.tileRow}>
                {incomeTiles.map((tile) => (
                  <View key={tile.label} style={styles.tile}>
                    <Text style={styles.tileLabel}>{tile.label}</Text>
                    <Text style={styles.tileFigure}>{tile.figure}</Text>
                    <Text style={styles.tileComparison}>{tile.comparison}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          {incomeTakeaway ? <Text style={styles.paragraph}>{incomeTakeaway}</Text> : null}
          {fin && fin.quarters.length > 0 ? (
            <View style={styles.table} wrap={false}>
              <IncomeTrendChart financials={fin} institutionName={subjectName} />
              <Text style={styles.tableSource}>
                {fin.sourceRef.label}. Call reports do not separate how often from which fees are charged for most filers.
              </Text>
            </View>
          ) : null}
          <View style={styles.sectionRule} />
        </>
      ) : null}

      {economy ? (
        <>
          <View wrap={false}>
            <Text style={styles.sectionHeading}>
              {economy.districtName ? `The ${economy.place} and ${economy.districtName} Fed district economy` : `The ${economy.place} economy`}
            </Text>
            {economy.tiles.length > 0 ? (
              <View style={styles.tileRow}>
                {economy.tiles.map((tile) => (
                  <View key={tile.label} style={styles.tile}>
                    <Text style={styles.tileLabel}>{tile.label}</Text>
                    <Text style={styles.tileFigure}>{tile.figure}</Text>
                    <Text style={styles.tileComparison}>{tile.comparison}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          {economy.unemployment.length > 1 ? <UnemploymentChart points={economy.unemployment} place={economy.place} /> : null}
          {economy.commentary.length > 0 ? <Text style={[styles.paragraph, { marginTop: 10 }]}>{economy.commentary.join(" ")}</Text> : null}
          {economy.beigeBook ? (
            <View style={styles.quote} wrap={false}>
              <Text style={styles.quoteLabel}>
                Federal Reserve Beige Book, {economy.districtName ?? "district"} district, {economy.beigeBook.releaseDate}, {economy.beigeBook.section}
              </Text>
              <Text style={styles.quoteText}>{`\u201C${economy.beigeBook.quote}\u201D`}</Text>
            </View>
          ) : null}
          {economy.fomc ? (
            <View style={styles.quote} wrap={false}>
              <Text style={styles.quoteLabel}>Federal Open Market Committee minutes, meeting of {economy.fomc.meetingDate}</Text>
              <Text style={styles.quoteText}>{`\u201C${economy.fomc.text}\u201D`}</Text>
            </View>
          ) : null}
          <Text style={styles.tableSource}>Sources: {economy.sources.join("; ")}.</Text>
          <View style={styles.sectionRule} />
        </>
      ) : null}

      {market || localIncome ? (
        <>
          {market ? (
            <>
              <View wrap={false}>
                <Text style={styles.sectionHeading}>{subjectName} local market</Text>
                <MarketShareBars shares={market.shares} />
              </View>
              <Text style={[styles.paragraph, { marginTop: 8 }]}>{market.commentary.join(" ")}</Text>
              <Text style={styles.tableSource}>
                FDIC Summary of Deposits, {market.sodYear}, branches in {market.places.join("; ")}. HHI is the sum of squared deposit shares.
              </Text>
            </>
          ) : null}
          {!market ? <Text style={styles.sectionHeading}>{subjectName} local market</Text> : null}
          {localIncome ? (
            <>
              <IncomeCompareBars counties={localIncome.counties} state={localIncome.state} />
              <Text style={[styles.paragraph, { marginTop: 8 }]}>{localIncome.commentary.join(" ")}</Text>
              <Text style={styles.tableSource}>U.S. Census Bureau, American Community Survey 5-year estimates, {localIncome.year}.</Text>
            </>
          ) : null}
        </>
      ) : null}

      {brief.competitors.length > 0 ? (
        <>
          {brief.competitors.map((item, i) => (
            <View key={item.feeCategory} wrap={false}>
              {i === 0 ? <Text style={styles.sectionHeading}>Local competitors</Text> : null}
              <CompetitorBars item={item} institutionName={subjectName} />
            </View>
          ))}
          <Text style={styles.tableSource}>
            Institutions with branches in the market, largest local deposits first (FDIC Summary of Deposits); prices from their published fee schedules.
          </Text>
        </>
      ) : null}

      {brief.studies && (brief.studies.items.length > 0 || brief.studies.dependence) ? (
        <>
          <View style={styles.sectionRule} />
          <View wrap={false}>
            <Text style={styles.sectionHeading}>{subjectName} in Hamilton&apos;s studies</Text>
            {brief.studies.dependence ? <DependenceTrendChart chart={brief.studies.dependence} institutionName={subjectName} /> : null}
          </View>
          {brief.studies.items.map((o) => (
            <View key={o.id} style={styles.studyItem} wrap={false}>
              <Text style={styles.studyHeadline}>{o.headline}</Text>
              {o.facts.map((f) => (
                <Text key={f.text} style={styles.studyFact}>
                  {f.text}
                </Text>
              ))}
            </View>
          ))}
          <Text style={styles.tableSource}>
            Hamilton studies: {[...new Set(brief.studies.items.flatMap((o) => o.facts.map((f) => `${f.source.label.replace("Hamilton study: ", "")} (${f.source.asOf ?? "current"})`)))].join("; ")}. Built from FDIC and NCUA call reports, FDIC Summary of Deposits, Census household income and published fee schedules. Inferred figures are labelled and never reported.
          </Text>
        </>
      ) : null}
    </View>
  );
}
