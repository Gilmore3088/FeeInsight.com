import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { parseInstitutionId } from "@/lib/hamilton/institution-context";
import { getMergerCandidates, getMergerScreenData, type MergerCandidate } from "@/lib/data-store/merger-screen";
import { buildMergerScreen, moneyK } from "@/lib/hamilton/studies-exhibits/merger";
import { MergerScreenView } from "@/components/hamilton/studies/MergerScreenView";
import { LinkButton, MemoHeader, MemoPage, MemoSection } from "@/components/hamilton/memo/memo";

export const metadata: Metadata = { title: "Merger screen" };

// Live call report, deposit and fee figures on every load.
export const dynamic = "force-dynamic";

type Params = { a?: string; b?: string; instId?: string };

function PartnerForm({ subjectId, subjectName, candidates }: { subjectId: number; subjectName: string; candidates: MergerCandidate[] }) {
  if (candidates.length === 0) {
    return (
      <p className="text-pretty text-sm text-warm-700">
        No other bank has branches in {subjectName}&rsquo;s counties in the latest FDIC Summary of Deposits, so there is no
        partner to suggest. Credit unions do not report branch deposits to the FDIC.
      </p>
    );
  }
  return (
    <form method="get" action="/pro/studies/merger" className="flex flex-col gap-4">
      <input type="hidden" name="a" value={subjectId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm text-warm-700">
          Banks with branches in the same counties as {subjectName}, largest deposits in those counties first.
        </legend>
        {candidates.map((c, i) => (
          <label
            key={c.id}
            className="flex cursor-pointer items-start gap-3 rounded-md border border-warm-300 bg-warm-50 px-3 py-2.5 hover:border-warm-500"
          >
            <input type="radio" name="b" value={c.id} defaultChecked={i === 0} className="mt-1 accent-terra" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-warm-900">{c.name}</span>
              <span className="block text-xs text-warm-600">
                {[c.city, c.stateCode].filter(Boolean).join(", ")}
                {" · "}
                {c.sharedCounties === 1 ? "1 shared county" : `${c.sharedCounties} shared counties`}
                {" · "}
                {moneyK(c.sharedDepositsK)} of deposits there
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <button type="submit" className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark">
          Screen the pair
        </button>
      </div>
    </form>
  );
}

export default async function MergerScreenPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) {
    const query = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string"));
    const returnPath = `/pro/studies/merger${query.size ? `?${query}` : ""}`;
    redirect(`/login?from=${encodeURIComponent(returnPath)}`);
  }
  if (!canAccessPremium(user)) redirect("/subscribe?from=%2Fpro%2Fstudies%2Fmerger");

  // `a` is the subject bank; links that carry the workspace bank use `instId`.
  const { institution, error } = await resolveHamiltonInstitutionContext({
    userId: user.id,
    instId: params.a ?? params.instId,
    intent: "merger",
  });

  if (!institution) {
    return (
      <MemoPage>
        <MemoHeader kicker="Hamilton · Merger screen" title="Screen a merger" dek="Two banks side by side, as one." />
        <p className="text-pretty text-sm text-warm-700">
          {error ? `${error}. ` : ""}Choose your bank in Hamilton first; the screen starts from it.
        </p>
        <div>
          <LinkButton href="/pro/hamilton">Open Hamilton</LinkButton>
        </div>
      </MemoPage>
    );
  }

  const partnerId = parseInstitutionId(params.b);
  if (!partnerId || partnerId === institution.id) {
    const candidates = await getMergerCandidates(institution.id).catch(() => null);
    return (
      <MemoPage>
        <MemoHeader
          kicker="Hamilton · Merger screen"
          title={`Screen a merger with ${institution.name}`}
          dek="Pick a partner. The screen shows where the two branch networks meet, how the banks compare, what combining would do to local deposit share, and how their fee schedules differ."
        />
        <MemoSection title="Choose a partner">
          {candidates ? (
            <PartnerForm subjectId={institution.id} subjectName={institution.name} candidates={candidates} />
          ) : (
            <p className="text-sm text-warm-700">The list of partners could not be read just now. Try again in a moment.</p>
          )}
        </MemoSection>
      </MemoPage>
    );
  }

  const data = await getMergerScreenData(institution.id, partnerId).catch(() => null);
  if (!data) {
    return (
      <MemoPage>
        <MemoHeader kicker="Hamilton · Merger screen" title="Screen a merger" />
        <p className="text-sm text-warm-700">
          The partner bank was not found, or its figures could not be read just now. Choose another partner.
        </p>
        <div>
          <LinkButton href={`/pro/studies/merger?a=${institution.id}`}>Choose a partner</LinkButton>
        </div>
      </MemoPage>
    );
  }

  const screen = buildMergerScreen(data);
  return (
    <MemoPage>
      <MergerScreenView screen={screen} />
      <div className="flex flex-wrap gap-2 print:hidden">
        <LinkButton href={`/pro/studies/merger?a=${institution.id}`}>Choose another partner</LinkButton>
        <LinkButton href={`/pro/studies/merger?a=${partnerId}&b=${institution.id}`}>Swap the two banks</LinkButton>
      </div>
    </MemoPage>
  );
}
