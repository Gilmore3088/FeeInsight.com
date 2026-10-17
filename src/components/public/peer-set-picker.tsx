import Link from "next/link";

export interface PeerSetOption {
  key: string;
  /** The peer set in plain words, as peer-sets.ts names it. */
  label: string;
  /** A plain GET link, so the choice works without JavaScript. */
  href: string;
}

/**
 * The one peer-set selector the public pages share: a row of links, the current set marked.
 * Each page builds its own hrefs (?peers=key) and lists only sets that clear its median floor.
 */
export function PeerSetPicker({ label, options, current }: { label: string; options: PeerSetOption[]; current: string }) {
  if (options.length < 2) return null;
  return (
    <nav aria-label={label} className="min-w-0">
      <p className="text-[12px] font-medium text-ink-muted sm:mx-0 sm:text-left">{label}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.key === current;
          return (
            <li key={option.key} className="min-w-0 max-w-full">
              <Link
                href={option.href}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={`inline-flex min-h-11 max-w-full items-center rounded-full border px-4 py-2 text-left text-[13px] leading-snug transition-colors ${
                  active
                    ? "border-ink bg-ink font-semibold text-on-ink"
                    : "border-border bg-surface-0 text-ink hover:border-ink"
                }`}
              >
                {option.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
