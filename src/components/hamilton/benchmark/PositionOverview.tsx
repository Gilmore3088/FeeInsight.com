/**
 * PositionOverview — the selected institution against its peers: a one-line headline
 * from the largest gap, four count tiles, and every benchmarked fee drawn on a range bar.
 * Deterministic: built only from published fee data, no AI.
 * Server component — no "use client".
 */

import Link from "next/link";
import { formatAmount } from "@/lib/format";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import {
  MEDIUM_PRIORITY_GAP_PCT,
  type InstitutionPositionEntry,
  type InstitutionPositioning,
} from "@/lib/hamilton/institution-position";
import { RangeBar, RangeLegend, TONE_COLORS, type PositionTone } from "./RangeBar";

export function positionTone(entry: Pick<InstitutionPositionEntry, "gapPct" | "gapAmount">): PositionTone {
  if (entry.gapPct === null) {
    if (Math.abs(entry.gapAmount) < 0.005) return "inline";
    return entry.gapAmount > 0 ? "above" : "below";
  }
  if (entry.gapPct >= MEDIUM_PRIORITY_GAP_PCT) return "above";
  if (entry.gapPct <= -MEDIUM_PRIORITY_GAP_PCT) return "below";
  return "inline";
}

function gapText(entry: InstitutionPositionEntry): string {
  if (Math.abs(entry.gapAmount) < 0.005) return "At median";
  const sign = entry.gapAmount > 0 ? "+" : "−";
  const pct = entry.gapPct === null ? "" : ` · ${sign}${Math.round(Math.abs(entry.gapPct))}%`;
  return `${sign}${formatAmount(Math.abs(entry.gapAmount))}${pct}`;
}

export function headlineFor(positioning: InstitutionPositioning): string | null {
  const top = positioning.topGap;
  if (!top) return null;
  const tone = positionTone(top);
  if (tone === "inline") {
    return `${positioning.institutionName}'s fees track its peers closely; the largest gap is ${top.displayName} at ${gapText(top).replace(" · ", ", ")}.`;
  }
  const pct = top.gapPct === null ? formatAmount(Math.abs(top.gapAmount)) : `${Math.round(Math.abs(top.gapPct))}%`;
  return `${top.displayName} is ${pct} ${tone === "above" ? "above" : "below"} the peer median: ${formatAmount(top.yourAmount)} against ${formatAmount(top.benchmarkMedian)}.`;
}

function Tile({ label, value, color, note }: { label: string; value: number; color?: string; note: string }) {
  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{ borderColor: "var(--hamilton-outline-variant)", backgroundColor: "var(--hamilton-surface-container-lowest)" }}
    >
      <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--hamilton-text-secondary)" }}>
        {color && <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold [font-variant-numeric:tabular-nums]" style={{ color: "var(--hamilton-on-surface)" }}>
        {value}
      </div>
      <div className="text-xs" style={{ color: "var(--hamilton-text-tertiary)" }}>{note}</div>
    </div>
  );
}

export function PositionOverview({ positioning }: { positioning: InstitutionPositioning }) {
  const institutionId = String(positioning.institutionId);
  const entries = positioning.entries;
  const tones = entries.map(positionTone);
  const above = tones.filter((t) => t === "above").length;
  const below = tones.filter((t) => t === "below").length;
  const inline = tones.filter((t) => t === "inline").length;
  const headline = headlineFor(positioning);

  if (entries.length === 0) {
    return (
      <section
        className="rounded-xl border p-6"
        style={{ borderColor: "var(--hamilton-outline-variant)", backgroundColor: "var(--hamilton-surface-container-lowest)" }}
      >
        <h2 className="text-base font-semibold" style={{ color: "var(--hamilton-on-surface)", fontFamily: "var(--hamilton-font-sans)" }}>
          Nothing to compare yet
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
          {positioning.ownFeeCount === 0
            ? `We have no published fees for ${positioning.institutionName} yet. The national picture below still applies.`
            : `${positioning.institutionName}'s published fees are in categories where ${positioning.benchmarkLabel} has too few institutions for a median.`}
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      {headline && (
        <p className="text-lg font-medium leading-snug sm:text-xl" style={{ color: "var(--hamilton-on-surface)" }}>
          {headline}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Fees compared" value={entries.length} note={`against ${positioning.benchmarkLabel}`} />
        <Tile label="Above peers" value={above} color={TONE_COLORS.above} note={`${MEDIUM_PRIORITY_GAP_PCT}%+ over the median`} />
        <Tile label="In line" value={inline} color={TONE_COLORS.inline} note={`within ${MEDIUM_PRIORITY_GAP_PCT}% of the median`} />
        <Tile label="Below peers" value={below} color={TONE_COLORS.below} note={`${MEDIUM_PRIORITY_GAP_PCT}%+ under the median`} />
      </div>

      <div
        className="rounded-xl border"
        style={{ borderColor: "var(--hamilton-outline-variant)", backgroundColor: "var(--hamilton-surface-container-lowest)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3" style={{ borderColor: "var(--hamilton-border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--hamilton-on-surface)", fontFamily: "var(--hamilton-font-sans)" }}>
            Where each fee sits, largest gap first
          </h2>
          <RangeLegend />
        </div>
        <ul className="divide-y" style={{ borderColor: "var(--hamilton-border)" }}>
          {entries.map((entry, i) => {
            const tone = tones[i];
            return (
              <li key={entry.feeCategory} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3 md:grid-cols-[12rem_1fr_9.5rem]">
                <div className="min-w-0">
                  <Link
                    href={hrefWithInstitutionContext(
                      `/pro/simulate?category=${encodeURIComponent(entry.feeCategory)}`,
                      institutionId,
                    )}
                    className="block min-w-0 truncate text-sm font-medium no-underline hover:underline"
                    style={{ color: "var(--hamilton-on-surface)" }}
                    title={`Simulate a change to ${entry.displayName}`}
                  >
                    {entry.displayName}
                  </Link>
                  <span className="text-xs" style={{ color: "var(--hamilton-text-tertiary)" }}>
                    {entry.benchmarkCount} peers
                  </span>
                </div>
                <div className="col-span-2 row-start-2 md:col-span-1 md:row-start-auto">
                  <RangeBar
                    median={entry.benchmarkMedian}
                    p25={entry.benchmarkP25}
                    p75={entry.benchmarkP75}
                    yours={entry.yourAmount}
                    tone={tone}
                    label={`${entry.displayName}: yours ${formatAmount(entry.yourAmount)}, peer median ${formatAmount(entry.benchmarkMedian)}`}
                  />
                </div>
                <div className="col-start-2 row-start-1 text-right md:col-start-auto md:row-start-auto">
                  <div className="text-sm font-semibold [font-variant-numeric:tabular-nums]" style={{ color: "var(--hamilton-on-surface)" }}>
                    {formatAmount(entry.yourAmount)}
                    <span className="font-normal" style={{ color: "var(--hamilton-text-tertiary)" }}> vs {formatAmount(entry.benchmarkMedian)}</span>
                  </div>
                  <div className="text-xs font-medium [font-variant-numeric:tabular-nums]" style={{ color: tone === "inline" ? "var(--hamilton-text-secondary)" : TONE_COLORS[tone] }}>
                    {gapText(entry)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="border-t px-5 py-2.5 text-xs" style={{ borderColor: "var(--hamilton-border)", color: "var(--hamilton-text-tertiary)" }}>
          Click a fee to simulate a change. {positioning.ownFeeCount} fees are published for this institution; the {entries.length} with a peer median and the largest gaps are shown.
        </p>
      </div>
    </section>
  );
}
