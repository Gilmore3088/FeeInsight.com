/**
 * One tile per state (50 + DC), linking to that state's live fee report. When market
 * readiness is available, tiles shade by how close the state's best market (banks or credit
 * unions) is to a full local peer comparison: MARKET_READY_MIN_RICH institutions with
 * RICH_MIN_CATEGORIES+ of the headline fees live. Without it, tiles fall back to shading
 * by institutions with verified fees. Every number comes from the cached catalog reads.
 */
import Link from "next/link";
import { MARKET_READY_MIN_RICH, type MarketReadiness } from "@/lib/data-store/market-readiness";
import { STATE_CODES, STATE_NAMES } from "@/lib/us-states";

export interface StateCoverage {
  state_code: string;
  institution_count: number;
  fee_count: number;
}

type Tone = { bg: string; fg: string; sub: string };

const EMPTY: Tone = { bg: "#F5F1EA", fg: "#B5AA9A", sub: "#C7BDAF" };

/** share is 0..1 of the way to the darkest shade. */
function tileTone(share: number): Tone {
  if (share <= 0) return EMPTY;
  if (share >= 1) return { bg: "#7E2C1A", fg: "#FFFFFF", sub: "#F6D9CF" };
  if (share > 0.5) return { bg: "#A93D25", fg: "#FFFFFF", sub: "#F6D9CF" };
  if (share > 0.25) return { bg: "#C44B2E", fg: "#FFFFFF", sub: "#F8DED6" };
  if (share > 0.1) return { bg: "#E39A84", fg: "#3A1A10", sub: "#5C2D1E" };
  return { bg: "#F6DCD3", fg: "#5C2D1E", sub: "#8A5444" };
}

const CHARTER_LABEL: Record<string, string> = { bank: "banks", credit_union: "credit unions" };

function charterLabel(charter: string): string {
  return CHARTER_LABEL[charter] ?? charter.replace(/_/g, " ");
}

/** The state's market closest to ready (most rich institutions), or null when none is tracked. */
export function bestMarket(markets: MarketReadiness[]): MarketReadiness | null {
  return markets.reduce<MarketReadiness | null>((best, m) => (!best || m.rich > best.rich ? m : best), null);
}

function readinessLabel(name: string, markets: MarketReadiness[]): string {
  if (markets.length === 0) return `${name}: no institutions tracked yet`;
  const parts = markets.map(
    (m) => `${charterLabel(m.charter_type)} ${m.rich} of ${MARKET_READY_MIN_RICH} needed${m.ready ? " (ready)" : ""}`,
  );
  return `${name}: complete fee schedules — ${parts.join("; ")}`;
}

export function StateReportGrid({
  states,
  readiness,
}: {
  states: StateCoverage[];
  readiness?: MarketReadiness[] | null;
}) {
  const byCode = new Map(states.map((s) => [s.state_code, s]));
  const marketsByCode = new Map<string, MarketReadiness[]>();
  for (const row of readiness ?? []) {
    const list = marketsByCode.get(row.state_code) ?? [];
    list.push(row);
    marketsByCode.set(row.state_code, list);
  }
  const codes = [...STATE_CODES].sort();
  const maxCount = Math.max(1, ...codes.map((c) => byCode.get(c)?.institution_count ?? 0));

  return (
    <ul className="m-0 grid list-none grid-cols-4 gap-1.5 p-0 sm:grid-cols-7 lg:grid-cols-9">
      {codes.map((code) => {
        const name = STATE_NAMES[code] ?? code;
        let tone: Tone;
        let sub: string;
        let label: string;
        if (readiness) {
          const markets = marketsByCode.get(code) ?? [];
          const best = bestMarket(markets);
          tone = tileTone(best?.progress ?? 0);
          sub = best && best.rich > 0 ? `${best.rich}/${MARKET_READY_MIN_RICH}${best.ready ? " ✓" : ""}` : "—";
          label = readinessLabel(name, markets);
        } else {
          const count = byCode.get(code)?.institution_count ?? 0;
          tone = tileTone(count / maxCount);
          sub = count > 0 ? count.toLocaleString() : "—";
          label = `${name}: ${count.toLocaleString()} institutions with verified fees`;
        }
        return (
          <li key={code}>
            <Link
              href={`/research/state/${code}`}
              className="state-tile flex h-[58px] flex-col justify-between rounded-md px-2 py-1.5 no-underline"
              style={{ background: tone.bg }}
              title={label}
              aria-label={`${name} fee report. ${label}`}
            >
              <span className="text-[13px] font-semibold tracking-[0.02em]" style={{ color: tone.fg }}>
                {code}
              </span>
              <span className="text-[11px] tabular-nums" style={{ color: tone.sub }}>
                {sub}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
