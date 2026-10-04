"use client";

import { Slider } from "radix-ui";

interface Props {
  min: number;
  max: number;
  step: number;
  currentFee: number;
  proposedFee: number;
  median: number;
  p75: number;
  onValueChange: (value: number[]) => void;
  onValueCommit: (value: number[]) => void;
  onInputChange?: (value: number) => void;
  onInputCommit?: () => void;
}

function formatDollar(v: number): string {
  return `$${v.toFixed(0)}`;
}

/** Convert a fee amount to a percentage along the slider track [0, 100] */
function toPercent(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

export function FeeSlider({
  min,
  max,
  step,
  proposedFee,
  median,
  onValueChange,
  onValueCommit,
  onInputChange,
  onInputCommit,
}: Props) {
  const medianPct = toPercent(median, min, max);

  return (
    <div>
      {/* Header: label + dollar input */}
      <div className="flex justify-between items-center mb-3">
        <label
          className="font-label text-[10px] uppercase tracking-widest"
          style={{ color: "var(--hamilton-primary)" }}
        >
          Active Simulation Target
        </label>
        <div
          className="flex items-center bg-white border px-3 py-1 rounded"
          style={{ borderColor: "rgb(214 211 208)" }}
        >
          <span
            className="font-headline text-xl mr-1"
            style={{ color: "var(--hamilton-primary)" }}
          >
            $
          </span>
          <input
            type="number"
            value={Number(proposedFee.toFixed(2))}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v) && onInputChange) onInputChange(v);
            }}
            onBlur={onInputCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter" && onInputCommit) onInputCommit();
            }}
            className="font-headline text-xl bg-transparent border-none focus:ring-0 w-12 p-0 font-bold"
            style={{ color: "var(--hamilton-primary)" }}
            aria-label="Simulation target fee"
          />
        </div>
      </div>

      {/* Slider */}
      <div className="px-2">
        <Slider.Root
          className="relative flex w-full touch-none select-none items-center h-4"
          value={[proposedFee]}
          min={min}
          max={max}
          step={step}
          onValueChange={onValueChange}
          onValueCommit={onValueCommit}
        >
          <Slider.Track
            className="relative h-1.5 w-full grow rounded-lg"
            style={{ background: "rgb(214 211 208)" }}
          >
            <Slider.Range
              className="absolute h-full rounded-lg"
              style={{ background: "var(--hamilton-primary)", opacity: 0.4 }}
            />
          </Slider.Track>
          <Slider.Thumb
            className="block h-4 w-4 rounded-full border-2 shadow focus-visible:outline-none cursor-grab active:cursor-grabbing"
            style={{
              background: "var(--hamilton-primary)",
              borderColor: "white",
            }}
            aria-label="Proposed fee"
          />
        </Slider.Root>

        {/* Track labels */}
        <div
          className="flex justify-between mt-2 font-label"
          style={{ fontSize: "0.6875rem", letterSpacing: "0.07em", fontWeight: 600, textTransform: "uppercase" }}
        >
          <span style={{ color: "rgb(168 162 158)" }}>{formatDollar(min)} MIN</span>
          <span
            className="font-bold"
            style={{ color: "var(--hamilton-primary)" }}
          >
            PEER MEDIAN: {formatDollar(median)}
          </span>
          <span style={{ color: "rgb(168 162 158)" }}>{formatDollar(max)} MAX</span>
        </div>

        {/* Median tick marker */}
        <div className="relative h-2 mt-0.5 px-0">
          <div
            className="absolute top-0 w-px h-2"
            style={{
              left: `${medianPct}%`,
              background: "var(--hamilton-primary)",
              opacity: 0.4,
            }}
          />
        </div>
      </div>
    </div>
  );
}
