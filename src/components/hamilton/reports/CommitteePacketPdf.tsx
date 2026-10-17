/**
 * The pricing committee packet as a printed document (@react-pdf/renderer). Server-side only;
 * the /api/pro/report-pdf route loads it on demand.
 *
 * A two-page executive briefing, then an optional evidence appendix. Designed for paper, not as a
 * copy of the screen: white page, wide margins, 11-12pt prose, open exhibits with hairline rules and
 * no boxes, badges or tiles.
 * - Page one is the assessment: a restrained header (institution, date, comparison group), the main
 *   conclusion, the three findings that matter most with their numbers and why, each material
 *   uncertainty in the margin beside its finding, and the recommended next step with its rationale.
 * - Page two carries the strongest supporting exhibits: every fee against the peers, and fee income
 *   per $10,000 of assets.
 * - The evidence appendix follows on as many pages as it needs, at 9pt and never smaller: every
 *   table, then limitations, method and numbered sources. Rows are never split across pages; a long
 *   table repeats its heading and column headings on each page; the wide peer matrix prints five
 *   fees at a time.
 */
import { Circle, Document, Font, Line, Link, Page, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { readerAsOf } from "@/lib/hamilton/board-brief";
import { packetMoney, packetSections, per10k, type CommitteePacket, type LabelledTable, type NormalizedIncome, type PacketFeeBar, type PacketTable, type PacketTableId } from "@/lib/hamilton/committee-packet";
import { HAMILTON_ATTRIBUTION } from "@/lib/constants";
import { RD_PDF, RD_PDF_CHART } from "@/lib/report-design/tokens";

// Words wrap whole, as in the other report PDFs, so a document number or figure never splits.
Font.registerHyphenationCallback((word) => [word]);

export type PacketPageSize = "LETTER" | "A4";

/** A table with more rows than this gets pages of its own with a repeating header. */
const SHORT_TABLE_ROWS = 12;
/** Fees per printed part of the peer matrix. */
const MATRIX_FEES_PER_PART = 5;

const C = RD_PDF;
const K = RD_PDF_CHART;
const PAPER = "#ffffff";
const MARGIN = 58;

const s = StyleSheet.create({
  page: { backgroundColor: PAPER, paddingTop: 50, paddingBottom: 64, paddingHorizontal: MARGIN, fontFamily: "Helvetica", fontSize: 11, color: C.textPrimary },
  // Page one.
  masthead: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 0.75, borderBottomColor: C.textPrimary, borderBottomStyle: "solid", paddingBottom: 6, marginBottom: 4 },
  mastLeft: { fontSize: 9, fontFamily: "Helvetica-Bold", letterSpacing: 0.6, textTransform: "uppercase", color: C.textPrimary },
  mastRight: { fontSize: 9, color: C.textSecondary },
  context: { fontSize: 9.5, color: C.textSecondary, lineHeight: 1.4, marginBottom: 22 },
  conclusion: { fontSize: 16, fontFamily: "Helvetica-Bold", lineHeight: 1.35, marginBottom: 22 },
  section: { fontSize: 9, fontFamily: "Helvetica-Bold", letterSpacing: 0.8, textTransform: "uppercase", color: C.accent, marginBottom: 8 },
  finding: { flexDirection: "row", borderTopWidth: 0.5, borderTopColor: C.borderDark, borderTopStyle: "solid", paddingTop: 9, paddingBottom: 10 },
  findingN: { width: 18, fontSize: 12, fontFamily: "Helvetica-Bold", color: C.accent },
  findingMain: { flex: 1, paddingRight: 14 },
  statement: { fontSize: 12, fontFamily: "Helvetica-Bold", lineHeight: 1.35, marginBottom: 3 },
  evidence: { fontSize: 11, lineHeight: 1.45 },
  why: { fontSize: 11, lineHeight: 1.45, color: C.textSecondary, marginTop: 2 },
  margin: { width: 148 },
  marginRuled: { borderLeftWidth: 0.75, borderLeftColor: C.accent, borderLeftStyle: "solid", paddingLeft: 8 },
  marginLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.accent, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 2 },
  marginText: { fontSize: 9.5, lineHeight: 1.4, color: C.textSecondary },
  next: { borderTopWidth: 0.75, borderTopColor: C.textPrimary, borderTopStyle: "solid", paddingTop: 10, marginTop: 10 },
  action: { fontSize: 12, fontFamily: "Helvetica-Bold", lineHeight: 1.4, marginBottom: 4 },
  rationale: { fontSize: 11, lineHeight: 1.45, color: C.textSecondary },
  // Page two.
  pageTitle: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 14 },
  exhibit: { marginBottom: 22 },
  exLabel: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: C.accent, letterSpacing: 0.8, textTransform: "uppercase" },
  exTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", lineHeight: 1.3, marginTop: 2, marginBottom: 6 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendText: { fontSize: 8.5, color: C.textSecondary },
  barRow: { flexDirection: "row", alignItems: "center", borderTopWidth: 0.5, borderTopColor: C.borderDark, borderTopStyle: "solid", paddingVertical: 4.5 },
  barName: { width: 132, fontSize: 10, paddingRight: 6 },
  barNote: { fontSize: 8.5, color: C.textTertiary },
  barValue: { flex: 1, fontSize: 10, textAlign: "right", lineHeight: 1.35 },
  axis: { fontSize: 8, color: C.textTertiary },
  exNote: { fontSize: 9, color: C.textSecondary, lineHeight: 1.4, marginTop: 6 },
  // Appendix and tables (9pt, never smaller).
  kicker: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: C.accent, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6 },
  part: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 12 },
  sub: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 6 },
  body: { fontSize: 10, lineHeight: 1.45 },
  item: { flexDirection: "row", marginBottom: 5 },
  itemSmallMark: { width: 12, fontSize: 9, color: C.textSecondary },
  itemSmall: { flex: 1, fontSize: 9.5, lineHeight: 1.45, color: C.textSecondary },
  block: { marginBottom: 20 },
  label: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: C.accent, textTransform: "uppercase", letterSpacing: 1 },
  tableTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", lineHeight: 1.3, marginTop: 2 },
  tableSub: { fontSize: 9, color: C.textSecondary, lineHeight: 1.4, marginTop: 2, marginBottom: 6 },
  headRow: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: C.textPrimary, borderBottomStyle: "solid", paddingVertical: 4 },
  headCell: { fontSize: 9, fontFamily: "Helvetica-Bold", color: C.textSecondary, paddingHorizontal: 3, lineHeight: 1.3 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.borderDark, borderBottomStyle: "solid", paddingVertical: 4 },
  ownRow: { backgroundColor: K.band },
  cell: { fontSize: 9, paddingHorizontal: 3, lineHeight: 1.35 },
  firstCell: { fontFamily: "Helvetica-Bold" },
  num: { textAlign: "right" },
  note: { fontSize: 9, color: C.textTertiary, lineHeight: 1.4, marginTop: 5 },
  source: { fontSize: 9, color: C.textTertiary, marginTop: 3 },
  fixedHead: { marginBottom: 0 },
  footer: { position: "absolute", bottom: 30, left: MARGIN, right: MARGIN, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 8, color: C.textTertiary },
  sourceItem: { flexDirection: "row", marginBottom: 4 },
  sourceN: { width: 26, fontSize: 9, fontFamily: "Helvetica-Bold" },
  sourceText: { flex: 1, fontSize: 9, lineHeight: 1.4, color: C.textSecondary },
  link: { color: C.accent, textDecoration: "none" },
});

