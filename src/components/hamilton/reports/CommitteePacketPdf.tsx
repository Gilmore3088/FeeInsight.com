/**
 * The pricing committee packet as a printed document (@react-pdf/renderer). Server-side only;
 * the /api/pro/report-pdf route loads it on demand.
 *
 * The same parts as the screen, exhibits first: the executive brief opens with four key figures and
 * Exhibit 1 drawn as one range row per fee, then the fees for review as short cards; financial context
 * is a chart and two figures; every table follows in the appendix (Exhibit 1 in full first); the
 * limitations, method and numbered sources close the document. Print rules, checked at Letter and A4:
 * - every row is kept whole (wrap={false}), so no row splits across pages;
 * - a table short enough for one page is kept whole with its heading; a longer one gets pages of its
 *   own whose header (label, title and column headings) repeats on each;
 * - the wide peer matrix is printed five fees at a time, so no column is clipped;
 * - no text is smaller than 8pt, and each footnote mark is the number in the Sources list.
 */
import { Circle, Document, Font, Line, Link, Page, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { readerAsOf } from "@/lib/hamilton/board-brief";
import { packetMoney, packetSections, per10k, type CommitteePacket, type LabelledTable, type PacketFeeBar, type PacketIncomeSeries, type PacketTable, type PacketTableId } from "@/lib/hamilton/committee-packet";
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

const s = StyleSheet.create({
  page: { backgroundColor: C.surface, paddingTop: 44, paddingBottom: 60, paddingHorizontal: 44, fontFamily: "Helvetica", fontSize: 10, color: C.textPrimary },
  kicker: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.accent, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", lineHeight: 1.2, marginBottom: 6 },
  meta: { fontSize: 9, color: C.textSecondary, lineHeight: 1.45 },
  header: { borderBottomWidth: 1, borderBottomColor: C.borderDark, borderBottomStyle: "solid", paddingBottom: 12, marginBottom: 16 },
  part: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 10 },
  sub: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 6 },
  body: { fontSize: 10, lineHeight: 1.45 },
  item: { flexDirection: "row", marginBottom: 5 },
  itemMark: { width: 16, fontSize: 10, fontFamily: "Helvetica-Bold", color: C.accent },
  itemSmallMark: { width: 12, fontSize: 9, color: C.textSecondary },
  itemText: { flex: 1, fontSize: 10, lineHeight: 1.45 },
  itemSmall: { flex: 1, fontSize: 9, lineHeight: 1.4, color: C.textSecondary },
  priority: { backgroundColor: C.surfaceElevated, borderRadius: 3, padding: 8, marginBottom: 6 },
  priorityFee: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  callout: { borderLeftWidth: 2, borderLeftColor: C.accent, borderLeftStyle: "solid", backgroundColor: C.surfaceElevated, padding: 8, marginBottom: 8, fontSize: 9, lineHeight: 1.4 },
  block: { marginBottom: 16 },
  label: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.accent, textTransform: "uppercase", letterSpacing: 1 },
  tableTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", lineHeight: 1.3, marginTop: 2 },
  tableSub: { fontSize: 8.5, color: C.textSecondary, lineHeight: 1.35, marginTop: 2, marginBottom: 5 },
  headRow: { flexDirection: "row", backgroundColor: C.surfaceElevated, paddingVertical: 4 },
  headCell: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.textSecondary, paddingHorizontal: 3, lineHeight: 1.25 },
  row: { flexDirection: "row", borderTopWidth: 0.5, borderTopColor: C.borderDark, borderTopStyle: "solid", paddingVertical: 3.5 },
  ownRow: { backgroundColor: RD_PDF_CHART.band },
  cell: { fontSize: 8, paddingHorizontal: 3, lineHeight: 1.3 },
  firstCell: { fontFamily: "Helvetica-Bold" },
  num: { textAlign: "right" },
  note: { fontSize: 8, color: C.textTertiary, lineHeight: 1.35, marginTop: 4 },
  source: { fontSize: 8, color: C.textTertiary, marginTop: 2 },
  fixedHead: { marginBottom: 0 },
  footer: { position: "absolute", bottom: 28, left: 44, right: 44, borderTopWidth: 0.5, borderTopColor: C.borderDark, borderTopStyle: "solid", paddingTop: 6, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 8, color: C.textTertiary },
  sourceItem: { flexDirection: "row", marginBottom: 4 },
  sourceN: { width: 24, fontSize: 8, fontFamily: "Helvetica-Bold" },
  sourceText: { flex: 1, fontSize: 8, lineHeight: 1.35, color: C.textSecondary },
  link: { color: C.accent, textDecoration: "none" },
  tiles: { flexDirection: "row", gap: 6, marginBottom: 14 },
  tile: { flex: 1, backgroundColor: C.surfaceElevated, borderRadius: 3, paddingVertical: 8, paddingHorizontal: 9 },
  tileValue: { fontSize: 17, fontFamily: "Helvetica-Bold", color: C.textPrimary },
  tileLabel: { fontSize: 8, color: C.textSecondary, lineHeight: 1.3, marginTop: 2 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4, marginBottom: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendText: { fontSize: 8, color: C.textSecondary },
  barRow: { flexDirection: "row", alignItems: "center", borderTopWidth: 0.5, borderTopColor: C.borderDark, borderTopStyle: "solid", paddingVertical: 4 },
  barName: { width: 128, fontSize: 9, fontFamily: "Helvetica-Bold", paddingRight: 6 },
  barNote: { fontSize: 8, color: C.textTertiary, fontFamily: "Helvetica" },
  barValue: { flex: 1, fontSize: 8.5, textAlign: "right", lineHeight: 1.35 },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  card: { width: "48.8%", backgroundColor: C.surfaceElevated, borderRadius: 3, padding: 8 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  chip: { fontSize: 7.5, color: C.accent, fontFamily: "Helvetica-Bold" },
  axis: { fontSize: 7.5, color: C.textTertiary },
});

