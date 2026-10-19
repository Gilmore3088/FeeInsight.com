"use client";

import Link from "next/link";
import { useState } from "react";
import { TrackLink } from "@/components/track-link";
import { REPORT_SHOWCASE } from "@/lib/report-showcase";
import {
  defaultLine,
  dollarAxis,
  formatReadOn,
  lineInsight,
  money,
  nextSteps,
  POSITION_LABEL,
  SERIF,
  type SampleExhibit,
} from "./report-view";

const BADGE = {
  above_market: "bg-[#fbe9e7] text-[#9b2c24]",
  in_market: "bg-[#eef1f5] text-ink",
  below_market: "bg-[#e7f1ec] text-[#2f5a45]",
  free: "bg-[#e7f1ec] text-[#2f5a45]",
} as const;

/**
 * The sample's one demonstration: pick a fee, see the bank's figure against its local middle
 * half and median, and what that means. Every figure comes from the live sample's comparable
 * lines, the same numbers the full sample report prints. The competitors, their schedules and
 * the method sit behind one disclosure, so the default view stays simple.
 */
export function SamplePosition({ sample }: { sample: SampleExhibit }) {
  const [key, setKey] = useState(defaultLine(sample).key);
  const line = sample.lines.find((l) => l.key === key) ?? defaultLine(sample);
  const axis = dollarAxis([line.own, line.p75, line.median]);
  const x = (v: number) => `${(v / axis.max) * 100}%`;
  const readOn = line.ownReadOn ?? sample.readOn;

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="sample-heading" className="text-[26px] font-medium leading-tight tracking-[-0.01em] text-ink sm:text-[32px]" style={SERIF}>
            {sample.name} — Local competitive position
          </h2>
          <p className="mt-1 text-[15px] text-ink-muted">
            {sample.place ? `${sample.place} · ` : ""}Based on {sample.competitorsWithData} published competitor fee schedules
          </p>
        </div>
        <label className="block w-full text-[13px] text-ink-muted sm:w-[17rem]">
          <span className="mb-1.5 block">Select a fee</span>
          <select
            value={line.key}
            onChange={(e) => setKey(e.target.value)}
            className="min-h-11 w-full rounded-md border border-[#cfd5de] bg-white px-3 text-[15px] text-ink focus:outline-2 focus:outline-ink"
          >
            {sample.lines.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* The comparison. */}
        <div className="rounded-lg border border-[#dfe3ea] bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h3 className="text-[19px] font-medium text-ink" style={SERIF}>
              {line.label}
            </h3>
            <span className={`rounded px-2 py-1 text-[12px] font-medium ${BADGE[line.position]}`}>{POSITION_LABEL[line.position]}</span>
          </div>
          <dl className="mt-4 grid grid-cols-3 divide-x divide-[#e6e9ef]">
            {[
              { value: money(line.own), label: sample.name },
              { value: money(line.median), label: "Local median" },
              { value: String(line.peers), label: "Competitors publishing" },
            ].map((s, i) => (
              <div key={s.label} className={`flex flex-col-reverse justify-end ${i === 0 ? "pr-3" : "px-3 sm:px-5"}`}>
                <dt className="text-[12px] leading-snug text-ink-muted sm:text-[13px]">{s.label}</dt>
                <dd className="font-mono text-[24px] font-semibold tabular-nums text-ink sm:text-[30px]">{s.value}</dd>
              </div>
            ))}
          </dl>

          {/* The range: middle half, median, and the bank's own fee on one dollar axis. */}
          <div className="mt-8 px-1" role="img" aria-label={`${sample.name} ${money(line.own)}; local median ${money(line.median)}; middle half ${money(line.p25)} to ${money(line.p75)}`}>
            <div className="relative h-6 text-[12px] font-semibold text-ink">
              <span className="absolute -translate-x-1/2 whitespace-nowrap font-mono tabular-nums" style={{ left: x(line.own) }}>
                {money(line.own)}
              </span>
            </div>
            <div className="relative h-8">
              <span className="absolute inset-x-0 top-1/2 border-t border-[#cfd5de]" />
              {axis.ticks.map((t) => (
                <span key={t} className="absolute top-1/2 h-2 -translate-y-1/2 border-l border-[#cfd5de]" style={{ left: x(t) }} />
              ))}
              <span
                className="absolute top-1 bottom-1 rounded-[3px] bg-[#d6e4f5] ring-1 ring-[#b7cde9]"
                style={{ left: x(line.p25), width: `max(${((line.p75 - line.p25) / axis.max) * 100}%, 3px)` }}
              />
              <span className="absolute top-0 bottom-0 border-l-2 border-dashed border-ink" style={{ left: x(line.median) }} />
              <span
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink ring-2 ring-white"
                style={{ left: x(line.own) }}
              />
            </div>
            <div className="relative h-5 text-[11px] text-ink-soft">
              <span className="absolute -translate-x-1/2 whitespace-nowrap font-mono tabular-nums" style={{ left: x((line.p25 + line.p75) / 2) }}>
                {line.p25 === line.p75 ? money(line.p25) : `${money(line.p25)} to ${money(line.p75)}`}
              </span>
            </div>
            <div className="relative mt-1 h-5 text-[11px] text-ink-muted">
              {axis.ticks.map((t, i) => (
                <span
                  key={t}
                  className={`absolute font-mono tabular-nums ${i === 0 ? "" : i === axis.ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
                  style={{ left: x(t) }}
                >
                  {money(t)}
                </span>
              ))}
            </div>
          </div>
          <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-ink-muted" aria-hidden="true">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-4 rounded-[2px] bg-[#d6e4f5] ring-1 ring-[#b7cde9]" /> Middle half (25th to 75th percentile)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3.5 border-l-2 border-dashed border-ink" /> Median
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-ink" /> {sample.name}
            </span>
          </p>
        </div>

        {/* What it means. */}
        <div className="rounded-lg border border-[#dfe3ea] bg-white p-5 sm:p-6">
          <h3 className="text-[19px] font-medium text-ink" style={SERIF}>
            What this means
          </h3>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-soft" aria-live="polite">
            {lineInsight(sample.name, line)}
          </p>
          <h4 className="mt-6 border-t border-[#e6e9ef] pt-5 text-[15px] font-semibold text-ink">Common next steps</h4>
          <ol className="mt-3 space-y-2.5">
            {nextSteps(line).map((step, i) => (
              <li key={step} className="flex gap-3 text-[14px] text-ink-soft">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#e8eff8] text-[12px] font-semibold text-ink">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* The detail behind the figures, on demand. */}
      <details className="group mt-4 rounded-lg border border-[#dfe3ea] bg-white">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 text-[14px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
          Competitors, sources and method
          <span aria-hidden="true" className="text-ink-muted transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="border-t border-[#e6e9ef] px-5 pb-5 pt-4 text-[13px] text-ink-soft">
          <p>
            {sample.name}&apos;s figure is its &ldquo;{line.ownFeeName}&rdquo; fee
            {line.ownSourceUrl ? (
              <>
                {", from "}
                <a href={line.ownSourceUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline underline-offset-2">
                  its published fee schedule
                </a>
              </>
            ) : (
              ", from its published fee schedule"
            )}
            {readOn ? `, read ${formatReadOn(readOn)}` : ""}. Consumer accounts.
          </p>
          <table className="mt-4 w-full max-w-[36rem] text-left">
            <caption className="sr-only">Local competitors publishing {line.label}, lowest first</caption>
            <thead>
              <tr className="border-b border-[#e6e9ef] text-[12px] text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-medium">Competitor</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Fee</th>
                <th scope="col" className="py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {line.peerFigures.map((f, i) => (
                <tr key={`${f.name}-${i}`} className="border-b border-[#eef1f5]">
                  <td className="py-2 pr-3 text-ink">{f.name}</td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-ink">{money(f.amount)}</td>
                  <td className="py-2">
                    {f.sourceUrl ? (
                      <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-ink underline decoration-[#cfd5de] underline-offset-2 hover:decoration-ink">
                        Schedule{f.readOn ? `, ${formatReadOn(f.readOn)}` : ""}
                      </a>
                    ) : (
                      <span className="text-ink-muted">{f.readOn ? `Read ${formatReadOn(f.readOn)}` : "Stored copy"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4">
            Coverage: {sample.competitorsWithData} of the {sample.competitorsInMarket} institutions in{" "}
            {sample.market ?? "the local market"} have verified fees; {line.peers} publish this one. The middle half runs
            from the 25th to the 75th percentile of their prices.
            {line.peerFigures.length < line.peers
              ? ` The table lists the ${line.peerFigures.length} the market names; the other ${line.peers - line.peerFigures.length} count in the figures above.`
              : ""}{" "}
            <Link href="/methodology" className="font-medium text-ink underline underline-offset-2">
              How we verify
            </Link>
          </p>
        </div>
      </details>

      <p className="mt-4 text-[13px] text-ink-muted">
        Read from each institution&apos;s published fee schedule{sample.readOn ? ` through ${formatReadOn(sample.readOn)}` : ""}.{" "}
        <TrackLink
          event="sample_report_click"
          eventProps={{ placement: "reports_position_sample" }}
          href={REPORT_SHOWCASE.sampleHref}
          className="font-semibold text-ink underline decoration-[#cfd5de] underline-offset-4 hover:decoration-ink"
        >
          Read the full sample report
        </TrackLink>
      </p>
    </div>
  );
}
