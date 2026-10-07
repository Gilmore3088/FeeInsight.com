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
import { formatDollarsInWords, formatFeeAmount } from "@/lib/format";
import type { AnswerBrief } from "@/lib/hamilton/answer-brief";
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
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.textSecondary,
    borderBottomStyle: "solid",
    paddingBottom: 4,
    marginBottom: 2,
  },
  th: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  tr: {
    flexDirection: "row",
    paddingTop: 3,
    paddingBottom: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.borderDark,
    borderBottomStyle: "solid",
  },
  td: {
    fontSize: 9.5,
    fontFamily: "Helvetica",
    color: COLORS.textPrimary,
  },
  tdNum: {
    fontSize: 9.5,
    fontFamily: "Helvetica",
    color: COLORS.textPrimary,
    textAlign: "right",
  },
  colWide: {
    flex: 2.2,
    paddingRight: 6,
  },
  colNum: {
    flex: 1,
    textAlign: "right",
    paddingLeft: 4,
  },
  tableSource: {
    fontSize: 7.5,
    color: COLORS.textTertiary,
    marginTop: 6,
    lineHeight: 1.4,
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

const fee = (n: number): string => formatFeeAmount(n) ?? `$${n}`;

function quarterLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
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
  const peerByQuarter = new Map((fin?.peerMedian?.quarters ?? []).map((q) => [q.quarterEnd, q]));
  const incomeLines = brief?.income ? splitSentences(brief.income.explained.shortAnswer) : [];
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

        {/* The institution's standing figures, from the engine */}
        {hasBrief && brief ? (
          <View break>
            <Text style={styles.reportTypeBadge}>From the Bank Fee Index and call reports</Text>
            <Text style={styles.briefTitle}>{institutionName ? `${institutionName} at a glance` : "At a glance"}</Text>

            {incomeLines.length > 0 || (fin && fin.quarters.length > 0) ? (
              <View style={styles.section}>
                <Text style={styles.sectionHeading} minPresenceAhead={80}>Fee income against peers</Text>
                {incomeLines.map((line, i) => (
                  <View key={i} style={styles.bulletRow} wrap={false}>
                    <Text style={styles.bulletMark}>{"\u2022"}</Text>
                    <Text style={styles.bulletText}>{line}</Text>
                  </View>
                ))}
                {fin && fin.quarters.length > 0 ? (
                  <View style={styles.table} wrap={false}>
                    <View style={styles.tableHead}>
                      <Text style={[styles.th, styles.colWide]}>Quarter</Text>
                      <Text style={[styles.th, styles.colNum]}>{fin.label.split(" (")[0]}</Text>
                      <Text style={[styles.th, styles.colNum]}>{fin.peerMedian ? `Median, ${fin.peerMedian.label}` : "Peer median"}</Text>
                    </View>
                    {fin.quarters.map((q) => {
                      const peer = peerByQuarter.get(q.quarterEnd);
                      return (
                        <View key={q.quarterEnd} style={styles.tr}>
                          <Text style={[styles.td, styles.colWide]}>{quarterLabel(q.quarterEnd)}</Text>
                          <Text style={[styles.tdNum, styles.colNum]}>{formatDollarsInWords(q.amount)}</Text>
                          <Text style={[styles.tdNum, styles.colNum]}>{peer ? `${formatDollarsInWords(peer.amount)} (${peer.institutions})` : "Not on file"}</Text>
                        </View>
                      );
                    })}
                    <Text style={styles.tableSource}>
                      {[fin.sourceRef.label, fin.peerMedian?.sourceRef.label].filter(Boolean).join(". ")}.
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {brief.positions.length > 0 ? (
              <View style={styles.lastSection}>
                {brief.positions.map((p, i) => (
                  <View key={p.feeCategory} wrap={false}>
                    {i === 0 ? (
                      <>
                        <Text style={styles.sectionHeading}>Every fee against its peer median</Text>
                        <View style={styles.tableHead}>
                          <Text style={[styles.th, styles.colWide]}>Fee</Text>
                          <Text style={[styles.th, styles.colNum]}>Yours</Text>
                          <Text style={[styles.th, styles.colNum]}>Peer median</Text>
                          <Text style={[styles.th, styles.colNum]}>Peers</Text>
                          <Text style={[styles.th, styles.colNum]}>Against median</Text>
                        </View>
                      </>
                    ) : null}
                    <View style={styles.tr}>
                      <Text style={[styles.td, styles.colWide]}>{p.displayName}</Text>
                      <Text style={[styles.tdNum, styles.colNum]}>{fee(p.current)}</Text>
                      <Text style={[styles.tdNum, styles.colNum]}>{fee(p.peerMedian)}</Text>
                      <Text style={[styles.tdNum, styles.colNum]}>{p.peerCount}</Text>
                      <Text style={[styles.tdNum, styles.colNum]}>
                        {p.direction === "at" ? "At median" : `${fee(Math.abs(Math.round((p.current - p.peerMedian) * 100) / 100))} ${p.direction}`}
                      </Text>
                    </View>
                    {/* The source line travels with the last row, so it never lands alone on a page. */}
                    {i === brief.positions.length - 1 ? (
                      <Text style={styles.tableSource}>
                        Published fee schedules, verified and live; each fee against the narrowest default peer group with enough institutions publishing it.
                        {brief.uncompared > 0 ? ` ${brief.uncompared} more ${brief.uncompared === 1 ? "fee has" : "fees have"} too few peers publishing to compare.` : ""}
                      </Text>
                    ) : null}
                  </View>
                ))}
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
