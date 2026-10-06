// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { layerDates, loadFeeWorkspace } from "@/lib/hamilton/fee-workspace-data";
import { buildAuditTrail } from "@/lib/hamilton/audit-trail";
import { describePosition, parseLayer, type LayerSummary } from "@/lib/hamilton/research-layers";
import { buildImplementationPlan } from "@/lib/hamilton/implementation-plan";
import { getInstitutionRevenueTrend } from "@/lib/data-store/call-reports";
import { getInstitutionComplaintProfile } from "@/lib/data-store/complaints";
import { getArticles } from "@/lib/data-store/news";
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
  SERIF,
  Tabs,
  fmtMoney,
} from "@/components/hamilton/memo/memo";

export const metadata: Metadata = { title: "Research" };

interface PageProps {
  searchParams: Promise<{ fee?: string; layer?: string; instId?: string; prompt?: string }>;
}

const OVERDRAFT_FAMILY = new Set(["overdraft", "nsf", "continuous_od", "od_protection_transfer"]);

function researchHref(p: { fee: string; layer: string }, instId: string | null) {
  return hrefWithInstitutionContext(`/pro/research?fee=${encodeURIComponent(p.fee)}&layer=${p.layer}`, instId);
}

function fmtThousands(value: number): string {
  // Call report figures are in thousands of dollars.
  const dollars = value * 1000;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)} million`;
  return `$${Math.round(dollars / 1000).toLocaleString("en-US")} thousand`;
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

  const [trend, complaints, articles] = await Promise.all([
    inst ? getInstitutionRevenueTrend(inst.id, 8).catch(() => []) : [],
    inst ? getInstitutionComplaintProfile(inst.id).catch(() => null) : null,
    getArticles({ topic: OVERDRAFT_FAMILY.has(ws.fee) ? "overdraft" : "fees_pricing", limit: 5 }).catch(() => []),
  ]);

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
  const latest = trend[0] ?? null;
  const trail = buildAuditTrail({
    feeName: ws.feeName,
    layer,
    layerDates: layerDates(ws, layer),
    ownFeeRows: ws.ownFeeRows,
    local: layer.key === "local" ? ws.local : null,
    callReport: latest
      ? { quarter: latest.quarter, source: inst?.charterType === "credit_union" ? "NCUA 5300 call report, year to date." : "FDIC call report, quarterly." }
      : null,
    complaints: Boolean(complaints && complaints.total_complaints > 0),
  });
  const csvHref = hrefWithInstitutionContext(`/pro/research/peers?fee=${encodeURIComponent(ws.fee)}&layer=${layer.key}`, instId);
  const localBanks = ws.local?.banks ?? [];

  return (
    <MemoPage>
      <MemoHeader
        kicker={`Research · ${ws.feeName}`}
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
              Model a price
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
                    <td className="px-4 py-2 text-right tabular-nums text-warm-700">{(b.share * 100).toFixed(1)}%</td>
                    <td className="px-4 py-2 text-right tabular-nums text-warm-800">
                      {b.feeAmount != null ? fmtMoney(b.feeAmount) : <span className="text-warm-600">Not read yet</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MemoSection>
      ) : null}

      {inst ? (
        <MemoSection title={`${inst.name} on the record`} note="From your regulator filings and the CFPB complaint database.">
          <div className="grid gap-4 md:grid-cols-2">
            <Exhibit number={2} title="Service charges on deposit accounts" source={inst.charterType === "credit_union" ? "NCUA 5300 call report" : "FDIC call report"}>
              {latest ? (
                <div className="flex flex-col gap-3">
                  <Figure
                    label={inst.charterType === "credit_union" ? `Year to date, ${latest.quarter}` : `Quarter, ${latest.quarter}`}
                    value={fmtThousands(latest.service_charge_income)}
                    note={
                      latest.yoy_change_pct != null
                        ? `${latest.yoy_change_pct >= 0 ? "Up" : "Down"} ${Math.abs(latest.yoy_change_pct).toFixed(1)}% from the same quarter a year earlier`
                        : "No same quarter a year earlier to compare"
                    }
                  />
                  <p className="text-xs text-warm-600">
                    {inst.charterType === "credit_union"
                      ? "Credit union filings report this year to date, so compare a quarter with the same quarter a year earlier. Credit unions report overdraft and NSF income separately."
                      : "Bank filings report this for the quarter alone. Banks report overdraft and NSF income only inside this total."}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-warm-700">No call report figures on file for this institution yet.</p>
              )}
            </Exhibit>
            <Exhibit number={3} title="Consumer complaints" source="CFPB Consumer Complaint Database">
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
                        <span className="tabular-nums">{i.count}</span>
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
