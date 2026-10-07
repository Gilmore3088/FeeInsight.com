/**
 * AnalysisPdfDocument — @react-pdf/renderer document component for Analyze screen exports.
 * Server-side ONLY. Never import this in client components.
 * Called from /api/pro/report-pdf route only (via type: "analysis" dispatch).
 *
 * Design: Mirrors PdfDocument.tsx brand palette — same COLORS, same StyleSheet patterns.
 * No CSS variables (react-pdf cannot resolve them).
 */
import {
  Document,
  Font,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { AnalyzeResponse } from "@/lib/hamilton/types";
import { HAMILTON_ATTRIBUTION } from "@/lib/constants";
import type { AnswerBrief } from "@/lib/hamilton/answer-brief";
import type { IncomeSplit } from "@/lib/hamilton/workspace/why";
import { CompetitorBars, FeeRangeChart, IncomeCompareBars, IncomeTrendChart, MarketShareBars, UnemploymentChart } from "./BriefCharts";
import { headFigure, humanizeAnswerText, shapeHamiltonView, splitSentences, tidyEvidence } from "@/components/hamilton/analyze/parse-response";

// Words wrap whole; react-pdf's default hyphenation broke figures and words mid-way ("medi-an").
Font.registerHyphenationCallback((word) => [word]);

// ─── Brand Colors ─────────────────────────────────────────────────────────────
// Exact copy from PdfDocument.tsx — do not use CSS variables here.

const COLORS = {
  textPrimary: "#1c1917",
  textSecondary: "#78716c",
  textTertiary: "#a8a29e",
  accent: "#b45309",
  surface: "#fbf9f4",
  surfaceElevated: "#f5f1e8",
  borderDark: "#d6d0c5",
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    backgroundColor: COLORS.surface,
    paddingTop: 64,
    paddingBottom: 64,
    paddingLeft: 72,
    paddingRight: 72,
    fontFamily: "Helvetica",
  },
  header: {
    marginBottom: 20,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderDark,
    borderBottomStyle: "solid",
  },
  reportTypeBadge: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.accent,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  reportTitle: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    lineHeight: 1.2,
    marginBottom: 8,
  },
  readOnlyNotice: {
    fontSize: 8,
    color: COLORS.textTertiary,
    fontFamily: "Helvetica",
  },
  section: {
    marginBottom: 22,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderDark,
    borderBottomStyle: "solid",
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
  // The closing section carries no rule or trailing space, which would spill onto a blank page.
  lastSection: {
    marginBottom: 0,
  },
  briefTitle: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    marginBottom: 14,
  },
  table: {
    marginTop: 10,
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
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  tileComparison: {
    fontSize: 8.5,
    fontFamily: "Helvetica",
    color: COLORS.textSecondary,
    lineHeight: 1.4,
  },
  bulletRow: {
    flexDirection: "row",
    marginBottom: 5,
  },
  bulletMark: {
    width: 12,
    fontSize: 10.5,
    color: COLORS.accent,
    lineHeight: 1.55,
  },
  bulletText: {
    flex: 1,
    fontSize: 10.5,
    fontFamily: "Helvetica",
    color: COLORS.textPrimary,
    lineHeight: 1.55,
  },
  evidenceRow: {
    flexDirection: "row",
    gap: 14,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.borderDark,
    borderBottomStyle: "solid",
  },
  evidenceLabel: {
    width: "34%",
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    lineHeight: 1.4,
    paddingTop: 1,
  },
  evidenceBody: {
    flex: 1,
  },
  evidenceValue: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    lineHeight: 1.4,
  },
  evidenceNote: {
    fontSize: 9,
    fontFamily: "Helvetica",
    color: COLORS.textSecondary,
    lineHeight: 1.45,
    marginTop: 2,
  },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 72,
    right: 72,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderDark,
    borderTopStyle: "solid",
    paddingTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 8,
    fontFamily: "Helvetica",
    color: COLORS.textTertiary,
  },
});

// ─── Component ────────────────────────────────────────────────────────────────

interface AnalysisPdfDocumentProps {
  analysis: AnalyzeResponse;
  analysisFocus: string;
  institutionName?: string;
  /** The institution's standing figures from the engine, printed after the answer. */
  brief?: AnswerBrief | null;
}



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

