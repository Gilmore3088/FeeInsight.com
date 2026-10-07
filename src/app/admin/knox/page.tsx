import Link from "next/link";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AgentHandoffStrip } from "@/components/agent-console/agent-handoff-strip";
import { requireAuth } from "@/lib/auth";
import { getKnoxReviewCounts } from "@/lib/data-store/knox-reviews";
import { KnoxDecisionsView } from "../agents/knox/reviews/page";
import { GoldStandardView } from "../verify/page";

export const dynamic = "force-dynamic";

const QUEUES = [
  { key: "decisions", label: "Knox decisions" },
  { key: "gold", label: "Gold standard" },
] as const;

type QueueKey = (typeof QUEUES)[number]["key"];

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export default async function KnoxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAuth("view");
  const params = await searchParams;
  if (params.queue === "fees") {
    redirect("/admin/knox?queue=decisions");
  }
  const queue = QUEUES.some((item) => item.key === params.queue) ? params.queue as QueueKey : "decisions";
  const forwardedParams = Promise.resolve(params);
  const knoxCounts = await getKnoxReviewCounts();
  const summary = [
    {
      key: "decisions" as const,
      label: "Knox decisions",
      countLabel: formatNumber(knoxCounts.pending),
      detail: `${formatNumber(knoxCounts.confirmed)} confirmed · ${formatNumber(knoxCounts.overridden)} overridden`,
      href: "/admin/knox?queue=decisions",
    },
    {
      key: "gold" as const,
      label: "Gold standard",
      countLabel: "Audit",
      detail: "Verify high-impact institution extracts after exception queues are low.",
      href: "/admin/knox?queue=gold",
    },
  ];
  const workFirst = knoxCounts.pending > 0 ? summary[0] : summary[1];

  return (
    <div>
      <header className="mb-5">
        <Breadcrumbs items={[{ label: "Atlas", href: "/admin" }, { label: "Knox" }]} />
        <p className="admin-eyebrow mt-3">Agent · Extract + Review</p>
        <h1 className="admin-display-title mt-1">Knox</h1>
        <p className="admin-lede mt-2">Knox extracts conservative raw fee observations from Rosetta text and keeps human work anomaly-only.</p>
        <Link href="/admin/knox/labels" className="admin-meta mt-2 inline-block underline">
          Label this week&apos;s contested fee names
        </Link>
      </header>

      <div className="mb-7">
        <AgentHandoffStrip
          steps={[
            {
              label: "Input",
              title: "Rosetta text",
              detail: "Normalized source artifacts provide stable extraction input.",
              href: "/admin/rosetta",
            },
            {
              label: "Current",
              title: "Knox extracts",
              detail: "Create conservative raw observations and surface anomaly decisions.",
              href: "/admin/knox",
              current: true,
            },
            {
              label: "Next",
              title: "Darwin verifies",
              detail: "Promote source-grounded rows into verified observations.",
              href: "/admin/darwin",
            },
            {
              label: "Publish",
              title: "Hamilton publishes",
              detail: "Move eligible verified rows into product read models.",
              href: "/admin/data",
            },
          ]}
        />
      </div>

      <section aria-labelledby="knox-work-heading" className="mb-7 border-y border-black/[0.06] py-5 dark:border-white/[0.06]">
        <div className="grid gap-5 lg:grid-cols-[minmax(220px,0.8fr)_1.2fr]">
          <div>
            <p className="admin-eyebrow">Work first</p>
            <h2 id="knox-work-heading" className="mt-1 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
              {workFirst.label}
            </h2>
            <p className="admin-meta mt-1">{workFirst.detail}</p>
            <Link
              href={workFirst.href}
              className="mt-3 inline-flex min-h-8 items-center rounded-md bg-gray-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-gray-800 dark:bg-white/[0.14] dark:hover:bg-white/[0.2]"
            >
              Open queue
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summary.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={queue === item.key ? "page" : undefined}
                className={`rounded-md border px-3 py-3 transition-colors ${
                  queue === item.key
                    ? "border-[var(--brand-primary)] bg-[var(--brand-primary-soft)]"
                    : "border-black/[0.06] hover:bg-black/[0.015] dark:border-white/[0.06] dark:hover:bg-white/[0.02]"
                }`}
              >
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{item.label}</p>
                <p className="mt-2 text-xl font-semibold tabular-nums tracking-tight text-gray-900 dark:text-gray-100">{item.countLabel}</p>
                <p className="admin-meta mt-1">{item.detail}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <nav aria-label="Knox review queues" className="mb-7 flex gap-1 overflow-x-auto border-b border-black/[0.06] dark:border-white/[0.06]">
        {QUEUES.map((item) => {
          const count = item.key === "decisions" ? knoxCounts.pending : null;
          return (
            <Link
              key={item.key}
              href={`/admin/knox?queue=${item.key}`}
              aria-current={queue === item.key ? "page" : undefined}
              className={`-mb-px inline-flex whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${queue === item.key ? "border-[var(--brand-primary)] text-gray-900 dark:text-gray-100" : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}
            >
              {item.label}
              {count !== null && count > 0 && (
                <span className="ml-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] tabular-nums text-gray-600 dark:bg-white/[0.08] dark:text-gray-300">
                  {formatNumber(count)}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      {queue === "decisions" && <KnoxDecisionsView searchParams={forwardedParams} embedded />}
      {queue === "gold" && <GoldStandardView embedded />}
    </div>
  );
}
