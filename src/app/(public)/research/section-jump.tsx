"use client";

/**
 * The section menu on a phone: one dropdown instead of a row of links that runs off the
 * screen. Picking a section scrolls to it, as the links do on wider screens.
 */
export function SectionJump({ sections, label }: { sections: readonly { id: string; label: string }[]; label: string }) {
  return (
    <label className="block sm:hidden">
      <span className="sr-only">{label}</span>
      <select
        defaultValue=""
        onChange={(e) => {
          const id = e.target.value;
          if (!id) return;
          document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
          history.replaceState(null, "", `#${id}`);
        }}
        className="min-h-11 w-full rounded-full border border-border bg-surface-0 px-4 text-[14px] font-semibold text-ink"
      >
        <option value="" disabled>
          Jump to a section
        </option>
        {sections.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}
