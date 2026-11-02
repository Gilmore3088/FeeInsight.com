/**
 * The Reports builder's PDF (Hamilton dashboard redesign, Nov 2026): one PDF page per page of the
 * on-screen preview, drawn from the same BuilderDocument (buildReportDocument), so the export holds
 * the sections the banker ticked, in their order, on the pages they saw. Server-side only
 * (react-pdf). Standard PDF fonts carry no ▲ ● ▼, so positions print as words here and on screen.
 */
import { Circle, Document, Line, Page, Path, Polyline, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { HAMILTON_ATTRIBUTION } from "@/lib/constants";
import { RD_PDF, RD_PDF_CHART } from "@/lib/report-design/tokens";
import {
  BUILDER_PAGE,
  builderDollars,
  type BuilderDocument,
  type BuilderFeeRow,
  type BuilderPosition,
  type BuilderSectionView,
} from "@/lib/hamilton/report-builder";

const C = RD_PDF;
const K = RD_PDF_CHART;
const SAGE = "#3b6350";
const SLATE = "#5a646e";

export const BUILDER_POSITION_WORDS: Record<BuilderPosition, string> = {
  above: "Above",
  in_range: "In range",
  below: "Below",
  too_few: "Too few to compare",
  not_single: "Several prices",
  not_published: "Not published",
};

const s = StyleSheet.create({
  page: { backgroundColor: "#ffffff", paddingTop: BUILDER_PAGE.marginTop, paddingBottom: BUILDER_PAGE.marginBottom, paddingHorizontal: BUILDER_PAGE.marginX, fontFamily: "Helvetica", fontSize: 9.5, color: C.textPrimary },
  cover: { height: BUILDER_PAGE.coverHeight - 10, marginBottom: 10, borderBottomWidth: 0.75, borderBottomColor: C.textPrimary, borderBottomStyle: "solid" },
  kicker: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.accent, letterSpacing: 1, textTransform: "uppercase" },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", marginTop: 4, lineHeight: 1.2 },
  subtitle: { fontSize: 9, color: C.textSecondary, marginTop: 4, lineHeight: 1.35 },
  section: { marginBottom: BUILDER_PAGE.sectionGap },
  heading: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  body: { fontSize: 9.5, lineHeight: 1.4 },
  small: { fontSize: 8.5, lineHeight: 1.35, color: C.textSecondary },
  note: { fontSize: 8, color: C.textTertiary, marginTop: 5, lineHeight: 1.35 },
  row: { flexDirection: "row", alignItems: "center", borderBottomWidth: 0.5, borderBottomColor: C.borderDark, borderBottomStyle: "solid", paddingVertical: 4 },
  head: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: C.textPrimary, borderBottomStyle: "solid", paddingVertical: 3 },
  th: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.textSecondary, paddingHorizontal: 2 },
  td: { fontSize: 8.5, paddingHorizontal: 2, lineHeight: 1.3 },
  num: { textAlign: "right" },
  bold: { fontFamily: "Helvetica-Bold" },
  finding: { borderTopWidth: 0.5, borderTopColor: C.borderDark, borderTopStyle: "solid", paddingTop: 5, paddingBottom: 3 },
  next: { borderLeftWidth: 1.5, borderLeftColor: C.accent, borderLeftStyle: "solid", paddingLeft: 8, marginTop: 6 },
  footer: { position: "absolute", bottom: 30, left: BUILDER_PAGE.marginX, right: BUILDER_PAGE.marginX, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 7.5, color: C.textTertiary },
  legend: { flexDirection: "row", gap: 12, marginTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
});

const TRACK = 170;

/** The fee's name, and the wider group it was compared with when the report's group was too small for it. */
function FeeName({ row }: { row: BuilderFeeRow }) {
  return (
    <View style={{ width: 140, paddingHorizontal: 2 }}>
      <Text style={{ fontSize: 8.5, lineHeight: 1.3 }}>{row.name}</Text>
      {row.comparedWith ? <Text style={{ fontSize: 7.5, lineHeight: 1.3, color: C.textSecondary }}>Compared with {row.comparedWith}</Text> : null}
    </View>
  );
}

