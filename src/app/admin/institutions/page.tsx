export const dynamic = "force-dynamic";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { searchInstitutions } from "@/lib/admin-queries";
import { formatAssets } from "@/lib/format";
import {
  INSTITUTION_QUALITY_FILTERS,
  repairHrefForQualitySignal,
  type InstitutionQualityFilter,
  type InstitutionQualitySeverity,
  type InstitutionQualitySignal,
} from "@/lib/institution-quality";
import {
  ServerSortableTable,
  type ServerColumn,
} from "@/components/server-sortable-table";

const PAGE_SIZE = 50;

type InstitutionRow = Awaited<
  ReturnType<typeof searchInstitutions>
>["institutions"][number];

const VALID_SORTS = new Set([
  "institution_name",
  "state_code",
  "charter_type",
  "asset_size",
  "has_fee_url",
  "fee_count",
]);

const QUALITY_FILTER_LABELS: Array<{
  value: InstitutionQualityFilter | "";
  label: string;
}> = [
  { value: "", label: "All" },
  { value: "needs_review", label: "Needs review" },
  { value: "url_but_zero_fees", label: "URL, zero fees" },
  { value: "extracted_not_published", label: "Extracted, not published" },
  { value: "latest_failed", label: "Latest failed" },
  { value: "missing_url", label: "Missing URL" },
  { value: "verified", label: "Verified" },
];

function severityClasses(severity: InstitutionQualitySeverity): string {
  switch (severity) {
    case "critical":
      return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/25 dark:text-red-300";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-300";
    case "info":
      return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/25 dark:text-blue-300";
    case "ok":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/25 dark:text-emerald-300";
  }
}

