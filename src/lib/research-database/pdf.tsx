import { Document, Page, Text, View, renderToBuffer, StyleSheet } from "@react-pdf/renderer";
import { researchExhibits, researchHighlights } from "./presentation";
import { researchTitle } from "./assemble";
import type { ResearchSnapshot } from "./types";

const styles = StyleSheet.create({ page: { padding: 36, fontFamily: "Helvetica", fontSize: 10, color: "#172b3b" }, title: { fontSize: 22, marginBottom: 16 }, cell: { marginBottom: 12, borderBottom: "1pt solid #ddd", paddingBottom: 8 }, label: { fontSize: 12, marginBottom: 3 }, small: { fontSize: 8, marginTop: 4 }, heading: { fontSize: 16, marginTop: 14, marginBottom: 8 } });

export async function renderResearchPdf(snapshot: ResearchSnapshot, options: { draft?: boolean } = {}): Promise<Buffer> {
  const title = `${options.draft ? "DRAFT: " : ""}${researchTitle(snapshot)}`;
  return renderToBuffer(<Document title={title} author="Fee Insight">
    <Page size="A4" style={styles.page}>
      <Text>Fee Insight Research</Text><Text style={styles.title}>{title}</Text>
      {options.draft && <Text style={styles.small}>Draft for editorial review. Not approved for public distribution.</Text>}
      <Text>Evidence captured {snapshot.capturedAt}. Verified-only fee benchmarks.</Text>
      <Text style={styles.heading}>Key findings</Text>
      {researchHighlights(snapshot).map(finding => <Text key={finding} style={styles.small}>{finding}</Text>)}
      {snapshot.footprint && <Text style={styles.small}>Branch vintage {snapshot.footprint.vintage}. {snapshot.footprint.matchedBranches}/{snapshot.footprint.branches} branches mapped. Footprint coverage: {snapshot.footprint.status}.</Text>}
      {researchExhibits(snapshot).map((cell, i) => <View key={i} wrap={false} style={styles.cell}>
        <Text style={styles.label}>{cell.label}: {cell.formatted}</Text>
        <Text>{cell.cohortLabel} | {cell.period ?? "Unavailable"} | {cell.coverageLabel} | {cell.status}</Text>
        {snapshot.request.cadence === "monthly" && <Text style={styles.small}>Release: {cell.releaseStatus?.replaceAll("_", " ")}</Text>}
        <Text style={styles.small}>{cell.definition} {cell.note}</Text>
        {cell.sourceUrls.map(url => <Text style={styles.small} key={url}>{url}</Text>)}
      </View>)}
      <Text style={styles.heading}>Methodology and limitations</Text>
      {snapshot.limitations.map(l => <Text key={l} style={styles.small}>{l}</Text>)}
      <Text style={styles.small}>Method {snapshot.metricVersion}. Snapshot {snapshot.snapshotHash}.</Text>
    </Page>
  </Document>);
}
