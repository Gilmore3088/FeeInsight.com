export const dynamic = "force-dynamic";
import { PAGE_HEADER, PAGE_LEDE } from "@/components/public/page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BarChart3, Building2, Lightbulb, Map as MapIcon, X } from "lucide-react";
import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";
import { getFeeDefinition } from "@/lib/fee-definitions";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PRODUCT_NAME, SITE_URL } from "@/lib/constants";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { Logo } from "@/brand/components";
import { InfoTip } from "@/components/public/info-tip";
import { getPublicFeeTypes, getPublicSnapshot } from "@/lib/public-stats";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAllCategories } from "@/lib/access";
import { getFeeRowDetails, type FeeRowDetail } from "@/lib/data-store";
import { getFeeEvidenceEntriesCached, getIndexRowsCached } from "@/lib/data-store/public-cached-reads";
import { FEE_EVIDENCE_MAX_IDS, type FeeEvidence } from "@/lib/data-store/fee-evidence";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { HIGHEST_TIER_CATEGORIES } from "@/lib/data-store/fee-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { US_STATES } from "@/lib/us-map-paths";
import { ExplorerControls, type FeeOption } from "./explorer-controls";
import { IndexCatalog, type CatalogEntry } from "./index-catalog";
import {
  bandBreakdown,
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
  parseStateView,
  placeName,
  selectionHref,
  stateCells,
  stateRanking,
  statsFor,
  type CompareGroup,
  type IndexInstitution,
  type StateBand,
  type StateRank,
  type StateView,
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
  const sel = parseSelection(params, await getPublicFeeTypes(), DEFAULT_FEE);
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
  const [user, { summary, categories }, publicTypes] = await Promise.all([getCurrentUser(), getPublicSnapshot(), getPublicFeeTypes()]);
  // The public site lists the top 50 fee types by institution count (James, Oct 17 2026).
  const publicFees = ALL_FEES.filter((key) => publicTypes.has(key));
  const typeCount = publicFees.length;
  const familyCount = new Set(publicFees.map((key) => FAMILY_OF.get(key) ?? "Other")).size;
  // Hamilton subscribers already have the workspace, so the closing Hamilton band is for everyone else.
  const subscriber = canAccessAllCategories(user);
  const coverage = new Map(categories.map((c) => [c.fee_category, c.institution_count]));
  const sel = parseSelection(params, new Set(publicFees), DEFAULT_FEE);
  const feeLabel = getDisplayName(sel.fee);

  // Every category's median, spread, institutions and sources are free (James, Oct 18 /fees audit:
  // "sell analytical depth, not access to basic facts"). Hamilton sells the investigation.
  const rows = await getIndexRowsCached(sel.fee).catch(() => []);
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
  const compare = companion(rows, sel);
  const takeaways = findings(rows, sel, institutions);
  const usStats = sel.state ? statsFor(rows, sel.fee, null, sel.charter) : stats;
  const cells = stateCells(rows, sel.fee, sel.charter);
  const stateView = parseStateView(params);
  const ranking = stateRanking(cells, usStats.median_amount);
  const picked = sel.state ? ranking.find((r) => r.code === sel.state) ?? null : null;
  const band = activeBin != null ? bandBreakdown(listed) : null;
  // The single most common counted value and its share, for the KPI strip.
  const common = (() => {
    if (institutions.length < MIN_INSTITUTIONS_FOR_MEDIAN) return null;
    const counts = new Map<number, number>();
    for (const i of institutions) counts.set(i.value, (counts.get(i.value) ?? 0) + 1);
    const [value, n] = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0];
    return { value, share: Math.round((n / institutions.length) * 100) };
  })();
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

  const feeOptions: FeeOption[] = publicFees.map((key) => ({
    key,
    label: getDisplayName(key),
    family: FAMILY_OF.get(key) ?? "Other",
    locked: false,
  }));
  // The explored fee's count is the explorer's own national population (the institutions the chart and
  // list count), so the explorer and the catalog never disagree on one screen.
  coverage.set(sel.fee, institutionsFor(rows, sel.fee, null, "all").length);
  const catalog: CatalogEntry[] = publicFees.map((key) => {
    const n = coverage.get(key) ?? 0;
    return {
      key,
      label: getDisplayName(key),
      family: FAMILY_OF.get(key) ?? "Other",
      definition: getFeeDefinition(key),
      institutions: n,
      status: n < MIN_INSTITUTIONS_FOR_MEDIAN ? "limited" : "public",
      // A new fee keeps the place and charter already picked, so the reader never starts over.
      href: selectionHref({ fee: key, state: sel.state, charter: sel.charter }),
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

      {/* 1. What the Index is, and the ways in (James, Oct 18 /fees audit: an overview, then pathways). */}
      <section className="border-b border-border bg-paper">
        <div className={`mx-auto max-w-page px-4 pb-8 pt-8 sm:px-6 sm:pt-12 ${PAGE_HEADER}`}>
          <Logo mark="bank-fee-index-lockup" height={40} className="mx-auto block h-8 w-auto sm:mx-0 sm:h-10" />
          <h1 className="mx-auto mt-5 max-w-3xl text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:mx-0 sm:text-[48px]">
            Explore what U.S. banks and credit unions charge
          </h1>
          <p className={`mt-3 ${PAGE_LEDE}`}>
            Every figure is read from an institution&apos;s own published fee schedule, and every one links back to it.
          </p>
          <dl className="mx-auto mt-6 grid max-w-[34rem] grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border text-left sm:mx-0 sm:max-w-none sm:grid-cols-4">
            {[
              { term: "Institutions", value: summary.institutionsLabel },
              { term: "Fee categories", value: typeCount.toLocaleString() },
              { term: "Fee groups", value: familyCount.toLocaleString() },
              { term: "Data updated (U.S. Eastern)", value: summary.refreshedOn ?? "Pending" },
            ].map((m) => (
              <div key={m.term} className="bg-surface-0 px-4 py-3">
                <dt className="text-[12px] text-ink-muted">{m.term}</dt>
                <dd className="font-mono text-[20px] font-semibold tabular-nums text-ink sm:text-[24px]">{m.value}</dd>
              </div>
            ))}
          </dl>
          <nav aria-label="Ways into the Index" className="mt-4 grid grid-cols-2 gap-3 text-left lg:grid-cols-4">
            {[
              { href: "#explorer", icon: BarChart3, title: "Fee pricing", line: "Medians, spread and the institutions behind them" },
              { href: "#states", icon: MapIcon, title: "States", line: "Every state against the U.S. median" },
              { href: "/institutions", icon: Building2, title: "Institutions", line: "One institution's published fees and sources" },
              { href: "/research", icon: Lightbulb, title: "Research", line: "State, district and national findings" },
            ].map(({ href, icon: Icon, title, line }) => (
              <Link
                key={title}
                href={href}
                className="group flex min-h-11 items-start gap-2 rounded-2xl border border-border bg-surface-0 p-3 transition-colors hover:border-ink sm:gap-3 sm:p-4"
              >
                <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-ink" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-ink">{title}</span>
                  <span className="hidden text-[13px] text-ink-muted sm:block">{line}</span>
                </span>
                <ArrowRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
              </Link>
            ))}
          </nav>
        </div>
      </section>

      {/* One bar for the whole workspace: the sections, and every filter in force, each removable. */}
      <div className="sticky top-[57px] z-30 border-b border-border bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 sm:px-6">
          <nav aria-label="Index sections" className="flex gap-1 text-[14px]">
            {[
              { href: "#explorer", label: "Pricing" },
              { href: "#states", label: "States" },
              { href: "#institutions", label: "Institutions" },
              { href: "#catalog", label: "Categories" },
            ].map((s) => (
              <a key={s.href} href={s.href} className="inline-flex min-h-9 items-center rounded-full px-3 font-medium text-ink hover:bg-surface-200">
                {s.label}
              </a>
            ))}
          </nav>
          <ul aria-label="Filters in force" className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px]">
            <li className="inline-flex min-h-8 items-center rounded-full bg-ink px-3 font-semibold text-on-ink">{feeLabel}</li>
            {[
              sel.state ? { label: where, clear: selectionHref({ ...sel, state: null }) } : null,
              sel.charter !== "all" ? { label: CHARTER_LABELS[sel.charter], clear: selectionHref({ ...sel, charter: "all" }) } : null,
              activeBin != null && sel.bin != null ? { label: buckets[activeBin].label, clear: selectionHref(sel, { bin: "all" }, "institutions") } : null,
            ]
              .filter((f): f is { label: string; clear: string } => f != null)
              .map((f) => (
                <li key={f.label}>
                  <Link
                    href={f.clear}
                    scroll={false}
                    aria-label={`Remove ${f.label}`}
                    className="inline-flex min-h-8 items-center gap-1 rounded-full border border-ink bg-surface-0 pl-3 pr-2 text-ink hover:bg-surface-200"
                  >
                    {f.label}
                    <X aria-hidden="true" className="h-3.5 w-3.5" />
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      </div>

      {/* 2. The explorer */}
      <section id="explorer" aria-labelledby="explorer-heading" className="mx-auto max-w-page scroll-mt-32 px-4 pt-8 sm:px-6 sm:pt-10">
        <h2 id="explorer-heading" className={H2}>
          {feeLabel} {sel.state ? `in ${where}` : "across the U.S."}
        </h2>
        <p className="mt-1 text-[14px] text-ink-muted">
          {counted.headline} · {who} {sel.state ? `headquartered in ${where}` : "in the U.S."}
        </p>
        <div className="mt-5">
          <ExplorerControls
            key={`${sel.fee}-${sel.state}-${sel.charter}`}
            fees={feeOptions}
            states={STATES}
            fee={sel.fee}
            state={sel.state}
            charter={sel.charter}
          />
        </div>
        <p className="mt-2 text-[12px] text-ink-muted">A state counts the institutions headquartered there, wherever their branches are.</p>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <figure className="rounded-2xl border border-border bg-surface-0 p-4 sm:p-6">
            <figcaption>
              <dl aria-live="polite" className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <Kpi term="Median" value={stats.median_amount != null ? money(stats.median_amount) : "No median"} strong />
                <Kpi
                  term="Middle 50%"
                  value={stats.p25_amount != null && stats.p75_amount != null && stats.median_amount != null ? `${money(stats.p25_amount)}–${money(stats.p75_amount)}` : "—"}
                />
                <Kpi term="Institutions" value={institutions.length.toLocaleString()} />
                <Kpi term={common ? `At exactly ${money(common.value)}` : "Most common"} value={common ? `${common.share}%` : "—"} />
              </dl>
              {stats.median_amount == null && (
                <p className="mt-2 text-[13px] text-ink-soft">Fewer than {MIN_INSTITUTIONS_FOR_MEDIAN} institutions publish it here, too few for a median.</p>
              )}
              {/* Why a category has fewer institutions: schedules not read yet, against schedules that don't list the fee. */}
              {!sel.state && sel.charter === "all" && summary.institutions > 0 && (
                <p className="mt-3 text-[12px] text-ink-muted">
                  {institutions.length.toLocaleString()} of the {summary.institutionsLabel} institutions with a schedule read publish this fee.
                  {summary.monitored > summary.institutions ? ` Another ${(summary.monitored - summary.institutions).toLocaleString()} are tracked but have no schedule read yet.` : ""}
                </p>
              )}
            </figcaption>
            {buckets.length > 0 && (
              <Histogram
                buckets={buckets}
                activeBin={activeBin}
                median={stats.median_amount}
                medianBin={medianBin}
                p25={stats.p25_amount}
                p75={stats.p75_amount}
                unit={counted.measure}
                hrefFor={(i) => selectionHref(sel, { bin: String(i) }, "institutions")}
                allHref={selectionHref(sel, { bin: "all" }, "institutions")}
              />
            )}
          </figure>
          <Companion title={compare.title} groups={compare.groups} unit={counted.labels} />
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
          <div id="institutions" className="mt-8 scroll-mt-32">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-[18px] font-semibold text-ink">
                  {activeBin != null
                    ? `${listed.length.toLocaleString()} ${listed.length === 1 ? "institution has a" : "institutions have a"} ${counted.measure} of ${buckets[activeBin].label}`
                    : `${listed.length.toLocaleString()} institutions`}
                </h3>
                <p className="mt-1 text-[13px] text-ink-muted">
                  {HIGHEST_TIER_CATEGORIES.has(sel.fee)
                    ? "Each institution counts once, at the highest price it publishes for this fee."
                    : "Each institution counts once, at the median of the prices it publishes for this fee."}{" "}
                  Open a row for its prices and the schedule lines behind them.
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
            {band && activeBin != null && listed.length > 0 && (
              <BandBreakdown
                label={buckets[activeBin].label}
                band={band}
                total={listed.length}
                charterHref={(c) => selectionHref({ ...sel, charter: c }, {}, "explorer")}
                stateHref={(code) => selectionHref({ ...sel, state: code }, {}, "explorer")}
              />
            )}
            {shown.matching === 0 ? (
              <p className="mt-3 rounded-2xl border border-border bg-surface-0 p-4 text-[14px] text-ink-soft">
                {list.q ? (
                  <>
                    No institution here matches &ldquo;{list.q}&rdquo;.{" "}
                    <Link href={listHref({})} scroll={false} className={LINK}>
                      Clear the search
                    </Link>
                  </>
                ) : (
                  <>
                    No institution publishes a price in this range.{" "}
                    <Link href={selectionHref(sel, {}, "explorer")} scroll={false} className={LINK}>
                      See every price
                    </Link>
                  </>
                )}
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

        {/* The free answer, then the question only Hamilton answers (James, Oct 18: "Want to know how your institution compares?"). */}
        {!subscriber && usStats.median_amount != null && (
          <aside aria-labelledby="compare-heading" className="mt-8 grid gap-5 rounded-2xl border border-ink bg-surface-0 p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] sm:p-6">
            <dl className="grid grid-cols-2 gap-4 sm:border-r sm:border-border sm:pr-6">
              <div className="col-span-2">
                <dt className="sr-only">Fee</dt>
                <dd className="text-[15px] font-semibold text-ink">{feeLabel}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-muted">U.S. median</dt>
                <dd className="font-mono text-[24px] font-semibold tabular-nums text-ink">{money(usStats.median_amount)}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-muted">Publishing institutions</dt>
                <dd className="font-mono text-[24px] font-semibold tabular-nums text-ink">{usStats.institution_count.toLocaleString()}</dd>
              </div>
            </dl>
            <div>
              <h3 id="compare-heading" className="text-[18px] font-semibold text-ink">
                Want to know how your institution compares?
              </h3>
              <p className="mt-1 text-[14px] text-ink-soft">
                Build a competitive peer group, set this fee against financial performance, and get a source-backed analysis in Hamilton.
              </p>
              <Link href={PRO_PLANS_NAV.href} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink">
                Explore Hamilton <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </aside>
        )}
      </section>

      {/* 3. Every state on one map, for the same fee and charter */}
      <section id="states" aria-labelledby="states-heading" className="mx-auto max-w-page scroll-mt-32 px-4 pt-14 sm:px-6 sm:pt-20">
        <h2 id="states-heading" className={H2}>
          {feeLabel} by state
        </h2>
        <p className="mt-1 text-[14px] text-ink-muted">
          U.S. median {usStats.median_amount != null ? money(usStats.median_amount) : "not available"} · {who}, by headquarters. Pick a state to filter the whole page to it.
        </p>
        <nav aria-label="State view" className="mt-4 inline-flex rounded-full border border-border bg-surface-0 p-1 text-[13px]">
          {(
            [
              { view: "gap", label: "Against the U.S. median" },
              { view: "price", label: "State median" },
            ] as { view: StateView; label: string }[]
          ).map((v) => (
            <Link
              key={v.view}
              href={selectionHref(sel, v.view === "price" ? { sv: "price" } : {}, "states")}
              scroll={false}
              aria-current={stateView === v.view ? "true" : undefined}
              className={`inline-flex min-h-9 items-center rounded-full px-3 font-medium ${stateView === v.view ? "bg-ink text-on-ink" : "text-ink hover:bg-surface-200"}`}
            >
              {v.label}
            </Link>
          ))}
        </nav>
        {picked && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink bg-surface-0 p-4">
            <p className="text-[15px] text-ink">
              <span className="font-semibold">{STATE_NAMES[picked.code]}</span>{" "}
              {picked.median != null
                ? `${money(picked.median)} median, ${gapText(picked.gap)}, ${picked.institutions.toLocaleString()} institutions`
                : `${picked.institutions.toLocaleString()} ${picked.institutions === 1 ? "institution" : "institutions"}, too few for a median`}
            </p>
            <p className="flex flex-wrap gap-4 text-[14px]">
              <a href="#explorer" className={LINK}>
                Its prices
              </a>
              <a href="#institutions" className={LINK}>
                Its institutions
              </a>
              <Link href={selectionHref({ ...sel, state: null }, stateView === "price" ? { sv: "price" } : {}, "states")} scroll={false} className={LINK}>
                Back to the U.S.
              </Link>
            </p>
          </div>
        )}
        <StateMap
          ranking={ranking}
          us={usStats.median_amount}
          view={stateView}
          selected={sel.state}
          hrefFor={(code) => selectionHref({ ...sel, state: code }, stateView === "price" ? { sv: "price" } : {}, "states")}
          feeLabel={feeLabel}
        />
      </section>

      {/* 4. Every category */}
      <section id="catalog" aria-labelledby="catalog-heading" className="mx-auto max-w-page scroll-mt-32 px-4 pt-14 sm:px-6 sm:pt-20">
        <h2 id="catalog-heading" className={H2}>
          Every category in the Index
        </h2>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-soft">
          Pick any fee to explore it {sel.state || sel.charter !== "all" ? `for ${who} in ${where}` : "above"}.
        </p>
        <div className="mt-6">
          <IndexCatalog entries={catalog} selected={sel.fee} />
        </div>
      </section>

      {/* 5. How the numbers are made */}
      <section className={`mx-auto max-w-page px-4 pt-14 sm:px-6 ${subscriber ? "pb-16" : ""}`}>
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

      {/* 6. Hamilton: what the paid workspace adds to the free Index */}
      {!subscriber && (
        <section aria-labelledby="hamilton-heading" className="mx-auto max-w-page px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
          <div className="rounded-2xl bg-ink p-6 text-on-ink sm:p-10">
            <h2 id="hamilton-heading" className="text-[24px] font-semibold tracking-[-0.02em] sm:text-[32px]">
              Hamilton turns the Index into your pricing review
            </h2>
            <ul className="mt-4 grid gap-3 text-[15px] text-on-ink/85 sm:grid-cols-2">
              <li>Your institution against peer sets you build.</li>
              <li>Your fees set against your financial performance and local market.</li>
              <li>A flag when a competitor&apos;s fee changes, once its schedule is re-read.</li>
              <li>Committee briefs and spreadsheets with every source attached.</li>
            </ul>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Link href={PRO_PLANS_NAV.href} className="inline-flex min-h-11 items-center rounded-full bg-paper px-6 text-[15px] font-semibold text-ink">
                {PRO_PLANS_NAV.label}
              </Link>
              <Link href={DEMO_REQUEST_NAV.href} className="text-[15px] font-semibold text-on-ink underline decoration-on-ink/40 underline-offset-4 hover:decoration-on-ink">
                {DEMO_REQUEST_NAV.label}
              </Link>
            </div>
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
  if (b.label.startsWith("Under ")) return `<${b.label.slice("Under ".length)}`;
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
  p25,
  p75,
  unit,
  hrefFor,
  allHref,
}: {
  buckets: ReturnType<typeof histogram>;
  activeBin: number | null;
  median: number | null;
  medianBin: number;
  p25: number | null;
  p75: number | null;
  unit: string;
  hrefFor: (i: number) => string;
  allHref: string;
}) {
  const top = Math.max(...buckets.map((b) => b.total), 1);
  // Every other label when the bars are many, so none truncates; each bar's full range stays its name.
  const step = buckets.length > 8 ? 2 : 1;
  // The median's own place on the price axis: within its bar, by where it falls in the bar's range.
  const n = buckets.length;
  // A price's place on the axis: within its bar, by where it falls in the bar's range.
  const at = (value: number | null): string | null => {
    if (value == null) return null;
    const i = buckets.findIndex((b) => inBucket(b, value));
    if (i < 0) return null;
    const b = buckets[i];
    const frac = b.min != null && b.max != null && b.max > b.min ? Math.min(Math.max((value - b.min) / (b.max + 0.01 - b.min), 0), 1) : 0.5;
    return `calc((100% - ${(n - 1) * 4}px) * ${(i + frac) / n} + ${i * 4}px)`;
  };
  const medianAt = medianBin >= 0 ? at(median) : null;
  const lowAt = at(p25);
  const highAt = at(p75);
  return (
    <div className="mt-10">
      <div className="relative">
        {/* The middle 50% of institutions, shaded behind the bars. */}
        {lowAt && highAt && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 rounded-md bg-brick/10"
            style={{ left: lowAt, width: `calc(${highAt} - ${lowAt})` }}
          />
        )}
        <ul className="relative flex h-52 items-end gap-1 sm:h-64" aria-label={`Institutions by ${unit}`}>
        {buckets.map((b, i) => (
          <li key={b.label} className="relative flex h-full min-w-0 flex-1">
            {/* An empty bar has no one to list, so it is not a link. */}
            {b.total === 0 ? (
              <span className="flex h-full w-full" aria-label={`No institutions with a ${unit} of ${b.label}`} />
            ) : (
              <Link
                href={hrefFor(i)}
                scroll={false}
                title={`${plural(b.total, "institution")} with a ${unit} of ${b.label}`}
                aria-label={`${plural(b.total, "institution")} with a ${unit} of ${b.label}`}
                aria-current={i === activeBin ? "true" : undefined}
                className="group flex h-full w-full flex-col justify-end"
              >
                <span className="relative z-10 mx-auto mb-1 rounded bg-surface-0 px-0.5 text-center font-mono text-[10px] tabular-nums text-ink-muted sm:text-[11px]">{b.total}</span>
                <span
                  className={`block w-full rounded-t-md transition-colors ${i === activeBin ? "bg-ink" : "bg-ink/20 group-hover:bg-ink/40"}`}
                  style={{ height: `${Math.max((b.total / top) * 100, 2)}%` }}
                />
              </Link>
            )}
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
        {lowAt && highAt && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-brick/10" aria-hidden="true" /> Middle 50%
          </span>
        )}
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

/** One figure in the explorer's KPI strip. */
function Kpi({ term, value, strong = false }: { term: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-muted">{term}</dt>
      <dd className={`font-mono font-semibold leading-tight tabular-nums text-ink ${strong ? "text-[32px] sm:text-[40px]" : "text-[20px] sm:text-[24px]"}`}>{value}</dd>
    </div>
  );
}

/** Who sits in the picked price band, with each group one click from its own view. */
function BandBreakdown({
  label,
  band,
  total,
  charterHref,
  stateHref,
}: {
  label: string;
  band: ReturnType<typeof bandBreakdown>;
  total: number;
  charterHref: (c: "bank" | "credit_union") => string;
  stateHref: (code: string) => string;
}) {
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  // State bars share one scale, the largest state's count, so the longest bar fills its track.
  const topState = Math.max(...band.states.map((st) => st.count), 1);
  return (
    <div className="mt-3 grid gap-4 rounded-2xl border border-border bg-paper p-4 sm:grid-cols-2">
      <div>
        <p className="text-[13px] font-semibold text-ink">The {label} band by charter</p>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-surface-200" aria-hidden="true">
          <span className="bg-ink" style={{ width: pct(band.banks) }} />
          <span className="bg-ink/35" style={{ width: pct(band.creditUnions) }} />
        </div>
        <p className="mt-2 flex flex-wrap gap-x-4 text-[13px]">
          <Link href={charterHref("bank")} scroll={false} className={LINK}>
            {band.banks.toLocaleString()} banks
          </Link>
          <Link href={charterHref("credit_union")} scroll={false} className={LINK}>
            {band.creditUnions.toLocaleString()} credit unions
          </Link>
        </p>
      </div>
      {band.states.length > 0 && (
        <div>
          <p className="text-[13px] font-semibold text-ink">Most headquartered in</p>
          <ul className="mt-2 space-y-1">
            {band.states.map((st) => (
              <li key={st.code} className="grid grid-cols-[7.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-[13px]">
                <Link href={stateHref(st.code)} scroll={false} className="truncate text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
                  {STATE_NAMES[st.code] ?? st.code}
                </Link>
                <span className="h-2 rounded-full bg-ink/35" style={{ width: `${(st.count / topState) * 100}%` }} aria-hidden="true" />
                <span className="text-right font-mono tabular-nums text-ink-muted">{st.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const BAND_STYLE: Record<StateBand, { fill: string; swatch: string; label: string }> = {
  above: { fill: "fill-ink", swatch: "bg-ink", label: "Above the U.S. median" },
  same: { fill: "fill-ink/45", swatch: "bg-ink/45", label: "About the same (within 1%)" },
  below: { fill: "fill-ink/15", swatch: "bg-ink/15", label: "Below the U.S. median" },
  thin: { fill: "fill-[url(#fees-thin-hatch)]", swatch: "bg-[repeating-linear-gradient(45deg,var(--color-border)_0_2px,transparent_2px_5px)]", label: "Too few institutions for a median" },
};
/** Five ordered navy shades for the state-median view, lowest fifth of the range to highest. */
const PRICE_FILL = ["fill-ink/10", "fill-ink/25", "fill-ink/45", "fill-ink/70", "fill-ink"];
const PRICE_SWATCH = ["bg-ink/10", "bg-ink/25", "bg-ink/45", "bg-ink/70", "bg-ink"];
/** Below this many institutions a state median is shown, but marked as a small sample. */
const SMALL_SAMPLE = 15;

/** "$5.00 above the U.S.", "$2.50 below the U.S.", or "the same as the U.S.". */
function plural(n: number, noun: string): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;
}

function gapText(gap: number | null): string {
  if (gap == null) return "no comparison";
  if (gap === 0) return "the same as the U.S.";
  return `${money(Math.abs(gap))} ${gap > 0 ? "above" : "below"} the U.S.`;
}

/**
 * Every state on a map and in a ranking that read off one ordering. The map shades each state
 * by its gap from the U.S. median (three navy shades, never red, since a higher price is not by
 * itself bad) or by its own median (five shades). States without enough institutions are hatched.
 * The ranking beside it plots every state as a dot, with its institutions, so a state of 8 never
 * reads like a state of 300. Each state is a link that filters the whole page to it.
 */
function StateMap({
  ranking,
  us,
  view,
  selected,
  hrefFor,
  feeLabel,
}: {
  ranking: StateRank[];
  us: number | null;
  view: StateView;
  selected: string | null;
  hrefFor: (code: string) => string;
  feeLabel: string;
}) {
  const byCode = new Map(ranking.map((c) => [c.code, c]));
  const ranked = ranking.filter((c) => c.median != null);
  const thin = ranking.filter((c) => c.median == null);
  const describe = (c: StateRank | undefined, name: string) =>
    c?.median != null
      ? `${name}: ${money(c.median)} median, ${gapText(c.gap)}, ${c.institutions.toLocaleString()} institutions`
      : `${name}: ${c?.institutions ?? 0} ${c?.institutions === 1 ? "institution" : "institutions"}, too few for a median`;
  const fillOf = (c: StateRank | undefined) =>
    c?.median == null ? BAND_STYLE.thin.fill : view === "price" ? PRICE_FILL[c.step ?? 2] : BAND_STYLE[c.band].fill;
  // The ranking's scale: gaps around a centred U.S. line, or medians from the lowest to the highest.
  const medians = ranked.map((c) => c.median!);
  const lo = medians.length ? Math.min(...medians) : 0;
  const hi = medians.length ? Math.max(...medians) : 1;
  const reach = Math.max(...ranked.map((c) => Math.abs(c.gap ?? 0)), 0.01);
  const pos = (c: StateRank) =>
    view === "gap" ? 50 + ((c.gap ?? 0) / reach) * 46 : hi > lo ? 4 + ((c.median! - lo) / (hi - lo)) * 92 : 50;
  const usPos = view === "gap" ? 50 : us != null && hi > lo ? Math.min(Math.max(4 + ((us - lo) / (hi - lo)) * 92, 0), 100) : null;
  return (
    <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <figure className="self-start rounded-2xl border border-border bg-surface-0 p-4 sm:p-6">
        <svg viewBox="0 0 960 600" className="h-auto w-full" role="group" aria-label={`${feeLabel} ${view === "price" ? "medians" : "against the U.S. median"} by state`}>
          <defs>
            <pattern id="fees-thin-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" className="fill-paper" />
              <line x1="0" y1="0" x2="0" y2="6" className="stroke-border" strokeWidth="2" />
            </pattern>
          </defs>
          {US_STATES.map((st) => {
            const c = byCode.get(st.id);
            const isSel = st.id === selected;
            return (
              <Link key={st.id} href={hrefFor(st.id)} scroll={false} aria-label={describe(c, st.name)}>
                <path
                  d={st.d}
                  className={`${fillOf(c)} stroke-surface-0 transition-opacity hover:opacity-80 ${isSel ? "stroke-brick" : ""}`}
                  strokeWidth={isSel ? 3 : 1.25}
                >
                  <title>{describe(c, st.name)}</title>
                </path>
              </Link>
            );
          })}
        </svg>
        <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
          {view === "price" ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="font-mono tabular-nums">{money(lo)}</span>
              {PRICE_SWATCH.map((s) => (
                <span key={s} className={`inline-block h-3 w-5 border border-border ${s}`} aria-hidden="true" />
              ))}
              <span className="font-mono tabular-nums">{money(hi)}</span>
            </span>
          ) : (
            (["above", "same", "below"] as StateBand[]).map((b) => (
              <span key={b} className="inline-flex items-center gap-1.5">
                <span className={`inline-block h-3 w-3 rounded-sm border border-border ${BAND_STYLE[b].swatch}`} aria-hidden="true" />
                {BAND_STYLE[b].label}
              </span>
            ))
          )}
          <span className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 rounded-sm border border-border ${BAND_STYLE.thin.swatch}`} aria-hidden="true" />
            Fewer than {MIN_INSTITUTIONS_FOR_MEDIAN} institutions
          </span>
        </figcaption>
      </figure>

      <div className="self-start rounded-2xl border border-border bg-surface-0 p-4 sm:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[15px] font-semibold text-ink">{ranked.length} states ranked</p>
          <p className="text-[12px] text-ink-muted">{view === "gap" ? "Gap from U.S." : "Median"} · institutions</p>
        </div>
        {ranked.length === 0 ? (
          <p className="mt-3 text-[14px] text-ink-soft">No state has enough institutions for a median yet.</p>
        ) : (
          <ol className="mt-3 max-h-[30rem] overflow-y-auto pr-1">
            {ranked.map((c) => {
              const isSel = c.code === selected;
              const small = c.institutions < SMALL_SAMPLE;
              return (
                <li key={c.code}>
                  <Link
                    href={hrefFor(c.code)}
                    scroll={false}
                    aria-current={isSel ? "true" : undefined}
                    aria-label={describe(c, STATE_NAMES[c.code])}
                    className={`grid min-h-9 grid-cols-[6.5rem_minmax(0,1fr)_3.75rem_2.5rem] items-center gap-2 rounded-lg px-1.5 text-[13px] hover:bg-paper ${isSel ? "bg-paper font-semibold ring-1 ring-ink" : ""}`}
                  >
                    <span className="truncate text-ink">{STATE_NAMES[c.code]}</span>
                    <span className="relative h-4" aria-hidden="true">
                      <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
                      {usPos != null && <span className="absolute inset-y-0 w-px bg-brick" style={{ left: `${usPos}%` }} />}
                      <span
                        className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink ${small ? "bg-surface-0" : "bg-ink"}`}
                        style={{ left: `${pos(c)}%` }}
                      />
                    </span>
                    <span className="text-right font-mono tabular-nums text-ink">
                      {view === "gap" ? (c.gap === 0 ? "Same" : `${c.gap! > 0 ? "+" : "−"}${money(Math.abs(c.gap!))}`) : money(c.median!)}
                    </span>
                    <span className="text-right font-mono tabular-nums text-ink-muted">{c.institutions.toLocaleString()}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-[12px] text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-px bg-brick" aria-hidden="true" /> U.S. median
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-ink bg-surface-0" aria-hidden="true" /> Fewer than {SMALL_SAMPLE} institutions
          </span>
        </p>
        {thin.length > 0 && (
          <details className="mt-3 border-t border-border pt-3">
            <summary className="cursor-pointer text-[13px] font-semibold text-ink">
              {thin.length} {thin.length === 1 ? "state" : "states"} with too few institutions
            </summary>
            <ul className="mt-2 flex flex-wrap gap-1.5 text-[13px]">
              {thin.map((c) => (
                <li key={c.code}>
                  <Link
                    href={hrefFor(c.code)}
                    scroll={false}
                    className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 hover:border-ink ${c.code === selected ? "border-ink" : "border-border"}`}
                  >
                    {STATE_NAMES[c.code]}
                    <span className="font-mono text-[11px] tabular-nums text-ink-muted">{c.institutions}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
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
              {inst.state ? ` · ${STATE_NAMES[inst.state] ?? inst.state}` : ""}
              {readOn ? ` · read ${READ.format(new Date(`${readOn}T00:00:00Z`))}` : ""}
              {verified === 0 ? " · not verified" : verified === listed.length ? " · verified" : ` · ${verified} of ${listed.length} verified`}
              {inst.shared > 0 ? ` · counts once with ${inst.shared} sibling ${inst.shared === 1 ? "charter" : "charters"} on the same schedule` : ""}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-mono text-[15px] tabular-nums text-ink">
              {amounts.length > 1 ? `${money(lo)}–${money(hi)}` : money(inst.value)}
            </span>
            {/* Distinct prices, and the schedule lines behind them when one price is printed on several. */}
            <span className="block text-[11px] text-ink-muted">
              {amounts.length} {amounts.length === 1 ? "price" : "prices"}
              {listed.length > amounts.length ? ` · ${listed.length} schedule lines` : ""}
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
            <p className="flex items-center gap-1 text-[12px] text-ink-muted">
              <span className="rounded-full border border-border px-2 py-0.5">Account mapping unavailable</span>
              <InfoTip label="About account mapping">
                The Index hasn&apos;t yet matched each price to its account in the schedule, so these prices can&apos;t be compared account by account.
              </InfoTip>
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
                      <p className="text-[12px] text-ink-muted" title={`The schedule's line doesn't state ${money(p.amount)}.`}>
                        <span className="font-semibold text-ink">Not verified</span>
                        {d?.fee_name ? <> · &ldquo;{d.fee_name}&rdquo;</> : null}
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
