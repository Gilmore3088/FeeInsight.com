import { hamiltonIdentityLines, readHamiltonIdentitySnapshot } from "@/lib/hamilton/identity-display";
import { INTERPRETATION_LABEL } from "@/lib/hamilton/narrative-bound";
/**
 * PdfDocument — @react-pdf/renderer document component.
 * Server-side ONLY. Never import this in client components.
 * Called from /api/pro/report-pdf route only.
 *
 * Design: consulting-grade text-heavy layout with stat callout boxes.
 * Charts only where a finding carries one (#1899), drawn with react-pdf's SVG primitives (BriefCharts).
 */
import {
  Document,
  Font,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { ReportArtifactMetadata, ReportExhibit, ReportSummaryResponse } from "@/lib/hamilton/types";
import { HAMILTON_ATTRIBUTION } from "@/lib/constants";
import { REPORT_FINDING_SOURCES_LABEL, REPORT_SECTION_HEADINGS, evidencePolicyLabel, reportTypeLabel } from "./report-labels";
import { RD_PDF } from "@/lib/report-design/tokens";
import { LEGACY_REPORT_CONFIDENCE_FOOTNOTE, displayReportDecision, hasLegacyHighRating } from "@/lib/hamilton/report-answer";
import { datasetPassage, readStampedFigures } from "@/lib/dataset-note";
import { SAVED_ANSWER_FULL_LIST, SAVED_DATASET_SOURCE_LABEL, WRITTEN_SOURCES_NOTE } from "@/lib/hamilton/board-brief";
import { FINDING_EVIDENCE_LABELS, findingChartCaption, readAddedFindingEvidence } from "@/lib/hamilton/report-finding-evidence";
import type { ReportFindingSource } from "@/lib/hamilton/report-finding-claims";
import { FeeRangeChart } from "./BriefCharts";

// Words wrap whole, as in AnalysisPdfDocument (the same route loads both): default hyphenation split
// evidence record IDs mid-way ("fee:pub-lished:502"), so a printed ID no longer matched its record.
Font.registerHyphenationCallback((word) => [word]);

// ─── Styles ──────────────────────────────────────────────────────────────────

const COLORS = RD_PDF;

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
    marginBottom: 32,
    paddingBottom: 24,
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
  metadataStrip: {
    marginTop: 14,
    padding: 10,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 4,
  },
  metadataText: {
    fontSize: 8,
    color: COLORS.textSecondary,
    fontFamily: "Helvetica",
    lineHeight: 1.5,
  },
  section: {
    marginBottom: 32,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderDark,
    borderBottomStyle: "solid",
  },
  sectionHeading: {
    fontSize: 16,
    fontFamily: "Times-Bold",
    color: COLORS.textPrimary,
    marginBottom: 12,
    lineHeight: 1.3,
  },
  paragraph: {
    fontSize: 11,
    fontFamily: "Helvetica",
    color: COLORS.textPrimary,
    lineHeight: 1.7,
    marginBottom: 10,
  },
  statCalloutGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 8,
  },
  statCalloutBox: {
    backgroundColor: COLORS.surfaceElevated,
    padding: 12,
    borderRadius: 4,
    width: "46%",
  },
  statCalloutLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  statCalloutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statValue: {
    fontSize: 22,
    fontFamily: "Times-Roman",
    color: COLORS.textPrimary,
  },
  statValueAccent: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: COLORS.accent,
  },
  statArrow: {
    fontSize: 14,
    color: COLORS.textTertiary,
    fontFamily: "Helvetica",
  },
  tradeoffGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
  },
  tradeoffItem: {
    backgroundColor: COLORS.surfaceElevated,
    padding: 10,
    borderRadius: 4,
    width: "46%",
  },
  tradeoffLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  tradeoffValue: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
  },
  noteItem: {
    fontSize: 10,
    fontFamily: "Helvetica",
    color: COLORS.textSecondary,
    lineHeight: 1.6,
    marginBottom: 6,
    paddingLeft: 12,
  },
  answerLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.accent,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  headline: {
    fontSize: 17,
    fontFamily: "Times-Roman",
    color: COLORS.textPrimary,
    lineHeight: 1.35,
    marginBottom: 16,
  },
  decision: {
    flexDirection: "row",
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 4,
    padding: 10,
    marginBottom: 8,
  },
  decisionNumber: {
    width: 20,
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: COLORS.accent,
  },
  decisionBody: {
    flex: 1,
  },
  decisionAction: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    lineHeight: 1.4,
  },
  decisionWhy: {
    fontSize: 10,
    fontFamily: "Helvetica",
    color: COLORS.textSecondary,
    lineHeight: 1.5,
    marginTop: 3,
  },
  decisionConfidence: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.accent,
    marginTop: 4,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  exhibit: {
    marginBottom: 18,
  },
  exhibitNumber: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
  },
  exhibitTitle: {
    fontSize: 13,
    fontFamily: "Times-Bold",
    color: COLORS.textPrimary,
    lineHeight: 1.35,
  },
  exhibitSubtitle: {
    fontSize: 8,
    fontFamily: "Helvetica",
    color: COLORS.textSecondary,
    marginTop: 2,
    marginBottom: 6,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: COLORS.surfaceElevated,
    paddingVertical: 4,
  },
  tableRow: {
    flexDirection: "row",
    borderTopWidth: 0.5,
    borderTopColor: COLORS.borderDark,
    borderTopStyle: "solid",
    paddingVertical: 4,
  },
  tableHeadCell: {
    flex: 1,
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textSecondary,
    paddingHorizontal: 3,
  },
  tableCell: {
    flex: 1,
    fontSize: 8,
    fontFamily: "Helvetica",
    color: COLORS.textPrimary,
    paddingHorizontal: 3,
    lineHeight: 1.35,
  },
  wideCell: {
    flex: 2.6,
  },
  exhibitNote: {
    fontSize: 7,
    fontFamily: "Helvetica",
    color: COLORS.textTertiary,
    marginTop: 4,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Where a report's reader finds every filter behind its figures: the report's own note on screen. */
const REPORT_FULL_LIST = "open the report in Hamilton for the full list";

/**
 * The stamps saved with the report, as the sentences of its "About these figures" passage
 * (#1924 step 4). Read as saved, never refreshed; null for a report saved without stamps.
 */
function aboutTheseFigures(report: ReportSummaryResponse): string[] | null {
  return datasetPassage(readStampedFigures(report.datasetStamps), report.boardBrief ? SAVED_ANSWER_FULL_LIST : REPORT_FULL_LIST);
}

/** The appendix passage: prose at the body size, no tile. */
function PdfAboutTheseFigures({ about }: { about: string[] | null }) {
  if (!about) return null;
  return (
    <View style={styles.section} wrap={false}>
      <Text style={styles.sectionHeading}>About these figures</Text>
      <Text style={styles.paragraph}>{about.join(" ")}</Text>
    </View>
  );
}

// ─── PdfDocument Component ────────────────────────────────────────────────────

interface PdfDocumentProps {
  report: ReportSummaryResponse;
  reportType: string;
  artifactMetadata?: ReportArtifactMetadata | null;
}


export function PdfDocument({ report, reportType, artifactMetadata }: PdfDocumentProps) {
  const typeLabel = reportTypeLabel(reportType);
  const identity = readHamiltonIdentitySnapshot(report.identityContext);
  const identityLines = identity ? hamiltonIdentityLines(identity) : report.boardBrief ? [] : ["Historical institution, account and peer context: Not recorded"];
  const about = aboutTheseFigures(report);
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Report header */}
        <View style={styles.header}>
          <Text style={styles.reportTypeBadge}>{typeLabel}</Text>
          <Text style={styles.reportTitle}>{report.title}</Text>
          <Text style={styles.readOnlyNotice}>Generated by {HAMILTON_ATTRIBUTION}</Text>
          {identityLines.map((line) => <Text key={line} style={styles.readOnlyNotice}>{line}</Text>)}
          {artifactMetadata && !report.boardBrief && (
            <View style={styles.metadataStrip}>
              <Text style={styles.metadataText}>
                {evidencePolicyLabel(artifactMetadata.evidencePolicy)} · Peer group: {artifactMetadata.peerBaselineLabel ?? "Not recorded"} · {artifactMetadata.selectedFeeDeltaCount} {artifactMetadata.selectedFeeDeltaCount === 1 ? "fee" : "fees"} compared with peers
              </Text>
              {artifactMetadata.peerFallbackReason && (
                <Text style={styles.metadataText}>
                  Fallback: {artifactMetadata.peerFallbackReason}
                </Text>
              )}
            </View>
          )}
        </View>

        {report.answer ? <ConsultantPdfBody report={report} about={about} /> : <LegacyPdfBody report={report} about={about} />}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{HAMILTON_ATTRIBUTION}</Text>
          <Text style={styles.footerText}>{today}</Text>
        </View>
      </Page>
    </Document>
  );
}

