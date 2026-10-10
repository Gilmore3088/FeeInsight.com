/**
 * Charts for the "at a glance" page of an exported Hamilton answer, drawn with react-pdf's SVG
 * primitives. Server-side only (react-pdf). Every mark is placed with one scale per chart.
 */
import { Circle, Line, Path, Polyline, Rect, Svg, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDollarsInWords, formatFeeAmount } from "@/lib/format";
import type { LocalCompetitorFee } from "@/lib/hamilton/answer-brief";
import type { MarketShare, RatePoint } from "@/lib/hamilton/brief-context";
import type { DependenceChart } from "@/lib/hamilton/workspace/studies";
import type { InstitutionFinancials, SchedulePosition } from "@/lib/hamilton/workspace/types";
import { RD_PDF_CHART } from "@/lib/report-design/tokens";

const C = RD_PDF_CHART;

const s = StyleSheet.create({
  legend: { flexDirection: "row", gap: 14, marginBottom: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendText: { fontSize: 7.5, color: C.muted },
  row: { flexDirection: "row", alignItems: "center", paddingTop: 4, paddingBottom: 4, borderBottomWidth: 0.5, borderBottomColor: C.rule, borderBottomStyle: "solid" },
  rowLabel: { width: 128, fontSize: 9, color: C.ink, paddingRight: 6 },
  rowValue: { width: 92, fontSize: 8.5, color: C.muted, textAlign: "right" },
  rowValueStrong: { fontFamily: "Helvetica-Bold", color: C.ink },
  axisRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 3 },
  axisText: { fontSize: 7, color: C.faint },
  chartTitle: { fontSize: 9.5, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 6, marginTop: 10 },
  barName: { width: 150, fontSize: 8.5, color: C.ink, paddingRight: 6 },
  barNameOwn: { fontFamily: "Helvetica-Bold", color: C.accent },
  barValue: { width: 44, fontSize: 8.5, color: C.ink, textAlign: "right" },
});

const fee = (n: number): string => formatFeeAmount(n) ?? `$${n}`;

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

const TRACK = 220;