export function AnalysisPdfDocument({
  analysis,
  analysisFocus,
  institutionName,
  brief,
}: AnalysisPdfDocumentProps) {
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // The title is the answer's whole first sentence (older answers saved an 80-character cut);
  // the view below carries the rest, so the lead is not printed twice.
  const view = shapeHamiltonView(humanizeAnswerText(analysis.hamiltonView));
  const title = view.lead || analysis.title;
  const hamiltonViewParagraphs = view.paragraphs;
  const evidence = tidyEvidence(analysis.evidence.metrics);
  // Up to three Evidence rows that open with a figure become key-figure tiles under the title;
  // the rest stay in the Evidence table, so no figure is printed twice.
  const tiles = evidence
    .map((metric) => ({ metric, head: headFigure(metric.value) }))
    .filter((t): t is { metric: (typeof evidence)[number]; head: NonNullable<ReturnType<typeof headFigure>> } => t.head !== null && Boolean(t.metric.label))
    .slice(0, 3);
  const tableRows = evidence.filter((m) => !tiles.some((t) => t.metric === m));
  // Implications longer than three sentences read as a list of points, not a block.
  const meaningSentences = splitSentences(humanizeAnswerText(analysis.whatThisMeans ?? ""));
  const meaningAsList = meaningSentences.length > 3;
  const fin = brief?.financials ?? null;
  const incomeLines = brief?.income ? splitSentences(brief.income.explained.shortAnswer) : [];
  const economy = brief?.context?.economy ?? null;
  const market = brief?.context?.market ?? null;
  const localIncome = brief?.context?.localIncome ?? null;
  const incomeTiles = brief?.income ? incomeFigures(brief.income.split) : [];
  // The sentence after the income, price and share figures: what the split means. The tiles carry the figures.
  const incomeTakeaway = incomeLines.length > 3 ? incomeLines[3] : null;
  const hasBrief = Boolean(brief && (brief.positions.length > 0 || incomeLines.length > 0 || (fin && fin.quarters.length > 0)));

  const readOnlyLine = institutionName
    ? `Generated by ${HAMILTON_ATTRIBUTION} | ${institutionName}`
    : `Generated by ${HAMILTON_ATTRIBUTION}`;

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.reportTypeBadge}>{analysisFocus} Analysis</Text>
          <Text style={styles.reportTitle}>{title}</Text>
          <Text style={styles.readOnlyNotice}>{readOnlyLine}</Text>
        </View>

        {/* Key figures */}
        {tiles.length > 0 ? (
          <View style={styles.tileRow} wrap={false}>
            {tiles.map(({ metric, head }, i) => (
              <View key={i} style={styles.tile}>
                <Text style={styles.tileLabel}>{metric.label}</Text>
                <Text style={styles.tileFigure}>{head.figure}</Text>
                <Text style={styles.tileComparison}>{head.comparison}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Hamilton's View */}
        {hamiltonViewParagraphs.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading} minPresenceAhead={60}>{"Hamilton's View"}</Text>
            {hamiltonViewParagraphs.map((para, i) => (
              <Text key={i} style={styles.paragraph}>
                {para}
              </Text>
            ))}
          </View>
        ) : null}

        {/* What This Means */}
        {meaningSentences.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading} minPresenceAhead={60}>What This Means</Text>
            {meaningAsList ? (
              meaningSentences.map((sentence, i) => (
                <View key={i} style={styles.bulletRow} wrap={false}>
                  <Text style={styles.bulletMark}>{"\u2022"}</Text>
                  <Text style={styles.bulletText}>{sentence}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.paragraph}>{meaningSentences.join(" ")}</Text>
            )}
          </View>
        ) : null}

        {/* Why It Matters */}
        {analysis.whyItMatters.length > 0 ? (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionHeading}>Why It Matters</Text>
            {analysis.whyItMatters.map((item, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.bulletMark}>{"\u2022"}</Text>
                <Text style={styles.bulletText}>{humanizeAnswerText(item)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Evidence: a two-column table, one row per figure, never split across a page */}
        {tableRows.length > 0 ? (
          <View style={styles.lastSection}>
            {tableRows.map((metric, i) => (
              <View key={i} wrap={false}>
                {/* The heading travels with the first row so it never sits alone at a page foot. */}
                {i === 0 ? <Text style={styles.sectionHeading}>{tiles.length > 0 ? "More Evidence" : "Evidence"}</Text> : null}
                <View style={styles.evidenceRow}>
                  <Text style={styles.evidenceLabel}>{metric.label}</Text>
                  <View style={styles.evidenceBody}>
                    <Text style={styles.evidenceValue}>{metric.value}</Text>
                    {metric.note ? <Text style={styles.evidenceNote}>{metric.note}</Text> : null}
                  </View>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* The institution's standing figures, from the engine, drawn as charts */}
        {hasBrief && brief ? (
          <View break>
            <Text style={styles.reportTypeBadge}>From the Bank Fee Index and call reports</Text>
            <Text style={styles.briefTitle}>{institutionName ? `${institutionName} at a glance` : "At a glance"}</Text>

            {brief.positions.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionHeading} minPresenceAhead={80}>Where each fee sits against peers</Text>
                <FeeRangeChart positions={brief.positions.slice(0, RANGE_CHART_FEES)} bands={brief.bands} />
                <Text style={styles.tableSource}>
                  Published fee schedules, verified and live; each fee against the narrowest default peer group with enough institutions publishing it. Peer count in brackets.
                  {brief.positions.length > RANGE_CHART_FEES ? ` The ${brief.positions.length - RANGE_CHART_FEES} other compared fees sit closer to their medians.` : ""}
                  {brief.uncompared > 0 ? ` ${brief.uncompared} more ${brief.uncompared === 1 ? "fee has" : "fees have"} too few peers publishing to compare.` : ""}
                </Text>
              </View>
            ) : null}

            {incomeLines.length > 0 || (fin && fin.quarters.length > 0) ? (
              <View style={styles.section}>
                <Text style={styles.sectionHeading} minPresenceAhead={160}>Fee income against peers</Text>
                {incomeTiles.length > 0 ? (
                  <View style={styles.tileRow} wrap={false}>
                    {incomeTiles.map((tile) => (
                      <View key={tile.label} style={styles.tile}>
                        <Text style={styles.tileLabel}>{tile.label}</Text>
                        <Text style={styles.tileFigure}>{tile.figure}</Text>
                        <Text style={styles.tileComparison}>{tile.comparison}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {incomeTakeaway ? <Text style={styles.paragraph}>{incomeTakeaway}</Text> : null}
                {fin && fin.quarters.length > 0 ? (
                  <View style={styles.table} wrap={false}>
                    <IncomeTrendChart financials={fin} />
                    <Text style={styles.tableSource}>
                      {fin.sourceRef.label}. Call reports do not separate how often from which fees are charged for most filers.
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {economy ? (
              <View style={styles.section}>
                <Text style={styles.sectionHeading} minPresenceAhead={160}>
                  {economy.districtName ? `The ${economy.place} and ${economy.districtName} Fed district economy` : `The ${economy.place} economy`}
                </Text>
                {economy.tiles.length > 0 ? (
                  <View style={styles.tileRow} wrap={false}>
                    {economy.tiles.map((tile) => (
                      <View key={tile.label} style={styles.tile}>
                        <Text style={styles.tileLabel}>{tile.label}</Text>
                        <Text style={styles.tileFigure}>{tile.figure}</Text>
                        <Text style={styles.tileComparison}>{tile.comparison}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
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
              </View>
            ) : null}

            {market || localIncome ? (
              <View style={styles.section}>
                <Text style={styles.sectionHeading} minPresenceAhead={160}>Your local market</Text>
                {market ? (
                  <>
                    <MarketShareBars shares={market.shares} />
                    <Text style={[styles.paragraph, { marginTop: 8 }]}>{market.commentary.join(" ")}</Text>
                    <Text style={styles.tableSource}>
                      FDIC Summary of Deposits, {market.sodYear}, branches in {market.places.join("; ")}. HHI is the sum of squared deposit shares.
                    </Text>
                  </>
                ) : null}
                {localIncome ? (
                  <>
                    <IncomeCompareBars counties={localIncome.counties} state={localIncome.state} />
                    <Text style={[styles.paragraph, { marginTop: 8 }]}>{localIncome.commentary.join(" ")}</Text>
                    <Text style={styles.tableSource}>U.S. Census Bureau, American Community Survey 5-year estimates, {localIncome.year}.</Text>
                  </>
                ) : null}
              </View>
            ) : null}

            {brief.competitors.length > 0 ? (
              <View style={styles.lastSection}>
                {brief.competitors.map((item, i) => (
                  <View key={item.feeCategory} wrap={false}>
                    {i === 0 ? <Text style={styles.sectionHeading}>Local competitors</Text> : null}
                    <CompetitorBars item={item} />
                  </View>
                ))}
                <Text style={styles.tableSource}>
                  Institutions with branches in the market, largest local deposits first (FDIC Summary of Deposits); prices from their published fee schedules.
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{HAMILTON_ATTRIBUTION}</Text>
          <Text style={styles.footerText}>{today}</Text>
        </View>
      </Page>
    </Document>
  );
}
