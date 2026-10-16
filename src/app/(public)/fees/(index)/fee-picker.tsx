"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FeeOption } from "./explorer-controls";

interface Group {
  label: string;
  options: FeeOption[];
}

/**
 * The fee control: type to narrow fifty categories, or open the list and pick. Free categories come
 * first; the rest sit under one "With full access" heading instead of a label on every option.
 * Picking writes the hidden `fee` field and submits the explorer's form.
 */
export function FeePicker({ fees, fee, labelId }: { fees: FeeOption[]; fee: string; labelId: string }) {
  const id = useId();
  const listId = `${id}-list`;
  const hidden = useRef<HTMLInputElement>(null);
  const current = fees.find((f) => f.key === fee);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const groups = useMemo<Group[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (f: FeeOption) => !q || f.label.toLowerCase().includes(q) || f.family.toLowerCase().includes(q);
    const free = fees.filter((f) => !f.locked && match(f));
    const locked = fees.filter((f) => f.locked && match(f));
    if (locked.length === 0 && fees.every((f) => !f.locked)) {
      const families = [...new Set(free.map((f) => f.family))];
      return families.map((family) => ({ label: family, options: free.filter((f) => f.family === family) }));
    }
    return [
      { label: "Free to explore", options: free },
      { label: "With full access", options: locked },
    ].filter((g) => g.options.length > 0);
  }, [fees, query]);
  const flat = groups.flatMap((g) => g.options);
  const activeKey = open ? flat[active]?.key : undefined;
  // Arrow keys keep the highlighted fee in view inside the scrolling list.
  useEffect(() => {
    if (activeKey) document.getElementById(`${id}-${activeKey}`)?.scrollIntoView({ block: "nearest" });
  }, [activeKey, id]);

  const pick = (f: FeeOption) => {
    setOpen(false);
    setQuery("");
    if (f.key === fee || !hidden.current) return;
    hidden.current.value = f.key;
    hidden.current.form?.requestSubmit();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (flat.length ? (a + step + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && flat[active]) pick(flat[active]);
      else setOpen(true);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  let index = -1;
  return (
    <div className="relative mt-1">
      <input ref={hidden} type="hidden" name="fee" defaultValue={fee} />
      <input
        type="text"
        role="combobox"
        aria-labelledby={labelId}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && flat[active] ? `${id}-${flat[active].key}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={open ? query : (current?.label ?? "")}
        placeholder={open ? `Search ${fees.length} fees` : undefined}
        onFocus={() => {
          setOpen(true);
          setActive(Math.max(flat.findIndex((f) => f.key === fee), 0));
        }}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKey}
        className="min-h-11 w-full rounded-full border border-ink bg-surface-0 px-4 pr-10 text-[14px] font-semibold text-ink placeholder:font-normal placeholder:text-ink-muted"
      />
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[12px] text-ink" aria-hidden="true">
        ▾
      </span>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-2xl border border-border bg-surface-0 p-1 shadow-lg"
        >
          {flat.length === 0 && <p className="px-3 py-2 text-[13px] text-ink-muted">No fee matches &ldquo;{query}&rdquo;.</p>}
          {groups.map((g) => (
            <div key={g.label} role="group" aria-label={g.label}>
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted" aria-hidden="true">
                {g.label}
              </p>
              {g.options.map((f) => {
                index += 1;
                const i = index;
                return (
                  <div
                    key={f.key}
                    id={`${id}-${f.key}`}
                    role="option"
                    aria-selected={f.key === fee}
                    // Keep focus in the box so the pick lands before the blur closes the list.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(f)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-xl px-3 text-[14px] ${
                      i === active ? "bg-ink/10" : ""
                    } ${f.locked ? "text-ink-soft" : "text-ink"} ${f.key === fee ? "font-semibold" : ""}`}
                  >
                    <span>{f.label}</span>
                    {query && <span className="shrink-0 text-[11px] text-ink-muted">{f.family}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