/** Width of a fee row's drawing in Exhibit 1. */
const TRACK = 230;

/** The figures over the brief: fees above, within and below the peers' middle 50%, and income. */
function Glance({ packet }: { packet: CommitteePacket }) {
  const g = packet.glance;
  const n = packet.financial.normalized;
  const tiles = g.placed
    ? [
        { value: `${g.above} of ${g.placed}`, label: "Fees above the peers' middle 50%" },
        { value: `${g.within} of ${g.placed}`, label: "Fees within it" },
        { value: `${g.below} of ${g.placed}`, label: "Fees below it" },
      ]
    : [{ value: `${g.published} of ${g.fees}`, label: "Fees published; too few peers publish any of them to place" }];
  if (n && n.own !== null && n.median !== null) tiles.push({ value: per10k(n.own), label: `Fee income per $10,000 of assets; peer median ${per10k(n.median)}` });
  return <Tiles tiles={tiles} />;
}

function Tiles({ tiles }: { tiles: { value: string; label: string }[] }) {
  return (
    <View style={s.tiles} wrap={false}>
      {tiles.map((t) => (
        <View key={t.label} style={s.tile}>
          <Text style={s.tileValue}>{t.value}</Text>
          <Text style={s.tileLabel}>{t.label}</Text>
        </View>
      ))}
    </View>
  );
}

const BAND_WORD = { above: "Above", within: "Within", below: "Below" } as const;

