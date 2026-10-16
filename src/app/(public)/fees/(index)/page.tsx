export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { FEE_FAMILIES, getDisplayName, getSpotlightCategories, TAXONOMY_COUNT } from "@/lib/fee-taxonomy";
import { getFeeDefinition } from "@/lib/fee-definitions";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PRODUCT_NAME, SITE_URL } from "@/lib/constants";
import { getPublicSnapshot } from "@/lib/public-stats";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAllCategories } from "@/lib/access";
import { getFeeRowDetails, type FeeRowDetail } from "@/lib/data-store";
import { getIndexRowsCached } from "@/lib/data-store/public-cached-reads";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { STATE_NAMES } from "@/lib/us-states";
import { ExplorerControls, type FeeOption } from "./explorer-controls";
import { IndexCatalog, type CatalogEntry } from "./index-catalog";
import {
  CHARTER_LABELS,
  companion,
  findings,
  histogram,
  inBucket,
  institutionsFor,
  money,
  parseSelection,
  placeName,
  selectionHref,
  statsFor,
  type CompareGroup,
  type IndexInstitution,
} from "./index-view";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const ALL_FEES = Object.values(FEE_FAMILIES).flat();
const FAMILY_OF = new Map(Object.entries(FEE_FAMILIES).flatMap(([family, keys]) => keys.map((k) => [k, family] as const)));
const DEFAULT_FEE = "overdraft";
/** Institutions listed under the chart before the reader narrows the selection. */
const LIST_MAX = 30;
/** The 50 states and DC, for the geography control. */
const STATES = Object.entries(STATE_NAMES)
  .filter(([code]) => !["PR", "VI", "GU", "AS"].includes(code))
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

const H2 = "text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[28px]";
const LINK = "font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink";
const READ = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const sel = parseSelection(params, new Set(ALL_FEES), DEFAULT_FEE);
  const picked = typeof params.fee === "string";
  return {
    title: picked
      ? `${getDisplayName(sel.fee)} Fees${sel.state ? ` in ${STATE_NAMES[sel.state]}` : ""}: the ${PRODUCT_NAME}`
      : `The ${PRODUCT_NAME}: What U.S. Banks and Credit Unions Charge`,
    description:
      "Explore what banks and credit unions charge, fee by fee, read from their own published schedules: medians, the full spread, state and charter comparisons, and the institutions behind every figure.",
    alternates: { canonical: "/fees" },
  };
}

