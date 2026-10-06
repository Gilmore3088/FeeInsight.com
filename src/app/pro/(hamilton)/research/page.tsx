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
import type { FeeResearch, InstitutionFinancials, MarketIncome } from "@/lib/hamilton/workspace/types";
import { getInstitutionComplaintProfile } from "@/lib/data-store/complaints";
import { getArticles } from "@/lib/data-store/news";
import { COMPETITOR_MOVE_WINDOW_DAYS } from "@/lib/hamilton/workspace/research";
import {
  AuditPanel,
  Callout,
  More,
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
import { buildFeeAnswer } from "@/lib/hamilton/workspace/answer";
import { AnswerView } from "@/components/hamilton/memo/exhibit-view";

export const metadata: Metadata = { title: "My fees" };

interface PageProps {
  searchParams: Promise<{ fee?: string; layer?: string; instId?: string; prompt?: string }>;
}

const OVERDRAFT_FAMILY = new Set(["overdraft", "nsf", "continuous_od", "od_protection_transfer"]);

function researchHref(p: { fee: string; layer: string }, instId: string | null) {
  return hrefWithInstitutionContext(`/pro/research?fee=${encodeURIComponent(p.fee)}&layer=${p.layer}`, instId);
}

function fmtYoy(pct: number | null, against = "the same quarter a year earlier"): string {
  if (pct == null) return `No ${against.replace(/^the /, "")} on file to compare`;
  if (pct === 0) return `Level with ${against}`;
  return `${pct > 0 ? "Up" : "Down"} ${Math.abs(pct).toFixed(1)}% on ${against}`;
}

const quarterLabel = (q: string) => q.replace("-", " ");
/** "2026-06-30" to "2026-Q2". */
const quarterOf = (isoDate: string) => `${isoDate.slice(0, 4)}-Q${Math.ceil(Number(isoDate.slice(5, 7)) / 3)}`;

function FilingExhibits({
  own,
  national,
  revenueLine,
  name,
  credit,
}: {
  own: InstitutionFinancials | null;
  national: MarketIncome[];
  revenueLine: FeeResearch["revenueLine"];
  name: string;
  credit: boolean;
}) {
  const kind = credit ? "credit unions" : "banks";
  const ownOldest = own ? [...own.quarters].reverse() : [];
  const peer = own?.peerMedian ?? null;
  const peerByQuarter = new Map((peer?.quarters ?? []).map((q) => [q.quarterEnd, q.amount]));
  const peerLatest = own && peer ? (peer.quarters.find((q) => q.quarterEnd === own.quarterEnd && q.amount > 0) ?? null) : null;
  const natOldest = [...national].reverse();
  const natLatest = national[0] ?? null;
  const natPrior = natLatest ? national.find((q) => q.quarter === `${Number(natLatest.quarter.slice(0, 4)) - 1}${natLatest.quarter.slice(4)}`) : null;
  const groupNow = natLatest ? (credit ? natLatest.creditUnions : natLatest.banks) : null;
  const groupPrior = natPrior ? (credit ? natPrior.creditUnions : natPrior.banks) : null;
  const groupYoy = groupNow != null && groupPrior ? Math.round(((groupNow - groupPrior) / groupPrior) * 1000) / 10 : null;
  return (
    <>
      {own && own.quarters.length > 0 ? (
        <Exhibit
          number={2}
          title={peer ? `${name}'s fee income each quarter, against its peers` : `${name}'s fee income each quarter`}
          source={`${own.sourceRef.label}${peer ? `; peer median from every filer that is ${peer.label.charAt(0).toLowerCase()}${peer.label.slice(1)}` : ""}. Each quarter stands alone; credit union year-to-date filings are split into quarters.`}
        >
          <div className="grid gap-6 lg:grid-cols-[1fr_15rem]">
            <QuarterLines
              quarters={ownOldest.map((q) => quarterOf(q.quarterEnd))}
              series={[
                { label: name, values: ownOldest.map((q) => q.amount / 1000), own: true },
                ...(peer
                  ? [{ label: `Median of ${peer.label.charAt(0).toLowerCase()}${peer.label.slice(1)}`, values: ownOldest.map((q) => { const m = peerByQuarter.get(q.quarterEnd); return m == null ? null : m / 1000; }) }]
                  : []),
              ]}
            />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
              <Figure label={`Latest quarter, ${quarterLabel(quarterOf(own.quarterEnd))}`} value={fmtFiledThousands(own.quarters[0].amount / 1000)} />
              {peerLatest ? (
                <Figure
                  label="Peer median, same quarter"
                  value={fmtFiledThousands(peerLatest.amount / 1000)}
                  note={`${peerLatest.institutions.toLocaleString("en-US")} filers; you're at ${(own.quarters[0].amount / peerLatest.amount).toFixed(1)}× the median`}
                />
              ) : null}
              {own.latestTtm != null ? (
                <Figure label="Last four quarters" value={fmtFiledThousands(own.latestTtm / 1000)} note={fmtYoy(own.yoyPct, "the four quarters before")} />
              ) : null}
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-warm-600">
            {revenueLine
              ? `${revenueLine.label}: ${fmtFiledThousands(revenueLine.annualIncome / 1000)} over the last four quarters${revenueLine.combinedWith ? `, reported together with ${revenueLine.combinedWith}` : ""}.`
              : credit
                ? "Overdraft and NSF income (5300 lines IS0048 and IS0049): not reported by NCUA. Its public data carries no figures on those lines for any credit union, so Fee Insight shows none rather than a zero."
                : "Banks over $1 billion also report consumer overdraft and NSF income (RIAD H032). Fee Insight hasn't loaded that line yet, so it isn't shown."}
          </p>
        </Exhibit>
      ) : (
        <p className="text-sm text-warm-700">No call report figures on file for {name} yet.</p>
      )}
      {natLatest ? (
        <Exhibit number={3} title="Service charges on deposit accounts, every filer in the country" source={`${natLatest.sourceRef.label}. Credit union year-to-date filings are split into quarters.`}>
          <div className="grid gap-6 lg:grid-cols-[1fr_15rem]">
            <QuarterLines
              quarters={natOldest.map((q) => q.quarter)}
              series={[
                { label: `All ${kind}`, values: natOldest.map((q) => (credit ? q.creditUnions : q.banks) / 1000), own: true },
                { label: `All ${credit ? "banks" : "credit unions"}`, values: natOldest.map((q) => (credit ? q.banks : q.creditUnions) / 1000) },
              ]}
            />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
              <Figure label={`All ${kind}, ${quarterLabel(natLatest.quarter)}`} value={fmtFiledThousands((groupNow ?? 0) / 1000)} note={fmtYoy(groupYoy)} />
              <Figure
                label="Banks and credit unions together"
                value={fmtFiledThousands(natLatest.total / 1000)}
                note={`${natLatest.institutions.toLocaleString("en-US")} filers; ${fmtYoy(natLatest.yoyPct).toLowerCase()}`}
              />
            </div>
          </div>
        </Exhibit>
      ) : null}
    </>
  );
}

type RuleRow = { text: string; label: string; url: string | null };

function RuleRows({ rules }: { rules: RuleRow[] }) {
  return (
    <ul className="flex flex-col gap-2 text-sm text-warm-800">
      {rules.map((r) => (
        <li key={r.text} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-warm-200 pb-2">
          <span className="min-w-0 flex-1">{r.text}</span>
          {r.url ? (
            <a href={r.url} className="text-terra-text underline" target="_blank" rel="noreferrer">
              {r.label}
            </a>
          ) : (
            <span className="text-warm-600">{r.label}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The first three rules, the rest on request. */
function RuleList({ rules }: { rules: RuleRow[] }) {
  const shown = rules.slice(0, 3);
  const rest = rules.slice(3);
  return (
    <>
      <RuleRows rules={shown} />
      {rest.length > 0 ? (
        <More label={`${rest.length} more ${rest.length === 1 ? "rule" : "rules"}`}>
          <RuleRows rules={rest} />
        </More>
      ) : null}
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

  const research = ws.research;
  const national = research?.nationalIncomeSeries ?? [];
  const [complaints, articles] = await Promise.all([
    inst ? getInstitutionComplaintProfile(inst.id).catch(() => null) : null,
    getArticles({ topic: OVERDRAFT_FAMILY.has(ws.fee) ? "overdraft" : "fees_pricing", limit: 5 }).catch(() => []),
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
  const own = research?.institutionFinancials ?? null;
  const latest = own ? { quarter: quarterOf(own.quarterEnd) } : null;
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
          source: `${own!.sourceRef.label}, from the Hamilton engine; year-to-date filings split into quarters. National figures sum every FDIC and NCUA filer on file.`,
        }
      : null,
    complaints: Boolean(complaints && complaints.total_complaints > 0),
    stateChanges: inst?.stateCode && research
      ? { state: inst.stateCode, days: COMPETITOR_MOVE_WINDOW_DAYS, asOf: research.provenance.dataAsOf.changes ?? null }
      : null,
  });
  const csvHref = hrefWithInstitutionContext(`/pro/research/peers?fee=${encodeURIComponent(ws.fee)}&layer=${layer.key}`, instId);
  const localBanks = ws.local?.competitors ?? [];
  const hamiltonRead = research ? buildFeeAnswer(research) : null;

  return (
    <MemoPage>
      <MemoHeader
        kicker={`My fees · ${ws.feeName}`}
        title={inst ? `Where ${inst.name} sits on ${ws.feeName.toLowerCase()}` : `${ws.feeName} across the market`}
        dek={
          inst
            ? ws.ownAmount != null
              ? `Your published fee is ${fmtMoney(ws.ownAmount)}.`
              : `No published ${ws.feeName.toLowerCase()} fee for ${inst.name} yet; this shows the market alone.`
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

      {hamiltonRead ? (
        <MemoSection title="Hamilton's read">
          <AnswerView
            answer={hamiltonRead}
            {...(hamiltonRead.question?.fieldKey.endsWith(".annual_items")
              ? {
                  questionAction: "/pro/simulate",
                  questionName: "paid",
                  questionWhy: "Opens Try a price with your yearly fee income.",
                  questionKeep: { fee: ws.fee, layer: layerKey, instId },
                }
              : {})}
          />
        </MemoSection>
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
          title="Who your customers can walk into"
          note={`${ws.local.institutions} ${ws.local.institutions === 1 ? "institution" : "institutions"} in your market, largest deposits first (FDIC Summary of Deposits, ${ws.local.sodYear}).`}
        >
          {localBanks.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-warm-300 bg-warm-50">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="border-b border-warm-300 text-left text-xs uppercase tracking-[0.08em] text-warm-600">
                    <th className="px-4 py-2 font-medium">Institution</th>
                    <th className="px-4 py-2 text-right font-medium">Deposits in your market</th>
                    <th className="px-4 py-2 text-right font-medium">{ws.feeName}</th>
                  </tr>
                </thead>
                <tbody>
                  {localBanks.map((b) => (
                    <tr key={b.institutionId} className="border-b border-warm-200 last:border-0">
                      <td className="px-4 py-2 text-warm-900">
                        {b.documentUrls[0] ? (
                          <a href={b.documentUrls[0]} target="_blank" rel="noreferrer" className="underline decoration-warm-400">
                            {b.institutionName}
                          </a>
                        ) : (
                          b.institutionName
                        )}
                      </td>
                      <td className="px-4 py-2 text-right [font-variant-numeric:tabular-nums] text-warm-700">
                        {b.marketDeposits != null ? fmtFiledThousands(b.marketDeposits / 1000) : <span className="text-warm-600">Not in the Summary of Deposits</span>}
                      </td>
                      <td className="px-4 py-2 text-right [font-variant-numeric:tabular-nums] text-warm-800">{fmtMoney(b.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-warm-700">No institution in your market publishes a {ws.feeName.toLowerCase()} fee we&apos;ve verified yet.</p>
          )}
        </MemoSection>
      ) : null}

      {inst?.stateCode && research ? (
        <MemoSection
          title={`Who changed this fee in ${inst.stateCode}`}
          note={`Last ${COMPETITOR_MOVE_WINDOW_DAYS} days, newest first.`}
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
          note={credit ? "NCUA 5300 call reports and CFPB complaints." : "FDIC call reports and CFPB complaints."}
        >
          <FilingExhibits own={own} national={national} revenueLine={research?.revenueLine ?? null} name={inst.name} credit={credit} />
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

      <MemoSection title="The rules that apply">
        <Callout>
          {rules.noticeSummary.replace("An increase needs", "Raising it needs")} Lowering or removing a fee needs no advance notice.
        </Callout>
        <RuleList
          rules={
            research && research.regulation.length > 0
              ? research.regulation.map((f) => ({ text: f.text, label: f.source.label, url: f.source.url ?? null }))
              : ruleItems.map((i) => ({ text: i.text, label: i.rule!.label, url: i.rule!.url }))
          }
        />
        {articles.length > 0 ? (
          <More label={`Recent regulatory news (${articles.length})`}>
            <ul className="flex flex-col gap-1.5 text-sm">
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
          </More>
        ) : null}
      </MemoSection>
    </MemoPage>
  );
}