/** Width of a fee row's drawing on page two. */
const TRACK = 210;

function Legend() {
  return (
    <View style={s.legend} wrap={false}>
      <View style={s.legendItem}>
        <Svg width={8} height={8}><Circle cx={4} cy={4} r={3.5} fill={K.accent} /></Svg>
        <Text style={s.legendText}>Your fee, outside the middle 50%</Text>
      </View>
      <View style={s.legendItem}>
        <Svg width={8} height={8}><Circle cx={4} cy={4} r={3.5} fill={K.muted} /></Svg>
        <Text style={s.legendText}>Within it</Text>
      </View>
      <View style={s.legendItem}>
        <Svg width={14} height={8}><Rect x={0} y={1} width={14} height={6} fill={K.band} /></Svg>
        <Text style={s.legendText}>Peers&apos; middle 50%</Text>
      </View>
      <View style={s.legendItem}>
        <Svg width={4} height={10}><Line x1={2} y1={0} x2={2} y2={10} stroke={K.ink} strokeWidth={1.2} /></Svg>
        <Text style={s.legendText}>Peer median</Text>
      </View>
      <View style={s.legendItem}>
        <Svg width={14} height={8}><Line x1={0} y1={4} x2={14} y2={4} stroke={K.faint} strokeWidth={1} /></Svg>
        <Text style={s.legendText}>Lowest to highest peer</Text>
      </View>
    </View>
  );
}