function RangePlot({ row }: { row: BuilderFeeRow }) {
  const p = row.plot;
  if (!p) return <Svg width={TRACK} height={12} />;
  const span = p.high - p.low || 1;
  const x = (v: number) => 4 + ((v - p.low) / span) * (TRACK - 8);
  return (
    <Svg width={TRACK} height={12}>
      <Line x1={4} y1={6} x2={TRACK - 4} y2={6} stroke={C.borderDark} strokeWidth={1} />
      {p.q1 !== null && p.q3 !== null ? <Rect x={x(p.q1)} y={2} width={Math.max(2, x(p.q3) - x(p.q1))} height={8} fill={K.band} /> : null}
      {p.median !== null ? <Line x1={x(p.median)} y1={0} x2={x(p.median)} y2={12} stroke={K.ink} strokeWidth={1.2} /> : null}
      {p.yours !== null ? <Circle cx={x(p.yours)} cy={6} r={3.6} fill={row.position === "above" ? K.accent : row.position === "below" ? SAGE : SLATE} /> : null}
    </Svg>
  );
}

/** An arc of the ring from fraction a0 to a1 of the way round, clockwise from the top. */
function arcPath(a0: number, a1: number, r = 30, c = 40): string {
  const pt = (f: number) => [c + r * Math.sin(2 * Math.PI * f), c - r * Math.cos(2 * Math.PI * f)].map((v) => v.toFixed(2)).join(" ");
  if (a1 - a0 >= 0.9999) return `M ${pt(0)} A ${r} ${r} 0 1 1 ${pt(0.5)} A ${r} ${r} 0 1 1 ${pt(0)}`;
  return `M ${pt(a0)} A ${r} ${r} 0 ${a1 - a0 > 0.5 ? 1 : 0} 1 ${pt(a1)}`;
}

function Donut({ counts }: { counts: { above: number; within: number; below: number } }) {
  const total = counts.above + counts.within + counts.below;
  let at = 0;
  const arcs = ([["above", K.accent], ["within", SLATE], ["below", SAGE]] as const).map(([k, color]) => {
    const share = total ? counts[k] / total : 0;
    const arc = { k, color, from: at, to: at + share };
    at += share;
    return arc;
  });
  return (
    <Svg width={80} height={80} viewBox="0 0 80 80">
      <Circle cx={40} cy={40} r={30} fill="none" stroke="#ebe5d9" strokeWidth={12} />
      {arcs.filter((a) => a.to > a.from).map((a) => (
        <Path key={a.k} d={arcPath(a.from, a.to)} fill="none" stroke={a.color} strokeWidth={12} />
      ))}
    </Svg>
  );
}

function TrendPdf({ v }: { v: Extract<BuilderSectionView, { key: "trend" }> }) {
  const W = 480;
  const H = 110;
  const known = [...v.own, ...v.peer.filter((x): x is number => x !== null)];
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const pad = (hi - lo) * 0.15 || 1;
  const x = (i: number) => 6 + (i * (W - 12)) / Math.max(1, v.own.length - 1);
  const y = (val: number) => H - 6 - ((val - lo + pad) / (hi - lo + 2 * pad)) * (H - 12);
  const own = v.own.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(" ");
  const peer = v.peer.every((p) => p !== null) ? v.peer.map((val, i) => `${x(i).toFixed(1)},${y(val as number).toFixed(1)}`).join(" ") : null;
  return (
    <View>
      <Svg width={W} height={H}>
        <Line x1={0} y1={H - 1} x2={W} y2={H - 1} stroke={C.borderDark} strokeWidth={0.75} />
        {peer ? <Polyline points={peer} fill="none" stroke={SLATE} strokeWidth={1.2} strokeDasharray="3 2" /> : null}
        <Polyline points={own} fill="none" stroke={K.accent} strokeWidth={1.8} />
      </Svg>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
        <Text style={s.note}>{v.quarters[0]} · {builderDollars(v.own[0])}</Text>
        <Text style={s.note}>{v.quarters[v.quarters.length - 1]} · {builderDollars(v.own[v.own.length - 1])}</Text>
      </View>
      <View style={s.legend}>
        <View style={s.legendItem}><Svg width={14} height={6}><Line x1={0} y1={3} x2={14} y2={3} stroke={K.accent} strokeWidth={2} /></Svg><Text style={s.small}>This institution</Text></View>
        {peer ? <View style={s.legendItem}><Svg width={14} height={6}><Line x1={0} y1={3} x2={14} y2={3} stroke={SLATE} strokeWidth={1.2} strokeDasharray="3 2" /></Svg><Text style={s.small}>Median of {v.peerLabel ?? "peers"}</Text></View> : null}
      </View>
    </View>
  );
}

