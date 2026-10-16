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
import { BriefPages, hasBriefContent } from "./BriefPages";
import { headFigure, humanizeAnswerText, shapeHamiltonView, splitSentences, tidyEvidence } from "@/components/hamilton/analyze/parse-response";
import { RD_PDF } from "@/lib/report-design/tokens";
import { hamiltonIdentityLines, readHamiltonIdentitySnapshot } from "@/lib/hamilton/identity-display";

// Words wrap whole; react-pdf's default hyphenation broke figures and words mid-way ("medi-an").
Font.registerHyphenationCallback((word) => [word]);

// ─── Brand Colors ─────────────────────────────────────────────────────────────
// Exact copy from PdfDocument.tsx — do not use CSS variables here.

const COLORS = RD_PDF;

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
    fontSize: 26,
    fontFamily: "Times-Bold",
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



export function AnalysisPdfDocument({
  analysis,
  analysisFocus,
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

  const identity = readHamiltonIdentitySnapshot(analysis.identityContext);
  const identityLines = identity ? hamiltonIdentityLines(identity) : ["Historical institution, account and peer context: Not recorded"];
  const readOnlyLine = identity?.researchInstitutionName
    ? `Generated by ${HAMILTON_ATTRIBUTION} | ${identity.researchInstitutionName}`
    : `Generated by ${HAMILTON_ATTRIBUTION}`;

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.reportTypeBadge}>{analysisFocus} Analysis</Text>
          <Text style={styles.reportTitle}>{title}</Text>
          <Text style={styles.readOnlyNotice}>{readOnlyLine}</Text>
          {identityLines.map((line) => <Text key={line} style={styles.readOnlyNotice}>{line}</Text>)}
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
        {hasBriefContent(brief) ? <BriefPages brief={brief} institutionName={identity?.researchInstitutionName ?? (identity?.researchInstitutionId ? `Institution ${identity.researchInstitutionId}` : "Research institution")} /> : null}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{HAMILTON_ATTRIBUTION}</Text>
          <Text style={styles.footerText}>{today}</Text>
        </View>
      </Page>
    </Document>
  );
}