interface Track {
  low: number | null;
  high: number | null;
  q1: number;
  q3: number;
  median: number;
  own: number | null;
  outside: boolean;
  fmt: (v: number) => string;
}

/** One row's drawing: the peers' spread as a line, middle 50% as a band, median as a tick, the bank as a dot. */
function TrackDrawing({ t }: { t: Track }) {
  const values = [t.low, t.high, t.q1, t.q3, t.median, t.own].filter((v): v is number => v !== null);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = hi > lo ? (hi - lo) * 0.08 : Math.max(hi * 0.2, 1);
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const x = (v: number) => 5 + ((v - min) / (max - min || 1)) * (TRACK - 10);
  return (
    <View>
      <Svg width={TRACK} height={16}>
        {t.low !== null && t.high !== null ? <Line x1={x(t.low)} y1={8} x2={x(t.high)} y2={8} stroke={K.faint} strokeWidth={0.8} /> : null}
        <Rect x={x(t.q1)} y={3.5} width={Math.max(2, x(t.q3) - x(t.q1))} height={9} fill={K.band} />
        <Line x1={x(t.median)} y1={0.5} x2={x(t.median)} y2={15.5} stroke={K.ink} strokeWidth={1.2} />
        {t.own !== null ? <Circle cx={x(t.own)} cy={8} r={4} fill={t.outside ? K.accent : K.muted} /> : null}
      </Svg>
      {/* The lowest and highest peer, under the ends of the line they label. */}
      {t.low !== null && t.high !== null ? (
        <View style={{ width: TRACK, height: 10, position: "relative" }}>
          <Text style={[s.axis, { position: "absolute", left: x(t.low) - 2 }]}>{t.fmt(t.low)}</Text>
          <Text style={[s.axis, { position: "absolute", left: x(t.high) - 48, width: 50, textAlign: "right" }]}>{t.fmt(t.high)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const BAND_WORD = { above: "Above", within: "Within", below: "Below" } as const;

function FeeBars({ bars }: { bars: PacketFeeBar[] }) {
  return (
    <View>
      <Legend />
      {bars.map((b) => {
        const placed = b.median !== null && b.q1 !== null && b.q3 !== null;
        const outside = b.band === "above" || b.band === "below";
        return (
          <View key={b.feeCategory} style={s.barRow} wrap={false}>
            <Text style={s.barName}>
              {b.name}
              {b.comparedWith ? <Text style={s.barNote}>{`\ncompared with ${b.comparedWith}`}</Text> : null}
            </Text>
            {placed ? (
              <TrackDrawing t={{ low: b.low, high: b.high, q1: b.q1 as number, q3: b.q3 as number, median: b.median as number, own: b.current, outside, fmt: packetMoney }} />
            ) : (
              <Text style={[s.axis, { width: TRACK }]}>{b.peers === 0 ? "No peer publishes it" : `Only ${b.peers} ${b.peers === 1 ? "peer publishes" : "peers publish"} it; not placed`}</Text>
            )}
            <Text style={s.barValue}>
              {b.current === null ? (
                <Text style={{ color: C.textTertiary }}>Not on the schedule</Text>
              ) : (
                <Text style={{ fontFamily: "Helvetica-Bold", color: outside ? C.accent : C.textPrimary }}>{packetMoney(b.current)}</Text>
              )}
              {placed ? <Text style={{ color: C.textSecondary }}>{` · median ${packetMoney(b.median as number)}`}</Text> : null}
              {b.marks ? <Text style={{ color: C.textTertiary }}>{` ${b.marks}`}</Text> : null}
              {b.band && placed ? <Text style={{ color: C.textTertiary, fontSize: 9 }}>{`\n${BAND_WORD[b.band]} · ${b.peers} peers`}</Text> : null}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Fee income per $10,000 of assets, drawn like a fee row: the peers' middle 50% and median, and the bank. */
function IncomeRow({ n }: { n: NormalizedIncome }) {
  const outside = n.own !== null && n.q1 !== null && n.q3 !== null && (n.own > n.q3 || n.own < n.q1);
  return (
    <View style={s.barRow} wrap={false}>
      <Text style={s.barName}>Income per $10,000 of assets</Text>
      <TrackDrawing t={{ low: null, high: null, q1: n.q1 as number, q3: n.q3 as number, median: n.median as number, own: n.own, outside, fmt: per10k }} />
      <Text style={s.barValue}>
        <Text style={{ fontFamily: "Helvetica-Bold", color: outside ? C.accent : C.textPrimary }}>{per10k(n.own as number)}</Text>
        <Text style={{ color: C.textSecondary }}>{` · median ${per10k(n.median as number)}`}</Text>
        <Text style={{ color: C.textTertiary, fontSize: 9 }}>{`\n${n.peersCompared} peers${n.placement ? ` · ${n.placement}` : ""}`}</Text>
      </Text>
    </View>
  );
}

/** Column weights per table; the first column carries names. */
const WIDTHS: Partial<Record<PacketTableId, number[]>> = {
  position: [2.1, 2.1, 1.5, 1.4, 2.1, 1.3],
  peer_changes: [2.2, 1.4, 2.6, 1.2, 0.8],
  income_trend: [1.2, 1.6, 2.6],
  normalized_income: [2.6, 2],
  nearest_peers: [1.2, 1.1, 2.3, 2.3, 1.9],
  product_details: [1.3, 2, 0.9, 1, 2.6, 0.7],
  regulatory: [5, 1.2, 0.8],
  price_and_yield: [2.2, 1, 1.5, 1.4, 2],
};

const FIGURE = /^[-+]?\$[\d,.]+(?: (?:million|billion))?(?: \[\d+(?:, \d+)*\])?$/;

/** Joins a heading's last two words, so no heading ends with one word on its own line. */
function keepTogether(text: string): string {
  const i = text.lastIndexOf(" ");
  return i > 0 ? `${text.slice(0, i)}\u00a0${text.slice(i + 1)}` : text;
}

function widths(t: PacketTable): number[] {
  const known = WIDTHS[t.id];
  if (known && known.length === t.columns.length) return known;
  // The peer matrix: the institution wide, each fee narrow, the source column narrow.
  return t.columns.map((_, i) => (i === 0 ? 2.6 : i === t.columns.length - 1 ? 0.9 : 1));
}

function figureColumns(t: PacketTable): Set<number> {
  const out = new Set<number>();
  for (let c = 1; c < t.columns.length; c++) {
    const cells = t.rows.map((r) => r[c]).filter((v) => v && v !== "–" && !/^Not found/.test(v));
    if (cells.length && cells.every((v) => FIGURE.test(v))) out.add(c);
  }
  return out;
}

function HeadRow({ t }: { t: PacketTable }) {
  const w = widths(t);
  const figures = figureColumns(t);
  return (
    <View style={s.headRow}>
      {t.columns.map((c, i) => (
        <Text key={i} style={[s.headCell, { flex: w[i] }, figures.has(i) ? s.num : {}]}>
          {c}
        </Text>
      ))}
    </View>
  );
}

function Rows({ t }: { t: PacketTable }) {
  const w = widths(t);
  const figures = figureColumns(t);
  return (
    <>
      {t.rows.map((row, r) => (
        <View key={r} style={[s.row, t.ownFirst && r === 0 ? s.ownRow : {}]} wrap={false}>
          {row.map((cell, c) => (
            <Text key={c} style={[s.cell, { flex: w[c] }, c === 0 ? s.firstCell : {}, figures.has(c) ? s.num : {}]}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </>
  );
}

function TableFoot({ t, readOn }: { t: PacketTable; readOn: string }) {
  return (
    <View wrap={false}>
      {t.note ? <Text style={s.note}>{t.note}</Text> : null}
      <Text style={s.source}>
        Source: {t.source}, read {readOn}.
      </Text>
    </View>
  );
}

/** A table that fits on one page, kept whole with its heading. */
function ShortTable({ l, readOn, before, heading }: { l: LabelledTable; readOn: string; before?: ReactNode; heading?: string }) {
  return (
    <View style={s.block} wrap={false}>
      {heading ? <Text style={[s.part, { marginTop: 8 }]}>{heading}</Text> : null}
      <Text style={s.label}>{l.label}</Text>
      <Text style={s.tableTitle}>{keepTogether(l.table.title)}</Text>
      {l.table.subtitle ? <Text style={s.tableSub}>{l.table.subtitle}</Text> : null}
      {before}
      <HeadRow t={l.table} />
      <Rows t={l.table} />
      <TableFoot t={l.table} readOn={readOn} />
    </View>
  );
}

function Footer({ packet }: { packet: CommitteePacket }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>
        {HAMILTON_ATTRIBUTION} · Pricing committee brief · read {readerAsOf(packet.generatedAt)}
      </Text>
      <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

/** A long table on pages of its own: part, label, title and column headings repeat on each page. */
function LongTablePages({ part, l, readOn, size, packet, heading }: { part: string; l: LabelledTable; readOn: string; size: PacketPageSize; packet: CommitteePacket; heading?: string }) {
  return (
    <Page size={size} style={s.page}>
      {/* The part's heading, once, above the first page's repeating header. */}
      {heading ? <Text style={s.part}>{heading}</Text> : null}
      <View style={s.fixedHead} fixed>
        <Text style={s.label}>{l.label.startsWith(part) || heading ? l.label : `${part} · ${l.label}`}</Text>
        {/* A static title: a render-prop title inside a repeating header printed blank. */}
        <Text style={s.tableTitle}>{keepTogether(l.table.title)}</Text>
        {l.table.subtitle ? <Text style={s.tableSub}>{l.table.subtitle}</Text> : <View style={{ height: 5 }} />}
        <HeadRow t={l.table} />
      </View>
      <Rows t={l.table} />
      <TableFoot t={l.table} readOn={readOn} />
      <Footer packet={packet} />
    </Page>
  );
}

/** The peer matrix in parts of five fees, each part repeating the institution and source columns. */
function matrixParts(l: LabelledTable): LabelledTable[] {
  const t = l.table;
  const fees = t.columns.length - 2;
  if (fees <= MATRIX_FEES_PER_PART) return [l];
  const parts: LabelledTable[] = [];
  const count = Math.ceil(fees / MATRIX_FEES_PER_PART);
  for (let p = 0; p < count; p++) {
    const from = 1 + p * MATRIX_FEES_PER_PART;
    const to = Math.min(from + MATRIX_FEES_PER_PART, 1 + fees);
    const pick = (cells: string[]) => [cells[0], ...cells.slice(from, to), cells[cells.length - 1]];
    parts.push({
      ...l,
      table: {
        ...t,
        title: `${t.title}, part ${p + 1} of ${count}`,
        columns: pick(t.columns),
        rows: t.rows.map(pick),
        note: t.note,
      },
    });
  }
  return parts;
}

function isLong(t: PacketTable): boolean {
  return t.rows.length > SHORT_TABLE_ROWS || t.id === "peer_fee_matrix" || t.id === "product_details";
}

type AppendixStep = { kind: "short"; tables: LabelledTable[] } | { kind: "long"; table: LabelledTable };

/** Appendix pages in order: consecutive short tables share a page; a long one (or a matrix part) has its own. */
function appendixPlan(appendix: LabelledTable[]): AppendixStep[] {
  const steps: AppendixStep[] = [];
  for (const l of appendix) {
    if (isLong(l.table)) {
      for (const part of l.table.id === "peer_fee_matrix" ? matrixParts(l) : [l]) steps.push({ kind: "long", table: part });
      continue;
    }
    const last = steps[steps.length - 1];
    if (last?.kind === "short") last.tables.push(l);
    else steps.push({ kind: "short", tables: [l] });
  }
  return steps;
}

function Bullets({ items }: { items: string[] }) {
  return (
    <>
      {items.map((text, i) => (
        <View key={i} style={s.item} wrap={false}>
          <Text style={s.itemSmallMark}>•</Text>
          <Text style={s.itemSmall}>{text}</Text>
        </View>
      ))}
    </>
  );
}

export function CommitteePacketPdf({ packet, pageSize = "LETTER" }: { packet: CommitteePacket; pageSize?: PacketPageSize }) {
  const readOn = readerAsOf(packet.generatedAt);
  const sections = packetSections(packet);
  const page = (key: string, children: ReactNode) => (
    <Page key={key} size={pageSize} style={s.page}>
      {children}
      <Footer packet={packet} />
    </Page>
  );
  const [exhibit1] = sections.position;
  const n = packet.financial.normalized;
  const normalizedTable = sections.financial.find((l) => l.table.id === "normalized_income");
  const { conclusion, findings, nextStep } = packet.brief;
  // The appendix: Exhibit 1 in full first, then every other table in reading order.
  const exhibits = [...sections.position, ...sections.financial].sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }));
  const appendixTables = [...exhibits.map((l) => (l.table.id === "position" || l.table.id === "normalized_income" ? { ...l, label: `${l.label} in full` } : l)), ...sections.appendix];
  return (
    <Document title={packet.title} author="Fee Insight" subject="Pricing committee brief">
      {page(
        "brief",
        <>
          <View style={s.masthead}>
            <Text style={s.mastLeft}>Pricing committee brief</Text>
            <Text style={s.mastRight}>{readOn}</Text>
          </View>
          <Text style={s.context}>
            {packet.institutionName} · Compared with {packet.peerGroupLabel}
          </Text>
          <Text style={s.conclusion}>{conclusion}</Text>
          {findings.length ? (
            <>
              <Text style={s.section}>Findings</Text>
              {findings.map((f, i) => (
                <View key={f.feeCategory} style={s.finding} wrap={false}>
                  <Text style={s.findingN}>{i + 1}</Text>
                  <View style={s.findingMain}>
                    <Text style={s.statement}>{f.statement}</Text>
                    <Text style={s.evidence}>{f.evidence}</Text>
                    {f.why ? <Text style={s.why}>{f.why}</Text> : null}
                  </View>
                  {/* The material uncertainty sits beside the finding it qualifies. */}
                  <View style={s.margin}>
                    {f.uncertainty ? (
                      <View style={s.marginRuled}>
                        <Text style={s.marginLabel}>Uncertainty</Text>
                        <Text style={s.marginText}>{f.uncertainty}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              ))}
            </>
          ) : null}
          {nextStep ? (
            <View style={s.next} wrap={false}>
              <Text style={s.section}>Recommended next step</Text>
              <Text style={s.action}>{nextStep.action}</Text>
              <Text style={s.rationale}>{nextStep.rationale}</Text>
            </View>
          ) : null}
        </>,
      )}

      {page(
        "exhibits",
        <>
          <Text style={s.pageTitle}>Supporting exhibits</Text>
          {exhibit1 ? (
            <View style={s.exhibit}>
              <Text style={s.exLabel}>{exhibit1.label}</Text>
              <Text style={s.exTitle}>{keepTogether(`Each fee against ${packet.peerGroupLabel}`)}</Text>
              <FeeBars bars={packet.position.bars} />
              <Text style={s.exNote}>Source: {exhibit1.table.source}, read {readOn}. In full in the appendix, with each peer by name.</Text>
            </View>
          ) : null}
          {normalizedTable && n && n.own !== null && n.median !== null && n.q1 !== null && n.q3 !== null ? (
            <View style={s.exhibit} wrap={false}>
              <Text style={s.exLabel}>{normalizedTable.label}</Text>
              <Text style={s.exTitle}>{keepTogether(`Deposit service charge income per $10,000 of total assets, quarter ending ${readerAsOf(n.quarter)}`)}</Text>
              <IncomeRow n={n} />
              {packet.financial.trendSummary ? <Text style={[s.exNote, { fontSize: 10, color: C.textPrimary }]}>{packet.financial.trendSummary}</Text> : null}
              <Text style={s.exNote}>{packet.financial.context}</Text>
              <Text style={s.exNote}>Source: {normalizedTable.table.source}, read {readOn}.</Text>
            </View>
          ) : packet.financial.trendSummary ? (
            <Text style={s.body}>{packet.financial.trendSummary}</Text>
          ) : null}
        </>,
      )}

      {appendixPlan(appendixTables).map((step, i) => {
        const heading = i === 0 ? "Evidence appendix" : undefined;
        if (step.kind === "long") {
          return <LongTablePages key={`${step.table.anchor}-${step.table.table.title}`} part="Appendix" l={step.table} readOn={readOn} size={pageSize} packet={packet} heading={heading} />;
        }
        return page(
          `appendix-${step.tables[0].anchor}`,
          <>
            {heading ? <Text style={s.part}>{heading}</Text> : null}
            {step.tables.map((l) => (
              <ShortTable key={l.anchor} l={l} readOn={readOn} />
            ))}
            {i === 0 && packet.position.comparedNote ? <Text style={s.body}>{packet.position.comparedNote}</Text> : null}
          </>,
        );
      })}

      {page(
        "method",
        <>
          <Text style={s.part}>Limitations, method and sources</Text>
          <Text style={[s.sub, { marginTop: 0 }]}>Material limitations</Text>
          <Bullets items={packet.brief.limitations} />
          {packet.unavailable.length ? (
            <>
              <Text style={s.sub} minPresenceAhead={40}>
                Not available in this packet
              </Text>
              <Bullets items={packet.unavailable} />
            </>
          ) : null}
          <Text style={s.sub} minPresenceAhead={40}>
            Method
          </Text>
          <Bullets items={[packet.feeListNote, ...packet.method]} />
          <Text style={s.sub} minPresenceAhead={40}>
            Sources
          </Text>
          {packet.footnotes.map((f) => (
            <View key={f.n} style={s.sourceItem} wrap={false}>
              <Text style={s.sourceN}>[{f.n}]</Text>
              <Text style={s.sourceText}>
                {f.label}
                {f.detail ? ` · ${f.detail}` : ""}
                {f.url ? (
                  <>
                    {" · "}
                    <Link src={f.url} style={s.link}>
                      {f.url}
                    </Link>
                  </>
                ) : null}
              </Text>
            </View>
          ))}
        </>,
      )}
    </Document>
  );
}
