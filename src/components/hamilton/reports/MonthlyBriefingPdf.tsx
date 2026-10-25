/**
 * The monthly briefing's PDF (#1897). Server-side only: rendered by /api/pro/report-pdf from the
 * saved report, never from what the browser sends. Prints the six sections in their fixed order,
 * each with its words, its figures with source and period, and what Hamilton could not show.
 */
import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { HAMILTON_ATTRIBUTION } from "@/lib/constants";
import { RD_PDF } from "@/lib/report-design/tokens";
import { dayLabel, isSectionEdited, type MonthlyBriefing } from "@/lib/hamilton/monthly-briefing";

// Words wrap whole, as in the other Hamilton PDFs.
Font.registerHyphenationCallback((word) => [word]);

const C = RD_PDF;

const styles = StyleSheet.create({
  page: { backgroundColor: C.surface, paddingTop: 56, paddingBottom: 64, paddingHorizontal: 64, fontFamily: "Helvetica" },
  header: { marginBottom: 24, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: C.borderDark, borderBottomStyle: "solid" },
  badge: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.accent, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 },
  title: { fontSize: 22, fontFamily: "Times-Bold", color: C.textPrimary, lineHeight: 1.2, marginBottom: 6 },
  small: { fontSize: 8, color: C.textTertiary, lineHeight: 1.5 },
  section: { marginBottom: 20 },
  heading: { fontSize: 14, fontFamily: "Times-Bold", color: C.textPrimary, marginBottom: 8 },
  paragraph: { fontSize: 10.5, color: C.textPrimary, lineHeight: 1.6, marginBottom: 6 },
  edited: { fontSize: 8, color: C.textSecondary, marginBottom: 6 },
  tableHead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.borderDark, borderBottomStyle: "solid", paddingBottom: 3, marginTop: 4 },
  rowWrap: { borderBottomWidth: 0.5, borderBottomColor: C.borderDark, borderBottomStyle: "solid", paddingVertical: 3 },
  rowCells: { flexDirection: "row" },
  url: { fontSize: 7, color: C.textTertiary, marginTop: 1 },
  headCell: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: C.textSecondary },
  cell: { fontSize: 8, color: C.textPrimary, lineHeight: 1.4, paddingRight: 6 },
  label: { width: "34%" },
  value: { width: "16%" },
  source: { width: "32%" },
  period: { width: "18%" },
  gap: { fontSize: 8.5, color: C.textSecondary, lineHeight: 1.5, marginTop: 4 },
  footer: { position: "absolute", bottom: 28, left: 64, right: 64, flexDirection: "row", justifyContent: "space-between" },
});

export function MonthlyBriefingPdf({ title, briefing }: { title: string; briefing: MonthlyBriefing }) {
  return (
    <Document title={title}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.badge}>Monthly briefing · {briefing.monthLabel}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.small}>Built {dayLabel(briefing.generatedAt)} by {HAMILTON_ATTRIBUTION}. Each figure is as of the period shown beside it.</Text>
          {briefing.peerGroupLabel ? <Text style={styles.small}>Peer group for fee comparisons: {briefing.peerGroupLabel}</Text> : null}
        </View>
        {briefing.sections.map((section) => (
          <View key={section.id} style={styles.section}>
            <Text style={styles.heading} minPresenceAhead={60}>{section.heading}</Text>
            {isSectionEdited(section) ? <Text style={styles.edited}>Words edited by your team. The figures and sources are Hamilton&apos;s.</Text> : null}
            {section.text.split(/\n\s*\n/).filter((p) => p.trim()).map((p, i) => <Text key={i} style={styles.paragraph}>{p.trim()}</Text>)}
            {section.rows.length ? (
              <View>
                <View style={styles.tableHead}>
                  <Text style={[styles.headCell, styles.label]}>Figure or item</Text>
                  <Text style={[styles.headCell, styles.value]}>Value</Text>
                  <Text style={[styles.headCell, styles.source]}>Source</Text>
                  <Text style={[styles.headCell, styles.period]}>Period</Text>
                </View>
                {section.rows.map((row, i) => (
                  <View key={i} style={styles.rowWrap} wrap={false}>
                    <View style={styles.rowCells}>
                      <Text style={[styles.cell, styles.label]}>{row.label}</Text>
                      <Text style={[styles.cell, styles.value]}>{row.value ?? ""}</Text>
                      <Text style={[styles.cell, styles.source]}>{row.source}</Text>
                      <Text style={[styles.cell, styles.period]}>{row.period}</Text>
                    </View>
                    {/* A long link gets its own line, so it never runs over the next column. */}
                    {row.url ? <Text style={styles.url}>Source link: {row.url}</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}
            {section.gaps.map((gap) => <Text key={gap} style={styles.gap}>{gap}</Text>)}
          </View>
        ))}
        <Text style={styles.small}>Built on request. The figures were not refreshed after the briefing was built.</Text>
        <View style={styles.footer} fixed>
          <Text style={styles.small}>{HAMILTON_ATTRIBUTION}</Text>
          <Text style={styles.small} render={({ pageNumber, totalPages }) => `${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
