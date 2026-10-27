import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Document, Page, Text, View, Link, Font, renderToBuffer, StyleSheet } from "@react-pdf/renderer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { researchExhibits, researchHighlights } from "./presentation";
import { researchTitle } from "./assemble";
import type { ResearchSnapshot } from "./types";

Font.register({ family: "Newsreader", src: join(process.cwd(), "public/fonts/newsreader-variable.ttf") });
const ink = "#132338", brick = "#b23a32", paper = "#f3efe6", muted = "#55606f", line = "#ddd5c6";
const logo = () => ({ data: readFileSync(join(process.cwd(), "public/brand/png/fee-insight-oneline@2x.png")), format: "png" as const });
const s = StyleSheet.create({
  page: { padding: 40, paddingTop: 110, paddingBottom: 52, fontFamily: "Helvetica", fontSize: 9, lineHeight: 1.4, color: ink, backgroundColor: "#fbf9f4" },
  mast: { position: "absolute", top: 32, left: 40, right: 40, height: 42, flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexShrink: 0, paddingBottom: 15, borderBottom: `1pt solid ${ink}`, marginBottom: 22 },
  logo: { width: 130, height: 23 }, eyebrow: { fontSize: 8, letterSpacing: 1.5, color: brick, textTransform: "uppercase" },
  badge: { fontSize: 7, color: brick, border: `1pt solid ${brick}`, padding: "4 7", letterSpacing: 1 },
  title: { fontFamily: "Newsreader", fontSize: 39, lineHeight: 1.12, marginTop: 18, marginBottom: 14 },
  heading: { fontFamily: "Newsreader", fontSize: 29, marginTop: 7, marginBottom: 10, lineHeight: 1.1 },
  dek: { fontSize: 11, color: muted, lineHeight: 1.6, marginBottom: 20 },
  cards: { flexDirection: "row", gap: 10, marginVertical: 18 },
  card: { flex: 1, padding: 13, backgroundColor: ink, minHeight: 100, flexShrink: 0 },
  cardValue: { fontFamily: "Newsreader", fontSize: 29, lineHeight: 1.25, color: paper, marginVertical: 7 },
  cardLabel: { color: paper, fontSize: 8 }, cardPeriod: { color: "#a9b3c1", fontSize: 7 },
  finding: { flexDirection: "row", paddingVertical: 12, borderBottom: `1pt solid ${line}`, gap: 13 },
  number: { fontFamily: "Newsreader", fontSize: 18, lineHeight: 1.2, color: brick, width: 28 },
  findingText: { flex: 1, fontSize: 10, lineHeight: 1.5 },
  note: { color: muted, fontSize: 8, lineHeight: 1.5, marginVertical: 7 },
  callout: { backgroundColor: paper, borderLeft: `3pt solid ${brick}`, padding: 12, marginVertical: 14, flexShrink: 0 },
  subhead: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 8 },
  row: { flexDirection: "row", borderBottom: `0.5pt solid ${line}`, paddingVertical: 7, flexShrink: 0, alignItems: "flex-start" },
  th: { backgroundColor: ink, color: paper, paddingHorizontal: 8, paddingVertical: 9, flexDirection: "row", fontSize: 7 },
  label: { width: "40%", paddingRight: 8 }, value: { width: "25%", fontFamily: "Helvetica-Bold" }, period: { width: "15%" }, coverage: { width: "20%", fontSize: 7, color: muted },
  feeGroup: { paddingVertical: 11, flexShrink: 0, borderBottom: `0.5pt solid ${line}` },
  feeLine: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 6 },
  barTrack: { width: 190, height: 8, backgroundColor: "#ebe5d9" },
  feeLabel: { width: 70, fontSize: 8 }, feeAmount: { width: 55, fontFamily: "Helvetica-Bold", fontSize: 11 }, feeSample: { flex: 1, fontSize: 7, color: muted },
  matrixLabel: { width: "24%", paddingRight: 8, fontSize: 8 }, matrixCell: { width: "15.2%", paddingRight: 5, fontSize: 8, lineHeight: 1.1 },
  source: { marginBottom: 9, fontSize: 8, color: muted },
  footer: { position: "absolute", height: 20, flexShrink: 0, bottom: 20, left: 40, right: 40, borderTop: `0.5pt solid ${line}`, paddingTop: 9, flexDirection: "row", justifyContent: "space-between", fontSize: 7, lineHeight: 1.3, color: muted },
});
type Exhibit = ReturnType<typeof researchExhibits>[number];
const nice = (v: string) => v.replaceAll("_", " ").replace(/^fee:/, "");
const month = (date: string) => new Date(date).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const compact = (c: Exhibit) => c.value === null ? "Unavailable" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1, ...(c.key === "bank_deposits" ? { style: "currency", currency: "USD" } : {}) }).format(c.value) + (c.key === "national_unemployment" ? "%" : "");