function SignalBadge({ signal }: { signal: InstitutionQualitySignal }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${severityClasses(signal.severity)}`}
    >
      {signal.label}
    </span>
  );
}

function truncate(value: string | null, max = 44): string {
  if (!value) return "-";
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function qualityFilterHref(query: string | undefined, quality: InstitutionQualityFilter | ""): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (quality) params.set("quality", quality);
  const qs = params.toString();
  return qs ? `/admin/institutions?${qs}` : "/admin/institutions";
}

const COLUMNS: ServerColumn<InstitutionRow>[] = [
  {
    key: "institution_name",
    label: "Institution",
    sortable: true,
    render: (r) => (
      <div className="min-w-[260px]">
        <Link
          href={`/admin/institution/${r.id}`}
          className="font-semibold text-gray-900 hover:text-blue-700 dark:text-gray-100 dark:hover:text-blue-300"
        >
          {r.institution_name}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
          <span>{[r.city, r.state_code].filter(Boolean).join(", ") || r.state_code || "-"}</span>
          <span className="uppercase">{r.charter_type || "-"}</span>
          <Link
            href={`/institution/${r.id}`}
            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Public page
          </Link>
        </div>
      </div>
    ),
  },
  {
    key: "identity",
    label: "Identity",
    render: (r) => (
      <div className="min-w-[150px] space-y-1 text-[11px] text-gray-500 dark:text-gray-400">
        <div>
          <span className="font-semibold uppercase text-gray-700 dark:text-gray-300">
            {r.source || "source?"}
          </span>{" "}
          <span className="tabular-nums">cert {r.cert_number || "-"}</span>
        </div>
        <div className="tabular-nums">RSSD {r.rssd_id || "-"}</div>
        <div className="truncate" title={r.lei || undefined}>LEI {r.lei || "-"}</div>
      </div>
    ),
  },
  {
    key: "asset_size",
    label: "Assets",
    sortable: true,
    align: "right",
    render: (r) => (
      <span className="text-gray-600 dark:text-gray-400 tabular-nums">
        {formatAssets(r.asset_size)}
      </span>
    ),
  },
  {
    key: "evidence",
    label: "Evidence",
    render: (r) => (
      <div className="min-w-[280px] space-y-1 text-[11px] text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-1">
          <span className="font-semibold text-gray-700 dark:text-gray-300">URL</span>
          {r.fee_schedule_url ? (
            <a
              href={r.fee_schedule_url}
              target="_blank"
              rel="noopener noreferrer"
              className="max-w-[230px] truncate text-blue-600 hover:underline dark:text-blue-400"
              title={r.fee_schedule_url}
            >
              {truncate(r.fee_schedule_url)}
            </a>
          ) : (
            <span>-</span>
          )}
        </div>
        <div>
          Latest source:{" "}
          <span className="font-medium text-gray-700 dark:text-gray-300">
            {r.latest_source_status || "none"}
          </span>
          {r.latest_source_collected_at ? ` at ${r.latest_source_collected_at}` : ""}
        </div>
        <div className="tabular-nums">
          Extracted {r.latest_extracted_fee_count.toLocaleString()} / Verified{" "}
          {r.published_fee_count.toLocaleString()} / Provisional{" "}
          {r.provisional_fee_count.toLocaleString()}
        </div>
      </div>
    ),
  },
  {
    key: "quality",
    label: "Quality",
    render: (r) => (
      <div className="min-w-[220px] space-y-1.5">
        <SignalBadge signal={r.quality_signals[0]} />
        <p className="text-[11px] leading-snug text-gray-500 dark:text-gray-400">
          {r.quality_signals[0].detail}
        </p>
        {r.quality_signals.length > 1 && (
          <p className="text-[10px] text-gray-400">
            +{r.quality_signals.length - 1} more signal{r.quality_signals.length === 2 ? "" : "s"}
          </p>
        )}
      </div>
    ),
  },
  {
    key: "repair",
    label: "Repair",
    render: (r) => (
      <div className="min-w-[190px] space-y-1">
        <p className="text-[11px] leading-snug text-gray-600 dark:text-gray-400">
          {r.recommended_action}
        </p>
        <Link
          href={repairHrefForQualitySignal(r.quality_signals[0])}
          className="inline-flex min-h-8 items-center rounded-md border border-gray-200 px-2.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-white/[0.1] dark:text-gray-300 dark:hover:bg-white/[0.04]"
        >
          Open lane
        </Link>
      </div>
    ),
  },
];

export default async function InstitutionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAuth("operate");

  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : undefined;
  const page = Math.max(1, Number(params.page) || 1);
  const sortParam = typeof params.sort === "string" ? params.sort : "";
  const sort = VALID_SORTS.has(sortParam) ? sortParam : "asset_size";
  const dir: "asc" | "desc" = params.dir === "asc" ? "asc" : "desc";
  const perParam = Number(params.per);
  const perPage = [25, 50, 100].includes(perParam) ? perParam : PAGE_SIZE;
  const qualityParam = typeof params.quality === "string" ? params.quality : "";
  const quality = INSTITUTION_QUALITY_FILTERS.includes(qualityParam as InstitutionQualityFilter)
    ? (qualityParam as InstitutionQualityFilter)
    : undefined;

  let result = {
    institutions: [] as InstitutionRow[],
    total: 0,
  };
  try {
    result = await searchInstitutions(query, page, perPage, sort, dir, quality);
  } catch {
    // fallback already set
  }

  const { institutions, total } = result;
  const baseParams: Record<string, string> = {};
  if (query) baseParams.q = query;
  if (quality) baseParams.quality = quality;

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Admin", href: "/admin" },
            { label: "Institutions" },
          ]}
        />
        <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          Institution quality
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {total.toLocaleString()} institution{total !== 1 ? "s" : ""}
          {query ? ` matching "${query}"` : ""}
          {quality ? ` in ${quality.replaceAll("_", " ")}` : ""}
        </p>
      </div>

      {/* Search */}
      <form method="GET" className="flex flex-col gap-2 sm:flex-row">
        {quality && <input type="hidden" name="quality" value={quality} />}
        <input
          type="text"
          name="q"
          defaultValue={query || ""}
          placeholder="Search by institution name..."
          className="flex-1 rounded-md border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] px-3 py-2 text-sm text-gray-900 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-white/[0.2]"
        />
        <button
          type="submit"
          className="rounded-md bg-gray-900 dark:bg-white/[0.1] px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 dark:hover:bg-white/[0.15] transition-colors"
        >
          Search
        </button>
        {(query || quality) && (
          <Link
            href="/admin/institutions"
            className="rounded-md border border-gray-200 dark:border-white/[0.1] px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="flex flex-wrap gap-2">
        {QUALITY_FILTER_LABELS.map((filter) => {
          const active = (quality || "") === filter.value;
          return (
            <Link
              key={filter.value || "all"}
              href={qualityFilterHref(query, filter.value)}
              className={`inline-flex min-h-8 items-center rounded-md border px-3 text-xs font-semibold transition-colors ${
                active
                  ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08]"
              }`}
            >
              {filter.label}
            </Link>
          );
        })}
      </div>

      {/* Sortable table */}
      <div className="admin-card overflow-hidden">
        <ServerSortableTable
          columns={COLUMNS}
          rows={institutions}
          rowKey={(r) => String(r.id)}
          basePath="/admin/institutions"
          sort={sort}
          dir={dir}
          page={page}
          perPage={perPage}
          totalItems={total}
          params={baseParams}
          caption="Institutions sorted server-side; change columns or page size to refresh."
        />
      </div>
    </div>
  );
}
