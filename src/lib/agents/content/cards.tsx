import { ImageResponse } from "next/og";
import { asOfLabel, money, type MarketSpread } from "@/lib/agents/content/market-spread";

/**
 * Square (1080 x 1080) cards for content-queue drafts, drawn only from a draft's stored
 * facts. Brand: Fee Insight on top, the Bank Fee Index as the source, Hamilton in the close.
 */

export type SpreadFacts = MarketSpread & { fee_label?: string; metro_label?: string };

export interface DepthFacts {
  metro_label: string;
  use_case_label: string;
  full_schedules: number;
  median_types: number;
  grid: { fee_label: string; institutions: number; low: number; median: number; high: number }[];
}

const SIZE = 1080;
const PAD = 80;
const INNER = SIZE - 2 * PAD;
const PARCHMENT = "#FAF7F2";
const INK = "#1A1815";
const SECONDARY = "#5A5347";
const RULE = "#E0D7C9";
const TERRACOTTA = "#C44B2E";
const BAND = "#F1E4DA";

const fixed = { display: "flex", flexShrink: 0 } as const;

function Frame({ children, note, asOf, close }: { children: React.ReactNode; note: string; asOf: string; close: string }) {
  return (
    <div style={{ width: SIZE, height: SIZE, display: "flex", flexDirection: "column", background: PARCHMENT, padding: PAD, color: INK, fontFamily: "Georgia, serif" }}>
      <div style={{ ...fixed, fontSize: 26, color: SECONDARY, letterSpacing: 2 }}>FEE INSIGHT</div>
      {children}
      <div style={{ ...fixed, flexDirection: "column", marginTop: "auto", borderTop: `2px solid ${RULE}`, paddingTop: 22, fontSize: 23, color: SECONDARY }}>
        <div style={fixed}>{note}</div>
        <div style={{ ...fixed, marginTop: 6 }}>{`Source: the Bank Fee Index, as of ${asOfLabel(new Date(asOf))}.`}</div>
        <div style={{ ...fixed, marginTop: 6, color: INK }}>{close}</div>
      </div>
    </div>
  );
}

/** W3: a competitor grid of the fees local schedules carry most, each with its local range. */
export function depthCard(facts: DepthFacts, asOf: string) {
  const col = (width: number, right: boolean) => ({ display: "flex", flexShrink: 0, width, justifyContent: right ? "flex-end" : "flex-start" }) as const;
  return new ImageResponse(
    (
      <Frame
        note="One value per institution, from its own published fee schedule."
        asOf={asOf}
        close="Set your schedule beside every competitor's with Hamilton at feeinsight.com"
      >
        <div style={{ ...fixed, fontSize: 28, color: TERRACOTTA, marginTop: 34 }}>{facts.use_case_label}</div>
        <div style={{ ...fixed, fontSize: 50, lineHeight: 1.1, marginTop: 10 }}>{`${facts.metro_label}: every competitor's fees`}</div>
        <div style={{ ...fixed, fontSize: 28, color: SECONDARY, marginTop: 14 }}>
          {`${facts.full_schedules} full local schedules. The typical one lists ${facts.median_types} fee types.`}
        </div>
        <div style={{ ...fixed, flexDirection: "column", marginTop: 30 }}>
          <div style={{ ...fixed, fontSize: 22, color: SECONDARY, borderBottom: `2px solid ${RULE}`, paddingBottom: 8 }}>
            <div style={col(INNER - 3 * 140, false)}>Fee</div>
            <div style={col(140, true)}>Lowest</div>
            <div style={col(140, true)}>Median</div>
            <div style={col(140, true)}>Highest</div>
          </div>
          {facts.grid.map((row) => (
            <div key={row.fee_label} style={{ ...fixed, fontSize: 27, paddingTop: 10, paddingBottom: 10, borderBottom: `1px solid ${RULE}` }}>
              <div style={col(INNER - 3 * 140, false)}>{row.fee_label}</div>
              <div style={col(140, true)}>{money(row.low)}</div>
              <div style={{ ...col(140, true), fontWeight: 700 }}>{money(row.median)}</div>
              <div style={col(140, true)}>{money(row.high)}</div>
            </div>
          ))}
        </div>
      </Frame>
    ),
    { width: SIZE, height: SIZE },
  );
}

/** W1: one dot per institution on a dollar axis spanning the local range, the middle half shaded. */
export function spreadCard(facts: SpreadFacts, values: number[], asOf: string) {
  const chartHeight = 470;
  const axisY = 380;
  const dot = 34;
  const range = Math.max(facts.high - facts.low, 1);
  const lo = facts.low - range * 0.06;
  const hi = facts.high + range * 0.06;
  const x = (value: number) => 20 + ((value - lo) / (hi - lo)) * (INNER - 40);
  const stacks = new Map<number, number>();
  const dots = values.map((value) => {
    const level = stacks.get(value) ?? 0;
    stacks.set(value, level + 1);
    return { value, level };
  });
  const tallest = Math.max(...stacks.values(), 1);
  const step = Math.min(dot + 4, (axisY - 90) / tallest);
  const tick = (value: number, text: string, bold = false, labelWidth = 180) => (
    <div style={{ position: "absolute", left: Math.min(Math.max(x(value) - labelWidth / 2, 0), INNER - labelWidth), top: axisY + 16, width: labelWidth, display: "flex", justifyContent: "center", fontSize: 28, color: bold ? INK : SECONDARY, fontWeight: bold ? 700 : 400 }}>
      {text}
    </div>
  );
  const bandLeft = x(facts.p25);
  const bandWidth = Math.max(x(facts.p75) - bandLeft, 6);
  const bandLabelLeft = Math.min(bandLeft, INNER - 380);

  return new ImageResponse(
    (
      <Frame
        note="Each dot is one institution's published fee."
        asOf={asOf}
        close="See where any institution stands with Hamilton at feeinsight.com"
      >
        <div style={{ ...fixed, fontSize: 62, lineHeight: 1.1, marginTop: 36 }}>{`${facts.fee_label ?? "Fee"} in ${facts.metro_label ?? "this market"}`}</div>
        <div style={{ ...fixed, fontSize: 36, color: SECONDARY, marginTop: 16 }}>
          {`${money(facts.low)} to ${money(facts.high)} across ${facts.institutions} local banks and credit unions`}
        </div>
        <div style={{ ...fixed, position: "relative", width: INNER, height: chartHeight, marginTop: 24 }}>
          <div style={{ position: "absolute", left: bandLeft, top: 50, width: bandWidth, height: axisY - 50, background: BAND, display: "flex" }} />
          <div style={{ position: "absolute", left: bandLabelLeft, top: 8, fontSize: 26, color: SECONDARY, display: "flex" }}>
            {`Middle half: ${money(facts.p25)} to ${money(facts.p75)}`}
          </div>
          <div style={{ position: "absolute", left: 0, top: axisY, width: INNER, height: 2, background: SECONDARY, display: "flex" }} />
          {dots.map((d, index) => (
            <div
              key={index}
              style={{ position: "absolute", left: x(d.value) - dot / 2, top: axisY - dot - 4 - d.level * step, width: dot, height: dot, borderRadius: dot, background: TERRACOTTA, display: "flex" }}
            />
          ))}
          {tick(facts.low, money(facts.low))}
          {tick(facts.median, `Median ${money(facts.median)}`, true, 300)}
          {tick(facts.high, money(facts.high))}
        </div>
      </Frame>
    ),
    { width: SIZE, height: SIZE },
  );
}