export default async function BankFeeIndexPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const [user, { summary, categories }] = await Promise.all([getCurrentUser(), getPublicSnapshot()]);
  const full = canAccessAllCategories(user);
  const spotlight = new Set(getSpotlightCategories());
  const coverage = new Map(categories.map((c) => [c.fee_category, c.institution_count]));
  const sel = parseSelection(params, new Set(ALL_FEES), DEFAULT_FEE);
  const locked = !full && !spotlight.has(sel.fee);
  const feeLabel = getDisplayName(sel.fee);

  const rows = locked ? [] : await getIndexRowsCached(sel.fee).catch(() => []);
  const institutions = institutionsFor(rows, sel.fee, sel.state, sel.charter);
  const stats = statsFor(rows, sel.fee, sel.state, sel.charter);
  const buckets = histogram(institutions);
  const medianBin = stats.median_amount != null ? buckets.findIndex((b) => inBucket(b, stats.median_amount!)) : -1;
  const activeBin = sel.bin != null && sel.bin < buckets.length ? sel.bin : medianBin >= 0 ? medianBin : null;
  const listed = activeBin != null ? institutions.filter((i) => inBucket(buckets[activeBin], i.value)) : institutions;
  const visible = [...listed].sort((a, b) => a.name.localeCompare(b.name)).slice(0, LIST_MAX);
  const details = await getFeeRowDetails(visible.map((i) => i.row.id)).catch(() => new Map<number, FeeRowDetail>());
  const compare = locked ? null : companion(rows, sel);
  const takeaways = locked ? [] : findings(rows, sel, institutions);
  const where = placeName(sel.state);
  const who = CHARTER_LABELS[sel.charter].toLowerCase();

  const feeOptions: FeeOption[] = ALL_FEES.map((key) => ({
    key,
    label: getDisplayName(key),
    family: FAMILY_OF.get(key) ?? "Other",
    locked: !full && !spotlight.has(key),
  }));
  // The explored fee's count comes from the explorer's own read, so the two never disagree on one screen.
  if (!locked) coverage.set(sel.fee, statsFor(rows, sel.fee, null, "all").institution_count);
  const catalog: CatalogEntry[] = ALL_FEES.map((key) => {
    const n = coverage.get(key) ?? 0;
    return {
      key,
      label: getDisplayName(key),
      family: FAMILY_OF.get(key) ?? "Other",
      definition: getFeeDefinition(key),
      institutions: n,
      status: n < MIN_INSTITUTIONS_FOR_MEDIAN ? "limited" : full || spotlight.has(key) ? "public" : "full",
      href: selectionHref({ fee: key, state: null, charter: "all" }),
    };
  });

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: SITE_URL },
          { name: PRODUCT_NAME, href: `${SITE_URL}/fees` },
        ]}
      />

      {/* 1. What the Index is */}
      <section className="border-b border-border bg-paper">
        <div className="mx-auto max-w-page px-4 pb-8 pt-8 sm:px-6 sm:pt-12">
          <p className="inline-flex items-center rounded-full border border-brick/40 px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-brick">
            The {PRODUCT_NAME}
          </p>
          <h1 className="mt-4 max-w-3xl text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[48px]">
            What U.S. banks and credit unions charge, fee by fee
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] text-ink-soft">
            Read from {summary.institutionsLabel} institutions&apos; own published schedules across {TAXONOMY_COUNT} fee
            categories, with a source behind every figure. {summary.freshnessLabel}.
          </p>
        </div>
      </section>

      {/* 2. The explorer */}
      <section id="explorer" aria-labelledby="explorer-heading" className="mx-auto max-w-page scroll-mt-20 px-4 pt-8 sm:px-6 sm:pt-10">
        <h2 id="explorer-heading" className="sr-only">
          Explore the {PRODUCT_NAME}
        </h2>
        <ExplorerControls
          key={`${sel.fee}-${sel.state}-${sel.charter}`}
          fees={feeOptions}
          states={STATES}
          fee={sel.fee}
          state={sel.state}
          charter={sel.charter}
        />

        {locked ? (
          <div className="mt-6 rounded-2xl border border-border bg-surface-0 p-6">
            <p className="text-[18px] font-semibold text-ink">{feeLabel} is part of full access</p>
            {getFeeDefinition(sel.fee) && <p className="mt-1 text-[14px] text-ink-soft">{getFeeDefinition(sel.fee)}</p>}
            <p className="mt-3 text-[14px] text-ink-soft">
              {(coverage.get(sel.fee) ?? 0).toLocaleString()} institutions publish it. Its median, spread, state and charter
              comparisons and the institutions behind them open with full access.
            </p>
            <Link href="/subscribe#pro" className="mt-4 inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink">
              Get full {PRODUCT_NAME} access
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <figure className="rounded-2xl border border-border bg-surface-0 p-4 sm:p-6">
                <figcaption>
                  <p className="text-[13px] text-ink-muted">
                    {feeLabel}, {who} in {where}
                  </p>
                  <div aria-live="polite" className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                    <p className="font-mono text-[40px] font-semibold leading-none tabular-nums text-ink">
                      {stats.median_amount != null ? money(stats.median_amount) : "No median"}
                    </p>
                    <p className="text-[14px] text-ink-soft">
                      {stats.median_amount != null && stats.p25_amount != null && stats.p75_amount != null
                        ? `Median. The middle half charge ${money(stats.p25_amount)} to ${money(stats.p75_amount)}. `
                        : `Fewer than ${MIN_INSTITUTIONS_FOR_MEDIAN} institutions publish it here. `}
                      <span className="font-semibold text-ink">{institutions.length.toLocaleString()}</span>{" "}
                      {institutions.length === 1 ? "institution" : "institutions"}.
                    </p>
                  </div>
                </figcaption>
                {buckets.length > 0 && (
                  <Histogram
                    buckets={buckets}
                    activeBin={activeBin}
                    medianBin={medianBin}
                    hrefFor={(i) => selectionHref(sel, { bin: String(i) }, "institutions")}
                  />
                )}
              </figure>
              {compare && <Companion title={compare.title} groups={compare.groups} />}
            </div>

            {takeaways.length > 0 && (
              <ul className="mt-6 grid gap-3 sm:grid-cols-3">
                {takeaways.map((t) => (
                  <li key={t} className="rounded-2xl border border-border bg-paper p-4 text-[14px] text-ink">
                    {t}
                  </li>
                ))}
              </ul>
            )}

            {institutions.length > 0 && (
              <div id="institutions" className="mt-8 scroll-mt-20">
                <h3 className="text-[18px] font-semibold text-ink">
                  {activeBin != null
                    ? `${listed.length.toLocaleString()} ${listed.length === 1 ? "institution charges" : "institutions charge"} ${buckets[activeBin].label}`
                    : `${listed.length.toLocaleString()} institutions`}
                </h3>
                <p className="mt-1 text-[13px] text-ink-muted">
                  Pick a bar to see who charges that price. Open a row for the fee in its schedule&apos;s words, its conditions and
                  its source.
                  {listed.length > LIST_MAX ? ` Showing ${LIST_MAX} of ${listed.length.toLocaleString()}, A to Z; pick a state to narrow it.` : ""}
                </p>
                <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-surface-0">
                  {visible.map((i) => (
                    <InstitutionRow key={i.id} inst={i} detail={details.get(i.row.id) ?? null} />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      {/* 3. Every category */}
      <section aria-labelledby="catalog-heading" className="mx-auto max-w-page px-4 pt-14 sm:px-6 sm:pt-20">
        <h2 id="catalog-heading" className={H2}>
          Every category in the Index
        </h2>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-soft">
          What each fee is and how many institutions publish it. Pick one to explore it above.
        </p>
        <div className="mt-6">
          <IndexCatalog entries={catalog} />
        </div>
      </section>

      {/* 4. How the numbers are made */}
      <section className={`mx-auto max-w-page px-4 pt-14 sm:px-6 ${full ? "pb-16" : ""}`}>
        <details className="rounded-2xl border border-border bg-surface-0 p-5">
          <summary className="cursor-pointer text-[15px] font-semibold text-ink">How the Index counts</summary>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[14px] text-ink-soft">
            <li>Every figure is read from an institution&apos;s own published fee schedule, and we keep the document it came from.</li>
            <li>
              Each institution counts once, at the middle of the prices it lists for the fee (the highest, for overdraft). Medians
              and the middle half are taken across institutions, and a median needs at least {MIN_INSTITUTIONS_FOR_MEDIAN}.
            </li>
            <li>
              Fees from schedules for business accounts are left out. Fees from schedules that don&apos;t say who they&apos;re for
              are counted with personal accounts.
            </li>
            <li>A fee stated as a percentage, such as a foreign transaction fee of 1%, is kept apart from dollar amounts.</li>
          </ul>
          <p className="mt-3 text-[13px]">
            <Link href="/methodology" className={LINK}>
              Read the full method
            </Link>
          </p>
        </details>
      </section>

      {/* 5. Access */}
      {!full && (
        <section aria-labelledby="access-heading" className="mx-auto max-w-page px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
          <div className="rounded-2xl bg-ink p-6 text-on-ink sm:p-10">
            <h2 id="access-heading" className="text-[24px] font-semibold tracking-[-0.02em] sm:text-[32px]">
              Every category, explored the same way
            </h2>
            <ul className="mt-4 grid gap-3 text-[15px] text-on-ink/85 sm:grid-cols-3">
              <li>The spread, state and charter comparisons and the institutions behind every category, not only the headline fees.</li>
              <li>Peer comparisons by asset size and Fed district.</li>
              <li>Peer comparisons downloaded as spreadsheets, with each fee&apos;s source.</li>
            </ul>
            <Link href="/subscribe#pro" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-paper px-6 text-[15px] font-semibold text-ink">
              Get full {PRODUCT_NAME} access
            </Link>
            <p className="mt-3 text-[13px] text-on-ink/70">
              Full access comes with a Hamilton Pro subscription, the workspace for bank and credit union teams.
            </p>
          </div>
        </section>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Dataset",
            name: `The ${PRODUCT_NAME}`,
            description: "What U.S. banks and credit unions charge, fee by fee, read from their published fee schedules.",
            url: `${SITE_URL}/fees`,
          }).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}

/** A bar's short axis label: its lower bound, or the open end. */
function barLabel(b: ReturnType<typeof histogram>[number]): string {
  if (b.min == null) return `Under ${money(Math.round((b.max! + 0.01) * 100) / 100)}`;
  if (b.max == null) return `${money(b.min)}+`;
  return money(b.min);
}

/** The distribution: one bar per price band, each a link to the institutions in it. */
function Histogram({
  buckets,
  activeBin,
  medianBin,
  hrefFor,
}: {
  buckets: ReturnType<typeof histogram>;
  activeBin: number | null;
  medianBin: number;
  hrefFor: (i: number) => string;
}) {
  const top = Math.max(...buckets.map((b) => b.total), 1);
  return (
    <div className="mt-5">
      <ul className="flex h-52 items-end gap-1 sm:h-64" aria-label="Institutions by price">
        {buckets.map((b, i) => (
          <li key={b.label} className="relative flex h-full min-w-0 flex-1">
            <Link
              href={hrefFor(i)}
              scroll={false}
              aria-label={`${b.label}: ${b.total} institutions`}
              aria-current={i === activeBin ? "true" : undefined}
              className="group flex h-full w-full flex-col justify-end"
            >
              <span className="mb-1 text-center font-mono text-[10px] tabular-nums text-ink-muted sm:text-[11px]">{b.total > 0 ? b.total : ""}</span>
              <span
                className={`block w-full rounded-t-md transition-colors ${i === activeBin ? "bg-brick" : "bg-ink/25 group-hover:bg-ink/45"}`}
                style={{ height: `${Math.max((b.total / top) * 100, b.total > 0 ? 2 : 0)}%` }}
              />
            </Link>
            {i === medianBin && (
              <span className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-brick">Median</span>
            )}
          </li>
        ))}
      </ul>
      <ul className="mt-6 hidden gap-1 text-[11px] tabular-nums text-ink-muted sm:flex" aria-hidden="true">
        {buckets.map((b) => (
          <li key={b.label} className="min-w-0 flex-1 truncate text-center">
            {barLabel(b)}
          </li>
        ))}
      </ul>
      <p className="mt-6 flex justify-between text-[11px] tabular-nums text-ink-muted sm:hidden" aria-hidden="true">
        <span>{barLabel(buckets[0])}</span>
        <span>{barLabel(buckets[buckets.length - 1])}</span>
      </p>
    </div>
  );
}

/** The selection's companion view: two groups' medians and middle halves on one scale. */
function Companion({ title, groups }: { title: string; groups: CompareGroup[] }) {
  const top = Math.max(...groups.map((g) => g.stats.p75_amount ?? g.stats.median_amount ?? 0), 1) * 1.1;
  const pct = (v: number) => `${(v / top) * 100}%`;
  return (
    <div className="rounded-2xl border border-border bg-surface-0 p-4 sm:p-6">
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      <p className="text-[12px] text-ink-muted">Median, with the middle half shaded.</p>
      <ul className="mt-4 space-y-5">
        {groups.map((g) => (
          <li key={g.label}>
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="font-semibold text-ink">{g.label}</span>
              <span className="font-mono tabular-nums text-ink">{g.stats.median_amount != null ? money(g.stats.median_amount) : "Too few"}</span>
            </div>
            <div className="relative mt-2 h-3 rounded-full bg-paper" aria-hidden="true">
              {g.stats.p25_amount != null && g.stats.p75_amount != null && (
                <span
                  className="absolute inset-y-0 rounded-full bg-ink/20"
                  style={{ left: pct(g.stats.p25_amount), width: pct(g.stats.p75_amount - g.stats.p25_amount) }}
                />
              )}
              {g.stats.median_amount != null && (
                <span className="absolute inset-y-[-3px] w-1 rounded-full bg-brick" style={{ left: pct(g.stats.median_amount) }} />
              )}
            </div>
            <p className="mt-1 text-[12px] text-ink-muted">
              {g.stats.institution_count.toLocaleString()} institutions
              {g.stats.p25_amount != null && g.stats.p75_amount != null
                ? `, middle half ${money(g.stats.p25_amount)} to ${money(g.stats.p75_amount)}`
                : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InstitutionRow({ inst, detail }: { inst: IndexInstitution; detail: FeeRowDetail | null }) {
  const readOn = detail?.read_on ?? null;
  return (
    <li>
      <details className="px-4 py-3 sm:px-5">
        <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4">
          <span className="min-w-0">
            <span className="font-semibold text-ink">{inst.name}</span>
            <span className="block text-[12px] text-ink-muted">
              {inst.charter === "credit_union" ? "Credit union" : "Bank"}
              {inst.state ? ` · ${STATE_NAMES[inst.state] ?? inst.state}` : ""}
            </span>
          </span>
          <span className="shrink-0 font-mono text-[15px] tabular-nums text-ink">{money(inst.value)}</span>
        </summary>
        <div className="mt-2 space-y-1 text-[13px] text-ink-soft">
          {detail?.fee_name && <p>&ldquo;{detail.fee_name}&rdquo;</p>}
          {detail?.conditions && <p className="text-ink-muted">{detail.conditions}</p>}
          <p className="text-[12px] text-ink-muted">
            {readOn ? `Read ${READ.format(new Date(`${readOn}T00:00:00Z`))}` : "Read date not recorded"}
            {detail?.document_url ? (
              <>
                {" from "}
                <a href={detail.document_url} target="_blank" rel="noopener noreferrer" className="underline decoration-border underline-offset-2 hover:decoration-ink">
                  its fee schedule
                </a>
              </>
            ) : null}
            {" · "}
            <Link href={`/institution/${inst.id}`} className="underline decoration-border underline-offset-2 hover:decoration-ink">
              All its fees
            </Link>
          </p>
        </div>
      </details>
    </li>
  );
}