/** Exhibit 1 drawn: per fee, the peers' spread as a line, middle 50% as a band, median as a tick, the bank as a dot. */
function FeeBars({ bars }: { bars: PacketFeeBar[] }) {
  return (
    <View>
      <View style={s.legend} wrap={false}>
        <View style={s.legendItem}>
          <Svg width={8} height={8}><Circle cx={4} cy={4} r={3.5} fill={RD_PDF_CHART.accent} /></Svg>
          <Text style={s.legendText}>Your fee, outside the middle 50%</Text>
        </View>
        <View style={s.legendItem}>
          <Svg width={8} height={8}><Circle cx={4} cy={4} r={3.5} fill={RD_PDF_CHART.muted} /></Svg>
          <Text style={s.legendText}>Within it</Text>
        </View>
        <View style={s.legendItem}>
          <Svg width={14} height={8}><Rect x={0} y={1} width={14} height={6} fill={RD_PDF_CHART.band} /></Svg>
          <Text style={s.legendText}>Peers&apos; middle 50%</Text>
        </View>
        <View style={s.legendItem}>
          <Svg width={4} height={10}><Line x1={2} y1={0} x2={2} y2={10} stroke={RD_PDF_CHART.ink} strokeWidth={1.2} /></Svg>
          <Text style={s.legendText}>Peer median</Text>
        </View>
        <View style={s.legendItem}>
          <Svg width={14} height={8}><Line x1={0} y1={4} x2={14} y2={4} stroke={RD_PDF_CHART.faint} strokeWidth={1} /></Svg>
          <Text style={s.legendText}>Lowest to highest peer</Text>
        </View>
      </View>
      {bars.map((b) => {
        const placed = b.median !== null && b.q1 !== null && b.q3 !== null && b.low !== null && b.high !== null;
        const outside = b.band === "above" || b.band === "below";
        const values = [b.low, b.high, b.current, b.median].filter((v): v is number => v !== null);
        const lo = Math.min(...values);
        const hi = Math.max(...values);
        const pad = hi > lo ? (hi - lo) * 0.08 : Math.max(hi * 0.2, 1);
        const min = Math.max(0, lo - pad);
        const max = hi + pad;
        const x = (v: number) => 5 + ((v - min) / (max - min || 1)) * (TRACK - 10);
        return (
          <View key={b.feeCategory} style={s.barRow} wrap={false}>
            <Text style={s.barName}>
              {b.name}
              {b.comparedWith ? <Text style={s.barNote}>{`\ncompared with ${b.comparedWith}`}</Text> : null}
            </Text>
            {placed ? (
              <View>
                <Svg width={TRACK} height={16}>
                  <Line x1={x(b.low as number)} y1={8} x2={x(b.high as number)} y2={8} stroke={RD_PDF_CHART.faint} strokeWidth={0.8} />
                  <Rect x={x(b.q1 as number)} y={3.5} width={Math.max(2, x(b.q3 as number) - x(b.q1 as number))} height={9} fill={RD_PDF_CHART.band} />
                  <Line x1={x(b.median as number)} y1={0.5} x2={x(b.median as number)} y2={15.5} stroke={RD_PDF_CHART.ink} strokeWidth={1.2} />
                  {b.current !== null ? <Circle cx={x(b.current)} cy={8} r={4} fill={outside ? RD_PDF_CHART.accent : RD_PDF_CHART.muted} /> : null}
                </Svg>
                {/* The lowest and highest peer, under the ends of the line they label. */}
                <View style={{ width: TRACK, height: 10, position: "relative" }}>
                  <Text style={[s.axis, { position: "absolute", left: x(b.low as number) - 2 }]}>{packetMoney(b.low as number)}</Text>
                  <Text style={[s.axis, { position: "absolute", left: x(b.high as number) - 48, width: 50, textAlign: "right" }]}>{packetMoney(b.high as number)}</Text>
                </View>
              </View>
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
              {b.band && placed ? <Text style={{ color: C.textTertiary }}>{`\n${BAND_WORD[b.band]} · ${b.peers} peers`}</Text> : null}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** The bank's own filed income by quarter, oldest first; no raw-dollar peer line (size would mix in). */
function IncomeBars({ series }: { series: PacketIncomeSeries }) {
  const W = 300;
  const H = 90;
  const max = Math.max(...series.own) * 1.12 || 1;
  const slot = W / series.own.length;
  const y = (v: number) => H - (v / max) * H;
  const short = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${Math.round(v / 1000)}K`);
  return (
    <View wrap={false}>
      <Svg width={W} height={H + 10}>
        <Line x1={0} y1={H} x2={W} y2={H} stroke={RD_PDF_CHART.rule} strokeWidth={1} />
        {series.own.map((v, i) => (
          <Rect key={series.quarters[i]} x={slot * i + slot * 0.2} y={y(v)} width={slot * 0.6} height={H - y(v)} fill={i === series.own.length - 1 ? RD_PDF_CHART.accent : RD_PDF_CHART.bar} />
        ))}
      </Svg>
      <View style={{ width: W, flexDirection: "row" }}>
        {series.quarters.map((q, i) => (
          <Text key={q} style={[s.axis, { width: slot, textAlign: "center" }]}>
            {q.replace("-", " ")}
            {`\n${short(series.own[i])}`}
          </Text>
        ))}
      </View>
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
        {HAMILTON_ATTRIBUTION} · Pricing committee packet · read {readerAsOf(packet.generatedAt)}
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

function Bullets({ items, small = false }: { items: string[]; small?: boolean }) {
  return (
    <>
      {items.map((text, i) => (
        <View key={i} style={s.item} wrap={false}>
          <Text style={s.itemSmallMark}>•</Text>
          <Text style={small ? s.itemSmall : s.itemText}>{text}</Text>
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
  const shortOf = (ls: LabelledTable[]) => ls.filter((l) => !isLong(l.table));
  const longOf = (ls: LabelledTable[]) => ls.filter((l) => isLong(l.table));
  const [exhibit1, ...otherPosition] = sections.position;
  const n = packet.financial.normalized;
  const trend = sections.financial.find((l) => l.table.id === "income_trend");
  const normalizedTable = sections.financial.find((l) => l.table.id === "normalized_income");
  const readOnSource = (l: LabelledTable) => `Source: ${l.table.source}, read ${readOn}.`;
  // Exhibit 1's table leads the appendix, under its own label.
  const fullExhibit1 = exhibit1 ? [{ ...exhibit1, label: `${exhibit1.label} in full` }] : [];
  return (
    <Document title={packet.title} author="Fee Insight" subject="Pricing committee packet">
      {page(
        "brief",
        <>
          <View style={s.header}>
            <Text style={s.kicker}>Pricing committee packet</Text>
            <Text style={s.title}>{keepTogether(packet.title)}</Text>
            <Text style={s.meta}>
              Read {readOn}. Peers: {packet.peerGroupLabel}.
            </Text>
          </View>
          <Text style={s.part}>Executive brief</Text>
          <Glance packet={packet} />
          {exhibit1 ? (
            <View style={s.block}>
              <Text style={s.label}>{exhibit1.label}</Text>
              <Text style={s.tableTitle}>{keepTogether(`Where each fee sits among ${packet.peerGroupLabel}`)}</Text>
              <FeeBars bars={packet.position.bars} />
              <Text style={s.source}>{readOnSource(exhibit1)} The table is in the appendix.</Text>
            </View>
          ) : null}
          <Text style={s.sub} minPresenceAhead={80}>
            Priorities for review
          </Text>
          {packet.brief.priorities.length ? (
            <>
              <Text style={[s.note, { marginTop: 0, marginBottom: 6 }]}>Fees outside the peers&apos; middle 50%. Questions to look into, not pricing recommendations.</Text>
              <View style={s.cards}>
                {packet.brief.priorities.map((p) => (
                  <View key={p.feeCategory} style={s.card} wrap={false}>
                    <View style={s.cardHead}>
                      <Text style={s.priorityFee}>{p.fee}</Text>
                      <Text style={s.chip}>{BAND_WORD[p.band]} the middle 50%</Text>
                    </View>
                    <Text style={[s.body, { fontSize: 9 }]}>{p.fact}</Text>
                    <Text style={[s.body, { fontSize: 8.5, marginTop: 3, color: C.textSecondary }]}>{p.question}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <Text style={s.body}>{packet.brief.prioritiesNote}</Text>
          )}
          {/* Competitive position follows when its exhibits fit; its heading moves with the first. */}
          {shortOf(otherPosition).map((l, i) => (
            <ShortTable key={l.anchor} l={l} readOn={readOn} heading={i === 0 ? "Competitive position" : undefined} />
          ))}
          {packet.position.comparedNote ? <Text style={s.body}>{packet.position.comparedNote}</Text> : null}
        </>,
      )}
      {longOf(otherPosition).map((l) => (
        <LongTablePages key={l.anchor} part="Competitive position" l={l} readOn={readOn} size={pageSize} packet={packet} />
      ))}

      {page(
        "financial",
        <>
          <Text style={s.part}>Financial context</Text>
          {trend ? (
            <View style={s.block} wrap={false}>
              <Text style={s.label}>{trend.label}</Text>
              <Text style={s.tableTitle}>{keepTogether(`${packet.institutionName}: deposit service charge income by quarter`)}</Text>
              {packet.financial.series ? <View style={{ marginTop: 6 }}><IncomeBars series={packet.financial.series} /></View> : null}
              {packet.financial.trendSummary ? <Text style={[s.body, { marginTop: 6, fontSize: 9 }]}>{packet.financial.trendSummary}</Text> : null}
              <Text style={s.source}>{readOnSource(trend)}</Text>
            </View>
          ) : null}
          {normalizedTable && n && n.own !== null && n.median !== null ? (
            <View style={s.block} wrap={false}>
              <Text style={s.label}>{normalizedTable.label}</Text>
              <Text style={s.tableTitle}>{keepTogether(`Service charge income per $10,000 of total assets, ${readerAsOf(n.quarter)}`)}</Text>
              <View style={{ marginTop: 6 }}>
                <Tiles
                  tiles={[
                    { value: per10k(n.own), label: packet.institutionName },
                    { value: per10k(n.median), label: `Median of ${n.peersCompared} peers` },
                    ...(n.q1 !== null && n.q3 !== null ? [{ value: `${per10k(n.q1)} to ${per10k(n.q3)}`, label: `Peers' middle 50%${n.placement ? `; ${packet.institutionName} ${n.placement}` : ""}` }] : []),
                  ]}
                />
              </View>
              <Text style={s.callout}>{packet.financial.context}</Text>
              <Text style={s.source}>{readOnSource(normalizedTable)}</Text>
            </View>
          ) : null}
          {!sections.financial.length ? <Text style={s.body}>No filed income for this packet; see Not available in this packet at the end.</Text> : null}
          {sections.financial.length ? <Text style={s.note}>Both exhibits are in full in the appendix.</Text> : null}
        </>,
      )}

      {appendixPlan([...fullExhibit1, ...sections.financial, ...sections.appendix]).map((step, i) => {
        const heading = i === 0 ? "Appendix" : undefined;
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
          </>,
        );
      })}

      {page(
        "method",
        <>
          <Text style={s.part}>Limitations, method and sources</Text>
          <Text style={s.sub}>Material limitations</Text>
          <Bullets items={packet.brief.limitations} small />
          {packet.unavailable.length ? (
            <>
              <Text style={s.sub} minPresenceAhead={40}>
                Not available in this packet
              </Text>
              <Bullets items={packet.unavailable} small />
            </>
          ) : null}
          <Text style={s.sub} minPresenceAhead={40}>
            Method
          </Text>
          <Bullets items={[packet.feeListNote, ...packet.method]} small />
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
