/**
 * One tile per state (50 + DC), shaded by how many institutions have verified fees
 * published in the index. Each tile opens that state's live fee report. Counts come
 * from the cached published-catalog read; a state with none is shown as not yet covered.
 */
import Link from "next/link";
import { STATE_CODES, STATE_NAMES } from "@/lib/us-states";

export interface StateCoverage {
  state_code: string;
  institution_count: number;
  fee_count: number;
}

function tileTone(count: number, max: number): { bg: string; fg: string; sub: string } {
  if (count === 0) return { bg: "#F5F1EA", fg: "#B5AA9A", sub: "#C7BDAF" };
  const share = count / max;
  if (share > 0.5) return { bg: "#A93D25", fg: "#FFFFFF", sub: "#F6D9CF" };
  if (share > 0.25) return { bg: "#C44B2E", fg: "#FFFFFF", sub: "#F8DED6" };
  if (share > 0.1) return { bg: "#E39A84", fg: "#3A1A10", sub: "#5C2D1E" };
  return { bg: "#F6DCD3", fg: "#5C2D1E", sub: "#8A5444" };
}

export function StateReportGrid({ states }: { states: StateCoverage[] }) {
  const byCode = new Map(states.map((s) => [s.state_code, s]));
  const codes = [...STATE_CODES].sort();
  const max = Math.max(1, ...codes.map((c) => byCode.get(c)?.institution_count ?? 0));

  return (
    <ul className="m-0 grid list-none grid-cols-4 gap-1.5 p-0 sm:grid-cols-7 lg:grid-cols-9">
      {codes.map((code) => {
        const count = byCode.get(code)?.institution_count ?? 0;
        const tone = tileTone(count, max);
        const name = STATE_NAMES[code] ?? code;
        return (
          <li key={code}>
            <Link
              href={`/research/state/${code}`}
              className="state-tile flex h-[58px] flex-col justify-between rounded-md px-2 py-1.5 no-underline"
              style={{ background: tone.bg }}
              title={`${name}: ${count.toLocaleString()} institutions with verified fees`}
              aria-label={`${name} fee report, ${count.toLocaleString()} institutions with verified fees`}
            >
              <span className="text-[13px] font-semibold tracking-[0.02em]" style={{ color: tone.fg }}>
                {code}
              </span>
              <span className="text-[11px] tabular-nums" style={{ color: tone.sub }}>
                {count > 0 ? count.toLocaleString() : "—"}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