function PdfExhibit({ exhibit, number }: { exhibit: ReportExhibit; number: number }) {
  // The last column carries names or labels; give it room.
  const cellStyle = <T,>(index: number, base: T) =>
    index === exhibit.columns.length - 1 && exhibit.id === "local_market" ? [base, styles.wideCell] : [base];
  return (
    <View style={styles.exhibit} wrap={false}>
      <Text style={styles.exhibitNumber}>Exhibit {number}</Text>
      <Text style={styles.exhibitTitle}>{exhibit.title}</Text>
      <Text style={styles.exhibitSubtitle}>{exhibit.subtitle}</Text>
      <View style={styles.tableHeader}>
        {exhibit.columns.map((column, i) => (
          <Text key={i} style={cellStyle(i, styles.tableHeadCell)}>{column}</Text>
        ))}
      </View>
      {exhibit.rows.map((row, r) => (
        <View key={r} style={styles.tableRow}>
          {row.map((cell, c) => (
            <Text key={c} style={cellStyle(c, styles.tableCell)}>{cell}</Text>
          ))}
        </View>
      ))}
      {exhibit.note && <Text style={styles.exhibitNote}>{exhibit.note}</Text>}
    </View>
  );
}

function PdfAddedFindings({ report }: { report: ReportSummaryResponse }) {
  if (!report.addedFindings?.length) return null;
  return <View style={styles.section}>
    <Text style={styles.sectionHeading}>{REPORT_SECTION_HEADINGS.addedFindings}</Text>
    {report.addedFindings.map((finding, index) => <View key={index} wrap={!finding.evidence ? false : undefined}>
      <Text style={styles.paragraph} minPresenceAhead={60}>{finding.title}{finding.detail ? ` ${finding.detail}` : ""}</Text>
      <PdfAddedFindingEvidence value={finding.evidence} claimSources={finding.sources} />
      {finding.reading?.length ? (
        <View style={styles.metadataStrip}>
          <Text style={styles.answerLabel}>{INTERPRETATION_LABEL}</Text>
          {finding.reading.map((sentence, i) => <Text key={i} style={styles.noteItem}>{"•"} {sentence}</Text>)}
        </View>
      ) : null}
      {/* One Sources block per finding (#1899): with evidence, the evidence block prints them. */}
      {!finding.evidence && finding.sources?.length ? (
        <View style={styles.metadataStrip}>
          <Text style={styles.answerLabel}>{REPORT_FINDING_SOURCES_LABEL}</Text>
          {finding.sources.map((source) => <Text key={source.id} style={styles.noteItem}>{"•"} {source.label}: {source.value} ({source.note})</Text>)}
          <Text style={styles.readOnlyNotice}>{WRITTEN_SOURCES_NOTE}</Text>
        </View>
      ) : null}
      {(hamiltonIdentityLines(readHamiltonIdentitySnapshot(finding.identityContext))).map((line) => <Text key={line} style={styles.readOnlyNotice}>{line}</Text>)}
    </View>)}
  </View>;
}

