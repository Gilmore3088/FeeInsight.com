/**
 * The pricing committee packet as a printed document (@react-pdf/renderer). Server-side only;
 * the /api/pro/report-pdf route loads it on demand.
 *
 * The same four parts as the screen: executive brief, competitive position, financial context and
 * appendix, then method and numbered sources. Print rules, checked at Letter and A4:
 * - every row is kept whole (wrap={false}), so no row splits across pages;
 * - a table short enough for one page is kept whole with its heading; a longer one gets pages of its
 *   own whose header (label, title and column headings) repeats on each;
 * - the wide peer matrix is printed five fees at a time, so no column is clipped;
 * - no text is smaller than 8pt, and each footnote mark is the number in the Sources list.
 */
import { Document, Font, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { readerAsOf } from "@/lib/hamilton/board-brief";
import { packetSections, type CommitteePacket, type LabelledTable, type PacketTable, type PacketTableId } from "@/lib/hamilton/committee-packet";
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
});

/** Column weights per table; the first column carries names. */
const WIDTHS: Partial<Record<PacketTableId, number[]>> = {
  position: [2.1, 2.1, 1.5, 1.4, 2.1, 1.3],
  peer_changes: [2.2, 1.4, 2.6, 1.2, 0.8],
  income_trend: [1.2, 1.6, 2.6],
  normalized_income: [2.6, 2],
  nearest_peers: [1.3, 1.2, 2.4, 2.4, 1.5],
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
function ShortTable({ l, readOn, before }: { l: LabelledTable; readOn: string; before?: ReactNode }) {
  return (
    <View style={s.block} wrap={false}>
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
function LongTablePages({ part, l, readOn, size, packet }: { part: string; l: LabelledTable; readOn: string; size: PacketPageSize; packet: CommitteePacket }) {
  return (
    <Page size={size} style={s.page}>
      <View style={s.fixedHead} fixed>
        <Text style={s.label}>{l.label.startsWith(part) ? l.label : `${part} · ${l.label}`}</Text>
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
        note: p === count - 1 ? t.note : null,
      },
    });
  }
  return parts;
}

function isLong(t: PacketTable): boolean {
  return t.rows.length > SHORT_TABLE_ROWS || t.id === "peer_fee_matrix" || t.id === "product_details";
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
  // The appendix in its own order: a long table on pages of its own, short ones together.
  const appendixPages: ReactNode[] = [];
  let shorts: LabelledTable[] = [];
  const flush = () => {
    if (!shorts.length) return;
    const group = shorts;
    shorts = [];
    appendixPages.push(
      page(
        `appendix-${group[0].anchor}`,
        <>
          <Text style={s.part}>Appendix</Text>
          {group.map((l) => (
            <ShortTable key={l.anchor} l={l} readOn={readOn} />
          ))}
        </>,
      ),
    );
  };
  for (const l of sections.appendix) {
    if (!isLong(l.table)) {
      shorts.push(l);
      continue;
    }
    flush();
    for (const part of l.table.id === "peer_fee_matrix" ? matrixParts(l) : [l]) {
      appendixPages.push(<LongTablePages key={`${l.anchor}-${part.table.title}`} part="Appendix" l={part} readOn={readOn} size={pageSize} packet={packet} />);
    }
  }
  flush();
  return (
    <Document title={packet.title} author="Fee Insight" subject="Pricing committee packet">
      {page(
        "brief",
        <>
          <View style={s.header}>
            <Text style={s.kicker}>Pricing committee packet</Text>
            <Text style={s.title}>{keepTogether(packet.title)}</Text>
            <Text style={s.meta}>
              Read {readOn} from live published fees and filings. Peers: {packet.peerGroupLabel}.
            </Text>
            <Text style={s.meta}>{packet.feeListNote}</Text>
          </View>
          <Text style={s.part}>Executive brief</Text>
          <Text style={s.sub}>Findings</Text>
          {packet.brief.findings.map((f, i) => (
            <View key={i} style={s.item} wrap={false}>
              <Text style={s.itemMark}>{i + 1}</Text>
              <Text style={s.itemText}>{f}</Text>
            </View>
          ))}
          <Text style={s.sub} minPresenceAhead={60}>
            Priorities for review
          </Text>
          {packet.brief.priorities.length ? (
            <>
              <Text style={[s.body, { marginBottom: 6, fontSize: 9, color: C.textSecondary }]}>
                The fees outside the peers&apos; middle 50%, with the question to look into. These are questions, not pricing recommendations.
              </Text>
              {packet.brief.priorities.map((p) => (
                <View key={p.feeCategory} style={s.priority} wrap={false}>
                  <Text style={s.priorityFee}>{p.fee}</Text>
                  <Text style={[s.body, { fontSize: 9 }]}>{p.evidence}</Text>
                  <Text style={[s.body, { fontSize: 9, marginTop: 2 }]}>
                    <Text style={{ fontFamily: "Helvetica-Bold" }}>Question: </Text>
                    {p.question}
                  </Text>
                </View>
              ))}
            </>
          ) : (
            <Text style={s.body}>{packet.brief.prioritiesNote}</Text>
          )}
          <Text style={s.sub} minPresenceAhead={40}>
            Material limitations
          </Text>
          <Bullets items={packet.brief.limitations} />
          {packet.unavailable.length ? (
            <>
              <Text style={s.sub} minPresenceAhead={40}>
                Not available in this packet
              </Text>
              <Bullets items={packet.unavailable} small />
            </>
          ) : null}
        </>,
      )}

      {page(
        "position",
        <>
          <Text style={s.part}>Competitive position</Text>
          {shortOf(sections.position).map((l) => (
            <ShortTable key={l.anchor} l={l} readOn={readOn} />
          ))}
          {packet.position.comparedNote ? <Text style={s.body}>{packet.position.comparedNote}</Text> : null}
        </>,
      )}
      {longOf(sections.position).map((l) => (
        <LongTablePages key={l.anchor} part="Competitive position" l={l} readOn={readOn} size={pageSize} packet={packet} />
      ))}

      {page(
        "financial",
        <>
          <Text style={s.part}>Financial context</Text>
          {packet.financial.trendSummary ? <Text style={[s.body, { marginBottom: 10 }]}>{packet.financial.trendSummary}</Text> : null}
          {sections.financial.map((l) => (
            <ShortTable
              key={l.anchor}
              l={l}
              readOn={readOn}
              before={l.table.id === "normalized_income" ? <Text style={s.callout}>{packet.financial.context}</Text> : undefined}
            />
          ))}
          {!sections.financial.length ? <Text style={s.body}>No filed income for this packet; see Not available in this packet in the executive brief.</Text> : null}
        </>,
      )}

      {appendixPages}

      {page(
        "method",
        <>
          <Text style={s.part}>Method and sources</Text>
          <Text style={s.sub}>Method</Text>
          <Bullets items={packet.method} small />
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
