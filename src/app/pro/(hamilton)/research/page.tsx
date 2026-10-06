// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";

import { unstable_cache } from "next/cache";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { layerDates, loadFeeWorkspace } from "@/lib/hamilton/fee-workspace-data";
import { buildAuditTrail } from "@/lib/hamilton/audit-trail";
import { describePosition, parseLayer, type LayerSummary } from "@/lib/hamilton/research-layers";
import { buildImplementationPlan } from "@/lib/hamilton/implementation-plan";
import { getServiceChargeContext, type ServiceChargeContext } from "@/lib/data-store/service-charge-context";
import { getInstitutionComplaintProfile } from "@/lib/data-store/complaints";
import { getArticles } from "@/lib/data-store/news";
import { COMPETITOR_MOVE_WINDOW_DAYS, getFeeResearch } from "@/lib/hamilton/workspace/research";
import {
  AuditPanel,
  Callout,
  DistributionBars,
  Exhibit,
  Figure,
  LinkButton,
  MemoHeader,
  MemoPage,
  MemoSection,
  QuarterLines,
  SERIF,
  Tabs,
  fmtFiledThousands,
  fmtMoney,
} from "@/components/hamilton/memo/memo";

export const metadata: Metadata = { title: "My fees" };

interface PageProps {
  searchParams: Promise<{ fee?: string; layer?: string; instId?: string; prompt?: string }>;
}

const OVERDRAFT_FAMILY = new Set(["overdraft", "nsf", "continuous_od", "od_protection_transfer"]);

function researchHref(p: { fee: string; layer: string }, instId: string | null) {
  return hrefWithInstitutionContext(`/pro/research?fee=${encodeURIComponent(p.fee)}&layer=${p.layer}`, instId);
}

// Filings change quarterly; the national and peer sums take a second or two, so keep them a few hours.
const getCachedServiceCharges = unstable_cache(
  async (institutionId: number) => getServiceChargeContext(institutionId, 8).catch(() => null),
  ["hamilton-research-service-charges-v1"],
  { revalidate: 6 * 60 * 60 },
);

function fmtYoy(pct: number | null): string {
  if (pct == null) return "No same quarter a year earlier on file";
  if (pct === 0) return "Level with the same quarter a year earlier";
  return `${pct > 0 ? "Up" : "Down"} ${Math.abs(pct).toFixed(1)}% from the same quarter a year earlier`;
}

function FilingExhibits({ ctx, name, credit }: { ctx: ServiceChargeContext; name: string; credit: boolean }) {
  const oldestFirst = [...ctx.quarters].reverse();
  const latest = ctx.quarters[0];
  const kind = credit ? "credit unions" : "banks";
  const line = credit ? "Fee income" : "Service charges on deposit accounts";
  const peerLabel = `Median of ${latest.peerCount.toLocaleString("en-US")} ${kind} with ${ctx.tierLabel}`;
  const multiple = latest.own != null && latest.peerMedian ? latest.own / latest.peerMedian : null;
  const source = credit
    ? "NCUA 5300 call report, account 131 (fee income). Filed year to date; each quarter here is that quarter alone."
    : "FDIC call report, service charges on deposit accounts. Filed for the quarter.";
  return (
    <>
      <Exhibit number={2} title={`${line} each quarter, ${name} against its peers`} source={source}>
        <div className="grid gap-6 lg:grid-cols-[1fr_15rem]">
          <QuarterLines
            quarters={oldestFirst.map((q) => q.quarter)}
            series={[
              { label: name, values: oldestFirst.map((q) => q.own), own: true },
              { label: peerLabel, values: oldestFirst.map((q) => q.peerMedian) },
            ]}
          />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
            <Figure label={`You, ${latest.quarter.replace("-", " ")}`} value={latest.own != null ? fmtFiledThousands(latest.own) : "Not filed"} note={fmtYoy(ctx.ownYoyPct)} />
            <Figure label="Peer median" value={latest.peerMedian != null ? fmtFiledThousands(latest.peerMedian) : "Too few peers"} note={fmtYoy(ctx.peerYoyPct)} />
            {multiple != null ? (
              <Figure label="Against the median" value={`${multiple.toFixed(1)}×`} note={`Your ${line.toLowerCase()} over the peer median, latest quarter`} />
            ) : null}
          </div>
        </div>
      </Exhibit>
      <Exhibit number={3} title={`${line}, every ${credit ? "credit union" : "bank"} in the country`} source={source}>
        <div className="grid gap-6 lg:grid-cols-[1fr_15rem]">
          <QuarterLines
            quarters={oldestFirst.map((q) => q.quarter)}
            series={[{ label: `All ${kind} that filed, summed`, values: oldestFirst.map((q) => q.nationalTotal), own: true }]}
          />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
            <Figure label={`Nationally, ${latest.quarter.replace("-", " ")}`} value={fmtFiledThousands(latest.nationalTotal)} note={fmtYoy(ctx.nationalYoyPct)} />
            <Figure label="Filers" value={latest.nationalCount.toLocaleString("en-US")} note={`${kind[0].toUpperCase()}${kind.slice(1)} reporting this line that quarter`} />
          </div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-warm-600">
          {credit
            ? "The 5300 also has separate overdraft (IS0048) and NSF (IS0049) income lines. Fee Insight hasn't loaded those yet, so they aren't shown."
            : "Banks over $1 billion also report consumer overdraft and NSF income (RIAD H032). Fee Insight hasn't loaded that line yet, so it isn't shown."}
        </p>
      </Exhibit>
    </>
  );
}

