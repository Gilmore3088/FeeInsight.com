import Link from "next/link";

export interface PeerSetOption {
  key: string;
  /** The peer set in plain words, as peer-sets.ts names it. */
  label: string;
  /** A plain GET link, so the choice works without JavaScript. */
  href: string;
  /** A short sub-label the chip is listed under, e.g. "Size". */
  group?: string;
}

/** The focus ring's offset matches the surface the picker sits on. */
const RING_OFFSET = {
  "surface-0": "focus-visible:ring-offset-surface-0",
  paper: "focus-visible:ring-offset-paper",
} as const;

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * The one peer-set selector the public pages share: a row of links, the current set marked.
 * Each page builds its own hrefs (?peers=key) and lists only sets that clear its median floor.
 */
export function PeerSetPicker({
  label,
  options,
  current,
  surface = "paper",
}: {
  label: string;
  options: PeerSetOption[];
  current: string;
  /** The background the picker sits on, for the focus ring's offset. */
  surface?: keyof typeof RING_OFFSET;
}) {
  if (options.length < 2) return null;
  const groups: { name: string | null; options: PeerSetOption[] }[] = [];
  for (const option of options) {
    const name = option.group ?? null;
    const group = groups.find((g) => g.name === name);
    if (group) group.options.push(option);
    else groups.push({ name, options: [option] });
  }
  return (
    <nav aria-label={label} className="min-w-0">
      <p className="text-[12px] font-medium text-ink-muted sm:mx-0 sm:text-left">{label}</p>
      <div className="mt-2 space-y-3">
        {groups.map((group) => {
          const groupId = group.name ? `peer-set-${slug(label)}-${slug(group.name)}` : undefined;
          return (
            <div key={group.name ?? "all"} className="min-w-0">
              {group.name && (
                <p id={groupId} className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted sm:mx-0 sm:text-left">
                  {group.name}
                </p>
              )}
              <ul className="flex flex-wrap gap-2" aria-labelledby={groupId}>
                {group.options.map((option) => {
                  const active = option.key === current;
                  return (
                    <li key={option.key} className="min-w-0 max-w-full">
                      <Link
                        href={option.href}
                        scroll={false}
                        aria-current={active ? "page" : undefined}
                        className={`inline-flex min-h-11 max-w-full items-center rounded-full border px-4 py-2 text-left text-[13px] leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 ${RING_OFFSET[surface]} ${
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
            </div>
          );
        })}
      </div>
    </nav>
  );
}
