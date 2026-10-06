import { STATE_CODES, STATE_NAMES } from "@/lib/us-states";

const STATES = [...STATE_CODES].sort((a, b) => (STATE_NAMES[a] ?? a).localeCompare(STATE_NAMES[b] ?? b));

/** Optional state picker for email signups: readers who pick one also get that state's monthly edition. */
export function StateSelect({
  id,
  value,
  onChange,
  className,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">Your state (optional)</option>
      {STATES.map((code) => (
        <option key={code} value={code}>
          {STATE_NAMES[code]}
        </option>
      ))}
    </select>
  );
}
