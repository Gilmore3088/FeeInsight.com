"use client";

import Form from "next/form";

export interface FeeOption {
  key: string;
  label: string;
  family: string;
  /** Shown only with full access: labelled so a visitor knows before picking it. */
  locked: boolean;
}

const SELECT =
  "mt-1 min-h-11 w-full rounded-full border border-ink bg-surface-0 px-4 text-[14px] font-semibold text-ink";

/**
 * The explorer's three controls. A plain GET form, so it works without JavaScript and every
 * selection is a link (an ad for Florida wires can open on Florida wires); with JavaScript a
 * change applies at once.
 */
export function ExplorerControls({
  fees,
  states,
  fee,
  state,
  charter,
}: {
  fees: FeeOption[];
  states: { code: string; name: string }[];
  fee: string;
  state: string | null;
  charter: string;
}) {
  const families = [...new Set(fees.map((f) => f.family))];
  const submit = (e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();
  return (
    <Form action="/fees" scroll={false} className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <label className="block">
        <span className="text-[13px] font-medium text-ink">Fee</span>
        <select name="fee" defaultValue={fee} onChange={submit} className={SELECT}>
          {families.map((family) => (
            <optgroup key={family} label={family}>
              {fees
                .filter((f) => f.family === family)
                .map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                    {f.locked ? " (full access)" : ""}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-[13px] font-medium text-ink">Headquartered in</span>
        <select name="state" defaultValue={state ?? ""} onChange={submit} className={SELECT}>
          <option value="">United States</option>
          {states.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-[13px] font-medium text-ink">Institutions</span>
        <select name="charter" defaultValue={charter} onChange={submit} className={SELECT}>
          <option value="all">Banks and credit unions</option>
          <option value="bank">Banks</option>
          <option value="credit_union">Credit unions</option>
        </select>
      </label>
      <noscript>
        <button type="submit" className="min-h-11 rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink">
          Show
        </button>
      </noscript>
    </Form>
  );
}