/** An added finding's chart, figures, method, sources, dates and limits (#1899), as on screen. */
function PdfAddedFindingEvidence({ value, claimSources }: { value: unknown; claimSources?: ReportFindingSource[] }) {
  const evidence = readAddedFindingEvidence(value);
  if (!evidence) return null;
  const { chart } = evidence;
  return <View style={styles.metadataStrip}>
    {chart ? <View wrap={false}>
      {chart.subject !== null ? <FeeRangeChart
        institutionName={chart.subjectLabel}
        positions={[{ feeCategory: chart.feeCategory, displayName: chart.feeName, current: chart.subject, peerMedian: chart.median, peerCount: chart.peerCount, peerLabel: chart.peerLabel, direction: chart.subject > chart.median ? "higher" : chart.subject < chart.median ? "lower" : "at" }]}
        bands={{ [chart.feeCategory]: { p25: chart.p25 ?? chart.median, median: chart.median, p75: chart.p75 ?? chart.median } }}
        rings={typeof chart.current === "number" ? { [chart.feeCategory]: chart.current } : undefined}
      /> : null}
      <Text style={styles.metadataText}>{findingChartCaption(chart)}</Text>
    </View> : null}
    {evidence.figures.length ? <View>
      <Text style={styles.metadataText}>{FINDING_EVIDENCE_LABELS.figures}:</Text>
      {evidence.figures.map((f, i) => <Text key={i} style={styles.metadataText}>{"•"} {f.label}: {f.value}{f.note ? ` (${f.note})` : ""}</Text>)}
    </View> : null}
    <Text style={styles.metadataText}>{FINDING_EVIDENCE_LABELS.method}: {evidence.method}</Text>
    {claimSources?.length ? <View>
      <Text style={styles.metadataText}>{FINDING_EVIDENCE_LABELS.sources}:</Text>
      {claimSources.map((source) => <Text key={source.id} style={styles.metadataText}>{"•"} {source.label}: {source.value} ({source.note})</Text>)}
      <Text style={styles.readOnlyNotice}>{WRITTEN_SOURCES_NOTE}</Text>
    </View> : evidence.sources.map((src, i) => <Text key={i} style={styles.metadataText}>{i === 0 ? `${FINDING_EVIDENCE_LABELS.sources}: ` : ""}{src.label} · {src.detail}</Text>)}
    <Text style={styles.metadataText}>{FINDING_EVIDENCE_LABELS.dates}: {evidence.dates}</Text>
    {evidence.limitations.map((l, i) => <Text key={i} style={styles.metadataText}>{i === 0 ? `${FINDING_EVIDENCE_LABELS.limits}: ` : ""}{l}</Text>)}
  </View>;
}

function PdfParagraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n\s*\n/)
        .filter((paragraph) => paragraph.trim())
        .map((paragraph, i) => (
          <Text key={i} style={styles.paragraph}>{paragraph}</Text>
        ))}
    </>
  );
}

/** Answer first, then the evidence, the reasoning, the trade-offs, and the sources. */
function ConsultantPdfBody({ report, about }: { report: ReportSummaryResponse; about: string[] | null }) {
  const answer = report.answer;
  // A board brief also saves its stamps as a sources entry; the passage carries them, so they print once.
  const sources = (report.sources ?? []).filter((source) => !(about && source.label === SAVED_DATASET_SOURCE_LABEL));
  return (
    <>
      {answer && (
        <View style={styles.section}>
          <Text style={styles.answerLabel}>{answer.goal ? `The answer · Goal: ${answer.goal}` : "The answer"}</Text>
          <Text style={styles.headline}>{answer.headline}</Text>
          {answer.decisions.map(displayReportDecision).map((decision, i) => (
            <View key={i} style={styles.decision} wrap={false}>
              <Text style={styles.decisionNumber}>{i + 1}</Text>
              <View style={styles.decisionBody}>
                <Text style={styles.decisionAction}>{decision.action}</Text>
                {decision.why ? <Text style={styles.decisionWhy}>{decision.why}</Text> : null}
                {decision.confidence ? (
                  <Text style={styles.decisionConfidence}>
                    {decision.confidence} confidence{decision.confidenceReason ? ` · ${decision.confidenceReason}` : ""}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
          {hasLegacyHighRating(answer.decisions) ? (
            <Text style={styles.decisionConfidence}>{LEGACY_REPORT_CONFIDENCE_FOOTNOTE}</Text>
          ) : null}
        </View>
      )}

      <PdfAddedFindings report={report} />

      {(report.exhibits ?? []).length > 0 && (
        <View style={styles.section} break>
          <Text style={styles.sectionHeading}>The Evidence</Text>
          {(report.exhibits ?? []).map((exhibit, i) => (
            <PdfExhibit key={exhibit.id} exhibit={exhibit} number={i + 1} />
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionHeading}>What Is Behind It</Text>
        <PdfParagraphs text={report.strategicRationale} />
        {report.boardBrief?.reading?.length ? (
          <View style={styles.metadataStrip} wrap={false}>
            <Text style={styles.answerLabel}>{INTERPRETATION_LABEL}</Text>
            {report.boardBrief.reading.map((sentence, i) => (
              <Text key={i} style={styles.noteItem}>{"•"} {sentence}</Text>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionHeading}>{report.boardBrief ? "Limits of this evidence" : "Trade-offs"}</Text>
        <PdfParagraphs text={report.recommendation} />
        {(report.watchlist ?? []).length > 0 && (
          <View style={styles.metadataStrip}>
            <Text style={styles.answerLabel}>{report.boardBrief ? "Further research Hamilton suggested" : "What to watch"}</Text>
            {(report.watchlist ?? []).map((item, i) => (
              <Text key={i} style={styles.noteItem}>{"•"} {item}</Text>
            ))}
          </View>
        )}
      </View>

      <PdfAboutTheseFigures about={about} />

      <View style={styles.section}>
        <Text style={styles.sectionHeading}>Method and Sources</Text>
        {sources.map((source, i) => (
          <Text key={i} style={styles.noteItem}>
            {source.label} · {source.detail}{source.url ? ` ${source.url}` : ""}
          </Text>
        ))}
        {report.implementationNotes.map((note, i) => (
          <Text key={`note-${i}`} style={styles.noteItem}>{"•"} {note}</Text>
        ))}
      </View>
    </>
  );
}

/** Reports written before the answer-first structure keep their original layout. */
function LegacyPdfBody({ report, about }: { report: ReportSummaryResponse; about: string[] | null }) {
  return (
    <>
        {/* Executive Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>{REPORT_SECTION_HEADINGS.summary}</Text>
          {report.executiveSummary.map((para, i) => (
            <Text key={i} style={styles.paragraph}>
              {para}
            </Text>
          ))}
        </View>

        <PdfAddedFindings report={report} />

        {/* Snapshot — only if scenario data present */}
        {report.snapshot.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>{REPORT_SECTION_HEADINGS.snapshot}</Text>
            <View style={styles.statCalloutGrid}>
              {report.snapshot.map((item, i) => (
                <View key={i} style={styles.statCalloutBox}>
                  <Text style={styles.statCalloutLabel}>{item.label}</Text>
                  <View style={styles.statCalloutRow}>
                    <Text style={styles.statValue}>{item.current}</Text>
                    <Text style={styles.statArrow}>→</Text>
                    <Text style={styles.statValueAccent}>{item.proposed}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Strategic Rationale */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>{REPORT_SECTION_HEADINGS.rationale}</Text>
          <Text style={styles.paragraph}>{report.strategicRationale}</Text>
        </View>

        {/* Tradeoff Summary */}
        {report.tradeoffs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>{REPORT_SECTION_HEADINGS.tradeoffs}</Text>
            <View style={styles.tradeoffGrid}>
              {report.tradeoffs.map((item, i) => (
                <View key={i} style={styles.tradeoffItem}>
                  <Text style={styles.tradeoffLabel}>{item.label}</Text>
                  <Text style={styles.tradeoffValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Position for management to weigh */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>{REPORT_SECTION_HEADINGS.position}</Text>
          <Text style={styles.paragraph}>{report.recommendation}</Text>
        </View>

        {/* Implementation Notes */}
        {report.implementationNotes.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>{REPORT_SECTION_HEADINGS.implementation}</Text>
            {report.implementationNotes.map((note, i) => (
              <Text key={i} style={styles.noteItem}>
                {"•"} {note}
              </Text>
            ))}
          </View>
        )}

        <PdfAboutTheseFigures about={about} />
    </>
  );
}
