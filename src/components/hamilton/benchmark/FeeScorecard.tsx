/**
 * The fee scorecard: every published fee on one page, each against its own peer group. A dot
 * for the bank's fee on the peer range, and a plain label: lower than most peers (below the
 * middle half), in line (inside it) or higher (above it). Rows keep the engine's order; the
 * scorecard describes where fees sit and never says which to change.
 */
import Link from "next/link";
import type { FeePositionRow } from "@/lib/hamilton/workspace/types";
import { proseFeeName } from "@/lib/hamilton/workspace/names";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import {
  peerStanding,
  STANDING_TEXT,
  type PeerStanding,
} from "@/components/hamilton/storyline/option-compare";

export type ScorecardRow = FeePositionRow;

const money = (v: number) =>
  Number.isInteger(v) ? `$${v.toLocaleString("en-US")}` : `$${v.toFixed(2)}`;

const DOT: Record<PeerStanding, string> = {
  lower: "bg-warm-700",
  in_line: "bg-warm-900",
  higher: "bg-terra",
};

const CHIP: Record<PeerStanding, string> = {
  lower: "border-warm-300 bg-warm-100 text-warm-800",
  in_line: "border-warm-300 bg-white text-warm-800",
  higher: "border-terra/40 bg-terra-soft text-terra-text",
};

function name(row: ScorecardRow): string {
  const n = row.displayName || proseFeeName(row.feeCategory);
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function Strip({
  row,
}: {
  row: ScorecardRow & { band: NonNullable<ScorecardRow["band"]> };
}) {
  const { band } = row;
  const min = Math.min(band.p25, row.current);
  const max = Math.max(band.p75, row.current);
  const pad = Math.max((max - min) * 0.15, 1);
  const lo = Math.max(0, min - pad);
  const hi = max + pad;
  const at = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  return (
    <div
      className="relative h-4"
      role="img"
      aria-label={`${money(row.current)} against a peer middle half of ${money(band.p25)} to ${money(band.p75)}, median ${money(band.median)}`}
    >
      <span className="absolute inset-x-0 top-1.5 h-1 rounded-full bg-warm-200" />
      <span
        className="absolute top-0.5 h-3 rounded-sm bg-terra/20 ring-1 ring-terra/30"
        style={{
          left: `${at(band.p25)}%`,
          width: `${Math.max(at(band.p75) - at(band.p25), 1)}%`,
        }}
      />
      <span
        className="absolute top-0 h-4 w-px -translate-x-1/2 bg-warm-700"
        style={{ left: `${at(band.median)}%` }}
      />
      <span
        className={`absolute top-0.5 h-3 w-3 -translate-x-1/2 rounded-full ring-2 ring-white ${DOT[peerStanding(row.current, band)]}`}
        style={{ left: `${at(row.current)}%` }}
      />
    </div>
  );
}

export function FeeScorecard({
  rows,
  institutionId,
  notCompared = [],
}: {
  rows: readonly ScorecardRow[];
  institutionId: string | null;
  /** Categories whose peers charge them on more than one basis: shown, but not placed. */
  notCompared?: readonly string[];
}) {
  const unlike = rows.filter((r) => notCompared.includes(r.feeCategory));
  const compared = rows.filter(
    (r): r is ScorecardRow & { band: NonNullable<ScorecardRow["band"]> } =>
      r.band != null && !notCompared.includes(r.feeCategory),
  );
  if (compared.length === 0) return null;
  const counts = { lower: 0, in_line: 0, higher: 0 } as Record<
    PeerStanding,
    number
  >;
  for (const r of compared) counts[peerStanding(r.current, r.band)] += 1;
  const thin = rows.length - compared.length - unlike.length;

  return (
    <section aria-labelledby="fee-scorecard" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="fee-scorecard" className="text-lg font-semibold text-warm-900">
          Your fees against peers
        </h2>
        <p className="text-sm text-warm-700 [font-variant-numeric:tabular-nums]">
          {counts.lower} lower · {counts.in_line} in line · {counts.higher}{" "}
          higher
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-warm-300 bg-white">
        <div className="hidden grid-cols-[minmax(0,1.4fr)_5rem_minmax(0,2fr)_10rem] gap-4 border-b border-warm-200 px-4 py-2 text-xs font-medium text-warm-600 sm:grid">
          <span>Fee</span>
          <span className="text-right">Yours</span>
          <span>Peer range (shaded: middle half; line: median)</span>
          <span>Where it sits</span>
        </div>
        <ul className="divide-y divide-warm-100">
          {compared.map((row) => {
            const standing = peerStanding(row.current, row.band);
            return (
              <li key={row.feeCategory}>
                <Link
                  href={hrefWithInstitutionContext(
                    `/pro/analyze?q=${encodeURIComponent(`How does our ${proseFeeName(row.feeCategory)} fee compare with peers?`)}&send=1`,
                    institutionId,
                  )}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-2.5 hover:bg-warm-50 sm:grid-cols-[minmax(0,1.4fr)_5rem_minmax(0,2fr)_10rem]"
                >
                  <span className="min-w-0 truncate text-sm text-warm-900">
                    {name(row)}
                  </span>
                  <span className="text-right text-sm font-semibold text-warm-900 [font-variant-numeric:tabular-nums]">
                    {money(row.current)}
                  </span>
                  <span className="col-span-2 sm:col-span-1">
                    <Strip row={row} />
                    <span className="mt-0.5 block text-[11px] text-warm-600 [font-variant-numeric:tabular-nums]">
                      Middle half {money(row.band.p25)} to {money(row.band.p75)}{" "}
                      · median {money(row.band.median)} · {row.band.n} peers
                    </span>
                  </span>
                  <span className="col-span-2 sm:col-span-1">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${CHIP[standing]}`}
                    >
                      {STANDING_TEXT[standing]}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-xs text-warm-600">
        Each fee is read against its own peer group: lower means below the
        middle half of what peers charge, higher means above it.
        {thin > 0
          ? ` ${thin} more ${thin === 1 ? "fee has" : "fees have"} too few peers publishing to compare.`
          : ""}
        {unlike.length > 0
          ? ` Not compared: ${unlike.map((r) => `${name(r)} (${money(r.current)})`).join(", ")}. Peers charge ${unlike.length === 1 ? "this fee" : "these fees"} on more than one basis, so one median does not compare like for like.`
          : ""}
      </p>
    </section>
  );
}
