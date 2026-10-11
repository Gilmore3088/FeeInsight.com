/**
 * The answer's own numbered exhibits, drawn for an exported Ask: one chart per exhibit under its
 * action title, with the takeaway and the source, in the shared report look. Server-side only
 * (react-pdf). The Pro page draws the same exhibits in storyline/story-exhibits.tsx; this is the
 * board copy of them.
 *
 * Standard PDF Helvetica has no minus sign or arrow glyph, so negatives use an en dash and
 * changes read "from ... to ...".
 */
import { Circle, Line, Polyline, Rect, Svg, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Exhibit, SourceRef } from "@/lib/hamilton/workspace/types";
import type { IncomeSplitData, StoryExhibit } from "@/lib/hamilton/workspace/storyline-types";
import { formatDollarsInWords } from "@/lib/format";
import { RD_PDF, RD_PDF_CHART } from "@/lib/report-design/tokens";

const C = RD_PDF_CHART;
const T = RD_PDF;

/** Text column width on a LETTER page with 72pt margins. */
const PAGE_W = 468;
/** Rows drawn before the rest are counted in one line, so one exhibit fits on a page. */
const MAX_ROWS = 14;

const s = StyleSheet.create({
  exhibit: { marginBottom: 26 },
  number: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: T.accent, textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 5 },
  title: { fontSize: 14, fontFamily: "Times-Bold", color: T.textPrimary, lineHeight: 1.3, marginBottom: 12 },
  takeaway: { marginTop: 10, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: C.accent, borderLeftStyle: "solid", fontSize: 9.5, fontFamily: "Helvetica-Bold", color: T.textPrimary, lineHeight: 1.45 },
  source: { marginTop: 8, fontSize: 7.5, color: T.textTertiary, lineHeight: 1.4 },
  legend: { flexDirection: "row", gap: 14, marginBottom: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendText: { fontSize: 7.5, color: C.muted },
  row: { flexDirection: "row", alignItems: "center", paddingTop: 3.5, paddingBottom: 3.5, borderBottomWidth: 0.5, borderBottomColor: C.rule, borderBottomStyle: "solid" },
  head: { flexDirection: "row", alignItems: "flex-end", paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: C.ink, borderBottomStyle: "solid" },
  headText: { fontSize: 7, fontFamily: "Helvetica-Bold", color: C.muted, textTransform: "uppercase", letterSpacing: 0.6 },
  cell: { fontSize: 8.5, color: C.ink },
  cellMuted: { fontSize: 8.5, color: C.faint },
  own: { fontFamily: "Helvetica-Bold", color: T.accent },
  strong: { fontFamily: "Helvetica-Bold" },
  more: { fontSize: 7.5, color: C.faint, marginTop: 4 },
  axis: { fontSize: 7, color: C.faint },
  card: { backgroundColor: T.surfaceElevated, padding: 10, borderRadius: 3 },
  cardLabel: { fontSize: 8, color: C.muted, marginBottom: 4, lineHeight: 1.3 },
  cardFigure: { fontSize: 17, fontFamily: "Times-Bold", color: C.ink, marginBottom: 6 },
  cardFoot: { fontSize: 6.5, color: C.faint, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 5 },
});

// ─── Formatting ──────────────────────────────────────────────────────────────

/** "$35", "$2.50", "$209,400". */
export function pdfMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "Not published";
  const abs = Math.abs(v);
  const body = Number.isInteger(abs) ? abs.toLocaleString("en-US") : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? "–" : ""}$${body}`;
}

/** "+$40,000", "–$60,000", "$0". */
export function pdfSigned(v: number): string {
  if (v === 0) return "$0";
  return `${v > 0 ? "+" : "–"}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
}

function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "Source: Bank Fee Index, published fee schedules, as of Oct 1, 2026. Note." */
export function sourceLine(sources: SourceRef[], note?: string): string | null {
  const seen = new Set<string>();
  const parts = sources
    .filter((x) => x?.label && !seen.has(x.label) && seen.add(x.label))
    .map((x) => {
      const d = shortDate(x.asOf);
      return d ? `${x.label}, as of ${d}` : x.label;
    });
  const text = [parts.length ? `Source${parts.length > 1 ? "s" : ""}: ${parts.join("; ")}.` : "", note ? note.trim() : ""].filter(Boolean).join(" ");
  return text || null;
}

