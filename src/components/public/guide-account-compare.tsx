"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AccountPolicy, PolicyLine } from "@/lib/data-store/overdraft-policies";
import { formatAmount } from "@/lib/format";

export interface CompareFeature {
  feature: string;
  question: string;
  /** The Index category that answers it; null when the Index does not track it. */
  category: string | null;
}

interface SearchHit {
  id: number;
  institution_name: string;
  city: string | null;
  state_code: string | null;
}

const MAX = 3;

/** Examples to start from: one community bank, one national bank, one credit union. */
const EXAMPLES: { id: number; name: string }[] = [
  { id: 323, name: "Capital City Bank" },
  { id: 5, name: "U.S. Bank" },
  { id: 4956, name: "Navy Federal Credit Union" },
];

/** The compared institutions live in the address (#compare=323,5), so a comparison can be shared. */
function parseHash(hash: string): number[] {
  const match = hash.match(/compare=([\d,]+)/);
  return match ? match[1].split(",").map(Number).filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, MAX) : [];
}

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function writeHash(ids: number[]) {
  const url = new URL(window.location.href);
  url.hash = ids.length ? `compare=${ids.join(",")}` : "compare-accounts";
  window.history.replaceState(null, "", url);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/**
 * Compare institutions on the guide's policy features, line by line from their published
 * schedules: the account the line names, its conditions, the source and the date we read it.
 * A feature the Index does not track, or a line a schedule does not list, says "ask"; it never
 * reads as "no protection".
 */
export function AccountCompare({ features }: { features: CompareFeature[] }) {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const ids = useMemo(() => parseHash(hash), [hash]);
  const key = ids.join(",");
  const [loaded, setLoaded] = useState<{ key: string; policies: AccountPolicy[] }>({ key: "", policies: [] });
  const loading = key !== "" && loaded.key !== key;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const searching = query.trim().length >= 2;

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    fetch(`/api/guides/account-policies?ids=${key}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { institutions: [] }))
      .then((data) => setLoaded({ key, policies: data.institutions ?? [] }))
      .catch(() => {});
    return () => controller.abort();
  }, [key]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/institutions?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : []))
        .then((rows: SearchHit[]) => setHits(Array.isArray(rows) ? rows.slice(0, 6) : []))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const add = (id: number) => {
    if (ids.includes(id) || ids.length >= MAX) return;
    writeHash([...ids, id]);
    setQuery("");
    setHits([]);
  };
  const remove = (id: number) => {
    writeHash(ids.filter((i) => i !== id));
  };

  const shown = ids
    .map((id) => loaded.policies.find((p) => p.institution_id === id))
    .filter((p): p is AccountPolicy => Boolean(p));

  return (
    <div className="mt-4">
      {ids.length < MAX && (
        <div className="relative max-w-md">
          <label className="block">
            <span className="text-[13px] font-medium text-ink">Add a bank or credit union</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name"
              autoComplete="off"
              className="mt-1 min-h-11 w-full rounded-full border border-ink bg-surface-0 px-4 text-[15px] text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-ink"
            />
          </label>
          {searching && hits.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-surface-0 shadow-lg">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => add(h.id)}
                    className="flex min-h-11 w-full items-baseline justify-between gap-3 px-4 py-2 text-left text-[14px] text-ink hover:bg-paper"
                  >
                    <span>{h.institution_name}</span>
                    <span className="shrink-0 text-[12px] text-ink-muted">{[h.city, h.state_code].filter(Boolean).join(", ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {ids.length === 0 && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
              Or start with
              {EXAMPLES.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => add(e.id)}
                  className="min-h-9 rounded-full border border-border bg-surface-0 px-3 text-[13px] font-medium text-ink hover:border-ink"
                >
                  {e.name}
                </button>
              ))}
            </p>
          )}
        </div>
      )}

      {loading && shown.length === 0 && <p className="mt-4 text-[13px] text-ink-muted">Reading published schedules…</p>}

      {shown.length > 0 && (
        <div className={`mt-5 grid items-start gap-4 ${shown.length > 1 ? "md:grid-cols-2" : ""} ${shown.length > 2 ? "2xl:grid-cols-3" : ""}`}>
          {shown.map((p) => (
            <InstitutionColumn key={p.institution_id} policy={p} features={features} onRemove={() => remove(p.institution_id)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Registry cities arrive in capitals for some credit unions ("VIENNA"). */
function titleCase(city: string | null): string | null {
  if (!city || city !== city.toUpperCase()) return city;
  return city.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function access(p: AccountPolicy): string {
  if (p.branch_count === 0) return "No branches on record; it may serve customers online only.";
  return `${p.branch_count.toLocaleString()} ${p.branch_count === 1 ? "branch" : "branches"} in ${p.branch_states} ${p.branch_states === 1 ? "state" : "states"}.`;
}

function InstitutionColumn({ policy, features, onRemove }: { policy: AccountPolicy; features: CompareFeature[]; onRemove: () => void }) {
  const cu = policy.charter_type === "credit_union";
  return (
    <article className="rounded-xl border border-border bg-surface-0">
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[16px] font-semibold text-ink">{policy.institution_name}</h3>
          <button type="button" onClick={onRemove} className="min-h-9 shrink-0 rounded-full px-2 text-[12px] text-ink-muted hover:text-ink">
            Remove
          </button>
        </div>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          {cu ? "Credit union: you must be eligible to join. Ask who can." : "Bank: no membership needed; account requirements vary."}
        </p>
        <p className="text-[12.5px] text-ink-muted">
          {[titleCase(policy.city), policy.state_code].filter(Boolean).join(", ")}
          {policy.city || policy.state_code ? ". " : ""}
          {access(policy)}
        </p>
      </header>
      <dl className="divide-y divide-border">
        {features.map((f) => (
          <div key={f.feature} className="px-4 py-3">
            <dt className="text-[13px] font-semibold text-ink">{f.feature}</dt>
            <dd className="mt-1">
              <FeatureLines feature={f} lines={f.category ? policy.lines.filter((l) => l.category === f.category) : null} />
            </dd>
          </div>
        ))}
      </dl>
      <Complaints policy={policy} />
    </article>
  );
}

function FeatureLines({ feature, lines }: { feature: CompareFeature; lines: PolicyLine[] | null }) {
  if (lines === null) return <p className="text-[13px] text-ink-muted">Not verified. Ask the institution.</p>;
  if (lines.length === 0) {
    return <p className="text-[13px] text-ink-muted">Not listed in the schedule we hold. Ask the institution.</p>;
  }
  return (
    <ul className="space-y-2">
      {lines.map((l, i) => (
        <li key={i} className="text-[13px] leading-relaxed">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-ink-soft">{l.fee_name}</span>
            <span className="shrink-0 font-semibold tabular-nums text-ink">{formatAmount(l.amount)}</span>
          </span>
          {l.amount === 0 && feature.category === "overdraft" && (
            <span className="block text-[12px] text-ink-muted">
              A $0 line can mean a no-fee service or no overdraft service at all. A no-fee line is not a promise to pay. Ask which.
            </span>
          )}
          {l.conditions && <span className="block text-[12px] text-ink-muted">{l.conditions}</span>}
          <span className="block text-[11.5px] text-ink-muted">
            Read {l.read_on}
            {l.document_url && (
              <>
                {" · "}
                <a href={l.document_url} target="_blank" rel="noopener noreferrer" className="text-brick underline underline-offset-2">
                  Source schedule
                </a>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Complaints({ policy }: { policy: AccountPolicy }) {
  if (policy.complaints.length === 0) {
    return <p className="border-t border-border px-4 py-3 text-[12px] text-ink-muted">We hold no CFPB complaint counts on overdraft or returned payments for this institution.</p>;
  }
  const years = `${policy.complaints[0].from_year} to ${policy.complaints[0].to_year}`;
  return (
    <details className="border-t border-border px-4 py-3">
      <summary className="min-h-9 cursor-pointer text-[13px] font-semibold text-ink">What consumers report, {years}</summary>
      <ul className="mt-2 space-y-1 text-[12.5px] text-ink-soft">
        {policy.complaints.map((c) => (
          <li key={c.issue} className="flex justify-between gap-3">
            <span>{c.issue}</span>
            <span className="tabular-nums">{c.count.toLocaleString()}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11.5px] text-ink-muted">
        Complaints to the CFPB are context, not verified findings, and larger institutions draw more of them.{" "}
        <a href="https://www.consumerfinance.gov/data-research/consumer-complaints/" target="_blank" rel="noopener noreferrer" className="text-brick underline underline-offset-2">
          Read the records and responses
        </a>
      </p>
    </details>
  );
}
