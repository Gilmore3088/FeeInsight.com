/**
 * PdfDocument — @react-pdf/renderer document component.
 * Server-side ONLY. Never import this in client components.
 * Called from /api/pro/report-pdf route only.
 *
 * Design: consulting-grade text-heavy layout with stat callout boxes.
 * No charts (chart-to-PNG pipeline deferred post v8.0 per D-09).
 */
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { ReportArtifactMetadata, ReportSummaryResponse } from "@/lib/hamilton/types";
import { HAMILTON_ATTRIBUTION } from "@/lib/constants";
import { evidencePolicyLabel, reportTypeLabel } from "./report-labels";

// ─── Styles ──────────────────────────────────────────────────────────────────

const COLORS = {
  textPrimary: "#1c1917",
  textSecondary: "#78716c",
  textTertiary: "#a8a29e",
  accent: "#b45309",
  surface: "#fbf9f4",
  surfaceElevated: "#f5f1e8",
  borderDark: "#d6d0c5",
};

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
    fontFamily: "Helvetica-Bold",
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
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
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


// ─── PdfDocument Component ────────────────────────────────────────────────────

interface PdfDocumentProps {
  report: ReportSummaryResponse;
  reportType: string;
  artifactMetadata?: ReportArtifactMetadata | null;
}


export function PdfDocument({ report, reportType, artifactMetadata }: PdfDocumentProps) {
  const typeLabel = reportTypeLabel(reportType);
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
          {artifactMetadata && (
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

        {/* Executive Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Executive Summary</Text>
          {report.executiveSummary.map((para, i) => (
            <Text key={i} style={styles.paragraph}>
              {para}
            </Text>
          ))}
        </View>

        {/* Snapshot — only if scenario data present */}
        {report.snapshot.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Current vs Proposed Snapshot</Text>
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
          <Text style={styles.sectionHeading}>Strategic Rationale</Text>
          <Text style={styles.paragraph}>{report.strategicRationale}</Text>
        </View>

        {/* Tradeoff Summary */}
        {report.tradeoffs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Tradeoff Summary</Text>
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

        {/* Recommended Position */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Recommended Position</Text>
          <Text style={styles.paragraph}>{report.recommendation}</Text>
        </View>

        {/* Implementation Notes */}
        {report.implementationNotes.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Implementation Notes</Text>
            {report.implementationNotes.map((note, i) => (
              <Text key={i} style={styles.noteItem}>
                — {note}
              </Text>
            ))}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{HAMILTON_ATTRIBUTION}</Text>
          <Text style={styles.footerText}>{today}</Text>
        </View>
      </Page>
    </Document>
  );
}