function SectionBody({ v }: { v: BuilderSectionView }) {
  switch (v.key) {
    case "summary":
      return (
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Donut counts={v.counts} />
            <View>
              <Text style={[s.body, s.bold]}>{v.counts.above} of {v.placed} fees compared sit above the peers&apos; middle half</Text>
              <Text style={s.small}>{v.counts.above} above · {v.counts.within} in range · {v.counts.below} below</Text>
              {v.published > v.placed ? <Text style={s.small}>{v.published - v.placed} more of the fees in this report are not placed: too few peers publish them, or several prices are listed.</Text> : null}
            </View>
          </View>
          <Text style={[s.body, { marginTop: 8 }]}>{v.conclusion}</Text>
        </View>
      );
    case "findings":
      return (
        <View>
          {v.empty ? <Text style={s.body}>{v.empty}</Text> : null}
          {v.items.map((f, i) => (
            <View key={i} style={s.finding}>
              <Text style={[s.body, s.bold]}>{f.statement}</Text>
              <Text style={s.small}>{f.evidence}</Text>
              {f.caveats.map((c, j) => <Text key={j} style={s.small}>{c}</Text>)}
            </View>
          ))}
          {v.unresolvedCount ? <Text style={s.note}>{v.unresolvedCount} more {v.unresolvedCount === 1 ? "difference needs" : "differences need"} resolving before it can be relied on; the pricing committee brief lists them.</Text> : null}
          {v.nextStep ? (
            <View style={s.next}>
              <Text style={[s.body, s.bold]}>Next step: {v.nextStep.action}</Text>
              <Text style={s.small}>{v.nextStep.rationale}</Text>
            </View>
          ) : null}
        </View>
      );
    case "above":
      return (
        <View>
          {v.empty ? <Text style={s.body}>{v.empty}</Text> : v.rows.map((r) => (
            <View key={r.name} style={s.row}>
              <FeeName row={r} />
              <Text style={[s.td, s.bold, s.num, { width: 50 }]}>{r.yours}</Text>
              <View style={{ width: TRACK + 12, paddingHorizontal: 6 }}><RangePlot row={r} /></View>
              <Text style={[s.td, s.num, { flex: 1, color: K.accent }]}>{r.gap ?? ""}</Text>
            </View>
          ))}
          {v.more ? <Text style={s.note}>{v.more} more above the range in the full list.</Text> : null}
          <Text style={s.note}>Shaded: the peers&apos; middle half. Line: median. Dot: this institution.</Text>
        </View>
      );
    case "fees":
      return (
        <View>
          <View style={s.head}>
            {[["Fee", 140, false], ["Yours", 64, true], ["Median", 52, true], ["Middle half, or spread", 110, true], ["Peers", 38, true], ["Position", 0, false]].map(([label, width, num]) => (
              <Text key={label as string} style={[s.th, num ? s.num : {}, width ? { width: width as number } : { flex: 1 }]}>{label as string}</Text>
            ))}
          </View>
          {v.rows.map((r) => (
            <View key={r.name} style={s.row}>
              <FeeName row={r} />
              <Text style={[s.td, s.num, s.bold, { width: 64 }]}>{r.yours}</Text>
              <Text style={[s.td, s.num, { width: 52 }]}>{r.median}</Text>
              <Text style={[s.td, s.num, { width: 110 }]}>{r.range}</Text>
              <Text style={[s.td, s.num, { width: 38 }]}>{r.peers}</Text>
              <Text style={[s.td, { flex: 1, paddingLeft: 8 }, r.position === "above" ? { color: K.accent } : {}]}>{BUILDER_POSITION_WORDS[r.position]}</Text>
            </View>
          ))}
          {v.more ? <Text style={s.note}>{v.more} more fees in the full list.</Text> : null}
          <Text style={s.note}>A median needs at least 10 peers. With fewer, the spread is shown and the fee is not placed.</Text>
        </View>
      );
    case "trend":
      return v.empty ? <Text style={s.body}>{v.empty}</Text> : (
        <View>
          <Text style={[s.body, { marginBottom: 6 }]}>{v.headline}</Text>
          <TrendPdf v={v} />
        </View>
      );
    case "changes":
      return v.empty ? <Text style={s.body}>{v.empty}</Text> : (
        <View>
          <View style={s.head}>
            <Text style={[s.th, { width: 170 }]}>Institution</Text>
            <Text style={[s.th, { width: 110 }]}>Fee</Text>
            <Text style={[s.th, { width: 150 }]}>Change</Text>
            <Text style={[s.th, { flex: 1 }]}>When</Text>
          </View>
          {v.rows.map((r, i) => (
            <View key={i} style={s.row}>
              <Text style={[s.td, { width: 170 }]}>{r.who}</Text>
              <Text style={[s.td, { width: 110 }]}>{r.fee}</Text>
              <Text style={[s.td, { width: 150 }]}>{r.change}</Text>
              <Text style={[s.td, { flex: 1 }]}>{r.when}</Text>
            </View>
          ))}
          {v.more ? <Text style={s.note}>{v.more} more changes in the pricing committee brief.</Text> : null}
          <Text style={s.note}>Since {v.since}.</Text>
        </View>
      );
    case "sources":
      return (
        <View>
          {v.lines.map((line, i) => <Text key={i} style={[s.small, { marginBottom: 3 }]}>{line}</Text>)}
        </View>
      );
  }
}

