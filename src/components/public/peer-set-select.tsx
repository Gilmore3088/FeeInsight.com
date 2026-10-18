"use client";

import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import type { PeerSetOption } from "./peer-set-picker";

/** The form a plain GET submit needs: the path, the other query values and the anchor, read from one option's link. */
function formFor(href: string) {
  const url = new URL(href, "https://fee.invalid");
  const hidden = [...url.searchParams.entries()].filter(([name]) => name !== "peers");
  return { action: `${url.pathname}${url.hash}`, hidden };
}

/**
 * The phone's peer-group selector: one native select. Choosing a group goes straight to its link
 * without moving the page; without JavaScript, the Show button submits the same ?peers= value.
 */
export function PeerSetSelect({ label, options, current }: { label: string; options: PeerSetOption[]; current: string }) {
  const router = useRouter();
  const id = `peer-set-select-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const { action, hidden } = formFor(options[0]?.href ?? "");
  const groups: { name: string | null; options: PeerSetOption[] }[] = [];
  for (const option of options) {
    const name = option.group ?? null;
    const group = groups.find((g) => g.name === name);
    if (group) group.options.push(option);
    else groups.push({ name, options: [option] });
  }
  const item = (option: PeerSetOption) => (
    <option key={option.key} value={option.key}>
      {option.label}
    </option>
  );
  return (
    <form action={action} method="get" className="flex min-w-0 items-center gap-3">
      {hidden.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label htmlFor={id} className="shrink-0 text-[13px] font-medium text-ink-muted">
        {label}
      </label>
      <span className="relative min-w-0 flex-1">
        <select
          id={id}
          name="peers"
          defaultValue={current}
          onChange={(e) => {
            const next = options.find((o) => o.key === e.target.value);
            if (next) router.push(next.href, { scroll: false });
          }}
          className="min-h-11 w-full min-w-0 appearance-none truncate rounded-full border border-ink bg-surface-0 py-2 pl-4 pr-10 text-[14px] font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
        >
          {groups.map((group) =>
            group.name ? (
              <optgroup key={group.name} label={group.name}>
                {group.options.map(item)}
              </optgroup>
            ) : (
              group.options.map(item)
            ),
          )}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-ink" />
      </span>
      <noscript>
        <button type="submit" className="min-h-11 rounded-full border border-border px-4 text-[14px] font-medium text-ink">
          Show
        </button>
      </noscript>
    </form>
  );
}
