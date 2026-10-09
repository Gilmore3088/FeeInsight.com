export const dynamic = "force-dynamic";
import { ReportDesign, ReportHeader } from "@/components/report-design";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { getCountyDepositTotals, getInstitutionCounties, getMarketStudyData } from "@/lib/data-store/market-study";
import { adjacentCandidateCounties, countyFeatures, countyLabel } from "@/lib/geo/counties";
import { STATE_TO_FIPS } from "@/lib/geo/state-fips";
import { buildMarketStudy, dollarsShort } from "@/lib/hamilton/studies-exhibits/market";
import { PrintButton } from "@/components/hamilton/memo/PrintButton";

export const metadata: Metadata = { title: "New Market Study" };

const CANDIDATES = 12;

export default async function MarketStudyPage({
  searchParams,
}: {
  searchParams: Promise<{ instId?: string; county?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?from=${encodeURIComponent("/pro/studies/market")}`);
  if (!canAccessPremium(user)) redirect("/subscribe?from=/pro/studies/market");

  const { institution } = await resolveHamiltonInstitutionContext({ userId: user.id, instId: params.instId, intent: "market-study" });
  if (!institution) {
    return (
      <Shell>
        <p className="text-sm text-warm-700">
          Choose your bank first, then come back here. <Link className="underline" href="/pro/settings">Pick a bank</Link>
        </p>
      </Shell>
    );
  }
  const instId = String(institution.id);
  const county = params.county && /^\d{5}$/.test(params.county) ? params.county : null;

  if (!county) {
    const own = await getInstitutionCounties(institution.id).catch(() => []);
    const ranked = await getCountyDepositTotals(adjacentCandidateCounties(own)).catch(() => []);
    const stateFips = institution.stateCode ? STATE_TO_FIPS[institution.stateCode] : undefined;
    const stateCounties = stateFips
      ? countyFeatures()
          .filter((f) => f.id.startsWith(stateFips))
          .sort((a, b) => a.properties.name.localeCompare(b.properties.name))
      : [];
    return (
      <Shell>
        <h1 className="font-serif text-3xl text-warm-900">Study a new market</h1>
        <p className="mt-2 max-w-2xl text-sm text-warm-700">
          Pick a county {institution.name} does not serve yet. Hamilton maps every branch there, shows who holds the
          deposits, sets your fees beside the local competitors, and compares households.
        </p>
        {ranked.length > 0 ? (
          <>
            <h2 className="mt-8 text-sm font-semibold text-warm-900">Counties next to your branches</h2>
            <ul className="mt-3 divide-y divide-warm-200 border-y border-warm-200">
              {ranked.slice(0, CANDIDATES).map((c) => (
                <li key={c.fips}>
                  <Link
                    className="flex items-baseline justify-between gap-4 py-2.5 text-sm hover:text-terra"
                    href={hrefWithInstitutionContext(`/pro/studies/market?county=${c.fips}`, instId)}
                  >
                    <span className="font-medium">{countyLabel(c.fips) ?? c.fips}</span>
                    <span className="tabular-nums text-warm-600">
                      {dollarsShort(c.deposits)} at {c.branches} branches
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-6 text-sm text-warm-700">No branch deposits are on file for {institution.name} yet, so there are no neighbouring counties to suggest.</p>
        )}
        {stateCounties.length > 0 ? (
          <form className="mt-8 flex flex-wrap items-end gap-3" action="/pro/studies/market" method="get">
            <input type="hidden" name="instId" value={instId} />
            <label className="text-sm text-warm-900">
              <span className="block font-semibold">Or any county in {institution.stateCode}</span>
              <select name="county" className="mt-1 rounded-md border border-warm-300 bg-white px-3 py-2 text-sm">
                {stateCounties.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.properties.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white">
              Build the study
            </button>
          </form>
        ) : null}
      </Shell>
    );
  }

  const data = await getMarketStudyData(institution.id, county).catch(() => null);
  if (!data) {
    return (
      <Shell>
        <p className="text-sm text-warm-700">
          No branch deposits are on file for {countyLabel(county) ?? `county ${county}`}, so there is no study to build.{" "}
          <Link className="underline" href={hrefWithInstitutionContext("/pro/studies/market", instId)}>
            Pick another county
          </Link>
        </p>
      </Shell>
    );
  }
  const study = buildMarketStudy(data);

  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link className="text-sm text-warm-700 underline" href={hrefWithInstitutionContext("/pro/studies/market", instId)}>
          Pick another county
        </Link>
        <PrintButton />
      </div>
      <ReportDesign>
        <ReportHeader eyebrow={study.eyebrow} title={study.title} deck={study.deck} heroes={study.heroes} />
        {/* Exhibits built by buildMarketStudy from escaped data. */}
        <div dangerouslySetInnerHTML={{ __html: study.html }} />
      </ReportDesign>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  // The Hamilton shell's <main> already pads the page.
  return <div className="mx-auto max-w-5xl">{children}</div>;
}
