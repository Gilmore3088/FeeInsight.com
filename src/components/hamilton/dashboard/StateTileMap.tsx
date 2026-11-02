"use client";
import { useState } from "react";
import Link from "next/link";
import "./dashboard.css";
import { formatFigure, signedMoney } from "./format";

export interface StateTile {
  code: string;
  name: string;
  /** Institutions counted in the state. */
  n: number;
  /** The state's median; null when too few publish the fee for one. */
  median: number | null;
}

/** Row and column of each state on a 12-wide tile grid, roughly where it sits on a map. */
export const US_TILE_GRID: Record<string, [number, number]> = {
  AK: [0, 0], ME: [0, 11], WI: [1, 6], VT: [1, 10], NH: [1, 11],
  WA: [2, 1], ID: [2, 2], MT: [2, 3], ND: [2, 4], MN: [2, 5], IL: [2, 6], MI: [2, 7], NY: [2, 9], MA: [2, 10],
  OR: [3, 1], NV: [3, 2], WY: [3, 3], SD: [3, 4], IA: [3, 5], IN: [3, 6], OH: [3, 7], PA: [3, 8], NJ: [3, 9], CT: [3, 10], RI: [3, 11],
  CA: [4, 1], UT: [4, 2], CO: [4, 3], NE: [4, 4], MO: [4, 5], KY: [4, 6], WV: [4, 7], VA: [4, 8], MD: [4, 9], DE: [4, 10],
  AZ: [5, 2], NM: [5, 3], KS: [5, 4], AR: [5, 5], TN: [5, 6], NC: [5, 7], SC: [5, 8], DC: [5, 9],
  OK: [6, 4], LA: [6, 5], MS: [6, 6], AL: [6, 7], GA: [6, 8], HI: [7, 0], TX: [7, 4], FL: [7, 9],
};

const SHADES = 5;

/** Which of five shades a median takes, from the lowest state median to the highest. */
export function tileShade(median: number, lo: number, hi: number): number {
  if (hi <= lo) return 2;
  return Math.min(SHADES - 1, Math.floor(((median - lo) / (hi - lo)) * SHADES));
}

/**
 * Every state as a tile coloured by its median price (darker is higher; a dashed tile has too few
 * institutions for a median). Hover, focus or choose a tile for its figures and the subject's gap;
 * the subject's home state carries a brick dot. Each tile is a toggle button with a full label.
 */
export function StateTileMap({
  tiles,
  feeName,
  selected: selectedProp = null,
  subjectState = null,
  subject = null,
  hrefs,
  openLabel = "Open",
}: {
  tiles: StateTile[];
  /** For the group's label, e.g. "Overdraft". */
  feeName: string;
  /** The state read out first. */
  selected?: string | null;
  subjectState?: string | null;
  /** The subject's name and price, for the readout's gap. */
  subject?: { name: string; price: number | null } | null;
  /** Where each state's link goes (that state as the scope). */
  hrefs?: Record<string, string>;
  openLabel?: string;
}) {
  const [picked, setPicked] = useState<string | null>(selectedProp);
  const medians = tiles.map((t) => t.median).filter((m): m is number => m !== null);
  const lo = medians.length ? Math.min(...medians) : 0;
  const hi = medians.length ? Math.max(...medians) : 0;
  const current = tiles.find((t) => t.code === picked) ?? tiles.find((t) => t.code === subjectState) ?? null;
  const gap = current?.median !== null && current?.median !== undefined && subject?.price !== null && subject?.price !== undefined ? subject.price - current.median : null;
  const legend = medians.length ? Array.from({ length: hi > lo ? SHADES : 1 }, (_, i) => ({ shade: hi > lo ? i : 2, from: lo + ((hi - lo) * i) / SHADES })) : [];
  return (
    <div className="hd-map">
      <div role="group" aria-label={`States by median ${feeName.toLowerCase()} price. Choose one for its figures.`} className="hd-map-grid">
        {tiles.map((t) => {
          const pos = US_TILE_GRID[t.code];
          if (!pos) return null;
          const shade = t.median === null ? null : tileShade(t.median, lo, hi);
          return (
            <button
              key={t.code}
              type="button"
              className={`hd-tile ${shade === null ? "hd-tile-none" : `hd-tile-${shade}`}`}
              style={{ gridRow: pos[0] + 1, gridColumn: pos[1] + 1 }}
              aria-pressed={current?.code === t.code}
              aria-label={`${t.name}: ${t.median !== null ? `median ${formatFigure(t.median, "money")}, ${t.n.toLocaleString("en-US")} institutions` : t.n ? `too few for a median, ${t.n} institutions` : "none publish it"}`}
              onMouseEnter={() => setPicked(t.code)}
              onFocus={() => setPicked(t.code)}
              onClick={() => setPicked(t.code)}
            >
              <span aria-hidden="true">{t.code}</span>
              {t.code === subjectState ? <span className="hd-tile-dot" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      <div className="hd-legend hd-mono" aria-hidden="true">
        {legend.map((l) => <span key={l.shade}><i className={`hd-tile-${l.shade}`} />{formatFigure(Math.round(l.from * 100) / 100, "money")}</span>)}
        <span><i className="hd-tile-none" />Too few</span>
        {subjectState ? <span><i className="hd-legend-dot" />You</span> : null}
      </div>
      {current ? (
        <div className="hd-map-read" aria-live="polite">
          <div className="hd-map-read-head">
            <strong>{current.name}</strong>
            {hrefs?.[current.code] ? <Link href={hrefs[current.code]}>{openLabel} {current.name}</Link> : null}
          </div>
          <dl>
            <div><dt>Median</dt><dd>{current.median !== null ? formatFigure(current.median, "money") : current.n ? "Too few" : "—"}</dd></div>
            <div><dt>Institutions</dt><dd>{current.n.toLocaleString("en-US")}</dd></div>
            {subject ? (
              <div>
                <dt>{subject.name}</dt>
                <dd className={gap === null || Math.abs(gap) < 0.005 ? undefined : gap > 0 ? "hd-tone-above" : "hd-tone-below"}>
                  {subject.price === null ? "Not published"
                    : gap === null ? formatFigure(subject.price, "money")
                    : Math.abs(gap) < 0.005 ? `● Level, ${formatFigure(subject.price, "money")}`
                    : `${gap > 0 ? "▲" : "▼"} ${signedMoney(gap)}`}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