export function ReportBuilderPdf({ doc }: { doc: BuilderDocument }) {
  return (
    <Document title={`${doc.title}: ${doc.institutionName}`} author={HAMILTON_ATTRIBUTION}>
      {doc.pages.map((page) => (
        // One PDF page per preview page; a page never wraps onto another, so the counts always match.
        <Page key={page.number} size={doc.pageSize} style={s.page} wrap={false}>
          {page.number === 1 ? (
            <View style={s.cover}>
              <Text style={s.kicker}>{doc.title}</Text>
              <Text style={s.title}>{doc.institutionName}</Text>
              <Text style={s.subtitle}>{doc.preparedFor} · against {doc.peerGroupLabel} · read {doc.readOn}</Text>
            </View>
          ) : null}
          {page.sections.length === 0 ? <Text style={s.body}>No section is ticked.</Text> : null}
          {page.sections.map((section) => (
            <View key={section.n} style={s.section}>
              <Text style={s.heading}>{section.n}. {section.title}</Text>
              <SectionBody v={section.view} />
            </View>
          ))}
          <View style={s.footer}>
            <Text style={s.footerText}>{HAMILTON_ATTRIBUTION} · {doc.title} · read {doc.readOn}</Text>
            <Text style={s.footerText}>Page {page.number} of {doc.pageCount}</Text>
          </View>
        </Page>
      ))}
    </Document>
  );
}
