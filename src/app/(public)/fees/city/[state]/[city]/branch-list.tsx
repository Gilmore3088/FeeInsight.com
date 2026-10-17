"use client";

import Link from "next/link";
import { useState } from "react";
import type { BranchPoint } from "@/lib/data-store";

/** Institutions listed before "Show all". */
const BRANCH_LIST_SHOWN = 8;

/**
 * The branches as a compact list when the live map can't draw its streets: each institution with
 * its branch count, and its addresses one tap away. Banks are marked ink, credit unions brick, as
 * on the map.
 */
export function BranchList({
  points,
  unplaced = [],
  label,
}: {
  points: Omit<BranchPoint, "lat" | "lon">[];
  /** Branches with no coordinates: a list needs only the address, so they are listed too. */
  unplaced?: Omit<BranchPoint, "lat" | "lon">[];
  label: string;
}) {
  const [all, setAll] = useState(false);
  const byInstitution = new Map<number, { name: string; charter: BranchPoint["charter"]; addresses: string[]; count: number }>();
  for (const p of [...points, ...unplaced]) {
    const row = byInstitution.get(p.institution_id) ?? { name: p.name, charter: p.charter, addresses: [], count: 0 };
    row.count += 1;
    if (p.address) row.addresses.push(p.address);
    byInstitution.set(p.institution_id, row);
  }
  const rows = [...byInstitution.entries()].sort((a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name));
  // A short list shows whole; "Show all" only when it would hide more than two.
  const folds = rows.length > BRANCH_LIST_SHOWN + 2;
  const shown = all || !folds ? rows : rows.slice(0, BRANCH_LIST_SHOWN);
  return (
    <div>
      <ul className="divide-y divide-border border-y border-border" aria-label={`Branch locations in ${label}, by institution`}>
        {shown.map(([id, r]) => (
          <li key={id} className="py-0.5">
            <details className="group/br">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${r.charter === "bank" ? "bg-ink" : "bg-brick"}`} />
                <span className="min-w-0 flex-1 text-[14px] font-medium leading-tight text-ink">{r.name}</span>
                <span className="shrink-0 font-sans text-[13px] tabular-nums text-ink-muted">
                  {r.count} {r.count === 1 ? "branch" : "branches"}
                </span>
                <span aria-hidden="true" className="shrink-0 text-ink-muted transition-transform group-open/br:rotate-90">
                  &rsaquo;
                </span>
              </summary>
              <div className="pb-1 pl-[1.375rem]">
                {r.addresses.length > 0 ? (
                  <ul className="space-y-0.5 text-[13px] text-ink-soft">
                    {r.addresses.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-ink-muted">No street address in the branch record.</p>
                )}
                <Link href={`/institution/${id}`} className="mt-1 inline-flex min-h-11 items-center text-[13px] font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
                  {r.name}&apos;s fees
                </Link>
              </div>
            </details>
          </li>
        ))}
      </ul>
      {folds && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          className="mt-3 inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
        >
          {all ? "Show fewer" : `Show all ${rows.length} institutions`}
        </button>
      )}
      <p className="mt-2 text-[12px] text-ink-muted">Branch records from the FDIC Summary of Deposits (banks) and NCUA (credit unions).</p>
    </div>
  );
}
