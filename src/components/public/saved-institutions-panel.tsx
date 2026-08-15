"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatAmount } from "@/lib/format";

interface SavedInstitution {
  institution_id: number;
  institution_name: string;
  state_code: string | null;
  amount: number | null;
}

/**
 * "What you pay" for the fee this guide is about.
 *
 * A client island rather than server-rendered, so the guide page around it stays static
 * and identical for every reader. It renders nothing at all until data arrives and
 * nothing at all when there is none, so a signed-out reader never sees a teaser and the
 * page never shifts to accommodate an empty box.
 */
export function SavedInstitutionsPanel({
  category,
  categoryLabel,
  median,
}: {
  category: string;
  categoryLabel: string;
  median: number | null;
}) {
  const [institutions, setInstitutions] = useState<SavedInstitution[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/guides/saved-institutions?category=${encodeURIComponent(category)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : { institutions: [] }))
      .then((data) => setInstitutions(data.institutions ?? []))
      .catch(() => setInstitutions([]));
    return () => controller.abort();
  }, [category]);

  if (!institutions || institutions.length === 0) return null;

  return (
    <section
      aria-labelledby="your-institutions-heading"
      className="mt-8 rounded-xl border border-[#1A1815]/15 bg-white/80 px-6 py-5"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#1A1815]/50">
        Your institutions
      </p>
      <h2
        id="your-institutions-heading"
        className="mt-2 text-[17px] font-medium text-[#1A1815]"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        What you pay for {categoryLabel.toLowerCase()}
      </h2>
      <ul className="mt-4 space-y-2.5">
        {institutions.map((inst) => {
          const delta =
            inst.amount !== null && median !== null ? inst.amount - median : null;
          return (
            <li
              key={inst.institution_id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[#E8DFD1]/60 pb-2.5 last:border-0 last:pb-0"
            >
              <Link
                href={`/institution/${inst.institution_id}?fee=${category}#fee-${category}`}
                className="text-[14px] font-medium text-[#1A1815] transition-colors hover:text-[#C44B2E]"
              >
                {inst.institution_name}
                {inst.state_code && (
                  <span className="ml-1.5 text-[11px] font-normal text-[#8A8073]">
                    {inst.state_code}
                  </span>
                )}
              </Link>
              {inst.amount === null ? (
                <span className="text-[12px] text-[#8A8073]">
                  No published {categoryLabel.toLowerCase()}
                </span>
              ) : (
                <span className="text-[15px] font-semibold tabular-nums text-[#1A1815]">
                  {formatAmount(inst.amount)}
                  {delta !== null && (
                    <span
                      className={`ml-2 text-[11px] font-normal tabular-nums ${
                        delta > 0
                          ? "text-red-700"
                          : delta < 0
                            ? "text-emerald-700"
                            : "text-[#8A8073]"
                      }`}
                    >
                      {delta > 0
                        ? `${formatAmount(delta)} above median`
                        : delta < 0
                          ? `${formatAmount(Math.abs(delta))} below median`
                          : "at the median"}
                    </span>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] text-[#8A8073]">
        We&rsquo;ll email you when one of these changes.{" "}
        <Link href="/account" className="text-[#C44B2E]/80 hover:text-[#C44B2E]">
          Manage your alerts
        </Link>
      </p>
    </section>
  );
}
