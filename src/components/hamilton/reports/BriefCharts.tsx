/**
 * Charts for the "at a glance" page of an exported Hamilton answer, drawn with react-pdf's SVG
 * primitives. Server-side only (react-pdf). Every mark is placed with one scale per chart.
 */
import { Circle, Line, Rect, Svg, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDollarsInWords, formatFeeAmount } from "@/lib/format";
import type { LocalCompetitorFee } from "@/lib/hamilton/answer-brief";
import type { InstitutionFinancials, SchedulePosition } from "@/lib/hamilton/workspace/types";

const C = {
  ink: "#1c1917",
  muted: "#78716c",
  faint: "#a8a29e",
  accent: "#b45309",
  band: "#e7dfcf",
  bar: "#cbbfa8",
  rule: "#d6d0c5",
};

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

function Legend({ items }: { items: { label: string; mark: "dot" | "band" | "tick" | "bar" | "line" }[] }) {
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
}: {
  positions: SchedulePosition[];
  bands: Record<string, { p25: number; median: number; p75: number }>;
}) {
  return (
    <View>
      <Legend items={[{ label: "Your fee", mark: "dot" }, { label: "Peer median", mark: "tick" }, { label: "Middle half of peers", mark: "band" }]} />
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
export function IncomeTrendChart({ financials }: { financials: InstitutionFinancials }) {
  const quarters = [...financials.quarters].reverse();
  const max = Math.max(...quarters.map((q) => q.amount)) * 1.15;
  const slot = W / quarters.length;
  const y = (v: number) => H - (v / max) * H;
  const first = quarters[0];
  const last = quarters[quarters.length - 1];
  return (
    <View wrap={false}>
      <Text style={s.chartTitle}>Your service charges by quarter</Text>
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
export function CompetitorBars({ item }: { item: LocalCompetitorFee }) {
  const rows = [{ name: "You", amount: item.own, own: true }, ...item.competitors.map((c) => ({ ...c, own: false }))];
  const max = Math.max(...rows.map((r) => r.amount)) || 1;
  return (
    <View wrap={false}>
      <Text style={s.chartTitle}>
        {item.displayName}
        {item.place ? `, ${item.place} area` : ", local competitors"}
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
