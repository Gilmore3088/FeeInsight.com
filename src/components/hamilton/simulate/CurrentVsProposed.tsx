"use client";

import { PERCENTILE_METHOD } from "@/lib/percentile";
import type { FeePosition } from "@/lib/hamilton/simulation";

interface Props {
  feeCategory: string;
  currentFee: number;
  proposedFee: number;
  currentPosition: FeePosition;
  proposedPosition: FeePosition;
}

function formatDollar(v: number): string {
  return `$${v.toFixed(2)}`;
}

function formatGap(gap: number): string {
  const sign = gap >= 0 ? "+" : "";
  return `${sign}${formatDollar(Math.abs(gap))}`;
}

function riskLabel(profile: "low" | "medium" | "high"): string {
  if (profile === "low") return "Low Exposure";
  if (profile === "medium") return "Moderate";
  return "High Exposure";
}

function riskColor(profile: "low" | "medium" | "high"): string {
  if (profile === "low") return "rgb(21 128 61)";   // green-700
  if (profile === "medium") return "rgb(161 98 7)";  // amber-700
  return "rgb(185 28 28)";                            // red-700
}

export function CurrentVsProposed({
  currentFee,
  proposedFee,
  currentPosition,
  proposedPosition,
}: Props) {
  const hasChange = proposedFee !== currentFee;
  const percentileDelta = proposedPosition.percentile - currentPosition.percentile;
  const gapDelta = proposedPosition.medianGap - currentPosition.medianGap;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Current State — faded */}
      <div
        className="bg-white p-6 border"
        style={{ borderColor: "rgb(231 229 228)", opacity: 0.6 }}
      >
        <div className="flex justify-between items-start mb-6">
          <div>
            <span
              className="font-label text-[10px] uppercase tracking-widest border px-2 py-0.5 rounded"
              style={{
                color: "rgb(120 113 108)",
                borderColor: "rgb(214 211 208)",
                background: "rgb(250 249 248)",
              }}
            >
              Current
            </span>
            <h3 className="font-headline text-3xl mt-3" style={{ color: "rgb(41 37 36)" }}>
              {formatDollar(currentFee)}
            </h3>
          </div>
          <div className="text-right">
            <div className="font-headline text-2xl" style={{ color: "rgb(120 113 108)" }}>
              {currentPosition.percentile}th
            </div>
            <div className="font-label text-[9px] uppercase tracking-widest" style={{ color: "rgb(168 162 158)" }}>
              Market Percentile
            </div>
          </div>
        </div>

        <p className="mb-3 text-[11px] leading-snug" style={{ color: "rgb(120 113 108)" }}>
          {currentPosition.method === "mid_rank" ? PERCENTILE_METHOD : "Percentile estimated from the peer quartiles: fewer than 5 peer amounts are on file."}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="border-t pt-3" style={{ borderColor: "rgb(245 245 244)" }}>
            <span className="font-label text-[9px] uppercase tracking-widest" style={{ color: "rgb(168 162 158)" }}>
              Median Gap
            </span>
            <div className="font-headline text-lg mt-0.5" style={{ color: "rgb(87 83 78)" }}>
              {formatGap(currentPosition.medianGap)}
            </div>
          </div>
          <div className="border-t pt-3" style={{ borderColor: "rgb(245 245 244)" }}>
            <span className="font-label text-[9px] uppercase tracking-widest" style={{ color: "rgb(168 162 158)" }}>
              Risk Index
            </span>
            <div
              className="font-label text-[10px] uppercase tracking-widest mt-1 font-bold"
              style={{ color: riskColor(currentPosition.riskProfile) }}
            >
              {riskLabel(currentPosition.riskProfile)}
            </div>
          </div>
        </div>
      </div>

      {/* Proposed State — primary highlight */}
      <div
        className="bg-white p-6 border-2"
        style={{
          borderColor: "var(--hamilton-primary)",
          boxShadow: "0 0 0 4px color-mix(in srgb, var(--hamilton-primary) 5%, transparent)",
        }}
      >
        <div className="flex justify-between items-start mb-6">
          <div>
            <span
              className="font-label text-[10px] uppercase tracking-widest border px-2 py-0.5 rounded"
              style={{
                color: "var(--hamilton-primary)",
                background: "color-mix(in srgb, var(--hamilton-primary) 5%, transparent)",
                borderColor: "color-mix(in srgb, var(--hamilton-primary) 20%, transparent)",
              }}
            >
              Simulated
            </span>
            <h3 className="font-headline text-4xl mt-3" style={{ color: "var(--hamilton-primary)" }}>
              {formatDollar(proposedFee)}
            </h3>
          </div>
          <div className="text-right">
            <div className="font-headline text-2xl flex flex-col items-end leading-none" style={{ color: "var(--hamilton-primary)" }}>
              {hasChange && (
                <span className="font-label text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--hamilton-primary)" }}>
                  {percentileDelta > 0 ? "+" : ""}{percentileDelta} PTS
                </span>
              )}
              {proposedPosition.percentile}th
            </div>
            <div className="font-label text-[9px] uppercase tracking-widest mt-1" style={{ color: "rgb(168 162 158)" }}>
              Market Percentile
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="border-t pt-3" style={{ borderColor: "rgb(231 229 228)" }}>
            <span className="font-label text-[9px] uppercase tracking-widest" style={{ color: "rgb(120 113 108)" }}>
              Simulated Gap
            </span>
            <div className="font-headline text-lg flex items-center gap-2 mt-0.5" style={{ color: "rgb(28 25 23)" }}>
              {formatGap(proposedPosition.medianGap)}
              {hasChange && (
                <span className="font-label text-[10px] uppercase tracking-widest" style={{ color: "var(--hamilton-primary)" }}>
                  {gapDelta >= 0 ? "+" : ""}{formatDollar(Math.abs(gapDelta))}
                </span>
              )}
            </div>
          </div>
          <div className="border-t pt-3" style={{ borderColor: "rgb(231 229 228)" }}>
            <span className="font-label text-[9px] uppercase tracking-widest" style={{ color: "rgb(120 113 108)" }}>
              Risk Index
            </span>
            <div className="font-label text-[10px] uppercase tracking-widest mt-1 font-bold flex items-center gap-2" style={{ color: "rgb(28 25 23)" }}>
              {riskLabel(proposedPosition.riskProfile)}
              {hasChange && proposedPosition.riskProfile !== currentPosition.riskProfile && (
                <span style={{ color: "var(--hamilton-primary)" }}>
                  &darr; SIGNIFICANT
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
