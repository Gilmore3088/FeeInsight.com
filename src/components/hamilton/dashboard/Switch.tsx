"use client";
import "./dashboard.css";

/** An on/off switch: a real button with role="switch" and aria-checked, named by `label`. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Its accessible name, e.g. "Watch Example Bank". */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="hd-switch"
      onClick={() => onChange(!checked)}
    />
  );
}
