"use client";
import "./dashboard.css";
import { useControllable } from "./use-controllable";

export interface FilterChipOption<V extends string = string> {
  value: V;
  label: string;
  /** Shown after the label, e.g. "Above 4". */
  count?: number;
}

/** Filter chips: one on at a time, each a button with aria-pressed, in a labelled group. */
export function FilterChips<V extends string>({
  label,
  options,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  options: FilterChipOption<V>[];
  value?: V;
  defaultValue?: V;
  onChange?: (next: V) => void;
}) {
  const [current, set] = useControllable<V>(value, onChange, defaultValue ?? options[0]?.value);
  return (
    <div role="group" aria-label={label} className="hd-chips">
      {options.map((option) => (
        <button key={option.value} type="button" className="hd-chip" aria-pressed={current === option.value} onClick={() => set(option.value)}>
          {option.label}
          {option.count !== undefined ? <span className="hd-mono"> {option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