export async function renderResearchPdf(snapshot: ResearchSnapshot, options: { draft?: boolean } = {}): Promise<Buffer> {
  const title = researchTitle(snapshot), cells = researchExhibits(snapshot);
  const allUrls = [...new Set(cells.flatMap(c => c.sourceUrls))];
  const family = (u: string) => { const url = new URL(u); return url.hostname + url.pathname; };
  const sources = [...new Set(allUrls.map(family))].map(key => ({ key, urls: allUrls.filter(u => family(u) === key) }));
  const refs = (c: Exhibit) => [...new Set(c.sourceUrls.map(u => sources.findIndex(g => g.key === family(u)) + 1))].join(", ");
  const market = cells.filter(c => c.module === "market"), fees = cells.filter(c => c.module === "fees"), performance = cells.filter(c => c.module === "performance");
  const feeKeys = [...new Set(fees.map(c => c.key))];
  const feeMax = Math.max(1, ...fees.map(c => c.value ?? 0));
  const metrics = ["assets", "roa", "asset_growth", "equity_assets", "loan_deposit_ratio"];
  const labels = ["Median assets", "Median ROA", "Asset growth", "Equity / assets", "Loans / deposits"];

  const Heading = ({ n, title, description }: { n: string; title: string; description: string }) => <><Text style={s.eyebrow}>{n} / RESEARCH FINDINGS</Text><Text style={s.heading}>{title}</Text><Text style={s.note}>{description}</Text></>;
  const rendered = await renderToBuffer(<Document title={`${options.draft ? "DRAFT: " : ""}${title}`} author="Fee Insight" subject="Economic and market research with frozen source evidence">
    <Page size="A4" style={s.page}>
      <Text style={s.eyebrow}>{snapshot.footprint ? "LOCAL MARKET RESEARCH" : "NATIONAL RESEARCH"}  /  {month(snapshot.capturedAt)}</Text>
      <Text style={[s.title, { fontSize: snapshot.footprint ? 32 : 39 }]}>{snapshot.footprint?.name ?? "Banking & local markets"}</Text>
      <Text style={s.dek}>{snapshot.footprint ? "The economic footprint, institutional landscape and observed fees across this institution’s branch counties." : "A national view of local economies, bank and credit union performance, and observed consumer fee benchmarks."}</Text>
      <View style={s.cards}>{["population", "bank_deposits", "national_unemployment"].map(key => cells.find(c => c.key === key)).filter((c): c is Exhibit => Boolean(c)).map(c => <View key={c.key} style={s.card}><Text style={s.cardLabel}>{c.label}</Text><Text style={[s.cardValue, { fontSize: c.value === null ? 14 : 29 }]}>{compact(c)}</Text><Text style={s.cardPeriod}>{c.period ?? "No period available"} · Sources {refs(c)}</Text></View>)}</View>
      <Text style={s.note}>Headline figures are rounded. Exact values and coverage appear in the tables. Population describes covered ACS counties. Bank deposits can include nonlocal balances booked at headquarters; they do not measure local household demand.</Text>
      <Text style={s.subhead}>At a glance</Text>
      {researchHighlights(snapshot).map((finding, i) => <View key={finding} style={s.finding}><Text style={s.number}>0{i + 1}</Text><Text style={s.findingText}>{finding}</Text></View>)}
      <View style={s.callout}><Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 4 }}>{options.draft ? "Prepared for editorial review" : "About this edition"}</Text><Text style={{ fontSize: 8 }}>{options.draft ? "Not approved for public distribution. " : ""}Evidence captured {new Date(snapshot.capturedAt).toISOString().slice(0, 10)}. Source reporting periods vary; each figure retains its own period. {snapshot.footprint ? `${snapshot.footprint.matchedBranches} of ${snapshot.footprint.branches} branches mapped across ${snapshot.footprint.counties.length} counties.` : "National figures describe the available covered universe."}</Text></View>
    </Page>
    <Page size="A4" style={s.page}>
      <Heading n="01" title="The market in context" description="Local economic measures and national indicators are shown separately. Source numbers refer to the evidence register at the end of this report." />
      <View style={s.th}><Text style={s.label}>MEASURE / GEOGRAPHY</Text><Text style={s.value}>VALUE</Text><Text style={s.period}>PERIOD</Text><Text style={[s.coverage, { color: paper }]}>OBSERVED / SCOPE</Text></View>
      {market.map((c, i) => <View key={i} style={s.row} wrap={false}><View style={s.label}><Text>{c.label} [{refs(c)}]</Text><Text style={{ fontSize: 7, color: muted, marginTop: 3 }}>{c.cohortLabel}</Text></View><Text style={s.value}>{c.formatted}</Text><Text style={s.period}>{c.period ?? "—"}</Text><Text style={s.coverage}>{c.observed} / {c.eligible}{c.status !== "available" ? `\n${c.status}` : ""}</Text></View>)}
      <View style={s.callout}><Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 5 }}>Reading these figures</Text><Text style={{ fontSize: 8 }}>Unemployment and the federal funds rate describe US national conditions. County income medians are kept separate. Missing or suppressed county observations prevent a complete employment or establishment total. Bank branch deposits exclude credit unions and can include nonlocal funds booked at headquarters.</Text></View>
    </Page>
    <Page size="A4" style={s.page}>
      <Heading n="02" title="What the observed fees show" description="Median dollar benchmarks from verified published schedules. Banks and credit unions remain separate. Bar lengths share one dollar scale; the sample is not a representative census." />
      {feeKeys.map(key => <View key={key} style={s.feeGroup} wrap={false}><Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11, marginBottom: 4 }}>{fees.find(c => c.key === key)?.label.replace(/ benchmark$/, "")}</Text>{fees.filter(c => c.key === key).map(c => <View key={c.cohort} style={s.feeLine}><Text style={s.feeLabel}>{c.cohortLabel}</Text><View style={s.barTrack}><View style={{ width: `${100 * (c.value ?? 0) / feeMax}%`, height: 8, backgroundColor: c.cohort === "bank" ? ink : brick }} /></View><Text style={s.feeAmount}>{c.value === null ? "—" : c.formatted}</Text><Text style={s.feeSample}>{c.value === null ? "Unavailable" : `n = ${c.observed}`} / {c.eligible} in scope</Text></View>)}</View>)}
      {!fees.length && <Text style={s.note}>No fee module was requested for this edition.</Text>}
      <Text style={s.note}>Scale: $0 to ${feeMax}. Values are medians, not changes over time. “n” is the counted sample after shared-schedule deduplication; it is not the number of priced products. A minimum of ten eligible observations is required. Zero-dollar fees remain included. Source [{sources.findIndex(g => g.key === family("https://feeinsight.com/research/data-sources")) + 1}].</Text>
      <View style={s.callout}><Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 5 }}>Compare like with like</Text><Text style={{ fontSize: 8 }}>General fees and named account or channel exceptions follow the shared fee-statistics contract. Rates and incompatible charging bases are excluded. The full evidence ledger retains the sample, population and qualification for every benchmark.</Text></View>
    </Page>
    <Page size="A4" style={s.page}>
      <Heading n="03" title="Institutional performance" description="Charter and asset-size cohorts use current registry tiers. Financial amounts are in dollars. Each cell shows its observed / eligible sample beneath the value." />
      {["bank", "credit_union"].map(charter => { const cohorts = [...new Set(performance.filter(c => c.cohort.startsWith(`${charter}:`)).map(c => c.cohort))]; return <View key={charter}><Text style={s.subhead}>{charter === "bank" ? "Banks" : "Credit unions"}</Text><View style={s.th}><Text style={s.matrixLabel}>ASSET-SIZE COHORT</Text>{labels.map(label => <Text key={label} style={s.matrixCell}>{label}</Text>)}</View>{cohorts.map(cohort => <View key={cohort} style={[s.row, { paddingVertical: 5 }]} wrap={false}><Text style={s.matrixLabel}>{performance.find(c => c.cohort === cohort)?.cohortLabel.split(" · ")[1] ?? nice(cohort)}</Text>{metrics.map(key => { const c = performance.find(c => c.key === key && c.cohort === cohort);return <View key={key} style={s.matrixCell}><Text>{c?.value == null ? "—" : c.formatted}</Text><Text style={{ color: muted, fontSize: 6.5, marginTop: 3 }}>{c ? `${c.observed} / ${c.eligible}` : "Not requested"}</Text></View>; })}</View>)}</View>; })}
      <Text style={s.note}>Reporting dates: {[...new Set(performance.map(c => c.period).filter(Boolean))].join(", ") || "Unavailable"}. A dash means unavailable or below the minimum sample; it is never an estimated zero. Growth uses matched annual filings and is not adjusted for mergers or survivor bias. Equity / assets is a balance-sheet comparison, not a regulatory capital ratio.</Text>
    </Page>
    <Page size="A4" style={s.page}>
      <Heading n="04" title="Method & evidence" description="The report describes observed data. It does not establish causality, forecast revenue or imply that a catalog refresh is a price change." />
      {snapshot.limitations.map((l, i) => <View key={l} style={{ flexDirection: "row", gap: 8, marginBottom: 9 }} wrap={false}><Text style={{ color: brick, width: 16 }}>{String(i + 1).padStart(2, "0")}</Text><Text style={{ flex: 1, fontSize: 8, lineHeight: 1.5 }}>{l}</Text></View>)}
      <Text style={s.subhead}>Source register</Text>
      {sources.map((group, i) => <View key={group.key} style={s.source} wrap={false}><Text>[{i + 1}] {group.key}</Text><Text style={{ fontSize: 7 }}>{group.urls.map((url, j) => <Link key={url} src={url} style={{ color: muted }}>{group.urls.length === 1 ? url : `${j ? " · " : ""}${new URL(url).searchParams.get("states") ?? String(j + 1)}`}</Link>)}</Text></View>)}
      <Text style={s.note}>Method {snapshot.metricVersion} · Fee-statistics method {snapshot.feeStatsVersion}. Evidence captured {snapshot.capturedAt}. Snapshot hash:</Text><Text style={{ fontSize: 7, color: muted }}>{snapshot.snapshotHash}</Text>
    </Page>
    <Page size="A4" style={s.page}>
      <Heading n="05" title="Evidence ledger" description="The complete saved results, including unavailable measures. Qualifications and source references stay attached to each row. Observed / eligible counts describe coverage, except fee counts, which use shared-schedule deduplication." />
      {[...new Set(cells.map(c => c.key))].map(key => {
        const group = cells.filter(c => c.key === key);
        return <View key={key} style={{ marginBottom: 13 }}>
          <Text style={s.subhead} minPresenceAhead={65}>{group[0].label}</Text>
          <Text style={{ fontSize: 7, color: muted, marginBottom: 5 }}>{group[0].definition}</Text>
          {group.map((c, i) => <View key={i} wrap={false} style={{ flexDirection: "row", borderBottom: `0.5pt solid ${line}`, paddingVertical: 5 }}>
            <Text style={{ width: "34%", fontSize: 7 }}>{c.cohortLabel}</Text>
            <Text style={{ width: "22%", fontSize: 8 }}>{c.formatted}</Text>
            <Text style={{ width: "17%", fontSize: 7 }}>{c.period ?? "No period"}</Text>
            <Text style={{ width: "27%", fontSize: 7, color: muted }}>{c.observed} / {c.eligible} · {c.status} [{refs(c)}]{snapshot.request.cadence === "monthly" ? ` · ${c.releaseStatus?.replaceAll("_", " ")}` : ""}</Text>
          </View>)}
          {[...new Set(group.map(c => c.note))].map(note => <Text key={note} style={{ fontSize: 7, color: muted, marginTop: 4 }}>{note}</Text>)}
        </View>;
      })}
    </Page>
  </Document>);
  // Stamp the repeating furniture after layout so every overflow page gets the same brand
  // and page count without squeezing the report's content or rerendering dynamic text.
  const pdf = await PDFDocument.load(rendered);
  const wordmark = await pdf.embedPng(logo().data);
  const face = await pdf.embedFont(StandardFonts.Helvetica);
  const navy = rgb(19 / 255, 35 / 255, 56 / 255), red = rgb(178 / 255, 58 / 255, 50 / 255), gray = rgb(85 / 255, 96 / 255, 111 / 255);
  const pages = pdf.getPages();
  for (const [i, page] of pages.entries()) {
    const { width, height } = page.getSize();
    page.drawImage(wordmark, { x: 40, y: height - 56, width: 130, height: 23 });
    page.drawLine({ start: { x: 40, y: height - 74 }, end: { x: width - 40, y: height - 74 }, thickness: 0.7, color: navy });
    const badge = options.draft ? "EDITORIAL DRAFT" : "RESEARCH";
    const badgeWidth = face.widthOfTextAtSize(badge, 7) + 16;
    page.drawRectangle({ x: width - 40 - badgeWidth, y: height - 58, width: badgeWidth, height: 20, borderColor: red, borderWidth: 0.6 });
    page.drawText(badge, { x: width - 32 - badgeWidth, y: height - 51, size: 7, font: face, color: red });
    page.drawLine({ start: { x: 40, y: 40 }, end: { x: width - 40, y: 40 }, thickness: 0.4, color: rgb(221 / 255, 213 / 255, 198 / 255) });
    page.drawText(`FEE INSIGHT / ${month(snapshot.capturedAt)}${options.draft ? " / DRAFT" : ""}`, { x: 40, y: 26, size: 7, font: face, color: gray });
    const number = `${i + 1} / ${pages.length}`;
    page.drawText(number, { x: width - 40 - face.widthOfTextAtSize(number, 7), y: 26, size: 7, font: face, color: gray });
  }
  return Buffer.from(await pdf.save());
}
