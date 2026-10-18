import Link from "next/link";
import { PeerSetSelect } from "./peer-set-select";

export interface PeerSetOption {
  key: string;
  /** The peer set in plain words, as peer-sets.ts names it. */
  label: string;
  /** A plain GET link, so the choice works without JavaScript. */
  href: string;
  /** A short sub-label the chip is listed under, e.g. "Size". */
  group?: string;
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * The one peer-set selector the public pages share, placed above the results: a select on a
 * phone, a segmented row of links wider, the current set marked. Each page builds its own hrefs
 * (?peers=key) and lists only sets that clear its median floor.
 */
export function PeerSetPicker({
  label,
  options,
  current,
}: {
  label: string;
  options: PeerSetOption[];
  current: string;
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
    <div className="min-w-0">
      {/* Phone: one compact select. */}
      <div className="sm:hidden">
        <PeerSetSelect key={current} label={label} options={options} current={current} />
      </div>
      {/* Wider: a segmented row of links, the current group filled. */}
      <nav aria-label={label} className="hidden min-w-0 sm:block">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          {groups.map((group) => {
            const groupId = group.name ? `peer-set-${slug(label)}-${slug(group.name)}` : undefined;
            return (
              <div key={group.name ?? "all"} className="min-w-0">
                <p id={groupId} className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                  {group.name ?? label}
                </p>
                <ul className="inline-flex max-w-full flex-wrap gap-1 rounded-[22px] border border-border bg-paper p-1" aria-labelledby={groupId}>
                  {group.options.map((option) => {
                    const active = option.key === current;
                    return (
                      <li key={option.key} className="min-w-0 max-w-full">
                        <Link
                          href={option.href}
                          scroll={false}
                          aria-current={active ? "page" : undefined}
                          className={`inline-flex min-h-10 max-w-full items-center rounded-full px-4 py-1.5 text-left text-[13px] leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${
                            active ? "bg-ink font-semibold text-on-ink shadow-fi-1" : "text-ink-soft hover:bg-surface-0 hover:text-ink"
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
    </div>
  );
}
