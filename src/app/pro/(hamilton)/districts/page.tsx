export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import {
  getDistrictMetrics,
  getBeigeBookHeadlines,
  getPublicStats,
} from "@/lib/data-store";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { LinkButton, MemoHeader, MemoPage, SERIF } from "@/components/hamilton/memo/memo";

export const metadata: Metadata = {
  title: "Fed districts",
};

export default async function ProDistrictsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?from=/pro/districts");
  if (!canAccessPremium(user)) redirect("/subscribe?from=/pro/districts");

  const metrics = await getDistrictMetrics();
  const headlines = await getBeigeBookHeadlines();
  const stats = await getPublicStats();

  return (
    <MemoPage>
      <MemoHeader
        kicker="Reference"
        title="Fed districts"
        dek={
          <>
            Institutions, published fees and the latest Beige Book reading for each of the 12 Federal Reserve
            districts: {stats.total_institutions.toLocaleString()} institutions and{" "}
            {stats.total_observations.toLocaleString()} fees on file in all.
          </>
        }
        actions={<LinkButton href="/pro/research?layer=district">Your district in My fees</LinkButton>}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {metrics.map((m) => {
          const name = DISTRICT_NAMES[m.district] ?? `District ${m.district}`;
          const headline = headlines.get(m.district);
          const coveragePct =
            m.institution_count > 0
              ? Math.round((m.with_fee_url / m.institution_count) * 100)
              : 0;

          return (
            <section key={m.district} className="flex flex-col rounded-lg border border-warm-300 bg-warm-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-terra-text [font-variant-numeric:tabular-nums]">
                District {m.district}
              </p>
              <h2 className="mt-1 text-xl text-warm-900" style={SERIF}>
                {name}
              </h2>

              <dl className="mt-3 grid grid-cols-3 gap-3">
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-[0.08em] text-warm-600">Institutions</dt>
                  <dd className="mt-0.5 text-lg text-warm-900 [font-variant-numeric:tabular-nums]" style={SERIF}>
                    {m.institution_count.toLocaleString()}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-[0.08em] text-warm-600">Fees on file</dt>
                  <dd className="mt-0.5 text-lg text-warm-900 [font-variant-numeric:tabular-nums]" style={SERIF}>
                    {m.total_fees.toLocaleString()}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt
                    className="text-xs font-medium uppercase tracking-[0.08em] text-warm-600"
                    title="Share of institutions in this district with a fee schedule on file"
                  >
                    Schedule on file
                  </dt>
                  <dd className="mt-0.5 text-lg text-warm-900 [font-variant-numeric:tabular-nums]" style={SERIF}>
                    {coveragePct}%
                  </dd>
                </div>
              </dl>

              <div className="mt-4 border-t border-warm-200 pt-3">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-warm-600">Beige Book</p>
                <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-warm-700">
                  {headline ? headline.text : "No Beige Book reading on file for this district."}
                </p>
              </div>

              <Link
                href={`/research/district/${m.district}`}
                className="mt-auto -mb-2 flex min-h-11 items-center pt-3 text-sm font-medium text-terra-text no-underline hover:underline"
              >
                Open the public district page<span aria-hidden className="ml-1">→</span>
              </Link>
            </section>
          );
        })}
      </div>
    </MemoPage>
  );
}