function LayerExhibit({ layer, ownAmount, feeName }: { layer: LayerSummary; ownAmount: number | null; feeName: string }) {
  const position = describePosition(layer, ownAmount);
  return (
    <Exhibit
      number={1}
      title={`${feeName} prices, ${layer.label}`}
      source={`${layer.scope}. Published fees verified against each institution's own fee schedule; one value per institution${layer.key === "local" ? "; branch deposits from the FDIC Summary of Deposits" : ""}.`}
    >
      {layer.n === 0 ? (
        <p className="text-sm text-warm-700">No institution in this layer has a published {feeName.toLowerCase()} fee yet.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_15rem]">
          <DistributionBars amounts={layer.amounts} own={ownAmount} />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
            <Figure label="Middle (median)" value={fmtMoney(layer.median)} note={layer.thin ? "Few institutions; read with care" : `${layer.n} institutions`} />
            <Figure label="Middle half" value={`${fmtMoney(layer.p25)} to ${fmtMoney(layer.p75)}`} />
            <Figure label="Charge nothing" value={`${layer.zeroCount} of ${layer.n}`} />
            {position ? <Figure label="Against you" value={<span className="text-lg">{position}</span>} /> : null}
          </div>
        </div>
      )}
    </Exhibit>
  );
}

export default async function ResearchPage({ searchParams }: PageProps) {
  const params = await searchParams;

  // Older links used /pro/research?prompt=… for Analyze and the competitive brief.
  if (params.prompt === "competitive-brief") {
    redirect(hrefWithInstitutionContext("/pro/reports?intent=competitive-brief", params.instId ?? null));
  }
  if (params.prompt) {
    const intent = params.prompt === "institution" ? "?intent=institution" : "";
    redirect(hrefWithInstitutionContext(`/pro/analyze${intent}`, params.instId ?? null));
  }

  const user = await getCurrentUser();
  if (!user) redirect("/");

  const ws = await loadFeeWorkspace({ userId: user.id, instId: params.instId, fee: params.fee, intent: "research" });
  const inst = ws.institution;
  const instId = inst ? String(inst.id) : null;
  const layerKey = parseLayer(params.layer ?? (ws.layers.some((l) => l.key === "local") ? "local" : "state"));
  const layer = ws.layers.find((l) => l.key === layerKey) ?? ws.layers[ws.layers.length - 1];

  const [filings, complaints, articles, research] = await Promise.all([
    inst ? getCachedServiceCharges(inst.id) : null,
    inst ? getInstitutionComplaintProfile(inst.id).catch(() => null) : null,
    getArticles({ topic: OVERDRAFT_FAMILY.has(ws.fee) ? "overdraft" : "fees_pricing", limit: 5 }).catch(() => []),
    inst ? getFeeResearch(inst.id, ws.fee).catch(() => null) : null,
  ]);
  const stateChanges = research?.recentChanges ?? [];

  const rules = buildImplementationPlan({
    feeCategory: ws.fee,
    feeLabel: ws.feeName,
    charter: inst?.charterType === "credit_union" ? "credit_union" : "bank",
    current: ws.ownAmount ?? 1,
    proposed: (ws.ownAmount ?? 1) + 1,
  });
  const ruleItems = rules.sections.flatMap((s) => s.items).filter((i) => i.rule);

  const modelHref = hrefWithInstitutionContext(`/pro/simulate?fee=${encodeURIComponent(ws.fee)}`, instId);
  const askHref = hrefWithInstitutionContext(
    `/pro/analyze?q=${encodeURIComponent(`What should I know about our ${ws.feeName.toLowerCase()} fee against ${layer.label}?`)}`,
    instId,
  );
  const latest = filings?.quarters[0] ?? null;
  const credit = inst?.charterType === "credit_union";
  const trail = buildAuditTrail({
    feeName: ws.feeName,
    layer,
    layerDates: layerDates(ws, layer),
    ownFeeRows: ws.ownFeeRows,
    local: layer.key === "local" ? ws.local : null,
    callReport: latest
      ? {
          quarter: latest.quarter,
          source: credit
            ? "NCUA 5300 call report, fee income (account 131); year-to-date filings turned into single quarters. Peer and national figures use every credit union that filed."
            : "FDIC call report, service charges on deposit accounts, quarterly. Peer and national figures use every bank that filed.",
        }
      : null,
    complaints: Boolean(complaints && complaints.total_complaints > 0),
    stateChanges: inst?.stateCode && research
      ? { state: inst.stateCode, days: COMPETITOR_MOVE_WINDOW_DAYS, asOf: research.provenance.dataAsOf.changes ?? null }
      : null,
  });
  const csvHref = hrefWithInstitutionContext(`/pro/research/peers?fee=${encodeURIComponent(ws.fee)}&layer=${layer.key}`, instId);
  const localBanks = ws.local?.banks ?? [];

  return (
    <MemoPage>
      <MemoHeader
        kicker={`My fees · ${ws.feeName}`}
        title={inst ? `Where ${inst.name} sits on ${ws.feeName.toLowerCase()}` : `${ws.feeName} across the market`}
        dek={
          inst
            ? ws.ownAmount != null
              ? `Your published ${ws.feeName.toLowerCase()} fee is ${fmtMoney(ws.ownAmount)}. Move between your market, your state, your Fed district, your peer group and the nation to see how the picture changes.`
              : `We haven't published a ${ws.feeName.toLowerCase()} fee for ${inst.name} yet, so this shows the market without your position.`
            : "Choose your institution in Data to see your own position."
        }
        actions={
          <>
            <LinkButton href={askHref}>Ask about this</LinkButton>
            <LinkButton href={modelHref} primary>
              Try a price
            </LinkButton>
          </>
        }
      />

      {ws.unavailable.length > 0 ? (
        <p role="status" className="text-sm text-terra-text">
          Couldn&apos;t load {ws.unavailable.join(" or ")} just now. What&apos;s shown is everything that did load.
        </p>
      ) : null}

      {ws.ownFees.length > 0 ? (
        <Tabs
          label="Fee"
          items={ws.ownFees.slice(0, 10).map((f) => ({
            label: f.name,
            meta: fmtMoney(f.amount),
            href: researchHref({ fee: f.category, layer: layerKey }, instId),
            active: f.category === ws.fee,
          }))}
        />
      ) : null}

      <MemoSection title="The market, layer by layer" note="One institution, one value each. Overdraft counts at a bank's highest tier.">
        <Tabs
          label="Market layer"
          items={ws.layers.map((l) => ({
            label: l.label,
            meta: l.median != null ? fmtMoney(l.median) : "—",
            href: researchHref({ fee: ws.fee, layer: l.key }, instId),
            active: l.key === layer.key,
          }))}
        />
        <LayerExhibit layer={layer} ownAmount={ws.ownAmount} feeName={ws.feeName} />
        <AuditPanel trail={trail} downloadHref={csvHref} />
      </MemoSection>

      {layer.key === "local" && ws.local ? (
        <MemoSection
          title="The banks your customers can walk into"
          note={`Banks with branches in your ${ws.local.countyCount} ${ws.local.countyCount === 1 ? "county" : "counties"}, by deposits held there (FDIC Summary of Deposits, ${ws.local.year}). Credit unions don't report branch deposits, so they aren't listed.`}
        >
          <div className="overflow-x-auto rounded-lg border border-warm-300 bg-warm-50">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-warm-300 text-left text-xs uppercase tracking-[0.08em] text-warm-600">
                  <th className="px-4 py-2 font-medium">Institution</th>
                  <th className="px-4 py-2 text-right font-medium">Deposit share</th>
                  <th className="px-4 py-2 text-right font-medium">{ws.feeName}</th>
                </tr>
              </thead>
              <tbody>
                {localBanks.map((b) => (
                  <tr key={`${b.institutionId}-${b.name}`} className={"border-b border-warm-200 last:border-0 " + (b.isSelf ? "bg-terra-soft" : "")}>
                    <td className="px-4 py-2 text-warm-900">
                      {b.name}
                      {b.isSelf ? <span className="ml-2 text-xs text-terra-text">You</span> : null}
                    </td>
                    <td className="px-4 py-2 text-right [font-variant-numeric:tabular-nums] text-warm-700">{(b.share * 100).toFixed(1)}%</td>
                    <td className="px-4 py-2 text-right [font-variant-numeric:tabular-nums] text-warm-800">
                      {b.feeAmount != null ? fmtMoney(b.feeAmount) : <span className="text-warm-600">Not read yet</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MemoSection>
      ) : null}

      {inst?.stateCode && research ? (
        <MemoSection
          title={`Who changed this fee in ${inst.stateCode}`}
          note={`Changes seen on published schedules in the last ${COMPETITOR_MOVE_WINDOW_DAYS} days, newest first.`}
        >
          {stateChanges.length > 0 ? (
            <ul className="flex flex-col divide-y divide-warm-200 rounded-lg border border-warm-300 bg-warm-50 text-sm text-warm-800">
              {stateChanges.map((c) => (
                <li key={c.text} className="px-4 py-2">
                  {c.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-warm-700">
              No institution in {inst.stateCode} changed its published {ws.feeName.toLowerCase()} fee in that time.
            </p>
          )}
        </MemoSection>
      ) : null}

      {inst ? (
        <MemoSection
          title={`${inst.name} in the regulator filings`}
          note={credit ? "From the NCUA 5300 call report every credit union files each quarter, and the CFPB complaint database." : "From the FDIC call report every bank files each quarter, and the CFPB complaint database."}
        >
          {filings && filings.quarters.length > 0 ? (
            <FilingExhibits ctx={filings} name={inst.name} credit={credit} />
          ) : (
            <p className="text-sm text-warm-700">No call report figures on file for this institution yet.</p>
          )}
          <div>
            <Exhibit number={4} title="Consumer complaints" source="CFPB Consumer Complaint Database">
              {complaints && complaints.total_complaints > 0 ? (
                <div className="flex flex-col gap-3">
                  <Figure
                    label="Complaints on file"
                    value={complaints.total_complaints.toLocaleString("en-US")}
                    note={`${Math.round(complaints.fee_related_pct)}% mention fees or charges`}
                  />
                  <ul className="text-sm text-warm-700">
                    {complaints.by_issue.slice(0, 3).map((i) => (
                      <li key={i.issue} className="flex justify-between gap-3 border-t border-warm-200 py-1">
                        <span className="min-w-0">{i.issue}</span>
                        <span className="[font-variant-numeric:tabular-nums]">{i.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-warm-700">No CFPB complaints on file for this institution.</p>
              )}
            </Exhibit>
          </div>
        </MemoSection>
      ) : null}

      <MemoSection title="The rules that apply" note="What a change to this fee would involve, whichever way it goes.">
        <Callout>
          {rules.noticeSummary.replace("An increase needs", "Raising it needs")} Lowering or removing a fee needs no advance notice.
        </Callout>
        <ul className="flex flex-col gap-2 text-sm text-warm-800">
          {ruleItems.map((i) => (
            <li key={i.text} className="flex flex-wrap justify-between gap-2 border-b border-warm-200 pb-2">
              <span className="min-w-0">{i.text}</span>
              <a href={i.rule!.url} className="text-terra-text underline" target="_blank" rel="noreferrer">
                {i.rule!.label}
              </a>
            </li>
          ))}
        </ul>
        {articles.length > 0 ? (
          <div className="mt-2">
            <h3 className="text-base text-warm-900" style={SERIF}>
              Recent regulatory news
            </h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              {articles.map((a) => (
                <li key={a.guid} className="flex flex-wrap gap-x-2">
                  <a href={a.link} target="_blank" rel="noreferrer" className="text-warm-900 underline decoration-warm-400">
                    {a.title}
                  </a>
                  <span className="text-warm-600">
                    {a.source.toUpperCase()}
                    {a.published_at ? `, ${new Date(a.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </MemoSection>
    </MemoPage>
  );
}
