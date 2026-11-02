"use client";
import "./dashboard.css";
import { useControllable } from "./use-controllable";

export interface SegmentOption<V extends string = string> {
  value: V;
  label: string;
}

/**
 * A small set of mutually exclusive views (a measure, a comparison group). Real buttons with
 * aria-pressed inside a labelled group, so a screen reader hears which one is on.
 */
export function SegmentedControl<V extends string>({
  label,
  options,
  value,
  defaultValue,
  onChange,
}: {
  /** The group's accessible name, e.g. "Compare with". */
  label: string;
  options: SegmentOption<V>[];
  value?: V;
  defaultValue?: V;
  onChange?: (next: V) => void;
}) {
  const [current, set] = useControllable<V>(value, onChange, defaultValue ?? options[0]?.value);
  return (
    <div role="group" aria-label={label} className="hd-seg">
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={current === option.value} onClick={() => set(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
