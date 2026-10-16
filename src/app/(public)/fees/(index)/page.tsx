export const dynamic = "force-dynamic";
import { PAGE_HEADER, PAGE_LEDE } from "@/components/public/page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { FEE_FAMILIES, getDisplayName, getSpotlightCategories, TAXONOMY_COUNT } from "@/lib/fee-taxonomy";
import { getFeeDefinition } from "@/lib/fee-definitions";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PRODUCT_NAME, SITE_URL } from "@/lib/constants";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { Logo } from "@/brand/components";
import { getPublicSnapshot } from "@/lib/public-stats";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAllCategories } from "@/lib/access";
import { getFeeRowDetails, type FeeRowDetail } from "@/lib/data-store";
import { getFeeEvidenceEntriesCached, getIndexRowsCached } from "@/lib/data-store/public-cached-reads";
import { FEE_EVIDENCE_MAX_IDS, type FeeEvidence } from "@/lib/data-store/fee-evidence";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { HIGHEST_TIER_CATEGORIES } from "@/lib/data-store/fee-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { ExplorerControls, type FeeOption } from "./explorer-controls";
import { IndexCatalog, type CatalogEntry } from "./index-catalog";
import {
  CHARTER_LABELS,
  companion,
  countedAs,
  findings,
  accountName,
  chargedWhen,
  histogram,
  inBucket,
  institutionsFor,
  listPage,
  money,
  parseListState,
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
  const list = parseListState(params);
  // A name search with no bar picked looks through every institution, not only the median's bar.
  // "bin=all" shows every institution; otherwise the list opens on the median's bar.
  const allBars = params.bin === "all";
  const activeBin = allBars
    ? null
    : sel.bin != null && sel.bin < buckets.length
      ? sel.bin
      : list.q
        ? null
        : medianBin >= 0
          ? medianBin
          : null;
  const listed = activeBin != null ? institutions.filter((i) => inBucket(buckets[activeBin], i.value)) : institutions;
  const shown = listPage(listed, list);
  // Every price each shown institution lists for the fee, so a counted middle value is shown with the prices behind it.
  const shownIds = new Set(shown.rows.map((i) => i.id));
  const pricesOf = new Map<number, typeof rows>();
  for (const r of rows) {
    if (!shownIds.has(r.institution_id)) continue;
    pricesOf.set(r.institution_id, [...(pricesOf.get(r.institution_id) ?? []), r]);
  }
  const priceIds = [...pricesOf.values()].flat().map((r) => r.id);
  // The evidence reader takes up to FEE_EVIDENCE_MAX_IDS ids a call; a page of 50 can list more prices.
  const idChunks: number[][] = [];
  for (let i = 0; i < priceIds.length; i += FEE_EVIDENCE_MAX_IDS) idChunks.push(priceIds.slice(i, i + FEE_EVIDENCE_MAX_IDS));
  const [details, evidence] = await Promise.all([
    getFeeRowDetails(priceIds).catch(() => new Map<number, FeeRowDetail>()),
    Promise.all(idChunks.map((chunk) => getFeeEvidenceEntriesCached(chunk).catch(() => [] as [number, FeeEvidence | null][]))).then(
      (parts) => new Map(parts.flat()),
    ),
  ]);
  const compare = locked ? null : companion(rows, sel);
  const takeaways = locked ? [] : findings(rows, sel, institutions);
  const where = placeName(sel.state);
  const who = CHARTER_LABELS[sel.charter].toLowerCase();
  const counted = countedAs(sel.fee);
  // The search says what it searches: the picked bar's institutions, or all of them.
  const searchLabel =
    activeBin != null ? `Search these ${listed.length.toLocaleString()} institutions` : `Search all ${institutions.length.toLocaleString()} institutions`;
  /** The list's own links keep the selection, the picked bar and the search. */
  const listHref = (extra: Record<string, string>) => {
    const keep: Record<string, string> = {};
    if (activeBin != null) keep.bin = String(activeBin);
    else if (allBars) keep.bin = "all";
    if (list.q && !("q" in extra) && Object.keys(extra).length > 0) keep.q = list.q;
    if (list.all && !("view" in extra)) keep.view = "all";
    return selectionHref(sel, { ...keep, ...extra }, "institutions");
  };

  const feeOptions: FeeOption[] = ALL_FEES.map((key) => ({
    key,
    label: getDisplayName(key),
    family: FAMILY_OF.get(key) ?? "Other",
    locked: !full && !spotlight.has(key),
  }));
  // The explored fee's count is the explorer's own national population (the institutions the chart and
  // list count), so the explorer and the catalog never disagree on one screen.
  if (!locked) coverage.set(sel.fee, institutionsFor(rows, sel.fee, null, "all").length);
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
        <div className={`mx-auto max-w-page px-4 pb-8 pt-8 sm:px-6 sm:pt-12 ${PAGE_HEADER}`}>
          <h1 className="mx-auto max-w-3xl text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:mx-0 sm:text-[48px]">
            What U.S. banks and credit unions charge, fee by fee
          </h1>
          <p className={`mt-3 ${PAGE_LEDE}`}>
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
        {/* The index's own lockup heads the explorer it names (James, Oct 16), centered on phones.
            Height keeps the wordmark above its 16px minimum cap height. */}
        <Logo mark="bank-fee-index-lockup" height={40} className="mx-auto mb-6 block h-9 w-auto sm:mx-0 sm:h-11" />
        <ExplorerControls
          key={`${sel.fee}-${sel.state}-${sel.charter}`}
          fees={feeOptions}
          states={STATES}
          fee={sel.fee}
          state={sel.state}
          charter={sel.charter}
        />
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-[12px] text-ink-muted">
          <p>A state counts the institutions headquartered there, wherever their branches are.</p>
          {!full && (
            <Link href="/subscribe#pro" className={LINK}>
              Full access: all {TAXONOMY_COUNT} categories, peer filters and exports
            </Link>
          )}
        </div>

        {locked ? (
          <div className="mt-6 rounded-2xl border border-border bg-surface-0 p-5 sm:p-6">
            <p className="text-[18px] font-semibold text-ink">{feeLabel} is part of full {PRODUCT_NAME} access</p>
            {getFeeDefinition(sel.fee) && <p className="mt-1 text-[14px] text-ink-soft">{getFeeDefinition(sel.fee)}</p>}
            <p className="mt-3 text-[14px] text-ink-soft">
              {(coverage.get(sel.fee) ?? 0).toLocaleString()} institutions publish it. Full access, part of Hamilton Pro, shows its
              median, spread and the institutions behind it for {who} {sel.state ? `headquartered in ${where}` : "in the U.S."}, the same way as the free
              categories. Your choices above stay as they are.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link href="/subscribe#pro" className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink">
                {PRO_PLANS_NAV.label}
              </Link>
              <Link href={selectionHref({ ...sel, fee: DEFAULT_FEE })} scroll={false} className={`text-[14px] ${LINK}`}>
                Back to {getDisplayName(DEFAULT_FEE)} with the same choices
              </Link>
            </div>
            <p className="mt-5 text-[13px] text-ink-muted">Free to explore with the same choices:</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {[...spotlight].filter((k) => k !== DEFAULT_FEE).slice(0, 6).map((k) => (
                <li key={k}>
                  <Link
                    href={selectionHref({ ...sel, fee: k })}
                    scroll={false}
                    className="inline-flex min-h-9 items-center rounded-full border border-border bg-paper px-3 text-[13px] font-medium text-ink hover:border-ink"
                  >
                    {getDisplayName(k)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <figure className="rounded-2xl border border-border bg-surface-0 p-4 sm:p-6">
                <figcaption>
                  {/* A short name for the figure, with its exact calculation right under it (James, Oct 16). */}
                  <p className="text-[15px] font-semibold text-ink">{sel.state ? where : "U.S."} benchmark</p>
                  <p className="text-[12px] text-ink-muted">
                    {counted.headline} · {feeLabel}, {who} {sel.state ? `headquartered in ${where}` : "in the U.S."}
                  </p>
                  <div aria-live="polite" className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                    <p className="font-mono text-[40px] font-semibold leading-none tabular-nums text-ink">
                      {stats.median_amount != null ? money(stats.median_amount) : "No median"}
                    </p>
                    <p className="text-[14px] text-ink-soft">
                      {stats.median_amount != null && stats.p25_amount != null && stats.p75_amount != null
                        ? `The middle half of ${counted.labels} run ${money(stats.p25_amount)} to ${money(stats.p75_amount)}. `
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
                    median={stats.median_amount}
                    medianBin={medianBin}
                    unit={counted.measure}
                    hrefFor={(i) => selectionHref(sel, { bin: String(i) }, "institutions")}
                    allHref={selectionHref(sel, { bin: "all" }, "institutions")}
                  />
                )}
              </figure>
              {compare && <Companion title={compare.title} groups={compare.groups} unit={counted.labels} />}
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
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="text-[18px] font-semibold text-ink">
                      {activeBin != null
                        ? `${listed.length.toLocaleString()} ${listed.length === 1 ? "institution has a" : "institutions have a"} ${counted.measure} of ${buckets[activeBin].label}`
                        : `${listed.length.toLocaleString()} institutions`}
                    </h3>
                    <p className="mt-1 text-[13px] text-ink-muted">
                      {HIGHEST_TIER_CATEGORIES.has(sel.fee)
                        ? "An institution that lists several prices for this fee, one per account or condition, counts once, at the highest of them."
                        : "An institution that lists several prices for this fee, one per account or condition, counts once, at the median of them, which may not be any price it charges."}{" "}
                      Open a row to see published prices and available account details.
                      {activeBin != null ? (
                        <>
                          {" "}
                          <Link href={selectionHref(sel, { bin: "all" }, "institutions")} scroll={false} className={LINK}>
                            Show all {institutions.length.toLocaleString()}
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <form action="/fees#institutions" className="flex w-full gap-2 sm:w-auto" role="search">
                    <input type="hidden" name="fee" value={sel.fee} />
                    {sel.state && <input type="hidden" name="state" value={sel.state} />}
                    {sel.charter !== "all" && <input type="hidden" name="charter" value={sel.charter} />}
                    {activeBin != null ? (
                      <input type="hidden" name="bin" value={activeBin} />
                    ) : allBars ? (
                      <input type="hidden" name="bin" value="all" />
                    ) : null}
                    {list.all && <input type="hidden" name="view" value="all" />}
                    <label className="min-w-0 flex-1 sm:w-64">
                      <span className="sr-only">{searchLabel}</span>
                      <input
                        type="search"
                        name="q"
                        defaultValue={list.q}
                        placeholder={searchLabel}
                        className="min-h-11 w-full rounded-full border border-ink bg-surface-0 px-4 text-[14px] text-ink placeholder:text-ink-muted"
                      />
                    </label>
                    <button type="submit" className="min-h-11 shrink-0 rounded-full bg-ink px-4 text-[14px] font-semibold text-on-ink">
                      Find
                    </button>
                  </form>
                </div>
                {shown.matching === 0 ? (
                  <p className="mt-3 rounded-2xl border border-border bg-surface-0 p-4 text-[14px] text-ink-soft">
                    No institution here matches &ldquo;{list.q}&rdquo;.{" "}
                    <Link href={listHref({})} scroll={false} className={LINK}>
                      Clear the search
                    </Link>
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-surface-0">
                    {shown.rows.map((i) => (
                      <InstitutionRow
                        key={i.id}
                        inst={i}
                        counted={counted}
                        prices={(pricesOf.get(i.id) ?? []).map((r) => ({
                          id: r.id,
                          amount: r.amount,
                          detail: details.get(r.id) ?? null,
                          evidence: evidence.get(r.id) ?? null,
                        }))}
                      />
                    ))}
                  </ul>
                )}
                {shown.matching > 0 && (
                  <nav aria-label="Institution pages" className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[13px] text-ink-muted">
                    <span>
                      {shown.matching <= shown.perPage
                        ? `${shown.matching.toLocaleString()} ${shown.matching === 1 ? "institution" : "institutions"}, A to Z`
                        : `${((shown.page - 1) * shown.perPage + 1).toLocaleString()} to ${Math.min(shown.page * shown.perPage, shown.matching).toLocaleString()} of ${shown.matching.toLocaleString()}, A to Z`}
                    </span>
                    <span className="flex flex-wrap items-center gap-4">
                      {shown.page > 1 && (
                        <Link href={listHref({ page: String(shown.page - 1) })} scroll={false} className={LINK}>
                          Previous
                        </Link>
                      )}
                      {shown.page < shown.pages && (
                        <Link href={listHref({ page: String(shown.page + 1) })} scroll={false} className={LINK}>
                          Next
                        </Link>
                      )}
                      {!list.all && shown.matching > shown.perPage && (
                        <Link href={listHref({ view: "all" })} scroll={false} className={LINK}>
                          View all {shown.matching.toLocaleString()} matching institutions
                        </Link>
                      )}
                    </span>
                  </nav>
                )}
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
          Open a group to see its fees. Open a fee for what it is and how many institutions publish it.
        </p>
        <div className="mt-6">
          <IndexCatalog entries={catalog} selected={sel.fee} />
        </div>
      </section>

      {/* 4. How the numbers are made */}
      <section className={`mx-auto max-w-page px-4 pt-14 sm:px-6 ${full ? "pb-16" : ""}`}>
        <details className="rounded-2xl border border-border bg-surface-0 p-5">
          <summary className="cursor-pointer text-[15px] font-semibold text-ink">How the Index counts</summary>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[14px] text-ink-soft">
            <li>Every figure is read from an institution&apos;s own published fee schedule, and the Index keeps the document it came from.</li>
            <li>
              Each institution counts once, at the median of the prices it publishes for the fee (the highest, for overdraft). Medians
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
            <Logo mark="bank-fee-index-wordmark" tone="reverse" height={22} className="h-5 w-auto sm:h-6" />
            <h2 id="access-heading" className="mt-5 text-[24px] font-semibold tracking-[-0.02em] sm:text-[32px]">
              All {TAXONOMY_COUNT} fee categories, explored the same way
            </h2>
            <ul className="mt-4 grid gap-3 text-[15px] text-on-ink/85 sm:grid-cols-3">
              <li>The spread, state and charter comparisons and the institution list for all {TAXONOMY_COUNT} categories.</li>
              <li>Peer comparisons by asset size and Fed district.</li>
              <li>Spreadsheet downloads of each comparison, with every fee&apos;s source.</li>
            </ul>
            <Link href="/subscribe#pro" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-paper px-6 text-[15px] font-semibold text-ink">
              {PRO_PLANS_NAV.label}
            </Link>
            <p className="mt-3 text-[13px] text-on-ink/70">
              Full {PRODUCT_NAME} access comes with a Hamilton Pro subscription, the workspace for bank and credit union teams.
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

/** A bar's short axis label: its lower bound, or the open end ("<$5", "$60+"). The full range is the bar's name. */
function barLabel(b: ReturnType<typeof histogram>[number]): string {
  if (b.min == null) return `<${money(Math.round((b.max! + 0.01) * 100) / 100)}`;
  if (b.max == null) return `${money(b.min)}+`;
  return money(b.min);
}

/** The distribution: one bar per price band, each a link to the institutions in it. */
function Histogram({
  buckets,
  activeBin,
  median,
  medianBin,
  unit,
  hrefFor,
  allHref,
}: {
  buckets: ReturnType<typeof histogram>;
  activeBin: number | null;
  median: number | null;
  medianBin: number;
  unit: string;
  hrefFor: (i: number) => string;
  allHref: string;
}) {
  const top = Math.max(...buckets.map((b) => b.total), 1);
  // Every other label when the bars are many, so none truncates; each bar's full range stays its name.
  const step = buckets.length > 8 ? 2 : 1;
  // The median's own place on the price axis: within its bar, by where it falls in the bar's range.
  const n = buckets.length;
  let medianAt: string | null = null;
  if (median != null && medianBin >= 0) {
    const b = buckets[medianBin];
    const frac = b.min != null && b.max != null ? Math.min(Math.max((median - b.min) / (b.max + 0.01 - b.min), 0), 1) : 0.5;
    medianAt = `calc((100% - ${(n - 1) * 4}px) * ${(medianBin + frac) / n} + ${medianBin * 4}px)`;
  }
  return (
    <div className="mt-10">
      <div className="relative">
        <ul className="flex h-52 items-end gap-1 sm:h-64" aria-label={`Institutions by ${unit}`}>
        {buckets.map((b, i) => (
          <li key={b.label} className="relative flex h-full min-w-0 flex-1">
            <Link
              href={hrefFor(i)}
              scroll={false}
              title={`${b.total} institutions with a ${unit} of ${b.label}`}
              aria-label={`${b.total} institutions with a ${unit} of ${b.label}`}
              aria-current={i === activeBin ? "true" : undefined}
              className="group flex h-full w-full flex-col justify-end"
            >
              <span className="relative z-10 mx-auto mb-1 rounded bg-surface-0 px-0.5 text-center font-mono text-[10px] tabular-nums text-ink-muted sm:text-[11px]">{b.total > 0 ? b.total : ""}</span>
              <span
                className={`block w-full rounded-t-md transition-colors ${i === activeBin ? "bg-ink" : "bg-ink/20 group-hover:bg-ink/40"}`}
                style={{ height: `${Math.max((b.total / top) * 100, b.total > 0 ? 2 : 0)}%` }}
              />
            </Link>
          </li>
        ))}
        </ul>
        {medianAt && median != null && (
          <div className="pointer-events-none absolute inset-y-0" style={{ left: medianAt }} aria-hidden="true">
            <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-brick" />
            <span className="absolute -top-6 -translate-x-1/2 whitespace-nowrap rounded-full bg-brick px-2 py-0.5 text-[10px] font-semibold text-on-brick">
              Median {money(median)}
            </span>
          </div>
        )}
      </div>
      <ul className="mt-6 hidden gap-1 text-[11px] tabular-nums text-ink-muted sm:flex" aria-hidden="true">
        {buckets.map((b, i) => (
          <li key={b.label} className="min-w-0 flex-1 text-center">
            {i % step === 0 ? barLabel(b) : ""}
          </li>
        ))}
      </ul>
      <p className="mt-6 flex justify-between text-[11px] tabular-nums text-ink-muted sm:hidden" aria-hidden="true">
        <span>{barLabel(buckets[0])}</span>
        <span>{barLabel(buckets[buckets.length - 1])}</span>
      </p>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 bg-brick" aria-hidden="true" /> Median
        </span>
        {activeBin != null && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-ink" aria-hidden="true" /> Selected:{" "}
            <span className="font-semibold text-ink">{buckets[activeBin].label}</span>
          </span>
        )}
        {activeBin != null && (
          <Link href={allHref} scroll={false} className={LINK}>
            All prices
          </Link>
        )}
      </p>
    </div>
  );
}

/** Round a scale end to a step a reader can read off ($1, $5, $10, $25...). */
function niceStep(span: number): number {
  for (const s of [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]) if (span / s <= 5) return s;
  return 2500;
}

/** The selection's companion view: two groups' medians and middle halves on one labeled scale. */
function Companion({ title, groups, unit }: { title: string; groups: CompareGroup[]; unit: string }) {
  const values = groups.flatMap((g) => [g.stats.p25_amount, g.stats.median_amount, g.stats.p75_amount]).filter((v): v is number => v != null);
  const rawLo = values.length ? Math.min(...values) : 0;
  const rawHi = values.length ? Math.max(...values) : 1;
  const step = niceStep(Math.max(rawHi - rawLo, 1));
  const lo = Math.max(0, Math.floor(rawLo / step) * step - (rawLo % step === 0 ? step : 0));
  const hi = Math.ceil(rawHi / step) * step + (rawHi % step === 0 ? step : 0);
  const pct = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  return (
    <div className="self-start rounded-2xl border border-border bg-surface-0 p-4 sm:p-6">
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      <p className="text-[12px] text-ink-muted">The bar is the middle half of {unit}; the mark is their median.</p>
      <ul className="mt-4 space-y-5">
        {groups.map((g) => {
          const { p25_amount: p25, p75_amount: p75, median_amount: med } = g.stats;
          return (
            <li key={g.label}>
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="font-semibold text-ink">{g.label}</span>
                <span className="font-mono tabular-nums text-ink">{med != null ? `${money(med)} median` : "Too few for a median"}</span>
              </div>
              <div className="relative mt-2 h-3 rounded-full bg-paper" aria-hidden="true">
                {p25 != null && p75 != null && (
                  <span className="absolute inset-y-0 rounded-full bg-ink/25" style={{ left: pct(p25), width: `calc(${pct(p75)} - ${pct(p25)})` }} />
                )}
                {med != null && <span className="absolute inset-y-[-3px] w-1 -translate-x-1/2 rounded-full bg-brick" style={{ left: pct(med) }} />}
              </div>
              {p25 != null && p75 != null && (
                <div className="relative mt-1 h-4 font-mono text-[11px] tabular-nums text-ink-muted" aria-hidden="true">
                  <span className="absolute -translate-x-full pr-1" style={{ left: pct(p25) }}>
                    {money(p25)}
                  </span>
                  <span className="absolute pl-1" style={{ left: pct(p75) }}>
                    {money(p75)}
                  </span>
                </div>
              )}
              <p className="mt-1 text-[12px] text-ink-muted">
                {g.stats.institution_count.toLocaleString()} institutions
                {p25 != null && p75 != null ? `, middle half ${money(p25)} to ${money(p75)}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
      <div className="relative mt-4 h-5 border-t border-control-border font-mono text-[10px] tabular-nums text-ink-muted" aria-hidden="true">
        {ticks.map((t, i) => (
          <span
            key={t}
            className={`absolute top-1 ${i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: pct(t) }}
          >
            {money(t)}
          </span>
        ))}
      </div>
    </div>
  );
}

interface ListedPrice {
  id: number;
  amount: number;
  detail: FeeRowDetail | null;
  /** The schedule's line that prints this price and the account above it; null (or missing) is unverified. */
  evidence: FeeEvidence | null;
}

function InstitutionRow({
  inst,
  prices,
  counted,
}: {
  inst: IndexInstitution;
  prices: ListedPrice[];
  /** How the Index counts the institution: its median published price, or the highest for overdraft. */
  counted: ReturnType<typeof countedAs>;
}) {
  // One entry per distinct price and wording; the same line read twice is one price.
  const seen = new Set<string>();
  const listed = [...prices]
    .sort((a, b) => a.amount - b.amount || a.id - b.id)
    .filter((p) => {
      const k = `${p.amount}|${p.detail?.fee_name ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const amounts = [...new Set(listed.map((p) => p.amount))];
  const lo = amounts[0] ?? inst.value;
  const hi = amounts[amounts.length - 1] ?? inst.value;
  const verified = listed.filter((p) => p.evidence).length;
  const accountOf = (p: ListedPrice) => p.evidence?.heading ?? accountName(p.detail?.account ?? null);
  const named = listed.filter((p) => accountOf(p)).length;
  // A median of an even number of prices is often none of them; say so rather than let it read as a price.
  const notAPrice = amounts.length > 1 && !amounts.includes(inst.value);
  const first = listed[0]?.detail ?? null;
  const readOn = first?.read_on ?? null;
  return (
    <li>
      <details className="px-4 py-3 sm:px-5">
        <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4">
          <span className="min-w-0">
            <span className="font-semibold text-ink">{inst.name}</span>
            <span className="block text-[12px] text-ink-muted">
              {inst.charter === "credit_union" ? "Credit union" : "Bank"}
              {inst.state ? ` · headquartered in ${STATE_NAMES[inst.state] ?? inst.state}` : ""}
              {verified === 0 ? " · not verified" : ""}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-mono text-[15px] tabular-nums text-ink">
              {amounts.length > 1 ? `${money(lo)}–${money(hi)}` : money(inst.value)}
            </span>
            <span className="block text-[11px] text-ink-muted">
              {amounts.length} published {amounts.length === 1 ? "price" : "prices"}
            </span>
            {amounts.length > 1 && (
              <span className="block text-[11px] text-ink-muted">
                {counted.label} {money(inst.value)}
              </span>
            )}
          </span>
        </summary>
        <div className="mt-3 space-y-2 text-[13px] text-ink-soft">
          {amounts.length > 1 && (
            <p className="text-ink-muted">
              Counted once, at {money(inst.value)}, {counted.of} of these prices
              {notAPrice ? "; it isn't one of the published prices." : "."}
            </p>
          )}
          {named === 0 && (
            <p className="text-ink-muted">
              <span className="font-semibold text-ink">Accounts not identified.</span> The Index hasn&apos;t yet matched each price to
              its account in the schedule, so these prices can&apos;t be compared account by account.
            </p>
          )}
          <ul className="divide-y divide-border rounded-xl border border-border bg-paper">
            {listed.map((p) => {
              const d = p.detail;
              const when = chargedWhen(d?.frequency ?? null);
              const account = accountOf(p);
              // The schedule's own waiver wording when it was read; otherwise the condition recorded with the fee.
              const condition = p.evidence?.condition ?? d?.conditions ?? null;
              return (
                <li key={p.id} className="grid gap-x-4 gap-y-0.5 px-3 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <p className="text-ink">
                    <span className="font-mono font-semibold tabular-nums">{money(p.amount)}</span>
                    {when ? <span className="text-ink-muted"> {when}</span> : null}
                  </p>
                  <div className="min-w-0">
                    {(account || named > 0) && (
                      <p className={account ? "font-medium text-ink" : "text-ink-muted"}>{account ?? "Account not stated"}</p>
                    )}
                    {p.evidence ? (
                      <p className="text-[12px] text-ink-muted">
                        &ldquo;{p.evidence.line.replace(/\s*\|\s*/g, " … ").replace(/\s+/g, " ").trim()}&rdquo;
                      </p>
                    ) : (
                      <p className="text-[12px] text-ink-muted">
                        <span className="font-semibold text-ink">Not verified.</span> The schedule&apos;s line
                        {d?.fee_name ? <> (&ldquo;{d.fee_name}&rdquo;)</> : null} doesn&apos;t state {money(p.amount)}.
                      </p>
                    )}
                    {condition && <p className="text-[12px] text-ink-muted">Condition: {condition}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-[12px] text-ink-muted">
            {readOn ? `Read ${READ.format(new Date(`${readOn}T00:00:00Z`))}` : "Read date not recorded"}
            {first?.document_url ? (
              <>
                {" from "}
                <a href={first.document_url} target="_blank" rel="noopener noreferrer" className="underline decoration-border underline-offset-2 hover:decoration-ink">
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
