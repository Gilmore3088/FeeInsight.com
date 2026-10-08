import { SERIF } from "@/components/hamilton/memo/memo";

interface StatCalloutBoxProps {
  label: string;
  current: string;
  proposed: string;
}

/**
 * Current figure -> its benchmark (never a proposed price). Values wrap inside their own column (min-w-0,
 * break-words) and step down in size on narrow cards, so a long value can
 * never spill out of the box.
 */
export function StatCalloutBox({ label, current, proposed }: StatCalloutBoxProps) {
  return (
    <div className="min-w-0 rounded-lg border border-warm-300 bg-warm-50 p-4">
      <p className="mb-3 text-sm font-medium text-pretty text-warm-800">{label}</p>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
        <StatValue caption="Current" value={current} accent={false} />
        <div aria-hidden="true" className="pb-1 text-xl text-warm-600">
          →
        </div>
        <StatValue caption="Benchmark" value={proposed} accent />
      </div>
    </div>
  );
}

function StatValue({ caption, value, accent }: { caption: string; value: string; accent: boolean }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs text-warm-600">{caption}</p>
      <p
        className={`${value.length > 10 ? "text-xl" : "text-2xl sm:text-3xl"} break-words leading-tight [font-variant-numeric:tabular-nums] ${accent ? "text-terra-text" : "text-warm-900"}`}
        style={SERIF}
      >
        {value}
      </p>
    </div>
  );
}