/** One row per fee: the peers' middle half as a band, the median as a tick, the bank as a dot. */
export function FeeRangeChart({
  positions,
  bands,
  institutionName = "Research institution",
}: {
  institutionName?: string;
  positions: SchedulePosition[];
  bands: Record<string, { p25: number; median: number; p75: number }>;
}) {
  return (
    <View>
      <Legend items={[{ label: `${institutionName} fee`, mark: "dot" }, { label: "Peer median", mark: "tick" }, { label: "Middle half of peers", mark: "band" }]} />
      {positions.map((p) => {
        const b = bands[p.feeCategory] ?? { p25: p.peerMedian, median: p.peerMedian, p75: p.peerMedian };
        const lo = Math.min(b.p25, p.current, b.median);
        const hi = Math.max(b.p75, p.current, b.median);
        const pad = (hi - lo) * 0.15 || Math.max(hi * 0.2, 1);
        const min = Math.max(0, lo - pad);
        const max = hi + pad;
        const x = (v: number) => 4 + ((v - min) / (max - min)) * (TRACK - 8);
        return (
          <View key={p.feeCategory} style={s.row} wrap={false}>
            <Text style={s.rowLabel}>{p.displayName}</Text>
            <Svg width={TRACK} height={16}>
              <Line x1={4} y1={8} x2={TRACK - 4} y2={8} stroke={C.rule} strokeWidth={1} />
              <Rect x={x(b.p25)} y={3} width={Math.max(2, x(b.p75) - x(b.p25))} height={10} fill={C.band} />
              <Line x1={x(b.median)} y1={1} x2={x(b.median)} y2={15} stroke={C.ink} strokeWidth={1.2} />
              <Circle cx={x(p.current)} cy={8} r={4} fill={C.accent} />
            </Svg>
            <Text style={s.rowValue}>
              <Text style={s.rowValueStrong}>{fee(p.current)}</Text> vs {fee(p.peerMedian)} ({p.peerCount})
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function quarterLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${String(d.getUTCFullYear()).slice(2)}`;
}

const W = 440;
const H = 100;

/**
 * The bank's own quarterly service charges, oldest quarter on the left. Peers are compared per $1,000 of
 * deposits in the figures above the chart; a peer median in dollars would mix in size, so none is drawn here.
 */
export function IncomeTrendChart({ financials, institutionName = "Research institution" }: { financials: InstitutionFinancials; institutionName?: string }) {
  const quarters = [...financials.quarters].reverse();
  const max = Math.max(...quarters.map((q) => q.amount)) * 1.15;
  const slot = W / quarters.length;
  const y = (v: number) => H - (v / max) * H;
  const first = quarters[0];
  const last = quarters[quarters.length - 1];
  return (
    <View wrap={false}>
      <Text style={s.chartTitle}>{institutionName} service charges by quarter</Text>
      <Svg width={W} height={H}>
        <Line x1={0} y1={H} x2={W} y2={H} stroke={C.rule} strokeWidth={1} />
        {quarters.map((q, i) => (
          <Rect key={q.quarterEnd} x={slot * i + slot * 0.2} y={y(q.amount)} width={slot * 0.6} height={H - y(q.amount)} fill={i === quarters.length - 1 ? C.accent : C.bar} />
        ))}
      </Svg>
      <View style={[s.axisRow, { width: W }]}>
        {quarters.map((q) => (
          <Text key={q.quarterEnd} style={[s.axisText, { width: slot, textAlign: "center" }]}>
            {quarterLabel(q.quarterEnd)}
          </Text>
        ))}
      </View>
      <Text style={[s.axisText, { marginTop: 4 }]}>
        {quarterLabel(last.quarterEnd)} {formatDollarsInWords(last.amount)}
        {quarters.length > 1 ? `; ${quarterLabel(first.quarterEnd)} ${formatDollarsInWords(first.amount)}` : ""}.
      </Text>
    </View>
  );
}

const BAR = 200;

/** One fee's price at the bank and at its named local competitors, the bank first and highlighted. */
export function CompetitorBars({ item, institutionName = "Research institution" }: { item: LocalCompetitorFee; institutionName?: string }) {
  const rows = [{ name: institutionName, amount: item.own, own: true }, ...item.competitors.map((c) => ({ ...c, own: false }))];
  const max = Math.max(...rows.map((r) => r.amount)) || 1;
  return (
    <View wrap={false}>
      <Text style={s.chartTitle}>
        {item.displayName}, local competitors
      </Text>
      {rows.map((r, i) => (
        <View key={`${r.name}-${i}`} style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
          <Text style={r.own ? [s.barName, s.barNameOwn] : s.barName}>{r.name}</Text>
          <Svg width={BAR} height={9}>
            <Rect x={0} y={0} width={Math.max(1.5, (r.amount / max) * BAR)} height={9} fill={r.own ? C.accent : C.bar} />
          </Svg>
          <Text style={s.barValue}>{fee(r.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

const LW = 440;
const LH = 110;

/** State and U.S. unemployment by month as two lines, with the latest values labelled. */
export function UnemploymentChart({ points, place }: { points: RatePoint[]; place: string }) {
  const values = points.flatMap((p) => [p.state, p.national]);
  const lo = Math.max(0, Math.floor(Math.min(...values) - 0.5));
  const hi = Math.ceil(Math.max(...values) + 0.5);
  const x = (i: number) => 3 + (i / Math.max(1, points.length - 1)) * (LW - 46);
  const y = (v: number) => LH - ((v - lo) / (hi - lo)) * LH;
  const line = (key: "state" | "national") => points.map((p, i) => `${x(i)},${y(p[key])}`).join(" ");
  const last = points[points.length - 1];
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  return (
    <View wrap={false}>
      <Text style={s.chartTitle}>Unemployment rate, {place} and U.S.</Text>
      <Legend items={[{ label: place, mark: "accentLine" }, { label: "U.S.", mark: "line" }]} />
      <View style={{ flexDirection: "row" }}>
        <View style={{ width: 28, height: LH + 4, position: "relative" }}>
          {ticks.map((v) => (
            <Text key={v} style={[s.axisText, { position: "absolute", top: y(v) - 4, right: 4 }]}>
              {`${v.toFixed(0)}%`}
            </Text>
          ))}
        </View>
        <Svg width={LW - 40} height={LH + 4}>
          {ticks.map((v) => (
            <Line key={v} x1={0} y1={y(v)} x2={LW - 40} y2={y(v)} stroke={C.rule} strokeWidth={0.5} />
          ))}
          <Polyline points={line("national")} stroke={C.ink} strokeWidth={1.2} fill="none" />
          <Polyline points={line("state")} stroke={C.accent} strokeWidth={2} fill="none" />
          <Circle cx={x(points.length - 1)} cy={y(last.state)} r={2.5} fill={C.accent} />
          <Circle cx={x(points.length - 1)} cy={y(last.national)} r={2} fill={C.ink} />
        </Svg>
      </View>
      <View style={[s.axisRow, { width: LW - 40, marginLeft: 28 }]}>
        <Text style={s.axisText}>{monthShort(points[0].date)}</Text>
        <Text style={s.axisText}>{monthShort(last.date)}</Text>
      </View>
    </View>
  );
}

function monthShort(iso: string): string {
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(iso.slice(5, 7)) - 1];
  return `${m} ${iso.slice(0, 4)}`;
}

/** Share of local deposits by institution, largest first, the subject highlighted. */
export function MarketShareBars({ shares }: { shares: MarketShare[] }) {
  const max = Math.max(...shares.map((r) => r.share)) || 1;
  return (
    <View wrap={false}>
      <Text style={s.chartTitle}>Share of local deposits</Text>
      {shares.map((r, i) => (
        <View key={`${r.name}-${i}`} style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
          <Text style={r.isSubject ? [s.barName, s.barNameOwn] : s.barName}>{r.name}</Text>
          <Svg width={BAR} height={9}>
            <Rect x={0} y={0} width={Math.max(1.5, (r.share / max) * BAR)} height={9} fill={r.isSubject ? C.accent : C.bar} />
          </Svg>
          <Text style={s.barValue}>{`${(Math.round(r.share * 10) / 10).toFixed(1)}%`}</Text>
        </View>
      ))}
    </View>
  );
}

/** Median household income in the market counties beside the state's. */
export function IncomeCompareBars({ counties, state }: { counties: { name: string; income: number }[]; state: { name: string; income: number } | null }) {
  const rows = [...counties.map((c) => ({ ...c, isState: false })), ...(state ? [{ ...state, isState: true }] : [])];
  const max = Math.max(...rows.map((r) => r.income)) || 1;
  return (
    <View wrap={false}>
      <Text style={s.chartTitle}>Median household income</Text>
      {rows.map((r) => (
        <View key={r.name} style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
          <Text style={r.isState ? s.barName : [s.barName, s.barNameOwn]}>{r.name}</Text>
          <Svg width={BAR} height={9}>
            <Rect x={0} y={0} width={(r.income / max) * BAR} height={9} fill={r.isState ? C.bar : C.accent} />
          </Svg>
          <Text style={s.barValue}>{`$${Math.round(r.income / 1000)}k`}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Fee dependence since 2010: every bank's (or credit union's) median share of revenue from fees as
 * a line over the middle half, with the institution's own share marked in its first and latest years.
 */
export function DependenceTrendChart({ chart, institutionName = "Research institution" }: { chart: DependenceChart; institutionName?: string }) {
  const { series, own } = chart;
  const values = [...series.flatMap((p) => [p.p25, p.p75]), ...own.map((o) => o.value)];
  // Shares start at zero; ticks every 1, 2, 5 or 10 points so there are no more than six.
  const max = Math.max(...values);
  const step = [1, 2, 5, 10].find((st) => Math.ceil(max / st) <= 5) ?? 10;
  const lo = 0;
  const hi = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: hi / step + 1 }, (_, i) => i * step);
  const first = series[0].year;
  const last = series[series.length - 1].year;
  const plotW = LW - 40;
  const x = (year: number) => 6 + ((year - first) / Math.max(1, last - first)) * (plotW - 52);
  const y = (v: number) => LH - ((v - lo) / Math.max(1, hi - lo)) * LH;
  const band = `M ${series.map((p) => `${x(p.year)} ${y(p.p75)}`).join(" L ")} L ${[...series].reverse().map((p) => `${x(p.year)} ${y(p.p25)}`).join(" L ")} Z`;
  return (
    <View wrap={false}>
      <Text style={s.chartTitle}>{chart.groupLabel === "banks" ? "Deposit service charges" : "Fee income"} as a share of revenue, {first} to {last}</Text>
      <Legend items={[{ label: institutionName, mark: "dot" }, { label: `All ${chart.groupLabel}: median`, mark: "line" }, { label: "Middle half", mark: "band" }]} />
      <View style={{ flexDirection: "row", marginTop: 10 }}>
        <View style={{ width: 28, height: LH + 4, position: "relative" }}>
          {ticks.map((v) => (
            <Text key={v} style={[s.axisText, { position: "absolute", top: y(v) - 4, right: 4 }]}>
              {`${v}%`}
            </Text>
          ))}
        </View>
        <Svg width={plotW} height={LH + 4}>
          {ticks.map((v) => (
            <Line key={v} x1={0} y1={y(v)} x2={plotW} y2={y(v)} stroke={C.rule} strokeWidth={0.5} />
          ))}
          <Path d={band} fill={C.band} />
          <Polyline points={series.map((p) => `${x(p.year)},${y(p.median)}`).join(" ")} stroke={C.ink} strokeWidth={1.2} fill="none" />
          {own.map((o) => (
            <Circle key={o.year} cx={x(o.year)} cy={y(o.value)} r={3.5} fill={C.accent} />
          ))}
        </Svg>
        {own.map((o) => (
          <Text key={o.year} style={[s.axisText, { position: "absolute", left: 28 + x(o.year) + 8, top: y(o.value) - 11, color: C.accent }]}>
            {`${o.value.toFixed(2)}%`}
          </Text>
        ))}
      </View>
      <View style={[s.axisRow, { width: plotW, marginLeft: 28 }]}>
        <Text style={s.axisText}>{String(first)}</Text>
        <Text style={s.axisText}>{String(last)}</Text>
      </View>
    </View>
  );
}