const EVIDENCE: Record<string, string> = {
  market: "Market data only",
  working_estimate: "Working estimate from filings",
  institution: "The institution's own figures",
};

/** Assets in thousands of dollars as "$3.2B" or "$640M". */
function assets(k: number | null): string {
  if (k == null) return "";
  const d = k * 1000;
  return d >= 1e9 ? `$${(d / 1e9).toFixed(d >= 1e10 ? 0 : 1)}B` : `$${Math.round(d / 1e6)}M`;
}

function Legend({ items }: { items: { label: string; mark: "dot" | "band" | "tick" | "bar" | "line" | "accentLine" }[] }) {
  return (
    <View style={s.legend}>
      {items.map((it) => (
        <View key={it.label} style={s.legendItem}>
          <Svg width={14} height={8}>
            {it.mark === "dot" ? <Circle cx={7} cy={4} r={3.2} fill={C.accent} /> : null}
            {it.mark === "band" ? <Rect x={0} y={1} width={14} height={6} fill={C.band} /> : null}
            {it.mark === "tick" ? <Line x1={7} y1={0} x2={7} y2={8} stroke={C.ink} strokeWidth={1.2} /> : null}
            {it.mark === "bar" ? <Rect x={2} y={0} width={10} height={8} fill={C.bar} /> : null}
            {it.mark === "line" ? <Line x1={0} y1={4} x2={14} y2={4} stroke={C.ink} strokeWidth={1.5} /> : null}
            {it.mark === "accentLine" ? <Line x1={0} y1={4} x2={14} y2={4} stroke={C.accent} strokeWidth={2} /> : null}
          </Svg>
          <Text style={s.legendText}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

function More({ shown, total, noun }: { shown: number; total: number; noun: string }) {
  return total > shown ? <Text style={s.more}>{`Showing ${shown} of ${total} ${noun}.`}</Text> : null;
}

// ─── One chart per exhibit kind ──────────────────────────────────────────────

type Of<K extends Exhibit["kind"]> = Extract<Exhibit, { kind: K }>;

/** The peers' middle half as a band, the median as a tick, market medians as small ticks, the bank as a dot. */
function FeePosition({ x }: { x: Of<"fee_position"> }) {
  const W = PAGE_W;
  // The band already carries the peer median; a "peer" marker would print it twice.
  const markers = x.markers.filter((m) => m.scope !== "peer");
  const vals = [x.band.p25, x.band.median, x.band.p75, ...markers.map((m) => m.value), ...(x.own != null ? [x.own] : [])];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.12 || Math.max(hi * 0.2, 1);
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const px = (v: number) => 8 + ((v - min) / (max - min)) * (W - 16);
  const rows = [
    ...(x.own != null ? [{ label: x.ownLabel, value: x.own, own: true, n: null as number | null }] : []),
    { label: "Peer median", value: x.band.median, own: false, n: x.band.n },
    ...markers.map((m) => ({ label: m.label, value: m.value, own: false, n: m.n })),
  ];
  return (
    <View>
      <Legend items={[...(x.own != null ? [{ label: x.ownLabel, mark: "dot" as const }] : []), { label: "Peer median", mark: "tick" }, { label: "Middle half of peers", mark: "band" }]} />
      <Svg width={W} height={34}>
        <Line x1={8} y1={17} x2={W - 8} y2={17} stroke={C.rule} strokeWidth={1} />
        <Rect x={px(x.band.p25)} y={9} width={Math.max(2, px(x.band.p75) - px(x.band.p25))} height={16} fill={C.band} />
        {markers.map((m) => (
          <Line key={m.label} x1={px(m.value)} y1={11} x2={px(m.value)} y2={23} stroke={C.muted} strokeWidth={0.8} strokeDasharray="2 1.5" />
        ))}
        <Line x1={px(x.band.median)} y1={5} x2={px(x.band.median)} y2={29} stroke={C.ink} strokeWidth={1.4} />
        {x.own != null ? <Circle cx={px(x.own)} cy={17} r={5.5} fill={C.accent} /> : null}
      </Svg>
      <View style={{ flexDirection: "row", justifyContent: "space-between", width: W, marginBottom: 8 }}>
        <Text style={s.axis}>{pdfMoney(Math.round(min))}</Text>
        <Text style={s.axis}>{`Middle half ${pdfMoney(x.band.p25)} to ${pdfMoney(x.band.p75)}`}</Text>
        <Text style={s.axis}>{pdfMoney(Math.round(max))}</Text>
      </View>
      {rows.map((r) => (
        <View key={r.label} style={s.row}>
          <Text style={[s.cell, { flex: 1 }, r.own ? s.own : {}]}>{r.label}</Text>
          <Text style={[s.cell, { width: 70, textAlign: "right" }, r.own ? s.own : s.strong]}>{pdfMoney(r.value)}</Text>
          <Text style={[s.cellMuted, { width: 90, textAlign: "right" }]}>{r.n != null ? `${r.n.toLocaleString("en-US")} institutions` : ""}</Text>
        </View>
      ))}
    </View>
  );
}

/** Named competitors' prices as bars, lowest first, with the bank's own in place and highlighted. */
function CompetitorRange({ x }: { x: Of<"competitor_range"> }) {
  const all = [...x.items.map((i) => ({ name: i.name, amount: i.amount, own: false })), ...(x.own != null ? [{ name: x.ownLabel, amount: x.own, own: true }] : [])].sort(
    (a, b) => a.amount - b.amount || Number(b.own) - Number(a.own),
  );
  const shown = all.length > MAX_ROWS ? [...all.filter((r) => !r.own).slice(0, MAX_ROWS - 1), ...all.filter((r) => r.own)].sort((a, b) => a.amount - b.amount) : all;
  const max = Math.max(1, ...shown.map((r) => r.amount));
  const BAR = 240;
  return (
    <View>
      {shown.map((r, i) => (
        <View key={`${r.name}-${i}`} style={{ flexDirection: "row", alignItems: "center", marginBottom: 2.5 }}>
          <Text style={[s.cell, { width: 170, paddingRight: 6 }, r.own ? s.own : {}]}>{r.name}</Text>
          <Svg width={BAR} height={10}>
            <Rect x={0} y={0} width={Math.max(1.5, (r.amount / max) * BAR)} height={10} fill={r.own ? C.accent : C.bar} />
          </Svg>
          <Text style={[s.cell, { width: 54, textAlign: "right" }, r.own ? s.own : {}]}>{pdfMoney(r.amount)}</Text>
        </View>
      ))}
      <More shown={shown.length} total={all.length} noun="institutions" />
    </View>
  );
}

/** One line per series over time; the first series in terra. */
function Trend({ x }: { x: Of<"trend"> }) {
  const series = x.series.filter((se) => se.points.length > 0);
  if (series.length === 0) return null;
  const W = PAGE_W - 40;
  const H = 120;
  const dates = [...new Set(series.flatMap((se) => se.points.map((p) => p.date)))].sort();
  const values = series.flatMap((se) => se.points.map((p) => p.value));
  const lo = Math.min(0, ...values);
  const hi = Math.max(...values) * 1.1 || 1;
  const px = (d: string) => 4 + (dates.indexOf(d) / Math.max(1, dates.length - 1)) * (W - 8);
  const py = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const fmt = (v: number) => (x.unit === "percent" ? `${(Math.round(v * 10) / 10).toFixed(1)}%` : pdfMoney(Math.round(v)));
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <View>
      <Legend items={series.map((se, i) => ({ label: se.label, mark: i === 0 ? ("accentLine" as const) : ("line" as const) }))} />
      <View style={{ flexDirection: "row" }}>
        <View style={{ width: 40, height: H + 4, position: "relative" }}>
          {ticks.map((v) => (
            <Text key={v} style={[s.axis, { position: "absolute", top: py(v) - 4, right: 4 }]}>
              {fmt(v)}
            </Text>
          ))}
        </View>
        <Svg width={W} height={H + 4}>
          {ticks.map((v) => (
            <Line key={v} x1={0} y1={py(v)} x2={W} y2={py(v)} stroke={C.rule} strokeWidth={0.5} />
          ))}
          {series.map((se, i) =>
            se.points.length > 1 ? (
              <Polyline key={se.label} points={se.points.map((p) => `${px(p.date)},${py(p.value)}`).join(" ")} stroke={i === 0 ? C.accent : C.ink} strokeWidth={i === 0 ? 2 : 1.2} fill="none" />
            ) : (
              <Circle key={se.label} cx={px(se.points[0].date)} cy={py(se.points[0].value)} r={3} fill={i === 0 ? C.accent : C.ink} />
            ),
          )}
        </Svg>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", width: W, marginLeft: 40, marginTop: 3 }}>
        <Text style={s.axis}>{shortDate(dates[0])}</Text>
        <Text style={s.axis}>{shortDate(dates[dates.length - 1])}</Text>
      </View>
    </View>
  );
}

/** The segment largest first: assets, the fee as a bar, and any published daily cap. */
function SegmentTable({ x }: { x: Of<"segment_table"> }) {
  const members = x.members.slice(0, MAX_ROWS);
  const max = Math.max(1, ...members.map((m) => m.amount), x.own ?? 0);
  const BAR = 150;
  const cap = (m: (typeof members)[number]) => (m.dailyFeeLimit ? `${m.dailyFeeLimit.count} a day` : m.dailyCap != null ? `${pdfMoney(m.dailyCap)} a day` : "None stated");
  const bar = (v: number, own: boolean) => (
    <Svg width={BAR} height={9}>
      <Rect x={0} y={0} width={Math.max(1.5, (v / max) * BAR)} height={9} fill={own ? C.accent : C.bar} />
    </Svg>
  );
  return (
    <View>
      <View style={s.head}>
        <Text style={[s.headText, { flex: 1 }]}>Institution</Text>
        <Text style={[s.headText, { width: 50, textAlign: "right", paddingRight: 10 }]}>Assets</Text>
        <Text style={[s.headText, { width: BAR + 46 }]}>Fee</Text>
        <Text style={[s.headText, { width: 64, textAlign: "right" }]}>Daily limit</Text>
      </View>
      {x.own != null ? (
        <View style={s.row}>
          <Text style={[s.cell, s.own, { flex: 1 }]}>{x.ownLabel}</Text>
          <Text style={[s.cellMuted, { width: 50, textAlign: "right", paddingRight: 10 }]}></Text>
          {bar(x.own, true)}
          <Text style={[s.cell, s.own, { width: 46, textAlign: "right" }]}>{pdfMoney(x.own)}</Text>
          <Text style={[s.cellMuted, { width: 64, textAlign: "right" }]}></Text>
        </View>
      ) : null}
      {members.map((m) => (
        <View key={m.institutionId} style={s.row}>
          <Text style={[s.cell, { flex: 1, paddingRight: 6 }]}>{m.institutionName}</Text>
          <Text style={[s.cellMuted, { width: 50, textAlign: "right", paddingRight: 10 }]}>{assets(m.totalAssets)}</Text>
          {bar(m.amount, false)}
          <Text style={[s.cell, s.strong, { width: 46, textAlign: "right" }]}>{pdfMoney(m.amount)}</Text>
          <Text style={[m.dailyCap != null || m.dailyFeeLimit ? s.cell : s.cellMuted, { width: 64, textAlign: "right" }]}>{cap(m)}</Text>
        </View>
      ))}
      <More shown={members.length} total={x.members.length} noun="institutions, largest first" />
    </View>
  );
}

/** Published price changes, newest first: date, institution, old and new price. */
function ChangeTimeline({ x }: { x: Of<"change_timeline"> }) {
  if (x.events.length === 0) return <Text style={s.cell}>No published changes in this period.</Text>;
  const events = x.events.slice(0, MAX_ROWS);
  return (
    <View>
      {events.map((e, i) => {
        const up = e.from != null && e.to != null && e.to > e.from;
        return (
          <View key={i} style={s.row}>
            <Svg width={14} height={10}>
              <Circle cx={5} cy={5} r={3.5} fill={up ? C.ink : C.accent} />
            </Svg>
            <Text style={[s.cellMuted, { width: 76 }]}>{shortDate(e.date)}</Text>
            <Text style={[s.cell, { flex: 1, paddingRight: 6 }]}>{e.institutionName}</Text>
            <Text style={[s.cell, { width: 130, textAlign: "right" }]}>
              {`from ${pdfMoney(e.from)} to `}
              <Text style={s.strong}>{pdfMoney(e.to)}</Text>
            </Text>
          </View>
        );
      })}
      <More shown={events.length} total={x.events.length} noun="changes" />
    </View>
  );
}

/** Fee income per $1,000 of deposits beside the peer median, and the gap split into its two parts. */
function IncomeSplit({ d }: { d: IncomeSplitData }) {
  const per = (v: number) => `${v < 0 ? "–" : ""}$${Math.abs(v).toFixed(2)}`;
  const signed = (v: number) => `${v < 0 ? "–" : "+"}$${Math.abs(v).toFixed(2)}`;
  const max = Math.max(d.own, d.peerMedian) || 1;
  const BAR = 260;
  const levels = [
    { label: "This institution", value: d.own, own: true },
    { label: `${d.peerLabel} median (${d.n.toLocaleString("en-US")})`, value: d.peerMedian, own: false },
  ];
  const parts = [
    { label: "Published prices", value: d.priceExplained },
    { label: "How often fees are charged and waived", value: d.otherExplained },
  ];
  const span = Math.max(1, ...parts.map((p) => Math.abs(p.value)));
  const HALF = 120;
  return (
    <View>
      <Text style={[s.headText, { marginBottom: 5 }]}>Deposit service charges per $1,000 of deposits</Text>
      {levels.map((l) => (
        <View key={l.label} style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}>
          <Text style={[s.cell, { width: 150, paddingRight: 6 }, l.own ? s.own : {}]}>{l.label}</Text>
          <Svg width={BAR} height={11}>
            <Rect x={0} y={0} width={Math.max(1.5, (l.value / max) * BAR)} height={11} fill={l.own ? C.accent : C.bar} />
          </Svg>
          <Text style={[s.cell, s.strong, { width: 50, textAlign: "right" }]}>{per(l.value)}</Text>
        </View>
      ))}
      <Text style={[s.headText, { marginTop: 12, marginBottom: 5 }]}>{`The ${signed(d.own - d.peerMedian)} gap, split`}</Text>
      {parts.map((p) => {
        const w = (Math.abs(p.value) / span) * HALF;
        return (
          <View key={p.label} style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}>
            <Text style={[s.cell, { width: 150, paddingRight: 6 }]}>{p.label}</Text>
            <Svg width={HALF * 2 + 2} height={11}>
              <Line x1={HALF + 1} y1={0} x2={HALF + 1} y2={11} stroke={C.ink} strokeWidth={0.8} />
              <Rect x={p.value >= 0 ? HALF + 1 : HALF + 1 - w} y={1.5} width={Math.max(1, w)} height={8} fill={C.accent} />
            </Svg>
            <Text style={[s.cell, s.strong, { width: 68, textAlign: "right" }]}>{signed(p.value)}</Text>
          </View>
        );
      })}
      {d.priceIndex != null ? <Text style={[s.more, { marginTop: 6 }]}>{`Published prices index ${Math.round(d.priceIndex)} against the peer median (peer median = 100). Quarter ending ${shortDate(d.quarterEnd)}.`}</Text> : null}
    </View>
  );
}

function incomeSplitOf(x: Of<"structure_matrix">): IncomeSplitData | null {
  const d = x.incomeSplit;
  if (!d) return null;
  return [d.own, d.peerMedian, d.priceExplained, d.otherExplained].every((v) => typeof v === "number" && Number.isFinite(v)) ? d : null;
}

/** A grid of what each schedule publishes; the bank's own row highlighted. */
function StructureMatrix({ x }: { x: Of<"structure_matrix"> }) {
  // A column no institution publishes says nothing; it is left out.
  const keep = x.columns.map((_, i) => x.rows.some((r) => r.cells[i] != null));
  const columns = x.columns.filter((_, i) => keep[i]);
  const rows = x.rows.slice(0, MAX_ROWS).map((r) => ({ ...r, cells: r.cells.filter((_, i) => keep[i]) }));
  const colW = Math.max(50, Math.min(80, (PAGE_W - 130) / Math.max(1, columns.length)));
  return (
    <View>
      <View style={s.head}>
        <Text style={[s.headText, { flex: 1 }]}>Institution</Text>
        {columns.map((c) => (
          <Text key={c} style={[s.headText, { width: colW, textAlign: "center" }]}>
            {c}
          </Text>
        ))}
      </View>
      {rows.map((r) => (
        <View key={r.name} style={[s.row, r.own ? { backgroundColor: C.band } : {}]}>
          <Text style={[s.cell, { flex: 1, paddingLeft: 3, paddingRight: 6 }, r.own ? s.own : {}]}>{r.name}</Text>
          {r.cells.map((c, i) => (
            <Text key={i} style={[c == null ? s.cellMuted : s.cell, { width: colW, textAlign: "center" }]}>
              {c ?? "–"}
            </Text>
          ))}
        </View>
      ))}
      <Text style={s.more}>{"– means the schedule publishes nothing for that column."}</Text>
      <More shown={rows.length} total={x.rows.length} noun="institutions" />
    </View>
  );
}

/** A yearly dollar figure: "$19.5 million", "$60,000"; signed when it is a change. */
function yearly(v: number, signed: boolean): string {
  const abs = Math.abs(v);
  const body = abs >= 1e6 ? formatDollarsInWords(abs) : `$${Math.round(abs).toLocaleString("en-US")}`;
  if (!signed) return `${v < 0 ? "\u2013" : ""}${body}`;
  return v === 0 ? "$0" : `${v > 0 ? "+" : "\u2013"}${body}`;
}

/**
 * Dollars a year, as figure cards. Options that change income carry signs and a range bar
 * around zero; figures that are amounts the institution earns today carry neither.
 */
function MoneyAtStake({ x }: { x: Of<"money_at_stake"> }) {
  const changes = x.rows.some((r) => r.low < 0 || r.high < 0 || r.low !== r.high);
  const max = Math.max(1, ...x.rows.map((r) => Math.max(Math.abs(r.low), Math.abs(r.high))));
  const amount = (r: (typeof x.rows)[number]) => (r.low === r.high ? yearly(r.low, changes) : `${yearly(r.low, true)} to ${yearly(r.high, true)}`);
  const cols = Math.min(3, x.rows.length);
  const cardW = (PAGE_W - (cols - 1) * 8) / cols;
  const TW = cardW - 20;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {x.rows.map((r) => {
        const a = TW / 2 + (Math.min(r.low, r.high) / max) * (TW / 2);
        const b = TW / 2 + (Math.max(r.low, r.high) / max) * (TW / 2);
        return (
          <View key={r.label} style={[s.card, { width: cardW }]}>
            <Text style={s.cardLabel}>{r.label}</Text>
            <Text style={r.low === r.high ? s.cardFigure : [s.cardFigure, { fontSize: 13 }]}>{amount(r)}</Text>
            {changes ? (
              <Svg width={TW} height={8}>
                <Rect x={0} y={1} width={TW} height={6} fill={C.rule} />
                <Rect x={a} y={1} width={Math.max(1.5, b - a)} height={6} fill={C.accent} />
                <Line x1={TW / 2} y1={0} x2={TW / 2} y2={8} stroke={C.ink} strokeWidth={0.8} />
              </Svg>
            ) : null}
            <Text style={s.cardFoot}>{EVIDENCE[r.evidenceLevel] ?? ""}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** How the group's prices fall into four types, as one stacked bar; the bank's type in terra. */
function ArchetypeMap({ x }: { x: Of<"archetype_map"> }) {
  const live = x.archetypes.filter((a) => a.count > 0);
  const total = live.reduce((a, b) => a + b.count, 0) || 1;
  const greys = [C.bar, C.rule];
  const widths = live.map((a) => (a.count / total) * PAGE_W);
  const starts = widths.map((_, i) => widths.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <View>
      <Svg width={PAGE_W} height={22}>
        {live.map((a, i) => (
          <Rect key={a.key} x={starts[i]} y={0} width={Math.max(1, widths[i] - 1.5)} height={22} fill={a.key === x.ownKey ? C.accent : greys[i % 2]} />
        ))}
      </Svg>
      <View style={{ marginTop: 8 }}>
        {x.archetypes.map((a) => {
          const own = a.key === x.ownKey;
          const names = a.names.length > 0 ? `${a.names.slice(0, 4).join(", ")}${a.names.length > 4 ? ` and ${a.names.length - 4} more` : ""}` : "";
          return (
            <View key={a.key} style={s.row}>
              <Svg width={14} height={10}>
                <Rect x={1} y={1} width={8} height={8} fill={own ? C.accent : C.bar} />
              </Svg>
              <Text style={[s.cell, { width: 120 }, own ? s.own : s.strong]}>{own ? `${a.label} (this institution)` : a.label}</Text>
              <Text style={[s.cellMuted, { width: 90 }]}>{a.rule}</Text>
              <Text style={[s.cell, { width: 60, textAlign: "right", paddingRight: 8 }]}>{`${a.count.toLocaleString("en-US")} (${Math.round((a.count / total) * 100)}%)`}</Text>
              <Text style={[s.cellMuted, { flex: 1 }]}>{names}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Chart({ item }: { item: StoryExhibit }) {
  const x = item.exhibit;
  switch (x.kind) {
    case "fee_position":
      return <FeePosition x={x} />;
    case "competitor_range":
      return <CompetitorRange x={x} />;
    case "trend":
      return <Trend x={x} />;
    case "segment_table":
      return <SegmentTable x={x} />;
    case "change_timeline":
      return <ChangeTimeline x={x} />;
    case "structure_matrix": {
      const split = incomeSplitOf(x);
      return split ? <IncomeSplit d={split} /> : <StructureMatrix x={x} />;
    }
    case "money_at_stake":
      return <MoneyAtStake x={x} />;
    case "archetype_map":
      return <ArchetypeMap x={x} />;
    default:
      return null;
  }
}

/** One exhibit: number, action title, chart, takeaway and source, kept together on one page. */
export function StoryExhibitPdf({ item, number }: { item: StoryExhibit; number: number }) {
  const source = sourceLine(item.exhibit.sources ?? [], item.exhibit.note);
  return (
    <View style={s.exhibit} wrap={false}>
      <Text style={s.number}>{`Exhibit ${number}`}</Text>
      <Text style={s.title}>{item.actionTitle}</Text>
      <Chart item={item} />
      {item.takeaway ? <Text style={s.takeaway}>{item.takeaway.text}</Text> : null}
      {source ? <Text style={s.source}>{source}</Text> : null}
    </View>
  );
}

/** Exhibits worth drawing: ones with something to show. */
export function drawableExhibits(exhibits: StoryExhibit[] | undefined | null): StoryExhibit[] {
  return (exhibits ?? []).filter((e) => {
    const x = e.exhibit;
    if (!x) return false;
    switch (x.kind) {
      case "competitor_range":
        return x.items.length > 0;
      case "trend":
        return x.series.some((se) => se.points.length > 0);
      case "segment_table":
        return x.members.length > 0;
      case "structure_matrix":
        return x.rows.length > 0 || x.incomeSplit != null;
      case "money_at_stake":
        return x.rows.length > 0;
      case "archetype_map":
        return x.archetypes.some((a) => a.count > 0);
      default:
        return true;
    }
  });
}
